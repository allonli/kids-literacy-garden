// 独立测试库驱动真实浏览器；不连接正式数据。先完成 Next.js 生产构建。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInitialState } from "../lib/learning-engine.mjs";
import { getWeekStart } from "../lib/study-list.mjs";
import { hashFamilyCode } from "../lib/server/family-auth.mjs";
import { openProgressDb } from "../lib/server/progress-db.mjs";

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const outputRoot = process.env.ACCOUNT_TEST_OUTPUT || (process.platform === "win32" ? "C:/usr/local/code/card-account-verification" : "/usr/local/code/card-account-verification");
mkdirSync(outputRoot, { recursive: true });
const directory = mkdtempSync(join(outputRoot, "run-"));
const state = createInitialState([
  { char: "山", stage: "MASTERED" }, { char: "水", stage: "DAILY" },
  { char: "花", stage: "LEARNING" }, { char: "月", stage: "WEEKLY" },
]);
state.items[0].pinyin = "shān";
state.items[0].editedWords = ["山河"];
state.weekendReview = { weekStart: getWeekStart(new Date()), characterIds: ["山"] };
const db = openProgressDb(join(directory, "progress.sqlite"));
db.migrateProgress("default", state, new Date());
db.close();
const port = await new Promise((done) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => done(value));
  });
});
const origin = `http://127.0.0.1:${port}`;
let serverOutput = "";
const server = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: { ...process.env, NODE_ENV: "production", LITERACY_DB_PATH: join(directory, "progress.sqlite"), LITERACY_FAMILY_CODE_HASH: await hashFamilyCode("482731", Buffer.alloc(16, 4)) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (value) => { serverOutput += value; });
server.stderr.on("data", (value) => { serverOutput += value; });
let browser;
const errors = [];
const results = [];
async function poll(check) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("等待验证状态超时");
}
function observe(page) { page.on("pageerror", (error) => errors.push(error.message)); }
async function saved(page) { await page.locator(".sync-saved").waitFor(); }
async function home(page) { await page.getByRole("button", { name: "返回首页", exact: true }).click(); await saved(page); }
async function select(page, accountId) {
  await poll(async () => page.getByRole("combobox", { name: "切换学习账户" }).isEnabled());
  await page.getByRole("combobox", { name: "切换学习账户" }).selectOption(accountId);
  await saved(page);
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).inputValue(), accountId);
}
async function progress(context, id = "default") {
  const response = await apiGet(context, id === "default" ? "/api/progress" : `/api/account-progress?accountId=${id}`);
  assert.equal(response.status(), 200);
  return response.json();
}
async function apiGet(context, path) {
  // 浏览器把 loopback 视为安全来源；独立 API 客户端需要显式携带测试会话。
  const cookie = (await context.cookies()).map(({ name, value }) => `${name}=${value}`).join("; ");
  return context.request.get(origin + path, { headers: { cookie } });
}
async function login(page) {
  await page.goto(origin);
  await page.getByRole("textbox", { name: "六位数字家庭码" }).fill("482731");
  await page.getByRole("button", { name: "登录并保存进度" }).click();
  await saved(page);
}
async function deletePrompt(page, button, accept) {
  const confirmation = page.waitForEvent("dialog");
  const clicking = button.click();
  const dialog = await confirmation;
  assert.equal(dialog.type(), "confirm");
  assert.match(dialog.message(), /当前学习账户/);
  assert.match(dialog.message(), /其他账户不受影响/);
  assert.match(dialog.message(), /原记录不会恢复/);
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await clicking;
}
try {
  await poll(async () => { try { return (await fetch(origin)).ok; } catch { return false; } });
  browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await context.newPage(); observe(page);
  await login(page);
  const original = await progress(context);
  await page.getByRole("button", { name: "添加学习账户", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "添加并开始学习" }).isDisabled(), true);
  await page.getByRole("textbox", { name: "账户名称", exact: true }).fill("取消测试");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await (await apiGet(context, "/api/accounts")).json()).accounts.length, 1);
  await page.getByRole("button", { name: "添加学习账户", exact: true }).click();
  await page.getByRole("textbox", { name: "账户名称", exact: true }).fill("妹妹");
  await page.getByRole("button", { name: "添加并开始学习" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await saved(page);
  const accountId = await page.getByRole("combobox", { name: "切换学习账户" }).inputValue();
  assert.notEqual(accountId, "default");
  const fresh = await progress(context, accountId);
  assert.equal(fresh.state.items.length, 4);
  assert(fresh.state.items.every((item) => item.stage === "LEARNING" && item.learningCorrect === 0 && item.stageStreak === 0));
  assert.deepEqual(fresh.state.items[0].editedWords, ["山河"]);
  assert.equal(fresh.state.weekendReview, undefined);
  assert.equal(fresh.state.dailySession, undefined);
  assert.deepEqual(await progress(context), original);
  results.push("新增账户沿用字库但进度和清单归零；取消及空名称不会创建；原账户不变");

  await page.getByRole("button", { name: "添加学习账户", exact: true }).click();
  await page.getByRole("textbox", { name: "账户名称", exact: true }).fill("妹妹");
  await page.getByRole("button", { name: "添加并开始学习" }).click();
  await page.getByRole("alert").filter({ hasText: "名称已存在" }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal((await (await apiGet(context, "/api/accounts")).json()).accounts.length, 2);
  results.push("同名创建可恢复且不会生成重复账户");

  await page.getByRole("button", { name: "开始列表学习" }).click();
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).count(), 0);
  assert.match(await page.locator(".account-menu-current").innerText(), /妹妹/);
  await page.getByRole("button", { name: "编辑山", exact: true }).click();
  await page.getByRole("textbox", { name: "拼音", exact: true }).fill("shān shān");
  await page.getByRole("textbox", { name: "组词", exact: true }).fill("高山、山水");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await page.getByRole("button", { name: "加入本周末复习：山", exact: true }).click();
  await page.getByRole("button", { name: "山，单击学会，双击不会", exact: true }).dblclick();
  await page.getByRole("button", { name: "显示拼音和组词" }).click();
  assert.match(await page.getByRole("dialog").innerText(), /shān shān/);
  await page.getByRole("button", { name: "学完了，放到最后复习" }).click();
  await page.getByRole("button", { name: "水，单击学会，双击不会", exact: true }).click();
  await page.getByRole("button", { name: "水，单击学会，双击不会", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "编辑月", exact: true }).click();
  await page.getByRole("combobox", { name: "当前学习状态", exact: true }).selectOption("WEEKLY");
  await page.getByRole("button", { name: "保存修改" }).click();
  await page.getByRole("button", { name: "返回列表", exact: true }).click();
  await saved(page);
  await home(page);
  const changed = await progress(context, accountId);
  assert.equal(changed.state.items[0].pinyin, "shān shān");
  assert.deepEqual(changed.state.items[0].editedWords, ["高山", "山水"]);
  assert.equal(changed.state.items.find((item) => item.id === "月").stage, "WEEKLY");
  assert.deepEqual(changed.state.dailySession.retryIds, ["山"]);
  assert.deepEqual(changed.state.dailySession.completedIds, ["水", "月"]);
  assert.deepEqual(changed.state.weekendReview.characterIds, ["山"]);
  await select(page, "default");
  assert.deepEqual(await progress(context), original);
  await select(page, accountId);
  await page.reload(); await saved(page);
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).inputValue(), accountId);
  assert.deepEqual(await progress(context, accountId), changed);
  results.push("编辑拼音组词、会与不会队列和周末选择独立持久化；切换和刷新恢复正确账户");

  await page.getByRole("button", { name: /^本周末复习清单/ }).click();
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".topbar").isVisible(), false);
  assert.deepEqual(await page.locator(".weekend-print-character").allTextContents(), ["山"]);
  await page.pdf({ path: join(directory, "account-weekend.pdf"), preferCSSPageSize: true });
  await page.emulateMedia({ media: "screen" });
  await home(page);

  await page.getByRole("button", { name: "开始列表学习" }).click();
  await saved(page);
  await context.setOffline(true);
  await page.getByRole("button", { name: "花，单击学会，双击不会", exact: true }).click();
  await page.locator(".sync-offline").waitFor();
  await page.getByRole("button", { name: "返回首页", exact: true }).click();
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "添加学习账户", exact: true }).isDisabled(), true);
  await context.setOffline(false);
  await saved(page);
  assert((await progress(context, accountId)).state.dailySession.completedIds.includes("花"));
  assert.deepEqual(await progress(context), original);
  results.push("真实断网时保留新账户操作并禁止切换，联网重试只补传当前账户；打印只含当前清单");

  const secondContext = await browser.newContext();
  const second = await secondContext.newPage(); observe(second);
  await login(second);
  await select(second, accountId);
  assert.deepEqual(await progress(secondContext, accountId), await progress(context, accountId));
  await select(second, "default");
  await second.getByRole("button", { name: /^本周末复习清单/ }).click();
  await second.getByRole("button", { name: "添加汉字", exact: true }).click();
  await second.getByRole("button", { name: "添加「水」", exact: true }).click();
  await saved(second);
  await page.getByRole("button", { name: /^本周末复习清单/ }).click();
  await page.getByRole("button", { name: "添加汉字", exact: true }).click();
  await page.getByRole("button", { name: "添加「月」", exact: true }).click();
  await saved(page);
  assert.deepEqual((await progress(context)).state.weekendReview.characterIds, ["山", "水"]);
  assert.deepEqual((await progress(context, accountId)).state.weekendReview.characterIds, ["山", "月"]);
  await home(page);
  const otherTab = await context.newPage(); observe(otherTab);
  await otherTab.goto(origin); await saved(otherTab);
  await select(otherTab, "default");
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).inputValue(), accountId);
  await page.getByRole("button", { name: /^本周末复习清单/ }).click();
  await page.getByRole("button", { name: "移出「月」", exact: true }).click();
  await saved(page);
  assert.deepEqual((await progress(context)).state.weekendReview.characterIds, ["山", "水"]);
  assert.deepEqual((await progress(context, accountId)).state.weekendReview.characterIds, ["山"]);
  await home(page);
  results.push("第二浏览器同家庭码可切换读取；两设备与共享Cookie的多标签操作分别保存");

  const loseCreationResponse = async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    assert.equal((await route.fetch()).status(), 201);
    await route.abort("failed");
  };
  await page.route("**/api/accounts", loseCreationResponse);
  await page.getByRole("button", { name: "添加学习账户", exact: true }).click();
  await page.getByRole("textbox", { name: "账户名称", exact: true }).fill("恢复测试");
  await page.getByRole("button", { name: "添加并开始学习" }).click();
  await page.getByRole("alert").filter({ hasText: "暂时无法确认是否添加成功" }).waitFor();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await poll(async () => (await page.getByRole("combobox", { name: "切换学习账户" }).textContent()).includes("恢复测试"));
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).inputValue(), accountId);
  assert.equal((await (await apiGet(context, "/api/accounts")).json()).accounts.filter((account) => account.name === "恢复测试").length, 1);
  await page.unroute("**/api/accounts", loseCreationResponse);

  await page.route("**/api/accounts", (route) => route.abort("failed"), { times: 1 });
  await page.reload(); await saved(page);
  await page.getByRole("button", { name: "重试读取" }).click();
  await poll(async () => page.getByRole("combobox", { name: "切换学习账户" }).isEnabled());
  await select(page, accountId);
  await page.evaluate(() => localStorage.setItem("kids-literacy:active-account:v1", "00000000-0000-0000-0000-000000000000"));
  await page.reload();
  await page.getByRole("button", { name: "返回原有账户", exact: true }).click();
  await saved(page);
  assert.equal(await page.getByRole("combobox", { name: "切换学习账户" }).inputValue(), "default");
  await select(page, accountId);
  results.push("创建成功但响应丢失后可从目录找回且不重复创建；目录读取失败可重试；无效账户可返回原账户");

  await page.setViewportSize({ width: 390, height: 845 });
  await page.screenshot({ path: join(directory, "mobile-home.png"), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("button", { name: "添加学习账户", exact: true }).click();
  await page.screenshot({ path: join(directory, "mobile-add.png"), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  results.push("390px首页与添加弹窗无横向溢出；无浏览器页面异常");

  const otherAccountBeforeDeletion = await progress(context);
  const beforeDeletion = await progress(context, accountId);
  await page.getByRole("button", { name: "家长中心", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索汉字", exact: true }).fill("山");
  await page.getByRole("button", { name: "删除山", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(directory, "mobile-delete-list.png"), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await deletePrompt(page, page.getByRole("button", { name: "删除山", exact: true }), false);
  assert.deepEqual(await progress(context, accountId), beforeDeletion);
  await page.getByRole("button", { name: "查看山的详情", exact: true }).click();
  await deletePrompt(page, page.getByRole("button", { name: "删除这个字", exact: true }), false);
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  assert.deepEqual(await progress(context, accountId), beforeDeletion);
  await deletePrompt(page, page.getByRole("button", { name: "删除这个字", exact: true }), true);
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await saved(page);
  const deleted = await progress(context, accountId);
  assert.deepEqual(deleted.state.items, beforeDeletion.state.items.filter((item) => item.id !== "山"));
  assert(deleted.state.history.every((entry) => entry.char !== "山"));
  assert(!deleted.state.weekendReview.characterIds.includes("山"));
  for (const key of ["pendingIds", "retryIds", "completedIds"]) assert(!deleted.state.dailySession[key].includes("山"));
  assert.deepEqual(await progress(context), otherAccountBeforeDeletion);
  await page.reload(); await saved(page);
  await page.getByRole("button", { name: /^本周末复习清单/ }).click();
  assert.equal(await page.getByRole("button", { name: "打印清单", exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "学习「山」", exact: true }).count(), 0);
  await home(page);
  await page.getByRole("button", { name: "开始列表学习" }).click();
  assert.equal(await page.getByRole("button", { name: /^山，/ }).count(), 0);
  await home(page);
  results.push("列表/详情取消删除均不改变状态；详情确认后关闭，字及历史/今日/周末引用移除，刷新保留且另一账户不变");

  await page.getByRole("button", { name: "家长中心", exact: true }).click();
  await page.getByRole("textbox", { name: "新学汉字", exact: true }).fill("山");
  await page.getByRole("button", { name: "加入待学习", exact: true }).click(); await saved(page);
  const added = (await progress(context, accountId)).state.items.find((item) => item.id === "山");
  assert.equal(added.stage, "LEARNING");
  assert.equal(added.learningCorrect, 0);
  assert.equal(added.editedWords, undefined);
  assert.equal(added.pinyin, "");
  await home(page);
  await page.getByRole("button", { name: "开始列表学习" }).click();
  assert.equal(await page.getByRole("button", { name: "山，单击学会，双击不会", exact: true }).isVisible(), true);
  await home(page);
  await page.getByRole("button", { name: "家长中心", exact: true }).click();
  await deletePrompt(page, page.getByRole("button", { name: "删除山", exact: true }), true); await saved(page);
  await context.setOffline(true);
  await deletePrompt(page, page.getByRole("button", { name: "删除水", exact: true }), true);
  await page.locator(".sync-offline").waitFor();
  assert.equal(await page.getByRole("button", { name: "删除水", exact: true }).count(), 0);
  await context.setOffline(false); await saved(page);
  assert(!(await progress(context, accountId)).state.items.some((item) => item.id === "水"));
  for (const char of ["花", "月"]) {
    await deletePrompt(page, page.getByRole("button", { name: `删除${char}`, exact: true }), true);
    await saved(page);
  }
  await page.reload(); await saved(page);
  const empty = (await progress(context, accountId)).state;
  assert.deepEqual(empty.items, []);
  assert.deepEqual(empty.history, []);
  assert.deepEqual(empty.weekendReview.characterIds, []);
  for (const key of ["pendingIds", "retryIds", "completedIds"]) assert.deepEqual(empty.dailySession[key], []);
  assert.deepEqual(await progress(context), otherAccountBeforeDeletion);
  await page.getByRole("button", { name: "家长中心", exact: true }).click();
  await page.getByRole("textbox", { name: "新学汉字", exact: true }).fill("山");
  await page.getByRole("button", { name: "加入待学习", exact: true }).click(); await saved(page);
  assert.equal((await progress(context, accountId)).state.items.length, 1);
  assert.deepEqual(errors, []);
  results.push("重新添加从零学习；列表确认删除、断网删除补传、最后一字删除及空字库刷新/重新添加通过，其他账户保持不变");
  writeFileSync(join(directory, "results.json"), JSON.stringify({ results, errors, accountId }, null, 2));
  console.log(JSON.stringify({ directory, results, errors }, null, 2));
} catch (error) {
  console.error(serverOutput);
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill();
}
