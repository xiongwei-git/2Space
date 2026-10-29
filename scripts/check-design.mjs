import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

// Static guard complements computed-style checks; it cannot resolve the cascade.
const source = new URL("../apps/web/src/", import.meta.url);
const css = (
  await Promise.all(
    (await readdir(source))
      .filter((file) => file.endsWith(".css") && file !== "tokens.css")
      .map((file) => readFile(new URL(file, source), "utf8")),
  )
).join("\n");
const tokens = await readFile(
  new URL("../apps/web/src/tokens.css", import.meta.url),
  "utf8",
);
assert.match(css, /@import\s+["']\.\/tokens\.css["']/);
for (const match of css.matchAll(/font-size\s*:\s*([^;]+);/g)) {
  assert.match(
    match[1],
    /^(?:var\(--font-size-[\w-]+\)|inherit)$/,
    `字号必须使用语义 Token：${match[1]}`,
  );
}
for (const [role, value] of Object.entries({
  body: "1rem",
  secondary: "0.875rem",
  meta: "0.75rem",
})) {
  assert.ok(tokens.includes(`--font-size-${role}: ${value};`), `${role}基线值`);
}
assert.doesNotMatch(css, /font-size[^;]*!important/);
for (const match of css.matchAll(/(?:^|[;{])\s*font\s*:\s*([^;]+);/gm)) {
  assert.equal(match[1].trim(), "inherit", "不得用font简写绕过字号Token");
}
const html = await readFile(
  new URL("../apps/web/index.html", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  html,
  /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[",\s])/i,
);
console.log("PASS: 阅读基线静态检查（字号 Token、基准值、缩放设置）。");
