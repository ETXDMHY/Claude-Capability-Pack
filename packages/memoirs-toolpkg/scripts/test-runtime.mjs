import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.toolpkg_id, "com.volumeofmemoirs.operit");
assert.equal(manifest.main, "dist/main.js");
assert.ok(fs.existsSync(path.join(root, manifest.main)));
assert.equal(manifest.subpackages[0].id, "memoirs_automation");
assert.ok(fs.existsSync(path.join(root, manifest.subpackages[0].entry)));

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    if (fs.statSync(target).isDirectory()) walk(target);
    else if (target.endsWith(".js")) files.push(target);
  }
}
walk(path.join(root, "dist"));
for (const file of files) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });

const memoryConfigRoot = "/config/com.claude_capability_pack.memory";
const memoryRoot = `${memoryConfigRoot}/memory/buckets/dynamic`;
const nestedMemoryRoot = `${memoryConfigRoot}/claude-capability-pack/memory/buckets/feel`;
const memoirsState = "/config/com.volumeofmemoirs.operit/memoirs/state.json";
const filesByPath = new Map([
  [`${memoryRoot}/one.md`, bucket("m_one", "第一次一起修好了那座停摆许久的旧钟，最后它重新响了起来。", "旧钟")],
  [`${memoryRoot}/two.md`, bucket("m_two", "雨天绕了很远的路买了一袋很酸的橘子，回家后还是全吃完了。", "橘子")],
  [`${memoryRoot}/three.md`, bucket("m_three", "项目发布前一晚，我们重新整理了全部说明，直到每一处细节都能看懂。", "发布前夜")],
  [`${nestedMemoryRoot}/legacy.md`, bucket("m_legacy", "这条记忆保存在记忆插件自己的嵌套旧目录里，现在也应该被完整读到。", "旧目录")],
  [`${memoryConfigRoot}/memory/index/buckets-cache.json`, JSON.stringify({
    version: 2,
    buckets: [
      cachedBucket("m_one", "第一次一起修好了那座停摆许久的旧钟，最后它重新响了起来。", "旧钟"),
      cachedBucket("m_two", "雨天绕了很远的路买了一袋很酸的橘子，回家后还是全吃完了。", "橘子"),
      cachedBucket("m_three", "项目发布前一晚，我们重新整理了全部说明，直到每一处细节都能看懂。", "发布前夜"),
      cachedBucket("m_legacy", "这条记忆保存在记忆插件自己的嵌套旧目录里，现在也应该被完整读到。", "旧目录"),
      cachedBucket("m_cached", "这条记忆来自本地记忆插件维护的完整缓存，而不是当前目录扫描结果。", "缓存记忆"),
    ],
    errors: [],
  })],
]);

const registrations = { ui: 0, nav: 0, hook: 0, promptHook: 0 };
global.ToolPkg = {
  getConfigDir(id) { return `/config/${id || "com.volumeofmemoirs.operit"}`; },
  registerToolboxUiModule(definition) { registrations.ui += 1; global.__memoirsUi = definition; },
  registerNavigationEntry(definition) { registrations.nav += 1; global.__memoirsNav = definition; },
  registerChatMessageHook(definition) { registrations.hook += 1; global.__memoirsHook = definition; },
  registerPromptFinalizeHook(definition) { registrations.promptHook += 1; global.__memoirsPromptHook = definition; },
};
let switchedTo = "";
let createdWorkflow = null;
global.Tools = {
  Files: {
    async list(dir) {
      const prefix = `${dir.replace(/\/$/, "")}/`;
      const children = new Map();
      for (const key of filesByPath.keys()) {
        if (!key.startsWith(prefix)) continue;
        const tail = key.slice(prefix.length);
        const name = tail.split("/")[0];
        children.set(name, { name, path: `${dir}/${name}`, isDirectory: tail.includes("/") });
      }
      return Array.from(children.values());
    },
    async read(file) {
      if (!filesByPath.has(file)) throw new Error(`missing ${file}`);
      return filesByPath.get(file);
    },
    async mkdir() {},
    async write(file, content) { filesByPath.set(file, content); },
  },
  Chat: {
    async listAll() {
      return { currentChatId: "chat-1", chats: [
        { id: "chat-1", title: "当前窗口", characterCardId: "gabe-card", characterCardName: "Gabe" },
        { id: "chat-2", title: "固定窗口", characterCardId: "gabe-fixed", characterCardName: "Gabe Fixed" },
      ] };
    },
    async sendMessage(message) {
      return { aiResponse: message.includes("批注") ? '{"annotation":"现在看还是很像我们。"}' : '{"page":2}' };
    },
    async switchTo(chatId) { switchedTo = chatId; },
    async agentStatus() { return { isProcessing: false }; },
  },
  Workflow: {
    async getAll() { return { workflows: [] }; },
    async create(name, description, nodes, connections, enabled) {
      createdWorkflow = { name, description, nodes, connections, enabled };
      return { id: "workflow-memoirs" };
    },
    async enable() {},
  },
};

