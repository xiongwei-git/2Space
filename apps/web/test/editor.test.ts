import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

test("初始化、只读切换与远端内容加载不触发保存，真实编辑才触发", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
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
    extensions: [StarterKit],
    content: "<p>现有内容</p>",
    onUpdate: () => {
      updates++;
    },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(updates, 0, "挂载不应触发保存");
    editor.setEditable(true, false);
    editor.setEditable(false, false);
    editor.setEditable(true, false);
    editor.commands.setContent("<p>远端新版</p>", { emitUpdate: false });
    assert.equal(updates, 0, "权限切换和远端同步不应触发保存");
    editor.commands.insertContent("主动编辑");
    assert.equal(updates, 1, "主动编辑应触发保存");
  } finally {
    editor.destroy();
    dom.window.close();
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
