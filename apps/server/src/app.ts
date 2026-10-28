import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

const RETENTION = [1800, 3600, 21600, 86400, 259200, 604800, 2592000];
const MAX_BYTES = 400_000;
type Envelope = { iv: string; ciphertext: string };
type Row = {
  id: string;
  owner_hash: string;
  reader_hash: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
  retention_seconds: number;
};
type PageRow = {
  id: string;
  space_id: string;
  revision: number;
  iv: string;
  ciphertext: string;
  updated_at: string;
};
type Role = "owner" | "reader";
type Stream = { response: ServerResponse; role: Role; tokenHash: string };
export interface AppOptions {
  dbPath?: string;
  now?: () => number;
  cleanupIntervalMs?: number;
  webDist?: string;
  rateLimit?: number;
}
class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public currentRevision?: number,
  ) {
    super(message);
  }
}
const fail = (
  status: number,
  code: string,
  message: string,
  currentRevision?: number,
): never => {
  throw new ApiFailure(status, code, message, currentRevision);
};
const object = (value: unknown, fields: string[]): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail(422, "INVALID_INPUT", "请求格式无效");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((k) => !fields.includes(k)))
    return fail(422, "INVALID_INPUT", "请求包含不支持的字段");
  return record;
};
const validId = (value: unknown): string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
    ? value
    : fail(422, "INVALID_ID", "标识无效");
const tokenValid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9_-]{43}$/.test(value) &&
  Buffer.from(value, "base64url").length === 32;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const sameHash = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function envelope(value: unknown): Envelope {
  const v = object(value, ["iv", "ciphertext"]);
  const decode = (s: unknown) => {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s))
      return fail(422, "INVALID_PAYLOAD", "加密内容格式无效");
    const bytes = Buffer.from(s, "base64url");
    if (bytes.toString("base64url") !== s)
      return fail(422, "INVALID_PAYLOAD", "加密内容格式无效");
    return bytes;
  };
  const iv = decode(v.iv),
    body = decode(v.ciphertext);
  if (iv.length !== 12 || body.length < 16)
    fail(422, "INVALID_PAYLOAD", "加密内容格式无效");
  if (body.length > MAX_BYTES)
    fail(413, "PAYLOAD_TOO_LARGE", "内容超出大小限制");
  return { iv: v.iv as string, ciphertext: v.ciphertext as string };
}
const retention = (value: unknown) =>
  typeof value === "number" && RETENTION.includes(value)
    ? value
    : fail(422, "INVALID_RETENTION", "保留时间无效");
const revision = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1
    ? value
    : fail(422, "INVALID_REVISION", "版本号无效");
const pageView = (p: PageRow) => ({
  id: p.id,
  revision: p.revision,
  payload: { iv: p.iv, ciphertext: p.ciphertext },
  updatedAt: p.updated_at,
});

