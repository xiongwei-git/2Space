import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

// Dedicated synthetic SQLite, random loopback port. Never reads or changes 3210.
const temp = await mkdtemp(join(tmpdir(), "2space-reference-"));
process.env.DB_PATH = join(temp, "synthetic.sqlite");
process.env.WEB_DIST = resolve("apps/web/dist");
const { buildApp } = await import("../apps/server/dist/app.js");
const app = await buildApp();
let checks = 0,
  stage = "startup";
const key = randomBytes(32),
  owner = randomBytes(32).toString("base64url");
function payload(text) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  return {
    iv: iv.toString("base64url"),
    ciphertext: Buffer.concat([
      cipher.update(
        JSON.stringify({
          title: "",
          html: `<p>${text}</p>`,
          text,
          language: "plaintext",
        }),
      ),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url"),
  };
}
function decrypt(envelope, rawKey) {
  const bytes = Buffer.from(envelope.ciphertext, "base64url"),
    decipher = createDecipheriv(
      "aes-256-gcm",
      rawKey,
      Buffer.from(envelope.iv, "base64url"),
    );
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(0, -16)),
      decipher.final(),
    ]).toString(),
  );
}
function client(token) {
  return { token, cookies: new Map() };
}
const anonymous = client(),
  passwordClient = client(),
  otherDevice = client(),
  privateClient = client(owner);
