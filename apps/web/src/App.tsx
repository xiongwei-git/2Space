import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type {
  PlainDocument,
  SpaceView,
  PageRecord,
  EncryptedPayload,
  CompactShareResponse,
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
  wrapKey,
  unwrapKey,
} from "./crypto.js";
import { request, RequestError, subscribe } from "./api.js";
import { sanitizeHtml } from "./sanitize.js";
import {
  accessCodeLink,
  compactLink,
  createShareDescriptor,
  deriveOwner,
  deriveReader,
  newSeed,
  parseEntry,
  randomSpaceName,
  recoverShareSeed,
  unwrapReaderKey,
  validSpaceName,
} from "./compact.js";
const Editor = lazy(() => import("./Editor.js"));
interface Access {
  id: string;
  key: string;
  token: string;
  role: "owner" | "reader";
  name?: string;
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
  return error instanceof Error && /\p{Script=Han}/u.test(error.message)
    ? error.message
    : "操作没有完成，请稍后重试。";
}
function draftKey(space: string, page: string) {
  return `2space:draft:${space}:${page}`;
}
function cleanDocument(doc: PlainDocument) {
  return { ...doc, html: sanitizeHtml(doc.html) };
}
export default function App() {
  const [ready, setReady] = useState(false);
  const [spaceName, setSpaceName] = useState(randomSpaceName);
  const [lockedName, setLockedName] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [nameConflict, setNameConflict] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
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
          'button:not(:disabled),input:not(:disabled),textarea,select,summary,a[href],[tabindex="0"]',
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
    retries = useRef(new Map<string, number>()),
    preparingShare = useRef(false);
  function publish(next: LocalPage[]) {
    pagesRef.current = next;
    setPages(next);
  }
  function markConflict(pageId: string) {
    conflictRef.current.add(pageId);
    const timer = timers.current.get(pageId);
    if (timer) clearTimeout(timer);
    setConflicts(new Set(conflictRef.current));
    setStatus("其他设备也有修改，请选择要保留的内容");
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
              setStatus("已恢复上次未保存的内容，请检查后保存。");
              return { record: remote.record, doc };
            }
          } catch {
            setNotice("上次未保存的内容无法恢复，已为你打开保存过的内容。");
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
    if (a.role !== view.role || a.name !== view.name) {
      const verified = { ...a, role: view.role, name: view.name };
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
          "这个链接已无法打开。空间可能已到期或停止分享，你仍可复制此页已显示的内容。",
        );
      } else if (
        e instanceof DOMException ||
        (e instanceof Error && e.message === "内容格式不正确")
      )
        setFatal("无法打开内容，请重新复制完整链接后打开。");
      else
        setNotice(
          "暂时无法获取其他设备的修改。你在此页的修改还在，请稍后重试。",
        );
    }
  }
  async function enter(a: Access, initialView?: SpaceView) {
    setReady(false);
    accessRef.current = a;
    setAccess(a);
    setFatal("");
    setStatus(a.role === "reader" ? "仅查看" : "已保存");
    if (initialView) await decodeSpace(initialView, a, true);
    else await refresh(true, a);
    setReady(true);
  }
  async function initialize() {
    try {
      const entry = parseEntry(new URL(location.href));
      if (entry.kind === "home") return;
      if (entry.kind === "locked") {
        setLockedName(entry.name);
        return;
      }
      if (entry.kind === "legacy") {
        const { params, id } = entry;
        const token = params.get("m") || params.get("r"),
          key = params.get("k");
        if (!token) throw Error("链接不完整，请重新复制后打开。");
        if (params.get("w")) {
          setUnlock(params);
          return;
        }
        if (!key) throw Error("链接不完整，请向分享者索取完整链接。");
        await enter({
          id,
          key,
          token,
          role: params.has("m") ? "owner" : "reader",
        });
        return;
      }
      setBusy(true);
      if (entry.kind === "owner") {
        const { key, token } = await deriveOwner(entry.seed);
        const view = await request<SpaceView>(
          `/spaces/by-name/${entry.name}`,
          token,
        );
        await enter(
          { id: view.id, key, token, role: view.role, name: entry.name },
          view,
        );
      } else {
        const { token } = await deriveReader(entry.seed);
        const view = await request<SpaceView>(
          `/spaces/by-name/${entry.name}`,
          token,
        );
        if (!view.readerKey)
          throw Error("分享链接已失效，请向分享者索取新链接。");
        const key = await unwrapReaderKey(view.readerKey, entry.seed);
        await enter(
          { id: view.id, key, token, role: view.role, name: entry.name },
          view,
        );
      }
    } catch (error) {
      setFatal(
        error instanceof RequestError && [401, 403, 404].includes(error.status)
          ? "无法打开空间。请检查访问码，或向分享者索取新链接。"
          : error instanceof DOMException
            ? "无法打开内容，请重新复制完整链接后打开。"
            : message(error),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void initialize();
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
    if (!validSpaceName(spaceName)) {
      setNotice(
        "名称需3–32个小写字母、数字或中划线，首尾不能是中划线。请检查或换一个名称。",
      );
      return;
    }
    setBusy(true);
    setFatal("");
    setNameConflict(false);
    try {
      const seed = newSeed("owner"),
        { key, token } = await deriveOwner(seed),
        pageId = crypto.randomUUID(),
        payload = await encryptDocument(emptyDoc("我的剪贴板"), key);
      const view = await request<SpaceView>("/spaces", undefined, "POST", {
        name: spaceName,
        ownerToken: token,
        retentionSeconds: 86400,
        page: { id: pageId, payload },
      });
      history.replaceState(
        null,
        "",
        compactLink(location.origin, spaceName, "owner", seed),
      );
      await enter(
        {
          id: view.id,
          key,
          token,
          role: "owner",
          name: view.name || spaceName,
        },
        view,
      );
      setNotice("空间已创建。请保存完整链接，只记住名称无法重新打开。");
    } catch (error) {
      if (error instanceof RequestError && error.code === "NAME_TAKEN") {
        setNameConflict(true);
        setNotice("这个名称已被使用，请换一个名称，或使用访问码打开已有空间。");
      } else setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  function openByCode() {
    try {
      location.assign(accessCodeLink(location.origin, lockedName, accessCode));
    } catch (error) {
      setNotice(message(error));
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
    setStatus("有修改尚未保存");
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
          setNotice("未保存的修改只能暂留此页，请勿关闭，尽快保存或复制备份。");
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
    setStatus("保存中…");
    const version = editVersions.current.get(id) || 0;
    let retry = false;
    try {
      const payload = await encryptDocument(item.doc, a.key);
      if (decode(payload.ciphertext).byteLength > MAX_CIPHERTEXT_BYTES)
        throw Error("单篇内容超出限制，请分成几篇笔记后保存。");
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
      setStatus(dirty.current.size ? "还有修改尚未保存" : "已保存");
    } catch (e) {
      if (e instanceof RequestError && e.status === 409) markConflict(id);
      else {
        retry =
          (!(e instanceof RequestError) ||
            e.status >= 500 ||
            e.status === 429) &&
          !(e instanceof Error && e.message.includes("超出")) &&
          (retries.current.get(id) || 0) < 3;
        setStatus(`保存失败：${message(e)}。修改仍在此页，请勿关闭。`);
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
      setStatus("已保存");
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
    if (!confirm("删除这篇笔记？删除后无法找回。")) return;
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
          setNotice(
            "空间最多6篇笔记。请先复制或下载你的修改，再使用已保存的内容。",
          );
          return;
        }
        const copied = await addPage({
          ...local.doc,
          title: `${local.doc.title}（我的修改）`,
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
      setStatus("已保留你选择的内容");
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
          ? "已复制，格式已保留。"
          : "已复制文字。",
      );
    } catch {
      setNotice("自动复制未成功，请选中文字后手动复制。");
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
  async function ensureShareName(a: Access): Promise<string> {
    const remember = (view: SpaceView): string => {
      if (!view.name) throw Error("空间名称未保存，请重试。");
      const named = { ...a, name: view.name };
      accessRef.current = named;
      setAccess(named);
      setSpace(view);
      return view.name;
    };
    if (a.name) return a.name;
    const current = await request<SpaceView>(`/spaces/${a.id}`, a.token);
    if (current.name) return remember(current);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return remember(
          await request<SpaceView>(`/spaces/${a.id}`, a.token, "PATCH", {
            name: randomSpaceName(),
          }),
        );
      } catch (error) {
        if (error instanceof RequestError && error.code === "NAME_LOCKED")
          return remember(await request<SpaceView>(`/spaces/${a.id}`, a.token));
        if (!(error instanceof RequestError) || error.code !== "NAME_TAKEN")
          throw error;
      }
    }
    throw Error("暂时无法设置空间名称，请重试。");
  }
  async function copyShare(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setShareMessage("链接已复制，对方打开后可查看、复制和下载。");
    } catch {
      setShareMessage(
        "自动复制未成功，请点击复制按钮，或选中下方链接手动复制。",
      );
    }
  }
  async function showShareLink(link: string) {
    setShareLink(link);
    setQr("");
    await copyShare(link);
    try {
      const QRCode = await import("qrcode");
      setQr(
        await QRCode.toDataURL(link, {
          width: 240,
          margin: 2,
          errorCorrectionLevel: "M",
        }),
      );
    } catch {
      setShareMessage("二维码暂时无法显示，请复制链接分享。");
    }
  }
  async function makeShare(replace = false, passwordLink = false) {
    const a = accessRef.current;
    if (!a || a.role !== "owner" || preparingShare.current) return;
    if (
      replace &&
      !confirm(
        "更换后，之前的仅查看链接（包括带密码的链接）都将无法打开。是否继续？",
      )
    )
      return;
    preparingShare.current = true;
    setBusy(true);
    setShareMessage("正在准备分享链接…");
    try {
      for (const id of dirty.current) await save(id);
      const deadline = Date.now() + 16_000;
      while (saving.current.size && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 50));
      if (dirty.current.size)
        throw Error("还有修改未保存。请先保存，或选择要保留的内容，再分享。");
      const name = await ensureShareName(a);
      let descriptor = replace
        ? null
        : (
            await request<CompactShareResponse>(
              `/spaces/${a.id}/shares`,
              a.token,
            )
          ).share;
      if (!descriptor) {
        const candidate = await createShareDescriptor(a.key);
        const response = await request<CompactShareResponse>(
          `/spaces/${a.id}/shares`,
          a.token,
          "POST",
          { ...candidate, ...(replace ? { replace: true } : {}) },
        );
        descriptor = response.share;
      }
      if (!descriptor) throw Error("分享链接暂时无法使用，请重试。");
      // A concurrent request may have won create-or-get; always recover the server's seed.
      const seed = await recoverShareSeed(descriptor, a.key);
      if (passwordLink) {
        if (!sharePassword) throw Error("请先输入访问密码。");
        const { token } = await deriveReader(seed),
          wrapped = await wrapKey(a.key, sharePassword);
        await showShareLink(
          `${location.origin}/s/${a.id}#${new URLSearchParams({ r: token, ...wrapped })}`,
        );
      } else
        await showShareLink(compactLink(location.origin, name, "reader", seed));
      if (replace) setNotice("分享链接已更换，之前的仅查看链接已失效。");
    } catch (error) {
      setShareMessage(message(error));
    } finally {
      preparingShare.current = false;
      setBusy(false);
    }
  }
  async function revoke() {
    if (!access) return;
    try {
      await request(`/spaces/${access.id}/shares`, access.token, "DELETE");
      setShareLink("");
      setQr("");
      setShareMessage(
        "分享已关闭。之前的仅查看链接无法打开，对方已复制的内容无法收回。",
      );
      setNotice(
        "分享已关闭。之前的仅查看链接无法打开，对方已复制的内容无法收回。",
      );
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function openExisting() {
    try {
      const url = new URL(openLink, location.origin);
      if (url.origin !== location.origin || parseEntry(url).kind === "home")
        throw Error("请输入本站完整的空间链接。");
      if (dirty.current.size && !confirm("还有修改未保存，确定离开此空间？"))
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
        "删除整个空间及全部笔记？所有链接都将失效，此设备上未保存的修改也会删除。删除后无法找回。",
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
                void makeShare();
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
            <span className="intro-mark">
              {lockedName ? `打开 ${lockedName}` : "两端之间，留一小块空间"}
            </span>
            <h1>
              粘贴过来，
              <br />
              带着格式过去。
            </h1>
            <p>
              一段文字、一份代码，随手放下，换台设备接着用。
              <br />
              保留原有格式，分享给其他设备或朋友。
            </p>
            {lockedName ? (
              <form
                className="space-entry"
                onSubmit={(event) => {
                  event.preventDefault();
                  openByCode();
                }}
              >
                <label htmlFor="spaceAccessCode">访问码</label>
                <input
                  id="spaceAccessCode"
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="粘贴访问码或完整空间链接"
                  autoComplete="off"
                  spellCheck={false}
                />
                <p className="entry-hint">
                  请输入访问码，或向分享者索取完整链接。
                </p>
                <button
                  className="primary large"
                  disabled={busy || !accessCode.trim()}
                >
                  打开已有空间
                </button>
              </form>
            ) : (
              <form
                className="space-entry"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createSpace();
                }}
              >
                <label htmlFor="spaceName">空间名称</label>
                <div className="name-input">
                  <span aria-hidden="true">2space.cn /</span>
                  <input
                    id="spaceName"
                    value={spaceName}
                    onChange={(event) => {
                      setSpaceName(event.target.value);
                      setNameConflict(false);
                    }}
                    minLength={3}
                    maxLength={32}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="spaceNameHint"
                    required
                  />
                </div>
                <p id="spaceNameHint" className="entry-hint">
                  名称可修改，支持3–32个小写字母、数字或中划线。它会显示在链接里，请勿使用私人信息。
                </p>
                <button className="primary large" disabled={busy || !!unlock}>
                  {busy ? "正在创建…" : "创建我的空间"}
                </button>
                {nameConflict && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => location.assign(`/${spaceName}`)}
                  >
                    打开已有空间
                  </button>
                )}
              </form>
            )}
            <small>无需注册。默认保存1天，请保存好完整链接。</small>
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
                <span>内容加密保存</span>
                <b>另一端接着用 ↗</b>
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main className="workspace">
          <aside className="sidebar">
            <div className="sidebar-heading">
              <h2>{space?.name || "我的空间"}</h2>
              <span>
                {pages.length}/{MAX_PAGES}
              </span>
            </div>
            <p className="space-mode">
              {reader
                ? "仅查看，可复制和下载"
                : "拿到此链接的人也能修改所有笔记"}
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
                    <span className="conflict-dot" title="其他设备也有修改">
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
                {online ? "内容实时更新" : "正在连接，请稍候"}
              </span>
              <label>
                保存时长
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
                      setNotice("保存时长已更新。");
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
                修改后重新计算保存时间，打开空间不会延长时间。
                {space && (
                  <>
                    到期时间
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
                <span>{reader ? "仅查看" : "可编辑"}</span>
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
                  复制内容
                </button>
                <button onClick={() => void copy()} className="text-button">
                  仅复制文字
                </button>
                <button onClick={download} className="text-button">
                  下载文字
                </button>
              </div>
            </div>
            {conflicts.has(active) && (
              <div className="conflict-banner" role="alert">
                <b>其他设备也修改了这篇笔记</b>
                <p>
                  你的修改还在。可以另存为新笔记，或放弃此页修改，使用其他设备保存的内容。
                </p>
                <button
                  className="secondary"
                  onClick={() => void resolveConflict(true)}
                >
                  另存为新笔记
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    if (
                      confirm("放弃此页未保存的修改，使用其他设备保存的内容？")
                    )
                      void resolveConflict(false);
                  }}
                >
                  使用已保存的内容
                </button>
              </div>
            )}
            {current ? (
              <Suspense
                fallback={<div className="editor-loading">正在打开笔记…</div>}
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
              <div className="editor-loading">正在读取内容…</div>
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
                {reader ? "查看内容" : status}
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
                <h2>链接与隐私</h2>
                <p>内容加密保存。空间名称、保存时间和内容大小仍会被记录。</p>
                <ul>
                  <li>
                    可编辑链接：拿到链接的人能查看、修改全部笔记，请勿公开分享。
                  </li>
                  <li>仅查看链接：对方能查看、复制和下载，不能修改。</li>
                  <li>请保存好完整链接或访问码，丢失后无法找回内容。</li>
                  <li>
                    请在信任的设备上使用。设备上的恶意软件或扩展可能读取内容。
                  </li>
                  <li>粘贴的图片不会上传或加载，文字和常用格式会保留。</li>
                </ul>
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
                <p>
                  粘贴完整链接即可打开。能否修改内容，取决于分享给你的链接。
                </p>
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
                <h2>分享这个空间</h2>
                <p>
                  对方能查看、复制和下载全部笔记，不能修改。再次分享仍使用同一个链接。
                </p>
                <div className="share-status" role="status">
                  {shareMessage || "正在准备分享链接…"}
                </div>
                {shareLink && (
                  <>
                    <textarea
                      aria-label="仅查看链接"
                      readOnly
                      value={shareLink}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    {qr && (
                      <img className="qr" src={qr} alt="仅查看链接二维码" />
                    )}
                    <button
                      className="secondary"
                      onClick={() => void copyShare(shareLink)}
                    >
                      复制仅查看链接
                    </button>
                  </>
                )}
                {!busy && !shareLink && (
                  <button
                    className="secondary"
                    onClick={() => void makeShare()}
                  >
                    重试
                  </button>
                )}
                <div className="share-bottom">
                  <button
                    className="text-button"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(location.href)
                        .then(() =>
                          setShareMessage(
                            "可编辑链接已复制，拿到链接的人也能修改全部笔记。",
                          ),
                        )
                        .catch(() =>
                          setShareMessage(
                            "复制未成功，请从地址栏复制完整链接。",
                          ),
                        )
                    }
                  >
                    复制可编辑链接
                  </button>
                </div>
                <details className="share-advanced">
                  <summary>高级设置</summary>
                  <p>
                    可以为新链接设置密码。此前分享的链接仍可打开；如需停用，请先更换分享链接。
                  </p>
                  <label className="field-label">
                    访问密码
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={sharePassword}
                      onChange={(event) => setSharePassword(event.target.value)}
                      placeholder="设置访问密码"
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={busy || !sharePassword}
                    onClick={() => void makeShare(false, true)}
                  >
                    复制带密码的链接
                  </button>
                  <div className="share-bottom">
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void makeShare(true)}
                    >
                      更换分享链接
                    </button>
                    <button
                      className="text-button danger"
                      disabled={busy}
                      onClick={() => void revoke()}
                    >
                      关闭分享
                    </button>
                  </div>
                  <p className="risk-note">
                    更换链接或关闭分享后，之前的仅查看链接将无法打开。对方已复制的内容无法收回。
                  </p>
                </details>
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
            <h2>输入访问密码</h2>
            <p>请输入分享者提供的密码。</p>
            <input
              aria-label="访问密码"
              type="password"
              autoComplete="current-password"
              value={unlockPassword}
              onChange={(e) => setUnlockPassword(e.target.value)}
              autoFocus
            />
            <button className="primary" disabled={busy}>
              {busy ? "正在打开…" : "打开空间"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
