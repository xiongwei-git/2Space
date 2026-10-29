import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { sanitizeHtml } from "./sanitize.js";
import {
  canonicalLanguage,
  createEditorExtensions,
  setEditorReadOnly,
} from "./code-editor.js";
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
  onNotice,
}: EditorProps) {
  const editor = useEditor({
    extensions: createEditorExtensions(onNotice),
    content: sanitizeHtml(html),
    editable: !readOnly,
    editorProps: {
      attributes: {
        "aria-label": readOnly ? "查看内容" : "编辑内容",
        role: "textbox",
        "aria-multiline": "true",
      },
      transformPastedHTML: (value) => {
        if (/<img\b|<svg\b/i.test(value))
          onNotice("图片不会粘贴，文字和常用格式已保留。");
        if (/<table(?:\s|>)/i.test(value))
          onNotice("表格已转为逐行文字，单元格内容已保留。");
        return sanitizeHtml(value);
      },
      handlePaste: (_view, event) => {
        if (event.clipboardData?.files.length) {
          onNotice("图片不会粘贴，文字和常用格式已保留。");
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
          onNotice("暂不支持图片或文件，请粘贴文字或代码。");
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
    if (editor && editor.getHTML() !== html)
      editor.commands.setContent(sanitizeHtml(html), { emitUpdate: false });
  }, [editor, html]);
  useEffect(() => {
    if (editor) setEditorReadOnly(editor, readOnly);
  }, [editor, readOnly]);
  if (!editor) return <div className="editor-loading">正在打开笔记…</div>;
  const tool = (
    label: string,
    title: string,
    active: boolean,
    action: () => void,
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={active ? "tool active" : "tool"}
      onClick={action}
    >
      {label}
    </button>
  );
  return (
    <div className="editor-shell">
      {!readOnly && (
        <div
          className="editor-tools compact-tools"
          role="toolbar"
          aria-label="文字与代码"
        >
          {tool("加粗", "加粗", editor.isActive("bold"), () =>
            editor.chain().focus().toggleBold().run(),
          )}
          {tool("行内代码", "行内代码", editor.isActive("code"), () =>
            editor.chain().focus().toggleCode().run(),
          )}
          {tool("代码块", "代码块", editor.isActive("codeBlock"), () =>
            editor
              .chain()
              .focus()
              .toggleCodeBlock({ language: canonicalLanguage(language) })
              .run(),
          )}
          <details className="editor-more-format">
            <summary>更多格式</summary>
            <div className="editor-tools">
              {tool("斜体", "斜体", editor.isActive("italic"), () =>
                editor.chain().focus().toggleItalic().run(),
              )}
              {tool("列表", "无序列表", editor.isActive("bulletList"), () =>
                editor.chain().focus().toggleBulletList().run(),
              )}
              {tool("引用", "引用", editor.isActive("blockquote"), () =>
                editor.chain().focus().toggleBlockquote().run(),
              )}
              {tool("链接", "插入或修改链接", editor.isActive("link"), () => {
                const url = window.prompt(
                  "粘贴完整网址",
                  editor.getAttributes("link").href || "https://",
                );
                if (url === null) return;
                if (!url.trim()) {
                  editor.chain().focus().unsetLink().run();
                  return;
                }
                if (!/^(https?:\/\/|mailto:)/i.test(url)) {
                  onNotice("请输入完整网址，例如 https://example.com。");
                  return;
                }
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: url })
                  .run();
              })}
            </div>
          </details>
        </div>
      )}
      <div className="editor-content">
        <EditorContent editor={editor} />
        {!readOnly && editor.isEmpty && (
          <div className="editor-placeholder" aria-hidden="true">
            在这里粘贴文字，或开始输入。代码可以放进「代码块」。
          </div>
        )}
      </div>
    </div>
  );
}
