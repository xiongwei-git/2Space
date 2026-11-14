import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pageLabel,
  randomExperienceName,
  RETENTION_LABELS,
} from "../src/view-model.js";
import { RETENTION_SECONDS } from "@2space/shared";
import { validSpaceName } from "../src/compact.js";
const page = (title: string, text: string) => ({
  record: {
    id: "test",
    revision: 1,
    updatedAt: "2026-10-29T00:00:00Z",
    payload: { iv: "", ciphertext: "" },
  },
  doc: { title, text, html: "<p></p>", language: "plaintext" },
});
test("空标题自动按前6个Unicode字符命名，显式标题优先，空主/副页使用默认名称", () => {
  assert.equal(pageLabel(page("", "😀中 文\n字 abcd"), 0), "😀中 文 字…");
  assert.equal(pageLabel(page("", "abcdef"), 1), "abcdef");
  assert.equal(pageLabel(page("", "abcdefg"), 1), "abcdef…");
  assert.equal(pageLabel(page("  手动名称  ", "content"), 1), "手动名称");
  assert.equal(pageLabel(page("", ""), 0), "剪贴板");
  assert.equal(pageLabel(page("", "  \n  "), 3), "记事本3");
});
test("保留选项覆盖永久与12档时长，新随机体验为4位有效名称", () => {
  assert.equal(RETENTION_SECONDS.length, 13);
  assert.equal(RETENTION_LABELS.length, 13);
  assert.equal(RETENTION_SECONDS[0], 0);
  assert.equal(RETENTION_LABELS[0], "永久保留");
  for (let index = 0; index < 20; index++) {
    const name = randomExperienceName();
    assert.match(name, /^[a-z0-9]{4}$/);
    assert(validSpaceName(name));
  }
  for (const name of ["a", "AB-c_1", "_", "a".repeat(64)])
    assert(validSpaceName(name));
  for (const name of ["API", "Assets", "favicon", "a".repeat(65), "a b", "a/b"])
    assert(!validSpaceName(name));
});
