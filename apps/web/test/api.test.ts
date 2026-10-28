import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { request, RequestError } from "../src/api.js";

test("半开连接15秒超时后释放请求并给出可重试提示", async () => {
  const controller = new AbortController();
  const timeout = mock.method(
    AbortSignal,
    "timeout",
    (milliseconds: number) => {
      assert.equal(milliseconds, 15_000);
      return controller.signal;
    },
  );
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      assert.equal(init?.signal, controller.signal);
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("timed out", "TimeoutError")),
          { once: true },
        );
        controller.abort();
      });
    },
  );
  try {
    await assert.rejects(
      request("/spaces/test"),
      (error) =>
        error instanceof Error &&
        !(error instanceof RequestError) &&
        error.message.includes("连接超时"),
    );
  } finally {
    timeout.mock.restore();
    fetchMock.mock.restore();
  }
});

test("权限错误保持服务端状态，不作为网络超时自动重试", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: { code: "FORBIDDEN", message: "只读访问不能修改" },
        }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      ),
  );
  try {
    await assert.rejects(
      request("/spaces/test", undefined, "PUT", {}),
      (error) =>
        error instanceof RequestError &&
        error.status === 403 &&
        error.code === "FORBIDDEN",
    );
  } finally {
    fetchMock.mock.restore();
  }
});
