import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { DatabaseSync } from "node:sqlite";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
  scryptSync,
} from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerResponse } from "node:http";

const RETENTION = [
  0, 1800, 3600, 21600, 86400, 259200, 604800, 2592000, 7776000, 15552000,
  31536000, 63072000, 94608000,
];
const PERMANENT = "9999-12-31T23:59:59.999Z";
const MAX_BYTES = 400_000;
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const RESERVED_NAMES = new Set([
  "api",
  "assets",
  "s",
  "privacy",
  "share",
  "health",
  "robots",
  "favicon",
  "index",
]);
const nameValid = (name: unknown): name is string =>
  typeof name === "string" &&
  NAME_PATTERN.test(name) &&
  !RESERVED_NAMES.has(name.toLowerCase());
const validName = (name: unknown): string =>
  nameValid(name)
    ? name
    : fail(
        422,
        "INVALID_NAME",
        "名称需为1–64位字母、数字、下划线或中划线，且不能使用保留名称",
      );
type CompactRow = {
  space_id: string;
  token_hash: string;
  key_iv: string;
  key_ciphertext: string;
  owner_iv: string;
  owner_ciphertext: string;
};
const compactView = (row: CompactRow) => ({
  keyEnvelope: { iv: row.key_iv, ciphertext: row.key_ciphertext },
  ownerEnvelope: { iv: row.owner_iv, ciphertext: row.owner_ciphertext },
});
type Envelope = { iv: string; ciphertext: string };
type Row = {
  id: string;
  name: string | null;
  access_mode: "public" | "private";
  public_key: string | null;
  password_hash: string | null;
  password_salt: string | null;
  protection_version: number;
  protection_salt: string | null;
  key_revision: number;
  view_count: number;
  last_viewed_at: string | null;
  main_page_id: string | null;
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
type Stream = {
  response: ServerResponse;
  role: Role;
  tokenHash: string;
  sessionHash?: string;
};
type PasswordSession = { spaceId: string; tokenHash: string; expires: number };
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
    public spaceId?: string,
  ) {
    super(message);
  }
}
const fail = (
  status: number,
  code: string,
  message: string,
  currentRevision?: number,
  spaceId?: string,
): never => {
  throw new ApiFailure(status, code, message, currentRevision, spaceId);
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
  Buffer.from(value, "base64url").length === 32 &&
  Buffer.from(value, "base64url").toString("base64url") === value;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const sameHash = (a: string, b: string | null | undefined) =>
  !!b &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
function envelope(value: unknown): Envelope {
  const v = object(value, ["iv", "ciphertext"]);
  const decode = (s: unknown) => {
    if (typeof s !== "string" || !/^[A-Za-z0-9_-]+$/.test(s))
      return fail(422, "INVALID_PAYLOAD", "内容格式无效");
    const bytes = Buffer.from(s, "base64url");
    if (bytes.toString("base64url") !== s)
      return fail(422, "INVALID_PAYLOAD", "内容格式无效");
    return bytes;
  };
  const iv = decode(v.iv),
    body = decode(v.ciphertext);
  if (iv.length !== 12 || body.length < 16)
    fail(422, "INVALID_PAYLOAD", "内容格式无效");
  if (body.length > MAX_BYTES)
    fail(413, "PAYLOAD_TOO_LARGE", "内容超出大小限制");
  return { iv: v.iv as string, ciphertext: v.ciphertext as string };
}
type BrowserProtection = {
  version: 1;
  kdf: "PBKDF2-SHA256";
  iterations: 600000;
  salt: string;
};
function protectionValue(value: unknown): BrowserProtection {
  const data = object(value, ["version", "kdf", "iterations", "salt"]);
  if (
    data.version !== 1 ||
    data.kdf !== "PBKDF2-SHA256" ||
    data.iterations !== 600_000 ||
    typeof data.salt !== "string" ||
    !/^[A-Za-z0-9_-]{22}$/.test(data.salt) ||
    Buffer.from(data.salt, "base64url").length !== 16 ||
    Buffer.from(data.salt, "base64url").toString("base64url") !== data.salt
  )
    fail(422, "INVALID_PROTECTION", "密码保护设置无效");
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 600000,
    salt: data.salt as string,
  };
}
function protectionView(row: Row): BrowserProtection | undefined {
  if (row.protection_version !== 1) return undefined;
  if (!row.protection_salt) throw new Error("Invalid protection state");
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: 600000,
    salt: row.protection_salt,
  };
}
function keyGeneration(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return fail(422, "INVALID_PROTECTION", "密码保护设置无效");
  return value;
}
function checkKeyRevision(row: Row, value: unknown) {
  if (value === undefined && row.key_revision === 0) return;
  if (value === undefined || keyGeneration(value) !== row.key_revision)
    fail(
      409,
      "KEY_CHANGED",
      "密码或访问方式已更新，请重新打开",
      undefined,
      row.id,
    );
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
  // Additive migration: v1 databases retain all ciphertext and existing capabilities.
  db.exec("BEGIN IMMEDIATE");
  try {
    const columns = db.prepare("PRAGMA table_info(spaces)").all() as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === "name"))
      db.exec("ALTER TABLE spaces ADD COLUMN name TEXT");
    const additions: Record<string, string> = {
      access_mode: "TEXT NOT NULL DEFAULT 'private'",
      public_key: "TEXT",
      password_hash: "TEXT",
      password_salt: "TEXT",
      protection_version: "INTEGER NOT NULL DEFAULT 0",
      protection_salt: "TEXT",
      key_revision: "INTEGER NOT NULL DEFAULT 0",
      view_count: "INTEGER NOT NULL DEFAULT 0",
      last_viewed_at: "TEXT",
      main_page_id: "TEXT",
    };
    for (const [name, definition] of Object.entries(additions))
      if (!columns.some((column) => column.name === name))
        db.exec(`ALTER TABLE spaces ADD COLUMN ${name} ${definition}`);
    db.exec(
      "UPDATE spaces SET main_page_id=(SELECT id FROM pages WHERE space_id=spaces.id ORDER BY position LIMIT 1) WHERE main_page_id IS NULL",
    );
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS spaces_name ON spaces(name) WHERE name IS NOT NULL; CREATE TABLE IF NOT EXISTS compact_shares(space_id TEXT PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,token_hash TEXT NOT NULL,key_iv TEXT NOT NULL,key_ciphertext TEXT NOT NULL,owner_iv TEXT NOT NULL,owner_ciphertext TEXT NOT NULL);",
    );
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    throw error;
  }
  const app = Fastify({ logger: false, bodyLimit: 560_000, trustProxy: false });
  const streams = new Map<string, Set<Stream>>();
  const rates = new Map<string, { count: number; start: number }>();
  const createRates = new Map<string, { count: number; start: number }>();
  const passwordRates = new Map<string, { count: number; start: number }>();
  const sessions = new Map<string, PasswordSession>();
  const expiry = (seconds: number, base = now()) =>
    seconds === 0 ? PERMANENT : new Date(base + seconds * 1000).toISOString();
  const cookieName = (spaceId: string) =>
    `2space_session_${spaceId.replace(/-/g, "")}`;
  function sessionHash(req: FastifyRequest, spaceId: string) {
    const name = cookieName(spaceId);
    const value = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(name + "="))
      ?.slice(name.length + 1);
    return value && tokenValid(value) ? hash(value) : undefined;
  }
  function validSession(req: FastifyRequest, row: Row, tokenHash: string) {
    const digest = sessionHash(req, row.id),
      session = digest ? sessions.get(digest) : undefined;
    return (
      !!session &&
      session.spaceId === row.id &&
      session.expires > now() &&
      (row.access_mode === "public" || sameHash(tokenHash, session.tokenHash))
    );
  }
  function clearSessions(spaceId: string) {
    for (const [digest, session] of sessions)
      if (session.spaceId === spaceId) sessions.delete(digest);
  }
  function setSession(
    req: FastifyRequest,
    reply: import("fastify").FastifyReply,
    row: Row,
    tokenHash: string,
  ) {
    const secret = randomBytes(32).toString("base64url"),
      digest = hash(secret);
    sessions.set(digest, {
      spaceId: row.id,
      tokenHash,
      expires: now() + 1800_000,
    });
    reply.header(
      "Set-Cookie",
      `${cookieName(row.id)}=${secret}; Path=/api/spaces; HttpOnly; SameSite=Strict; Max-Age=1800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
  }
  function passwordValue(body: unknown) {
    const value = object(body, ["password"]).password;
    if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 1024)
      return fail(422, "INVALID_PASSWORD", "密码格式无效");
    return value;
  }
  function derivePassword(password: string, salt: string) {
    return scryptSync(password, Buffer.from(salt, "base64url"), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString("hex");
  }
  const iso = () => new Date(now()).toISOString();
  const getRow = (id: string) =>
    db.prepare("SELECT * FROM spaces WHERE id=?").get(id) as Row | undefined;
  const getCompact = (id: string) =>
    db.prepare("SELECT * FROM compact_shares WHERE space_id=?").get(id) as
      CompactRow | undefined;
  function closeStreams(id: string, onlyReader = false, tokenHash?: string) {
    const set = streams.get(id);
    if (!set) return;
    for (const s of [...set])
      if (
        (!onlyReader || s.role === "reader") &&
        (!tokenHash || sameHash(s.tokenHash, tokenHash))
      ) {
        s.response.end();
        set.delete(s);
      }
    if (!set.size) streams.delete(id);
  }
  function destroySpace(id: string) {
    closeStreams(id);
    clearSessions(id);
    db.prepare("DELETE FROM spaces WHERE id=?").run(id);
  }
  function authenticate(
    req: FastifyRequest,
    ownerOnly = false,
    resolvedId?: string,
    skipPassword = false,
  ): { space: Row; role: Role; tokenHash: string } {
    const id = resolvedId ?? (req.params as { id: string }).id;
    validId(id);
    const row = getRow(id);
    if (!row) return fail(404, "NOT_FOUND", "空间不存在或已过期");
    if (Date.parse(row.expires_at) <= now()) {
      destroySpace(id);
      return fail(404, "NOT_FOUND", "空间不存在或已过期");
    }
    if (row.access_mode === "public") {
      if (!skipPassword && row.password_hash && !validSession(req, row, ""))
        fail(401, "PASSWORD_REQUIRED", "请输入空间密码", undefined, row.id);
      return { space: row, role: "owner", tokenHash: "" };
    }
    const bearer = req.headers.authorization?.match(
      /^Bearer ([A-Za-z0-9_-]{43})$/,
    )?.[1];
    if (!bearer || !tokenValid(bearer))
      return fail(401, "UNAUTHORIZED", "需要有效的访问链接");
    const digest = hash(bearer);
    const role: Role = sameHash(digest, row.owner_hash)
      ? "owner"
      : (row.reader_hash && sameHash(digest, row.reader_hash)) ||
          sameHash(digest, getCompact(id)?.token_hash)
        ? "reader"
        : fail(401, "UNAUTHORIZED", "访问链接已失效");
    if (ownerOnly && role !== "owner")
      return fail(403, "READ_ONLY", "此链接仅允许查看");
    if (!skipPassword && row.password_hash && !validSession(req, row, digest))
      fail(401, "PASSWORD_REQUIRED", "请输入空间密码", undefined, row.id);
    return { space: row, role, tokenHash: digest };
  }
  function view(row: Row, role: Role, tokenHash?: string, viewerIp?: string) {
    const pages = db
      .prepare("SELECT * FROM pages WHERE space_id=? ORDER BY position")
      .all(row.id) as PageRow[];
    return {
      id: row.id,
      accessMode: row.access_mode,
      ...(row.access_mode === "public" && row.public_key
        ? { publicKey: row.public_key }
        : {}),
      ...(row.protection_version === 1
        ? { protection: protectionView(row) }
        : {}),
      keyRevision: row.key_revision,
      passwordProtected: !!row.password_hash,
      viewCount: row.view_count,
      lastViewedAt: row.last_viewed_at,
      ...(viewerIp ? { viewerIp } : {}),
      ...(row.name ? { name: row.name } : {}),
      ...(role === "reader" &&
      tokenHash &&
      sameHash(tokenHash, getCompact(row.id)?.token_hash)
        ? { readerKey: compactView(getCompact(row.id)!).keyEnvelope }
        : {}),
      revision: row.revision,
      pages: pages.map(pageView),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.retention_seconds === 0 ? null : row.expires_at,
      retentionSeconds: row.retention_seconds,
      role,
    };
  }
  function assertNameAvailable(name: string, ownId?: string) {
    const holder = db.prepare("SELECT * FROM spaces WHERE name=?").get(name) as
      Row | undefined;
    if (!holder || holder.id === ownId) return;
    if (Date.parse(holder.expires_at) <= now()) {
      destroySpace(holder.id);
      return;
    }
    fail(409, "NAME_TAKEN", "名称已被使用，请打开已有空间或换一个名称");
  }
  function touch(id: string) {
    const row = getRow(id)!;
    db.prepare(
      "UPDATE spaces SET revision=revision+1,updated_at=?,expires_at=? WHERE id=?",
    ).run(iso(), expiry(row.retention_seconds), id);
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
        ...(error.spaceId ? { spaceId: error.spaceId } : {}),
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
    const body = object(req.body, [
      "ownerToken",
      "retentionSeconds",
      "page",
      "name",
      "accessMode",
      "publicKey",
    ]);
    if (!tokenValid(body.ownerToken))
      fail(422, "INVALID_TOKEN", "可编辑链接不完整");
    const name = body.name === undefined ? null : validName(body.name);
    if (
      body.accessMode !== undefined &&
      body.accessMode !== "public" &&
      body.accessMode !== "private"
    )
      fail(422, "INVALID_INPUT", "空间类型无效");
    const mode = body.accessMode === "public" ? "public" : "private";
    if (mode === "public" && (!name || !tokenValid(body.publicKey)))
      fail(422, "INVALID_INPUT", "名称或内容设置无效");
    if (mode === "private" && body.publicKey !== undefined)
      fail(422, "INVALID_INPUT", "此空间不接受公开内容设置");
    const seconds =
      body.retentionSeconds === undefined
        ? mode === "public"
          ? 0
          : 86400
        : retention(body.retentionSeconds);
    const p = object(body.page, ["id", "payload"]);
    const pid = validId(p.id),
      encrypted = envelope(p.payload);
    const id = randomUUID(),
      time = iso(),
      expires = expiry(seconds);
    db.exec("BEGIN IMMEDIATE");
    try {
      if (name) assertNameAvailable(name);
      db.prepare(
        "INSERT INTO spaces(id,name,owner_hash,revision,created_at,updated_at,expires_at,retention_seconds,access_mode,public_key,main_page_id) VALUES(?,?,?,1,?,?,?,?,?,?,?)",
      ).run(
        id,
        name,
        hash(body.ownerToken as string),
        time,
        time,
        expires,
        seconds,
        mode,
        mode === "public" ? (body.publicKey as string) : null,
        pid,
      );
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
  app.get("/api/spaces/by-name/:name", async (req) => {
    const name = validName((req.params as { name: string }).name);
    const row = db.prepare("SELECT id FROM spaces WHERE name=?").get(name) as
      { id: string } | undefined;
    if (!row) return fail(404, "NOT_FOUND", "空间不存在或已过期");
    const a = authenticate(req, false, row.id);
    return view(a.space, a.role, a.tokenHash, req.ip);
  });
  app.get("/api/spaces/:id", async (req) => {
    const a = authenticate(req);
    return view(a.space, a.role, a.tokenHash, req.ip);
  });
  app.get("/api/spaces/:id/protection", async (req) => {
    // Public KDF metadata must not release pages, stored proofs, or decryption keys.
    // Legacy private spaces still require their original bearer capability.
    const a = authenticate(req, false, undefined, true);
    return {
      protection: protectionView(a.space) ?? null,
      keyRevision: a.space.key_revision,
    };
  });
  app.post(
    "/api/spaces/:id/protection",
    { bodyLimit: 3_300_000 },
    async (req, reply) => {
      const a = authenticate(req, true);
      if (a.space.access_mode !== "public")
        fail(422, "INVALID_PROTECTION", "此空间继续使用原有链接保护");
      limit(passwordRates, `${req.ip}:${a.space.id}:password`, 15, 900_000);
      const body = object(req.body, [
        "expectedRevision",
        "expectedKeyRevision",
        "protection",
        "proof",
        "publicKey",
        "pages",
      ]);
      const expected = revision(body.expectedRevision),
        expectedKey = keyGeneration(body.expectedKeyRevision),
        protection =
          body.protection === null ? null : protectionValue(body.protection);
      if (protection) {
        if (!tokenValid(body.proof) || body.publicKey !== undefined)
          fail(422, "INVALID_PROTECTION", "密码保护设置无效");
        if (protection.salt === a.space.protection_salt)
          fail(422, "INVALID_PROTECTION", "请重新生成密码保护设置");
      } else if (
        !tokenValid(body.publicKey) ||
        body.proof !== undefined ||
        body.publicKey === a.space.public_key
      ) {
        fail(422, "INVALID_PROTECTION", "请重新生成内容保护设置");
      }
      if (
        !Array.isArray(body.pages) ||
        body.pages.length < 1 ||
        body.pages.length > 6
      )
        fail(422, "INVALID_PROTECTION", "请完整保存所有记事本后重试");
      const replacements = (body.pages as unknown[]).map((item) => {
        const page = object(item, ["id", "expectedRevision", "payload"]);
        return {
          id: validId(page.id),
          expected: revision(page.expectedRevision),
          payload: envelope(page.payload),
        };
      });
      if (
        new Set(replacements.map((page) => page.id)).size !==
          replacements.length ||
        new Set(replacements.map((page) => page.payload.iv)).size !==
          replacements.length
      )
        fail(422, "INVALID_PROTECTION", "记事本保护设置不完整，请重试");
      const salt = protection ? randomBytes(16).toString("base64url") : null,
        digest =
          protection && salt
            ? derivePassword(body.proof as string, salt)
            : null;
      db.exec("BEGIN IMMEDIATE");
      try {
        const current = getRow(a.space.id)!;
        if (current.key_revision !== expectedKey)
          fail(
            409,
            "KEY_CHANGED",
            "密码或访问方式已更新，请重新打开",
            undefined,
            current.id,
          );
        if (current.revision !== expected)
          fail(
            409,
            "REVISION_CONFLICT",
            "其他设备已更新，请保存后重试",
            current.revision,
          );
        const existing = db
          .prepare("SELECT * FROM pages WHERE space_id=? ORDER BY position")
          .all(current.id) as PageRow[];
        if (
          existing.length !== replacements.length ||
          existing.some(
            (page) => !replacements.some((next) => next.id === page.id),
          )
        )
          fail(
            409,
            "REVISION_CONFLICT",
            "记事本列表已更新，请重新打开",
            current.revision,
          );
        for (const next of replacements) {
          const old = existing.find((page) => page.id === next.id)!;
          if (old.revision !== next.expected)
            fail(
              409,
              "REVISION_CONFLICT",
              "其他设备已更新，请保存后重试",
              old.revision,
            );
          if (
            existing.some(
              (page) =>
                page.iv === next.payload.iv &&
                page.ciphertext === next.payload.ciphertext,
            )
          )
            fail(422, "INVALID_PROTECTION", "请重新保护所有记事本后重试");
        }
        for (const next of replacements)
          db.prepare(
            "UPDATE pages SET revision=revision+1,iv=?,ciphertext=? WHERE space_id=? AND id=? AND revision=?",
          ).run(
            next.payload.iv,
            next.payload.ciphertext,
            current.id,
            next.id,
            next.expected,
          );
        const changed = db
          .prepare(
            "UPDATE spaces SET revision=revision+1,key_revision=key_revision+1,protection_version=?,protection_salt=?,public_key=?,password_hash=?,password_salt=? WHERE id=? AND revision=? AND key_revision=?",
          )
          .run(
            protection ? 1 : 0,
            protection?.salt ?? null,
            protection ? null : (body.publicKey as string),
            digest,
            salt,
            current.id,
            expected,
            expectedKey,
          );
        if (changed.changes !== 1)
          fail(409, "REVISION_CONFLICT", "其他设备已更新，请保存后重试");
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      clearSessions(a.space.id);
      closeStreams(a.space.id);
      const current = getRow(a.space.id)!;
      setSession(req, reply, current, a.tokenHash);
      notify(a.space.id);
      return view(current, a.role, a.tokenHash, req.ip);
    },
  );
  app.post("/api/spaces/:id/pages", async (req, reply) => {
    const a = authenticate(req, true),
      body = object(req.body, ["id", "payload", "keyRevision"]);
    checkKeyRevision(a.space, body.keyRevision);
    const pid = validId(body.id),
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
      body = object(req.body, ["expectedRevision", "payload", "keyRevision"]);
    checkKeyRevision(a.space, body.keyRevision);
    const expected = revision(body.expectedRevision),
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
    if (pid === a.space.main_page_id)
      fail(409, "MAIN_PAGE", "主剪贴板不能删除");
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
  app.post("/api/spaces/:id/visits", async (req) => {
    const a = authenticate(req);
    object(req.body ?? {}, []);
    db.prepare(
      "UPDATE spaces SET view_count=view_count+1,last_viewed_at=? WHERE id=?",
    ).run(iso(), a.space.id);
    return view(getRow(a.space.id)!, a.role, a.tokenHash, req.ip);
  });
  app.post("/api/spaces/:id/pages/order", async (req) => {
    const a = authenticate(req, true),
      body = object(req.body, ["ids"]);
    if (
      !Array.isArray(body.ids) ||
      !body.ids.every((id) => typeof id === "string")
    )
      fail(422, "INVALID_ORDER", "请提供完整笔记顺序");
    const ids = body.ids as string[],
      rows = db
        .prepare("SELECT id FROM pages WHERE space_id=?")
        .all(a.space.id) as { id: string }[];
    if (
      ids.length !== rows.length ||
      new Set(ids).size !== rows.length ||
      ids[0] !== a.space.main_page_id ||
      !ids.every((id) => rows.some((row) => row.id === id))
    )
      fail(422, "INVALID_ORDER", "主剪贴板需固定在第一位，且包含全部笔记");
    db.exec("BEGIN IMMEDIATE");
    try {
      ids.forEach((id, index) =>
        db
          .prepare("UPDATE pages SET position=? WHERE space_id=? AND id=?")
          .run(index, a.space.id, id),
      );
      db.prepare("UPDATE spaces SET revision=revision+1 WHERE id=?").run(
        a.space.id,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    notify(a.space.id);
    return view(getRow(a.space.id)!, a.role, a.tokenHash, req.ip);
  });
  app.post("/api/spaces/:id/password", async (req, reply) => {
    const a = authenticate(req, true);
    if (a.space.access_mode === "public" && a.space.key_revision > 0)
      fail(409, "PROTECTION_REQUIRED", "请通过新的密码设置方式修改");
    const password = passwordValue(req.body);
    limit(passwordRates, `${req.ip}:${a.space.id}:password`, 15, 900_000);
    const salt = password ? randomBytes(16).toString("base64url") : null;
    const digest = password && salt ? derivePassword(password, salt) : null;
    db.prepare(
      "UPDATE spaces SET password_hash=?,password_salt=?,revision=revision+1 WHERE id=?",
    ).run(digest, salt, a.space.id);
    clearSessions(a.space.id);
    closeStreams(a.space.id);
    const row = getRow(a.space.id)!;
    setSession(req, reply, row, a.tokenHash);
    notify(a.space.id);
    return view(row, a.role, a.tokenHash, req.ip);
  });
  app.post("/api/spaces/:id/unlock", async (req, reply) => {
    const a = authenticate(req, false, undefined, true);
    const password =
      a.space.protection_version === 1
        ? (() => {
            const body = object(req.body, ["proof"]);
            if (!tokenValid(body.proof))
              fail(422, "INVALID_PROTECTION", "密码验证信息无效");
            return body.proof as string;
          })()
        : passwordValue(req.body);
    limit(passwordRates, `${req.ip}:${a.space.id}:unlock`, 20, 900_000);
    if (
      a.space.password_hash &&
      (!a.space.password_salt ||
        !sameHash(
          derivePassword(password, a.space.password_salt),
          a.space.password_hash,
        ))
    )
      fail(403, "PASSWORD_INCORRECT", "密码不正确，请重试");
    setSession(req, reply, a.space, a.tokenHash);
    return reply.code(204).send();
  });
  app.post("/api/spaces/:id/lock", async (req, reply) => {
    const id = validId((req.params as { id: string }).id),
      digest = sessionHash(req, id);
    if (digest) {
      sessions.delete(digest);
      for (const stream of streams.get(id) ?? [])
        if (stream.sessionHash === digest) {
          stream.response.end();
          streams.get(id)?.delete(stream);
        }
    }
    reply.header(
      "Set-Cookie",
      `${cookieName(id)}=; Path=/api/spaces; HttpOnly; SameSite=Strict; Max-Age=0${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
    return reply.code(204).send();
  });
  app.patch("/api/spaces/:id", async (req) => {
    const a = authenticate(req, true),
      body = object(req.body, ["name", "retentionSeconds"]);
    if (!Object.keys(body).length)
      fail(422, "INVALID_INPUT", "请提供名称或保留时间");
    const name = body.name === undefined ? undefined : validName(body.name);
    const seconds =
      body.retentionSeconds === undefined
        ? undefined
        : retention(body.retentionSeconds);
    if (name && a.space.name && name !== a.space.name)
      fail(409, "NAME_LOCKED", "空间名称绑定后不能修改");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (name && !a.space.name) {
        assertNameAvailable(name, a.space.id);
        db.prepare(
          "UPDATE spaces SET name=?,revision=revision+1 WHERE id=?",
        ).run(name, a.space.id);
      }
      if (seconds !== undefined)
        db.prepare(
          "UPDATE spaces SET retention_seconds=?,revision=revision+1,expires_at=? WHERE id=?",
        ).run(
          seconds,
          expiry(seconds, Date.parse(a.space.updated_at)),
          a.space.id,
        );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    notify(a.space.id);
    return view(getRow(a.space.id)!, "owner");
  });
  app.get("/api/spaces/:id/shares", async (req) => {
    const a = authenticate(req, true),
      share = getCompact(a.space.id);
    return { share: share ? compactView(share) : null };
  });
  app.post("/api/spaces/:id/shares", async (req, reply) => {
    const a = authenticate(req, true);
    const body =
      req.body === undefined
        ? undefined
        : object(req.body, [
            "token",
            "keyEnvelope",
            "ownerEnvelope",
            "replace",
          ]);
    // Keep the body-less v1 operation and its response shape intact.
    if (body === undefined || !Object.keys(body).length) {
      const token = randomBytes(32).toString("base64url");
      db.prepare(
        "UPDATE spaces SET reader_hash=?,revision=revision+1 WHERE id=?",
      ).run(hash(token), a.space.id);
      if (a.space.reader_hash)
        closeStreams(a.space.id, true, a.space.reader_hash);
      notify(a.space.id);
      return reply.code(201).send({ token });
    }
    if (!tokenValid(body.token)) fail(422, "INVALID_TOKEN", "仅查看链接不完整");
    if (body.replace !== undefined && typeof body.replace !== "boolean")
      fail(422, "INVALID_INPUT", "更新选项无效");
    const key = envelope(body.keyEnvelope),
      owner = envelope(body.ownerEnvelope);
    if (
      Buffer.from(key.ciphertext, "base64url").length !== 48 ||
      Buffer.from(owner.ciphertext, "base64url").length > 1024
    )
      fail(422, "INVALID_PAYLOAD", "分享封装格式无效");
    let created = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = getCompact(a.space.id);
      if (!existing || body.replace === true) {
        db.prepare(
          "INSERT INTO compact_shares(space_id,token_hash,key_iv,key_ciphertext,owner_iv,owner_ciphertext) VALUES(?,?,?,?,?,?) ON CONFLICT(space_id) DO UPDATE SET token_hash=excluded.token_hash,key_iv=excluded.key_iv,key_ciphertext=excluded.key_ciphertext,owner_iv=excluded.owner_iv,owner_ciphertext=excluded.owner_ciphertext",
        ).run(
          a.space.id,
          hash(body.token as string),
          key.iv,
          key.ciphertext,
          owner.iv,
          owner.ciphertext,
        );
        if (body.replace === true)
          db.prepare(
            "UPDATE spaces SET reader_hash=NULL,revision=revision+1 WHERE id=?",
          ).run(a.space.id);
        else
          db.prepare("UPDATE spaces SET revision=revision+1 WHERE id=?").run(
            a.space.id,
          );
        created = true;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    if (body.replace === true) closeStreams(a.space.id, true);
    if (created) notify(a.space.id);
    return reply
      .code(created ? 201 : 200)
      .send({ share: compactView(getCompact(a.space.id)!) });
  });
  app.delete("/api/spaces/:id/shares", async (req, reply) => {
    const a = authenticate(req, true);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM compact_shares WHERE space_id=?").run(a.space.id);
      db.prepare(
        "UPDATE spaces SET reader_hash=NULL,revision=revision+1 WHERE id=?",
      ).run(a.space.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
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
      sessionHash: sessionHash(req, a.space.id),
    };
    existing.add(stream);
    streams.set(a.space.id, existing);
    const timer = setInterval(() => {
      const row = getRow(a.space.id);
      if (
        !row ||
        Date.parse(row.expires_at) <= now() ||
        (row.password_hash && !validSession(req, row, stream.tokenHash)) ||
        (stream.role === "reader" &&
          !sameHash(stream.tokenHash, row.reader_hash) &&
          !sameHash(stream.tokenHash, getCompact(a.space.id)?.token_hash))
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
      (req.method === "GET" ||
        (req.method === "HEAD" &&
          path?.startsWith("/") &&
          nameValid(path.slice(1)))) &&
      (path === "/" ||
        /^\/s\/[0-9a-f-]+$/.test(path) ||
        (path?.startsWith("/") && nameValid(path.slice(1))))
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
    for (const [key, r] of passwordRates)
      if (now() - r.start > 900_000) passwordRates.delete(key);
    for (const [key, session] of sessions)
      if (session.expires <= now()) sessions.delete(key);
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
    sessions.clear();
    db.close();
  });
  return app;
}
