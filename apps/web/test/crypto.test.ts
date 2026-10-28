import { test } from "node:test";
import assert from "node:assert/strict";
import {
  randomSecret,
  encryptDocument,
  decryptDocument,
  wrapKey,
  unwrapKey,
} from "../src/crypto.js";
test("AES-GCM保留中文代码且每次随机IV，错误密钥/篡改失败", async () => {
  const key = randomSecret(),
    doc = {
      title: "命令",
      html: "<pre><code>  x\n😀</code></pre>",
      text: "  x\n😀",
      language: "bash",
    };
  const a = await encryptDocument(doc, key),
    b = await encryptDocument(doc, key);
  assert.notEqual(a.iv, b.iv);
  assert.deepEqual(await decryptDocument(a, key), doc);
  assert(!a.ciphertext.includes("命令"));
  await assert.rejects(decryptDocument(a, randomSecret()));
  await assert.rejects(
    decryptDocument(
      { ...a, ciphertext: a.ciphertext.slice(0, -4) + "AAAA" },
      key,
    ),
  );
});
test("密码包装密钥，错误密码无法解锁", async () => {
  const key = randomSecret(),
    params = new URLSearchParams(await wrapKey(key, "unit-test-passphrase"));
  assert.equal(await unwrapKey(params, "unit-test-passphrase"), key);
  await assert.rejects(unwrapKey(params, "wrong"));
});
