import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
const payload = () => ({
  iv: randomBytes(12).toString("base64url"),
  ciphertext: randomBytes(32).toString("base64url"),
});
const token = () => randomBytes(32).toString("base64url");
const auth = (value: string) => ({ authorization: `Bearer ${value}` });
async function fixture(now?: () => number) {
  const app = await buildApp({ dbPath: ":memory:", now, cleanupIntervalMs: 0 });
  const owner = token(),
    pageId = randomUUID();
  const res = await app.inject({
    method: "POST",
    url: "/api/spaces",
    payload: {
      ownerToken: owner,
      retentionSeconds: 1800,
      page: { id: pageId, payload: payload() },
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { app, owner, pageId, id: res.json().id as string };
}
test("owner/reader separation, share rotation/revocation and no query credentials", async () => {
  const { app, owner, id, pageId } = await fixture();
  try {
    assert.equal((await app.inject(`/api/spaces/${id}`)).statusCode, 401);
    const share = await app.inject({
      method: "POST",
      url: `/api/spaces/${id}/shares`,
      headers: auth(owner),
    });
    assert.equal(share.statusCode, 201);
    const reader = share.json().token;
    assert.equal(
      (
        await app.inject({ url: `/api/spaces/${id}`, headers: auth(reader) })
      ).json().role,
      "reader",
    );
    assert.equal(
      (
        await app.inject({
          method: "PUT",
          url: `/api/spaces/${id}/pages/${pageId}`,
          headers: auth(reader),
          payload: { expectedRevision: 1, payload: payload() },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject(`/api/spaces/${id}?token=${owner}`)).statusCode,
      401,
    );
    await app.inject({
      method: "DELETE",
      url: `/api/spaces/${id}/shares`,
      headers: auth(owner),
    });
    assert.equal(
      (await app.inject({ url: `/api/spaces/${id}`, headers: auth(reader) }))
        .statusCode,
      401,
    );
  } finally {
    await app.close();
  }
});
test("revision conflicts do not overwrite saved content", async () => {
  const { app, owner, id, pageId } = await fixture();
  try {
    const next = payload();
    const save = await app.inject({
      method: "PUT",
      url: `/api/spaces/${id}/pages/${pageId}`,
      headers: auth(owner),
      payload: { expectedRevision: 1, payload: next },
    });
    assert.equal(save.statusCode, 200, save.body);
    assert.equal(save.json().revision, 2);
    const conflict = await app.inject({
      method: "PUT",
      url: `/api/spaces/${id}/pages/${pageId}`,
      headers: auth(owner),
      payload: { expectedRevision: 1, payload: payload() },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().currentRevision, 2);
    const view = await app.inject({
      url: `/api/spaces/${id}`,
      headers: auth(owner),
    });
    assert.deepEqual(view.json().pages[0].payload, next);
  } finally {
    await app.close();
  }
});
test("expiry is enforced on access; reads do not renew", async () => {
  let clock = Date.now();
  const { app, owner, id } = await fixture(() => clock);
  try {
    clock += 1800_000;
    assert.equal(
      (await app.inject({ url: `/api/spaces/${id}`, headers: auth(owner) }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
test("strict encrypted envelope and retention validation", async () => {
  const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
  try {
    const base = {
      ownerToken: token(),
      retentionSeconds: 86400,
      page: { id: randomUUID(), payload: payload() },
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/spaces",
          payload: { ...base, plaintext: "leak" },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/spaces",
          payload: { ...base, retentionSeconds: 12 },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/spaces",
          payload: {
            ...base,
            page: {
              ...base.page,
              payload: { iv: "wrong", ciphertext: "hello" },
            },
          },
        })
      ).statusCode,
      422,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/spaces",
          payload: {
            ...base,
            page: {
              ...base.page,
              payload: {
                iv: randomBytes(12).toString("base64url"),
                ciphertext: randomBytes(400001).toString("base64url"),
              },
            },
          },
        })
      ).statusCode,
      413,
    );
  } finally {
    await app.close();
  }
});
test("six page maximum, duplicates and last-page guard", async () => {
  const { app, owner, id, pageId } = await fixture();
  try {
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/spaces/${id}/pages/${pageId}`,
          headers: auth(owner),
          payload: { expectedRevision: 1 },
        })
      ).statusCode,
      409,
    );
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/spaces/${id}/pages`,
            headers: auth(owner),
            payload: { id: randomUUID(), payload: payload() },
          })
        ).statusCode,
        201,
      );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/api/spaces/${id}/pages`,
          headers: auth(owner),
          payload: { id: randomUUID(), payload: payload() },
        })
      ).statusCode,
      409,
    );
  } finally {
    await app.close();
  }
});
test("security headers and delete space authorization", async () => {
  const { app, owner, id } = await fixture();
  try {
    const health = await app.inject("/api/health");
    assert.equal(health.headers["referrer-policy"], "no-referrer");
    assert.equal(health.headers["cache-control"], "no-store");
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/spaces/${id}`,
          headers: auth(owner),
        })
      ).statusCode,
      204,
    );
    assert.equal(
      (await app.inject({ url: `/api/spaces/${id}`, headers: auth(owner) }))
        .statusCode,
      404,
    );
  } finally {
    await app.close();
  }
});
test("SSE delivers revisions and revoked reader streams close immediately", async () => {
  const { app, owner, id, pageId } = await fixture();
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const share = await app.inject({
      method: "POST",
      url: `/api/spaces/${id}/shares`,
      headers: auth(owner),
    });
    const controller = new AbortController();
    const response = await fetch(`${base}/api/spaces/${id}/events`, {
      headers: auth(share.json().token),
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const initial = await reader.read();
    assert.match(new TextDecoder().decode(initial.value), /event: change/);
    await app.inject({
      method: "PUT",
      url: `/api/spaces/${id}/pages/${pageId}`,
      headers: auth(owner),
      payload: { expectedRevision: 1, payload: payload() },
    });
    const change = await reader.read();
    assert.match(new TextDecoder().decode(change.value), /"revision":3/);
    await app.inject({
      method: "DELETE",
      url: `/api/spaces/${id}/shares`,
      headers: auth(owner),
    });
    const closed = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("revoked SSE did not close")),
          1000,
        ).unref(),
      ),
    ]);
    assert.equal(closed.done, true);
    controller.abort();
  } finally {
    await app.close();
  }
});

