import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  randomBytes,
  randomUUID,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

// This suite owns an isolated temporary database; never connects to port 3210.
const temp = await mkdtemp(join(tmpdir(), "2space-short-links-"));
process.env.DB_PATH = join(temp, "synthetic.sqlite");
process.env.WEB_DIST = resolve("apps/web/dist");
const { buildApp } = await import("../apps/server/dist/app.js");
const app = await buildApp();
let checks = 0;
let stage = "startup";
function derive(seed, info) {
  return Buffer.from(
    hkdfSync(
      "sha256",
      seed,
      Buffer.from("2Space compact v2"),
      Buffer.from(info),
      32,
    ),
  );
}
function encrypt(bytes, key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    iv: iv.toString("base64url"),
    ciphertext: Buffer.concat([
      cipher.update(bytes),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url"),
  };
}
function decrypt(payload, key) {
  const bytes = Buffer.from(payload.ciphertext, "base64url"),
    decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(payload.iv, "base64url"),
    );
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([
    decipher.update(bytes.subarray(0, -16)),
    decipher.final(),
  ]);
}
async function request(
  path,
  { method = "GET", token, body, status = 200 } = {},
) {
  const response = await app.inject({
    method,
    url: path,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: body }),
  });
  assert.equal(response.statusCode, status, `${stage}: ${method}状态符合契约`);
  checks++;
  return response.statusCode === 204 ? undefined : response.json();
}
try {
  stage = "named-create";
  const seed = randomBytes(32),
    docKey = derive(seed, "owner/document"),
    owner = derive(seed, "owner/auth").toString("base64url");
  assert.ok(!derive(seed, "owner/auth").equals(docKey), "HKDF域隔离");
  checks++;
  const name = `accept-${randomBytes(4).toString("hex")}`,
    pageId = randomUUID();
  const page = {
    id: pageId,
    payload: encrypt(
      Buffer.from(
        JSON.stringify({
          title: "短链验收",
          html: "<p>合成正文</p>",
          text: "合成正文",
          language: "plaintext",
        }),
      ),
      docKey,
    ),
  };
  const space = await request("/api/spaces", {
    method: "POST",
    body: { name, ownerToken: owner, retentionSeconds: 1800, page },
    status: 201,
  });
  assert.equal(space.name, name);
  checks++;
  const barePage = await app.inject({ method: "GET", url: `/${name}` });
  assert.equal(barePage.statusCode, 200, "裸名返回SPA入口");
  assert.ok(!barePage.body.includes("合成正文"), "公开入口不包含解密正文");
  checks++;
  const bareHead = await app.inject({ method: "HEAD", url: `/${name}` });
  assert.equal(bareHead.statusCode, 200, "裸名HEAD兼容");
  assert.equal(bareHead.body, "", "HEAD不含正文");
  checks++;
  await request(`/api/spaces/by-name/${name}`, { status: 401 });
  const named = await request(`/api/spaces/by-name/${name}`, { token: owner });
  assert.equal(named.id, space.id);
  checks++;
  stage = "name-conflict-validation";
  const another = randomBytes(32).toString("base64url");
  const duplicate = await request("/api/spaces", {
    method: "POST",
    body: {
      name,
      ownerToken: another,
      retentionSeconds: 1800,
      page: { ...page, id: randomUUID() },
    },
    status: 409,
  });
  assert.equal(duplicate.error.code, "NAME_TAKEN");
  checks++;
  for (const invalid of ["api", "ab", "Bad_Name"])
    await request("/api/spaces", {
      method: "POST",
      body: {
        name: invalid,
        ownerToken: another,
        retentionSeconds: 1800,
        page,
      },
      status: 422,
    });
  await request(`/api/spaces/${space.id}`, {
    method: "PATCH",
    token: owner,
    body: { name: `${name}-other` },
    status: 409,
  });
  stage = "compact-create-or-get";
  const readerSeed = randomBytes(16),
    readerToken = derive(readerSeed, "reader/auth").toString("base64url");
  const body = {
    token: readerToken,
    keyEnvelope: encrypt(docKey, derive(readerSeed, "reader/wrap")),
    ownerEnvelope: encrypt(
      Buffer.from(
        JSON.stringify({ version: 2, seed: readerSeed.toString("base64url") }),
      ),
      docKey,
    ),
  };
  const path = `/api/spaces/${space.id}`;
  await request(`${path}/shares`, {
    method: "POST",
    token: owner,
    body,
    status: 201,
  });
  const first = await request(`${path}/shares`, { token: owner });
  assert.ok(first.share, "owner可读取compact descriptor");
  checks++;
  const restored = JSON.parse(
    decrypt(first.share.ownerEnvelope, docKey).toString(),
  );
  assert.ok(
    restored.seed === readerSeed.toString("base64url"),
    "owner恢复原分享能力",
  );
  checks++;
  const unusedSeed = randomBytes(16),
    unusedToken = derive(unusedSeed, "reader/auth").toString("base64url");
  const candidate = {
    token: unusedToken,
    keyEnvelope: encrypt(docKey, derive(unusedSeed, "reader/wrap")),
    ownerEnvelope: encrypt(
      Buffer.from(
        JSON.stringify({ version: 2, seed: unusedSeed.toString("base64url") }),
      ),
      docKey,
    ),
  };
  await Promise.all([
    request(`${path}/shares`, {
      method: "POST",
      token: owner,
      body: candidate,
    }),
    request(`${path}/shares`, {
      method: "POST",
      token: owner,
      body: candidate,
    }),
  ]);
  const after = await request(`${path}/shares`, { token: owner });
  assert.ok(
    JSON.stringify(after.share) === JSON.stringify(first.share),
    "默认分享不轮换，重复/并发复用descriptor",
  );
  checks++;
  const reader = await request(path, { token: readerToken });
  assert.equal(reader.role, "reader");
  assert.ok(
    decrypt(reader.readerKey, derive(readerSeed, "reader/wrap")).equals(docKey),
    "reader unwrap正文key",
  );
  checks++;
  await request(path, { token: unusedToken, status: 401 });
  await request(`${path}/shares`, {
    method: "POST",
    token: readerToken,
    body: candidate,
    status: 403,
  });
  stage = "v1-compatibility";
  const legacyShare = await request(`${path}/shares`, {
    method: "POST",
    token: owner,
    status: 201,
  });
  await request(path, { token: legacyShare.token });
  await request(path, { token: readerToken });
  assert.ok(
    JSON.stringify(
      (await request(`${path}/shares`, { token: owner })).share,
    ) === JSON.stringify(first.share),
    "v1分享不删除compact descriptor",
  );
  checks++;
  assert.equal(
    (await request(path, { token: owner })).expiresAt,
    space.expiresAt,
    "分享读取/生成不续期",
  );
  checks++;
  stage = "explicit-replace-revoke";
  await request(`${path}/shares`, {
    method: "POST",
    token: owner,
    body: { ...candidate, replace: true },
    status: 201,
  });
  await request(path, { token: readerToken, status: 401 });
  await request(path, { token: legacyShare.token, status: 401 });
  await request(path, { token: unusedToken });
  await request(`${path}/shares`, {
    method: "DELETE",
    token: owner,
    status: 204,
  });
  await request(path, { token: unusedToken, status: 401 });
  assert.equal((await request(`${path}/shares`, { token: owner })).share, null);
  checks++;
  stage = "legacy-bind-preserves-data";
  const old = await request("/api/spaces", {
    method: "POST",
    body: {
      ownerToken: another,
      retentionSeconds: 1800,
      page: { ...page, id: randomUUID() },
    },
    status: 201,
  });
  const bound = await request(`/api/spaces/${old.id}`, {
    method: "PATCH",
    token: another,
    body: { name: `old-${randomBytes(4).toString("hex")}` },
  });
  assert.equal(bound.expiresAt, old.expiresAt);
  assert.ok(
    JSON.stringify(bound.pages[0].payload) ===
      JSON.stringify(old.pages[0].payload),
    "绑定名称不改旧密文",
  );
  checks++;
  await request(`/api/spaces/${old.id}`, { token: another });
  console.log(`PASS: ${checks}项隔离短链/命名/权限/旧v1兼容回归。`);
} catch (error) {
  // Assertion descriptions are chosen to contain no values or capability strings.
  console.error(
    `FAIL: ${stage}; ${String(error?.message || "执行异常")
      .split("\n")[0]
      .replace(/https?:\/\/\S+/g, "[URL omitted]")}`,
  );
  process.exitCode = 1;
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
