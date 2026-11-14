import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";

test("WeChat signing accepts only the isolated public share page", async () => {
  let requested = "";
  const app = await buildApp({
    dbPath: ":memory:",
    cleanupIntervalMs: 0,
    wechatFetch: (async (url: string | URL | Request) => {
      requested = String(url);
      return Response.json({
        appId: "wx1234567890abcdef",
        timestamp: 123,
        nonceStr: "nonce",
        signature: "a".repeat(40),
        access_token: "must-not-leak",
      });
    }) as typeof fetch,
  });
  try {
    for (const url of [
      "https://evil.example/",
      "https://2space.cn/secret",
      "https://2space.cn/wechat-share.html?token=secret",
      "https://2space.cn/wechat-share.html#secret",
    ]) {
      const res = await app.inject({
        url: "/api/wechat/jssdk?url=" + encodeURIComponent(url),
      });
      assert.equal(res.statusCode, 400);
      assert.equal(requested, "");
    }
    const res = await app.inject({
      url:
        "/api/wechat/jssdk?url=" +
        encodeURIComponent("https://2space.cn/wechat-share.html"),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().access_token, undefined);
    assert.equal(new URL(requested).origin, "https://wereadnotes.tedxiong.com");
    assert.equal(
      new URL(requested).searchParams.get("url"),
      "https://2space.cn/wechat-share.html",
    );
    const main = await app.inject({ url: "/" });
    assert.ok(
      !main.headers["content-security-policy"]?.includes("res.wx.qq.com"),
    );
    const share = await app.inject({ url: "/wechat-share.html" });
    assert.ok(
      share.headers["content-security-policy"]?.includes(
        "https://res.wx.qq.com/open/js/jweixin-1.6.0.js",
      ),
    );
  } finally {
    await app.close();
  }
});

test("WeChat upstream failures have safe errors", async () => {
  const app = await buildApp({
    dbPath: ":memory:",
    cleanupIntervalMs: 0,
    wechatFetch: (async () => {
      throw new Error("secret");
    }) as typeof fetch,
  });
  try {
    const res = await app.inject({
      url:
        "/api/wechat/jssdk?url=" +
        encodeURIComponent("https://2space.cn/wechat-share.html"),
    });
    assert.equal(res.statusCode, 502);
    assert.ok(!res.body.includes("secret"));
  } finally {
    await app.close();
  }
});
