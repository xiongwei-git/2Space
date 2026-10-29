import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type {
  PlainDocument,
  SpaceView,
  PageRecord,
  EncryptedPayload,
} from "@2space/shared";
import {
  MAX_PAGES,
  MAX_CIPHERTEXT_BYTES,
  RETENTION_SECONDS,
} from "@2space/shared";
import {
  decode,
  decryptDocument,
  encryptDocument,
  randomSecret,
  wrapKey,
  unwrapKey,
} from "./crypto.js";
import { request, RequestError, subscribe } from "./api.js";
import { sanitizeHtml } from "./sanitize.js";
const Editor = lazy(() => import("./Editor.js"));
interface Access {
  id: string;
  key: string;
  token: string;
  role: "owner" | "reader";
}
interface LocalPage {
  record: PageRecord;
  doc: PlainDocument;
}
interface Draft {
  baseRevision: number;
  payload: EncryptedPayload;
}
const emptyDoc = (title = "未命名笔记"): PlainDocument => ({
  title,
  html: "<p></p>",
  text: "",
  language: "plaintext",
});
const retentionNames = [
  "30分钟",
  "1小时",
  "6小时",
  "1天",
  "3天",
  "1周",
  "1个月",
];
function message(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请重试";
}
function draftKey(space: string, page: string) {
  return `2space:draft:${space}:${page}`;
}
function cleanDocument(doc: PlainDocument) {
  return { ...doc, html: sanitizeHtml(doc.html) };
}
export default function App() {
  const [ready, setReady] = useState(false);
  const [access, setAccess] = useState<Access | null>(null),
    [space, setSpace] = useState<SpaceView | null>(null),
    [pages, setPages] = useState<LocalPage[]>([]),
    [active, setActive] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [status, setStatus] = useState("尚未创建空间"),
    [online, setOnline] = useState(false),
    [fatal, setFatal] = useState(""),
    [modal, setModal] = useState<"share" | "privacy" | "open" | null>(null),
    [shareLink, setShareLink] = useState(""),
    [sharePassword, setSharePassword] = useState(""),
    [qr, setQr] = useState(""),
    [openLink, setOpenLink] = useState(""),
    [unlock, setUnlock] = useState<URLSearchParams | null>(null),
    [unlockPassword, setUnlockPassword] = useState(""),
    [conflicts, setConflicts] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!modal && !unlock) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".modal");
    const background = Array.from(
      document.querySelector(".app")?.children || [],
    )
      .filter((element) => !element.classList.contains("modal-backdrop"))
      .map((element) => ({
        element: element as HTMLElement,
        inert: (element as HTMLElement).inert,
      }));
    for (const { element } of background) element.inert = true;
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),textarea,select,a[href],[tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    controls()[0]?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && modal) setModal(null);
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0],
        last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      for (const { element, inert } of background) element.inert = inert;
      previous?.focus();
    };
  }, [modal, unlock]);
  const started = useRef(false),
    accessRef = useRef<Access | null>(null),
    pagesRef = useRef<LocalPage[]>([]),
    dirty = useRef(new Set<string>()),
    saving = useRef(new Set<string>()),
    timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()),
    editVersions = useRef(new Map<string, number>()),
    spaceRevision = useRef(0),
    refreshSequence = useRef(0),
    conflictRef = useRef(new Set<string>()),
    deferredRefresh = useRef(false),
    retries = useRef(new Map<string, number>());
  function publish(next: LocalPage[]) {
    pagesRef.current = next;
    setPages(next);
  }
  function markConflict(pageId: string) {
    conflictRef.current.add(pageId);
    const timer = timers.current.get(pageId);
    if (timer) clearTimeout(timer);
    setConflicts(new Set(conflictRef.current));
    setStatus("存在版本冲突，请选择保留方式");
  }
  async function decodeSpace(view: SpaceView, a: Access, initial = false) {
    const seq = ++refreshSequence.current;
    const decoded = await Promise.all(
      view.pages.map(async (record) => ({
        record,
        doc: cleanDocument(await decryptDocument(record.payload, a.key)),
      })),
    );
    if (
      seq !== refreshSequence.current ||
      view.revision < spaceRevision.current
    )
      return;
    if (saving.current.size) {
      deferredRefresh.current = true;
      return;
    }
    const old = pagesRef.current;
    const merged = await Promise.all(
      decoded.map(async (remote) => {
        const local = old.find((p) => p.record.id === remote.record.id);
        if (local && dirty.current.has(remote.record.id)) {
          if (remote.record.revision > local.record.revision)
            markConflict(remote.record.id);
          return local;
        }
        if (initial && a.role === "owner") {
          try {
            const raw = localStorage.getItem(draftKey(a.id, remote.record.id));
            if (raw) {
              const draft = JSON.parse(raw) as Draft;
              const doc = cleanDocument(
                await decryptDocument(draft.payload, a.key),
              );
              dirty.current.add(remote.record.id);
              if (draft.baseRevision !== remote.record.revision)
                markConflict(remote.record.id);
              setStatus("已恢复本机加密草稿，请检查后保存");
              return { record: remote.record, doc };
            }
          } catch {
            setNotice("本机草稿无法恢复，服务器版本仍可使用。");
          }
        }
        return remote;
      }),
    );
    // A remotely deleted page with local edits must remain recoverable, never silently discarded.
    for (const local of old) {
      if (
        dirty.current.has(local.record.id) &&
        !merged.some((p) => p.record.id === local.record.id)
      ) {
        merged.push(local);
        markConflict(local.record.id);
      }
    }
    if (
      seq !== refreshSequence.current ||
      view.revision < spaceRevision.current
    )
      return;
    if (saving.current.size) {
      deferredRefresh.current = true;
      return;
    }
    for (let index = 0; index < merged.length; index++) {
      const latest = pagesRef.current.find(
        (p) => p.record.id === merged[index].record.id,
      );
      if (
        latest &&
        (dirty.current.has(latest.record.id) ||
          latest.record.revision > merged[index].record.revision)
      )
        merged[index] = latest;
    }
    if (a.role !== view.role) {
      const verified = { ...a, role: view.role };
      accessRef.current = verified;
      setAccess(verified);
    }
    spaceRevision.current = view.revision;
    setSpace(view);
    publish(merged);
    setActive((current) =>
      merged.some((p) => p.record.id === current)
        ? current
        : merged[0]?.record.id || "",
    );
  }
  async function refresh(initial = false, a = accessRef.current) {
    if (!a) return;
    if (saving.current.size) {
      deferredRefresh.current = true;
      return;
    }
    try {
      const view = await request<SpaceView>(`/spaces/${a.id}`, a.token);
      await decodeSpace(view, a, initial);
    } catch (e) {
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
        setOnline(false);
        setFatal(
          "空间已过期、分享已撤销，或访问凭证无效。当前已打开的内容可复制备份。",
        );
      } else if (
        e instanceof DOMException ||
        (e instanceof Error && e.message === "内容格式不正确")
      )
        setFatal("无法解密此空间，请核对完整链接与解锁密钥。");
      else setNotice("暂时无法同步，编辑草稿会保留在本机。");
    }
  }
  async function enter(a: Access) {
    setReady(false);
    accessRef.current = a;
    setAccess(a);
    setFatal("");
    setStatus(a.role === "reader" ? "只读访问" : "已加密保存");
    await refresh(true, a);
    setReady(true);
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(location.hash.slice(1));
    const id = location.pathname.match(/^\/s\/([A-Za-z0-9_-]+)$/)?.[1];
    if (!id) return;
    const token = params.get("m") || params.get("r"),
      key = params.get("k");
    if (!token) {
      setFatal("链接不完整，请使用包含访问凭证的完整链接。");
      return;
    }
    if (params.get("w")) {
      setUnlock(params);
      return;
    }
    if (!key) {
      setFatal("链接缺少解密密钥，请向分享者索取完整链接。");
      return;
    }
    void enter({ id, key, token, role: params.has("m") ? "owner" : "reader" });
  }, []);
  useEffect(() => {
    if (!access || !ready) return;
    const controller = new AbortController();
    void subscribe(
      access.id,
      access.token,
      controller.signal,
      () => {
        void refresh();
      },
      setOnline,
    );
    return () => controller.abort();
  }, [access?.id, access?.token, ready]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  useEffect(() => {
    // A capability change must discard the previous role, fatal state and SSE session.
    // Reload also preserves the existing beforeunload warning for unsaved drafts.
    const handler = () => location.reload();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);
  useEffect(() => {
    const handler = () => {
      for (const id of dirty.current) void save(id);
    };
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [conflicts]);
  async function createSpace() {
    if (busy) return;
    setBusy(true);
    setFatal("");
    try {
      const key = randomSecret(),
        token = randomSecret(),
        pageId = crypto.randomUUID(),
        payload = await encryptDocument(emptyDoc("我的剪贴板"), key);
      const view = await request<SpaceView>("/spaces", undefined, "POST", {
        ownerToken: token,
        retentionSeconds: 86400,
        page: { id: pageId, payload },
      });
      const a: Access = { id: view.id, key, token, role: "owner" };
      history.replaceState(
        null,
        "",
        `/s/${view.id}#${new URLSearchParams({ k: key, m: token })}`,
      );
      await enter(a);
      setNotice("空间已创建。请保存管理链接；清除链接后无法找回。");
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  }
  function updatePage(id: string, change: Partial<PlainDocument>) {
    const a = accessRef.current;
    if (!a || a.role !== "owner") return;
    const current = pagesRef.current.find((p) => p.record.id === id);
    if (!current) return;
    const doc = { ...current.doc, ...change };
    publish(
      pagesRef.current.map((p) => (p.record.id === id ? { ...p, doc } : p)),
    );
    dirty.current.add(id);
    retries.current.delete(id);
    const version = (editVersions.current.get(id) || 0) + 1;
    editVersions.current.set(id, version);
    setStatus("未保存 · 正在准备加密");
    const prior = timers.current.get(id);
    if (prior) clearTimeout(prior);
    void encryptDocument(doc, a.key).then((payload) => {
      if (dirty.current.has(id) && editVersions.current.get(id) === version) {
        try {
          localStorage.setItem(
            draftKey(a.id, id),
            JSON.stringify({
              baseRevision: current.record.revision,
              payload,
            } satisfies Draft),
          );
        } catch {
          setNotice("浏览器无法保存本机草稿，请保持页面打开。");
        }
      }
    });
    timers.current.set(
      id,
      setTimeout(() => {
        void save(id);
      }, 650),
    );
  }
  async function save(id: string) {
    const a = accessRef.current;
    if (
      !a ||
      a.role !== "owner" ||
      !dirty.current.has(id) ||
      saving.current.has(id) ||
      conflictRef.current.has(id)
    )
      return;
    const item = pagesRef.current.find((p) => p.record.id === id);
    if (!item) return;
    saving.current.add(id);
    setStatus("正在加密保存…");
    const version = editVersions.current.get(id) || 0;
    let retry = false;
    try {
      const payload = await encryptDocument(item.doc, a.key);
      if (decode(payload.ciphertext).byteLength > MAX_CIPHERTEXT_BYTES)
        throw Error("内容超出单篇容量，请拆成多篇笔记。");
      const record = await request<PageRecord>(
        `/spaces/${a.id}/pages/${id}`,
        a.token,
        "PUT",
        { expectedRevision: item.record.revision, payload },
      );
      publish(
        pagesRef.current.map((p) =>
          p.record.id === id ? { ...p, record } : p,
        ),
      );
      retries.current.delete(id);
      if ((editVersions.current.get(id) || 0) === version) {
        dirty.current.delete(id);
        try {
          localStorage.removeItem(draftKey(a.id, id));
        } catch {}
      } else {
        const latest = pagesRef.current.find((p) => p.record.id === id);
        if (latest) {
          const newerVersion = editVersions.current.get(id);
          const newerPayload = await encryptDocument(latest.doc, a.key);
          if (
            dirty.current.has(id) &&
            editVersions.current.get(id) === newerVersion
          ) {
            try {
              localStorage.setItem(
                draftKey(a.id, id),
                JSON.stringify({
                  baseRevision: record.revision,
                  payload: newerPayload,
                } satisfies Draft),
              );
            } catch {}
          }
        }
      }
      setStatus(dirty.current.size ? "仍有草稿待保存" : "已加密保存");
    } catch (e) {
      if (e instanceof RequestError && e.status === 409) markConflict(id);
      else {
        retry =
          (!(e instanceof RequestError) ||
            e.status >= 500 ||
            e.status === 429) &&
          !(e instanceof Error && e.message.includes("超出")) &&
          (retries.current.get(id) || 0) < 3;
        setStatus(`保存失败：${message(e)}。草稿保留在本机`);
      }
    } finally {
      saving.current.delete(id);
      if (deferredRefresh.current && !saving.current.size) {
        deferredRefresh.current = false;
        void refresh();
      }
      if (dirty.current.has(id) && !conflictRef.current.has(id) && retry) {
        const count = (retries.current.get(id) || 0) + 1;
        retries.current.set(id, count);
        timers.current.set(
          id,
          setTimeout(() => {
            void save(id);
          }, 2000 * count),
        );
      } else if (
        dirty.current.has(id) &&
        !conflictRef.current.has(id) &&
        (editVersions.current.get(id) || 0) > version
      ) {
        timers.current.set(
          id,
          setTimeout(() => {
            void save(id);
          }, 650),
        );
      }
    }
  }
  async function addPage(doc = emptyDoc()) {
    const a = accessRef.current;
    if (!a || busy) return false;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const payload = await encryptDocument(doc, a.key);
      const record = await request<PageRecord>(
        `/spaces/${a.id}/pages`,
        a.token,
        "POST",
        { id, payload },
      );
      publish([...pagesRef.current, { record, doc }]);
      setActive(id);
      setStatus("已加密保存");
      void refresh();
      return true;
    } catch (e) {
      setNotice(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function deletePage() {
    const a = accessRef.current,
      item = pagesRef.current.find((p) => p.record.id === active);
    if (!a || !item || pages.length <= 1) return;
    if (!confirm("删除这篇笔记？服务器内容将被永久删除，此操作无法撤销。"))
      return;
    try {
      await request(`/spaces/${a.id}/pages/${active}`, a.token, "DELETE", {
        expectedRevision: item.record.revision,
      });
      dirty.current.delete(active);
      try {
        localStorage.removeItem(draftKey(a.id, active));
      } catch {}
      conflictRef.current.delete(active);
      setConflicts(new Set(conflictRef.current));
      publish(pagesRef.current.filter((p) => p.record.id !== active));
      setActive(pagesRef.current[0]?.record.id || "");
      void refresh();
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function resolveConflict(keepLocal: boolean) {
    const a = accessRef.current,
      local = pagesRef.current.find((p) => p.record.id === active);
    if (!a || !local) return;
    try {
      if (keepLocal) {
        if (pages.length >= MAX_PAGES) {
          setNotice("请先下载或复制本机草稿，再加载远端版本；空间最多6篇。");
          return;
        }
        const copied = await addPage({
          ...local.doc,
          title: `${local.doc.title}（本机副本）`,
        });
        if (!copied) return;
      }
      dirty.current.delete(local.record.id);
      try {
        localStorage.removeItem(draftKey(a.id, local.record.id));
      } catch {}
      conflictRef.current.delete(local.record.id);
      setConflicts(new Set(conflictRef.current));
      await refresh();
      setStatus("版本冲突已处理");
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function copy(rich = false) {
    const item = pagesRef.current.find((p) => p.record.id === active);
    if (!item) return;
    try {
      if (rich && typeof ClipboardItem !== "undefined")
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([sanitizeHtml(item.doc.html)], {
              type: "text/html",
            }),
            "text/plain": new Blob([item.doc.text], { type: "text/plain" }),
          }),
        ]);
      else await navigator.clipboard.writeText(item.doc.text);
      setNotice(
        rich && typeof ClipboardItem !== "undefined"
          ? "已复制内容与格式"
          : "已复制纯文本",
      );
    } catch {
      setNotice("浏览器未允许复制，请在编辑区选中文字后手动复制。");
    }
  }
  function download() {
    const item = pagesRef.current.find((p) => p.record.id === active);
    if (!item) return;
    const url = URL.createObjectURL(
      new Blob([item.doc.text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download =
      (item.doc.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "笔记") +
      ".txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function makeShare() {
    const a = accessRef.current;
    if (!a) return;
    setBusy(true);
    try {
      const { token } = await request<{ token: string }>(
        `/spaces/${a.id}/shares`,
        a.token,
        "POST",
      );
      const params = new URLSearchParams({ r: token });
      if (sharePassword) {
        const wrapped = await wrapKey(a.key, sharePassword);
        Object.entries(wrapped).forEach(([k, v]) => params.set(k, v));
      } else params.set("k", a.key);
      const link = `${location.origin}/s/${a.id}#${params}`;
      setShareLink(link);
      const QRCode = await import("qrcode");
      setQr(
        await QRCode.toDataURL(link, {
          width: 240,
          margin: 2,
          errorCorrectionLevel: "M",
        }),
      );
      setNotice("已生成只读链接，之前的只读链接已失效。");
    } catch (e) {
      setNotice(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!access) return;
    try {
      await request(`/spaces/${access.id}/shares`, access.token, "DELETE");
      setShareLink("");
      setQr("");
      setNotice("只读链接已撤销。已经被复制的内容无法收回。");
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function openExisting() {
    try {
      const url = new URL(openLink, location.origin);
      if (
        url.origin !== location.origin ||
        !/^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
        !url.hash
      )
        throw Error("请输入本站完整的空间链接。");
      if (dirty.current.size && !confirm("仍有草稿未保存，确定离开当前空间？"))
        return;
      location.assign(url.href);
      location.reload();
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function unlockSpace() {
    if (!unlock) return;
    setBusy(true);
    try {
      const key = await unwrapKey(unlock, unlockPassword),
        id = location.pathname.split("/")[2],
        token = unlock.get("m") || unlock.get("r") || "";
      setUnlock(null);
      setUnlockPassword("");
      await enter({
        id,
        key,
        token,
        role: unlock.has("m") ? "owner" : "reader",
      });
    } catch {
      setNotice("密码不正确，或链接不完整。");
    } finally {
      setBusy(false);
    }
  }
  async function deleteSpace() {
    const a = accessRef.current;
    if (!a || a.role !== "owner" || busy) return;
    if (
      !confirm(
        "永久删除整个空间及全部笔记？所有分享链接将失效，本机加密草稿也将清除。此操作无法恢复。",
      )
    )
      return;
    setBusy(true);
    try {
      await request(`/spaces/${a.id}`, a.token, "DELETE");
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
      dirty.current.clear();
      try {
        const prefix = `2space:draft:${a.id}:`;
        for (const key of Object.keys(localStorage)) {
          if (key.startsWith(prefix)) localStorage.removeItem(key);
        }
      } catch {}
      setReady(false);
      accessRef.current = null;
      history.replaceState(null, "", "/");
      location.replace("/");
    } catch (error) {
      setNotice(message(error));
      setBusy(false);
    }
  }
  const current = pages.find((p) => p.record.id === active),
    reader = access?.role === "reader";
  return (
    <div className={access ? "app app-workspace" : "app"}>
      <header className="topbar">
        <a className="brand" href="/" aria-label="2Space 首页">
          <span className="brand-symbol">
            <i />
            <i />
          </span>
          <span>2Space</span>
        </a>
        <span className="tagline">这边复制，那边就有。</span>
        <div className="top-actions">
          <button className="text-button" onClick={() => setModal("privacy")}>
            隐私与安全
          </button>
          <button className="secondary" onClick={() => setModal("open")}>
            打开空间
          </button>
          {access && !reader && (
            <button
              className="primary"
              onClick={() => {
                setShareLink("");
                setQr("");
                setSharePassword("");
                setModal("share");
              }}
            >
              分享空间
            </button>
          )}
        </div>
      </header>
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {fatal && (
        <div className="error-banner" role="alert">
          {fatal}
        </div>
      )}
      {!access ? (
        <main className="welcome">
          <div className="welcome-copy">
            <span className="intro-mark">两端之间，留一小块空间</span>
            <h1>
              粘贴过来，
              <br />
              带着格式过去。
            </h1>
            <p>
              一段文字、一份代码，随手放下，换台设备接着用。
              <br />
              轻量编辑，正文加密，分享由你决定。
            </p>
            <button
              className="primary large"
              onClick={() => void createSpace()}
              disabled={busy || !!unlock}
            >
              {busy ? "正在准备空间…" : "创建我的空间"}
            </button>
            <small>无需注册 · 默认保留1天 · 请妥善保存管理链接</small>
          </div>
          <div
            className="welcome-preview"
            role="region"
            aria-label="内容传递示意"
          >
            <div className="preview-caption">
              <span className="dot" /> 在这里放下
            </div>
            <div className="preview-paper">
              <h2>随手记，不必重新排版</h2>
              <p>
                重点依然<strong>清清楚楚</strong>，链接与列表一起保留。
              </p>
              <ul>
                <li>网页里有用的几句话</li>
                <li>另一台电脑要用的命令</li>
              </ul>
              <pre tabIndex={0} role="region" aria-label="代码示例">
                <code>
                  <span>const</span> space = <em>'just enough'</em>;
                </code>
              </pre>
              <div className="preview-footer">
                <span>正文在浏览器加密</span>
                <b>另一端接着用 ↗</b>
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <h2>我的空间</h2>
              <span>
                {pages.length}/{MAX_PAGES}
              </span>
            </div>
            <p className="space-mode">
              {reader ? "只读访问 · 可复制与下载" : "私密空间 · 管理链接可编辑"}
            </p>
            <nav aria-label="笔记列表">
              {pages.map((p, index) => (
                <button
                  key={p.record.id}
                  className={
                    active === p.record.id ? "page-item selected" : "page-item"
                  }
                  onClick={() => setActive(p.record.id)}
                >
                  <span className="page-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>
                    <b>{p.doc.title || "未命名笔记"}</b>
                    <small>{p.doc.text.slice(0, 32) || "还没有内容"}</small>
                  </span>
                  {conflicts.has(p.record.id) && (
                    <span className="conflict-dot" title="版本冲突">
                      !
                    </span>
                  )}
                </button>
              ))}
            </nav>
            {!reader && (
              <button
                className="add-page"
                disabled={busy || pages.length >= MAX_PAGES}
                onClick={() => void addPage()}
              >
                ＋ 新建笔记
              </button>
            )}
            <div className="space-details">
              <span className={online ? "connection connected" : "connection"}>
                {online ? "同步已连接" : "正在连接同步"}
              </span>
              <label>
                保留时间
                <select
                  disabled={reader || busy}
                  value={space?.retentionSeconds || 86400}
                  onChange={async (e) => {
                    if (!access) return;
                    try {
                      const next = await request<SpaceView>(
                        `/spaces/${access.id}`,
                        access.token,
                        "PATCH",
                        { retentionSeconds: Number(e.target.value) },
                      );
                      setSpace(next);
                      setNotice("保留时间已更新，从最近修改时间起算。");
                    } catch (error) {
                      setNotice(message(error));
                    }
                  }}
                >
                  {RETENTION_SECONDS.map((seconds, index) => (
                    <option key={seconds} value={seconds}>
                      {retentionNames[index]}
                    </option>
                  ))}
                </select>
              </label>
              <small>
                每次修改重新计时，访问不会续期。
                {space && (
                  <>
                    预计到期
                    <br />
                    {new Date(space.expiresAt).toLocaleString("zh-CN")}
                  </>
                )}
              </small>
            </div>
          </aside>
          <section className="document-panel">
            <div className="document-header">
              <div className="document-title">
                <span>{reader ? "只读笔记" : "轻量笔记"}</span>
                <input
                  aria-label="笔记标题"
                  placeholder="未命名笔记"
                  maxLength={60}
                  value={current?.doc.title || ""}
                  disabled={reader || !current}
                  onChange={(e) =>
                    updatePage(active, { title: e.target.value })
                  }
                />
              </div>
              <div className="document-actions">
                <button onClick={() => void copy(true)} className="secondary">
                  复制格式
                </button>
                <button onClick={() => void copy()} className="text-button">
                  纯文本
                </button>
                <button onClick={download} className="text-button">
                  下载
                </button>
              </div>
            </div>
            {conflicts.has(active) && (
              <div className="conflict-banner" role="alert">
                <b>另一端也修改了这篇笔记</b>
                <p>
                  本机内容还在，没有覆盖任何版本。先保留为新笔记，或放弃本机修改并加载远端版本。
                </p>
                <button
                  className="secondary"
                  onClick={() => void resolveConflict(true)}
                >
                  保留本机副本
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    if (confirm("放弃本机未保存修改，加载远端版本？"))
                      void resolveConflict(false);
                  }}
                >
                  加载远端版本
                </button>
              </div>
            )}
            {current ? (
              <Suspense
                fallback={
                  <div className="editor-loading">正在打开轻量编辑器…</div>
                }
              >
                <Editor
                  html={current.doc.html}
                  readOnly={!!reader || !!fatal}
                  language={current.doc.language}
                  onChange={(html, text) => updatePage(active, { html, text })}
                  onLanguage={(language) => updatePage(active, { language })}
                  onNotice={setNotice}
                />
              </Suspense>
            ) : (
              <div className="editor-loading">正在解密内容…</div>
            )}
            <footer className="document-footer">
              <span
                className={
                  status.startsWith("保存失败")
                    ? "save-state failed"
                    : "save-state"
                }
                role="status"
              >
                {reader ? "只读内容" : status}
              </span>
              <span className="character-count">
                {current?.doc.text.length || 0} 字符
              </span>
              {!reader && (
                <>
                  <button
                    className="text-button"
                    onClick={() => void save(active)}
                  >
                    立即保存
                  </button>
                  <button
                    className="text-button danger"
                    disabled={pages.length <= 1}
                    onClick={() => void deletePage()}
                  >
                    删除笔记
                  </button>
                </>
              )}
            </footer>
          </section>
        </main>
      )}
      <footer className="site-footer">
        <span className="version">2Space 1.0</span>
        <span>文本与代码，现在刚刚好。</span>
      </footer>
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "share"
                ? "分享空间"
                : modal === "open"
                  ? "打开空间"
                  : "隐私与安全"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="关闭窗口"
              onClick={() => setModal(null)}
            >
              ×
            </button>
            {modal === "privacy" ? (
              <>
                <h2>私密可控，说明白一点</h2>
                <p>
                  正文、笔记标题和代码在浏览器加密，服务器保存密文。服务器仍能看到空间编号、时间和内容大小。
                </p>
                <ul>
                  <li>管理链接可以编辑，请只交给自己的设备。</li>
                  <li>只读链接只能查看，可撤销。已经复制的内容无法收回。</li>
                  <li>没有账户找回；请保存管理链接，密钥丢失无法解密。</li>
                  <li>
                    本机待保存草稿同样加密。受感染的设备、恶意扩展或被篡改的网页仍可能读取内容。
                  </li>
                  <li>
                    粘贴会去除脚本、图片和复杂样式，不会静默加载外部图片。
                  </li>
                </ul>
                <p className="muted">
                  当前为本地开发版本，公网部署必须使用
                  HTTPS。没有广告和第三方统计。
                </p>
                {access?.role === "owner" && (
                  <div className="share-bottom">
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => void deleteSpace()}
                    >
                      删除整个空间
                    </button>
                    <small className="risk-note">
                      永久删除全部笔记，无法恢复。
                    </small>
                  </div>
                )}
              </>
            ) : modal === "open" ? (
              <>
                <h2>打开另一个空间</h2>
                <p>粘贴完整的管理或只读链接，解密信息只在浏览器处理。</p>
                <textarea
                  aria-label="空间链接"
                  value={openLink}
                  onChange={(e) => setOpenLink(e.target.value)}
                  placeholder="粘贴空间链接"
                />
                <button className="primary" onClick={() => void openExisting()}>
                  打开空间
                </button>
              </>
            ) : (
              <>
                <h2>把空间交给另一端</h2>
                <p>当前只读分享包含空间里的全部笔记。重新生成后旧链接失效。</p>
                <label className="field-label">
                  可选：设置链接解锁密码
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="留空则凭链接查看"
                  />
                </label>
                <button
                  className="primary"
                  disabled={busy || dirty.current.size > 0}
                  onClick={() => void makeShare()}
                >
                  {busy ? "正在生成…" : "生成只读链接"}
                </button>
                {dirty.current.size > 0 && (
                  <p className="muted">先保存或处理冲突，再分享最新内容。</p>
                )}
                {shareLink && (
                  <>
                    <textarea
                      aria-label="只读分享链接"
                      readOnly
                      value={shareLink}
                    />
                    {qr && <img className="qr" src={qr} alt="只读空间二维码" />}
                    <button
                      className="secondary"
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(shareLink)
                          .then(() => setNotice("只读链接已复制"))
                          .catch(() => setNotice("请手动复制上方链接"))
                      }
                    >
                      复制只读链接
                    </button>
                  </>
                )}
                <div className="share-bottom">
                  <button
                    className="text-button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(location.href)
                        .then(() =>
                          setNotice("管理链接已复制，请仅交给信任的设备。"),
                        )
                        .catch(() => setNotice("请从地址栏复制管理链接。"))
                    }
                  >
                    复制本机管理链接
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => void revoke()}
                  >
                    撤销只读分享
                  </button>
                </div>
                <small>
                  密码用于包装此链接的解密密钥，不会更改已发出的其他链接。
                </small>
              </>
            )}
          </section>
        </div>
      )}
      {unlock && (
        <div className="modal-backdrop">
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="解锁空间"
            onSubmit={(e) => {
              e.preventDefault();
              void unlockSpace();
            }}
          >
            <h2>解锁这份空间</h2>
            <p>输入分享者提供的密码。密码仅在本机用于解密。</p>
            <input
              aria-label="解锁密码"
              type="password"
              autoComplete="current-password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              autoFocus
            />
            <button className="primary" disabled={busy}>
              {busy ? "正在解锁…" : "解锁内容"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
