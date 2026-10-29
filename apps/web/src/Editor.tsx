import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { TableKit } from "@tiptap/extension-table";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import { sanitizeHtml } from "./sanitize.js";
const lowlight = createLowlight({
  javascript,
  typescript,
  json,
  bash,
  python,
  css,
  xml,
  sql,
});
export interface EditorProps {
  html: string;
  readOnly: boolean;
  language: string;
  onChange: (html: string, text: string) => void;
  onLanguage: (language: string) => void;
  onNotice: (notice: string) => void;
}
export default function Editor({
  html,
  readOnly,
  language,
  onChange,
  onLanguage,
  onNotice,
}: EditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: false,
          protocols: ["https", "http", "mailto"],
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: "plaintext",
        HTMLAttributes: {
          tabindex: "0",
          role: "region",
          "aria-label": "代码块",
        },
      }),
      TableKit.configure({ table: { resizable: false } }),
    ],
    content: sanitizeHtml(html),
    editable: !readOnly,
    editorProps: {
      attributes: {
        "aria-label": readOnly ? "只读内容" : "编辑内容",
        role: "textbox",
        "aria-multiline": "true",
      },
      transformPastedHTML: (value) => {
        if (/<img\b|<svg\b/i.test(value))
          onNotice("当前支持文本和代码，图片将在二期提供。");
        return sanitizeHtml(value);
      },
      handlePaste: (_view, event) => {
        if (event.clipboardData?.files.length) {
          onNotice("图片将在二期提供，已保留可粘贴的文本与格式。");
          if (
            !event.clipboardData.getData("text/html") &&
            !event.clipboardData.getData("text/plain")
          )
            return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        if (event.dataTransfer?.files.length) {
          onNotice("当前不支持图片或文件。");
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) =>
      onChange(e.getHTML(), e.getText({ blockSeparator: "\n" })),
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
  });
  useEffect(() => {
    if (editor && editor.getHTML() !== html) {
      editor.commands.setContent(sanitizeHtml(html), { emitUpdate: false });
    }
  }, [editor, html]);
  useEffect(() => {
    // Permission changes are presentation state, not a user edit or TTL renewal.
    editor?.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  if (!editor) return <div className="editor-loading">正在打开轻量编辑器…</div>;
  const tool = (
    label: string,
    title: string,
    active: boolean,
    fn: () => void,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? "tool active" : "tool"}
      onClick={fn}
    >
      {label}
    </button>
  );
  return (
    <div className="editor-shell">
      {!readOnly && (
        <div className="editor-tools" role="group" aria-label="文字格式">
          {tool("B", "加粗", editor.isActive("bold"), () =>
            editor.chain().focus().toggleBold().run(),
          )}
          {tool("I", "斜体", editor.isActive("italic"), () =>
            editor.chain().focus().toggleItalic().run(),
          )}
          {tool("U", "下划线", editor.isActive("underline"), () =>
            editor.chain().focus().toggleUnderline().run(),
          )}
          <span className="tool-divider" />
          {tool("标题", "二级标题", editor.isActive("heading"), () =>
            editor.chain().focus().toggleHeading({ level: 2 }).run(),
          )}
          {tool("列表", "无序列表", editor.isActive("bulletList"), () =>
            editor.chain().focus().toggleBulletList().run(),
          )}
          {tool("引用", "引用", editor.isActive("blockquote"), () =>
            editor.chain().focus().toggleBlockquote().run(),
          )}
          {tool("链接", "设置链接", editor.isActive("link"), () => {
            const url = window.prompt(
              "链接地址（https://…）",
              editor.getAttributes("link").href || "https://",
            );
            if (url === null) return;
            if (!url.trim()) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            if (!/^(https?:\/\/|mailto:)/i.test(url)) {
              onNotice("请使用 http、https 或 mailto 链接。");
              return;
            }
            editor
              .chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href: url })
              .run();
          })}
          {tool("代码", "代码块", editor.isActive("codeBlock"), () =>
            editor.chain().focus().toggleCodeBlock({ language }).run(),
          )}
          {tool("表格", "插入简单表格", editor.isActive("table"), () => {
            editor
              .chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
          })}
          <select
            aria-label="代码语言"
            value={language}
            onChange={(e) => {
              onLanguage(e.target.value);
              if (editor.isActive("codeBlock"))
                editor
                  .chain()
                  .focus()
                  .updateAttributes("codeBlock", { language: e.target.value })
                  .run();
            }}
          >
            {[
              "plaintext",
              "javascript",
              "typescript",
              "json",
              "bash",
              "python",
              "css",
              "xml",
              "sql",
            ].map((l) => (
              <option key={l} value={l}>
                {l === "plaintext" ? "纯文本代码" : l}
              </option>
            ))}
          </select>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
