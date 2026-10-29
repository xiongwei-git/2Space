import { test } from "node:test";
import assert from "node:assert/strict";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  hkdfSync,
} from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { buildApp } from "../src/app.js";

type Envelope = { iv: string; ciphertext: string };
type View = {
  id: string;
  name: string;
  revision: number;
  keyRevision: number;
  pages: {
    id: string;
    revision: number;
    payload: Envelope;
    updatedAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string | null;
  publicKey?: string;
  protection?: unknown;
  passwordProtected?: boolean;
};
const secret = () => randomBytes(32).toString("base64url");
const descriptor = () => ({
  version: 1,
  kdf: "PBKDF2-SHA256",
  iterations: 600000,
  salt: randomBytes(16).toString("base64url"),
});
const auth = (owner: string) => ({ authorization: `Bearer ${owner}` });
const cookie = (response: { headers: Record<string, unknown> }) =>
  String(response.headers["set-cookie"]).split(";")[0];
function encrypted(text: string, key: string): Envelope {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "base64url"), iv);
  const data = JSON.stringify({
    title: "",
    html: `<p>${text}</p>`,
    text,
    language: "plaintext",
  });
  return {
    iv: iv.toString("base64url"),
    ciphertext: Buffer.concat([
      cipher.update(data),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url"),
  };
}
function decrypted(payload: Envelope, key: string): string {
  const bytes = Buffer.from(payload.ciphertext, "base64url"),
    decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(key, "base64url"),
      Buffer.from(payload.iv, "base64url"),
    );
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(0, -16)),
      decipher.final(),
    ]).toString(),
  ).text;
}
function passwordMaterial(id: string, password: string) {
  const protection = descriptor(),
    root = pbkdf2Sync(
      password,
      Buffer.from(protection.salt, "base64url"),
      600000,
      32,
      "sha256",
    );
  const derive = (purpose: string) =>
    Buffer.from(
      hkdfSync(
        "sha256",
        root,
        Buffer.from(id),
        Buffer.from(`2space/password/v1/${purpose}`),
        32,
      ),
    ).toString("base64url");
  return { protection, key: derive("document"), proof: derive("auth") };
}
async function fixture(privateMode = false) {
  const temp = await mkdtemp(join(tmpdir(), "2space-browser-protection-")),
    dbPath = join(temp, "synthetic.sqlite");
  let clock = Date.now(),
    app = await buildApp({ dbPath, now: () => clock, cleanupIntervalMs: 0 });
  const owner = secret(),
    key = secret(),
    pageId = randomUUID();
  const response = await app.inject({
    method: "POST",
    url: "/api/spaces",
    payload: {
      name: `protect_${randomBytes(6).toString("hex")}`,
      ownerToken: owner,
      retentionSeconds: 1800,
      ...(!privateMode ? { accessMode: "public", publicKey: key } : {}),
      page: { id: pageId, payload: encrypted("合成原稿", key) },
    },
  });
  assert.equal(response.statusCode, 201);
  const view = response.json<View>();
  function inspect() {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return {
        space: db.prepare("SELECT * FROM spaces WHERE id=?").get(view.id)!,
        pages: db
          .prepare("SELECT * FROM pages WHERE space_id=? ORDER BY position")
          .all(view.id),
      };
    } finally {
      db.close();
    }
  }
  return {
    get app() {
      return app;
    },
    owner,
    key,
    pageId,
    view,
    inspect,
    advance: (ms: number) => {
      clock += ms;
    },
    restart: async () => {
      await app.close();
      app = await buildApp({ dbPath, now: () => clock, cleanupIntervalMs: 0 });
    },
    close: async () => {
      await app.close();
      await rm(temp, { recursive: true, force: true });
    },
  };
}
function change(
  view: View,
  key: string,
  protection: ReturnType<typeof descriptor> | null,
  proof?: string,
) {
  return {
    expectedRevision: view.revision,
    expectedKeyRevision: view.keyRevision,
    protection,
    ...(protection ? { proof } : { publicKey: key }),
    pages: view.pages.map((page, index) => ({
      id: page.id,
      expectedRevision: page.revision,
      payload: encrypted(`合成转换稿${index}`, key),
    })),
  };
}

