import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createSanitizer } from "../src/sanitize.js";
const clean = createSanitizer(
  new JSDOM("").window as unknown as Parameters<typeof createSanitizer>[0],
);
test("保留富文本代码和表格全部行列文字，移除跟踪与可执行内容", () => {
  const html = clean(
    '<p style="color:red" onclick="alert(1)"><strong>内容</strong><img src="https://tracker.test/a"/><script>alert(1)</script></p><iframe src="https://evil.test"></iframe><table><tr><th>名称</th><th>值</th></tr><tr><td>格</td><td>42</td></tr></table><pre><code class="language-js">  x\ny</code></pre>',
  );
  assert(html.includes("<strong>内容</strong>"));
  assert(!/<\/?(?:table|tr|td|th)\b/.test(html));
  assert(html.includes("<p>名称 | 值</p><p>格 | 42</p>"));
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
test("嵌套表格、caption、空单元格和多段单元格不会静默丢字", () => {
  const html = clean(
    "<table><caption>说明</caption><tr><td>外层<table><tr><td>内A</td><td>内B</td></tr></table></td><td><p>第一段</p><p>第二段</p></td><td></td></tr></table>",
  );
  for (const value of ["说明", "外层", "内A", "内B", "第一段", "第二段"])
    assert(html.includes(value));
  assert(html.includes("内A | 内B"));
  assert(!html.includes("<table"));
  assert.equal(clean(html), html, "转换结果幂等");
});
