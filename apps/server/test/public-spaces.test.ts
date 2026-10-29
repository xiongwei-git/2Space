import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
const token = () => randomBytes(32).toString("base64url");
const payload = () => ({
  iv: randomBytes(12).toString("base64url"),
  ciphertext: randomBytes(48).toString("base64url"),
});
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const cookie = (r: { headers: Record<string, unknown> }) =>
  String(r.headers["set-cookie"]).split(";")[0];
async function create(
  app: Awaited<ReturnType<typeof buildApp>>,
  privateMode = false,
) {
  const owner = token(),
    key = token(),
    pageId = randomUUID();
  const r = await app.inject({
    method: "POST",
    url: "/api/spaces",
    payload: {
      ownerToken: owner,
      name: `Test_${randomBytes(6).toString("hex")}`,
      page: { id: pageId, payload: payload() },
      ...(!privateMode ? { accessMode: "public", publicKey: key } : {}),
    },
  });
  assert.equal(r.statusCode, 201, r.body);
  return { owner, key, pageId, view: r.json() };
}
test("public is explicit, name-addressable and permanent; private never exposes publicKey", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const pub = await create(app);
    assert.equal(pub.view.accessMode, "public");
    assert.equal(pub.view.retentionSeconds, 0);
    assert.equal(pub.view.expiresAt, null);
    const found = await app.inject(`/api/spaces/by-name/${pub.view.name}`);
    assert.equal(found.statusCode, 200);
    assert.equal(found.json().publicKey, pub.key);
    const saved = await app.inject({
      method: "PUT",
      url: `/api/spaces/${pub.view.id}/pages/${pub.pageId}`,
      payload: { expectedRevision: 1, payload: payload() },
    });
    assert.equal(saved.statusCode, 200);
    const priv = await create(app, true);
    assert.equal(priv.view.accessMode, "private");
    assert.equal(priv.view.retentionSeconds, 86400);
    assert.equal(priv.view.publicKey, undefined);
    assert.equal(
      (await app.inject(`/api/spaces/by-name/${priv.view.name}`)).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${priv.view.id}`,
          headers: auth(priv.owner),
        })
      ).json().publicKey,
      undefined,
    );
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/spaces/${priv.view.id}`,
          headers: auth(priv.owner),
          payload: { accessMode: "public", publicKey: priv.key },
        })
      ).statusCode,
      422,
    );
  } finally {
    await app.close();
  }
});
test("13 retention options, visits and full ordering preserve main page and do not renew", async () => {
  let clock = Date.now();
  const app = await buildApp({
    dbPath: ":memory:",
    now: () => clock,
    cleanupIntervalMs: 0,
  });
  try {
    const { view, pageId } = await create(app);
    for (const seconds of [
      0, 1800, 3600, 21600, 86400, 259200, 604800, 2592000, 7776000, 15552000,
      31536000, 63072000, 94608000,
    ]) {
      const r = await app.inject({
        method: "PATCH",
        url: `/api/spaces/${view.id}`,
        payload: { retentionSeconds: seconds },
      });
      assert.equal(r.statusCode, 200);
      assert.equal(r.json().retentionSeconds, seconds);
    }
    await app.inject({
      method: "PATCH",
      url: `/api/spaces/${view.id}`,
      payload: { retentionSeconds: 1800 },
    });
    const ids = [pageId, randomUUID(), randomUUID()];
    for (const id of ids.slice(1))
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/spaces/${view.id}/pages`,
            payload: { id, payload: payload() },
          })
        ).statusCode,
        201,
      );
    const before = (await app.inject(`/api/spaces/${view.id}`)).json();
    clock += 30_000;
    const visits = await app.inject({
      method: "POST",
      url: `/api/spaces/${view.id}/visits`,
      payload: {},
    });
    assert.equal(visits.statusCode, 200);
    assert.equal(visits.json().viewCount, 1);
    assert.equal(visits.json().updatedAt, before.updatedAt);
    assert.equal(visits.json().expiresAt, before.expiresAt);
    assert.equal(visits.json().revision, before.revision);
    assert.equal(visits.json().viewerIp, "127.0.0.1");
    const order = await app.inject({
      method: "POST",
      url: `/api/spaces/${view.id}/pages/order`,
      payload: { ids: [ids[0], ids[2], ids[1]] },
    });
    assert.equal(order.statusCode, 200, order.body);
    const after = (await app.inject(`/api/spaces/${view.id}`)).json();
    assert.deepEqual(
      after.pages.map((p: { id: string }) => p.id),
      [ids[0], ids[2], ids[1]],
    );
    assert.equal(after.updatedAt, before.updatedAt);
    assert.equal(after.expiresAt, before.expiresAt);
    for (const bad of [
      [ids[1], ids[0], ids[2]],
      [ids[0], ids[1]],
      [ids[0], ids[1], ids[1]],
    ])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/spaces/${view.id}/pages/order`,
            payload: { ids: bad },
          })
        ).statusCode,
        422,
      );
    const mainDelete = await app.inject({
      method: "DELETE",
      url: `/api/spaces/${view.id}/pages/${pageId}`,
      payload: { expectedRevision: 1 },
    });
    assert.equal(mainDelete.statusCode, 409);
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/spaces/${view.id}/pages/${ids[1]}`,
          payload: { expectedRevision: 1 },
        })
      ).statusCode,
      204,
    );
  } finally {
    await app.close();
  }
});
test("public password requires session for key/content and lock/unlock/change/remove are real", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const { view, key } = await create(app);
    const base = `/api/spaces/${view.id}`;
    const set = await app.inject({
      method: "POST",
      url: base + "/password",
      payload: { password: "test-only-password" },
    });
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().passwordProtected, true);
    const c = cookie(set);
    assert.match(String(set.headers["set-cookie"]), /HttpOnly/);
    assert.match(String(set.headers["set-cookie"]), /SameSite=Strict/);
    assert.match(String(set.headers["set-cookie"]), /Path=\/api\/spaces/);
    const denied = await app.inject(`/api/spaces/by-name/${view.name}`);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error.code, "PASSWORD_REQUIRED");
    assert.equal(denied.json().spaceId, view.id);
    assert.equal(denied.json().publicKey, undefined);
    assert.equal(
      (await app.inject({ url: base, headers: { cookie: c } })).json()
        .publicKey,
      key,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/unlock",
          payload: { password: "wrong" },
        })
      ).json().error.code,
      "PASSWORD_INCORRECT",
    );
    await app.inject({
      method: "POST",
      url: base + "/lock",
      headers: { cookie: c },
    });
    assert.equal(
      (await app.inject({ url: base, headers: { cookie: c } })).statusCode,
      401,
    );
    const unlocked = await app.inject({
      method: "POST",
      url: base + "/unlock",
      payload: { password: "test-only-password" },
    });
    assert.equal(unlocked.statusCode, 204);
    const c2 = cookie(unlocked);
    const changed = await app.inject({
      method: "POST",
      url: base + "/password",
      headers: { cookie: c2 },
      payload: { password: "changed-test-password" },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(
      (await app.inject({ url: base, headers: { cookie: c2 } })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/unlock",
          payload: { password: "test-only-password" },
        })
      ).statusCode,
      403,
    );
    const clear = await app.inject({
      method: "POST",
      url: base + "/password",
      headers: { cookie: cookie(changed) },
      payload: { password: "" },
    });
    assert.equal(clear.statusCode, 200);
    assert.equal(clear.json().passwordProtected, false);
    assert.equal((await app.inject(base)).statusCode, 200);
  } finally {
    await app.close();
  }
});
test("private password sessions are bound to valid capabilities and expire after thirty minutes", async () => {
  let clock = Date.now();
  const app = await buildApp({
    dbPath: ":memory:",
    now: () => clock,
    cleanupIntervalMs: 0,
  });
  try {
    const { owner, view } = await create(app, true);
    const base = `/api/spaces/${view.id}`;
    const share = await app.inject({
      method: "POST",
      url: base + "/shares",
      headers: auth(owner),
    });
    const reader = share.json().token;
    const set = await app.inject({
      method: "POST",
      url: base + "/password",
      headers: auth(owner),
      payload: { password: "private-test" },
    });
    assert.equal(set.statusCode, 200);
    const c = cookie(set);
    assert.equal(
      (
        await app.inject({ url: base, headers: { ...auth(reader), cookie: c } })
      ).json().error.code,
      "PASSWORD_REQUIRED",
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/unlock",
          payload: { password: "private-test" },
        })
      ).statusCode,
      401,
    );
    const unlockReader = await app.inject({
      method: "POST",
      url: base + "/unlock",
      headers: auth(reader),
      payload: { password: "private-test" },
    });
    assert.equal(unlockReader.statusCode, 204);
    const cr = cookie(unlockReader);
    assert.equal(
      (
        await app.inject({
          url: base,
          headers: { ...auth(reader), cookie: cr },
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/password",
          headers: { ...auth(reader), cookie: cr },
          payload: { password: "changed" },
        })
      ).statusCode,
      403,
    );
    clock += 1800_001;
    assert.equal(
      (
        await app.inject({ url: base, headers: { ...auth(owner), cookie: c } })
      ).json().error.code,
      "PASSWORD_REQUIRED",
    );
    assert.equal(
      (
        await app.inject({
          url: base,
          headers: { ...auth(reader), cookie: cr },
        })
      ).statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});

test("password updates and cookie-only lock immediately close protected SSE", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const { view } = await create(app);
    const base = `/api/spaces/${view.id}`;
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const open = async (c?: string) => {
      const response = await fetch(
        `http://127.0.0.1:${address.port}${base}/events`,
        { headers: c ? { cookie: c } : {} },
      );
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      await reader.read();
      return reader;
    };
    const closed = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("password stream did not close")),
            1000,
          ).unref(),
        ),
      ]);
      assert.equal(result.done, true);
    };
    const before = await open();
    const set = await app.inject({
      method: "POST",
      url: base + "/password",
      payload: { password: "sse-password" },
    });
    assert.equal(set.statusCode, 200);
    await closed(before);
    const c = cookie(set),
      protectedStream = await open(c);
    const locked = await app.inject({
      method: "POST",
      url: base + "/lock",
      headers: { cookie: c },
    });
    assert.equal(locked.statusCode, 204);
    await closed(protectedStream);
    const denied = await app.inject(base + "/events");
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json().error.code, "PASSWORD_REQUIRED");
  } finally {
    await app.close();
  }
});

