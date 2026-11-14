import { useLocale } from "./LanguageSelect.js";
import { t } from "./locale.js";
import { useEffect, useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
  type Editor,
  type Extensions,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight } from "lowlight";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import python from "highlight.js/lib/languages/python";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import sql from "highlight.js/lib/languages/sql";
import plaintext from "highlight.js/lib/languages/plaintext";

const lowlight = createLowlight({
  plaintext,
  javascript,
  typescript,
  json,
  bash,
  python,
  css,
  xml,
  sql,
});
// Imported/clipboard languages outside our menu must never silently trigger auto-detection.
lowlight.highlightAuto = (value) => lowlight.highlight("plaintext", value);
export const CODE_LANGUAGES = [
  "plaintext",
  "javascript",
  "typescript",
  "json",
  "bash",
  "python",
  "css",
  "xml",
  "sql",
] as const;
const aliases: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  py: "python",
  html: "xml",
};
export function canonicalLanguage(language: unknown): string {
  const normalized =
    typeof language === "string" ? language.toLowerCase() : "plaintext";
  const value = aliases[normalized] ?? normalized;
  return CODE_LANGUAGES.includes(value as (typeof CODE_LANGUAGES)[number])
    ? value
    : "plaintext";
}

/** PM node text only: never derive the clipboard from NodeView DOM chrome. */
export async function copyCodeText(
  text: string,
  write = (value: string) => navigator.clipboard.writeText(value),
): Promise<void> {
  await write(text);
}

/** Keep code indentation changes inside one code block; read-only Tab remains navigation. */
export function indentCode(editor: Editor, outdent = false): boolean {
  if (!editor.isEditable) return false;
  const { state } = editor,
    { selection } = state,
    { $from, $to, from, to, empty } = selection;
  if ($from.parent.type.name !== "codeBlock" || !$from.sameParent($to))
    return false;
  if (empty && !outdent) {
    editor.view.dispatch(state.tr.insertText("  ", from, to));
    return true;
  }
  const text = $from.parent.textContent,
    start = $from.start();
  const begin =
    $from.parentOffset === 0
      ? 0
      : text.lastIndexOf("\n", $from.parentOffset - 1) + 1;
  const endOffset = $to.parentOffset;
  const starts: number[] = [];
  for (let offset = begin; offset <= text.length;) {
    if (
      offset > endOffset ||
      (!empty && offset === endOffset && offset !== begin)
    )
      break;
    starts.push(offset);
    const next = text.indexOf("\n", offset);
    if (next < 0) break;
    offset = next + 1;
  }
  const tr = state.tr;
  for (const offset of starts.reverse()) {
    if (outdent) {
      const length =
        text[offset] === "\t"
          ? 1
          : (text.slice(offset).match(/^ {1,2}/)?.[0].length ?? 0);
      if (length) tr.delete(start + offset, start + offset + length);
    } else tr.insertText("  ", start + offset);
  }
  if (tr.docChanged) {
    tr.setSelection(selection.map(tr.doc, tr.mapping));
    editor.view.dispatch(tr.scrollIntoView());
  }
  return true;
}

export function setEditorReadOnly(editor: Editor, readOnly: boolean): void {
  editor.setEditable(!readOnly, false);
  // A metadata-only transaction refreshes NodeView controls without an edit/save event.
  editor.view.dispatch(editor.state.tr.setMeta("2space:editable", !readOnly));
}

function CodeBlockView({
  node,
  editor,
  getPos,
  updateAttributes,
  extension,
}: NodeViewProps) {
  useLocale();
  const [editable, setEditable] = useState(editor.isEditable),
    [copied, setCopied] = useState(false);
  useEffect(() => {
    const update = () => setEditable(editor.isEditable);
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const notify = (message: string) =>
    (extension.options as { onNotice?: (message: string) => void }).onNotice?.(
      message,
    );
  const language = canonicalLanguage(node.attrs.language);
  const lines = node.textContent.split("\n").length;
  return (
    <NodeViewWrapper className="code-block-view" data-language={language}>
      <div className="code-block-header" contentEditable={false}>
        <select
          aria-label={t("代码语言")}
          value={language}
          disabled={!editable}
          onChange={(event) => {
            if (editor.isEditable)
              updateAttributes({ language: event.target.value });
          }}
        >
          {CODE_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {value === "plaintext"
                ? t("纯文本")
                : value === "xml"
                  ? "HTML / XML"
                  : value}
            </option>
          ))}
        </select>
        <span className="code-block-hint">
          {editable ? t("Tab 缩进 · Esc 离开代码") : t("仅查看")}
        </span>
        <button
          type="button"
          aria-label={t("复制代码")}
          data-code-copy
          onClick={() => {
            void copyCodeText(node.textContent)
              .then(() => {
                setCopied(true);
                notify("代码已复制");
              })
              .catch(() => notify("复制未成功，请选中代码手动复制。"));
          }}
        >
          {t("复制代码")}
          {copied && <span aria-hidden="true"> ✓</span>}
        </button>
        {editable && (
          <button
            type="button"
            aria-label={t("退出代码块")}
            onClick={() => {
              if (!editor.isEditable) return;
              const pos = getPos();
              if (typeof pos !== "number") return;
              editor
                .chain()
                .focus()
                .setTextSelection(pos + node.nodeSize - 1)
                .exitCode()
                .run();
            }}
          >
            {t("退出代码块")}
          </button>
        )}
      </div>
      <div className="code-block-body">
        <div
          className="code-line-numbers"
          aria-hidden="true"
          contentEditable={false}
        >
          {Array.from({ length: lines }, (_, index) => (
            <span key={index}>{index + 1}</span>
          ))}
        </div>
        <pre
          className="code-block-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("代码内容")}
        >
          <NodeViewContent<"code"> as="code" style={{ whiteSpace: "pre" }} />
        </pre>
      </div>
    </NodeViewWrapper>
  );
}

const ProgrammerCodeBlock = CodeBlockLowlight.extend<{
  lowlight: typeof lowlight;
  onNotice?: (message: string) => void;
  defaultLanguage: string;
}>({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
      defaultLanguage: "plaintext",
      onNotice: undefined,
    };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      language: {
        default: "plaintext",
        rendered: false,
        parseHTML: (element) =>
          canonicalLanguage(
            Array.from(element.firstElementChild?.classList ?? [])
              .find((name) => name.startsWith("language-"))
              ?.slice("language-".length),
          ),
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: () => indentCode(this.editor),
      "Shift-Tab": () => indentCode(this.editor, true),
      "Mod-Enter": () =>
        this.editor.isEditable && this.editor.commands.exitCode(),
      Escape: () => {
        if (!this.editor.isActive("codeBlock")) return false;
        const selection = this.editor.state.selection;
        const pos =
          selection.$from.depth > 0 ? selection.$from.before() : selection.from;
        const dom = this.editor.view.nodeDOM(pos);
        const copy =
          dom instanceof HTMLElement
            ? dom.querySelector<HTMLButtonElement>("[data-code-copy]")
            : null;
        if (!copy) return false;
        copy.focus();
        return true;
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
});

export function createEditorExtensions(
  onNotice?: (message: string) => void,
): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      trailingNode: false,
      link: {
        openOnClick: false,
        autolink: false,
        protocols: ["https", "http", "mailto"],
      },
    }),
    ProgrammerCodeBlock.configure({
      lowlight,
      onNotice,
      defaultLanguage: "plaintext",
    }),
  ];
}
