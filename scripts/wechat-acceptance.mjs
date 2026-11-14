import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { buildApp } from "../apps/server/dist/app.js";
const app = await buildApp({ dbPath: ":memory:", cleanupIntervalMs: 0 });
await app.listen({ host: "127.0.0.1", port: 0 });
const origin = `http://127.0.0.1:${app.server.address().port}`;
const browser = await chromium.launch();
await mkdir("output/design-acceptance", { recursive: true });
try {
  const context = await browser.newContext({
    locale: "zh-CN",
    userAgent: "Mozilla/5.0 MicroMessenger/8.0",
  });
  let signatures = 0,
    scripts = 0;
  await context.route("https://2space.cn/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/wechat/jssdk") {
      signatures++;
      await route.fulfill({
        json: {
          appId: "wx1234567890abcdef",
          nonceStr: "nonce",
          timestamp: 123,
          signature: "a".repeat(40),
        },
      });
      return;
    }
    const response = await route.fetch({
      url: origin + url.pathname + url.search,
    });
    await route.fulfill({ response });
  });
  await context.route("https://res.wx.qq.com/**", async (route) => {
    scripts++;
    await route.fulfill({
      contentType: "application/javascript",
      body: `window.wx={ready(fn){this.cb=fn},error(){},config(){this.cb()},updateAppMessageShareData(data){window.shareData=data;data.success()},updateTimelineShareData(){}};`,
    });
  });
  const page = await context.newPage();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("https://2space.cn/wechat-share.html");
    await page
      .getByRole("status")
      .filter({ hasText: "分享卡片已准备好" })
      .waitFor();
    assert.equal(
      await page.evaluate(() => window.shareData.link),
      "https://2space.cn/",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert.equal(
      await page
        .locator("p")
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize),
      "16px",
    );
    assert.deepEqual(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
      [],
    );
    await page.screenshot({
      path: `output/design-acceptance/wechat-share-${width}.png`,
      fullPage: true,
    });
  }
  const before = [signatures, scripts];
  await page.locator(".language-select").selectOption("fr");
  await page.waitForFunction(
    () => window.shareData.title === "2Space · Copiez ici, retrouvez ailleurs.",
  );
  assert.equal(await page.locator("html").getAttribute("lang"), "fr");
  assert.deepEqual([signatures, scripts], before);
  await page.locator(".language-select").selectOption("");
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  await page.getByRole("link", { name: "打开 2Space", exact: true }).click();
  await page.waitForURL("https://2space.cn/");
  assert.equal(await page.evaluate(() => typeof window.wx), "undefined");
  assert.deepEqual([signatures, scripts], before);
  await page.goto("https://2space.cn/wechat-share.html?secret=synthetic");
  assert.deepEqual([signatures, scripts], before);
  await context.close();
  console.log(
    "PASS: 3 share viewports / axe / 16px / overflow / mock SDK / full navigation isolation / query guard",
  );
} finally {
  await browser.close();
  await app.close();
}
