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

test("界面错误说明用用户语言，不直接显示服务端术语或内部信息", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_TOKEN",
            message: "管理凭证格式无效（内部诊断）",
          },
        }),
        { status: 422 },
      ),
  );
  try {
    await assert.rejects(
      request("/spaces/test"),
      (error) =>
        error instanceof RequestError &&
        error.code === "INVALID_TOKEN" &&
        error.message === "链接不完整，请重新复制后打开。",
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test("未知服务端错误不向用户展示维护信息", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "UNEXPECTED_DATABASE_FAILURE",
            message: "SQLITE_BUSY /data/private.sqlite",
          },
        }),
        { status: 500 },
      ),
  );
  try {
    await assert.rejects(
      request("/spaces/test"),
      (error) =>
        error instanceof RequestError &&
        error.message === "操作没有完成，请稍后重试。",
    );
  } finally {
    fetchMock.mock.restore();
  }
});

test("密码挑战只保留spaceId用于输入密码，不暴露服务端诊断；公开请求不发送Bearer", async () => {
  const fetchMock = mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init?: RequestInit) => {
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        undefined,
      );
      return new Response(
        JSON.stringify({
          error: {
            code: "PASSWORD_REQUIRED",
            message: "server hash private diagnostic",
          },
          spaceId: "challenge-id",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    },
  );
  try {
    await assert.rejects(
      request("/spaces/by-name/public-space"),
      (error) =>
        error instanceof RequestError &&
        error.code === "PASSWORD_REQUIRED" &&
        error.spaceId === "challenge-id" &&
        error.message === "请输入空间密码后继续。",
    );
  } finally {
    fetchMock.mock.restore();
  }
});
