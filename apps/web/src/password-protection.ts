import type { BrowserPasswordProtection } from "@2space/shared";
import { PASSWORD_KDF_ITERATIONS } from "@2space/shared";
import { decode, encode } from "./crypto.js";

const encoder = new TextEncoder();
const documentContext = encoder.encode("2space/password/v1/document");
const authenticationContext = encoder.encode("2space/password/v1/auth");
const fields = ["version", "kdf", "iterations", "salt"];
const spaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Generate public derivation parameters only; never send the password or root. */
export function createPasswordProtection(): BrowserPasswordProtection {
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: PASSWORD_KDF_ITERATIONS,
    salt: encode(crypto.getRandomValues(new Uint8Array(16))),
  };
}

function validatedSalt(
  value: BrowserPasswordProtection,
): Uint8Array<ArrayBuffer> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key)) ||
    fields.some((key) => !Object.hasOwn(value, key)) ||
    value.version !== 1 ||
    value.kdf !== "PBKDF2-SHA256" ||
    value.iterations !== PASSWORD_KDF_ITERATIONS ||
    typeof value.salt !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(value.salt)
  )
    throw new Error("密码设置无效，请重新打开后重试。");
  const salt = decode(value.salt);
  if (salt.length !== 16 || encode(salt) !== value.salt)
    throw new Error("密码设置无效，请重新打开后重试。");
  return salt;
}

/**
 * Derive independent document and authentication values with standard Web Crypto.
 * The server receives only `proof`; knowing it does not provide the document key.
 * Returned values belong to the current in-memory session, never persistent storage.
 */
export async function derivePasswordProtection(
  password: string,
  spaceId: string,
  protection: BrowserPasswordProtection,
): Promise<{ key: string; proof: string }> {
  const salt = validatedSalt(protection);
  if (typeof spaceId !== "string" || !spaceIdPattern.test(spaceId))
    throw new Error("链接不完整，请重新复制后打开。");
  if (typeof password !== "string" || !password.length)
    throw new Error("请输入密码后继续。");
  const passwordBytes = encoder.encode(password);
  if (passwordBytes.byteLength > 1024) {
    passwordBytes.fill(0);
    throw new Error("密码过长，请缩短后重试。");
  }
  let rootBytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const passwordMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    passwordBytes.fill(0);
    rootBytes = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          hash: "SHA-256",
          salt,
          iterations: PASSWORD_KDF_ITERATIONS,
        },
        passwordMaterial,
        256,
      ),
    );
    const root = await crypto.subtle.importKey(
      "raw",
      rootBytes,
      "HKDF",
      false,
      ["deriveBits"],
    );
    rootBytes.fill(0);
    const contextSalt = encoder.encode(spaceId);
    const [documentBits, authenticationBits] = await Promise.all(
      [documentContext, authenticationContext].map((info) =>
        crypto.subtle.deriveBits(
          { name: "HKDF", hash: "SHA-256", salt: contextSalt, info },
          root,
          256,
        ),
      ),
    );
    const documentBytes = new Uint8Array(documentBits);
    const authenticationBytes = new Uint8Array(authenticationBits);
    const result = {
      key: encode(documentBytes),
      proof: encode(authenticationBytes),
    };
    documentBytes.fill(0);
    authenticationBytes.fill(0);
    return result;
  } finally {
    passwordBytes.fill(0);
    rootBytes?.fill(0);
  }
}
