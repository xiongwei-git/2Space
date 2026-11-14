import { test } from "node:test";
import assert from "node:assert/strict";
import { hkdfSync } from "node:crypto";
import {
  accessCodeLink,
  compactLink,
  createShareDescriptor,
  deriveOwner,
  deriveReader,
  newSeed,
  parseEntry,
  randomSpaceName,
  recoverShareSeed,
  unwrapReaderKey,
  validSpaceName,
} from "../src/compact.js";
import { decode, encode, randomSecret } from "../src/crypto.js";

const origin = "https://example.test";
test("命名校验与随机默认值符合契约，不接受保留字", () => {
  for (let index = 0; index < 20; index++)
    assert.match(randomSpaceName(), /^[a-z0-9]{8}$/);
  assert(validSpaceName("my-space1"));
  for (const name of [
    "api",
    "share",
    "API",
    "invalid name",
    "abc/def",
    "a".repeat(65),
  ])
    assert(!validSpaceName(name));
});
test("HKDF固定盐与四个域一致，owner32与reader16种子严格canonical", async () => {
  const ownerSeed = encode(new Uint8Array(32).fill(7));
  const owner = await deriveOwner(ownerSeed);
  const expected = (seed: string, info: string) =>
    encode(
      new Uint8Array(
        hkdfSync(
          "sha256",
          decode(seed),
          new TextEncoder().encode("2Space compact v2"),
          new TextEncoder().encode(info),
          32,
        ),
      ),
    );
  assert.equal(owner.key, expected(ownerSeed, "owner/document"));
  assert.equal(owner.token, expected(ownerSeed, "owner/auth"));
  assert.notEqual(owner.key, owner.token);
  const readerSeed = encode(new Uint8Array(16).fill(9)),
    reader = await deriveReader(readerSeed);
  assert.equal(reader.wrappingKey, expected(readerSeed, "reader/wrap"));
  assert.equal(reader.token, expected(readerSeed, "reader/auth"));
  assert.notEqual(reader.wrappingKey, reader.token);
  for (const bad of [
    ownerSeed + "=",
    ownerSeed.slice(1),
    ownerSeed.slice(0, -1) + "d",
    "!".repeat(43),
  ])
    await assert.rejects(deriveOwner(bad));
  await assert.rejects(deriveReader(ownerSeed));
  await assert.rejects(deriveOwner(readerSeed));
});
test("分享双envelope加密往返、独立IV、错误种子与篡改拒绝", async () => {
  const key = randomSecret(),
    seed = newSeed("reader");
  const record = await createShareDescriptor(key, seed);
  assert.notEqual(record.keyEnvelope.iv, record.ownerEnvelope.iv);
  assert.equal(await unwrapReaderKey(record.keyEnvelope, seed), key);
  assert.equal(await recoverShareSeed(record, key), seed);
  assert(!JSON.stringify(record).includes(seed));
  assert(!JSON.stringify(record).includes(key));
  await assert.rejects(unwrapReaderKey(record.keyEnvelope, newSeed("reader")));
  await assert.rejects(recoverShareSeed(record, randomSecret()));
  const changed = {
    ...record,
    keyEnvelope: {
      ...record.keyEnvelope,
      ciphertext: record.keyEnvelope.ciphertext.slice(0, -4) + "AAAA",
    },
  };
  await assert.rejects(recoverShareSeed(changed, key));
});
test("create-or-get使用服务端获胜descriptor，可跨刷新恢复同一个短链接", async () => {
  const key = randomSecret(),
    winnerSeed = newSeed("reader");
  const winner = await createShareDescriptor(key, winnerSeed);
  const loserCandidate = await createShareDescriptor(key);
  assert.notEqual(winner.token, loserCandidate.token);
  // The POST response contains only the winning encrypted descriptor, never the seed.
  const response = JSON.parse(
    JSON.stringify({
      share: {
        keyEnvelope: winner.keyEnvelope,
        ownerEnvelope: winner.ownerEnvelope,
      },
    }),
  );
  const recovered = await recoverShareSeed(response.share, key);
  assert.equal(recovered, winnerSeed);
  assert.equal(
    compactLink(origin, "testspace", "reader", recovered),
    compactLink(origin, "testspace", "reader", winnerSeed),
  );
  assert.equal(
    await unwrapReaderKey(response.share.keyEnvelope, recovered),
    key,
  );
});
test("短链接、裸名称、访问码和旧普通/密码链接兼容解析", () => {
  const owner = newSeed("owner"),
    reader = newSeed("reader");
  const ownerUrl = new URL(compactLink(origin, "testspace", "owner", owner));
  assert.deepEqual(parseEntry(ownerUrl), {
    kind: "owner",
    name: "testspace",
    seed: owner,
  });
  assert.deepEqual(parseEntry(new URL(origin + "/testspace")), {
    kind: "locked",
    name: "testspace",
  });
  assert.deepEqual(
    parseEntry(new URL(compactLink(origin, "testspace", "reader", reader))),
    { kind: "reader", name: "testspace", seed: reader },
  );
  assert.equal(accessCodeLink(origin, "testspace", owner), ownerUrl.href);
  assert.equal(
    accessCodeLink(origin, "testspace", "r=" + reader),
    compactLink(origin, "testspace", "reader", reader),
  );
  for (const suffix of [
    "k=old-key&m=old-token",
    "w=wrapped&s=salt&i=iv&r=old-token",
  ]) {
    const entry = parseEntry(new URL(origin + "/s/legacy-id#" + suffix));
    assert.equal(entry.kind, "legacy");
    if (entry.kind === "legacy") assert.equal(entry.params.toString(), suffix);
  }
  assert.throws(() => parseEntry(new URL(origin + "/testspace#r=" + owner)));
  assert.throws(() =>
    parseEntry(new URL(origin + "/testspace#o=" + owner + "&r=" + reader)),
  );
  assert.throws(() =>
    accessCodeLink(
      origin,
      "testspace",
      "https://evil.test/testspace#r=" + reader,
    ),
  );
});
