import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  randomBytes,
  randomUUID,
  pbkdf2Sync,
  hkdfSync,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";

// All notes, passwords and document keys below belong to this disposable fixture.
// No traces, request dumps, secret URLs, database dumps or plaintext logs are written out.
// Screenshots contain only fixture notes and masked credential controls.
const temp = await mkdtemp(join(tmpdir(), "2space-protection-"));
const out = resolve("output/protection-acceptance");
const dbPath = join(temp, "synthetic.sqlite");
process.env.DB_PATH = dbPath;
process.env.WEB_DIST = resolve("apps/web/dist");
const { buildApp } = await import("../apps/server/dist/app.js");
const app = await buildApp();
let browser, database;
let stage = "startup";
const checks = [];
const screenshots = [];
const secrets = [];
const bodies = [];
const passwordOne = `first-${randomUUID()}`;
const passwordTwo = `second-${randomUUID()}`;
const wrongPassword = `wrong-${randomUUID()}`;
const oldPassword = `legacy-${randomUUID()}`;
const upgradePassword = `upgrade-${randomUUID()}`;
secrets.push(
  passwordOne,
  passwordTwo,
  wrongPassword,
  oldPassword,
  upgradePassword,
);
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
function doc(text) {
  return { title: "", html: `<p>${text}</p>`, text, language: "plaintext" };
}
function encrypt(document, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64url"),
    iv,
  );
  return {
    iv: iv.toString("base64url"),
    ciphertext: Buffer.concat([
      cipher.update(JSON.stringify(document)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64url"),
  };
}
function decrypt(payload, key) {
  const bytes = Buffer.from(payload.ciphertext, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "base64url"),
    Buffer.from(payload.iv, "base64url"),
  );
  decipher.setAuthTag(bytes.subarray(-16));
  return JSON.parse(
    Buffer.concat([
      decipher.update(bytes.subarray(0, -16)),
      decipher.final(),
    ]).toString(),
  );
}
function cannotDecrypt(payload, key) {
  try {
    decrypt(payload, key);
    return false;
  } catch {
    return true;
  }
}
function derive(password, id, protection) {
  check(
    protection?.version === 1 &&
      protection.kdf === "PBKDF2-SHA256" &&
      protection.iterations === 600000 &&
      Buffer.from(protection.salt, "base64url").length === 16,
    "使用固定版本、成本和随机盐的浏览器密码派生参数",
  );
  const root = pbkdf2Sync(
    password,
    Buffer.from(protection.salt, "base64url"),
    600000,
    32,
    "sha256",
  );
  const child = (purpose) =>
    Buffer.from(
      hkdfSync(
        "sha256",
        root,
        Buffer.from(id),
        Buffer.from(`2space/password/v1/${purpose}`),
        32,
      ),
    ).toString("base64url");
  const result = { key: child("document"), proof: child("auth") };
  secrets.push(result.key, result.proof, root.toString("base64url"));
  return result;
}
async function api(
  origin,
  path,
  { method = "GET", body, expected = 200 } = {},
) {
  const response = await fetch(`${origin}/api${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  check(response.status === expected, "隔离合成API状态符合预期");
  return expected === 204 ? null : response.json();
}
function row(id) {
  return database.prepare("SELECT * FROM spaces WHERE id=?").get(id);
}
function storedPages(id) {
  return database
    .prepare("SELECT * FROM pages WHERE space_id=? ORDER BY position")
    .all(id);
}
function asPayload(record) {
  return { iv: record.iv, ciphertext: record.ciphertext };
}
function listenBodies(context) {
  context.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      const body = request.postData();
      if (body) bodies.push(body);
    }
  });
}
async function workspace(page) {
  await page.locator(".tiptap").waitFor({ state: "visible" });
  await page.waitForFunction(
    () =>
      document.querySelector(".save-state")?.textContent.includes("已保存") ||
      document.querySelector(".save-state")?.textContent.includes("仅查看"),
  );
}
async function setPassword(page, password) {
  await page.getByRole("button", { name: /密码：/ }).click();
  await page.getByLabel("新密码", { exact: true }).fill(password);
  const changed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/protection") &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "保存", exact: true })
    .click();
  const response = await changed;
  check(response.status() === 200, "设置、更换或取消密码使用原子加密转换接口");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await workspace(page);
  return response.json();
}
async function setPasswordWithLostResponse(page, password, id) {
  const priorGeneration = row(id).key_revision ?? 0;
  await page.getByRole("button", { name: /密码：/ }).click();
  await page.getByLabel("新密码", { exact: true }).fill(password);
  let posts = 0,
    committedStatus = 0,
    routeError;
  let finishDrop;
  const dropped = new Promise((resolve) => {
    finishDrop = resolve;
  });
  const handler = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (posts !== 1) return route.continue();
    try {
      const response = await route.fetch();
      committedStatus = response.status();
      await route.abort("failed");
    } catch (error) {
      routeError = error;
      await route.abort("failed").catch(() => {});
    } finally {
      finishDrop();
    }
  };
  const path = `**/api/spaces/${id}/protection`;
  await page.route(path, handler);
  try {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await Promise.race([
      dropped,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("转换请求未到达隔离服务")), 10000),
      ),
    ]);
    check(
      !routeError && committedStatus === 200,
      "响应丢失发生在服务端已成功提交之后",
    );
    await page.waitForFunction(() => {
      const save = [
        ...document.querySelectorAll('[role="dialog"] button'),
      ].find((button) => button.textContent.trim() === "保存");
      return (
        save &&
        !save.disabled &&
        document
          .querySelector(".toast")
          ?.textContent.includes("设置结果暂未确认")
      );
    });
    check(
      (await page.getByLabel("新密码", { exact: true }).inputValue()) ===
        password,
      "未知结果保留密码表单以便确认，不丢失用户输入",
    );
    check(
      (row(id).key_revision ?? 0) === priorGeneration + 1,
      "网络响应丢失时服务端仅转换一次",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await workspace(page);
    check(
      posts === 1 && row(id).key_revision === priorGeneration + 1,
      "再次保存核对已生效结果，不重复换钥匙或增加代际",
    );
    const view = await page.evaluate(
      async (spaceId) => (await fetch(`/api/spaces/${spaceId}`)).json(),
      id,
    );
    return view;
  } finally {
    await page.unroute(path, handler);
  }
}
async function unlock(page, password) {
  await page.getByLabel("空间密码", { exact: true }).waitFor();
  await page.getByLabel("空间密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "打开剪贴板", exact: true }).click();
  await workspace(page);
}
async function rejectedPassword(page, password) {
  await page.getByLabel("空间密码", { exact: true }).waitFor();
  await page.getByLabel("空间密码", { exact: true }).fill(password);
  const attempted = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/unlock") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "打开剪贴板", exact: true }).click();
  check((await attempted).status() === 403, "错误或已更换的密码不能解锁");
  check(
    (await page.locator(".tiptap").count()) === 0,
    "密码验证失败不展示正文",
  );
}
async function snapshot(page, name) {
  const violations = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  check(
    violations.violations.length === 0,
    "密码保护流程无新增自动可访问性违规",
  );
  await page.screenshot({
    path: join(out, `${name}.png`),
    fullPage: true,
    mask: [
      page.locator(".qr"),
      page.locator(".link input"),
      page.locator("input[type=password]"),
      page.locator(".viewer-ip"),
    ],
  });
  screenshots.push(name);
}
try {
  await mkdir(out, { recursive: true });
  const origin = await app.listen({ host: "127.0.0.1", port: 0 });
  check(new URL(origin).hostname === "127.0.0.1", "验收仅访问随机本地端口");
  database = new DatabaseSync(dbPath, { readOnly: true });
  const oldKey = randomBytes(32).toString("base64url");
  secrets.push(oldKey);
  const content = `合成密码保护正文-${randomUUID()}`;
  const secondContent = `第二份合成内容-${randomUUID()}`;
  secrets.push(content, secondContent);
  const name = `crypto-${randomBytes(5).toString("hex")}`;
  const initial = await api(origin, "/spaces", {
    method: "POST",
    expected: 201,
    body: {
      accessMode: "public",
      name,
      publicKey: oldKey,
      ownerToken: randomBytes(32).toString("base64url"),
      retentionSeconds: 86400,
      page: { id: randomUUID(), payload: encrypt(doc(content), oldKey) },
    },
  });
  await api(origin, `/spaces/${initial.id}/pages`, {
    method: "POST",
    expected: 201,
    body: { id: randomUUID(), payload: encrypt(doc(secondContent), oldKey) },
  });
  const before = row(initial.id);
  const beforePages = storedPages(initial.id);
  browser = await chromium.launch();
  const ownerContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  listenBodies(ownerContext);
  const ownerPage = await ownerContext.newPage();
  stage = "ordinary-name-open";
  await ownerPage.goto(`${origin}/${name}`);
  await workspace(ownerPage);
  check(
    (await ownerPage.locator(".tiptap").textContent()).includes(content),
    "普通名称空间继续正常打开",
  );

  stage = "set-browser-password-response-lost";
  const protectedView = await setPasswordWithLostResponse(
    ownerPage,
    passwordOne,
    initial.id,
  );
  const derivedOne = derive(passwordOne, initial.id, protectedView.protection);
  const protectedRow = row(initial.id);
  const protectedPages = storedPages(initial.id);
  check(
    protectedRow.public_key === null && protectedView.publicKey === undefined,
    "保护空间不存储或返回正文解密钥匙",
  );
  check(
    protectedView.keyRevision === 1 &&
      protectedPages.length === beforePages.length,
    "完整保留全部记事本并增加加密代际",
  );
  check(
    protectedRow.updated_at === before.updated_at &&
      protectedRow.expires_at === before.expires_at,
    "密码转换不改变正文时间或续期",
  );
  check(
    protectedPages.every(
      (page, index) => page.revision === beforePages[index].revision + 1,
    ),
    "每页版本同步增加，拒绝旧代际写入",
  );
  check(
    decrypt(asPayload(protectedPages[0]), derivedOne.key).text === content &&
      decrypt(asPayload(protectedPages[1]), derivedOne.key).text ===
        secondContent,
    "独立派生可还原两份正文且内容完整",
  );
  check(
    protectedPages.every((page) => cannotDecrypt(asPayload(page), oldKey)),
    "历史普通空间钥匙无法解开升级后正文",
  );
  check(
    protectedPages.every((page) =>
      cannotDecrypt(asPayload(page), derivedOne.proof),
    ),
    "认证proof不能用作正文解密钥匙",
  );
  check(
    !JSON.stringify(protectedRow).includes(derivedOne.key) &&
      !JSON.stringify(protectedRow).includes(derivedOne.proof),
    "数据库不保存原始正文钥匙或认证proof",
  );
  const protectedStores = await ownerPage.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  check(
    [passwordOne, derivedOne.key].every(
      (secret) => !protectedStores.includes(secret),
    ),
    "密码保护生效期间也不持久化密码或正文解密钥匙",
  );

  const challenge = await api(origin, `/spaces/${initial.id}/protection`);
  check(
    challenge.protection?.salt === protectedView.protection.salt &&
      !JSON.stringify(challenge).includes(derivedOne.key) &&
      !JSON.stringify(challenge).includes(content),
    "未解锁只公开派生参数，不公开内容或钥匙",
  );
  await api(origin, `/spaces/${initial.id}`, { expected: 401 });
  await ownerPage.getByRole("button", { name: /密码：/ }).click();
  await snapshot(ownerPage, "desktop-browser-password-settings");
  await ownerPage
    .getByRole("button", { name: "关闭窗口", exact: true })
    .click();

  stage = "second-device-password";
  const readerContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  listenBodies(readerContext);
  const readerPage = await readerContext.newPage();
  await readerPage.goto(`${origin}/${name}?readonly`);
  await rejectedPassword(readerPage, wrongPassword);
  await snapshot(readerPage, "mobile-browser-password-unlock");
  await unlock(readerPage, passwordOne);
  check(
    (await readerPage.locator(".tiptap").textContent()).includes(content),
    "新设备用名称和密码解开原内容",
  );
  check(
    (await readerPage.locator(".tiptap").getAttribute("contenteditable")) ===
      "false",
    "仅查看页面模式保持",
  );
  await snapshot(readerPage, "mobile-browser-password-readonly");
  await readerContext.close();

  stage = "change-browser-password";
  const editedContent = `${content} 已继续输入`;
  secrets.push(editedContent);
  await ownerPage.locator(".tiptap").fill(editedContent);
  const secondView = await setPassword(ownerPage, passwordTwo);
  const derivedTwo = derive(passwordTwo, initial.id, secondView.protection);
  const changedPages = storedPages(initial.id);
  check(
    secondView.keyRevision === 2 &&
      secondView.protection.salt !== protectedView.protection.salt,
    "更换密码使用新盐、新钥匙及新代际",
  );
  check(
    changedPages.every((page) =>
      cannotDecrypt(asPayload(page), derivedOne.key),
    ),
    "旧密码派生钥匙不能解开改密后正文",
  );
  check(
    decrypt(asPayload(changedPages[0]), derivedTwo.key).text === editedContent,
    "即时编辑后更换密码会先保存，原子转换保留最新正文",
  );
  const nextContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  listenBodies(nextContext);
  const nextPage = await nextContext.newPage();
  await nextPage.goto(`${origin}/${name}`);
  await rejectedPassword(nextPage, passwordOne);
  await unlock(nextPage, passwordTwo);
  check(
    (await nextPage.locator(".tiptap").getAttribute("contenteditable")) ===
      "true",
    "新密码可在新设备继续编辑",
  );
  await nextPage.reload();
  await nextPage.getByLabel("空间密码", { exact: true }).waitFor();
  check(
    (await nextPage.locator(".tiptap").count()) === 0,
    "已有会话cookie不能替代浏览器解密密码",
  );
  await nextContext.close();

  stage = "remove-browser-password";
  ownerPage.on("dialog", (dialog) => void dialog.accept());
  const removedView = await setPassword(ownerPage, "");
  const removedRow = row(initial.id);
  const removedPages = storedPages(initial.id);
  check(
    !removedView.passwordProtected &&
      !removedView.protection &&
      removedView.keyRevision === 3,
    "明确取消密码后恢复普通名称访问",
  );
  check(
    typeof removedRow.public_key === "string" &&
      removedRow.public_key !== oldKey &&
      removedRow.public_key !== derivedTwo.key,
    "取消密码使用新的普通空间钥匙",
  );
  check(
    removedPages.every((page) =>
      cannotDecrypt(asPayload(page), derivedTwo.key),
    ),
    "取消密码不继续沿用受保护内容钥匙",
  );
  check(
    decrypt(asPayload(removedPages[0]), removedRow.public_key).text ===
      editedContent,
    "取消密码后原内容仍完整",
  );
  const ordinary = await api(origin, `/spaces/by-name/${name}`);
  check(
    ordinary.publicKey === removedRow.public_key,
    "取消密码后其他设备按名称正常打开",
  );

  stage = "offline-old-password-draft";
  const draftKey = randomBytes(32).toString("base64url");
  secrets.push(draftKey);
  const draftName = `draft-${randomBytes(5).toString("hex")}`;
  const draftBase = `合成草稿原稿-${randomUUID()}`;
  const offlineText = `本机离线未保存修改-${randomUUID()}`;
  const remoteText = `另一台设备已保存修改-${randomUUID()}`;
  secrets.push(draftBase, offlineText, remoteText);
  const draftSpace = await api(origin, "/spaces", {
    method: "POST",
    expected: 201,
    body: {
      accessMode: "public",
      name: draftName,
      publicKey: draftKey,
      ownerToken: randomBytes(32).toString("base64url"),
      page: { id: randomUUID(), payload: encrypt(doc(draftBase), draftKey) },
    },
  });
  const draftContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const changerContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  listenBodies(draftContext);
  listenBodies(changerContext);
  const draftPage = await draftContext.newPage();
  const changerPage = await changerContext.newPage();
  await draftPage.goto(`${origin}/${draftName}`);
  await workspace(draftPage);
  await setPassword(draftPage, passwordOne);
  await changerPage.goto(`${origin}/${draftName}`);
  await unlock(changerPage, passwordOne);
  stage = "draft-offline-persist";
  await draftContext.setOffline(true);
  await draftPage.locator(".tiptap").fill(offlineText);
  await draftPage.waitForFunction((id) => {
    const key = Object.keys(localStorage).find((value) =>
      value.startsWith(`2space:draft:${id}:`),
    );
    if (!key) return false;
    const draft = JSON.parse(localStorage.getItem(key));
    return draft?.protection?.version === 1 && draft?.payload?.ciphertext;
  }, draftSpace.id);
  check(true, "离线草稿以旧密码派生参数及加密内容保留在本机");
  stage = "draft-other-device-rekey";
  await changerPage.locator(".tiptap").fill(remoteText);
  await changerPage.waitForFunction(
    () => document.querySelector(".save-state")?.textContent === "已保存",
  );
  const changedDraftView = await setPassword(changerPage, passwordTwo);
  const changedDraftKey = derive(
    passwordTwo,
    draftSpace.id,
    changedDraftView.protection,
  ).key;
  stage = "draft-reload-new-password";
  await draftContext.setOffline(false);
  await draftPage.reload();
  await unlock(draftPage, passwordTwo);
  await draftPage
    .getByRole("button", { name: "恢复未保存内容", exact: true })
    .waitFor();
  const recoveryCount = () =>
    draftPage.evaluate(
      (id) =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith(`2space:recovery:${id}:`),
        ).length,
      draftSpace.id,
    );
  const keptRecoveries = await recoveryCount();
  check(keptRecoveries > 0, "重新打开后旧密码草稿转入可恢复记录而非丢弃");
  const recoveryBodies = [];
  let recoveryListening = true;
  draftPage.on("request", (request) => {
    if (recoveryListening && request.postData())
      recoveryBodies.push(request.postData());
  });
  await draftPage
    .getByRole("button", { name: "恢复未保存内容", exact: true })
    .click();
  stage = "draft-bad-old-password";
  await draftPage
    .getByLabel("上次使用的密码", { exact: true })
    .fill(wrongPassword);
  await draftPage
    .getByRole("button", { name: "恢复内容", exact: true })
    .click();
  await draftPage
    .locator(".toast")
    .filter({ hasText: "原记录仍然保留" })
    .waitFor();
  check(
    (await recoveryCount()) === keptRecoveries,
    "输入错误旧密码不会删除旧草稿记录",
  );
  stage = "draft-local-restore";
  await draftPage
    .getByLabel("上次使用的密码", { exact: true })
    .fill(passwordOne);
  await draftPage
    .getByRole("button", { name: "恢复内容", exact: true })
    .click();
  await draftPage.locator(".recovery-preview").waitFor();
  check(
    (await draftPage.locator(".recovery-preview").textContent()).includes(
      offlineText,
    ),
    "正确旧密码仅在浏览器还原离线修改",
  );
  check(
    !(await draftPage.locator(".toast").allTextContents())
      .join(" ")
      .includes("上次的密码不正确"),
    "恢复成功后不残留旧密码错误提示",
  );

  await snapshot(draftPage, "mobile-old-password-draft-recovery");
  check(
    (await recoveryCount()) === keptRecoveries,
    "预览恢复内容时仍保留加密副本",
  );
  stage = "draft-save-as-copy";
  await draftPage
    .getByRole("button", { name: "另存为新记事本", exact: true })
    .click();
  await draftPage.getByRole("dialog").waitFor({ state: "hidden" });
  await workspace(draftPage);
  check((await recoveryCount()) === 0, "另存成功后才移除相应旧草稿备份");
  const recoveredTexts = storedPages(draftSpace.id).map(
    (record) => decrypt(asPayload(record), changedDraftKey).text,
  );
  check(
    recoveredTexts.includes(remoteText) && recoveredTexts.includes(offlineText),
    "恢复另存保留其他设备已保存内容及本机离线修改两份",
  );
  recoveryListening = false;
  check(
    !recoveryBodies.join("\n").includes(passwordOne) &&
      !recoveryBodies.join("\n").includes(wrongPassword) &&
      !recoveryBodies.join("\n").includes(offlineText),
    "旧密码恢复不发送旧密码、错误输入或明文到服务器",
  );
  await draftContext.close();
  await changerContext.close();

  stage = "other-tab-late-draft-during-rekey";
  const lateKey = randomBytes(32).toString("base64url");
  const lateName = `late-${randomBytes(5).toString("hex")}`;
  const lateText = `另一个标签页晚写入的未保存修改-${randomUUID()}`;
  secrets.push(lateKey, lateText);
  const lateSpace = await api(origin, "/spaces", {
    method: "POST",
    expected: 201,
    body: {
      accessMode: "public",
      name: lateName,
      publicKey: lateKey,
      ownerToken: randomBytes(32).toString("base64url"),
      page: { id: randomUUID(), payload: encrypt(doc(content), lateKey) },
    },
  });
  const lateContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  listenBodies(lateContext);
  const latePage = await lateContext.newPage();
  const otherTab = await lateContext.newPage();
  await latePage.goto(`${origin}/${lateName}`);
  await workspace(latePage);
  const firstLateView = await setPassword(latePage, passwordOne);
  const firstLateKey = derive(
    passwordOne,
    lateSpace.id,
    firstLateView.protection,
  ).key;
  await otherTab.goto(origin);
  const standardDraftKey = `2space:draft:${lateSpace.id}:${firstLateView.pages[0].id}`;
  const lateDraft = {
    baseRevision: firstLateView.pages[0].revision,
    keyRevision: firstLateView.keyRevision,
    protection: firstLateView.protection,
    payload: encrypt(doc(lateText), firstLateKey),
  };
  let injected = false,
    lateStatus = 0;
  const lateRoute = async (route) => {
    if (route.request().method() !== "POST" || injected)
      return route.continue();
    const response = await route.fetch();
    lateStatus = response.status();
    await otherTab.evaluate(
      ({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)),
      { key: standardDraftKey, draft: lateDraft },
    );
    injected = true;
    await route.fulfill({ response });
  };
  await latePage.route(`**/api/spaces/${lateSpace.id}/protection`, lateRoute);
  const secondLateView = await setPassword(latePage, passwordTwo);
  check(
    injected && lateStatus === 200,
    "另一标签页草稿在服务端转换成功但当前页收到响应前写入",
  );
  await latePage
    .getByRole("button", { name: "恢复未保存内容", exact: true })
    .waitFor();
  const lateRecoveries = await latePage.evaluate(
    (id) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(`2space:recovery:${id}:`))
        .map((key) => JSON.parse(localStorage.getItem(key))),
    lateSpace.id,
  );
  check(
    lateRecoveries.some(
      (item) => decrypt(item.draft.payload, firstLateKey).text === lateText,
    ),
    "转换完成不会盲删另一标签页晚写入的加密草稿",
  );
  const secondLateKey = derive(
    passwordTwo,
    lateSpace.id,
    secondLateView.protection,
  ).key;
  check(
    decrypt(asPayload(storedPages(lateSpace.id)[0]), secondLateKey).text ===
      content,
    "晚写本地草稿不会覆盖服务端的新代际正文",
  );
  await lateContext.close();

  stage = "legacy-password-upgrade";
  const legacyKey = randomBytes(32).toString("base64url");
  secrets.push(legacyKey);
  const legacyName = `legacy-${randomBytes(5).toString("hex")}`;
  const legacy = await api(origin, "/spaces", {
    method: "POST",
    expected: 201,
    body: {
      accessMode: "public",
      name: legacyName,
      publicKey: legacyKey,
      ownerToken: randomBytes(32).toString("base64url"),
      page: { id: randomUUID(), payload: encrypt(doc(content), legacyKey) },
    },
  });
  await api(origin, `/spaces/${legacy.id}/password`, {
    method: "POST",
    body: { password: oldPassword },
  });
  const legacyContext = await browser.newContext({
    locale: "zh-CN",
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  const legacyPage = await legacyContext.newPage();
  await legacyPage.goto(`${origin}/${legacyName}`);
  await unlock(legacyPage, oldPassword);
  check(
    (await legacyPage.locator(".tiptap").textContent()).includes(content),
    "旧public密码仍可打开原数据",
  );
  listenBodies(legacyContext);
  const upgradedView = await setPassword(legacyPage, upgradePassword);
  const upgraded = storedPages(legacy.id);
  const upgradeKey = derive(
    upgradePassword,
    legacy.id,
    upgradedView.protection,
  ).key;
  check(
    row(legacy.id).public_key === null &&
      cannotDecrypt(asPayload(upgraded[0]), legacyKey),
    "旧密码空间重新设置密码后移除服务端解密钥匙",
  );
  check(
    decrypt(asPayload(upgraded[0]), upgradeKey).text === content,
    "旧空间升级后内容完整",
  );
  await legacyContext.close();

  stage = "wire-and-local-storage";
  const wire = bodies.join("\n");
  check(
    [
      passwordOne,
      passwordTwo,
      wrongPassword,
      upgradePassword,
      derivedOne.key,
      derivedTwo.key,
      upgradeKey,
      content,
      editedContent,
      secondContent,
    ].every((secret) => !wire.includes(secret)),
    "新密码、正文解密钥匙及明文不进入API请求",
  );
  const stores = await ownerPage.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  check(
    [passwordOne, passwordTwo, derivedOne.key, derivedTwo.key].every(
      (secret) => !stores.includes(secret),
    ),
    "浏览器持久存储不保存密码或正文解密钥匙",
  );
  await writeFile(
    join(out, "report.json"),
    JSON.stringify({ status: "passed", checks, screenshots }, null, 2),
  );
  console.log(
    `PASS: ${checks.length}项浏览器密码保护/独立解密/跨设备/兼容/请求边界检查；仅合成数据。`,
  );
} catch (error) {
  const raw = error instanceof Error ? error.message : "Unknown error";
  let safe = raw;
  for (const secret of secrets)
    if (secret) safe = safe.split(secret).join("[redacted]");
  safe = safe
    .replace(/https?:\/\/[^\s)]+/g, "[url]")
    .replace(/[A-Za-z0-9_-]{35,}/g, "[value]");
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "report.json"),
    JSON.stringify({ status: "failed", stage, checks, error: safe }, null, 2),
  );
  console.error(`FAIL: ${stage}: ${safe}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (database) database.close();
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
