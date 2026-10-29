import { userErrorMessage } from "./error-copy.js";
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function request<T>(
  path: string,
  token?: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const signal = AbortSignal.timeout(15_000);
  try {
    const response = await fetch("/api" + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
    if (!response.ok) {
      let data;
      try {
        data = await response.json();
      } catch {}
      throw new RequestError(
        response.status,
        data?.error?.code || "NETWORK_ERROR",
        userErrorMessage(data?.error?.code),
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (signal.aborted) throw new Error("连接超时，请检查网络后重试");
    throw new Error("网络暂时不可用，请重试");
  }
}
export async function subscribe(
  spaceId: string,
  token: string,
  signal: AbortSignal,
  onChange: () => void,
  onStatus: (online: boolean) => void,
) {
  while (!signal.aborted) {
    try {
      const res = await fetch(`/api/spaces/${spaceId}/events`, {
        headers: { Authorization: `Bearer ${token}` },
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        onStatus(false);
        if ([401, 403, 404].includes(res.status)) {
          onChange();
          return;
        }
        throw Error();
      }
      onStatus(true);
      onChange();
      const reader = res.body!.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (event.includes("event: change")) onChange();
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    onStatus(false);
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 2500);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}
