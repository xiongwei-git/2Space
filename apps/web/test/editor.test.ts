import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { Editor, EditorContent } from "@tiptap/react";
import {
  createEditorExtensions,
  indentCode,
  setEditorReadOnly,
} from "../src/code-editor.js";
import { createSanitizer, normalizeDocument } from "../src/sanitize.js";

async function fixture(content: string) {
  const dom = new JSDOM(
    "<!doctype html><html><body><div id='react-root'></div></body></html>",
    { url: "http://localhost/", pretendToBeVisual: true },
  );
  Object.defineProperty(dom.window.navigator, "languages", {
    value: ["zh-CN"],
  });
  const writes: string[] = [];
  Object.defineProperty(dom.window.navigator, "clipboard", {
    value: {
      writeText: async (text: string) => {
        writes.push(text);
      },
    },
    configurable: true,
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Element: dom.window.Element,
    Node: dom.window.Node,
    DOMParser: dom.window.DOMParser,
    MutationObserver: dom.window.MutationObserver,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const descriptors = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(globals)) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  let updates = 0;
  const editor = new Editor({
    element: document.createElement("div"),
    injectCSS: false,
    extensions: createEditorExtensions(),
    content,
    onUpdate: () => {
      updates++;
    },
  });
  const root = createRoot(document.getElementById("react-root")!);
  await act(async () => {
    root.render(createElement(EditorContent, { editor }));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return {
    dom,
    editor,
    writes,
    updates: () => updates,
    run: async (action: () => void) => {
      await act(async () => {
        action();
      });
    },
    close: async () => {
      await act(async () => {
        root.unmount();
        editor.destroy();
      });
      dom.window.close();
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("真实编辑器初始化、只读切换与远端加载不保存，主动编辑才保存", async () => {
  const f = await fixture(
    '<pre><code class="language-javascript">  const x = 1;\n</code></pre>',
  );
  try {
    assert.equal(f.updates(), 0);
    assert.equal(f.editor.schema.nodes.table, undefined);
    assert(document.querySelector(".code-block-view"));
    await f.run(() => {
      setEditorReadOnly(f.editor, true);
    });
    const select = document.querySelector<HTMLSelectElement>(
      '[aria-label="代码语言"]',
    )!;
    assert.equal(select.disabled, true);
    assert.equal(document.querySelector('[aria-label="退出代码块"]'), null);
    assert(document.querySelector('[aria-label="复制代码"]'));
    await f.run(() => {
      setEditorReadOnly(f.editor, false);
      f.editor.commands.setContent(
        "<p>远端内容</p><pre><code>  next\n</code></pre>",
        { emitUpdate: false },
      );
    });
    assert.equal(f.updates(), 0);
    await f.run(() => {
      f.editor.commands.insertContent("主动编辑");
    });
    assert.equal(f.updates(), 1);
  } finally {
    await f.close();
  }
});

test("逐块复制只包含代码原文，行号/语言/按钮不进入HTML或文本", async () => {
  const raw = '  const value = "中文";\n\tconsole.log(value);\n';
  const f = await fixture(
    '<pre><code class="language-javascript">' + raw + "</code></pre>",
  );
  try {
    assert.equal(
      document.querySelectorAll(".code-line-numbers span").length,
      3,
    );
    assert.equal(f.editor.state.doc.firstChild!.textContent, raw);
    assert.equal(
      document
        .querySelector("code[data-node-view-content]")
        ?.getAttribute("style"),
      "white-space: pre;",
    );
    await f.run(() => {
      document
        .querySelector<HTMLButtonElement>('[aria-label="复制代码"]')!
        .click();
    });
    assert.deepEqual(f.writes, [raw]);
    const copiedButton = document.querySelector<HTMLButtonElement>(
      '[aria-label="复制代码"]',
    )!;
    assert(copiedButton.textContent?.startsWith("复制代码"));
    assert.equal(
      copiedButton.querySelector("span")?.getAttribute("aria-hidden"),
      "true",
    );
    assert.equal(f.updates(), 0);
    const html = f.editor.getHTML(),
      text = f.editor.getText({ blockSeparator: "\n" });
    assert(html.includes('<pre><code class="language-javascript">'));
    assert(
      !/复制代码|code-line-numbers|code-block-header|退出代码块/.test(html),
    );
    assert(!/复制代码|退出代码块/.test(text));
    assert(text.startsWith(raw));
  } finally {
    await f.close();
  }
});

test("多行Tab和ShiftTab保持原文，readonly拒绝缩进且Esc能离开代码", async () => {
  const f = await fixture("<pre><code>first\n  second\nthird</code></pre>");
  try {
    await f.run(() => {
      f.editor.commands.setTextSelection({
        from: 1,
        to: 1 + "first\n  second\nthird".length,
      });
      assert.equal(indentCode(f.editor), true);
    });
    assert.equal(
      f.editor.state.doc.firstChild!.textContent,
      "  first\n    second\n  third",
    );
    await f.run(() => {
      assert.equal(indentCode(f.editor, true), true);
    });
    assert.equal(
      f.editor.state.doc.firstChild!.textContent,
      "first\n  second\nthird",
    );
    const before = f.editor.getHTML();
    await f.run(() => {
      setEditorReadOnly(f.editor, true);
      assert.equal(indentCode(f.editor), false);
      assert.equal(indentCode(f.editor, true), false);
    });
    assert.equal(f.editor.getHTML(), before);
    await f.run(() => {
      setEditorReadOnly(f.editor, false);
      f.editor.commands.setTextSelection(3);
      f.editor.view.dispatchEvent(
        new f.dom.window.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    assert.equal(
      document.activeElement?.getAttribute("aria-label"),
      "复制代码",
    );
  } finally {
    await f.close();
  }
});

test("第一空行ShiftTab不删第二行缩进，Tab空选区只插入两个空格", async () => {
  const f = await fixture("<pre><code>\n  second</code></pre>");
  try {
    await f.run(() => {
      f.editor.commands.setTextSelection(1);
      assert.equal(indentCode(f.editor, true), true);
    });
    assert.equal(f.editor.state.doc.firstChild!.textContent, "\n  second");
    assert.equal(f.updates(), 0);
    await f.run(() => {
      assert.equal(indentCode(f.editor), true);
    });
    assert.equal(f.editor.state.doc.firstChild!.textContent, "  \n  second");
    assert.equal(f.updates(), 1);
  } finally {
    await f.close();
  }
});

test("旧表格显示转换保留所有单元格和行关系，加载不触发保存", async () => {
  const f = await fixture("<p>之前内容</p>");
  try {
    const old = {
      title: "旧笔记",
      html: "<p>开头</p><table><tr><th>名称</th><th>值</th></tr><tr><td>中文</td><td>42</td></tr></table><pre><code>  keep\n    indent</code></pre>",
      text: "old",
      language: "plaintext",
    };
    const normalized = normalizeDocument(old);
    assert.equal(normalized.title, old.title);
    assert(!normalized.html.includes("<table"));
    assert(normalized.text.includes("名称 | 值\n中文 | 42"));
    assert(normalized.text.includes("  keep\n    indent"));
    await f.run(() => {
      f.editor.commands.setContent(normalized.html, { emitUpdate: false });
    });
    assert.equal(f.updates(), 0);
    assert.equal(f.editor.view.dom.querySelector("table"), null);
    assert(f.editor.getText().includes("名称 | 值"));
    assert(f.editor.getText().includes("中文 | 42"));
    const plain = createSanitizer(
      f.dom.window as unknown as Parameters<typeof createSanitizer>[0],
    );
    await f.run(() => {
      f.editor.commands.insertContent(
        plain(
          "<table><tr><td>粘贴A</td><td>粘贴B</td></tr><tr><td>粘贴C</td><td>粘贴D</td></tr></table>",
        ),
      );
    });
    assert.equal(f.updates(), 1);
    assert(f.editor.getText().includes("粘贴A | 粘贴B"));
    assert(f.editor.getText().includes("粘贴C | 粘贴D"));
  } finally {
    await f.close();
  }
});

test("真实键盘Tab/ShiftTab与ModEnter生效，语言高亮和原始代码独立", async () => {
  const raw = "const answer = 42;\n";
  const f = await fixture(
    '<pre><code class="language-javascript">' + raw + "</code></pre>",
  );
  try {
    assert(
      document.querySelector(".hljs-keyword"),
      "现有lowlight应在代码DOM提供语法高亮",
    );
    await f.run(() => {
      f.editor.commands.setTextSelection(1);
      f.editor.view.dispatchEvent(
        new f.dom.window.KeyboardEvent("keydown", {
          key: "Tab",
          code: "Tab",
          keyCode: 9,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(f.editor.state.doc.firstChild!.textContent, "  " + raw);
    await f.run(() => {
      f.editor.view.dispatchEvent(
        new f.dom.window.KeyboardEvent("keydown", {
          key: "Tab",
          code: "Tab",
          keyCode: 9,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    assert.equal(f.editor.state.doc.firstChild!.textContent, raw);
    await f.run(() => {
      f.editor.view.dispatchEvent(
        new f.dom.window.KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    // PM keymap reads the host platform at import; accept its native Ctrl/Cmd variant.
    if (f.editor.state.selection.$from.parent.type.name !== "paragraph")
      await f.run(() => {
        f.editor.view.dispatchEvent(
          new f.dom.window.KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    assert.equal(f.editor.state.selection.$from.parent.type.name, "paragraph");
    assert.equal(f.editor.state.doc.firstChild!.textContent, raw);
    assert(!f.editor.getHTML().includes("hljs-keyword"));
  } finally {
    await f.close();
  }
});

test("整个代码块或全文选中后Esc安全退出，不修改内容", async () => {
  const f = await fixture("<pre><code>  only code</code></pre>");
  try {
    const before = f.editor.getHTML();
    for (const selection of ["node", "all"]) {
      await f.run(() => {
        if (selection === "node") f.editor.commands.setNodeSelection(0);
        else f.editor.commands.selectAll();
        f.editor.view.dispatchEvent(
          new f.dom.window.KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      assert.equal(
        document.activeElement?.getAttribute("aria-label"),
        "复制代码",
      );
      assert.equal(f.editor.getHTML(), before);
      assert.equal(f.updates(), 0);
    }
  } finally {
    await f.close();
  }
});

test("纯文本和未知语言不自动猜测高亮，别名规范后JavaScript仍高亮且加载不保存", async () => {
  for (const [incoming, canonical, highlight] of [
    ["plaintext", "plaintext", false],
    ["unknown-language", "plaintext", false],
    ["js", "javascript", true],
    ["JavaScript", "javascript", true],
  ] as const) {
    const f = await fixture(
      `<pre><code class="language-${incoming}">const answer = 42;</code></pre>`,
    );
    try {
      assert.equal(f.editor.state.doc.firstChild!.attrs.language, canonical);
      assert.equal(
        document.querySelector<HTMLSelectElement>('[aria-label="代码语言"]')!
          .value,
        canonical,
      );
      assert.equal(!!document.querySelector(".hljs-keyword"), highlight);
      assert.equal(
        f.editor.state.doc.firstChild!.textContent,
        "const answer = 42;",
      );
      assert.equal(f.updates(), 0);
    } finally {
      await f.close();
    }
  }
});