test("names accept one to sixty-four case-sensitive characters while reserved names stay forbidden", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    for (const name of ["x", "X", "_", "-", "Mixed_Name-123", "n".repeat(64)]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/spaces",
        payload: {
          ownerToken: token(),
          name,
          page: { id: randomUUID(), payload: payload() },
        },
      });
      assert.equal(response.statusCode, 201);
      assert.equal(response.json().name, name);
    }
    for (const name of ["API", "Assets", "Privacy", "S", "a/b", "n".repeat(65)])
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/spaces",
            payload: {
              ownerToken: token(),
              name,
              page: { id: randomUUID(), payload: payload() },
            },
          })
        ).statusCode,
        422,
      );
  } finally {
    await app.close();
  }
});

test("public/password persistence stores scrypt hash and salt but no plaintext password or session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "2space-password-")),
    dbPath = join(directory, "state.sqlite");
  let app = await buildApp({ dbPath, cleanupIntervalMs: 0 });
  try {
    const { view, key } = await create(app),
      base = `/api/spaces/${view.id}`;
    const set = await app.inject({
      method: "POST",
      url: base + "/password",
      payload: { password: "persisted-password-test-only" },
    });
    assert.equal(set.statusCode, 200);
    const oldCookie = cookie(set);
    await app.close();
    const db = new DatabaseSync(dbPath);
    const row = db
      .prepare(
        "SELECT password_hash,password_salt,access_mode,public_key FROM spaces WHERE id=?",
      )
      .get(view.id) as {
      password_hash: string;
      password_salt: string;
      access_mode: string;
      public_key: string;
    };
    assert.match(row.password_hash, /^[0-9a-f]{128}$/);
    assert.equal(Buffer.from(row.password_salt, "base64url").length, 16);
    assert.equal(row.access_mode, "public");
    assert.equal(row.public_key, key);
    db.close();
    assert.equal(
      (await readFile(dbPath)).includes(
        Buffer.from("persisted-password-test-only"),
      ),
      false,
    );
    app = await buildApp({ dbPath, cleanupIntervalMs: 0 });
    assert.equal(
      (await app.inject({ url: base, headers: { cookie: oldCookie } }))
        .statusCode,
      401,
    );
    const unlocked = await app.inject({
      method: "POST",
      url: base + "/unlock",
      payload: { password: "persisted-password-test-only" },
    });
    assert.equal(unlocked.statusCode, 204);
    const restored = await app.inject({
      url: base,
      headers: { cookie: cookie(unlocked) },
    });
    assert.equal(restored.json().publicKey, key);
    assert.equal(restored.json().expiresAt, null);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("retention changes use last saved content time and can immediately expire an old space", async () => {
  let clock = Date.now();
  const app = await buildApp({
    dbPath: ":memory:",
    now: () => clock,
    cleanupIntervalMs: 0,
  });
  try {
    const { view } = await create(app);
    clock += 3600_000;
    const changed = await app.inject({
      method: "PATCH",
      url: `/api/spaces/${view.id}`,
      payload: { retentionSeconds: 1800 },
    });
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().updatedAt, view.updatedAt);
    assert.equal(
      changed.json().expiresAt,
      new Date(Date.parse(view.updatedAt) + 1800_000).toISOString(),
    );
    assert.equal((await app.inject(`/api/spaces/${view.id}`)).statusCode, 404);
  } finally {
    await app.close();
  }
});

test("password changes do not renew content and wrong passwords are rate-limited", async () => {
  let clock = Date.now();
  const app = await buildApp({
    dbPath: ":memory:",
    now: () => clock,
    cleanupIntervalMs: 0,
  });
  try {
    const { view } = await create(app);
    const base = `/api/spaces/${view.id}`;
    clock += 15_000;
    const set = await app.inject({
      method: "POST",
      url: base + "/password",
      payload: { password: "rate-limit-test" },
    });
    assert.equal(set.statusCode, 200);
    assert.equal(set.json().updatedAt, view.updatedAt);
    assert.equal(set.json().expiresAt, null);
    for (let index = 0; index < 20; index++) {
      const wrong = await app.inject({
        method: "POST",
        url: base + "/unlock",
        payload: { password: "incorrect-test" },
      });
      assert.equal(wrong.statusCode, 403);
    }
    const limited = await app.inject({
      method: "POST",
      url: base + "/unlock",
      payload: { password: "rate-limit-test" },
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, "RATE_LIMITED");
    clock += 900_001;
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: base + "/unlock",
          payload: { password: "rate-limit-test" },
        })
      ).statusCode,
      204,
    );
  } finally {
    await app.close();
  }
});
