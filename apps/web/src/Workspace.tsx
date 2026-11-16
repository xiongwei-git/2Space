import LanguageSelect from "./LanguageSelect.js";
import { t } from "./locale.js";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import Icon from "./Icon.js";
import { BrandMark, BRAND_SLOGAN } from "./Brand.js";
import type { SpaceView } from "@2space/shared";
import { MAX_PAGES, RETENTION_SECONDS } from "@2space/shared";
import {
  dateText,
  pageLabel,
  RETENTION_LABELS,
  type LocalPage,
} from "./view-model.js";
const Editor = lazy(() => import("./Editor.js"));
interface Props {
  space: SpaceView | null;
  pages: LocalPage[];
  active: string;
  onActive: (id: string) => void;
  reader: boolean;
  isPublic: boolean;
  busy: boolean;
  fatal: string;
  status: string;
  saveError: string | null;
  online: boolean;
  conflicts: Set<string>;
  editLink: string;
  readLink: string;
  renameId: string;
  onRenameDone: () => void;
  onUpdate: (id: string, patch: Partial<LocalPage["doc"]>) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  onOrder: (ids: string[]) => void;
  onCopy: (rich?: boolean) => void;
  onDownload: () => void;
  onShare: () => void;
  recoverableDraftCount?: number;
  onRecoverDrafts?: () => void;
  onBookmark: () => void;
  onPassword: () => void;
  onRetention: () => void;
  onNotice: (value: string) => void;
  onSave: () => void;
  onConflict: (keep: boolean) => void;
  onPrivacy: () => void;
  onRemoveSpace: () => void;
}
function ShareQr({
  label,
  link,
  onNotice,
}: {
  label: string;
  link: string;
  onNotice: (message: string) => void;
}) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    let cancelled = false;
    setQr("");
    if (link)
      void import("qrcode").then(async (QR) => {
        const value = await QR.toDataURL(link, {
          width: 128,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setQr(value);
      });
    return () => {
      cancelled = true;
    };
  }, [link]);
  return (
    <div className="qr-box">
      <div className="qr-label">{label}</div>
      <div className="qr">
        {qr ? (
          <img src={qr} alt={t("{0}二维码", label)} />
        ) : (
          <span>{link ? t("正在生成二维码…") : t("尚未开启分享")}</span>
        )}
      </div>
      <div className="link">
        <input
          aria-label={label}
          value={link}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          disabled={!link}
          onClick={() =>
            void navigator.clipboard
              .writeText(link)
              .then(() => onNotice("链接已复制"))
              .catch(() => onNotice("复制未成功，请手动选择链接复制。"))
          }
        >
          {t("复制")}
        </button>
      </div>
    </div>
  );
}
export default function Workspace(p: Props) {
  const current = p.pages.find((item) => item.record.id === p.active),
    [renaming, setRenaming] = useState<{ id: string; value: string } | null>(
      null,
    ),
    renameDone = useRef(false),
    [dragId, setDragId] = useState(""),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (p.renameId) {
      const page = p.pages.find((item) => item.record.id === p.renameId);
      if (page) {
        renameDone.current = false;
        setRenaming({ id: p.renameId, value: page.doc.title });
        p.onRenameDone();
      }
    }
  }, [p.renameId, p.pages]);
  function startRename(page: LocalPage, index: number) {
    if (p.reader) return;
    renameDone.current = false;
    setRenaming({
      id: page.record.id,
      value: page.doc.title || pageLabel(page, index),
    });
  }
  function finishRename(save: boolean) {
    if (!renaming || renameDone.current) return;
    renameDone.current = true;
    if (save) p.onUpdate(renaming.id, { title: renaming.value.trim() });
    setRenaming(null);
  }
  const seconds = p.space?.retentionSeconds ?? 0,
    retention = t(
      RETENTION_LABELS[
        RETENTION_SECONDS.indexOf(seconds as (typeof RETENTION_SECONDS)[number])
      ] || "永久保留",
    );
  const remaining = p.space?.expiresAt
    ? Math.max(
        0,
        Math.ceil((new Date(p.space.expiresAt).getTime() - now) / 1000),
      )
    : null;
  const remainingText =
    remaining === null
      ? t("永久")
      : remaining >= 86400
        ? t(
            "{0}天 {1}小时",
            Math.floor(remaining / 86400),
            Math.floor((remaining % 86400) / 3600),
          )
        : remaining >= 3600
          ? t(
              "{0}小时 {1}分钟",
              Math.floor(remaining / 3600),
              Math.floor((remaining % 3600) / 60),
            )
          : t("{0}分 {1}秒", Math.floor(remaining / 60), remaining % 60);
  return (
    <main className="board-container">
      <header className="board-header">
        <div className="board-brand">
          <a className="board-logo" href="/" aria-label={t("2Space首页")}>
            <BrandMark />
          </a>
          <div className="board-identity">
            <span className="board-brand-label">2Space</span>
            <strong className="board-name">
              /{p.space?.name || t("剪贴板")}
            </strong>
          </div>
          <a className="home-link" href="/">
            {t("← 返回首页")}
          </a>
        </div>
        <div className="actions">
          <LanguageSelect />
          <button
            className="btn ghost"
            onClick={p.onBookmark}
            aria-label={t("收藏当前剪贴板")}
          >
            <Icon name="bookmark" /> {t("收藏")}
          </button>
          <button className="btn ghost" onClick={() => p.onCopy(true)}>
            <Icon name="copy" /> {t("复制内容")}
          </button>
          <button className="btn ghost" onClick={p.onDownload}>
            <Icon name="download" /> {t("下载文字")}
          </button>
          <button className="btn primary" onClick={p.onShare}>
            <Icon name="share" /> {t("分享")}
          </button>
        </div>
      </header>
      <section className="board-main">
        <div className="main-head">
          <h1>
            {t("文字与代码")}{" "}
            <span className={p.reader ? "badge readonly" : "badge"}>
              {p.reader ? t("仅查看") : t("可编辑")}
            </span>
          </h1>
          {!p.reader && (
            <details className="format-shortcuts">
              <summary>{t("更多操作")}</summary>
              <div
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button"))
                    event.currentTarget
                      .closest("details")
                      ?.removeAttribute("open");
                }}
              >
                <button onClick={() => p.onCopy(false)}>
                  {t("复制纯文字")}
                </button>
                <button onClick={p.onSave}>{t("立即保存")}</button>
                <button onClick={p.onPrivacy}>{t("查看隐私说明")}</button>
                <button className="danger" onClick={p.onRemoveSpace}>
                  {t("删除整个剪贴板")}
                </button>
              </div>
            </details>
          )}
        </div>
        <div className="tabs-bar">
          <div
            className="tabs-owner"
            role="tablist"
            aria-label={t("记事本列表")}
            aria-owns={p.pages
              .map((page) => `note-tab-${page.record.id}`)
              .join(" ")}
          />
          <div className="tabs">
            {p.pages.map((page, index) => (
              <div
                key={page.record.id}
                className={`tab${page.record.id === p.active ? " active" : ""}${index === 0 ? " tab-main" : ""}`}
                role="presentation"
                draggable={!p.reader && index !== 0}
                onDragStart={(e) => {
                  setDragId(page.record.id);
                  e.dataTransfer.setData("text/plain", page.record.id);
                }}
                onDragOver={(e) => {
                  if (index > 0 && !p.reader) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (index === 0 || !dragId || p.reader) return;
                  const ids = p.pages
                    .map((x) => x.record.id)
                    .filter((id) => id !== dragId);
                  ids.splice(index, 0, dragId);
                  setDragId("");
                  p.onOrder(ids);
                }}
              >
                <button
                  id={`note-tab-${page.record.id}`}
                  className={`tab-title${renaming?.id === page.record.id ? " tab-title-editing" : ""}`}
                  role="tab"
                  aria-selected={page.record.id === p.active}
                  tabIndex={renaming?.id === page.record.id ? -1 : 0}
                  title={pageLabel(page, index)}
                  onClick={() => p.onActive(page.record.id)}
                  onDoubleClick={() => startRename(page, index)}
                  onKeyDown={(event) => {
                    if (event.key === "F2") {
                      event.preventDefault();
                      startRename(page, index);
                    }
                  }}
                >
                  {pageLabel(page, index)}
                </button>
                {renaming?.id === page.record.id && (
                  <input
                    autoFocus
                    className="tab-rename-input"
                    aria-label={t("记事本名称")}
                    maxLength={60}
                    value={renaming.value}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) =>
                      setRenaming({ ...renaming, value: event.target.value })
                    }
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        finishRename(true);
                      } else if (event.key === "Escape") finishRename(false);
                    }}
                    onBlur={() => finishRename(true)}
                  />
                )}
                {index > 0 && !p.reader && !renaming && (
                  <button
                    className="tab-close"
                    aria-label={t("删除{0}", pageLabel(page, index))}
                    title={t("删除记事本")}
                    onClick={(e) => {
                      e.stopPropagation();
                      p.onDelete(page.record.id);
                    }}
                  >
                    ×
                  </button>
                )}
                {p.conflicts.has(page.record.id) && (
                  <span role="img" aria-label={t("存在未保存冲突")}>
                    !
                  </span>
                )}
              </div>
            ))}
          </div>
          {!p.reader && p.pages.length < MAX_PAGES && (
            <button className="tab-add" disabled={p.busy} onClick={p.onAdd}>
              {t("＋ 新建")}
            </button>
          )}
        </div>
        {p.isPublic && (
          <p className="board-access-note">
            <Icon name="lock" />
            <span>
              {p.reader ? t("当前页面仅供查看。") : ""}
              {p.space?.passwordProtected
                ? t("已设置密码，打开内容时需要输入。")
                : t("知道名称的人可以查看和修改，设置密码可限制访问。")}
            </span>
          </p>
        )}
        {!!p.recoverableDraftCount && (
          <div className="conflict-banner">
            <strong>{t("这台设备有未恢复的修改")}</strong>
            <p>
              {t(
                "使用上次的密码恢复后，可另存为新记事本；原记录会保留到恢复成功。",
              )}
            </p>
            <button className="btn ghost" onClick={p.onRecoverDrafts}>
              {t("恢复未保存内容")}
            </button>
          </div>
        )}
        {p.fatal && (
          <div className="error-banner" role="alert">
            {t(p.fatal)}
          </div>
        )}
        {p.conflicts.has(p.active) && (
          <div className="conflict-banner" role="alert">
            <strong>{t("这篇内容在另一台设备上也有修改")}</strong>
            <p>
              {t(
                "你在此页的修改还在。可以另存一篇，或使用另一台设备保存的内容。",
              )}
            </p>
            <button className="btn ghost" onClick={() => p.onConflict(true)}>
              {t("保存为新记事本")}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                if (
                  confirm(
                    t("放弃此页未保存的修改，使用另一台设备已保存的内容？"),
                  )
                )
                  p.onConflict(false);
              }}
            >
              {t("使用另一台设备的内容")}
            </button>
          </div>
        )}
        {current ? (
          <Suspense
            fallback={
              <div className="editor-loading">{t("正在打开内容…")}</div>
            }
          >
            <Editor
              html={current.doc.html}
              readOnly={p.reader || !!p.fatal}
              language={current.doc.language}
              onChange={(html, text) => p.onUpdate(p.active, { html, text })}
              onLanguage={(language) => p.onUpdate(p.active, { language })}
              onNotice={p.onNotice}
            />
          </Suspense>
        ) : (
          <div className="editor-loading">{t("正在打开内容…")}</div>
        )}
        <div className="save-bar">
          <span
            className={
              p.saveError !== null ? "save-state failed" : "save-state"
            }
            role="status"
          >
            {p.reader
              ? t("仅查看，可复制内容")
              : p.saveError !== null
                ? t("保存失败：{0}。修改仍在此页，请勿关闭。", t(p.saveError))
                : t(p.status)}
          </span>
          <span className="character-count">
            {t("{0} 字符", current?.doc.text.length || 0)}
          </span>
          <span className="connection">
            {p.online ? t("同步已连接") : t("正在连接同步")}
          </span>
        </div>
      </section>
      <aside className="board-sidebar" aria-label={t("分享与设置")}>
        {!p.reader && (
          <section className="card workspace-settings">
            <h2>{t("访问与保留")}</h2>
            <button className="setting-action" onClick={p.onPassword}>
              <Icon name="lock" />{" "}
              {t(
                "密码：{0}",
                t(p.space?.passwordProtected ? "已设置" : "未设置"),
              )}
              <span aria-hidden="true">›</span>
            </button>
            <button className="setting-action" onClick={p.onRetention}>
              <Icon name="clock" /> {t("保留：{0}", retention)}
              <span aria-hidden="true">›</span>
            </button>
            <button className="inline-button" onClick={p.onPrivacy}>
              {t("谁可以打开这些内容？")}
            </button>
          </section>
        )}
        <section className="card">
          <h2>{t("在另一台设备打开")}</h2>
          <p className="rail-description">
            {t("扫码继续使用，或复制链接发送。")}
          </p>
          <div className="qr-wrap">
            {p.editLink && (
              <ShareQr
                label={t("可编辑链接")}
                link={p.editLink}
                onNotice={p.onNotice}
              />
            )}
            <ShareQr
              label={t("仅查看链接")}
              link={p.readLink}
              onNotice={p.onNotice}
            />
          </div>
        </section>
        <section className="card">
          <h2>{t("关于这个剪贴板")}</h2>
          {[
            ["记事本数量", t("{0}个", p.pages.length)],
            ["最近修改", dateText(p.space?.updatedAt)],
            ["剩余时间", remainingText],
          ].map(([key, value]) => (
            <div className="info-row" key={key}>
              <span>{t(key)}</span>
              <span>{value}</span>
            </div>
          ))}
          <details className="access-details">
            <summary>{t("查看访问记录与到期时间")}</summary>
            {[
              ["创建时间", dateText(p.space?.createdAt)],
              ["上次查看", dateText(p.space?.lastViewedAt)],
              ["查看次数", String(p.space?.viewCount ?? 0)],
              ["本次访问IP", p.space?.viewerIp || "—"],
              ["保留时间", retention],
              [
                "到期时间",
                p.space?.expiresAt
                  ? dateText(p.space.expiresAt)
                  : t("永久保留"),
              ],
            ].map(([key, value]) => (
              <div className="info-row" key={key}>
                <span>{t(key)}</span>
                <span className={key === "本次访问IP" ? "viewer-ip" : ""}>
                  {value}
                </span>
              </div>
            ))}
          </details>
        </section>
      </aside>
      <footer className="board-footer">
        <a href="/">2Space</a>{" "}
        <span className="footer-slogan" data-brand-slogan>
          {t(BRAND_SLOGAN)}
        </span>
      </footer>
    </main>
  );
}