export async function buildApp(options: AppOptions = {}) {
  const now = options.now ?? Date.now;
  const dbPath =
    options.dbPath ?? process.env.DB_PATH ?? resolve("data/2space.sqlite");
  if (dbPath !== ":memory:")
    mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(
    "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;",
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS spaces(id TEXT PRIMARY KEY,owner_hash TEXT NOT NULL,reader_hash TEXT,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,expires_at TEXT NOT NULL,retention_seconds INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS pages(id TEXT NOT NULL,space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,revision INTEGER NOT NULL DEFAULT 1,iv TEXT NOT NULL,ciphertext TEXT NOT NULL,updated_at TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(space_id,id)); CREATE INDEX IF NOT EXISTS spaces_expiry ON spaces(expires_at);`,
  );
  const app = Fastify({ logger: false, bodyLimit: 560_000, trustProxy: false });
  const streams = new Map<string, Set<Stream>>();
  const rates = new Map<string, { count: number; start: number }>();
  const createRates = new Map<string, { count: number; start: number }>();
  const iso = () => new Date(now()).toISOString();
  const getRow = (id: string) =>
    db.prepare("SELECT * FROM spaces WHERE id=?").get(id) as Row | undefined;
  function closeStreams(id: string, onlyReader = false) {
    const set = streams.get(id);
    if (!set) return;
    for (const s of [...set])
      if (!onlyReader || s.role === "reader") {
        s.response.end();
        set.delete(s);
      }
    if (!set.size) streams.delete(id);
  }
  function destroySpace(id: string) {
    closeStreams(id);
    db.prepare("DELETE FROM spaces WHERE id=?").run(id);
  }
  function authenticate(
    req: FastifyRequest,
    ownerOnly = false,
  ): { space: Row; role: Role; tokenHash: string } {
    const { id } = req.params as { id: string };
    validId(id);
    const row = getRow(id);
    if (!row) return fail(404, "NOT_FOUND", "空间不存在或已过期");
    if (Date.parse(row.expires_at) <= now()) {
      destroySpace(id);
      return fail(404, "NOT_FOUND", "空间不存在或已过期");
    }
    const bearer = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!bearer || !tokenValid(bearer))
      return fail(401, "UNAUTHORIZED", "需要有效的访问链接");
    const digest = hash(bearer);
    const role: Role = sameHash(digest, row.owner_hash)
      ? "owner"
      : row.reader_hash && sameHash(digest, row.reader_hash)
        ? "reader"
        : fail(401, "UNAUTHORIZED", "访问链接已失效");
    if (ownerOnly && role !== "owner")
      return fail(403, "READ_ONLY", "此链接仅允许查看");
    return { space: row, role, tokenHash: digest };
  }
  function view(row: Row, role: Role) {
    const pages = db
      .prepare("SELECT * FROM pages WHERE space_id=? ORDER BY position")
      .all(row.id) as PageRow[];
    return {
      id: row.id,
      revision: row.revision,
      pages: pages.map(pageView),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
      retentionSeconds: row.retention_seconds,
      role,
    };
  }
  function touch(id: string) {
    const row = getRow(id)!;
    db.prepare(
      "UPDATE spaces SET revision=revision+1,updated_at=?,expires_at=? WHERE id=?",
    ).run(
      iso(),
      new Date(now() + row.retention_seconds * 1000).toISOString(),
      id,
    );
  }
  function notify(id: string) {
    const row = getRow(id);
    if (!row) return;
    for (const s of streams.get(id) ?? [])
      s.response.write(
        `event: change\ndata: ${JSON.stringify({ revision: row.revision })}\n\n`,
      );
  }
  function limit(map: typeof rates, key: string, max: number, period: number) {
    const time = now();
    let rate = map.get(key);
    if (!rate || time - rate.start >= period) {
      rate = { start: time, count: 0 };
      map.set(key, rate);
    }
    if (++rate.count > max) fail(429, "RATE_LIMITED", "操作太频繁，请稍后再试");
  }
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("Referrer-Policy", "no-referrer")
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("X-Robots-Tag", "noindex, nofollow")
      .header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
      .header(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
      );
    if (req.url.startsWith("/api/"))
      limit(rates, req.ip, options.rateLimit ?? 600, 60_000);
    if (
      req.headers["sec-fetch-site"] === "cross-site" &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    )
      fail(403, "CROSS_SITE", "不允许跨站写入");
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiFailure) {
      reply.code(error.status).send({
        error: { code: error.code, message: error.message },
        ...(error.currentRevision
          ? { currentRevision: error.currentRevision }
          : {}),
      });
      return;
    }
    const e = error as { statusCode?: number; code?: string };
    if (
      !req.url.startsWith("/api/") &&
      [403, 404].includes(e.statusCode ?? 0)
    ) {
      return reply.code(404).send({
        error: { code: "NOT_FOUND", message: "页面不存在" },
      });
    }

    const status =
      e.statusCode === 413
        ? 413
        : e.statusCode === 400 || e.statusCode === 415
          ? 422
          : 500;
    reply.code(status).send({
      error: {
        code:
          status === 413
            ? "PAYLOAD_TOO_LARGE"
            : status === 422
              ? "INVALID_INPUT"
              : "INTERNAL_ERROR",
        message:
          status === 413
            ? "内容超出大小限制"
            : status === 422
              ? "请求格式无效"
              : "暂时无法完成操作，请重试",
      },
    });
  });
  app.get("/api/health", async () => ({ status: "ok", version: "1.0.0" }));
  app.post("/api/spaces", async (req, reply) => {
    limit(createRates, req.ip, 20, 3600_000);
    const body = object(req.body, ["ownerToken", "retentionSeconds", "page"]);
    if (!tokenValid(body.ownerToken))
      fail(422, "INVALID_TOKEN", "管理凭证格式无效");
    const seconds =
      body.retentionSeconds === undefined
        ? 86400
        : retention(body.retentionSeconds);
    const p = object(body.page, ["id", "payload"]);
    const pid = validId(p.id),
      encrypted = envelope(p.payload);
    const id = randomUUID(),
      time = iso(),
      expires = new Date(now() + seconds * 1000).toISOString();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO spaces(id,owner_hash,revision,created_at,updated_at,expires_at,retention_seconds) VALUES(?,?,1,?,?,?,?)",
      ).run(id, hash(body.ownerToken as string), time, time, expires, seconds);
      db.prepare(
        "INSERT INTO pages(id,space_id,revision,iv,ciphertext,updated_at,position) VALUES(?,?,1,?,?,?,0)",
      ).run(pid, id, encrypted.iv, encrypted.ciphertext, time);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return reply.code(201).send(view(getRow(id)!, "owner"));
  });
  app.get("/api/spaces/:id", async (req) => {
    const a = authenticate(req);
    return view(a.space, a.role);
  });
  app.post("/api/spaces/:id/pages", async (req, reply) => {
    const a = authenticate(req, true),
      body = object(req.body, ["id", "payload"]),
      pid = validId(body.id),
      p = envelope(body.payload);
    const pages = db
      .prepare("SELECT id,position FROM pages WHERE space_id=?")
      .all(a.space.id) as { id: string; position: number }[];
    if (pages.length >= 6) fail(409, "PAGE_LIMIT", "最多保留6份笔记");
    if (pages.some((x) => x.id === pid)) fail(409, "PAGE_EXISTS", "笔记已存在");
    const time = iso();
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO pages(id,space_id,revision,iv,ciphertext,updated_at,position) VALUES(?,?,1,?,?,?,?)",
      ).run(
        pid,
        a.space.id,
        p.iv,
        p.ciphertext,
        time,
        Math.max(-1, ...pages.map((x) => x.position)) + 1,
      );
      touch(a.space.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    notify(a.space.id);
    return reply
      .code(201)
      .send(
        pageView(
          db
            .prepare("SELECT * FROM pages WHERE space_id=? AND id=?")
            .get(a.space.id, pid) as PageRow,
        ),
      );
  });
  app.put("/api/spaces/:id/pages/:pageId", async (req) => {
    const a = authenticate(req, true),
      pid = validId((req.params as { pageId: string }).pageId),
      body = object(req.body, ["expectedRevision", "payload"]),
      expected = revision(body.expectedRevision),
      p = envelope(body.payload);
    const old = db
      .prepare("SELECT * FROM pages WHERE space_id=? AND id=?")
      .get(a.space.id, pid) as PageRow | undefined;
    if (!old) return fail(404, "PAGE_NOT_FOUND", "笔记不存在");
    if (old.revision !== expected)
      fail(
        409,
        "REVISION_CONFLICT",
        "其他设备已更新，请保留草稿后重新载入",
        old.revision,
      );
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db
        .prepare(
          "UPDATE pages SET revision=revision+1,iv=?,ciphertext=?,updated_at=? WHERE space_id=? AND id=? AND revision=?",
        )
        .run(p.iv, p.ciphertext, iso(), a.space.id, pid, expected);
      if (result.changes !== 1) fail(409, "REVISION_CONFLICT", "笔记已更新");
      touch(a.space.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    notify(a.space.id);
    return pageView(
      db
        .prepare("SELECT * FROM pages WHERE space_id=? AND id=?")
        .get(a.space.id, pid) as PageRow,
    );
  });
  app.delete("/api/spaces/:id/pages/:pageId", async (req, reply) => {
    const a = authenticate(req, true),
      pid = validId((req.params as { pageId: string }).pageId),
      body = object(req.body, ["expectedRevision"]),
      expected = revision(body.expectedRevision);
    const old = db
      .prepare("SELECT * FROM pages WHERE space_id=? AND id=?")
      .get(a.space.id, pid) as PageRow | undefined;
    if (!old) return reply.code(204).send();
    if (old.revision !== expected)
      fail(409, "REVISION_CONFLICT", "笔记已更新", old.revision);
    const count = db
      .prepare("SELECT count(*) AS n FROM pages WHERE space_id=?")
      .get(a.space.id) as { n: number };
    if (count.n <= 1) fail(409, "LAST_PAGE", "至少保留一份笔记");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "DELETE FROM pages WHERE space_id=? AND id=? AND revision=?",
      ).run(a.space.id, pid, expected);
      touch(a.space.id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    notify(a.space.id);
    return reply.code(204).send();
  });
  app.patch("/api/spaces/:id", async (req) => {
    const a = authenticate(req, true),
      body = object(req.body, ["retentionSeconds"]),
      seconds = retention(body.retentionSeconds);
    db.prepare(
      "UPDATE spaces SET retention_seconds=?,revision=revision+1,updated_at=?,expires_at=? WHERE id=?",
    ).run(
      seconds,
      iso(),
      new Date(now() + seconds * 1000).toISOString(),
      a.space.id,
    );
    notify(a.space.id);
    return view(getRow(a.space.id)!, "owner");
  });
  app.post("/api/spaces/:id/shares", async (req, reply) => {
    const a = authenticate(req, true);
    if (req.body !== undefined) object(req.body, []);
    const token = randomBytes(32).toString("base64url");
    db.prepare(
      "UPDATE spaces SET reader_hash=?,revision=revision+1 WHERE id=?",
    ).run(hash(token), a.space.id);
    closeStreams(a.space.id, true);
    notify(a.space.id);
    return reply.code(201).send({ token });
  });
  app.delete("/api/spaces/:id/shares", async (req, reply) => {
    const a = authenticate(req, true);
    db.prepare(
      "UPDATE spaces SET reader_hash=NULL,revision=revision+1 WHERE id=?",
    ).run(a.space.id);
    closeStreams(a.space.id, true);
    notify(a.space.id);
    return reply.code(204).send();
  });
  app.delete("/api/spaces/:id", async (req, reply) => {
    const a = authenticate(req, true);
    destroySpace(a.space.id);
    return reply.code(204).send();
  });
  app.get("/api/spaces/:id/events", async (req, reply) => {
    const a = authenticate(req);
    const existing = streams.get(a.space.id) ?? new Set<Stream>();
    if (existing.size >= 30)
      fail(429, "STREAM_LIMIT", "连接过多，请关闭多余页面");
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    reply.raw.write(
      `event: change\ndata: ${JSON.stringify({ revision: a.space.revision })}\n\n`,
    );
    const stream: Stream = {
      response: reply.raw,
      role: a.role,
      tokenHash: a.tokenHash,
    };
    existing.add(stream);
    streams.set(a.space.id, existing);
    const timer = setInterval(() => {
      const row = getRow(a.space.id);
      if (
        !row ||
        Date.parse(row.expires_at) <= now() ||
        (stream.role === "reader" && row.reader_hash !== stream.tokenHash)
      ) {
        reply.raw.end();
        return;
      }
      reply.raw.write(": heartbeat\n\n");
    }, 15_000);
    timer.unref();
    reply.raw.on("close", () => {
      clearInterval(timer);
      existing.delete(stream);
      if (!existing.size) streams.delete(a.space.id);
    });
  });
  const webRoot =
    options.webDist ??
    process.env.WEB_DIST ??
    resolve(dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      index: false,
      cacheControl: false,
    });
    // Serve the exact home route before the wildcard sees it as a forbidden directory.
    // Fastify also registers HEAD for this GET route; directory listing stays disabled.
    app.get("/", async (_req, reply) =>
      reply.type("text/html").sendFile("index.html"),
    );
  }
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/api/"))
      return reply
        .code(404)
        .send({ error: { code: "NOT_FOUND", message: "接口不存在" } });
    const path = req.url.split("?")[0];
    if (
      existsSync(resolve(webRoot, "index.html")) &&
      req.method === "GET" &&
      (path === "/" || /^\/s\/[0-9a-f-]+$/.test(path))
    )
      return reply.type("text/html").sendFile("index.html");
    return reply
      .code(404)
      .send({ error: { code: "NOT_FOUND", message: "页面不存在" } });
  });
  const cleanup = () => {
    const expired = db
      .prepare("SELECT id FROM spaces WHERE expires_at<=?")
      .all(iso()) as { id: string }[];
    for (const row of expired) destroySpace(row.id);
    for (const [key, r] of rates)
      if (now() - r.start > 60_000) rates.delete(key);
    for (const [key, r] of createRates)
      if (now() - r.start > 3600_000) createRates.delete(key);
  };
  const interval =
    options.cleanupIntervalMs === 0
      ? undefined
      : setInterval(cleanup, options.cleanupIntervalMs ?? 30_000);
  interval?.unref();
  app.addHook("preClose", async () => {
    for (const id of streams.keys()) closeStreams(id);
  });
  app.addHook("onClose", async () => {
    if (interval) clearInterval(interval);
    for (const id of streams.keys()) closeStreams(id);
    db.close();
  });
  return app;
}