async function request(
  path,
  { method = "GET", body, status = 200, as = anonymous } = {},
) {
  const response = await app.inject({
    method,
    url: path,
    headers: {
      ...(as.token ? { authorization: `Bearer ${as.token}` } : {}),
      ...(as.cookies.size
        ? { cookie: [...as.cookies].map(([k, v]) => `${k}=${v}`).join("; ") }
        : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: body }),
  });
  assert.equal(response.statusCode, status, `${stage}: ${method}状态符合契约`);
  checks++;
  for (const line of [response.headers["set-cookie"]].flat().filter(Boolean)) {
    const [cookie] = line.split(";"),
      split = cookie.indexOf("="),
      name = cookie.slice(0, split),
      value = cookie.slice(split + 1);
    if (/Max-Age=0/i.test(line) || !value) as.cookies.delete(name);
    else as.cookies.set(name, value);
  }
  return status === 204 ? null : response.json();
}
try {
  stage = "public-create-name-entry";
  const name = `Ref_${randomBytes(4).toString("hex")}`,
    main = randomUUID();
  const space = await request("/api/spaces", {
    method: "POST",
    body: {
      accessMode: "public",
      name,
      publicKey: key.toString("base64url"),
      ownerToken: owner,
      page: { id: main, payload: payload("参考合成正文") },
    },
    status: 201,
  });
  assert.equal(space.accessMode, "public");
  assert.equal(space.retentionSeconds, 0);
  assert.equal(space.expiresAt, null);
  checks++;
  const path = `/api/spaces/${space.id}`;
  const opened = await request(`/api/spaces/by-name/${name}`);
  assert.equal(opened.publicKey, key.toString("base64url"));
  assert.equal(
    decrypt(opened.pages[0].payload, Buffer.from(opened.publicKey, "base64url"))
      .text,
    "参考合成正文",
  );
  checks++;
  const write = await request(`${path}/pages/${main}`, {
    method: "PUT",
    body: {
      expectedRevision: opened.pages[0].revision,
      payload: payload("凭名称可以修改"),
    },
  });
  assert.equal(write.revision, 2);
  checks++;
  const readOnlyQuery = await request(`${path}?readonly`);
  assert.equal(
    readOnlyQuery.accessMode,
    "public",
    "readonly参数不改变public服务端规则",
  );
  checks++;
  stage = "stats-no-renew";
  const before = await request(path);
  const firstVisit = await request(`${path}/visits`, {
    method: "POST",
    body: {},
  });
  const secondVisit = await request(`${path}/visits`, {
    method: "POST",
    body: {},
  });
  assert.equal(secondVisit.viewCount, firstVisit.viewCount + 1);
  assert.ok(secondVisit.lastViewedAt);
  assert.equal(secondVisit.updatedAt, before.updatedAt);
  assert.equal(secondVisit.revision, before.revision);
  assert.equal(secondVisit.expiresAt, before.expiresAt);
  checks++;
  stage = "all-retention-options";
  const durations = [
    0, 1800, 3600, 21600, 86400, 259200, 604800, 2592000, 7776000, 15552000,
    31536000, 63072000, 94608000,
  ];
  for (const retentionSeconds of durations) {
    const next = await request(path, {
      method: "PATCH",
      body: { retentionSeconds },
    });
    assert.equal(next.retentionSeconds, retentionSeconds);
    assert.ok(
      retentionSeconds === 0 ? next.expiresAt === null : !!next.expiresAt,
    );
    checks++;
  }
  stage = "page-order-main-and-delete";
  const extra = randomUUID(),
    last = randomUUID();
  const second = await request(`${path}/pages`, {
    method: "POST",
    body: { id: extra, payload: payload("第二页") },
    status: 201,
  });
  await request(`${path}/pages`, {
    method: "POST",
    body: { id: last, payload: payload("第三页") },
    status: 201,
  });
  const orderBefore = await request(path);
  await request(`${path}/pages/order`, {
    method: "POST",
    body: { ids: [main, last, extra] },
  });
  const ordered = await request(path);
  assert.ok(
    ordered.pages.map((page) => page.id).join(",") ===
      [main, last, extra].join(","),
    "排序顺序保存",
  );
  assert.equal(ordered.expiresAt, orderBefore.expiresAt);
  checks++;
  await request(`${path}/pages/${main}`, {
    method: "DELETE",
    body: { expectedRevision: write.revision },
    status: 409,
  });
  await request(`${path}/pages/${extra}`, {
    method: "DELETE",
    body: { expectedRevision: second.revision },
    status: 204,
  });
  assert.equal((await request(path)).pages.length, 2);
  checks++;
  stage = "space-password-cookie-boundary";
  const password = `synthetic-${randomUUID()}`,
    changedPassword = `synthetic-${randomUUID()}`;
  const protectedView = await request(`${path}/password`, {
    method: "POST",
    body: { password },
    as: passwordClient,
  });
  assert.equal(protectedView.passwordProtected, true);
  assert.ok(passwordClient.cookies.size > 0);
  checks++;
  const denied = await request(path, { status: 401, as: otherDevice });
  assert.equal(denied.error.code, "PASSWORD_REQUIRED");
  assert.ok(!("publicKey" in denied));
  checks++;
  await request(`${path}/unlock`, {
    method: "POST",
    body: { password: "wrong-synthetic" },
    status: 403,
    as: otherDevice,
  });
  await request(`${path}/unlock`, {
    method: "POST",
    body: { password },
    status: 204,
    as: otherDevice,
  });
  assert.equal(
    (await request(path, { as: otherDevice })).passwordProtected,
    true,
  );
  checks++;
  await request(`${path}/password`, {
    method: "POST",
    body: { password: changedPassword },
    as: passwordClient,
  });
  await request(path, { as: otherDevice, status: 401 });
  await request(`${path}/unlock`, {
    method: "POST",
    body: { password: changedPassword },
    status: 204,
    as: otherDevice,
  });
  await request(`${path}/lock`, {
    method: "POST",
    as: otherDevice,
    status: 204,
  });
  await request(path, { as: otherDevice, status: 401 });
  await request(`${path}/password`, {
    method: "POST",
    body: { password: "" },
    as: passwordClient,
  });
  assert.equal((await request(path)).passwordProtected, false);
  checks++;
  stage = "private-v1-unchanged";
  const old = await request("/api/spaces", {
    method: "POST",
    body: {
      ownerToken: owner,
      page: { id: randomUUID(), payload: payload("旧private保持") },
    },
    status: 201,
  });
  assert.equal(old.retentionSeconds, 86400);
  assert.ok(!old.publicKey);
  checks++;
  await request(`/api/spaces/${old.id}`, { status: 401 });
  const oldView = await request(`/api/spaces/${old.id}`, { as: privateClient });
  assert.ok(!oldView.publicKey);
  checks++;
  const legacy = await request(`/api/spaces/${old.id}/shares`, {
    method: "POST",
    as: privateClient,
    status: 201,
  });
  const legacyReader = client(legacy.token);
  assert.equal(
    (await request(`/api/spaces/${old.id}`, { as: legacyReader })).role,
    "reader",
  );
  checks++;
  await request(`/api/spaces/${old.id}/pages/${old.pages[0].id}`, {
    method: "PUT",
    as: legacyReader,
    body: { expectedRevision: 1, payload: payload("不允许") },
    status: 403,
  });
  await request(`/api/spaces/${old.id}/password`, {
    method: "POST",
    as: legacyReader,
    body: { password: "forbidden" },
    status: 403,
  });
  await request(`/api/spaces/${old.id}/password`, {
    method: "POST",
    as: privateClient,
    body: { password },
  });
  await request(`/api/spaces/${old.id}/unlock`, {
    method: "POST",
    body: { password },
    status: 401,
  });
  await request(`/api/spaces/${old.id}/unlock`, {
    method: "POST",
    as: legacyReader,
    body: { password },
    status: 204,
  });
  await request(`/api/spaces/${old.id}`, { as: legacyReader });
  console.log(
    `PASS: ${checks}项参考对照public/密码/永久/排序/统计/旧private隔离回归。`,
  );
} catch (error) {
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
