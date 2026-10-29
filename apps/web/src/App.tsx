import { useEffect, useRef, useState } from "react";
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
  randomSecret,
} from "./crypto.js";
import { request, RequestError, subscribe } from "./api.js";
import { sanitizeHtml, normalizeDocument } from "./sanitize.js";
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
import Home from "./Home.js";
import Workspace from "./Workspace.js";
import {
  randomExperienceName,
  RETENTION_LABELS,
  pageLabel,
} from "./view-model.js";
interface Access {
  id: string;
  key: string;
  token: string;
  role: "owner" | "reader";
  name?: string;
  isPublic?: boolean;
  viewOnly?: boolean;
}
interface LocalPage {
  record: PageRecord;
  doc: PlainDocument;
}
interface Draft {
  baseRevision: number;
  payload: EncryptedPayload;
}
const emptyDoc = (title = ""): PlainDocument => ({
  title,
  html: "<p></p>",
  text: "",
  language: "plaintext",
});
function message(error: unknown) {
  return error instanceof Error && /\p{Script=Han}/u.test(error.message)
    ? error.message
    : "操作没有完成，请稍后重试。";
}
function draftKey(space: string, page: string) {
  return `2space:draft:${space}:${page}`;
}
function cleanDocument(doc: PlainDocument) {
  return normalizeDocument(doc);
}
export default function App() {
  const [ready, setReady] = useState(false);
  const [challenge, setChallenge] = useState<{
    id: string;
    token: string;
  } | null>(null);
  const [spacePassword, setSpacePassword] = useState("");
  const [lockMessage, setLockMessage] = useState("");
  const preparedReadLink = useRef("");
  const [retentionDraft, setRetentionDraft] = useState(0);
  const [renameId, setRenameId] = useState("");
  const [pendingPageId, setPendingPageId] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const visited = useRef(new Set<string>());
  const suspendedAccess = useRef<Access | null>(null);
  const [spaceName, setSpaceName] = useState("");
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
    [modal, setModal] = useState<
      | "share"
      | "privacy"
      | "open"
      | "password"
      | "retention"
      | "support"
      | "bookmark"
      | "deletePage"
      | null
    >(null),
    [shareLink, setShareLink] = useState(""),
    [sharePassword, setSharePassword] = useState(""),
    [qr, setQr] = useState(""),
    [openLink, setOpenLink] = useState(""),
    [unlock, setUnlock] = useState<URLSearchParams | null>(null),
    [unlockPassword, setUnlockPassword] = useState(""),
    [conflicts, setConflicts] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!modal && !unlock && !challenge && countdown === null) return;
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
  }, [modal, unlock, challenge, countdown !== null]);
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
      accessRef.current?.id !== a.id ||
      accessRef.current?.token !== a.token ||
      accessRef.current?.key !== a.key ||
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
        if (initial && a.role === "owner" && !a.viewOnly) {
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
      accessRef.current?.id !== a.id ||
      accessRef.current?.token !== a.token ||
      accessRef.current?.key !== a.key ||
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
        : (() => {
            try {
              const saved = localStorage.getItem(`2space:active:${a.id}`);
              if (merged.some((page) => page.record.id === saved))
                return saved!;
            } catch {}
            return merged[0]?.record.id || "";
          })(),
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
      if (passwordChallenge(e, a)) return;
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
  function passwordChallenge(error: unknown, a?: Access): boolean {
    if (
      !(error instanceof RequestError) ||
      error.code !== "PASSWORD_REQUIRED" ||
      !error.spaceId
    )
      return false;
    suspendedAccess.current = a || accessRef.current;
    refreshSequence.current++;
    const token = a?.token || accessRef.current?.token || "";
    accessRef.current = null;
    setChallenge({
      id: error.spaceId,
      token,
    });
    setUnlockPassword("");
    setReady(false);
    setAccess(null);
    setCountdown(null);
    return true;
  }
  function localLockRequired(a: Access): boolean {
    try {
      if (sessionStorage.getItem(`2space:locked:${a.id}`) !== "1") return false;
    } catch {
      return false;
    }
    suspendedAccess.current = a;
    refreshSequence.current++;
    accessRef.current = null;
    setAccess(null);
    setReady(false);
    setChallenge({ id: a.id, token: a.token });
    setUnlockPassword("");
    return true;
  }
  async function enter(a: Access, initialView?: SpaceView) {
    if (localLockRequired(a)) return;
    setReady(false);
    accessRef.current = a;
    setAccess(a);
    setFatal("");
    setStatus(
      a.role === "reader" || a.viewOnly
        ? "仅查看"
        : conflictRef.current.size
          ? "其他设备也有修改，请选择要保留的内容"
          : dirty.current.size
            ? "有修改尚未保存"
            : "已保存",
    );
    if (initialView) await decodeSpace(initialView, a, true);
    else await refresh(true, a);
    if (accessRef.current?.id !== a.id) return;
    setReady(true);
    if (!visited.current.has(a.id)) {
      visited.current.add(a.id);
      void request<SpaceView>(`/spaces/${a.id}/visits`, a.token, "POST", {})
        .then((view) => {
          if (view.revision >= spaceRevision.current) setSpace(view);
        })
        .catch((error) => {
          passwordChallenge(error, a);
        });
    }
  }
  async function openPublic(
    name: string,
    viewOnly = false,
    existing?: SpaceView,
  ) {
    const view =
      existing ||
      (await request<SpaceView>(`/spaces/by-name/${encodeURIComponent(name)}`));
    if (view.accessMode !== "public" || !view.publicKey) {
      setLockedName(name);
      return;
    }
    await enter(
      {
        id: view.id,
        name: view.name || name,
        key: view.publicKey,
        token: "",
        role: view.role,
        isPublic: true,
        viewOnly,
      },
      view,
    );
  }
  async function initialize() {
    let pendingToken = "";
    try {
      const entry = parseEntry(new URL(location.href));
      if (entry.kind === "home") return;
      if (entry.kind === "locked") {
        try {
          await openPublic(
            entry.name,
            new URLSearchParams(location.search).has("readonly"),
          );
        } catch (error) {
          if (error instanceof RequestError && error.status === 404) {
            await createSpace(
              entry.name,
              new URLSearchParams(location.search).has("readonly"),
            );
            return;
          }
          if (
            error instanceof RequestError &&
            error.code !== "PASSWORD_REQUIRED" &&
            [401, 403].includes(error.status)
          ) {
            setLockedName(entry.name);
            return;
          }
          throw error;
        }
        return;
      }
      if (entry.kind === "legacy") {
        const { params, id } = entry,
          token = params.get("m") || params.get("r"),
          key = params.get("k");
        pendingToken = token || "";
        if (!token) throw Error("链接不完整，请重新复制后打开。");
        if (params.get("w")) {
          setUnlock(params);
          return;
        }
        if (!key) throw Error("链接不完整，请重新复制后打开。");
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
        pendingToken = token;
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
        pendingToken = token;
        const view = await request<SpaceView>(
          `/spaces/by-name/${entry.name}`,
          token,
        );
        if (!view.readerKey) throw Error("链接已失效，请向分享者索取新链接。");
        const key = await unwrapReaderKey(view.readerKey, entry.seed);
        await enter(
          { id: view.id, key, token, role: view.role, name: entry.name },
          view,
        );
      }
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.code === "PASSWORD_REQUIRED" &&
        error.spaceId
      ) {
        setChallenge({ id: error.spaceId, token: pendingToken });
        setUnlockPassword("");
        setReady(false);
        setAccess(null);
        return;
      }
      setFatal(
        error instanceof RequestError && [401, 403, 404].includes(error.status)
          ? "空间不存在、已到期，或链接已失效，请向分享者确认。"
          : error instanceof DOMException
            ? "链接无法打开，请重新复制完整链接。"
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
    if (!access || !ready || challenge) return;
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
  }, [access?.id, access?.token, ready, challenge]);
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
    const handler = () => {
      // Home fragments are section anchors, not workspace capabilities. Read the
      // current path because creating a workspace can replace it without a mount.
      if (location.pathname !== "/") location.reload();
    };
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
  async function createSpace(givenName = spaceName, viewOnly = false) {
    if (busy) return;
    const name = givenName.trim() || randomExperienceName();
    if (!validSpaceName(name)) {
      setNotice("名称仅支持1–64位字母、数字、下划线或中划线，请换一个名称。");
      return;
    }
    setBusy(true);
    setFatal("");
    setNameConflict(false);
    try {
      let view: SpaceView | undefined;
      try {
        view = await request<SpaceView>(
          `/spaces/by-name/${encodeURIComponent(name)}`,
        );
      } catch (error) {
        if (
          error instanceof RequestError &&
          error.code === "PASSWORD_REQUIRED" &&
          error.spaceId
        ) {
          history.replaceState(null, "", `/${name}`);
          setChallenge({ id: error.spaceId, token: "" });
          return;
        }
        if (
          error instanceof RequestError &&
          [401, 403].includes(error.status)
        ) {
          history.replaceState(null, "", `/${name}`);
          setLockedName(name);
          return;
        }
        if (!(error instanceof RequestError) || error.status !== 404)
          throw error;
      }
      if (!view) {
        const key = randomSecret(),
          payload = await encryptDocument(emptyDoc(), key);
        try {
          view = await request<SpaceView>("/spaces", undefined, "POST", {
            name,
            accessMode: "public",
            publicKey: key,
            ownerToken: randomSecret(),
            retentionSeconds: 0,
            page: { id: crypto.randomUUID(), payload },
          });
        } catch (error) {
          if (error instanceof RequestError && error.code === "NAME_TAKEN")
            view = await request<SpaceView>(
              `/spaces/by-name/${encodeURIComponent(name)}`,
            );
          else throw error;
        }
      }
      history.replaceState(null, "", `/${name}${viewOnly ? "?readonly" : ""}`);
      if (view.accessMode === "public") await openPublic(name, viewOnly, view);
      else setLockedName(name);
    } catch (error) {
      if (!passwordChallenge(error)) setNotice(message(error));
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
    if (!a || a.role !== "owner" || a.viewOnly) return;
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
      }, 600),
    );
  }
  async function save(id: string) {
    const a = accessRef.current;
    if (
      !a ||
      a.role !== "owner" ||
      a.viewOnly ||
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
      if (passwordChallenge(e, a)) {
        setStatus("请输入密码后继续保存。");
        return;
      }
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
      setRenameId(id);
      setStatus("已保存");
      void refresh();
      return true;
    } catch (e) {
      if (!passwordChallenge(e, a)) setNotice(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function deletePage(targetId = active, confirmed = false) {
    const a = accessRef.current,
      item = pagesRef.current.find((p) => p.record.id === targetId);
    if (
      !a ||
      !item ||
      pages.length <= 1 ||
      pagesRef.current[0]?.record.id === targetId
    )
      return;
    if (!confirmed) {
      setPendingPageId(targetId);
      setModal("deletePage");
      return;
    }
    try {
      await request(`/spaces/${a.id}/pages/${targetId}`, a.token, "DELETE", {
        expectedRevision: item.record.revision,
      });
      dirty.current.delete(targetId);
      try {
        localStorage.removeItem(draftKey(a.id, targetId));
      } catch {}
      conflictRef.current.delete(targetId);
      setConflicts(new Set(conflictRef.current));
      publish(pagesRef.current.filter((p) => p.record.id !== targetId));
      setActive(pagesRef.current[0]?.record.id || "");
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
          ?.focus(),
      );
      void refresh();
    } catch (e) {
      if (!passwordChallenge(e, a)) setNotice(message(e));
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
      (pageLabel(item, pagesRef.current.indexOf(item))
        .replace(/[\\/:*?"<>|]/g, "_")
        .slice(0, 60) || "笔记") + ".txt";
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
  async function showShareLink(link: string, copy = true) {
    setShareLink(link);
    setQr("");
    if (copy) await copyShare(link);
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
  async function makeShare(replace = false, passwordLink = false, copy = true) {
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
      preparedReadLink.current = compactLink(
        location.origin,
        name,
        "reader",
        seed,
      );
      if (passwordLink) {
        if (!sharePassword) throw Error("请先输入访问密码。");
        const { token } = await deriveReader(seed),
          wrapped = await wrapKey(a.key, sharePassword);
        await showShareLink(
          `${location.origin}/s/${a.id}#${new URLSearchParams({ r: token, ...wrapped })}`,
        );
      } else
        await showShareLink(
          compactLink(location.origin, name, "reader", seed),
          copy,
        );
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
      preparedReadLink.current = "";
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
  async function orderPages(ids: string[]) {
    const a = accessRef.current;
    if (!a || a.viewOnly || a.role !== "owner") return;
    try {
      await request(`/spaces/${a.id}/pages/order`, a.token, "POST", { ids });
      const order = new Map(ids.map((id, index) => [id, index]));
      publish(
        [...pagesRef.current].sort(
          (left, right) =>
            (order.get(left.record.id) ?? 0) -
            (order.get(right.record.id) ?? 0),
        ),
      );
      setNotice("顺序已保存");
      void refresh();
    } catch (error) {
      if (!passwordChallenge(error, a)) setNotice(message(error));
    }
  }
  async function changeRetention() {
    const a = accessRef.current;
    if (!a) return;
    if (
      retentionDraft &&
      space &&
      new Date(space.updatedAt).getTime() + retentionDraft * 1000 <=
        Date.now() &&
      !confirm("按上次保存时间计算，保存后会立即删除此空间。确定继续？")
    )
      return;
    setBusy(true);
    try {
      const view = await request<SpaceView>(
        `/spaces/${a.id}`,
        a.token,
        "PATCH",
        { retentionSeconds: retentionDraft },
      );
      setSpace(view);
      setModal(null);
      setNotice("保留时间已设置。");
    } catch (error) {
      if (!passwordChallenge(error, a)) setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function changePassword() {
    const a = accessRef.current;
    if (!a) return;
    setBusy(true);
    try {
      const view = await request<SpaceView>(
        `/spaces/${a.id}/password`,
        a.token,
        "POST",
        { password: spacePassword },
      );
      setSpace(view);
      setSpacePassword("");
      setModal(null);
      setNotice(view.passwordProtected ? "密码已设置" : "密码已移除");
    } catch (error) {
      if (!passwordChallenge(error, a)) setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function unlockWholeSpace() {
    if (!challenge) return;
    setBusy(true);
    try {
      await request(`/spaces/${challenge.id}/unlock`, challenge.token, "POST", {
        password: unlockPassword,
      });
      try {
        sessionStorage.removeItem(`2space:locked:${challenge.id}`);
      } catch {}
      setLockMessage("");
      const previous = suspendedAccess.current;
      setChallenge(null);
      setUnlockPassword("");
      setModal(null);
      if (previous?.id === challenge.id) await enter(previous);
      else await initialize();
    } catch (error) {
      setNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function lockCurrent() {
    const a = accessRef.current;
    if (!a) return;
    try {
      sessionStorage.setItem(`2space:locked:${a.id}`, "1");
    } catch {
      setLockMessage("无法记住锁定状态，请关闭此页后再使用。");
    }
    suspendedAccess.current = a;
    refreshSequence.current++;
    accessRef.current = null;
    setChallenge({ id: a.id, token: a.token });
    setAccess(null);
    setReady(false);
    setCountdown(null);
    setModal(null);
    setUnlockPassword("");
    try {
      await request(`/spaces/${a.id}/lock`, undefined, "POST");
    } catch {
      setLockMessage("连接中断，内容已隐藏。联网后输入密码继续。");
    }
  }
  useEffect(() => {
    if (!access || !ready || !space?.passwordProtected || challenge) return;
    let idle: ReturnType<typeof setTimeout>,
      interval: ReturnType<typeof setInterval> | undefined;
    const reset = () => {
      clearTimeout(idle);
      if (interval) clearInterval(interval);
      setCountdown(null);
      idle = setTimeout(() => {
        let count = 5;
        setCountdown(count);
        interval = setInterval(() => {
          count--;
          if (count <= 0) {
            if (interval) clearInterval(interval);
            void lockCurrent();
          } else setCountdown(count);
        }, 1000);
      }, 180000);
    };
    const events = [
      "mousemove",
      "keydown",
      "click",
      "scroll",
      "touchstart",
    ] as const;
    events.forEach((event) =>
      document.addEventListener(event, reset, { passive: true }),
    );
    reset();
    const onPageHide = () => {
      navigator.sendBeacon(`/api/spaces/${access.id}/lock`);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearTimeout(idle);
      if (interval) clearInterval(interval);
      events.forEach((event) => document.removeEventListener(event, reset));
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [access?.id, ready, space?.passwordProtected, challenge]);
  useEffect(() => {
    if (access && active) {
      try {
        localStorage.setItem(`2space:active:${access.id}`, active);
      } catch {}
    }
  }, [active, access?.id]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        access &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        void save(active);
      }
    };
    const onBlur = (event: FocusEvent) => {
      if ((event.target as HTMLElement)?.closest?.(".tiptap"))
        void save(active);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("focusout", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("focusout", onBlur);
    };
  }, [active, access]);
  useEffect(() => {
    if (
      access &&
      !access.isPublic &&
      access.role === "owner" &&
      ready &&
      !shareLink &&
      !challenge
    )
      void makeShare(false, false, false);
  }, [access?.id, ready]);
  async function shareCurrent() {
    let link: string;
    if (access?.isPublic)
      link = `${location.origin}/${access.name}${access.viewOnly ? "?readonly" : ""}`;
    else if (access?.role === "reader") link = location.href;
    else {
      if (!preparedReadLink.current) await makeShare(false, false, false);
      link = preparedReadLink.current;
      if (!link) {
        setNotice("仅查看链接尚未准备好，请稍后重试。");
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setNotice("链接已复制");
    } catch {
      setNotice("复制未成功，请手动复制二维码下方的链接。");
    }
  }
  async function supportShare(copyOnly = false) {
    try {
      if (!copyOnly && navigator.share)
        await navigator.share({
          title: "2Space在线剪贴板",
          text: "用2Space跨设备传文字",
          url: location.origin + "/",
        });
      else {
        await navigator.clipboard.writeText(location.origin + "/");
        setNotice("首页链接已复制，发给朋友即可。");
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setNotice("复制未成功，可从地址栏复制首页链接。");
    }
  }
  const reader = access?.role === "reader" || !!access?.viewOnly;
  const isPublic = !!access?.isPublic;
  const editLink = access
    ? isPublic
      ? `${location.origin}/${access.name}`
      : reader
        ? ""
        : location.href
    : "";
  const readLink = access
    ? isPublic
      ? `${location.origin}/${access.name}?readonly`
      : reader
        ? location.href
        : shareLink
    : "";
  const showModal = !!modal || !!unlock || !!challenge || countdown !== null;
  return (
    <div className="app">
      {access && !challenge ? (
        <Workspace
          space={space}
          pages={pages}
          active={active}
          onActive={setActive}
          reader={reader}
          isPublic={isPublic}
          busy={busy}
          fatal={fatal}
          status={status}
          online={online}
          conflicts={conflicts}
          editLink={editLink}
          readLink={readLink}
          renameId={renameId}
          onRenameDone={() => setRenameId("")}
          onUpdate={updatePage}
          onAdd={() => void addPage()}
          onDelete={(id) => void deletePage(id)}
          onOrder={(ids) => void orderPages(ids)}
          onCopy={(rich) => void copy(rich)}
          onDownload={download}
          onShare={() => void shareCurrent()}
          onBookmark={() => setModal("bookmark")}
          onPassword={() => {
            setSpacePassword("");
            setModal("password");
          }}
          onRetention={() => {
            setRetentionDraft(space?.retentionSeconds ?? 0);
            setModal("retention");
          }}
          onNotice={setNotice}
          onSave={() => void save(active)}
          onConflict={(keep) => void resolveConflict(keep)}
          onPrivacy={() => setModal("privacy")}
          onRemoveSpace={() => void deleteSpace()}
        />
      ) : (
        <Home
          busy={busy}
          name={spaceName}
          onName={setSpaceName}
          onEnter={(name) => void createSpace(name)}
          onSupport={() => setModal("support")}
          onBookmark={() => setModal("bookmark")}
          lockedName={lockedName}
          accessCode={accessCode}
          onCode={setAccessCode}
          onOpenCode={openByCode}
        />
      )}
      {!access && fatal && (
        <div className="page-error" role="alert">
          {fatal}
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button aria-label="关闭提示" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      {showModal && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!challenge && !unlock && countdown === null) setModal(null);
          }}
        >
          <section
            className={modal === "deletePage" ? "modal confirm" : "modal"}
            role="dialog"
            aria-modal="true"
            aria-label={
              challenge
                ? "输入空间密码"
                : unlock
                  ? "打开受保护链接"
                  : countdown !== null
                    ? "要继续使用吗？"
                    : modal === "deletePage"
                      ? "删除记事本"
                      : modal === "password"
                        ? "设置剪贴板密码"
                        : modal === "retention"
                          ? "设置保留时间"
                          : modal === "bookmark"
                            ? "添加浏览器书签"
                            : modal === "support"
                              ? "支持2Space"
                              : modal === "share"
                                ? "分享空间"
                                : modal === "open"
                                  ? "打开空间"
                                  : "隐私说明"
            }
            onClick={(event) => event.stopPropagation()}
          >
            {!challenge && !unlock && countdown === null && (
              <button
                className="modal-close"
                aria-label="关闭窗口"
                onClick={() => setModal(null)}
              >
                ×
              </button>
            )}
            {challenge ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void unlockWholeSpace();
                }}
              >
                <h2>请输入剪贴板密码</h2>
                <p>
                  {lockMessage || "此剪贴板设置了访问密码，输入后即可继续。"}
                </p>
                <input
                  className="input"
                  type="password"
                  aria-label="空间密码"
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                  autoFocus
                />
                <div className="foot">
                  <a className="btn ghost" href="/">
                    返回首页
                  </a>
                  <button className="btn primary" disabled={busy}>
                    {busy ? "正在打开…" : "打开剪贴板"}
                  </button>
                </div>
              </form>
            ) : unlock ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void unlockSpace();
                }}
              >
                <h2>输入密码打开链接</h2>
                <p>请输入分享者提供的密码。</p>
                <input
                  className="input"
                  type="password"
                  aria-label="解锁密码"
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(event) => setUnlockPassword(event.target.value)}
                  autoFocus
                />
                <div className="foot">
                  <button className="btn primary" disabled={busy}>
                    打开内容
                  </button>
                </div>
              </form>
            ) : countdown !== null ? (
              <>
                <h2>要继续使用吗？</h2>
                <p>有一段时间没有操作，即将锁定内容。</p>
                <p>{countdown}秒后锁定</p>
                <button
                  className="btn primary"
                  onClick={() => setCountdown(null)}
                >
                  继续使用
                </button>
              </>
            ) : modal === "deletePage" ? (
              <>
                <h2>删除记事本</h2>
                <p>确定删除这个记事本吗？此操作无法撤销。</p>
                <div className="foot">
                  <button className="btn ghost" onClick={() => setModal(null)}>
                    取消
                  </button>
                  <button
                    className="btn primary delete-confirm"
                    onClick={() => {
                      setModal(null);
                      void deletePage(pendingPageId, true);
                    }}
                  >
                    确认删除
                  </button>
                </div>
              </>
            ) : modal === "password" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void changePassword();
                }}
              >
                <h2>设置剪贴板密码</h2>
                <input
                  className="input"
                  aria-label="新密码"
                  type="password"
                  autoComplete="new-password"
                  placeholder="输入密码"
                  value={spacePassword}
                  onChange={(event) => setSpacePassword(event.target.value)}
                />
                <p className="modal-desc">
                  {space?.passwordProtected
                    ? "输入新密码可更换密码；留空后保存，将取消密码保护。"
                    : "设置后，每台设备打开时都需要输入密码。请自行记住，密码无法找回。"}
                </p>
                <div className="foot">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button className="btn primary" disabled={busy}>
                    保存
                  </button>
                </div>
              </form>
            ) : modal === "retention" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void changeRetention();
                }}
              >
                <h2>设置保留时间</h2>
                <p className="modal-desc">
                  每次保存内容后重新计时；仅打开查看不会延长时间。到期会删除所有记事本，无法恢复。
                </p>
                <select
                  className="input"
                  aria-label="保留时间"
                  value={retentionDraft}
                  onChange={(event) =>
                    setRetentionDraft(Number(event.target.value))
                  }
                >
                  {[
                    ...RETENTION_SECONDS.filter((seconds) => seconds !== 0),
                    0,
                  ].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {
                        RETENTION_LABELS[
                          RETENTION_SECONDS.indexOf(
                            seconds as (typeof RETENTION_SECONDS)[number],
                          )
                        ]
                      }
                    </option>
                  ))}
                </select>
                <p className="modal-desc">
                  到期时间：
                  {retentionDraft === 0
                    ? "永久保留"
                    : space
                      ? new Date(
                          new Date(space.updatedAt).getTime() +
                            retentionDraft * 1000,
                        ).toLocaleString("zh-CN")
                      : "—"}
                </p>
                <div className="foot">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setModal(null)}
                  >
                    取消
                  </button>
                  <button className="btn primary" disabled={busy}>
                    保存
                  </button>
                </div>
              </form>
            ) : modal === "bookmark" ? (
              <>
                <h2>{access ? "收藏这个剪贴板" : "收藏2Space首页"}</h2>
                <p>按下面的方法，在浏览器中确认保存，下次从书签直接打开。</p>
                <dl className="bookmark-steps">
                  <div>
                    <dt>电脑</dt>
                    <dd>
                      Mac 按 <kbd>⌘</kbd> + <kbd>D</kbd>；Windows / Linux 按{" "}
                      <kbd>Ctrl</kbd> + <kbd>D</kbd>。
                    </dd>
                  </div>
                  <div>
                    <dt>iPhone / iPad</dt>
                    <dd>
                      在 Safari
                      的页面菜单或分享菜单中，选择“添加书签”或“加入个人收藏”。
                    </dd>
                  </div>
                  <div>
                    <dt>Android</dt>
                    <dd>打开浏览器菜单，选择“添加书签”或点亮星标。</dd>
                  </div>
                </dl>
                {access && (
                  <p className="bookmark-privacy">
                    书签会保存当前完整链接。共用或同步浏览器账号时，请确认哪些人能看到。
                  </p>
                )}
                <div className="foot">
                  <button
                    className="btn ghost"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(location.href)
                        .then(() => setNotice("页面链接已复制"))
                        .catch(() =>
                          setNotice("复制未成功，请从地址栏手动复制链接。"),
                        );
                    }}
                  >
                    复制当前页链接
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => setModal(null)}
                  >
                    知道了
                  </button>
                </div>
              </>
            ) : modal === "support" ? (
              <>
                <h2>支持2Space</h2>
                <p>如果2Space对你有用，把它分享给下一位需要的人。</p>
                <div className="support-actions">
                  <button
                    className="btn primary"
                    onClick={() => void supportShare(true)}
                  >
                    复制首页链接
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => void supportShare()}
                  >
                    分享给朋友
                  </button>
                </div>
                <p className="modal-desc">收藏首页，下次需要时直接打开。</p>
              </>
            ) : modal === "privacy" ? (
              <>
                <h2>隐私说明</h2>
                <p>
                  {isPublic
                    ? "知道名称的人可以查看和修改此剪贴板，设置密码可限制访问。仅查看链接方便阅读，知道名称的人仍可打开可编辑页面。"
                    : "拿到可编辑链接的人可以修改全部内容；仅查看链接只能阅读和复制。请保存好可编辑链接，丢失后无法找回。"}
                </p>
                <p>
                  请勿存放账号密码、银行卡号等敏感信息。删除或关闭分享，无法收回别人已复制的内容。重要内容请另行备份。
                </p>
                {!isPublic && !reader && (
                  <button
                    className="btn ghost"
                    onClick={() => {
                      setModal("share");
                      void makeShare();
                    }}
                  >
                    仅查看分享设置
                  </button>
                )}
                <div className="foot">
                  <button
                    className="btn ghost danger"
                    onClick={() => void deleteSpace()}
                  >
                    删除整个剪贴板
                  </button>
                </div>
              </>
            ) : modal === "share" ? (
              <>
                <h2>仅查看分享</h2>
                <p>此链接包含所有记事本，对方可以阅读和复制，不能修改。</p>
                <div role="status" className="share-status">
                  {shareMessage || "正在准备链接…"}
                </div>
                <input
                  className="input"
                  aria-label="仅查看分享链接"
                  readOnly
                  value={shareLink}
                />
                <button
                  className="btn primary"
                  onClick={() => void copyShare(shareLink)}
                >
                  复制仅查看链接
                </button>
                <details className="share-advanced">
                  <summary>更多分享设置</summary>
                  <label>
                    链接密码
                    <input
                      className="input"
                      type="password"
                      value={sharePassword}
                      onChange={(event) => setSharePassword(event.target.value)}
                    />
                  </label>
                  <button
                    className="btn ghost"
                    disabled={!sharePassword || busy}
                    onClick={() => void makeShare(false, true)}
                  >
                    生成密码链接
                  </button>
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => void makeShare(true)}
                  >
                    更新链接
                  </button>
                  <button
                    className="btn ghost danger"
                    onClick={() => void revoke()}
                  >
                    关闭分享
                  </button>
                  <p>
                    更换或关闭分享后，旧链接不能再打开。别人已复制的内容无法收回。
                  </p>
                </details>
              </>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void openExisting();
                }}
              >
                <h2>打开空间</h2>
                <input
                  className="input"
                  aria-label="空间链接"
                  value={openLink}
                  onChange={(event) => setOpenLink(event.target.value)}
                />
                <button className="btn primary">打开空间</button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
