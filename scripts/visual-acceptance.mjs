import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  randomBytes,
  randomUUID,
  createCipheriv,
  pbkdf2Sync,
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
async function report(status) {
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      { baseline: "web-reading-v1", startedAt, status, stage, records },
      null,
      2,
    ),
  );
}
const ownerToken = randomBytes(32).toString("base64url");
const key = randomBytes(32);
const pageId = randomUUID();
const text = "中文阅读验收：正文清楚，重要提示可见，换台设备接着使用。";
function payload(suffix = "") {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
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
      page.locator('textarea[aria-label="只读分享链接"]'),
      page.locator(".qr"),
      page.locator("[data-acceptance-private]"),
    ],
  });
  const result = await page.evaluate(
    ({ editor, modal, scale }) => {
      const failures = [];
      const scope = modal ? document.querySelector(".modal") : document.body;
      const visible = (el) => {
        const r = el.getBoundingClientRect(),
          s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          s.display !== "none"
        );
      };
      const items = [];
      const rgba = (value) => {
        const numbers = value.match(/[\d.]+/g)?.map(Number);
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
        for (let node = el; node; node = node.parentElement) {
          const color = rgba(getComputedStyle(node).backgroundColor);
          if (!color) return null;
          layers.unshift(color);
        }
        return layers.reduce((bg, fg) => blend(fg, bg), [255, 255, 255, 1]);
      };
      for (const el of scope.querySelectorAll("*")) {
        if (!visible(el) || el.matches("script,style,option")) continue;
        const hasText =
          [...el.childNodes].some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
          ) || el.matches("input,textarea,select");
        if (!hasText) continue;
        const s = getComputedStyle(el),
          size = parseFloat(s.fontSize);
        const cls = el.className?.toString() || el.tagName;
        const isMeta = el.matches(
          ".sidebar-heading > span,.page-number,.character-count,.site-footer .version",
        );
        const isBody = el.closest(
          ".welcome-copy > p,.preview-paper p,.preview-paper li,.preview-paper pre,.tiptap p,.tiptap pre,.modal p:not(.muted),.modal li,.conflict-banner p",
        );
        const min = (isBody ? 16 : isMeta ? 12 : 14) * scale;
        if (size + 0.1 < min) failures.push(`${cls}: ${size}px < ${min}px`);
        let contrast = null;
        if (!el.closest(":disabled")) {
          for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
            const painted = getComputedStyle(ancestor);
            if (
              Number(painted.opacity) !== 1 ||
              painted.backgroundImage !== "none"
            ) {
              failures.push(`${cls}: 半透明或图片背景需要显式对比度审查`);
              break;
            }
          }
          const fg = rgba(s.color),
            bg = background(el);
          if (!fg || !bg) failures.push(`${cls}: 颜色需要人工解析`);
          else {
            const a = luminance(blend(fg, bg)),
              b = luminance(bg);
            contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
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
          !el.matches("h1,h2,h3,.brand *,.notice button,.modal-close")
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
      for (const pre of scope.querySelectorAll(".tiptap pre")) {
        if (getComputedStyle(pre).whiteSpace !== "pre")
          failures.push("编辑器代码格式被换行样式覆盖");
      }
      if (editor && !modal) {
        const e = document.querySelector(".tiptap");
        if (!e || parseFloat(getComputedStyle(e).fontSize) < 16 * scale)
          failures.push("编辑正文不足16px");
        if (innerWidth > 900 && innerHeight >= 650) {
          const footer = document
            .querySelector(".document-footer")
            .getBoundingClientRect();
          const viewport = document
            .querySelector(".editor-shell > div:last-child")
            .getBoundingClientRect();
          if (document.documentElement.scrollHeight > innerHeight + 1)
            failures.push("桌面工作台撑出可视高度");
          if (footer.bottom > innerHeight + 1)
            failures.push("保存状态超出可视范围");
          if (viewport.bottom > footer.top + 1 || viewport.height < 80)
            failures.push("编辑区没有正确约束可视高度");
        }
      }
      return { failures, items };
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
try {
  await mkdir(out, { recursive: true });
  await report("running");
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const created = await fetch(`${address}/api/spaces`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerToken,
      retentionSeconds: 1800,
      page: { id: pageId, payload: payload() },
    }),
  });
  assert.equal(created.status, 201);
  const space = await created.json();
  const ownerUrl = `${address}/s/${space.id}#k=${key.toString("base64url")}&m=${ownerToken}`;
  browser = await chromium.launch();
  for (const [width, height] of [
    [1355, 1344],
    [1280, 900],
    [1024, 768],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(address);
    const defaultName = await page
      .getByLabel("空间名称", { exact: true })
      .inputValue();
    assert.match(defaultName, /^[a-z0-9]{8}$/, "默认随机名称为8位");
    await page
      .getByRole("button", { name: "创建我的空间", exact: true })
      .click();
    await page.locator('.tiptap[contenteditable="true"]').waitFor();
    await page.locator(".notice").waitFor();
    await audit(page, `created-empty-${width}`, { editor: true });
    await page
      .locator(".tiptap")
      .fill("长文测试：内容在编辑区内部滚动，保存状态始终可见。\n".repeat(100));
    await page
      .locator(".save-state")
      .filter({ hasText: "已加密保存" })
      .waitFor();
    const scroller = page.locator(".editor-shell > div:last-child");
    await scroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    assert.ok(
      await scroller.evaluate((el) => el.scrollTop > 0),
      "长文在编辑区内部滚动",
    );
    await audit(page, `created-long-${width}`, { editor: true });
    await context.close();
  }
  for (const [label, width, height] of [
    ["desktop", 1280, 900],
    ["mobile", 390, 844],
    ["narrow", 320, 900],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(address);
    await page.getByRole("button", { name: "创建我的空间" }).waitFor();
    await audit(page, `${label}-welcome`);
    await page.goto(ownerUrl);
    await page.locator('.tiptap[contenteditable="true"]').waitFor();
    await audit(page, `${label}-workspace`, { editor: true });
    await page.getByRole("button", { name: "隐私与安全", exact: true }).click();
    assert.ok(
      await page
        .locator(".modal")
        .evaluate((el) => el.contains(document.activeElement)),
      "打开弹窗获得焦点",
    );
    await page.keyboard.press("Shift+Tab");
    assert.ok(
      await page
        .locator(".modal")
        .evaluate((el) => el.contains(document.activeElement)),
      "弹窗反向Tab保持在弹窗内",
    );
    await audit(page, `${label}-privacy`, { modal: true });
    await page.getByRole("button", { name: "关闭窗口" }).click();
    assert.ok(
      await page
        .getByRole("button", { name: "隐私与安全", exact: true })
        .evaluate((el) => el === document.activeElement),
      "关闭弹窗恢复触发按钮焦点",
    );
    await page.evaluate(() => {
      navigator.clipboard.writeText = async () => {
        throw new DOMException("synthetic-denied", "NotAllowedError");
      };
    });
    await page.getByRole("button", { name: "分享空间", exact: true }).click();
    await page.getByLabel("只读分享链接", { exact: true }).waitFor();
    await page.locator(".qr").waitFor();
    assert.match(
      await page.locator(".share-status").innerText(),
      /未允许|手动/,
      "复制拒绝时给出手动下一步",
    );
    await audit(page, `${label}-share`, { modal: true });
    await page.getByRole("button", { name: "关闭窗口" }).click();
    await page.getByRole("button", { name: "打开空间", exact: true }).click();
    await audit(page, `${label}-open`, { modal: true });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".modal").count(), 0, "Escape关闭普通弹窗");
    if (label === "desktop") {
      // Text-only enlargement; 320px separately covers 1280/400% reflow.
      await page.addStyleTag({ content: ":root { font-size: 200%; }" });
      await audit(page, "desktop-text-200", { editor: true, scale: 2 });
      await page.addStyleTag({
        content:
          "* { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
      });
      await audit(page, "desktop-text-spacing", { editor: true, scale: 2 });
    }
    await context.close();
  }
  // New named-space flow: credentials stay in memory, names remain visible in screenshots.
  for (const [label, width] of [
    ["desktop", 1280],
    ["mobile", 390],
    ["narrow", 320],
  ]) {
    stage = `${label}-named-setup`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const page = await context.newPage();
    const name = `reading-${randomBytes(4).toString("hex")}`;
    await page.goto(address);
    await page.getByLabel("空间名称", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "创建我的空间", exact: true })
      .click();
    await page.locator('.tiptap[contenteditable="true"]').waitFor();
    const createdUrl = new URL(page.url());
    assert.equal(createdUrl.pathname, `/${name}`, "自填名称用于入口");
    assert.ok(
      /^#o=[A-Za-z0-9_-]{43}$/.test(createdUrl.hash),
      "现代管理能力格式正确",
    );
    await audit(page, `${label}-named-workspace`, { editor: true });
    await page.getByRole("button", { name: "分享空间", exact: true }).click();
    const linkField = page.getByLabel("只读分享链接", { exact: true });
    await linkField.waitFor();
    await page.locator(".qr").waitFor();
    const link = await linkField.inputValue();
    const parsed = new URL(link);
    assert.equal(parsed.pathname, `/${name}`, "短分享使用空间名称");
    assert.ok(/^#r=[A-Za-z0-9_-]{22}$/.test(parsed.hash), "短只读能力为128bit");
    assert.equal(
      await page
        .getByRole("button", { name: "生成只读链接", exact: true })
        .count(),
      0,
      "无需再次生成",
    );
    assert.ok(
      await page
        .evaluate(() => navigator.clipboard.readText())
        .then((value) => value === link),
      "点击分享即复制默认链接",
    );
    assert.equal(
      await page.locator(".share-advanced").getAttribute("open"),
      null,
      "默认折叠高级设置",
    );
    await audit(page, `${label}-compact-share`, { modal: true });
    await page.getByText("高级设置", { exact: true }).click();
    await page.getByRole("button", { name: "更新链接", exact: true }).waitFor();
    await audit(page, `${label}-share-advanced`, { modal: true });
    await page
      .getByRole("button", { name: "撤销只读分享", exact: true })
      .scrollIntoViewIfNeeded();
    await audit(page, `${label}-share-advanced-actions`, { modal: true });
    await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
    await page.reload();
    await page.locator('.tiptap[contenteditable="true"]').waitFor();
    await page.getByRole("button", { name: "分享空间", exact: true }).click();
    await page.getByLabel("只读分享链接", { exact: true }).waitFor();
    assert.ok(
      (await page.getByLabel("只读分享链接", { exact: true }).inputValue()) ===
        link,
      "刷新后默认分享仍复用",
    );
    const anotherOwner = await context.newPage();
    await anotherOwner.goto(createdUrl.href);
    await anotherOwner.locator('.tiptap[contenteditable="true"]').waitFor();
    await anotherOwner
      .getByRole("button", { name: "分享空间", exact: true })
      .click();
    await anotherOwner.getByLabel("只读分享链接", { exact: true }).waitFor();
    assert.ok(
      (await anotherOwner
        .getByLabel("只读分享链接", { exact: true })
        .inputValue()) === link,
      "另一管理页面复用同一分享",
    );
    await anotherOwner.close();
    const locked = await context.newPage();
    await locked.goto(`${address}/${name}`);
    await locked.getByLabel("访问码", { exact: true }).waitFor();
    assert.equal(
      await locked.locator(".tiptap").count(),
      0,
      "裸名称不显示正文",
    );
    await audit(locked, `${label}-named-access-code`);
    await locked
      .getByLabel("访问码", { exact: true })
      .fill(parsed.hash.slice(3));
    await locked
      .getByRole("button", { name: "打开已有空间", exact: true })
      .click();
    await locked.locator('.tiptap[contenteditable="false"]').waitFor();
    await audit(locked, `${label}-compact-readonly`, { editor: true });
    const duplicate = await context.newPage();
    await duplicate.goto(address);
    await duplicate.getByLabel("空间名称", { exact: true }).fill(name);
    await duplicate
      .getByRole("button", { name: "创建我的空间", exact: true })
      .click();
    await duplicate
      .getByRole("button", { name: "打开已有空间", exact: true })
      .waitFor();
    assert.equal(
      await duplicate.locator(".tiptap").count(),
      0,
      "重名不能获取编辑权限",
    );
    await audit(duplicate, `${label}-name-conflict`);
    await context.close();
  }
  // Real server responses and real encrypted data; only network failures below are mocked.
  const shared = await fetch(`${address}/api/spaces/${space.id}/shares`, {
    method: "POST",
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(shared.status, 201);
  const { token: readerToken } = await shared.json();
  for (const [label, width] of [
    ["desktop", 1280],
    ["mobile", 390],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto(
      `${address}/s/${space.id}#k=${key.toString("base64url")}&r=${readerToken}`,
    );
    await page.locator(".tiptap").waitFor();
    assert.equal(
      await page.locator(".tiptap").getAttribute("contenteditable"),
      "false",
    );
    await audit(page, `${label}-readonly`, { editor: true });
    stage = `${label}-offline-setup`;
    await page.goto(ownerUrl);
    await page.locator('.tiptap[contenteditable="true"]').waitFor();
    await context.setOffline(true);
    await page
      .locator(".tiptap")
      .fill(`${label}离线中文草稿：保存失败时仍能看清原因与下一步。`);
    await page.locator(".save-state.failed").waitFor();
    await audit(page, `${label}-offline-failure`, { editor: true });
    await context.setOffline(false);
    await page.getByRole("button", { name: "立即保存", exact: true }).click();
    await page
      .locator(".save-state")
      .filter({ hasText: "已加密保存" })
      .waitFor();
    // A simulated 409 exercises the real conflict UI without overwriting either version.
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
    await page.locator(".tiptap").fill("冲突中文草稿：两个版本都需要保留。");
    await page.locator(".conflict-banner").waitFor();
    await audit(page, `${label}-conflict`, { editor: true });
    await context.close();
  }
  stage = "legacy-password-setup";
  const password = `synthetic-${randomUUID()}`;
  const salt = randomBytes(16),
    passwordIv = randomBytes(12);
  const passwordCipher = createCipheriv(
    "aes-256-gcm",
    pbkdf2Sync(password, salt, 600_000, 32, "sha256"),
    passwordIv,
  );
  const wrappedKey = Buffer.concat([
    passwordCipher.update(key),
    passwordCipher.final(),
    passwordCipher.getAuthTag(),
  ]);
  const passwordContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const passwordPage = await passwordContext.newPage();
  const passwordParams = new URLSearchParams({
    r: readerToken,
    w: wrappedKey.toString("base64url"),
    s: salt.toString("base64url"),
    i: passwordIv.toString("base64url"),
  });
  await passwordPage.goto(`${address}/s/${space.id}#${passwordParams}`);
  await passwordPage.getByLabel("解锁密码", { exact: true }).waitFor();
  await audit(passwordPage, "mobile-legacy-password", { modal: true });
  await passwordPage.getByLabel("解锁密码", { exact: true }).fill(password);
  await passwordPage
    .getByRole("button", { name: "解锁内容", exact: true })
    .click();
  await passwordPage.locator('.tiptap[contenteditable="false"]').waitFor();
  await audit(passwordPage, "mobile-legacy-password-readonly", {
    editor: true,
  });
  await passwordContext.close();
  // A missing space follows the same unavailable/expired UI without waiting 30 minutes.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const expired = await context.newPage();
  await expired.goto(
    `${address}/s/${randomUUID()}#k=${key.toString("base64url")}&m=${ownerToken}`,
  );
  await expired.locator(".error-banner").waitFor();
  await audit(expired, "mobile-unavailable");
  await context.close();
  await report("passed");
  console.log(
    `PASS: ${records.length}组本地阅读/axe检查，截图和脱敏报告位于output/design-acceptance。`,
  );
} catch (error) {
  await report("failed");
  // Do not print Playwright call logs: they may contain fragment credentials.
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
