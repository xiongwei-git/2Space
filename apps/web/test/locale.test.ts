import { test } from "node:test";
import assert from "node:assert/strict";
import { browserLocale, translate } from "../src/locale.js";

test("browser language preferences are matched in order, including regional variants", () => {
  assert.equal(browserLocale(["es-MX", "fr-CA", "en-US"]), "fr");
  assert.equal(browserLocale(["de-CH"]), "de");
  assert.equal(browserLocale(["ja-JP"]), "ja");
  assert.equal(browserLocale(["zh-Hans-CN"]), "zh-CN");
  assert.equal(browserLocale(["zh-Hant", "en-GB"]), "en");
  assert.equal(browserLocale(["it-IT"]), "zh-CN");
});

test("every locale can translate UI messages and interpolate unmodified content", () => {
  for (const locale of ["en", "ja", "fr", "de"] as const) {
    assert.notEqual(translate(locale, "已保存"), "已保存");
    assert.ok(
      translate(locale, "{0}（我的修改）", "Mixed 日本語").includes(
        "Mixed 日本語",
      ),
    );
  }
});

test("all translated catalogs contain the same messages and placeholders", async () => {
  const { readFile } = await import("node:fs/promises");
  const catalog = async (locale: string): Promise<Record<string, string>> =>
    JSON.parse(
      await readFile(
        new URL(`../src/locales/${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
  const messages = Object.keys(await catalog("en")).sort();
  const placeholders = (text: string) => (text.match(/\{\d+\}/g) ?? []).sort();
  for (const locale of ["en", "ja", "fr", "de"]) {
    const values = await catalog(locale);
    assert.deepEqual(Object.keys(values).sort(), messages);
    for (const message of messages) {
      assert.ok(values[message].trim(), `${locale}: ${message}`);
      assert.deepEqual(
        placeholders(values[message]),
        placeholders(message),
        `${locale}: ${message}`,
      );
    }
  }
});
