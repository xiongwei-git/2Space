import { test } from "node:test";
import assert from "node:assert/strict";
import { hkdfSync, pbkdf2Sync } from "node:crypto";
import type { BrowserPasswordProtection } from "@2space/shared";
import { PASSWORD_KDF_ITERATIONS } from "@2space/shared";
import {
  decode,
  encode,
  encryptDocument,
  decryptDocument,
} from "../src/crypto.js";
import {
  createPasswordProtection,
  derivePasswordProtection,
} from "../src/password-protection.js";

const spaceId = "4cf12782-222d-435d-8623-8b7ed5b00154";
const otherSpaceId = "bdb7a0f1-0831-4396-a5fa-b83f380b910a";
const fixed: BrowserPasswordProtection = {
  version: 1,
  kdf: "PBKDF2-SHA256",
  iterations: 600000,
  salt: "AAECAwQFBgcICQoLDA0ODw",
};
const password = "  合成测试密码 / 🌿 / 2026  ";

test("密码保护设置使用独立随机16字节盐和固定版本参数", () => {
  const first = createPasswordProtection();
  const second = createPasswordProtection();
  assert.deepEqual(Object.keys(first).sort(), [
    "iterations",
    "kdf",
    "salt",
    "version",
  ]);
  assert.equal(first.version, 1);
  assert.equal(first.kdf, "PBKDF2-SHA256");
  assert.equal(first.iterations, PASSWORD_KDF_ITERATIONS);
  assert.equal(decode(first.salt).length, 16);
  assert.equal(encode(decode(first.salt)), first.salt);
  assert.notEqual(first.salt, second.salt);
});

test("Web Crypto派生与独立Node PBKDF2/HKDF实现一致，保留原密码空格和Unicode", async () => {
  const result = await derivePasswordProtection(password, spaceId, fixed);
  const root = pbkdf2Sync(
    password,
    Buffer.from(fixed.salt, "base64url"),
    600000,
    32,
    "sha256",
  );
  const expectedKey = Buffer.from(
    hkdfSync(
      "sha256",
      root,
      Buffer.from(spaceId),
      Buffer.from("2space/password/v1/document"),
      32,
    ),
  ).toString("base64url");
  const expectedProof = Buffer.from(
    hkdfSync(
      "sha256",
      root,
      Buffer.from(spaceId),
      Buffer.from("2space/password/v1/auth"),
      32,
    ),
  ).toString("base64url");
  assert.ok(result.key === expectedKey, "正文派生结果与独立实现一致");
  assert.ok(result.proof === expectedProof, "认证派生结果与独立实现一致");
  assert.equal(decode(result.key).length, 32);
  assert.equal(decode(result.proof).length, 32);
  assert.ok(result.key !== result.proof, "正文与认证用途域隔离");
  root.fill(0);
});

test("相同输入可重复派生，换盐或空间后正文和认证结果均隔离", async () => {
  const [first, same, differentSalt, differentSpace] = await Promise.all([
    derivePasswordProtection(password, spaceId, fixed),
    derivePasswordProtection(password, spaceId, fixed),
    derivePasswordProtection(password, spaceId, {
      ...fixed,
      salt: "EBESExQVFhcYGRobHB0eHw",
    }),
    derivePasswordProtection(password, otherSpaceId, fixed),
  ]);
  assert.ok(
    first.key === same.key && first.proof === same.proof,
    "重复输入结果稳定",
  );
  for (const different of [differentSalt, differentSpace]) {
    assert.ok(
      first.key !== different.key && first.proof !== different.proof,
      "盐或空间变化同时隔离两个用途",
    );
  }
});

test("派生正文钥匙可解密，错误密码和认证proof均不能代替正文钥匙", async () => {
  const [correct, wrong] = await Promise.all([
    derivePasswordProtection(password, spaceId, fixed),
    derivePasswordProtection("合成的错误密码", spaceId, fixed),
  ]);
  const doc = {
    title: "合成内容",
    html: "<p>仅浏览器解开</p>",
    text: "仅浏览器解开",
    language: "plaintext",
  };
  const payload = await encryptDocument(doc, correct.key);
  assert.deepEqual(await decryptDocument(payload, correct.key), doc);
  await assert.rejects(decryptDocument(payload, wrong.key));
  await assert.rejects(decryptDocument(payload, correct.proof));
  assert.ok(correct.proof !== wrong.proof, "错误密码不能通过相同认证proof");
});

test("拒绝降级或超额KDF参数、非法盐及额外字段，不进行昂贵派生", async () => {
  const invalid: unknown[] = [
    null,
    [],
    {},
    { ...fixed, version: 2 },
    { ...fixed, kdf: "PBKDF2-SHA1" },
    ...[0, 1, 599999, 600001, Infinity, NaN, "600000"].map((iterations) => ({
      ...fixed,
      iterations,
    })),
    { ...fixed, salt: "" },
    { ...fixed, salt: fixed.salt + "==" },
    { ...fixed, salt: "AAECAwQFBgcICQoLDA0ODx" },
    { ...fixed, salt: "AAECAwQFBgcICQoLDA0O" },
    { ...fixed, salt: "+/ECAwQFBgcICQoLDA0ODw" },
    { ...fixed, documentKey: "unexpected" },
    Object.create(fixed),
  ];
  for (const value of invalid) {
    await assert.rejects(
      derivePasswordProtection(
        password,
        spaceId,
        value as BrowserPasswordProtection,
      ),
      /密码设置无效/,
    );
  }
});

test("拒绝空密码、过长UTF8密码和无效空间ID，避免跨上下文误用", async () => {
  for (const value of ["", "x".repeat(1025), "密".repeat(342)])
    await assert.rejects(
      derivePasswordProtection(value, spaceId, fixed),
      /密码/,
    );
  for (const value of ["", "space-name", spaceId + " ", "../" + spaceId])
    await assert.rejects(
      derivePasswordProtection(password, value, fixed),
      /链接不完整/,
    );
});
