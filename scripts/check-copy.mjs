import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import ts from "typescript";

// Inspect controlled interface copy only. Never inspect saved notes or runtime links.
const forbidden = [
  /本地开发|开发版本|开发环境|测试环境|生产环境|公网部署|部署必须|部署配置|容器部署|数据库迁移|回环地址|第三方统计|没有广告|无广告/u,
  /管理链接|访问凭证|私密可控|私密空间|密钥|密文|哈希|封装|复用|本机副本|远端版本|版本冲突/u,
];
async function filesAt(path) {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? filesAt(resolve(path, entry.name))
          : [resolve(path, entry.name)],
      ),
    )
  ).flat();
}
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((path) => resolve(path))
  : [
      ...(await filesAt(resolve("apps/web/src"))),
      resolve("apps/web/index.html"),
    ];
const failures = [];
let checked = 0;
for (const file of files) {
  if (![".ts", ".tsx", ".html", ".css"].includes(extname(file))) continue;
  const text = await readFile(file, "utf8");
  function inspect(value, position = 0) {
    if (!/\p{Script=Han}/u.test(value)) return;
    checked++;
    const blocked = forbidden.find((pattern) => pattern.test(value));
    if (blocked)
      failures.push(
        `${file}:${text.slice(0, position).split("\n").length}: ${blocked.source}`,
      );
  }
  if (extname(file) === ".html") inspect(text);
  else if (extname(file) === ".css") {
    for (const match of text.matchAll(/content\s*:\s*(["'])(.*?)\1/g))
      inspect(match[2], match.index);
  } else {
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function visit(node) {
      if (
        ts.isStringLiteralLike(node) ||
        ts.isJsxText(node) ||
        [
          ts.SyntaxKind.TemplateHead,
          ts.SyntaxKind.TemplateMiddle,
          ts.SyntaxKind.TemplateTail,
        ].includes(node.kind)
      )
        inspect(node.text || "", node.getStart(source));
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
assert.equal(
  failures.length,
  0,
  `用户界面包含维护说明或模糊术语，请改为动作、结果与下一步：\n${failures.join("\n")}`,
);
console.log(`PASS: ${checked}段界面文案检查；未扫描用户笔记。`);