test("browser-password storage removes the server document key and challenge reveals only KDF parameters", async () => {
  const f = await fixture();
  try {
    await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/pages`,
      payload: { id: randomUUID(), payload: encrypted("合成第二页", f.key) },
    });
    const before = (
        await f.app.inject(`/api/spaces/${f.view.id}`)
      ).json<View>(),
      material = passwordMaterial(before.id, `synthetic-${randomUUID()}`);
    f.advance(5000);
    const response = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${before.id}/protection`,
      payload: change(
        before,
        material.key,
        material.protection,
        material.proof,
      ),
    });
    assert.equal(response.statusCode, 200);
    const after = response.json<View>();
    assert.equal(after.publicKey, undefined);
    assert.deepEqual(after.protection, material.protection);
    assert.equal(after.keyRevision, 1);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.expiresAt, before.expiresAt);
    assert.deepEqual(
      after.pages.map((p) => [p.id, p.updatedAt, p.revision]),
      before.pages.map((p) => [p.id, p.updatedAt, p.revision + 1]),
    );
    const stored = f.inspect();
    assert.equal(stored.space.public_key, null);
    assert.equal(stored.space.protection_version, 1);
    assert.ok(
      stored.space.password_hash !== material.proof,
      "只保存认证proof的单向校验值",
    );
    assert.ok(
      !JSON.stringify(stored).includes(material.key),
      "活动存储不包含正文钥匙",
    );
    assert.ok(
      !JSON.stringify(stored).includes(material.proof),
      "活动存储不包含原始认证proof",
    );
    assert.equal(
      decrypted(after.pages[0].payload, material.key),
      "合成转换稿0",
    );
    assert.throws(
      () => decrypted(after.pages[0].payload, material.proof),
      "认证proof不能解开正文",
    );
    const challenge = await f.app.inject(`/api/spaces/${before.id}/protection`);
    assert.equal(challenge.statusCode, 200);
    assert.deepEqual(challenge.json(), {
      protection: material.protection,
      keyRevision: 1,
    });
    const denied = await f.app.inject(`/api/spaces/${before.id}`);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error.code, "PASSWORD_REQUIRED");
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/spaces/${before.id}/unlock`,
          payload: { password: "synthetic-password" },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/spaces/${before.id}/unlock`,
          payload: { proof: secret() },
        })
      ).statusCode,
      403,
    );
    const unlocked = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${before.id}/unlock`,
      payload: { proof: material.proof },
    });
    assert.equal(unlocked.statusCode, 204);
    assert.equal(
      (
        await f.app.inject({
          url: `/api/spaces/${before.id}`,
          headers: { cookie: cookie(unlocked) },
        })
      ).statusCode,
      200,
    );
    const bypass = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${before.id}/password`,
      headers: { cookie: cookie(response) },
      payload: { password: "" },
    });
    assert.equal(bypass.statusCode, 409);
    assert.equal(bypass.json().error.code, "PROTECTION_REQUIRED");
  } finally {
    await f.close();
  }
});

