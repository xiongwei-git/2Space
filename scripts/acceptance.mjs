import assert from "node:assert/strict";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// This script creates and deletes only its own synthetic acceptance space.
// Credentials exist in process memory only and are never printed.
const origin = new URL(process.env.ACCEPTANCE_URL || "http://127.0.0.1:3210");
if (!["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) {
  throw new Error("验收脚本只允许localhost目标，防止误操作远端环境。");
}
const ownerToken = randomBytes(32).toString("base64url");
const key = randomBytes(32);
const pageId = randomUUID();
let spaceId;
let checks = 0;
function encrypted(text) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(
      JSON.stringify({
        title: "验收合成数据",
        html: `<p>${text}</p>`,
        text,
        language: "plaintext",
      }),
    ),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    iv: iv.toString("base64url"),
    ciphertext: body.toString("base64url"),
  };
}
function plaintext(payload) {
  const bytes = Buffer.from(payload.ciphertext, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "base64url"),
  );
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(0, -16)),
      decipher.final(),
    ]).toString(),
  );
}
async function request(
  path,
  { method = "GET", token, body, expected = 200 } = {},
) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, expected, `${method} API状态符合契约`);
  checks++;
  return response.status === 204 ? undefined : response.json();
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(new URL("/api/health", origin), {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* startup may still be underway */
    }
    await delay(250);
  }
  assert.ok(ready, "API健康检查就绪");
  checks++;
  // A healthy API is insufficient when the SPA/static plugin is broken.
  const home = await fetch(new URL("/", origin), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(home.status, 200, "首页HTTP200");
  checks++;
  assert.match(
    home.headers.get("content-type") || "",
    /text\/html/,
    "首页HTML类型",
  );
  checks++;
  const html = await home.text();
  assert.match(html, /<div[^>]+id=["']root["']/, "首页包含React挂载点");
  checks++;
  const assets = [
    ...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))["']/g),
  ].map((match) => match[1]);
  assert.ok(
    assets.some((asset) => asset.endsWith(".js")),
    "首页引用JS",
  );
  assert.ok(
    assets.some((asset) => asset.endsWith(".css")),
    "首页引用CSS",
  );
  checks++;
  for (const asset of new Set(assets)) {
    const url = new URL(asset, origin);
    assert.equal(url.origin, origin.origin, "资源来自本站");
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, "静态资源HTTP200");
    assert.match(
      response.headers.get("content-type") || "",
      asset.endsWith(".css") ? /text\/css/ : /javascript/,
      "静态资源类型",
    );
    assert.ok((await response.text()).length > 0, "静态资源非空");
    checks++;
  }
  const spa = await fetch(
    new URL("/s/00000000-0000-4000-8000-000000000000", origin),
    {
      signal: AbortSignal.timeout(5000),
    },
  );
  assert.equal(spa.status, 200, "SPA深层链接HTTP200");
  assert.match(spa.headers.get("content-type") || "", /text\/html/);
  checks++;
  const created = await request("/api/spaces", {
    method: "POST",
    body: {
      ownerToken,
      retentionSeconds: 1800,
      page: { id: pageId, payload: encrypted("acceptance-v1 中文 😀") },
    },
    expected: 201,
  });
  spaceId = created.id;
  assert.equal(created.role, "owner");
  assert.equal(
    plaintext(created.pages[0].payload).text,
    "acceptance-v1 中文 😀",
  );
  checks++;
  const path = `/api/spaces/${spaceId}`;
  await request(path, { expected: 401 });
  const firstRevision = created.pages[0].revision;
  const updated = await request(`${path}/pages/${pageId}`, {
    method: "PUT",
    token: ownerToken,
    body: {
      expectedRevision: firstRevision,
      payload: encrypted("acceptance-v2"),
    },
  });
  assert.equal(updated.revision, firstRevision + 1);
  checks++;
  await request(`${path}/pages/${pageId}`, {
    method: "PUT",
    token: ownerToken,
    body: { expectedRevision: firstRevision, payload: encrypted("stale") },
    expected: 409,
  });
  const share = await request(`${path}/shares`, {
    method: "POST",
    token: ownerToken,
    expected: 201,
  });
  const read = await request(path, { token: share.token });
  assert.equal(read.role, "reader");
  assert.equal(plaintext(read.pages[0].payload).text, "acceptance-v2");
  checks++;
  await request(`${path}/pages/${pageId}`, {
    method: "PUT",
    token: share.token,
    body: {
      expectedRevision: updated.revision,
      payload: encrypted("forbidden"),
    },
    expected: 403,
  });
  await request(`${path}/shares`, {
    method: "DELETE",
    token: ownerToken,
    expected: 204,
  });
  await request(path, { token: share.token, expected: 401 });
  const finalView = await request(path, { token: ownerToken });
  assert.equal(plaintext(finalView.pages[0].payload).text, "acceptance-v2");
  checks++;
  if (process.env.ACCEPTANCE_RESTART === "1") {
    await promisify(execFile)("docker", ["compose", "restart", "app"], {
      cwd: new URL("../", import.meta.url),
      timeout: 30000,
    });
    let recovered;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        const response = await fetch(new URL(path, origin), {
          headers: { authorization: `Bearer ${ownerToken}` },
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          recovered = await response.json();
          break;
        }
      } catch {
        /* application is restarting */
      }
      await delay(250);
    }
    assert.ok(recovered, "容器重启后空间可读取");
    assert.equal(plaintext(recovered.pages[0].payload).text, "acceptance-v2");
    checks++;
    console.log("PASS: 同一生产容器重启后密文与访问权限保持，未删除数据卷。");
  }
  console.log(`PASS: ${checks}项本地页面/资源/API/权限/加密/冲突检查。`);
} catch (error) {
  console.error(`FAIL: ${error instanceof Error ? error.message : "验收异常"}`);
  process.exitCode = 1;
} finally {
  if (spaceId) {
    try {
      await request(`/api/spaces/${spaceId}`, {
        method: "DELETE",
        token: ownerToken,
        expected: 204,
      });
      console.log("验收合成空间已清理。");
    } catch {
      console.error("验收合成空间未能清理；可等待30分钟自动过期。");
      process.exitCode = 1;
    }
  }
}