test("SQLite survives restart and never stores raw access tokens", async () => {
  const directory = await mkdtemp(join(tmpdir(), "2space-test-"));
  const dbPath = join(directory, "state.sqlite");
  let app = await buildApp({ dbPath, cleanupIntervalMs: 0 });
  const owner = token(),
    pageId = randomUUID(),
    encrypted = payload();
  try {
    const created = await app.inject({
      method: "POST",
      url: "/api/spaces",
      payload: {
        ownerToken: owner,
        retentionSeconds: 86400,
        page: { id: pageId, payload: encrypted },
      },
    });
    assert.equal(created.statusCode, 201);
    const id = created.json().id;
    await app.close();
    app = await buildApp({ dbPath, cleanupIntervalMs: 0 });
    const received = await app.inject({
      url: `/api/spaces/${id}`,
      headers: auth(owner),
    });
    assert.equal(received.statusCode, 200);
    assert.deepEqual(received.json().pages[0].payload, encrypted);
    await app.close();
    assert.equal((await readFile(dbPath)).includes(Buffer.from(owner)), false);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("static serving supports workspace paths without exposing sibling files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "2space-static-"));
  await writeFile(
    join(directory, "index.html"),
    "<!doctype html><title>2Space test</title>",
  );
  await mkdir(join(directory, "assets"));
  const app = await buildApp({
    dbPath: ":memory:",
    webDist: directory,
    cleanupIntervalMs: 0,
  });
  try {
    const home = await app.inject("/");
    assert.equal(home.statusCode, 200, home.body);
    assert.match(home.body, /2Space test/);
    const head = await app.inject({ method: "HEAD", url: "/" });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    const listing = await app.inject("/assets/");
    assert.equal(listing.statusCode, 404);
    assert.equal(listing.json().error.code, "NOT_FOUND");
    const page = await app.inject("/s/11111111-1111-4111-8111-111111111111");
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /2Space test/);
    const namedPage = await app.inject("/my-space");
    assert.equal(namedPage.statusCode, 200);
    assert.match(namedPage.body, /2Space test/);
    const namedHead = await app.inject({ method: "HEAD", url: "/my-space" });
    assert.equal(namedHead.statusCode, 200);
    assert.equal(namedHead.body, "");
    assert.match(String(namedHead.headers["content-type"]), /text\/html/);
    assert.equal(
      (await app.inject({ method: "HEAD", url: "/privacy" })).statusCode,
      404,
    );
    assert.equal(
      (await app.inject({ method: "HEAD", url: "/assets/" })).statusCode,
      404,
    );
    assert.equal((await app.inject("/privacy")).statusCode, 404);
    assert.equal((await app.inject("/Name_With-Caps")).statusCode, 200);
    assert.equal((await app.inject("/api/unknown")).statusCode, 404);
    const traversal = await app.inject("/%2e%2e/%2e%2e/etc/passwd");
    assert.notEqual(traversal.statusCode, 200);
    assert.equal(page.headers["cache-control"], "no-store");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("rate limit rejects excessive traffic with stable error", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    rateLimit: 2,
    cleanupIntervalMs: 0,
  });
  try {
    await app.inject("/api/health");
    await app.inject("/api/health");
    const limited = await app.inject("/api/health");
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, "RATE_LIMITED");
  } finally {
    await app.close();
  }
});