test("invalid or stale full-space conversions are atomic and preserve every stored field", async () => {
  const f = await fixture();
  try {
    await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/pages`,
      payload: { id: randomUUID(), payload: encrypted("第二页", f.key) },
    });
    const view = (await f.app.inject(`/api/spaces/${f.view.id}`)).json<View>(),
      key = secret(),
      proof = secret(),
      params = descriptor();
    const original = JSON.stringify(f.inspect());
    const request = () => change(view, key, params, proof);
    const variants: { expected: number; body: unknown }[] = [];
    variants.push({
      expected: 409,
      body: { ...request(), expectedRevision: view.revision + 1 },
    });
    variants.push({
      expected: 409,
      body: { ...request(), expectedKeyRevision: 1 },
    });
    variants.push({
      expected: 409,
      body: { ...request(), pages: request().pages.slice(0, 1) },
    });
    variants.push({ expected: 422, body: { ...request(), pages: [] } });
    variants.push({
      expected: 422,
      body: { ...request(), pages: [request().pages[0], request().pages[0]] },
    });
    const stale = request();
    stale.pages[1].expectedRevision++;
    variants.push({ expected: 409, body: stale });
    const old = request();
    old.pages[1].payload = view.pages[0].payload;
    variants.push({ expected: 422, body: old });
    const duplicateIv = request();
    duplicateIv.pages[1].payload.iv = duplicateIv.pages[0].payload.iv;
    variants.push({ expected: 422, body: duplicateIv });
    variants.push({
      expected: 422,
      body: { ...request(), protection: { ...params, iterations: 1 } },
    });
    variants.push({
      expected: 422,
      body: {
        ...request(),
        protection: { ...params, salt: params.salt + "=" },
      },
    });
    variants.push({ expected: 422, body: { ...request(), publicKey: key } });
    variants.push({
      expected: 422,
      body: { ...request(), password: "never-accepted" },
    });
    for (const [index, variant] of variants.entries()) {
      const response = await f.app.inject({
        method: "POST",
        url: `/api/spaces/${view.id}/protection`,
        payload: variant.body as Record<string, unknown>,
      });
      assert.equal(
        response.statusCode,
        variant.expected,
        `invalid conversion ${index}`,
      );
      assert.ok(
        JSON.stringify(f.inspect()) === original,
        `invalid conversion ${index} leaves all records intact`,
      );
    }
    const valid = request();
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        f.app.inject({
          method: "POST",
          url: `/api/spaces/${view.id}/protection`,
          payload: valid,
        }),
      ),
    );
    assert.deepEqual(
      [first.statusCode, second.statusCode].sort(),
      [200, 401],
      "首个转换后撤销匿名会话，第二个请求不能覆盖",
    );
    assert.equal(f.inspect().space.key_revision, 1);
  } finally {
    await f.close();
  }
});

test("changing and removing protection revoke old sessions and reject stale-generation page writes", async () => {
  const f = await fixture();
  try {
    const firstKey = secret(),
      firstProof = secret();
    const first = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/protection`,
      payload: change(f.view, firstKey, descriptor(), firstProof),
    });
    assert.equal(first.statusCode, 200);
    const oldSession = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/unlock`,
      payload: { proof: firstProof },
    });
    const firstView = first.json<View>(),
      secondKey = secret(),
      secondProof = secret();
    const second = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/protection`,
      headers: { cookie: cookie(first) },
      payload: change(firstView, secondKey, descriptor(), secondProof),
    });
    assert.equal(second.statusCode, 200);
    assert.equal(
      (
        await f.app.inject({
          url: `/api/spaces/${f.view.id}`,
          headers: { cookie: cookie(oldSession) },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/spaces/${f.view.id}/unlock`,
          payload: { proof: firstProof },
        })
      ).statusCode,
      403,
    );
    const login = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/unlock`,
      payload: { proof: secondProof },
    });
    assert.equal(login.statusCode, 204);
    const session = { cookie: cookie(login) };
    for (const keyRevision of [undefined, 0, 1]) {
      const failed = await f.app.inject({
        method: "PUT",
        url: `/api/spaces/${f.view.id}/pages/${f.pageId}`,
        headers: session,
        payload: {
          expectedRevision: 3,
          payload: encrypted("旧写入", firstKey),
          ...(keyRevision === undefined ? {} : { keyRevision }),
        },
      });
      assert.equal(failed.statusCode, 409);
      assert.equal(failed.json().error.code, "KEY_CHANGED");
      assert.equal(failed.json().spaceId, f.view.id);
    }
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/spaces/${f.view.id}/pages`,
          headers: session,
          payload: { id: randomUUID(), payload: encrypted("旧新增", firstKey) },
        })
      ).statusCode,
      409,
    );
    const added = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/pages`,
      headers: session,
      payload: {
        id: randomUUID(),
        keyRevision: 2,
        payload: encrypted("新新增", secondKey),
      },
    });
    assert.equal(added.statusCode, 201);
    const beforeRemoval = (
        await f.app.inject({
          url: `/api/spaces/${f.view.id}`,
          headers: session,
        })
      ).json<View>(),
      publicKey = secret();
    const removed = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/protection`,
      headers: session,
      payload: change(beforeRemoval, publicKey, null),
    });
    assert.equal(removed.statusCode, 200);
    const after = removed.json<View>();
    assert.ok(after.publicKey === publicKey);
    assert.equal(after.protection, undefined);
    assert.equal(after.passwordProtected, false);
    assert.equal(after.keyRevision, 3);
    assert.equal(after.updatedAt, beforeRemoval.updatedAt);
    assert.equal(after.expiresAt, beforeRemoval.expiresAt);
    assert.equal(f.inspect().space.password_hash, null);
    assert.equal(f.inspect().space.protection_salt, null);
    const downgrade = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/password`,
      payload: { password: "legacy-password" },
    });
    assert.equal(downgrade.statusCode, 409);
    assert.equal(downgrade.json().error.code, "PROTECTION_REQUIRED");
    assert.equal(
      (await f.app.inject(`/api/spaces/${f.view.id}`)).statusCode,
      200,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PUT",
          url: `/api/spaces/${f.view.id}/pages/${f.pageId}`,
          payload: {
            expectedRevision: after.pages[0].revision,
            keyRevision: 2,
            payload: encrypted("旧明钥写入", secondKey),
          },
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "PUT",
          url: `/api/spaces/${f.view.id}/pages/${f.pageId}`,
          payload: {
            expectedRevision: after.pages[0].revision,
            keyRevision: 3,
            payload: encrypted("当前写入", publicKey),
          },
        })
      ).statusCode,
      200,
    );
    assert.deepEqual(
      (await f.app.inject(`/api/spaces/${f.view.id}/protection`)).json(),
      { protection: null, keyRevision: 3 },
    );
  } finally {
    await f.close();
  }
});

