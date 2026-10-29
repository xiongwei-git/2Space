import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
const token = () => randomBytes(32).toString("base64url");
const payload = () => ({
  iv: randomBytes(12).toString("base64url"),
  ciphertext: randomBytes(48).toString("base64url"),
});
const auth = (value: string) => ({ authorization: `Bearer ${value}` });
const grant = () => ({
  token: token(),
  keyEnvelope: payload(),
  ownerEnvelope: payload(),
});
async function create(
  app: Awaited<ReturnType<typeof buildApp>>,
  name?: string,
) {
  const owner = token();
  const response = await app.inject({
    method: "POST",
    url: "/api/spaces",
    payload: {
      ownerToken: owner,
      retentionSeconds: 1800,
      page: { id: randomUUID(), payload: payload() },
      ...(name === undefined ? {} : { name }),
    },
  });
  assert.equal(response.statusCode, 201, response.body);
  return { owner, view: response.json() };
}
test("named space requires authorization, rejects conflicts/reserved names, and expires before reuse", async () => {
  let clock = Date.now();
  const app = await buildApp({
    dbPath: ":memory:",
    now: () => clock,
    cleanupIntervalMs: 0,
  });
  try {
    const { owner, view } = await create(app, "hello-world");
    assert.equal(view.name, "hello-world");
    assert.equal(
      (await app.inject("/api/spaces/by-name/hello-world")).statusCode,
      401,
    );
    const found = await app.inject({
      url: "/api/spaces/by-name/hello-world",
      headers: auth(owner),
    });
    assert.equal(found.json().id, view.id);
    const base = {
      ownerToken: token(),
      retentionSeconds: 1800,
      page: { id: randomUUID(), payload: payload() },
    };
    for (const name of [
      "api",
      "API",
      "assets",
      "a/b",
      "中文",
      "a b",
      "",
      "x".repeat(65),
    ]) {
      const bad = await app.inject({
        method: "POST",
        url: "/api/spaces",
        payload: { ...base, name },
      });
      assert.equal(bad.statusCode, 422);
    }
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/spaces",
      payload: { ...base, name: "hello-world" },
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error.code, "NAME_TAKEN");
    clock += 1800_001;
    const reused = await create(app, "hello-world");
    assert.notEqual(reused.view.id, view.id);
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${view.id}`,
          headers: auth(owner),
        })
      ).statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
test("legacy space can bind once without renewing expiry or changing plaintext time", async () => {
  let clock = Date.now();
  const app = await buildApp({
    dbPath: ":memory:",
    now: () => clock,
    cleanupIntervalMs: 0,
  });
  try {
    const { owner, view } = await create(app);
    clock += 20_000;
    const bind = await app.inject({
      method: "PATCH",
      url: `/api/spaces/${view.id}`,
      headers: auth(owner),
      payload: { name: "bound-name" },
    });
    assert.equal(bind.statusCode, 200, bind.body);
    assert.equal(bind.json().expiresAt, view.expiresAt);
    assert.equal(bind.json().updatedAt, view.updatedAt);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/spaces/${view.id}`,
          headers: auth(owner),
          payload: { name: "bound-name" },
        })
      ).statusCode,
      200,
    );
    const locked = await app.inject({
      method: "PATCH",
      url: `/api/spaces/${view.id}`,
      headers: auth(owner),
      payload: { name: "another-name" },
    });
    assert.equal(locked.statusCode, 409);
    assert.equal(locked.json().error.code, "NAME_LOCKED");
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/spaces/${view.id}`,
          headers: auth(owner),
          payload: {},
        })
      ).statusCode,
      422,
    );
  } finally {
    await app.close();
  }
});
test("compact create-or-get is stable across parallel requests; replace and revoke enforce permissions", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const { owner, view } = await create(app, "compact-space");
    const url = `/api/spaces/${view.id}/shares`;
    assert.deepEqual((await app.inject({ url, headers: auth(owner) })).json(), {
      share: null,
    });
    const grants = [grant(), grant(), grant()];
    const responses = await Promise.all(
      grants.map((value) =>
        app.inject({
          method: "POST",
          url,
          headers: auth(owner),
          payload: value,
        }),
      ),
    );
    assert.deepEqual(
      responses.map((x) => x.statusCode),
      [201, 200, 200],
    );
    for (const response of responses)
      assert.deepEqual(response.json(), {
        share: {
          keyEnvelope: grants[0].keyEnvelope,
          ownerEnvelope: grants[0].ownerEnvelope,
        },
      });
    const reader = await app.inject({
      url: `/api/spaces/by-name/compact-space`,
      headers: auth(grants[0].token),
    });
    assert.equal(reader.statusCode, 200);
    assert.deepEqual(reader.json().readerKey, grants[0].keyEnvelope);
    assert.equal(reader.json().ownerEnvelope, undefined);
    assert.equal(
      (await app.inject({ url, headers: auth(grants[0].token) })).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${view.id}`,
          headers: auth(grants[1].token),
        })
      ).statusCode,
      401,
    );
    const legacy = await app.inject({
      method: "POST",
      url,
      headers: auth(owner),
    });
    assert.equal(legacy.statusCode, 201);
    const legacyToken = legacy.json().token;
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${view.id}`,
          headers: auth(legacyToken),
        })
      ).json().readerKey,
      undefined,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${view.id}`,
          headers: auth(grants[0].token),
        })
      ).statusCode,
      200,
    );
    const replacement = grant();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: auth(owner),
          payload: { ...replacement, replace: true },
        })
      ).statusCode,
      201,
    );
    for (const invalid of [legacyToken, grants[0].token])
      assert.equal(
        (
          await app.inject({
            url: `/api/spaces/${view.id}`,
            headers: auth(invalid),
          })
        ).statusCode,
        401,
      );
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${view.id}`,
          headers: auth(replacement.token),
        })
      ).statusCode,
      200,
    );
    await app.inject({ method: "DELETE", url, headers: auth(owner) });
    assert.equal(
      (
        await app.inject({
          url: `/api/spaces/${view.id}`,
          headers: auth(replacement.token),
        })
      ).statusCode,
      401,
    );
    assert.deepEqual((await app.inject({ url, headers: auth(owner) })).json(), {
      share: null,
    });
  } finally {
    await app.close();
  }
});
test("real v1 database migrates additively and compact descriptor survives restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "2space-migration-"));
  const path = join(directory, "legacy.sqlite");
  const owner = token(),
    reader = token(),
    id = randomUUID(),
    pageId = randomUUID(),
    encrypted = payload(),
    timestamp = new Date().toISOString(),
    expires = new Date(Date.now() + 1800_000).toISOString();
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE spaces(id TEXT PRIMARY KEY,owner_hash TEXT NOT NULL,reader_hash TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL,retention_seconds INTEGER NOT NULL); CREATE TABLE pages(id TEXT NOT NULL,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 1,iv TEXT NOT NULL,ciphertext TEXT NOT NULL,updated_at TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(space_id,id));",
  );
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  db.prepare("INSERT INTO spaces VALUES(?,?,?,1,?,?,?,1800)").run(
    id,
    hash(owner),
    hash(reader),
    timestamp,
    timestamp,
    expires,
  );
  db.prepare("INSERT INTO pages VALUES(?,?,1,?,?,?,0)").run(
    pageId,
    id,
    encrypted.iv,
    encrypted.ciphertext,
    timestamp,
  );
  db.close();
  let app = await buildApp({ dbPath: path, cleanupIntervalMs: 0 });
  try {
    const migrated = await app.inject({
      url: `/api/spaces/${id}`,
      headers: auth(owner),
    });
    assert.equal(migrated.statusCode, 200);
    assert.equal(migrated.json().accessMode, "private");
    assert.equal(migrated.json().publicKey, undefined);
    assert.equal(migrated.json().passwordProtected, false);
    assert.deepEqual(migrated.json().pages[0].payload, encrypted);
    assert.equal(
      (await app.inject({ url: `/api/spaces/${id}`, headers: auth(reader) }))
        .statusCode,
      200,
    );
    const value = grant();
    await app.inject({
      method: "PATCH",
      url: `/api/spaces/${id}`,
      headers: auth(owner),
      payload: { name: "legacy-bound" },
    });
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/spaces/${id}/shares`,
          headers: auth(owner),
          payload: value,
        })
      ).statusCode,
      201,
    );
    await app.close();
    app = await buildApp({ dbPath: path, cleanupIntervalMs: 0 });
    assert.deepEqual(
      (
        await app.inject({
          url: `/api/spaces/${id}/shares`,
          headers: auth(owner),
        })
      ).json(),
      {
        share: {
          keyEnvelope: value.keyEnvelope,
          ownerEnvelope: value.ownerEnvelope,
        },
      },
    );
    const reopened = await app.inject({
      url: "/api/spaces/by-name/legacy-bound",
      headers: auth(value.token),
    });
    assert.equal(reopened.statusCode, 200);
    assert.deepEqual(reopened.json().readerKey, value.keyEnvelope);
    assert.deepEqual(reopened.json().pages[0].payload, encrypted);
    assert.equal(
      (await app.inject({ url: `/api/spaces/${id}`, headers: auth(reader) }))
        .statusCode,
      200,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("modern replacement and revoke close both legacy and compact reader SSE", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const { owner, view } = await create(app, "sse-named");
    const url = `/api/spaces/${view.id}/shares`;
    const first = grant();
    await app.inject({
      method: "POST",
      url,
      headers: auth(owner),
      payload: first,
    });
    const legacy = await app.inject({
      method: "POST",
      url,
      headers: auth(owner),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const open = async (access: string) => {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/spaces/${view.id}/events`,
        { headers: auth(access) },
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
            () => reject(new Error("reader stream was not closed")),
            1000,
          ).unref(),
        ),
      ]);
      assert.equal(result.done, true);
    };
    let modernStream = await open(first.token),
      legacyStream = await open(legacy.json().token);
    const second = grant();
    await app.inject({
      method: "POST",
      url,
      headers: auth(owner),
      payload: { ...second, replace: true },
    });
    await Promise.all([closed(modernStream), closed(legacyStream)]);
    const legacy2 = await app.inject({
      method: "POST",
      url,
      headers: auth(owner),
    });
    modernStream = await open(second.token);
    legacyStream = await open(legacy2.json().token);
    await app.inject({ method: "DELETE", url, headers: auth(owner) });
    await Promise.all([closed(modernStream), closed(legacyStream)]);
  } finally {
    await app.close();
  }
});

test("share envelopes have bounded sizes and name-only binding is owner-only", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const { owner, view } = await create(app);
    const url = `/api/spaces/${view.id}/shares`;
    const value = grant();
    const keyBad = {
      ...value,
      keyEnvelope: {
        ...value.keyEnvelope,
        ciphertext: randomBytes(49).toString("base64url"),
      },
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: auth(owner),
          payload: keyBad,
        })
      ).statusCode,
      422,
    );
    const ownerBad = {
      ...value,
      ownerEnvelope: {
        ...value.ownerEnvelope,
        ciphertext: randomBytes(1025).toString("base64url"),
      },
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: auth(owner),
          payload: ownerBad,
        })
      ).statusCode,
      422,
    );
    const created = await app.inject({
      method: "POST",
      url,
      headers: auth(owner),
      payload: value,
    });
    assert.equal(created.statusCode, 201);
    assert.equal(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/spaces/${view.id}`,
          headers: auth(value.token),
          payload: { name: "not-owner" },
        })
      ).statusCode,
      403,
    );
    const before = await app.inject({
      url: `/api/spaces/${view.id}`,
      headers: auth(owner),
    });
    assert.equal(before.json().readerKey, undefined);
    assert.equal(before.json().expiresAt, view.expiresAt);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: auth(value.token),
          payload: { ...grant(), replace: true },
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
  }
});
