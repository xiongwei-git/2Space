import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createSanitizer } from "../src/sanitize.js";
const clean = createSanitizer(
  new JSDOM("").window as unknown as Parameters<typeof createSanitizer>[0],
);
test("保留富文本表格代码，移除跟踪图片与可执行内容", () => {
  const html = clean(
    '<p style="color:red" onclick="alert(1)"><strong>内容</strong><img src="https://tracker.test/a"/><script>alert(1)</script></p><iframe src="https://evil.test"></iframe><table><tr><td>格</td></tr></table><pre><code class="language-js">  x\ny</code></pre>',
  );
  assert(html.includes("<strong>内容</strong>"));
  assert(html.includes("<table>"));
  assert(html.includes("  x\ny"));
  assert(!/script|iframe|onclick|style=|img|tracker/.test(html));
});
test("危险链接和任意class被清除", () => {
  const html = clean(
    '<a href="javascript:alert(1)">x</a><p class="external tracking">t</p><a href="https://example.com">safe</a>',
  );
  assert(!html.includes("javascript:"));
  assert(!html.includes("tracking"));
  assert(html.includes("https://example.com"));
});