test("legacy private and whole-space password flows remain compatible; public upgrades explicitly", async () => {
  const priv = await fixture(true),
    pub = await fixture();
  try {
    assert.equal(
      (await priv.app.inject(`/api/spaces/${priv.view.id}/protection`))
        .statusCode,
      401,
    );
    assert.deepEqual(
      (
        await priv.app.inject({
          url: `/api/spaces/${priv.view.id}/protection`,
          headers: auth(priv.owner),
        })
      ).json(),
      { protection: null, keyRevision: 0 },
    );
    assert.equal(
      (
        await priv.app.inject({
          method: "POST",
          url: `/api/spaces/${priv.view.id}/protection`,
          headers: auth(priv.owner),
          payload: change(priv.view, secret(), descriptor(), secret()),
        })
      ).statusCode,
      422,
    );
    const password = `synthetic-${randomUUID()}`;
    const privateSet = await priv.app.inject({
      method: "POST",
      url: `/api/spaces/${priv.view.id}/password`,
      headers: auth(priv.owner),
      payload: { password },
    });
    assert.equal(privateSet.statusCode, 200);
    const privateLogin = await priv.app.inject({
      method: "POST",
      url: `/api/spaces/${priv.view.id}/unlock`,
      headers: auth(priv.owner),
      payload: { password },
    });
    assert.equal(privateLogin.statusCode, 204);
    const privateRead = await priv.app.inject({
      url: `/api/spaces/${priv.view.id}`,
      headers: { ...auth(priv.owner), cookie: cookie(privateLogin) },
    });
    assert.equal(privateRead.statusCode, 200);
    assert.equal(privateRead.json().publicKey, undefined);
    const legacySet = await pub.app.inject({
      method: "POST",
      url: `/api/spaces/${pub.view.id}/password`,
      payload: { password },
    });
    assert.equal(legacySet.statusCode, 200);
    const legacyLogin = await pub.app.inject({
      method: "POST",
      url: `/api/spaces/${pub.view.id}/unlock`,
      payload: { password },
    });
    assert.equal(legacyLogin.statusCode, 204);
    const legacyView = (
      await pub.app.inject({
        url: `/api/spaces/${pub.view.id}`,
        headers: { cookie: cookie(legacyLogin) },
      })
    ).json<View>();
    assert.ok(legacyView.publicKey === pub.key);
    assert.equal(legacyView.protection, undefined);
    const upgraded = await pub.app.inject({
      method: "POST",
      url: `/api/spaces/${pub.view.id}/protection`,
      headers: { cookie: cookie(legacyLogin) },
      payload: change(legacyView, secret(), descriptor(), secret()),
    });
    assert.equal(upgraded.statusCode, 200);
    assert.equal(upgraded.json().publicKey, undefined);
  } finally {
    await priv.close();
    await pub.close();
  }
});

test("full six-page conversion has a scoped body limit, survives restart, and respects original expiry", async () => {
  const f = await fixture();
  try {
    for (let i = 1; i < 6; i++)
      assert.equal(
        (
          await f.app.inject({
            method: "POST",
            url: `/api/spaces/${f.view.id}/pages`,
            payload: {
              id: randomUUID(),
              payload: encrypted(`page-${i}`, f.key),
            },
          })
        ).statusCode,
        201,
      );
    const before = (
        await f.app.inject(`/api/spaces/${f.view.id}`)
      ).json<View>(),
      proof = secret(),
      request = change(before, secret(), descriptor(), proof);
    for (const page of request.pages)
      page.payload = {
        iv: randomBytes(12).toString("base64url"),
        ciphertext: randomBytes(400000).toString("base64url"),
      };
    assert.ok(Buffer.byteLength(JSON.stringify(request)) > 3_000_000);
    const protectedResponse = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/protection`,
      payload: request,
    });
    assert.equal(protectedResponse.statusCode, 200);
    assert.equal(protectedResponse.json().expiresAt, before.expiresAt);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/spaces",
          payload: { unsupported: "x".repeat(600000) },
        })
      ).statusCode,
      413,
      "其他路由仍保留原上限",
    );
    await f.restart();
    assert.equal(
      (await f.app.inject(`/api/spaces/${f.view.id}`)).statusCode,
      401,
    );
    const login = await f.app.inject({
      method: "POST",
      url: `/api/spaces/${f.view.id}/unlock`,
      payload: { proof },
    });
    assert.equal(login.statusCode, 204);
    const restored = await f.app.inject({
      url: `/api/spaces/${f.view.id}`,
      headers: { cookie: cookie(login) },
    });
    assert.equal(restored.statusCode, 200);
    assert.equal(restored.json().keyRevision, 1);
    assert.equal(restored.json().pages.length, 6);
    f.advance(1800_001);
    assert.equal(
      (await f.app.inject(`/api/spaces/${f.view.id}/protection`)).statusCode,
      404,
    );
    assert.equal(f.inspect().space, undefined);
  } finally {
    await f.close();
  }
});
