import type { EncryptedPayload, PlainDocument } from "@2space/shared";
export function encode(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(""))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function decode(text: string): Uint8Array<ArrayBuffer> {
  const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
export function randomSecret(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
async function aes(raw: string) {
  return crypto.subtle.importKey("raw", decode(raw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function encryptDocument(
  document: PlainDocument,
  key: string,
): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aes(key),
    new TextEncoder().encode(JSON.stringify(document)),
  );
  return { iv: encode(iv), ciphertext: encode(new Uint8Array(result)) };
}
export async function decryptDocument(
  payload: EncryptedPayload,
  key: string,
): Promise<PlainDocument> {
  const bytes = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(payload.iv) },
    await aes(key),
    decode(payload.ciphertext),
  );
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== "object") throw Error("内容格式不正确");
  const d = data as Record<string, unknown>;
  if (
    !["title", "html", "text", "language"].every(
      (k) => typeof d[k] === "string",
    )
  )
    throw Error("内容格式不正确");
  return d as unknown as PlainDocument;
}
async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const raw = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 },
    raw,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function wrapKey(key: string, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const result = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await passwordKey(password, salt),
    decode(key),
  );
  return { w: encode(new Uint8Array(result)), s: encode(salt), i: encode(iv) };
}
export async function unwrapKey(params: URLSearchParams, password: string) {
  const result = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(params.get("i") || "") },
    await passwordKey(password, decode(params.get("s") || "")),
    decode(params.get("w") || ""),
  );
  return encode(new Uint8Array(result));
}
