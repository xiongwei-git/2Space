import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("forwarded addresses are ignored by default", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    cleanupIntervalMs: 0,
    rateLimit: 1,
  });
  try {
    for (const [ip, status] of [
      ["198.51.100.1", 200],
      ["198.51.100.2", 429],
    ] as const) {
      const res = await app.inject({
        url: "/api/health",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": ip },
      });
      assert.equal(res.statusCode, status);
    }
  } finally {
    await app.close();
  }
});

test("trusted proxy separates client limits without accepting a spoofed leftmost address", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    cleanupIntervalMs: 0,
    rateLimit: 1,
    trustedProxies: ["127.0.0.1"],
  });
  try {
    for (const [ip, status] of [
      ["198.51.100.1", 200],
      ["198.51.100.2", 200],
      ["203.0.113.9, 198.51.100.1", 429],
    ] as const) {
      const res = await app.inject({
        url: "/api/health",
        remoteAddress: "127.0.0.1",
        headers: { "x-forwarded-for": ip },
      });
      assert.equal(res.statusCode, status);
    }
  } finally {
    await app.close();
  }
});

test("untrusted peers cannot change client limits with forwarded headers", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    cleanupIntervalMs: 0,
    rateLimit: 1,
    trustedProxies: ["127.0.0.1"],
  });
  try {
    for (const [ip, status] of [
      ["198.51.100.1", 200],
      ["198.51.100.2", 429],
    ] as const) {
      const res = await app.inject({
        url: "/api/health",
        remoteAddress: "203.0.113.10",
        headers: { "x-forwarded-for": ip },
      });
      assert.equal(res.statusCode, status);
    }
  } finally {
    await app.close();
  }
});
