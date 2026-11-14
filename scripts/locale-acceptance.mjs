import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { buildApp } from "../apps/server/dist/app.js";

const temp = await mkdtemp(join(tmpdir(), "2space-locale-"));
const output = resolve("output/design-acceptance/locales");
await mkdir(output, { recursive: true });
const app = await buildApp({
  dbPath: join(temp, "synthetic.sqlite"),
  webDist: resolve("apps/web/dist"),
});
let browser;
try {
  const url = await app.listen({ host: "127.0.0.1", port: 0 });
  browser = await chromium.launch();
  for (const [input, language, saved] of [
    ["zh-CN", "zh-CN", "已保存"],
    ["en-GB", "en", "Saved"],
    ["ja-JP", "ja", "保存済み"],
    ["fr-CA", "fr", "Enregistré"],
    ["de-CH", "de", "Gespeichert"],
  ]) {
    const context = await browser.newContext({
      locale: input,
      viewport: { width: 320, height: 850 },
    });
    const page = await context.newPage();
    const selector = page.locator(".language-select");
    const checkLanguage = (value) =>
      page.waitForFunction(
        (locale) => document.documentElement.lang === locale,
        value,
      );
    const checkLayout = async (name) => {
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        `${language}: ${name} horizontal overflow`,
      );
      assert.equal(
        await selector.evaluate(
          (element) => getComputedStyle(element).fontSize,
        ),
        "14px",
      );
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      assert.deepEqual(
        violations.map(({ id, nodes }) => [
          id,
          nodes.map(({ target }) => target),
        ]),
        [],
      );
      await page.screenshot({
        path: join(output, `${language}-${name}.png`),
        mask: [
          page.locator(
            ".qr-wrap, .viewer-ip, .share-link, input[type=password]",
          ),
        ],
      });
    };
    await page.goto(url);
    await selector.waitFor();
    await checkLanguage(language);
    assert.equal(await selector.inputValue(), "");
    await checkLayout("home");
    await page.setViewportSize({ width: 1280, height: 900 });
    await checkLayout("desktop-home");
    await page.setViewportSize({ width: 320, height: 850 });
    const subject = "synthetic-" + language.toLowerCase();
    await page.locator("#spaceName").fill(subject);
    await page.locator(".form-actions button").click();
    await page.locator('.tiptap[contenteditable="true"]').waitFor();
    const draft = "Unchanged content / 日本語 / 中文";
    await page.locator(".tiptap").fill(draft);
    const alternate = language === "en" ? "ja" : "en";
    await selector.selectOption(alternate);
    await checkLanguage(alternate);
    assert.equal(await page.locator(".tiptap").textContent(), draft);
    await selector.selectOption("");
    await checkLanguage(language);
    await page.waitForFunction(
      (label) =>
        document.querySelector(".save-state")?.textContent.trim() === label,
      saved,
    );
    await checkLayout("editor");
    await page.setViewportSize({ width: 1280, height: 900 });
    await checkLayout("desktop-editor");
    await page.setViewportSize({ width: 320, height: 850 });
    await page.reload();
    await page.locator(".tiptap").waitFor();
    assert.equal(await page.locator(".tiptap").textContent(), draft);
    await page.goto(url + "/" + subject + "?readonly");
    await page.locator('.tiptap[contenteditable="false"]').waitFor();
    await checkLanguage(language);
    await page.goto(url + "/wechat-share.html");
    await checkLanguage(language);
    await checkLayout("share");
    await selector.selectOption(alternate);
    await checkLanguage(alternate);
    const response = await page.goto(url + "/missing/page");
    assert.equal(response.status(), 404);
    await checkLanguage(alternate);
    assert.equal(await selector.inputValue(), alternate);
    await selector.selectOption("");
    await checkLanguage(language);
    await checkLayout("404");
    await page.goto(url + "/s/11111111-1111-4111-8111-111111111111");
    const error = page.locator(".page-error");
    await error.waitFor();
    const localized = await error.textContent();
    await selector.selectOption(alternate);
    await checkLanguage(alternate);
    assert.notEqual(await error.textContent(), localized);
    await context.close();
    console.log(`PASS: ${input} → ${language}`);
  }
} finally {
  await browser?.close();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
