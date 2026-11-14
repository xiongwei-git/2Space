import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  hkdfSync,
} from "node:crypto";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

// No traces, videos, HTML dumps, request logs or capability URLs are persisted.
const out = resolve("output/design-acceptance");
const temp = await mkdtemp(join(tmpdir(), "2space-visual-"));
process.env.DB_PATH = join(temp, "synthetic.sqlite");
process.env.WEB_DIST = resolve("apps/web/dist");
const { buildApp } = await import("../apps/server/dist/app.js");
const app = await buildApp();
let browser;
const records = [];
const startedAt = new Date().toISOString();
let stage = "startup";
let programmerPage;
let failureDiagnostics;
// Reproduce a native share sheet's "copy" result, which may append share text.
async function assertPlainShare(page, expectedLink) {
  const close = page.getByRole("button", { name: "关闭提示", exact: true });
  if (await close.count()) await close.click();
  await page.evaluate(async () => {
    window.__nativeShareCopyCompleted = false;
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data) => {
        await navigator.clipboard.writeText(
          `${data.url} ${data.text || data.title || ""}`.trim(),
        );
        window.__nativeShareCopyCompleted = true;
      },
    });
    await navigator.clipboard.writeText("");
  });
  await page
    .locator(".actions")
    .getByRole("button", { name: "分享", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      window.__nativeShareCopyCompleted ||
      document.querySelector(".toast")?.textContent.includes("链接已复制"),
  );
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(
    copied === expectedLink,
    "分享复制纯链接，不附加打开剪贴板等说明文字",
  );
  if (!new URL(copied).hash) {
    const reopened = await page.context().newPage();
    await reopened.goto(copied);
    await workspace(reopened);
    assert.equal(
      await reopened.locator(".tiptap").getAttribute("contenteditable"),
      new URL(copied).searchParams.has("readonly") ? "false" : "true",
      "复制的纯链接可直接打开且保留页面模式",
    );
    await reopened.close();
  }
}
async function report(status) {
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        baseline: "web-reading-v1",
        reference: "2space-product-redesign-v1",
        layoutPolicy:
          "2space split introduction and name entry; writing canvas plus utility rail; narrow single column; natural page scroll",
        startedAt,
        status,
        stage,
        failureDiagnostics,
        records,
      },
      null,
      2,
    ),
  );
}
const ownerToken = randomBytes(32).toString("base64url");
const key = randomBytes(32);
const pageId = randomUUID();
const text = "中文阅读验收：正文清楚，重要提示可见，换台设备接着使用。";
function payload(suffix = "", documentKey = key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", documentKey, iv);
  const doc = {
    title: "中文阅读验收笔记",
    html: `<p>${text.repeat(4)}${suffix}</p><p>第二段说明保留完整的中文阅读节奏。</p><pre><code class="language-javascript">const message = '中文代码';\n// 代码注释需要清晰可读\nconsole.log(message);</code></pre>`,
    text:
      text.repeat(4) +
      suffix +
      "\n第二段说明保留完整的中文阅读节奏。\nconst message = '中文代码';\n// 代码注释需要清晰可读\nconsole.log(message);",
    language: "javascript",
  };
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(doc)),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return {
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}
async function audit(
  page,
  name,
  { editor = false, modal = false, scale = 1 } = {},
) {
  stage = name;
  await page.evaluate(() => document.fonts.ready);
  if (editor && !modal) await page.evaluate(() => window.scrollTo(0, 0));
  // Mark only capability-bearing values; public space names remain visible.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("[data-acceptance-private]"))
      el.removeAttribute("data-acceptance-private");
    for (const el of document.querySelectorAll("input,textarea,code")) {
      if (
        el.id === "spaceName" ||
        /名称/.test(el.getAttribute("aria-label") || "")
      )
        continue;
      const value = "value" in el ? el.value : el.textContent || "";
      if (
        /https?:\/\/[^\s]*#|#(?:o|r|k|m|w)=/.test(value) ||
        /^[A-Za-z0-9_-]{22}(?:[A-Za-z0-9_-]{21})?$/.test(value)
      ) {
        el.setAttribute("data-acceptance-private", "true");
      }
    }
  });
  // Capture before asserting, so failures remain reviewable without leaking links.
  await page.screenshot({
    path: join(out, `${name}.png`),
    fullPage: !modal,
    animations: "disabled",
    mask: [
      page.locator(
        'input[aria-label="仅查看链接"],textarea[aria-label="仅查看链接"],input[aria-label="可编辑链接"],textarea[aria-label="可编辑链接"]',
      ),
      page.locator('input[type="password"],.viewer-ip,[data-sensitive]'),
      page.locator(".qr"),
      page.locator("[data-acceptance-private]"),
    ],
  });
  const result = await page.evaluate(
    ({ editor, modal, scale }) => {
      const failures = [];
      const scope = modal ? document.querySelector(".modal") : document.body;
      const visible = (el) => {
        for (
          let ancestor = el.parentElement;
          ancestor;
          ancestor = ancestor.parentElement
        ) {
          if (
            ancestor.tagName === "DETAILS" &&
            !ancestor.open &&
            !ancestor.querySelector(":scope > summary")?.contains(el)
          )
            return false;
        }
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          s.display !== "none"
        );
      };
      const items = [],
        geometry = [];
      const rgba = (value) => {
        const numbers = value.match(/[\d.]+/g)?.map(Number);
        if (value.startsWith("color(srgb ") && numbers?.length >= 3)
          return [
            ...numbers.slice(0, 3).map((channel) => channel * 255),
            numbers[3] ?? 1,
          ];
        if (!value.startsWith("rgb")) return null;
        return numbers?.length >= 3
          ? [...numbers.slice(0, 3), numbers[3] ?? 1]
          : null;
      };
      const blend = (fg, bg) =>
        fg
          .slice(0, 3)
          .map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]))
          .concat(1);
      const luminance = (color) =>
        color
          .slice(0, 3)
          .map((c) => c / 255)
          .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
          .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
      const background = (el) => {
        const layers = [];
        for (let node = el; node; node = node.parentElement)
          layers.unshift(node);
        let lower = [255, 255, 255, 1],
          upper = [...lower];
        for (const node of layers) {
          const style = getComputedStyle(node),
            color = rgba(style.backgroundColor);
          if (!color) return null;
          lower = blend(color, lower);
          upper = blend(color, upper);
          if (style.backgroundImage !== "none") {
            const images = [];
            let depth = 0,
              from = 0;
            for (let i = 0; i < style.backgroundImage.length; i++) {
              const char = style.backgroundImage[i];
              if (char === "(") depth++;
              else if (char === ")") depth--;
              else if (char === "," && depth === 0) {
                images.push(style.backgroundImage.slice(from, i));
                from = i + 1;
              }
            }
            images.push(style.backgroundImage.slice(from));
            for (const image of images.reverse()) {
              // Conservative RGB bounds cover every stop, interpolation, and alpha layer.
              if (!/gradient\(/.test(image) || /url\(/.test(image)) return null;
              const stops = [...image.matchAll(/rgba?\([^)]*\)/g)]
                .map((match) => rgba(match[0]))
                .filter(Boolean);
              if (!stops.length) return null;
              const colors = stops.flatMap((stop) => [
                blend(stop, lower),
                blend(stop, upper),
              ]);
              lower = [0, 1, 2]
                .map((channel) =>
                  Math.min(...colors.map((color) => color[channel])),
                )
                .concat(1);
              upper = [0, 1, 2]
                .map((channel) =>
                  Math.max(...colors.map((color) => color[channel])),
                )
                .concat(1);
            }
          }
        }
        return { lower, upper };
      };
      for (const el of scope.querySelectorAll("*")) {
        if (
          !visible(el) ||
          el.matches("script,style,option") ||
          el.closest('[aria-hidden="true"]')
        )
          continue;
        const hasText =
          [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
          ) || el.matches("input,textarea,select");
        if (!hasText) continue;
        const s = getComputedStyle(el),
          size = parseFloat(s.fontSize);
        const cls = el.className?.toString() || el.tagName;
        const isMeta = el.matches(
          ".sidebar-heading > span,.page-number,.character-count,.site-footer .version,.board-footer .version,.home-footer .version",
        );
        const isBody = el.closest(
          ".hero-sub,.hero-promise,.demo-document p,.demo-document li,.format-sample p,.privacy-callout p,.section-head p,.step p,.feature p,.case p,.usage-topic dd,.privacy-question dd,.support-card p:not(.support-note),.home-footer p,.preview-paper p,.editor-placeholder,.tiptap p,.tiptap li,.tiptap pre,.modal p:not(.muted),.modal li,.bookmark-steps dd,.conflict-banner p",
        );
        const min = (isBody ? 16 : isMeta ? 12 : 14) * scale;
        if (size + 0.1 < min) failures.push(`${cls}: ${size}px < ${min}px`);
        let contrast = null;
        if (!el.closest(":disabled")) {
          for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
            const painted = getComputedStyle(ancestor);
            if (Number(painted.opacity) !== 1) {
              failures.push(`${cls}: 半透明信息需要显式对比度审查`);
              break;
            }
          }
          const fg = rgba(s.color),
            bg = background(el);
          if (!fg || !bg) failures.push(`${cls}: 颜色需要人工解析`);
          else {
            const a = luminance(blend(fg, bg.lower)),
              b = luminance(blend(fg, bg.upper));
            const low = luminance(bg.lower),
              high = luminance(bg.upper);
            const foregroundLow = Math.min(a, b),
              foregroundHigh = Math.max(a, b);
            contrast =
              foregroundHigh < low
                ? (low + 0.05) / (foregroundHigh + 0.05)
                : foregroundLow > high
                  ? (foregroundLow + 0.05) / (high + 0.05)
                  : 1;
            const required =
              size >= 24 || (size >= 18.6667 && Number(s.fontWeight) >= 700)
                ? 3
                : 4.5;
            if (contrast < required)
              failures.push(
                `${cls}: 对比度${contrast.toFixed(3)} < ${required}`,
              );
          }
        }
        if (
          parseFloat(s.lineHeight) / size + 0.01 < 1.5 &&
          !el.closest("h1,h2,h3") &&
          !el.matches(".brand *,.notice button,.modal-close")
        )
          failures.push(`${cls}: line-height不足`);
        if (
          el.matches("h1,h2,h3,.page-item b,.risk-note") &&
          Number(s.fontWeight) < 500
        )
          failures.push(`${cls}: 强调角色字重不足`);
        if (
          el.matches("button,input,select,textarea") &&
          !el.closest(".page-item") &&
          el.scrollHeight > el.clientHeight + 3 &&
          !el.matches("textarea")
        )
          failures.push(`${cls}: 控件文字可能被裁切`);
        items.push({
          element: cls,
          size,
          lineHeight: s.lineHeight,
          weight: s.fontWeight,
          fontFamily: s.fontFamily,
          color: s.color,
          background: s.backgroundColor,
          contrast,
        });
      }
      if (document.documentElement.scrollWidth > innerWidth + 1)
        failures.push("页面横向溢出");
      if (editor && !modal) {
        for (const selector of [
          ".board-sidebar > .card",
          ".qr-wrap",
          ".qr-box",
          ".qr-box .qr",
          ".qr-box .link",
          ".qr-box .link input",
          ".qr-box .link button",
        ]) {
          for (const element of document.querySelectorAll(selector)) {
            const rect = element.getBoundingClientRect(),
              parent = element.parentElement.getBoundingClientRect();
            geometry.push({
              selector,
              width: rect.width,
              parentWidth: parent.width,
              leftOverflow: parent.left - rect.left,
              rightOverflow: rect.right - parent.right,
            });
            if (rect.left < parent.left - 1 || rect.right > parent.right + 1)
              failures.push(`${selector}: 元素超出父容器`);
          }
        }
      }
      for (const pre of scope.querySelectorAll(".tiptap pre")) {
        if (getComputedStyle(pre).whiteSpace !== "pre")
          failures.push("编辑器代码格式被换行样式覆盖");
      }
      if (editor && !modal) {
        const e = document.querySelector(".tiptap");
        if (!e || parseFloat(getComputedStyle(e).fontSize) < 16 * scale)
          failures.push("编辑正文不足16px");
        const container = document.querySelector(".board-container");
        const header = document.querySelector(".board-header");
        const content = document.querySelector(".board-main");
        const sidebar = document.querySelector(".board-sidebar");
        if (!container || !header || !content || !sidebar)
          failures.push("工作区关键区域缺失");
        else {
          const c = container.getBoundingClientRect(),
            h = header.getBoundingClientRect(),
            main = content.getBoundingClientRect(),
            side = sidebar.getBoundingClientRect();
          if (c.width > 1181) failures.push("编辑页超出1180px内容容器");
          if (h.top < -1 || h.top > 40)
            failures.push("顶部动作未保持在页面开头");
          if (innerWidth > 900) {
            if (side.left < main.right - 1 || Math.abs(side.top - main.top) > 2)
              failures.push("宽屏不是主编辑加右栏");
          } else if (side.top < main.bottom - 1)
            failures.push("窄屏右栏没有改为下方单列");
          if (getComputedStyle(document.body).overflowY === "hidden")
            failures.push("自然页面滚动被禁止");
          const topActions = header.querySelector(".actions");
          if (
            !topActions ||
            topActions.getBoundingClientRect().bottom > innerHeight
          )
            failures.push("顶部动作在初始视口不可达");
        }
      }
      return { failures, items, geometry };
    },
    { editor, modal, scale },
  );
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const violations = axe.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    targets: v.nodes.map((n) => n.target),
  }));
  const incomplete = axe.incomplete.map((v) => ({
    id: v.id,
    targets: v.nodes.map((n) => n.target),
  }));
  records.push({ name, ...result, violations, incomplete });
  await report("running");
  assert.deepEqual(result.failures, [], `${name}: 阅读样式检查失败`);
  assert.deepEqual(violations, [], `${name}: 自动可访问性检查失败`);
  console.log(`PASS: ${name}`);
}
async function api(
  address,
  path,
  { method = "GET", body, token, status = 200 } = {},
) {
  const response = await fetch(`${address}/api${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, status, "合成API状态符合契约");
  return status === 204 ? null : response.json();
}
function envelopeForDocument(document, rawKey = key) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", rawKey, iv);
  return {
    iv: iv.toString("base64url"),
    ciphertext: Buffer.concat([
      cipher.update(JSON.stringify(document)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url"),
  };
}
async function assertBrand(page, faviconText, expectedGeometry) {
  const result = await page.evaluate(
    ({ faviconText }) => {
      const fingerprint = (svg) =>
        JSON.stringify(
          [...svg.querySelectorAll("g,rect")].map((node) => ({
            tag: node.tagName.toLowerCase(),
            attrs: [
              "transform",
              "stroke",
              "stroke-width",
              "data-brand-panel",
              "x",
              "y",
              "width",
              "height",
              "rx",
              "fill",
            ]
              .filter((name) => node.hasAttribute(name))
              .map((name) => [name, node.getAttribute(name)]),
          })),
        );
      const marks = [
        ...document.querySelectorAll('svg[data-brand-mark="2space-dual"]'),
      ];
      const favicon = new DOMParser().parseFromString(
        faviconText,
        "image/svg+xml",
      ).documentElement;
      return {
        count: marks.length,
        signatures: marks.map(fingerprint),
        favicon: fingerprint(favicon),
        panels: marks.map(
          (mark) => mark.querySelectorAll("rect[data-brand-panel]").length,
        ),
      };
    },
    { faviconText },
  );
  assert.ok(result.count >= 1, "页面显示原双格标识");
  assert.ok(
    result.panels.every((count) => count === 2),
    "品牌标识为两块面板",
  );
  assert.ok(
    result.signatures.every((signature) => signature === result.favicon),
    "页面与favicon双格几何一致",
  );
  if (expectedGeometry)
    assert.ok(
      result.signatures.every((signature) => signature === expectedGeometry),
      "首页与工作区使用同一标识",
    );
  assert.equal(
    await page.locator('link[rel~="icon"]').getAttribute("href"),
    "/favicon.svg",
    "页面绑定双格favicon资源",
  );
  return result.favicon;
}
async function pasteRich(page, html, text) {
  await page.evaluate(
    async ({ html, text }) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
    },
    { html, text },
  );
  await page.locator(".tiptap").focus();
  await page.keyboard.press("ControlOrMeta+V");
}
function textOrder(value, tokens) {
  let offset = -1;
  for (const token of tokens) {
    const next = value.indexOf(token, offset + 1);
    if (next <= offset) return false;
    offset = next;
  }
  return true;
}
async function saved(page) {
  await page
    .locator(".save-state")
    .filter({ hasText: /^已保存/ })
    .waitFor();
}
async function workspace(page) {
  await page.locator(".tiptap").waitFor();
  await page.locator(".board-sidebar .qr img").first().waitFor();
}
async function closeModal(page) {
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
}
try {
  await mkdir(out, { recursive: true });
  await report("running");
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const privateSpace = await api(address, "/spaces", {
    method: "POST",
    body: {
      ownerToken,
      retentionSeconds: 1800,
      page: { id: pageId, payload: payload() },
    },
    status: 201,
  });
  const ownerUrl = `${address}/s/${privateSpace.id}#k=${key.toString("base64url")}&m=${ownerToken}`;
  const legacyShare = await api(address, `/spaces/${privateSpace.id}/shares`, {
    method: "POST",
    token: ownerToken,
    status: 201,
  });
  const oldReaderUrl = `${address}/s/${privateSpace.id}#k=${key.toString("base64url")}&r=${legacyShare.token}`;
  const publicName = `reference_${randomBytes(4).toString("hex")}`;
  const publicSpace = await api(address, "/spaces", {
    method: "POST",
    body: {
      accessMode: "public",
      name: publicName,
      publicKey: key.toString("base64url"),
      ownerToken: randomBytes(32).toString("base64url"),
      page: { id: randomUUID(), payload: payload() },
    },
    status: 201,
  });
  const publicUrl = `${address}/${publicName}`;
  const faviconResponse = await fetch(`${address}/favicon.svg`);
  assert.equal(faviconResponse.status, 200, "本地favicon可读取");
  const faviconText = await faviconResponse.text();
  let brandGeometry;
  browser = await chromium.launch();
  for (const [label, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
    ["narrow", 320, 900],
  ]) {
    stage = `${label}-home-setup`;
    const context = await browser.newContext({
      locale: "zh-CN",
      viewport: { width, height },
      reducedMotion: "reduce",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    await page.goto(address);
    await page.getByRole("button", { name: /进入剪贴板/ }).waitFor();
    brandGeometry = await assertBrand(page, faviconText, brandGeometry);
    assert.equal(
      (await page.locator("h1[data-brand-slogan]").textContent()).replace(
        /\s+/g,
        "",
      ),
      "这边复制，那边就有。",
      "首页恢复原slogan",
    );
    assert.equal(
      await page.locator('svg[data-brand-mark="2space-dual"]').count(),
      2,
      "首页头尾品牌一致",
    );
    for (const id of ["how", "features", "cases", "compare", "faq", "support"])
      assert.equal(
        await page.locator(`#${id}`).count(),
        1,
        `首页${id}区段存在`,
      );
    assert.equal(await page.locator("#how .step").count(), 3, "三步上手");
    assert.equal(
      await page.locator("#features .feature").count(),
      6,
      "六项功能",
    );
    assert.equal(await page.locator("#cases .case").count(), 4, "四种场景");
    assert.equal(
      await page.locator("#faq .usage-topic").count(),
      3,
      "使用小抄按三个使用时机组织",
    );
    assert.equal(
      await page.locator("#faq .usage-topic dt").count(),
      7,
      "七个具体疑问",
    );
    assert.equal(
      await page.locator("#faq .usage-topic dd:visible").count(),
      7,
      "答案直接可读，无需逐个展开",
    );
    assert.equal(
      await page.locator("#privacy-faq dt").count(),
      6,
      "六项隐私与泄露风险问答",
    );
    assert.equal(
      await page.locator("#privacy-faq dd:visible").count(),
      6,
      "隐私保护范围与风险直接可读",
    );
    assert.equal(
      await page
        .getByText("服务提供方能读取我的内容吗？", { exact: true })
        .count(),
      0,
      "移除服务方读取问答",
    );
    assert.equal(
      await page.getByText("内容加密存储", { exact: true }).count(),
      1,
      "首页说明内容加密存储",
    );
    assert.equal(
      await page.getByText("HTTPS 加密传输", { exact: true }).count(),
      0,
      "HTTP本地页面不声称HTTPS传输",
    );
    if (label === "desktop") {
      const hero = await page.locator(".hero-layout").evaluate((el) => {
        const copy = el.querySelector(".hero-copy").getBoundingClientRect();
        const demo = el.querySelector(".transfer-demo").getBoundingClientRect();
        return { copyRight: copy.right, demoLeft: demo.left };
      });
      assert.ok(
        hero.copyRight <= hero.demoLeft,
        "桌面名称入口与跨设备演示分栏",
      );
      let documentLoads = 0;
      page.on("request", (request) => {
        if (
          request.isNavigationRequest() &&
          request.frame() === page.mainFrame()
        )
          documentLoads++;
      });
      for (const [name, id] of [
        ["核心功能", "features"],
        ["使用场景", "cases"],
        ["常见问题", "faq"],
        ["♥ 支持我们", "support"],
      ]) {
        await page
          .getByRole("navigation", { name: "主导航" })
          .getByRole("link", { name, exact: true })
          .click();
        await page.waitForFunction((id) => {
          const top = document.getElementById(id).getBoundingClientRect().top;
          return top >= -2 && top < window.innerHeight / 2;
        }, id);
        assert.equal(documentLoads, 0, `${name}首次点击不刷新页面`);
      }
      await page
        .getByRole("link", { name: "2Space 首页", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: /进入剪贴板/ }).waitFor();
    }
    await audit(page, `${label}-reference-home`);
    await page.getByRole("button", { name: "收藏首页", exact: true }).click();
    await page
      .getByRole("dialog", { name: "添加浏览器书签", exact: true })
      .waitFor();
    await audit(page, `${label}-home-bookmark`, { modal: true });
    await page
      .getByRole("button", { name: "复制当前页链接", exact: true })
      .click();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        page.url(),
      "首页收藏辅助复制当前地址",
    );
    await page.getByRole("button", { name: "知道了", exact: true }).click();

    await page.getByText("隐私政策", { exact: true }).click();
    await page.getByText("使用条款", { exact: true }).click();
    await audit(page, `${label}-reference-faq-privacy`);
    const protection = page.locator(".protection-explainer");
    const illustrations = protection.locator(".protection-flow img");
    assert.equal(await illustrations.count(), 3);
    for (const illustration of await illustrations.all()) {
      await illustration.scrollIntoViewIfNeeded();
      await illustration.evaluate((img) => img.decode());
    }
    await protection.screenshot({
      path: join(out, `${label}-encryption-comic.png`),
      animations: "disabled",
      style:
        ".site-header { position: static; } .toast { visibility: hidden; }",
    });

    const technicalDetails = protection.locator("details");
    assert.equal(await technicalDetails.getAttribute("open"), null);
    await technicalDetails.locator("summary").focus();
    await page.keyboard.press("Enter");
    assert.equal(await technicalDetails.getAttribute("open"), "");
    await audit(page, `${label}-protection-details`);
    await protection.screenshot({
      path: join(out, `${label}-protection-preview.png`),
      animations: "disabled",
      style:
        ".site-header { position: static; } .toast { visibility: hidden; }",
    });
    await page.keyboard.press("Enter");
    assert.equal(await technicalDetails.getAttribute("open"), null);

    await page
      .getByRole("button", { name: "♥ 支持2Space", exact: true })
      .click();
    await audit(page, `${label}-reference-support`, { modal: true });
    await page
      .getByRole("button", { name: "复制首页链接", exact: true })
      .click();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        `${address}/`,
      "支持弹窗复制本产品首页",
    );
    await closeModal(page);
    const enteredName = `Ui_${randomBytes(4).toString("hex")}`;
    await page.locator("#spaceName").fill(enteredName);
    await page.getByRole("button", { name: /进入剪贴板/ }).click();
    await workspace(page);
    assert.equal(
      new URL(page.url()).pathname,
      `/${enteredName}`,
      "首页名称创建空间",
    );
    assert.equal(new URL(page.url()).hash, "", "公开名称入口不需要能力片段");
    const uiCreated = await api(address, `/spaces/by-name/${enteredName}`);
    assert.equal(uiCreated.accessMode, "public");
    assert.equal(uiCreated.retentionSeconds, 0);
    assert.equal(
      await page.locator(".editor-placeholder").count(),
      1,
      "空白可编辑页有视觉占位",
    );
    await audit(page, `${label}-reference-created`, { editor: true });
    stage = `${label}-empty-code-block`;
    await page.getByRole("button", { name: "代码块", exact: true }).click();
    assert.equal(
      await page.locator(".code-block-view").count(),
      1,
      "空白页可直接创建代码块",
    );
    assert.equal(
      await page.locator(".editor-placeholder").count(),
      0,
      "空代码块不显示普通正文占位，避免与代码工具栏重叠",
    );
    await audit(page, `${label}-empty-code-block`, { editor: true });
    await page.getByRole("button", { name: "代码块", exact: true }).click();
    assert.equal(
      await page.locator(".code-block-view").count(),
      0,
      "切回普通段落",
    );
    assert.equal(
      await page.locator(".editor-placeholder").count(),
      1,
      "恢复单个空段落时重新显示占位",
    );
    await page.getByRole("button", { name: "代码块", exact: true }).click();
    await page.locator(".tiptap").press("a");
    assert.equal(
      await page
        .locator(".code-block-view code[data-node-view-content]")
        .textContent(),
      "a",
      "代码块接收真实键盘输入",
    );
    await page.locator(".tiptap").press("Backspace");
    assert.equal(
      await page.locator(".editor-placeholder").count(),
      0,
      "删空代码后正文占位仍不显示",
    );
    await page.getByRole("button", { name: "退出代码块", exact: true }).click();
    assert.equal(
      await page.locator(".tiptap > p").count(),
      1,
      "退出代码块得到普通段落",
    );
    assert.equal(
      await page.locator(".editor-placeholder").count(),
      0,
      "保留空代码块的结构化文档不显示全局占位",
    );

    await page
      .locator(".tiptap")
      .fill("自然滚动长文：正文保持16px，不为高度缩小字体。\n".repeat(100));
    await saved(page);
    assert.equal(
      await page.locator(".editor-placeholder").count(),
      0,
      "输入后占位消失",
    );
    await audit(page, `${label}-reference-long`, { editor: true });
    await page.goto(address);
    await page.locator("#spaceName").fill(enteredName);
    await page.getByRole("button", { name: /进入剪贴板/ }).click();
    await workspace(page);
    assert.equal(
      (await api(address, `/spaces/by-name/${enteredName}`)).id,
      uiCreated.id,
      "同名重新进入原空间",
    );
    await page.goto(publicUrl);
    await workspace(page);
    await assertBrand(page, faviconText, brandGeometry);
    assert.equal(
      await page.locator(".tiptap").getAttribute("contenteditable"),
      "true",
      "公开名称可编辑",
    );
    assert.equal(await page.getByRole("tab").count(), 1, "主剪贴板初始存在");
    assert.equal(
      await page.getByRole("tab").first().getByRole("button").count(),
      0,
      "主页面没有删除入口",
    );
    assert.equal(
      await page.locator(".board-sidebar .qr img").count(),
      2,
      "两组二维码常驻",
    );
    assert.ok(
      (await page.getByLabel("可编辑链接", { exact: true }).inputValue()) ===
        publicUrl,
      "公开编辑链接直接使用名称",
    );
    assert.ok(
      (await page.getByLabel("仅查看链接", { exact: true }).inputValue()) ===
        `${publicUrl}?readonly`,
      "仅查看为显式页面模式",
    );
    await audit(page, `${label}-reference-editor`, { editor: true });
    await page
      .getByRole("button", { name: "收藏当前剪贴板", exact: true })
      .click();
    await audit(page, `${label}-workspace-bookmark`, { modal: true });
    await page
      .getByRole("button", { name: "复制当前页链接", exact: true })
      .click();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())) === publicUrl,
      "收藏辅助复制保留当前剪贴板地址",
    );
    await page.getByRole("button", { name: "知道了", exact: true }).click();

    if (label === "desktop") {
      await page
        .getByRole("toolbar", { name: "文字与代码", exact: true })
        .waitFor();
      assert.ok(
        await page
          .getByRole("button", { name: "代码块", exact: true })
          .isVisible(),
        "代码入口直接可见",
      );
      assert.equal(
        await page.getByRole("button", { name: /表格/ }).count(),
        0,
        "编辑器没有表格入口",
      );
      await page
        .locator(".code-block-view")
        .first()
        .getByRole("combobox", { name: "代码语言", exact: true })
        .waitFor();
      await audit(page, "desktop-reference-format-tools", { editor: true });
      const beforeVisit = await api(address, `/spaces/${publicSpace.id}`);
      const visitResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/spaces/${publicSpace.id}/visits`) &&
          response.request().method() === "POST",
      );
      await page.reload();
      await visitResponse;
      await workspace(page);
      const afterVisit = await api(address, `/spaces/${publicSpace.id}`);
      assert.equal(
        afterVisit.viewCount,
        beforeVisit.viewCount + 1,
        "一次打开只计一次访问",
      );
      assert.equal(
        afterVisit.updatedAt,
        beforeVisit.updatedAt,
        "访问不改保存时间",
      );
      assert.equal(afterVisit.expiresAt, beforeVisit.expiresAt, "访问不续期");
      await page
        .locator(".actions")
        .getByRole("button", { name: /复制/ })
        .click();
      await page
        .locator(".toast")
        .filter({ hasText: "已复制，格式已保留。" })
        .waitFor();
      const formats = await page.evaluate(async () =>
        (await navigator.clipboard.read()).flatMap((item) => item.types),
      );
      assert.ok(
        formats.includes("text/html") && formats.includes("text/plain"),
        "复制保留富文本及纯文本格式",
      );
      const downloaded = page.waitForEvent("download");
      await page
        .locator(".actions")
        .getByRole("button", { name: /下载/ })
        .click();
      const file = await downloaded;
      assert.ok(file.suggestedFilename().endsWith(".txt"), "当前页TXT下载");
      const downloadPath = await file.path();
      assert.ok(
        (await readFile(downloadPath, "utf8")).includes("中文阅读验收"),
        "下载包含当前合成正文",
      );
    }
    await page.getByRole("button", { name: /保留：/ }).click();
    const select = page.getByRole("combobox", {
      name: "保留时间",
      exact: true,
    });
    await select.waitFor();
    assert.equal(
      await select.locator("option").count(),
      13,
      "永久加十二档期限",
    );
    assert.equal(await select.inputValue(), "0", "永久正确预选");
    await audit(page, `${label}-reference-retention`, { modal: true });
    await closeModal(page);
    await page.getByRole("button", { name: /密码：/ }).click();
    await audit(page, `${label}-reference-password-settings`, { modal: true });
    await closeModal(page);
    await page
      .locator(".qr-box")
      .first()
      .getByRole("button", { name: "复制", exact: true })
      .click();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())) === publicUrl,
      "编辑链接复制",
    );
    await page
      .locator(".qr-box")
      .last()
      .getByRole("button", { name: "复制", exact: true })
      .click();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        `${publicUrl}?readonly`,
      "查看链接复制",
    );
    await assertPlainShare(page, publicUrl);
    await page.goto(`${publicUrl}?readonly`);
    await workspace(page);
    assert.equal(
      await page.locator(".tiptap").getAttribute("contenteditable"),
      "false",
      "公开仅查看页面不可编辑",
    );
    assert.equal(
      await page.getByRole("button", { name: /密码：/ }).count(),
      0,
      "仅查看隐藏编辑设置",
    );
    await assertPlainShare(page, `${publicUrl}?readonly`);
    await audit(page, `${label}-reference-readonly`, { editor: true });
    await page.goto(publicUrl);
    await workspace(page);
    if (label === "desktop") {
      await page.addStyleTag({ content: ":root {font-size:200%;}" });
      await audit(page, "desktop-reference-text-200", {
        editor: true,
        scale: 2,
      });
      await page.addStyleTag({
        content:
          "* {line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important;} p{margin-bottom:2em!important;}",
      });
      await audit(page, "desktop-reference-text-spacing", {
        editor: true,
        scale: 2,
      });
      await page.addStyleTag({
        content: ':root { --font-family-body: "Courier New", monospace; }',
      });
      await audit(page, "desktop-reference-wide-text-200", {
        editor: true,
        scale: 2,
      });
    }
    await context.close();
  }
  stage = "reference-random-entry";
  const randomContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    }),
    randomPage = await randomContext.newPage();
  await randomPage.goto(address);
  await randomPage.getByRole("button", { name: /随机体验一个/ }).click();
  await workspace(randomPage);
  assert.ok(
    /^\/[a-z0-9]{4}$/.test(new URL(randomPage.url()).pathname),
    "随机体验直接进入四位名称",
  );
  await audit(randomPage, "desktop-reference-random-entry", { editor: true });
  await randomContext.close();
  stage = "reference-dark-setup";
  const darkContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
      colorScheme: "dark",
    }),
    darkPage = await darkContext.newPage();
  await darkPage.goto(address);
  await darkPage.locator("#spaceName").waitFor();
  await audit(darkPage, "desktop-reference-dark-home");
  await darkPage.goto(publicUrl);
  await workspace(darkPage);
  await audit(darkPage, "desktop-reference-dark-editor", { editor: true });
  await darkPage
    .getByRole("toolbar", { name: "文字与代码", exact: true })
    .waitFor();
  await audit(darkPage, "desktop-reference-dark-format-tools", {
    editor: true,
  });
  await darkContext.close();
  stage = "reference-tabs-setup";
  const editContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const edit = await editContext.newPage();
  await edit.goto(publicUrl);
  await workspace(edit);
  await edit.getByRole("button", { name: "＋ 新建", exact: true }).click();
  let rename = edit.getByLabel("记事本名称", { exact: true });
  await rename.waitFor();
  await rename.fill("第二本");
  await rename.press("Enter");
  await saved(edit);
  await edit.getByRole("button", { name: "＋ 新建", exact: true }).click();
  rename = edit.getByLabel("记事本名称", { exact: true });
  await rename.waitFor();
  await rename.fill("第三本");
  await rename.press("Enter");
  await saved(edit);
  await edit.getByRole("tab", { name: /第三本/ }).dblclick();
  rename = edit.getByLabel("记事本名称", { exact: true });
  await rename.fill("不应保存");
  await rename.press("Escape");
  assert.equal(
    await edit.getByRole("tab", { name: /第三本/ }).count(),
    1,
    "Escape取消改名",
  );
  await edit.getByRole("tab", { name: /第三本/ }).dblclick();
  rename = edit.getByLabel("记事本名称", { exact: true });
  await rename.fill("");
  await rename.press("Enter");
  await edit.locator(".tiptap").fill("自动命名支持中文以及emoji😀");
  await saved(edit);
  assert.ok(
    (await edit.getByRole("tab", { selected: true }).innerText()).includes(
      "自动命名支持…",
    ),
    "前六Unicode字符自动命名",
  );
  await edit.getByRole("tab", { selected: true }).dblclick();
  rename = edit.getByLabel("记事本名称", { exact: true });
  await rename.fill("第三本");
  await rename.press("Enter");
  await saved(edit);
  await edit
    .getByRole("tab", { name: /第三本/ })
    .dragTo(edit.getByRole("tab", { name: /第二本/ }));
  await edit.waitForFunction(
    () =>
      [...document.querySelectorAll(".tab-title")]
        .map((el) => el.textContent)
        .slice(1)
        .join(",") === "第三本,第二本",
  );
  await audit(edit, "desktop-reference-tabs", { editor: true });
  await edit.reload();
  await workspace(edit);
  assert.ok(
    (await edit.getByRole("tab").allTextContents())
      .slice(1)
      .join(",")
      .includes("第三本,第二本"),
    "排序跨刷新保持",
  );
  await edit.getByRole("button", { name: "删除第二本", exact: true }).click();
  await edit.getByRole("dialog", { name: "删除记事本", exact: true }).waitFor();
  assert.ok(
    await edit
      .locator(".modal")
      .evaluate((el) => el.contains(document.activeElement)),
    "删除弹窗获得焦点",
  );
  await edit.keyboard.press("Shift+Tab");
  assert.ok(
    await edit
      .locator(".modal")
      .evaluate((el) => el.contains(document.activeElement)),
    "删除弹窗Tab保持在内部",
  );
  await audit(edit, "desktop-reference-delete-confirm", { modal: true });
  await edit.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await edit.getByRole("tab").count(), 3, "取消删除保留记事本");
  assert.ok(
    await edit
      .getByRole("button", { name: "删除第二本", exact: true })
      .evaluate((el) => el === document.activeElement),
    "取消恢复删除触发按钮焦点",
  );
  await edit.getByRole("button", { name: "删除第二本", exact: true }).click();
  await edit.keyboard.press("Escape");
  assert.equal(
    await edit.getByRole("dialog", { name: "删除记事本", exact: true }).count(),
    0,
    "Escape取消删除",
  );
  await edit.getByRole("button", { name: "删除第二本", exact: true }).click();
  await edit.locator(".modal-backdrop").click({ position: { x: 2, y: 2 } });
  assert.equal(
    await edit.getByRole("dialog", { name: "删除记事本", exact: true }).count(),
    0,
    "遮罩取消删除",
  );
  await edit.getByRole("button", { name: "删除第二本", exact: true }).click();
  await edit.getByRole("button", { name: "确认删除", exact: true }).click();
  await edit.waitForFunction(
    () => document.querySelectorAll("[role=tab]").length === 2,
  );
  assert.ok(
    await edit
      .getByRole("tab", { selected: true })
      .evaluate((el) => el === document.activeElement),
    "确认删除后焦点回到所选页签",
  );
  while ((await edit.getByRole("tab").count()) < 6) {
    await edit.getByRole("button", { name: "＋ 新建", exact: true }).click();
    await edit.getByLabel("记事本名称", { exact: true }).press("Escape");
  }
  assert.equal(
    await edit.getByRole("button", { name: "＋ 新建", exact: true }).count(),
    0,
    "六页上限隐藏新增",
  );
  await audit(edit, "desktop-reference-six-tabs", { editor: true });
  await editContext.close();
  stage = "reference-new-readonly-setup";
  const newReadName = `new-read-${randomBytes(4).toString("hex")}`;
  const newReadContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    newReadPage = await newReadContext.newPage();
  await newReadPage.goto(`${address}/${newReadName}?readonly`);
  await workspace(newReadPage);
  assert.ok(
    new URL(newReadPage.url()).searchParams.has("readonly"),
    "不存在的仅查看地址自动创建后保留模式",
  );
  assert.equal(
    await newReadPage.locator(".tiptap").getAttribute("contenteditable"),
    "false",
    "新建仅查看页面仍不可编辑",
  );
  assert.equal(
    (await api(address, `/spaces/by-name/${newReadName}`)).accessMode,
    "public",
  );
  assert.equal(
    await newReadPage.locator(".editor-placeholder").count(),
    0,
    "空白仅查看页不显示编辑提示",
  );
  await audit(newReadPage, "mobile-reference-new-readonly", { editor: true });
  await newReadContext.close();
  // API-set whole-space password, then real browser password entry from a fresh client.
  stage = "reference-space-password-setup";
  const password = `synthetic-${randomUUID()}`;
  await api(address, `/spaces/${publicSpace.id}/password`, {
    method: "POST",
    body: { password },
  });
  const passwordContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    passwordPage = await passwordContext.newPage();
  await passwordPage.clock.install();
  await passwordPage.goto(publicUrl);
  await passwordPage.getByLabel("空间密码", { exact: true }).waitFor();
  assert.equal(
    await passwordPage.locator(".tiptap").count(),
    0,
    "未解锁不显示正文",
  );
  await audit(passwordPage, "mobile-reference-password-unlock", {
    modal: true,
  });
  await passwordPage.getByLabel("空间密码", { exact: true }).fill(password);
  await passwordPage
    .getByRole("button", { name: "打开剪贴板", exact: true })
    .click();
  await workspace(passwordPage);
  await audit(passwordPage, "mobile-reference-password-open", { editor: true });
  await passwordPage.route("**/api/spaces/*/lock", (route) =>
    route.abort("failed"),
  );
  await passwordPage.clock.runFor(180001);
  await passwordPage
    .getByRole("dialog", { name: "要继续使用吗？", exact: true })
    .waitFor();
  await audit(passwordPage, "mobile-reference-idle-countdown", { modal: true });
  await passwordPage.clock.runFor(5001);
  await passwordPage.getByLabel("空间密码", { exact: true }).waitFor();
  assert.equal(
    await passwordPage.locator(".tiptap").count(),
    0,
    "闲置锁定隐藏正文",
  );
  await audit(passwordPage, "mobile-reference-idle-locked", { modal: true });
  const stillAuthenticated = await passwordPage.evaluate(
    async (id) => (await fetch(`/api/spaces/${id}`)).status,
    publicSpace.id,
  );
  assert.equal(
    stillAuthenticated,
    200,
    "只模拟lock断网，服务器cookie仍活以复现刷新风险",
  );
  await passwordPage.reload();
  await passwordPage.getByLabel("空间密码", { exact: true }).waitFor();
  assert.equal(
    await passwordPage.locator(".tiptap").count(),
    0,
    "lock断网后刷新不能绕过本机密码门",
  );
  await audit(passwordPage, "mobile-reference-idle-lock-reload", {
    modal: true,
  });
  await passwordContext.close();
  stage = "reference-dirty-lock-recovery";
  const dirtyName = `dirty-lock-${randomBytes(4).toString("hex")}`,
    dirtyId = randomUUID(),
    dirtyPassword = `synthetic-${randomUUID()}`;
  const dirtySpace = await api(address, "/spaces", {
    method: "POST",
    body: {
      accessMode: "public",
      name: dirtyName,
      publicKey: key.toString("base64url"),
      ownerToken: randomBytes(32).toString("base64url"),
      page: { id: dirtyId, payload: payload("服务器原稿") },
    },
    status: 201,
  });
  await api(address, `/spaces/${dirtySpace.id}/password`, {
    method: "POST",
    body: { password: dirtyPassword },
  });
  const dirtyContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    dirtyPage = await dirtyContext.newPage();
  await dirtyPage.clock.install();
  await dirtyPage.goto(`${address}/${dirtyName}`);
  await dirtyPage.getByLabel("空间密码", { exact: true }).fill(dirtyPassword);
  await dirtyPage
    .getByRole("button", { name: "打开剪贴板", exact: true })
    .click();
  await workspace(dirtyPage);
  const storedBefore = await dirtyPage.evaluate(
    async (id) => (await fetch(`/api/spaces/${id}`)).json(),
    dirtySpace.id,
  );
  const dirtyText = "自动锁后待保存的合成正文，必须保留本机修改。";
  await dirtyContext.setOffline(true);
  await dirtyPage.locator(".tiptap").fill(dirtyText);
  await dirtyPage.clock.runFor(650);
  await dirtyPage.locator(".save-state.failed").waitFor();
  await dirtyPage.clock.runFor(180001);
  await dirtyPage
    .getByRole("dialog", { name: "要继续使用吗？", exact: true })
    .waitFor();
  await dirtyPage.clock.runFor(5001);
  await dirtyPage.getByLabel("空间密码", { exact: true }).waitFor();
  await dirtyContext.setOffline(false);
  let resumedWrites = 0;
  dirtyPage.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname ===
        `/api/spaces/${dirtySpace.id}/pages/${dirtyId}`
    )
      resumedWrites++;
  });
  await dirtyPage.getByLabel("空间密码", { exact: true }).fill(dirtyPassword);
  await dirtyPage
    .getByRole("button", { name: "打开剪贴板", exact: true })
    .click();
  await workspace(dirtyPage);
  await dirtyPage
    .locator(".save-state")
    .filter({ hasText: /^有修改尚未保存$/ })
    .waitFor();
  assert.ok(
    (await dirtyPage.locator(".tiptap").innerText()).includes(dirtyText),
    "不刷新解锁保留本机未保存内容",
  );
  assert.equal(resumedWrites, 0, "解锁不得偷偷自动补交");
  const storedAfterUnlock = await dirtyPage.evaluate(
    async (id) => (await fetch(`/api/spaces/${id}`)).json(),
    dirtySpace.id,
  );
  assert.equal(
    storedAfterUnlock.pages[0].revision,
    storedBefore.pages[0].revision,
    "解锁不改变服务器版本",
  );
  assert.ok(
    JSON.stringify(storedAfterUnlock.pages[0].payload) ===
      JSON.stringify(storedBefore.pages[0].payload),
    "服务端仍为原稿",
  );
  await audit(dirtyPage, "mobile-reference-dirty-after-unlock", {
    editor: true,
  });
  await dirtyPage.locator(".format-shortcuts summary").click();
  await dirtyPage
    .getByRole("button", { name: "立即保存", exact: true })
    .click();
  await saved(dirtyPage);
  assert.equal(
    await dirtyPage.locator(".format-shortcuts").getAttribute("open"),
    null,
    "执行更多操作后收起菜单，不遮挡编辑工具",
  );
  const storedAfterSave = await dirtyPage.evaluate(
    async (id) => (await fetch(`/api/spaces/${id}`)).json(),
    dirtySpace.id,
  );
  const encryptedBytes = Buffer.from(
      storedAfterSave.pages[0].payload.ciphertext,
      "base64url",
    ),
    decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(storedAfterSave.pages[0].payload.iv, "base64url"),
    );
  decipher.setAuthTag(encryptedBytes.subarray(-16));
  const persistedDocument = JSON.parse(
    Buffer.concat([
      decipher.update(encryptedBytes.subarray(0, -16)),
      decipher.final(),
    ]).toString(),
  );
  assert.ok(
    persistedDocument.text.includes(dirtyText),
    "手动保存后服务器确实含本机修改",
  );
  assert.equal(
    storedAfterSave.pages[0].revision,
    storedBefore.pages[0].revision + 1,
    "仅手动保存增加一次版本",
  );
  assert.equal(resumedWrites, 1, "只发一次显式保存");
  await audit(dirtyPage, "mobile-reference-dirty-after-save", { editor: true });
  await dirtyContext.close();
  // Legacy private links keep real server-side owner/reader boundaries.
  for (const [label, width] of [
    ["desktop", 1280],
    ["mobile", 390],
  ]) {
    const context = await browser.newContext({
        locale: "zh-CN",
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        permissions: ["clipboard-read", "clipboard-write"],
      }),
      page = await context.newPage();
    await page.goto(oldReaderUrl);
    await workspace(page);
    assert.equal(
      await page.locator(".tiptap").getAttribute("contenteditable"),
      "false",
    );
    assert.equal(
      await page.getByLabel("可编辑链接", { exact: true }).count(),
      0,
      "旧private读者不显示编辑能力",
    );
    await audit(page, `${label}-reference-private-readonly`, { editor: true });
    await assertPlainShare(page, oldReaderUrl);
    await page.locator(".toast").filter({ hasText: "链接已复制" }).waitFor();
    assert.ok(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        oldReaderUrl,
      "旧private reader仅分享当前只读链接",
    );
    await page.goto(ownerUrl);
    await workspace(page);
    await page.evaluate(() => {
      window.__nativeOwnerShareUsed = false;
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async () => {
          window.__nativeOwnerShareUsed = true;
        },
      });
    });
    await page
      .locator(".actions")
      .getByRole("button", { name: /分享/ })
      .click();
    assert.equal(
      await page.evaluate(() => window.__nativeOwnerShareUsed),
      false,
      "旧private owner也直接复制，不交给系统拼接文字",
    );
    await page.locator(".toast").filter({ hasText: "链接已复制" }).waitFor();
    const safeShared = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    assert.ok(
      /^#r=[A-Za-z0-9_-]{22}$/.test(new URL(safeShared).hash),
      "旧private owner顶部只分享稳定reader短能力",
    );
    assert.ok(
      !/[#&](?:o|m|k|w)=/.test(new URL(safeShared).hash),
      "顶部分享不泄露owner或原始key",
    );
    await context.setOffline(true);
    await page.locator(".tiptap").fill(`${label}离线合成草稿`);
    await page.locator(".save-state.failed").waitFor();
    await audit(page, `${label}-reference-offline`, { editor: true });
    await context.setOffline(false);
    await page.locator(".format-shortcuts summary").click();
    await page.getByRole("button", { name: "立即保存", exact: true }).click();
    await saved(page);
    await page.route("**/api/spaces/*/pages/*", async (route) => {
      if (route.request().method() === "PUT")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "REVISION_CONFLICT", message: "远端版本已更新" },
          }),
        });
      else await route.continue();
    });
    await page.locator(".tiptap").fill("合成冲突草稿，需要保留两份");
    await page.locator(".conflict-banner").waitFor();
    await audit(page, `${label}-reference-conflict`, { editor: true });
    await context.close();
  }
  stage = "reference-old-password-setup";
  const legacyPassword = `synthetic-${randomUUID()}`,
    salt = randomBytes(16),
    iv = randomBytes(12),
    cipher = createCipheriv(
      "aes-256-gcm",
      pbkdf2Sync(legacyPassword, salt, 600_000, 32, "sha256"),
      iv,
    ),
    wrapped = Buffer.concat([
      cipher.update(key),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
  const legacyContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    legacyPage = await legacyContext.newPage();
  const params = new URLSearchParams({
    r: legacyShare.token,
    w: wrapped.toString("base64url"),
    s: salt.toString("base64url"),
    i: iv.toString("base64url"),
  });
  await legacyPage.goto(`${address}/s/${privateSpace.id}#${params}`);
  await legacyPage.getByLabel("解锁密码", { exact: true }).waitFor();
  await legacyPage.getByLabel("解锁密码", { exact: true }).fill(legacyPassword);
  await legacyPage
    .getByRole("button", { name: "打开内容", exact: true })
    .click();
  await workspace(legacyPage);
  await audit(legacyPage, "mobile-reference-legacy-password", { editor: true });
  await legacyContext.close();
  stage = "reference-compact-compatibility";
  const derive = (seed, info) =>
    Buffer.from(
      hkdfSync(
        "sha256",
        seed,
        Buffer.from("2Space compact v2"),
        Buffer.from(info),
        32,
      ),
    );
  const compactSeed = randomBytes(32),
    compactKey = derive(compactSeed, "owner/document"),
    compactToken = derive(compactSeed, "owner/auth").toString("base64url");
  const compactName = `old-seed-${randomBytes(4).toString("hex")}`;
  const compactSpace = await api(address, "/spaces", {
    method: "POST",
    body: {
      name: compactName,
      ownerToken: compactToken,
      page: { id: randomUUID(), payload: payload("旧短链接兼容", compactKey) },
    },
    status: 201,
  });
  const compactReaderSeed = randomBytes(16),
    compactReaderToken = derive(compactReaderSeed, "reader/auth").toString(
      "base64url",
    );
  function wrapBytes(bytes, rawKey) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", rawKey, iv);
    return {
      iv: iv.toString("base64url"),
      ciphertext: Buffer.concat([
        cipher.update(bytes),
        cipher.final(),
        cipher.getAuthTag(),
      ]).toString("base64url"),
    };
  }
  await api(address, `/spaces/${compactSpace.id}/shares`, {
    method: "POST",
    token: compactToken,
    body: {
      token: compactReaderToken,
      keyEnvelope: wrapBytes(
        compactKey,
        derive(compactReaderSeed, "reader/wrap"),
      ),
      ownerEnvelope: wrapBytes(
        Buffer.from(
          JSON.stringify({
            version: 2,
            seed: compactReaderSeed.toString("base64url"),
          }),
        ),
        compactKey,
      ),
    },
    status: 201,
  });
  const compactContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    compactPage = await compactContext.newPage();
  await compactPage.goto(
    `${address}/${compactName}#o=${compactSeed.toString("base64url")}`,
  );
  await workspace(compactPage);
  assert.equal(
    await compactPage.locator(".tiptap").getAttribute("contenteditable"),
    "true",
    "旧compact owner仍可编辑",
  );
  await audit(compactPage, "mobile-reference-old-compact-owner", {
    editor: true,
  });
  await compactPage.goto(
    `${address}/${compactName}#r=${compactReaderSeed.toString("base64url")}`,
  );
  await workspace(compactPage);
  assert.equal(
    await compactPage.locator(".tiptap").getAttribute("contenteditable"),
    "false",
    "旧compact reader真实只读",
  );
  assert.equal(
    await compactPage.getByLabel("可编辑链接", { exact: true }).count(),
    0,
    "旧compact reader不暴露编辑链接",
  );
  await audit(compactPage, "mobile-reference-old-compact-reader", {
    editor: true,
  });
  await compactContext.close();
  stage = "reference-private-unavailable";
  const unavailableContext = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    unavailablePage = await unavailableContext.newPage();
  await unavailablePage.goto(
    `${address}/s/${randomUUID()}#k=${key.toString("base64url")}&m=${ownerToken}`,
  );
  await unavailablePage.locator(".page-error,.error-banner").waitFor();
  await audit(unavailablePage, "mobile-reference-private-unavailable");
  await unavailableContext.close();
  // Programmer-friendly editor: real keyboard, per-block clipboard, paste, and old-data display.
  const firstCode = "const answer = 42;\n  console.log(answer);\n";
  const secondCode = `print("${"second".repeat(40)}")\n`;
  const escapeHtml = (value) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const [label, width] of [
    ["desktop", 1280],
    ["mobile", 390],
    ["narrow", 320],
  ]) {
    stage = `${label}-programmer-setup`;
    const codeName = `code-${randomBytes(4).toString("hex")}`,
      codeId = randomUUID();
    const codeDocument = {
      title: "逐块代码验收",
      html: `<p>代码之前的说明。</p><pre><code class="language-javascript">${escapeHtml(firstCode)}</code></pre><pre><code class="language-python">${escapeHtml(secondCode)}</code></pre>`,
      text: `代码之前的说明。\n${firstCode}\n${secondCode}`,
      language: "javascript",
    };
    const codeSpace = await api(address, "/spaces", {
      method: "POST",
      body: {
        accessMode: "public",
        name: codeName,
        publicKey: key.toString("base64url"),
        ownerToken: randomBytes(32).toString("base64url"),
        page: { id: codeId, payload: envelopeForDocument(codeDocument) },
      },
      status: 201,
    });
    const context = await browser.newContext({
        locale: "zh-CN",
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        permissions: ["clipboard-read", "clipboard-write"],
      }),
      page = await context.newPage();
    let codeLoadWrites = 0,
      checkingLoad = true;
    page.on("request", (request) => {
      if (
        checkingLoad &&
        request.method() === "PUT" &&
        new URL(request.url()).pathname ===
          `/api/spaces/${codeSpace.id}/pages/${codeId}`
      )
        codeLoadWrites++;
    });
    programmerPage = page;
    await page.clock.install();
    stage = `${label}-programmer-load-no-write`;
    await page.goto(`${address}/${codeName}`);
    await workspace(page);
    await page.clock.runFor(1500);
    assert.equal(codeLoadWrites, 0, "以代码结束的文档挂载/元数据刷新0次PUT");
    const codeAfterLoad = await api(address, `/spaces/${codeSpace.id}`);
    assert.equal(
      codeAfterLoad.pages[0].revision,
      codeSpace.pages[0].revision,
      "只查看代码不改服务器版本",
    );
    assert.ok(
      JSON.stringify(codeAfterLoad.pages[0].payload) ===
        JSON.stringify(codeSpace.pages[0].payload),
      "代码NodeView不自动补段落或保存",
    );
    checkingLoad = false;
    const blocks = page.locator(".code-block-view"),
      first = blocks.nth(0),
      second = blocks.nth(1);
    assert.equal(await blocks.count(), 2, "两段独立代码块");
    await page
      .getByRole("toolbar", { name: "文字与代码", exact: true })
      .waitFor();
    assert.ok(
      await page
        .getByRole("button", { name: "代码块", exact: true })
        .isVisible(),
      "代码入口无需先开菜单",
    );
    assert.equal(
      await page.getByRole("button", { name: /表格/ }).count(),
      0,
      "无表格工具",
    );
    assert.equal(
      await first
        .getByRole("combobox", { name: "代码语言", exact: true })
        .inputValue(),
      "javascript",
    );
    assert.equal(
      await second
        .getByRole("combobox", { name: "代码语言", exact: true })
        .inputValue(),
      "python",
    );
    assert.ok(
      (await first.locator(".hljs-keyword").count()) > 0,
      "第一块语法高亮",
    );
    stage = `${label}-programmer-language-plaintext`;
    await first
      .getByRole("combobox", { name: "代码语言", exact: true })
      .selectOption("plaintext");
    await page.waitForFunction(() => {
      const block = document.querySelector(".code-block-view");
      return (
        block?.getAttribute("data-language") === "plaintext" &&
        block.querySelectorAll('[class*="hljs-"]').length === 0
      );
    });
    assert.equal(
      await first.locator('[class*="hljs-"]').count(),
      0,
      "选择纯文本不自动猜高亮",
    );
    stage = `${label}-programmer-language-javascript`;
    await first
      .getByRole("combobox", { name: "代码语言", exact: true })
      .selectOption("javascript");
    await first.locator(".hljs-keyword").first().waitFor();
    assert.ok(
      (await first.locator(".hljs-keyword").count()) > 0,
      "切回JS恢复语法高亮",
    );
    assert.deepEqual(
      await first.locator(".code-line-numbers > span").allTextContents(),
      ["1", "2", "3"],
      "行号含末尾空行",
    );
    assert.ok(
      await second
        .locator("pre.code-block-scroll")
        .evaluate((el) => el.scrollWidth > el.clientWidth),
      "长代码仅块内横向滚动",
    );
    await first
      .getByRole("combobox", { name: "代码语言", exact: true })
      .selectOption("typescript");
    assert.equal(
      await second
        .getByRole("combobox", { name: "代码语言", exact: true })
        .inputValue(),
      "python",
      "语言只作用当前块",
    );
    for (const [block, expected] of [
      [first, firstCode],
      [second, secondCode],
    ]) {
      stage = `${label}-programmer-copy-${expected === firstCode ? "first" : "second"}`;
      await block
        .getByRole("button", { name: "复制代码", exact: true })
        .click();
      await page.waitForFunction(
        async (expected) => (await navigator.clipboard.readText()) === expected,
        expected,
      );
      assert.ok(
        (await page.evaluate(() => navigator.clipboard.readText())) ===
          expected,
        "复制原始代码，不包含行号/语言/按钮",
      );
    }
    stage = `${label}-programmer-select-first-code`;
    const firstContent = first.locator("code[data-node-view-content]");
    await firstContent.evaluate((element) => {
      const editor = document.querySelector(".tiptap").editor;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.textContent.length) node = walker.nextNode();
      // Tiptap exposes dom.editor for tests. Prepare only the selection; the
      // indent/outdent behavior below is exercised by real keyboard events.
      editor.commands.setTextSelection(editor.view.posAtDOM(node, 0));
      editor.view.focus();
    });
    // Confirm model and DOM agree before exercising a selection-based command.
    await page.waitForFunction(() => {
      const element = document.querySelector(".tiptap");
      const editor = element?.editor;
      const selection = editor?.state.selection;
      const code = document.querySelector(
        ".code-block-view code[data-node-view-content]",
      );
      if (!editor || !code) return false;
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let target = walker.nextNode();
      while (target && !target.textContent.length) target = walker.nextNode();
      return (
        target &&
        document.activeElement === element &&
        editor.view.hasFocus() &&
        selection.empty &&
        selection.from === editor.view.posAtDOM(target, 0) &&
        selection.$from.parent.type.name === "codeBlock" &&
        selection.$from.parentOffset === 0 &&
        getSelection()?.anchorNode === target &&
        getSelection()?.anchorOffset === 0
      );
    });
    stage = `${label}-programmer-tab-indent`;
    await page.keyboard.press("Tab");
    await page.waitForFunction(() =>
      document
        .querySelector(".code-block-view code[data-node-view-content]")
        .textContent.startsWith("  const"),
    );
    assert.ok(
      (await firstContent.textContent()) === `  ${firstCode}`,
      "Tab插入两个空格",
    );
    stage = `${label}-programmer-tab-outdent`;
    await page.keyboard.press("Shift+Tab");
    await page.waitForFunction(
      (expected) =>
        document.querySelector(".code-block-view code[data-node-view-content]")
          .textContent === expected,
      firstCode,
    );
    assert.ok(
      (await firstContent.textContent()) === firstCode,
      "ShiftTab恢复原代码",
    );
    stage = `${label}-programmer-escape-focus`;
    await page.keyboard.press("Escape");
    assert.ok(
      await first
        .getByRole("button", { name: "复制代码", exact: true })
        .evaluate((el) => el === document.activeElement),
      "Esc移出代码编辑到块操作",
    );
    stage = `${label}-programmer-exit-paragraph`;
    await first
      .getByRole("button", { name: "退出代码块", exact: true })
      .click();
    // Mock-clock load checks must also advance Tiptap's deferred focus frame.
    await page.clock.runFor(32);
    await page.waitForFunction(() => {
      const node = getSelection()?.anchorNode,
        element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      return (
        document.activeElement?.matches(".tiptap") &&
        element instanceof Element &&
        !!element.closest("p") &&
        !!element.closest(".tiptap")
      );
    });
    await page.keyboard.type("代码之外的说明");
    assert.ok(
      (await page.locator(".tiptap p").allTextContents()).some((value) =>
        value.includes("代码之外的说明"),
      ),
      "退出后可写普通文字",
    );
    assert.ok(
      !(await firstContent.textContent()).includes("代码之外的说明"),
      "退出文字不污染代码",
    );
    stage = `${label}-programmer-save`;
    await saved(page);
    await audit(page, `${label}-programmer-code`, { editor: true });
    const persisted = await api(address, `/spaces/${codeSpace.id}`);
    const bytes = Buffer.from(
        persisted.pages[0].payload.ciphertext,
        "base64url",
      ),
      decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(persisted.pages[0].payload.iv, "base64url"),
      );
    decipher.setAuthTag(bytes.subarray(-16));
    const persistedDoc = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(0, -16)),
        decipher.final(),
      ]).toString(),
    );
    assert.ok(
      !/code-line-numbers|code-block-header|复制代码|退出代码块/.test(
        persistedDoc.html,
      ),
      "渲染控件不进入持久化HTML",
    );
    let readOnlyWrites = 0;
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        new URL(request.url()).pathname ===
          `/api/spaces/${codeSpace.id}/pages/${codeId}`
      )
        readOnlyWrites++;
    });
    await page.goto(`${address}/${codeName}?readonly`);
    await workspace(page);
    assert.equal(
      await page
        .getByRole("toolbar", { name: "文字与代码", exact: true })
        .count(),
      0,
      "仅查看没有写工具",
    );
    const readerFirst = page.locator(".code-block-view").first(),
      readerContent = readerFirst.locator("code[data-node-view-content]");
    assert.ok(
      await readerFirst
        .getByRole("combobox", { name: "代码语言", exact: true })
        .isDisabled(),
      "仅查看语言不可改",
    );
    assert.equal(
      await readerFirst
        .getByRole("button", { name: "退出代码块", exact: true })
        .count(),
      0,
      "仅查看无退出写入动作",
    );
    await readerFirst.locator("pre.code-block-scroll").focus();
    await page.keyboard.type("只读不能插入");
    await page.keyboard.press("Tab");
    assert.ok(
      (await readerContent.textContent()) === firstCode,
      "只读键盘不改代码",
    );
    assert.ok(
      !(await readerFirst
        .locator("pre.code-block-scroll")
        .evaluate((el) => el === document.activeElement)),
      "只读Tab继续正常导航",
    );
    stage = `${label}-programmer-readonly-copy`;
    await readerFirst
      .getByRole("button", { name: "复制代码", exact: true })
      .click();
    await page.waitForFunction(
      async (expected) => (await navigator.clipboard.readText()) === expected,
      firstCode,
    );
    assert.equal(readOnlyWrites, 0, "只读代码交互0次PUT");
    assert.equal(
      (await api(address, `/spaces/${codeSpace.id}`)).pages[0].revision,
      persisted.pages[0].revision,
      "只读不改变服务器版本",
    );
    await audit(page, `${label}-programmer-readonly`, { editor: true });
    await context.close();
    programmerPage = undefined;
  }
  const tableTokens = ["姓名", "角色", "小一", "研发", "小二", "测试"];
  const tableHtml =
    "<table><thead><tr><th>姓名</th><th>角色</th></tr></thead><tbody><tr><td>小一</td><td>研发</td></tr><tr><td>小二</td><td>测试</td></tr></tbody></table>";
  const tablePlain = "姓名\t角色\n小一\t研发\n小二\t测试";
  for (const [label, width] of [
    ["desktop", 1280],
    ["mobile", 390],
  ]) {
    stage = `${label}-programmer-paste-setup`;
    const name = `paste-${randomBytes(4).toString("hex")}`,
      id = randomUUID();
    const space = await api(address, "/spaces", {
      method: "POST",
      body: {
        accessMode: "public",
        name,
        publicKey: key.toString("base64url"),
        ownerToken: randomBytes(32).toString("base64url"),
        page: {
          id,
          payload: envelopeForDocument({
            title: "富文本粘贴验收",
            html: "<p></p>",
            text: "",
            language: "plaintext",
          }),
        },
      },
      status: 201,
    });
    const context = await browser.newContext({
        locale: "zh-CN",
        viewport: { width, height: 900 },
        reducedMotion: "reduce",
        permissions: ["clipboard-read", "clipboard-write"],
      }),
      page = await context.newPage();
    await page.goto(`${address}/${name}`);
    await workspace(page);
    const rich =
      '<h2>合成标题</h2><p><strong>加粗</strong> <em>斜体</em> <u>下划线</u> <s>删除线</s> <code>inline()</code> <a href="https://example.com">链接</a></p><ul><li>项目一</li><li>项目二</li></ul><blockquote><p>引用文字</p></blockquote>';
    await pasteRich(
      page,
      rich,
      "合成标题 加粗 斜体 下划线 删除线 inline() 链接 项目一 项目二 引用文字",
    );
    await page.locator(".tiptap h2").waitFor();
    await saved(page);
    for (const selector of [
      "h2",
      "strong",
      "em",
      "u",
      "s",
      "code",
      "a",
      "ul li",
      "blockquote",
    ])
      assert.ok(
        (await page.locator(`.tiptap ${selector}`).count()) > 0,
        `粘贴保留${selector}语义`,
      );
    assert.equal(
      await page.locator(".tiptap a").getAttribute("href"),
      new URL("https://example.com").href,
      "链接规范化后原地址保留",
    );
    await audit(page, `${label}-programmer-rich-paste`, { editor: true });
    await page.locator(".tiptap").fill("");
    await pasteRich(page, tableHtml, tablePlain);
    await page.waitForFunction(() =>
      document.querySelector(".tiptap").textContent.includes("小二"),
    );
    await saved(page);
    assert.equal(
      await page.locator(".tiptap table").count(),
      0,
      "表格粘贴不生成table",
    );
    assert.ok(
      textOrder(await page.locator(".tiptap").innerText(), tableTokens),
      "所有单元格文字按行序完整保留",
    );
    const stored = await api(address, `/spaces/${space.id}`),
      bytes = Buffer.from(stored.pages[0].payload.ciphertext, "base64url"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(stored.pages[0].payload.iv, "base64url"),
      );
    decipher.setAuthTag(bytes.subarray(-16));
    const doc = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(0, -16)),
        decipher.final(),
      ]).toString(),
    );
    assert.ok(
      !/<table(?:\s|>)/i.test(doc.html) && textOrder(doc.text, tableTokens),
      "保存后仍为完整普通文字而非table",
    );
    await audit(page, `${label}-programmer-table-paste`, { editor: true });
    await context.close();
  }
  stage = "programmer-legacy-table-setup";
  const legacyTableId = randomUUID(),
    legacyTableToken = randomBytes(32).toString("base64url");
  const legacyTable = await api(address, "/spaces", {
    method: "POST",
    body: {
      ownerToken: legacyTableToken,
      page: {
        id: legacyTableId,
        payload: envelopeForDocument({
          title: "旧表格资料",
          html: `<p>旧资料前言</p>${tableHtml}<p>旧资料结尾</p>`,
          text: `旧资料前言\n${tablePlain}\n旧资料结尾`,
          language: "plaintext",
        }),
      },
    },
    status: 201,
  });
  const legacyContext2 = await browser.newContext({
      locale: "zh-CN",
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    legacyTablePage = await legacyContext2.newPage();
  let loadWrites = 0;
  legacyTablePage.on("request", (request) => {
    if (
      request.method() === "PUT" &&
      new URL(request.url()).pathname ===
        `/api/spaces/${legacyTable.id}/pages/${legacyTableId}`
    )
      loadWrites++;
  });
  await legacyTablePage.clock.install();
  await legacyTablePage.goto(
    `${address}/s/${legacyTable.id}#k=${key.toString("base64url")}&m=${legacyTableToken}`,
  );
  await workspace(legacyTablePage);
  await legacyTablePage.clock.runFor(1500);
  assert.equal(
    await legacyTablePage.locator(".tiptap table").count(),
    0,
    "旧表格显示为文字",
  );
  assert.ok(
    textOrder(await legacyTablePage.locator(".tiptap").innerText(), [
      "旧资料前言",
      ...tableTokens,
      "旧资料结尾",
    ]),
    "旧表格载入不丢任何文字",
  );
  assert.equal(loadWrites, 0, "仅载入旧表格0次PUT");
  const legacyStored = await api(address, `/spaces/${legacyTable.id}`, {
    token: legacyTableToken,
  });
  assert.equal(
    legacyStored.pages[0].revision,
    legacyTable.pages[0].revision,
    "旧表格服务器版本保持",
  );
  assert.ok(
    JSON.stringify(legacyStored.pages[0].payload) ===
      JSON.stringify(legacyTable.pages[0].payload),
    "旧表格原密文不被自动改写",
  );
  await audit(legacyTablePage, "mobile-programmer-legacy-table", {
    editor: true,
  });
  await legacyContext2.close();
  await report("passed");
  console.log(
    `PASS: ${records.length}组参考对照阅读/功能/axe检查；截图已遮罩链接、二维码、密码和网络地址。`,
  );
} catch (error) {
  if (programmerPage && !programmerPage.isClosed()) {
    failureDiagnostics = await programmerPage
      .evaluate(() => {
        const blocks = [...document.querySelectorAll(".code-block-view")];
        const editor = document.querySelector(".tiptap")?.editor;
        const pmSelection = editor?.state.selection;
        const pmNode = pmSelection
          ? editor.view.domAtPos(pmSelection.from).node
          : undefined;
        const anchor = getSelection()?.anchorNode;
        const selected =
          anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor;
        return {
          documentFocused: document.hasFocus(),
          editorFocused: editor?.view.hasFocus(),
          editorSelectionEmpty: pmSelection?.empty,
          editorSelectionNode: pmSelection?.$from.parent.type.name,
          editorSelectionOffset: pmSelection?.$from.parentOffset,
          editorSelectedBlock: blocks.findIndex(
            (block) => pmNode && block.contains(pmNode),
          ),
          activeTag: document.activeElement?.tagName,
          activeEditor: !!document.activeElement?.matches(".tiptap"),
          selectedBlock: blocks.findIndex(
            (block) => selected && block.contains(selected),
          ),
          selectedParagraph: !!(
            selected instanceof Element && selected.closest(".tiptap p")
          ),
          blocks: blocks.map((block) => ({
            language: block.getAttribute("data-language"),
            highlighted: block.querySelectorAll('[class*="hljs-"]').length > 0,
            textLength: block.querySelector("code[data-node-view-content]")
              ?.textContent.length,
            startsIndented: block
              .querySelector("code[data-node-view-content]")
              ?.textContent.startsWith("  const"),
          })),
        };
      })
      .catch(() => ({ unavailable: true }));
    await programmerPage
      .screenshot({
        path: join(out, `${stage}-failure.png`),
        fullPage: true,
        animations: "disabled",
        mask: [
          programmerPage.locator(
            'input[aria-label="仅查看链接"],input[aria-label="可编辑链接"],input[type="password"],.viewer-ip,[data-sensitive],.qr',
          ),
        ],
      })
      .catch(() => {});
  }
  await report("failed");
  console.error(
    `FAIL: ${stage}，详见本地脱敏report.json。${
      error instanceof assert.AssertionError
        ? " " + error.message
        : " " +
          String(error?.message || "执行异常")
            .split("\n")[0]
            .replace(/https?:\/\/\S+/g, "[URL omitted]")
    }`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
