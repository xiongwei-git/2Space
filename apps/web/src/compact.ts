import type { CompactShareRecord, EncryptedPayload } from "@2space/shared";
import { SPACE_NAME_PATTERN, RESERVED_SPACE_NAMES } from "@2space/shared";
import { decode, encode } from "./crypto.js";

export function validSpaceName(name: string): boolean {
  return (
    SPACE_NAME_PATTERN.test(name) &&
    !RESERVED_SPACE_NAMES.includes(
      name as (typeof RESERVED_SPACE_NAMES)[number],
    )
  );
}
export function randomSpaceName(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let name = "";
  while (name.length < 8) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < 252 && name.length < 8) name += alphabet[byte % 36];
    }
  }
  return name;
}
export function newSeed(role: "owner" | "reader"): string {
  return encode(
    crypto.getRandomValues(new Uint8Array(role === "owner" ? 32 : 16)),
  );
}
export function validateSeed(seed: string, role: "owner" | "reader"): void {
  const length = role === "owner" ? 32 : 16;
  if (!/^[A-Za-z0-9_-]+$/.test(seed))
    throw new Error("访问码格式不正确，请核对完整访问码。");
  const bytes = decode(seed);
  if (bytes.byteLength !== length || encode(bytes) !== seed)
    throw new Error("访问码格式不正确，请核对完整访问码。");
}
async function derive(seed: string, info: string): Promise<string> {
  const material = await crypto.subtle.importKey(
    "raw",
    decode(seed),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bytes = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("2Space compact v2"),
      info: new TextEncoder().encode(info),
    },
    material,
    256,
  );
  return encode(new Uint8Array(bytes));
}
export async function deriveOwner(
  seed: string,
): Promise<{ key: string; token: string }> {
  validateSeed(seed, "owner");
  const [key, token] = await Promise.all([
    derive(seed, "owner/document"),
    derive(seed, "owner/auth"),
  ]);
  return { key, token };
}
export async function deriveReader(
  seed: string,
): Promise<{ wrappingKey: string; token: string }> {
  validateSeed(seed, "reader");
  const [wrappingKey, token] = await Promise.all([
    derive(seed, "reader/wrap"),
    derive(seed, "reader/auth"),
  ]);
  return { wrappingKey, token };
}
async function seal(
  bytes: Uint8Array<ArrayBuffer>,
  key: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey(
    "raw",
    decode(key),
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    imported,
    bytes,
  );
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(encrypted)) };
}
async function open(
  payload: EncryptedPayload,
  key: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const imported = await crypto.subtle.importKey(
    "raw",
    decode(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(payload.iv) },
      imported,
      decode(payload.ciphertext),
    ),
  );
}
export async function createShareDescriptor(
  documentKey: string,
  seed = newSeed("reader"),
) {
  const { token, wrappingKey } = await deriveReader(seed);
  const keyBytes = decode(documentKey);
  if (keyBytes.byteLength !== 32)
    throw new Error("无法打开空间，请重新复制完整链接。");
  const [keyEnvelope, ownerEnvelope] = await Promise.all([
    seal(keyBytes, wrappingKey),
    seal(
      new TextEncoder().encode(JSON.stringify({ version: 2, seed })),
      documentKey,
    ),
  ]);
  return { token, keyEnvelope, ownerEnvelope };
}
export async function unwrapReaderKey(
  keyEnvelope: EncryptedPayload,
  seed: string,
): Promise<string> {
  const { wrappingKey } = await deriveReader(seed);
  const bytes = await open(keyEnvelope, wrappingKey);
  if (bytes.byteLength !== 32)
    throw new Error("分享链接无法打开，请向分享者索取新链接。");
  return encode(bytes);
}
export async function recoverShareSeed(
  descriptor: CompactShareRecord,
  documentKey: string,
): Promise<string> {
  const value: unknown = JSON.parse(
    new TextDecoder().decode(await open(descriptor.ownerEnvelope, documentKey)),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("version" in value) ||
    value.version !== 2 ||
    !("seed" in value) ||
    typeof value.seed !== "string"
  )
    throw new Error("分享链接暂时无法使用，请重试。");
  validateSeed(value.seed, "reader");
  if (
    (await unwrapReaderKey(descriptor.keyEnvelope, value.seed)) !== documentKey
  )
    throw new Error("这个分享链接无法打开此空间，请重新复制链接。");
  return value.seed;
}
export type Entry =
  | { kind: "home" }
  | { kind: "locked"; name: string }
  | { kind: "owner" | "reader"; name: string; seed: string }
  | { kind: "legacy"; id: string; params: URLSearchParams };
export function parseEntry(url: URL): Entry {
  const legacy = url.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/);
  const params = new URLSearchParams(url.hash.slice(1));
  if (legacy) return { kind: "legacy", id: legacy[1], params };
  if (url.pathname === "/") return { kind: "home" };
  const name = url.pathname.slice(1);
  if (!validSpaceName(name))
    throw new Error("名称需3–32个小写字母、数字或中划线，请检查后重试。");
  if (!url.hash || url.hash === "#") return { kind: "locked", name };
  if (params.size !== 1 || (!params.has("o") && !params.has("r")))
    throw new Error("链接不完整，请使用完整空间链接。");
  const role = params.has("o") ? "owner" : "reader";
  const seed = params.get(role === "owner" ? "o" : "r") || "";
  validateSeed(seed, role);
  return { kind: role, name, seed };
}
export function compactLink(
  origin: string,
  name: string,
  role: "owner" | "reader",
  seed: string,
): string {
  if (!validSpaceName(name)) throw new Error("这个名称无法使用，请换一个。");
  validateSeed(seed, role);
  return `${origin}/${name}#${role === "owner" ? "o" : "r"}=${seed}`;
}
export function accessCodeLink(
  origin: string,
  name: string,
  code: string,
): string {
  const value = code.trim();
  if (value.includes("/")) {
    const url = new URL(value, origin);
    if (
      url.origin !== origin ||
      parseEntry(url).kind === "locked" ||
      parseEntry(url).kind === "home"
    )
      throw new Error("请输入本站完整空间链接或访问码。");
    return url.href;
  }
  const match = value.match(/^(?:#?([or])=)?([A-Za-z0-9_-]+)$/);
  if (!match) throw new Error("访问码格式不正确");
  const role =
    match[1] === "o"
      ? "owner"
      : match[1] === "r"
        ? "reader"
        : match[2].length === 43
          ? "owner"
          : "reader";
  return compactLink(origin, name, role, match[2]);
}