const engine = await import(pathToFileURL(path.join(root, "dist", "engine.js")).href);
let snapshot = await engine.acceptToday();
assert.equal(snapshot.sourceCount, 5);
assert.equal(snapshot.book.pages.length, 5);
assert.equal(snapshot.event.status, "accepted");
snapshot = await engine.chooseUserPage(1);
assert.equal(snapshot.revealed.length, 0);
snapshot = await engine.askCurrentRoleToChoose();
assert.equal(snapshot.event.status, "completed");
assert.equal(snapshot.revealed.length, 2);
assert.equal(snapshot.readingLog.length, 1);
assert.equal(snapshot.chatSync.latestReadingStatus, "pending");
const memoryId = snapshot.revealed[0].memory.id;
await engine.addUserAnnotation(memoryId, "  当时真能折腾。  ");
snapshot = await engine.askCurrentRoleToAnnotate(memoryId);
assert.equal(snapshot.revealed.find((item) => item.memory.id === memoryId).annotations.length, 2);
assert.equal(snapshot.readingLog[0].items.find((item) => item.memory.id === memoryId).annotations.length, 2);
snapshot = await engine.updateSettings({ chatBinding: "fixed", fixedChatId: "chat-2" });
assert.equal(snapshot.chat.chatId, "chat-2");
assert.equal(snapshot.roleName, "Gabe Fixed");
await engine.returnToBoundChat();
assert.equal(switchedTo, "chat-2");
const chatSync = await import(pathToFileURL(path.join(root, "dist", "chatSync.js")).href);
const automation = await import(pathToFileURL(path.join(root, "dist", "packages", "memoirs_automation.js")).href);
assert.equal(typeof automation.tick, "function");
assert.equal(await chatSync.applyPendingContext({ eventPayload: { stage: "before_send_to_model", chatId: "chat-1", rawInput: "继续" } }), null);
await engine.updateSettings({ chatBinding: "fixed", fixedChatId: "chat-1", autoInvitationEnabled: true, invitationIdleMinutes: 30 });
const injected = await chatSync.applyPendingContext({ eventPayload: { stage: "before_send_to_model", chatId: "chat-1", rawInput: "继续" } });
assert.ok(injected.processedInput.includes("刚刚真实发生"));
assert.ok(injected.processedInput.includes("[Current real user message]\n\n继续"));
snapshot = await engine.getSnapshot(false);
assert.equal(snapshot.chatSync.latestReadingStatus, "in_flight");
await chatSync.consumeContextAfterAssistantMessage({ eventPayload: { chatId: "chat-1", sender: "assistant", completedAt: Date.now() } });
snapshot = await engine.getSnapshot(false);
assert.equal(snapshot.chatSync.latestReadingStatus, "consumed");
const workflow = await chatSync.ensureInvitationWorkflow();
assert.equal(workflow.id, "workflow-memoirs");
assert.equal(createdWorkflow.nodes.find((item) => item.id === "memoirs_tick").actionType, "memoirs_automation:tick");
assert.equal(createdWorkflow.nodes.find((item) => item.id === "memoirs_schedule").triggerConfig.interval_ms, "900000");
const stored = JSON.parse(filesByPath.get(memoirsState));
assert.ok(stored.readingHistory[memoryId]);
assert.equal(JSON.stringify(stored).includes("停摆许久的旧钟"), false);
assert.equal(JSON.stringify(stored).includes("一袋很酸的橘子"), false);
const main = await import(pathToFileURL(path.join(root, "dist", "main.js")).href);
assert.deepEqual(registrations, { ui: 0, nav: 0, hook: 0, promptHook: 0 });
main.registerToolPkg();
main.registerToolPkg();
assert.equal(global.__memoirsUi.id, "memoirs");
assert.equal(global.__memoirsNav.id, "memoirs_sidebar");
assert.equal(global.__memoirsHook.id, "memoirs_activity");
assert.equal(global.__memoirsPromptHook.id, "memoirs_chat_context");
assert.deepEqual(registrations, { ui: 1, nav: 1, hook: 1, promptHook: 1 });
assert.equal(global.__memoirsNav.route, "toolpkg:com.volumeofmemoirs.operit:ui:memoirs");

let controllerBound = false;
let bridgeAdded = false;
let htmlLoaded = false;
let loadedHtml = "";
let loadPromise;
const controller = {
  addJavascriptInterface() {
    assert.equal(controllerBound, true, "bridge must be added after WebView binds its controller");
    bridgeAdded = true;
  },
  loadHtml(html) {
    assert.equal(controllerBound, true, "HTML must load after WebView binds its controller");
    htmlLoaded = true;
    loadedHtml = html;
  },
};
global.__memoirsUi.screen({
  useMemo(_key, factory) { return factory(); },
  useRef(_key, initialValue) { return { current: initialValue }; },
  createWebViewController() { return controller; },
  showToast() {},
  UI: {
    WebView(properties) {
      controllerBound = true;
      loadPromise = properties.onLoad();
      return properties;
    },
  },
});
await loadPromise;
assert.equal(bridgeAdded, true);
assert.equal(htmlLoaded, true);
const inlineScript = loadedHtml.match(/<script>([\s\S]*)<\/script>/)?.[1] || "";
assert.ok(inlineScript.includes("阅读记录"));
new Function(inlineScript);

console.log(`Validated manifest, ${files.length} runtime files, hooks, workflow, shared-event delivery, daily book flow, history, and annotations`);

function bucket(id, body, title) {
  return `---\nid: "${id}"\ntype: "dynamic"\ndomain: ["life"]\ntags: []\ncreated_at: "2026-01-01T00:00:00.000Z"\nimportance: 5\nresolved: false\ndigested: false\npinned: false\ntitle: "${title}"\n---\n\n${body}\n`;
}

function cachedBucket(id, body, title) {
  return { id, type: "dynamic", domain: ["life"], tags: [], title, body, importance: 5, resolved: false, digested: false, pinned: false };
}
