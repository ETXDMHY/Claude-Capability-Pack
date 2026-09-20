import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const files = new Map();
const directories = new Set();
let chatResponder = async () => ({ text: '{"memories":[]}', finishReason: "stop" });
let fileWriteDelayMs = 0;

function normalizePath(value) {
  return String(value).replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
}

function ensureDirectory(path) {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  for (let index = 1; index <= segments.length; index += 1) {
    directories.add(segments.slice(0, index).join("/"));
  }
}

globalThis.ToolPkg = {
  getConfigDir(pluginId) {
    return pluginId ? `C:/plugin-config/${pluginId}` : "C:/runtime-session";
  },
};

globalThis.Tools = {
  Chat: {
    async sendMessage(message, chatId, roleCardId, senderName, options) {
      return chatResponder({ message, chatId, roleCardId, senderName, options });
    },
  },
  Files: {
    async mkdir(path) {
      ensureDirectory(path);
      return { success: true };
    },
    async write(path, content) {
      const delay = fileWriteDelayMs;
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const normalized = normalizePath(path);
      ensureDirectory(normalized.slice(0, normalized.lastIndexOf("/")));
      files.set(normalized, String(content));
      return { success: true };
    },
    async read(path) {
      const normalized = normalizePath(path);
      if (!files.has(normalized)) {
        throw new Error(`ENOENT: ${normalized}`);
      }
      return { data: { content: files.get(normalized) } };
    },
    async list(path) {
      const normalized = normalizePath(path);
      const prefix = `${normalized}/`;
      const entries = new Map();

      for (const directory of directories) {
        if (!directory.startsWith(prefix)) continue;
        const relative = directory.slice(prefix.length);
        if (!relative || relative.includes("/")) continue;
        entries.set(relative, { name: relative, path: directory, isDirectory: true, type: "directory" });
      }
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const relative = filePath.slice(prefix.length);
        if (!relative || relative.includes("/")) continue;
        entries.set(relative, { name: relative, path: filePath, isDirectory: false, type: "file" });
      }

      return { data: { entries: Array.from(entries.values()) } };
    },
  },
};

const {
  ccp_memory_add,
  ccp_memory_approve_candidate,
  ccp_memory_ingest_summary,
  ccp_memory_list_candidates,
  ccp_memory_reject_candidate,
  onMessageProcessing,
  onPromptFinalize,
  onSummaryGenerate,
} = require("../dist/main.js");
const { previewOmbreStagingImport } = require("../dist/importer.js");
const { rebuildMemoryLibraryStats, searchMemoryLibrary } = require("../dist/browser.js");
const { createManualMemory, serializeBucketMarkdown } = require("../dist/memory-core/index.js");
const { loadMemorySettings, memorySettingsPath, saveMemorySettings } = require("../dist/settings.js");
const {
  default: memorySettingsScreen,
  settingsFromPayload,
  unwrapBridgeArgument,
} = require("../dist/ui/memory_settings/index.ui.js");
const { captureStructuredCandidates, updateMemoryCandidate } = require("../dist/candidateStore.js");
const { processPendingSmartCaptureJobs } = require("../dist/smartCapture.js");

let renderedSettingsHtml = "";
let settingsBridge = null;
const evaluatedSettingsScripts = [];
const settingsToasts = [];
const settingsController = {
  addJavascriptInterface(name, bridge) {
    if (name === "MemoryBridge") settingsBridge = bridge;
  },
  loadHtml(html) {
    renderedSettingsHtml = String(html);
  },
  async evaluateJavascript(script) {
    evaluatedSettingsScripts.push(String(script));
  },
};
const settingsNode = memorySettingsScreen({
  useMemo(_key, factory) {
    return factory();
  },
  useRef() {
    return { current: false };
  },
  createWebViewController() {
    return settingsController;
  },
  showToast(message) {
    settingsToasts.push(String(message));
  },
  UI: {
    WebView(options) {
      return options;
    },
  },
});
await settingsNode.onLoad();
const settingsScript = renderedSettingsHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
assert(settingsScript.length > 0);
assert.doesNotThrow(() => new Function(settingsScript));
assert(settingsBridge);

const canonicalSettingsPath = "C:/plugin-config/com.claude_capability_pack.memory/memory/config.json";
const legacySettingsPath = "C:/runtime-session/claude-capability-pack/memory/config.json";
ensureDirectory(legacySettingsPath.slice(0, legacySettingsPath.lastIndexOf("/")));
files.set(legacySettingsPath, JSON.stringify({ requireCharacterMatch: true, enabledCharacterNames: ["Legacy"] }));
const migratedSettings = await loadMemorySettings();
assert.equal(migratedSettings.requireCharacterMatch, true);
assert.deepEqual(migratedSettings.enabledCharacterNames, ["Legacy"]);
assert.equal(files.has(canonicalSettingsPath), true);

const bridgeSettings = settingsFromPayload(JSON.parse(unwrapBridgeArgument([JSON.stringify({
  requireCharacterMatch: true,
  smartSummaryCaptureEnabled: true,
  enabledCharacterIds: "gabe-card",
  enabledCharacterNames: "Gabe",
  maxPinnedItems: "8",
  maxRetrievalPackChars: "1888",
})])));
assert.equal(bridgeSettings.requireCharacterMatch, true);
assert.equal(bridgeSettings.smartSummaryCaptureEnabled, true);
assert.deepEqual(bridgeSettings.enabledCharacterIds, ["gabe-card"]);
assert.deepEqual(bridgeSettings.enabledCharacterNames, ["Gabe"]);
assert.equal(bridgeSettings.maxPinnedItems, 8);
assert.equal(bridgeSettings.maxRetrievalPackChars, 1888);

const savedSettings = await saveMemorySettings({
  requireCharacterMatch: true,
  enabledCharacterIds: ["gabe-card"],
  enabledCharacterNames: ["Gabe"],
  maxPinnedItems: 7,
  maxRetrievalPackChars: 1777,
});
assert.equal(savedSettings.requireCharacterMatch, true);
assert.deepEqual(savedSettings.enabledCharacterIds, ["gabe-card"]);
assert.equal(savedSettings.maxPinnedItems, 7);
assert.equal(memorySettingsPath(), canonicalSettingsPath);
const reloadedSettings = await loadMemorySettings();
assert.deepEqual(reloadedSettings, savedSettings);
const smartActionState = JSON.parse(await settingsBridge.processSmartQueue(JSON.stringify({
  ...savedSettings,
  summaryCaptureEnabled: true,
  smartSummaryCaptureEnabled: true,
  enabledCharacterIds: savedSettings.enabledCharacterIds.join(", "),
  enabledCharacterNames: savedSettings.enabledCharacterNames.join(", "),
})));
assert.equal(smartActionState.settings.summaryCaptureEnabled, true);
assert.equal(smartActionState.settings.smartSummaryCaptureEnabled, true);
const smartActionSettings = await loadMemorySettings();
assert.equal(smartActionSettings.summaryCaptureEnabled, true);
assert.equal(smartActionSettings.smartSummaryCaptureEnabled, true);

const firstAdd = await ccp_memory_add({ id: "duplicate-id", body: "first body" });
assert.equal(firstAdd.success, true);
const duplicateAdd = await ccp_memory_add({ id: "duplicate-id", body: "second body" });
assert.deepEqual(duplicateAdd, { success: false, error: "memory already exists: duplicate-id" });

const pinnedAdd = await ccp_memory_add({
  id: "pinned-id",
  body: "Pinned context",
  pinned: true,
  core_summary: "Pinned context",
});
assert.equal(pinnedAdd.success, true);

const bulkRoot = "C:/plugin-config/com.claude_capability_pack.memory/memory/buckets/dynamic/bulk";
ensureDirectory(bulkRoot);
for (let index = 0; index < 205; index += 1) {
  const bulkMemory = createManualMemory({ id: `bulk-${index}`, body: `bulk memory ${index}` });
  files.set(`${bulkRoot}/bulk-${index}.md`, serializeBucketMarkdown(bulkMemory));
}
const legacyBucketsRoot = "C:/runtime-session/claude-capability-pack/memory/buckets/dynamic/legacy";
ensureDirectory(legacyBucketsRoot);
const legacyMemory = createManualMemory({ id: "legacy-visible", body: "Legacy directory memory remains visible." });
files.set(`${legacyBucketsRoot}/legacy-visible.md`, serializeBucketMarkdown(legacyMemory));
const bulkStats = await rebuildMemoryLibraryStats();
assert.equal(bulkStats.total, 208);

await saveMemorySettings({ ...savedSettings, summaryCaptureEnabled: true });
const captured = await ccp_memory_ingest_summary({
  summary: "用户偏好：Reiko 希望长期使用简洁、直接的回复方式。",
  source_id: "runtime-summary-1",
  character_id: "gabe-card",
});
assert.equal(captured.success, true);
assert.equal(captured.data.pendingAdded, 1);
assert.equal((await rebuildMemoryLibraryStats()).total, 208);
const pending = await ccp_memory_list_candidates();
assert.equal(pending.success, true);
assert.equal(pending.data.count, 1);
const candidateId = pending.data.items[0].id;
await updateMemoryCandidate(candidateId, {
  title: "偏好：可靠且直接的回复",
  coreSummary: "Reiko希望Gabe长期保持可靠、直接的回复方式。",
  body: "记忆结论：Reiko希望Gabe长期保持可靠、直接的回复方式。\n发生经过：Reiko在设置长期交流偏好时明确提出了这一要求。",
  importance: 9,
});
const editedPending = await ccp_memory_list_candidates();
assert.equal(editedPending.data.items[0].title, "偏好：可靠且直接的回复");
assert.equal(editedPending.data.items[0].importance, 9);
assert.match(editedPending.data.items[0].body, /发生经过/);
const approved = await ccp_memory_approve_candidate({ id: candidateId });
assert.equal(approved.success, true);
assert.equal((await rebuildMemoryLibraryStats()).total, 209);
assert.equal((await ccp_memory_list_candidates()).data.count, 0);

const backgroundApprovalCapture = await captureStructuredCandidates({
  summary: "Reiko明确决定测试后台装订流程，避免设置页等待本地库写入而超时。",
  sourceId: "background-approval-regression",
  items: [{
    type: "plans",
    title: "测试后台装订流程",
    coreSummary: "Reiko决定验证后台装订不会阻塞设置页。",
    body: "Reiko明确决定验证候选记忆的后台装订流程，确保设置页立即返回，实际写入完成后再刷新状态。",
    importance: 7,
  }],
});
assert.equal(backgroundApprovalCapture.pendingAdded, 1);
const backgroundApprovalId = (await ccp_memory_list_candidates()).data.items[0].id;
fileWriteDelayMs = 180;
const backgroundApprovalState = await Promise.race([
  settingsBridge.approveCandidate(backgroundApprovalId),
  new Promise((_, reject) => setTimeout(() => reject(new Error("candidate approval blocked the bridge")), 80)),
]);
assert.match(JSON.parse(backgroundApprovalState).settingsStatus, /已提交后台装订/);
fileWriteDelayMs = 0;
for (let attempt = 0; attempt < 80 && (await ccp_memory_list_candidates()).data.count > 0; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal((await ccp_memory_list_candidates()).data.count, 0);
assert(evaluatedSettingsScripts.some((script) => script.includes("记忆装订成功")));

const searchBeforeEdit = JSON.parse(await settingsBridge.search("后台装订"));
const editableMemory = searchBeforeEdit.searchResult.items.find((item) => item.id === backgroundApprovalId);
assert(editableMemory);
assert.match(editableMemory.body, /设置页立即返回/);
assert.equal(editableMemory.coreSummary, "Reiko决定验证后台装订不会阻塞设置页。");
const editedMemoryState = JSON.parse(await settingsBridge.updateMemory(JSON.stringify({
  id: backgroundApprovalId,
  title: "后台装订不会阻塞界面",
  coreSummary: "候选装订改为后台执行，设置页不再等待写入。",
  body: "候选记忆会在后台完成装订，设置页立即返回；写入完成后，页面再自动刷新候选与记忆统计。",
  domain: "memory, ui",
  tags: "background, binding",
  importance: 8,
})));
assert.equal(editedMemoryState.searchResult.items[0].title, "后台装订不会阻塞界面");
assert.deepEqual(editedMemoryState.searchResult.items[0].domain, ["memory", "ui"]);

fileWriteDelayMs = 180;
const pinAccepted = await Promise.race([
  settingsBridge.setMemoryPinned(JSON.stringify({ id: backgroundApprovalId, pinned: true })),
  new Promise((_, reject) => setTimeout(() => reject(new Error("pin action blocked the bridge")), 80)),
]);
assert.deepEqual(JSON.parse(pinAccepted), { accepted: true, id: backgroundApprovalId, pinned: true });
await new Promise((resolve) => setTimeout(resolve, 20));
fileWriteDelayMs = 0;
for (let attempt = 0; attempt < 80; attempt += 1) {
  const result = await searchMemoryLibrary({ query: "后台装订" });
  if (result.items.find((item) => item.id === backgroundApprovalId)?.pinned) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal((await searchMemoryLibrary({ query: "后台装订" })).items.find((item) => item.id === backgroundApprovalId)?.pinned, true);
await settingsBridge.setMemoryPinned(JSON.stringify({ id: backgroundApprovalId, pinned: false }));
for (let attempt = 0; attempt < 40; attempt += 1) {
  const result = await searchMemoryLibrary({ query: "后台装订" });
  if (result.items.find((item) => item.id === backgroundApprovalId)?.pinned === false) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal((await searchMemoryLibrary({ query: "后台装订" })).items.find((item) => item.id === backgroundApprovalId)?.pinned, false);

fileWriteDelayMs = 180;
const archiveAccepted = await Promise.race([
  settingsBridge.deleteMemory(backgroundApprovalId),
  new Promise((_, reject) => setTimeout(() => reject(new Error("archive action blocked the bridge")), 80)),
]);
assert.deepEqual(JSON.parse(archiveAccepted), { accepted: true, id: backgroundApprovalId });
await new Promise((resolve) => setTimeout(resolve, 20));
fileWriteDelayMs = 0;
for (let attempt = 0; attempt < 80 && (await searchMemoryLibrary({ query: "后台装订" })).items.some((item) => item.id === backgroundApprovalId); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
assert.equal((await searchMemoryLibrary({ query: "后台装订" })).items.some((item) => item.id === backgroundApprovalId), false);
assert.equal((await searchMemoryLibrary({ query: "后台装订", includeArchive: true })).items.some((item) => item.id === backgroundApprovalId), true);

const rejectedCapture = await ccp_memory_ingest_summary({
  summary: "项目计划：后续评估一个仅用于测试的候选记忆。",
  source_id: "runtime-summary-2",
});
assert.equal(rejectedCapture.success, true);
const rejectedPending = await ccp_memory_list_candidates();
assert.equal(rejectedPending.data.count, 1);
const rejected = await ccp_memory_reject_candidate({ id: rejectedPending.data.items[0].id });
assert.equal(rejected.success, true);
assert.equal((await ccp_memory_list_candidates()).data.count, 0);
const rejectedAgain = await ccp_memory_ingest_summary({
  summary: "项目计划：后续评估一个仅用于测试的候选记忆。",
  source_id: "runtime-summary-2",
});
assert.equal(rejectedAgain.success, true);
assert.equal(rejectedAgain.data.pendingAdded, 0);
assert.equal(rejectedAgain.data.skippedItems[0].reason, "previously_rejected");
assert.equal((await ccp_memory_list_candidates()).data.count, 0);

const atomicCapture = await ccp_memory_ingest_summary({
  summary: `关系确认（#15-#20）：Claude#20回应：①“之前的关系承诺还在，不换。这个没变”；②“你可以接受我保留不同意见——这个让我松了口气”；③“如果你进入冷淡期，我会等并主动修复，不会放弃”。`,
  source_id: "runtime-summary-atomic",
  character_id: "gabe-card",
});
assert.equal(atomicCapture.success, true);
assert.equal(atomicCapture.data.pendingAdded, 3);
const atomicPending = await ccp_memory_list_candidates();
assert.equal(atomicPending.data.count, 3);
assert(atomicPending.data.items.every((item) => item.body.length <= 1600));
assert(atomicPending.data.items.every((item) => item.body.includes("发生经过：")));
assert(atomicPending.data.items.every((item) => item.body.includes("背景主题：关系确认")));
assert(atomicPending.data.items.every((item) => item.body.includes("关系承诺还在")));
assert(atomicPending.data.items.every((item) => item.body.includes("保留不同意见")));
assert(atomicPending.data.items.every((item) => item.body.includes("冷淡期")));
assert(atomicPending.data.items.every((item) => !/#\d+/.test(item.body)));
for (const item of atomicPending.data.items) {
  assert.equal((await ccp_memory_reject_candidate({ id: item.id })).success, true);
}
assert.equal((await ccp_memory_list_candidates()).data.count, 0);

await saveMemorySettings({
  ...savedSettings,
  summaryCaptureEnabled: true,
  smartSummaryCaptureEnabled: true,
});
const falsePreference = await captureStructuredCandidates({
  summary: "这是一段短暂的连接测试，用来检查摘要能力。助手简短回复确认连接正常。",
  sourceId: "quality-gate-meta-test",
  items: [{
    type: "permanent",
    title: "用户偏好简洁确认",
    coreSummary: "用户长期偏好助手采用简洁的确认风格。",
    body: "记忆结论：用户偏好简洁确认。\n发生经过：助手在测试连接时简短回复。",
    importance: 8,
  }],
});
assert.equal(falsePreference.pendingAdded, 0);
assert.equal(falsePreference.qualityRejected, 1);

const explicitPreference = await captureStructuredCandidates({
  summary: "Reiko明确表示以后一直希望回复保持可靠、直接，并且不要用夸张语气。",
  sourceId: "quality-gate-explicit-preference",
  items: [{
    type: "permanent",
    title: "长期回复风格偏好",
    coreSummary: "Reiko明确希望今后的回复保持可靠、直接，避免夸张语气。",
    body: "记忆结论：Reiko希望长期保持可靠、直接的回复风格。\n发生经过：Reiko明确提出以后一直采用这种方式。",
    importance: 8,
  }],
});
assert.equal(explicitPreference.pendingAdded, 1);
assert.equal(explicitPreference.qualityRejected, 0);
const explicitPreferencePending = await ccp_memory_list_candidates();
assert.equal(explicitPreferencePending.data.count, 1);
assert.equal((await ccp_memory_reject_candidate({ id: explicitPreferencePending.data.items[0].id })).success, true);

const rawCandidateOne = await captureStructuredCandidates({
  summary: "Reiko认为现有自动记忆过长且琐碎，希望先判断内容是否值得长期保留。",
  sourceId: "organizer-raw-1",
  items: [{
    type: "plans",
    title: "改进自动记忆价值判断",
    coreSummary: "Reiko希望自动记忆先判断长期价值。",
    body: "Reiko指出自动生成的记忆经常太长、太琐碎，其中不少内容不值得长期保存。",
    importance: 7,
  }],
});
const rawCandidateTwo = await captureStructuredCandidates({
  summary: "Reiko决定先让智能整理处理候选区，负责去重、合并和修剪，再考虑改用原始对话抽取。",
  sourceId: "organizer-raw-2",
  items: [{
    type: "plans",
    title: "先实现候选区智能整理",
    coreSummary: "Reiko决定先实现候选区的价值筛选、去重与合并。",
    body: "Reiko选择先改造候选区智能整理，让模型从已有候选中筛选价值、去重并合并同一事件。",
    importance: 8,
  }],
});
assert.equal(rawCandidateOne.pendingAdded, 1);
assert.equal(rawCandidateTwo.pendingAdded, 1);
assert.equal((await ccp_memory_list_candidates()).data.count, 2);
const organizerCandidateIds = (await ccp_memory_list_candidates()).data.items.map((item) => item.id);

let resolveBackgroundModel;
const organizerRequests = [];
chatResponder = (request) => {
  organizerRequests.push(request);
  if (organizerRequests.length === 1) {
    return new Promise((resolve) => {
      resolveBackgroundModel = resolve;
    });
  }
  return {
    aiResponse: `整理结果如下：
\`\`\`json
{
  “memories”： [
    {
      “type”： “plans”，
      “title”： “本地记忆候选整理方案”，
      “coreSummary”： “Reiko决定先用候选整理解决记忆过长、琐碎和重复的问题。”，
      “content”： “Reiko发现自动生成的记忆常常过长、琐碎，部分内容缺乏长期价值。她决定先让智能整理读取候选区，判断价值并合并同一事件，输出少量可独立回忆的候选；之后再评估是否改用原始对话抽取。”，
      “whyRemembered”： “这项决定会影响本地记忆插件后续的生成方式和质量判断。”，
      “sourceIds”： ${JSON.stringify(organizerCandidateIds)}，
      “sourceLineNumbers”： [1，2，3，4，5，6]，
      “importance”： 9，
    }，
  ]，
}
\`\`\``,
  };
};
const nonBlockingBridgeResult = await Promise.race([
  settingsBridge.processSmartQueue(JSON.stringify({
    ...savedSettings,
    summaryCaptureEnabled: true,
    smartSummaryCaptureEnabled: true,
    enabledCharacterIds: savedSettings.enabledCharacterIds.join(", "),
    enabledCharacterNames: savedSettings.enabledCharacterNames.join(", "),
  })),
  new Promise((_, reject) => setTimeout(() => reject(new Error("settings bridge waited for the model")), 100)),
]);
assert.match(JSON.parse(nonBlockingBridgeResult).settingsStatus, /已提交后台整理/);
for (let attempt = 0; attempt < 20 && typeof resolveBackgroundModel !== "function"; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.equal(typeof resolveBackgroundModel, "function");
assert.match(organizerRequests[0].message, /长期记忆的事件整理器/);
assert.match(organizerRequests[0].message, /NUMBERED_EVIDENCE_LINES_JSON/);
assert.equal(organizerRequests[0].senderName, "Memory Editor");
assert.equal(organizerRequests[0].options.persist_turn, false);
assert.equal(organizerRequests[0].options.notify_reply, false);
assert.equal(organizerRequests[0].options.hide_user_message, true);
assert.equal(organizerRequests[0].options.disable_warning, true);
resolveBackgroundModel({
  aiResponse: "<think>用户发送了一个记忆编辑器请求，要我审查一批候选。让我逐条分析这些候选是否值得长期存储。",
});
for (let attempt = 0; attempt < 20 && (await ccp_memory_list_candidates()).data.count === 2; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
const backgroundPending = await ccp_memory_list_candidates();
assert.equal(backgroundPending.data.count, 1);
assert.equal(organizerRequests.length, 2);
assert.equal(organizerRequests[1].senderName, "Memory Formatter");
assert.match(organizerRequests[1].message, /重新完成事件拆分和长期价值判断/);
assert.equal(backgroundPending.data.items[0].title, "本地记忆候选整理方案");
assert.match(backgroundPending.data.items[0].body, /候选区/);
assert(evaluatedSettingsScripts.some((script) => script.includes("MemoryArchive.setState")));

chatResponder = async () => ({ aiResponse: "not-json" });
const countBeforeFailedOrganization = (await ccp_memory_list_candidates()).data.count;
await settingsBridge.processSmartQueue(JSON.stringify({
  ...savedSettings,
  summaryCaptureEnabled: true,
  smartSummaryCaptureEnabled: true,
  enabledCharacterIds: savedSettings.enabledCharacterIds.join(", "),
  enabledCharacterNames: savedSettings.enabledCharacterNames.join(", "),
}));
for (let attempt = 0; attempt < 20 && !evaluatedSettingsScripts.some((script) => script.includes("智能整理失败")); attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
assert.equal((await ccp_memory_list_candidates()).data.count, countBeforeFailedOrganization);
assert(evaluatedSettingsScripts.some((script) => script.includes("智能整理失败")));
assert.deepEqual(await onMessageProcessing({ eventPayload: { probeOnly: true } }), { matched: false });
const locallyOrganizedPending = await ccp_memory_list_candidates();
assert.equal((await ccp_memory_reject_candidate({ id: locallyOrganizedPending.data.items[0].id })).success, true);

const mixedCapture = await captureStructuredCandidates({
  summary: "一次摘要同时记录了关系表达、GitHub 项目和对认可的需要。",
  sourceId: "organizer-mixed-regression",
  items: [{
    type: "dynamic",
    title: "多主题混合候选",
    coreSummary: "候选中混有三个彼此独立的话题。",
    body: [
      "① Reiko希望Gabe理解，她不是没有热情，而是热情会出现在不同地方和时刻。",
      "② Reiko完成了一个准备发布到GitHub的本地记忆插件项目，并开始处理发布工作。",
      "③ Reiko明确说自己希望付出的努力能被看见和认可，这种认可需求对她很重要。",
    ].join("\n"),
    importance: 8,
  }],
});
assert.equal(mixedCapture.pendingAdded, 1);
const mixedCandidate = (await ccp_memory_list_candidates()).data.items[0];
let mixedAttempt = 0;
chatResponder = async () => {
  mixedAttempt += 1;
  if (mixedAttempt === 1) {
    return {
      aiResponse: JSON.stringify({ memories: [{
        type: "dynamic",
        title: "Reiko近期的重要话题",
        coreSummary: "Reiko谈到了关系、GitHub项目和认可需求。",
        content: "① Reiko希望Gabe理解她的热情表达。② Reiko完成了准备发布到GitHub的插件项目。③ Reiko希望自己的努力得到认可。项目是什么？为什么需要认可？这些仍需继续分析。",
        whyRemembered: "这些话题都很重要，值得以后继续理解。",
        sourceIds: [mixedCandidate.id],
        sourceLineNumbers: [3, 4, 5],
        importance: 8,
      }] }),
    };
  }
  return {
    aiResponse: JSON.stringify({ memories: [
      {
        type: "feel",
        title: "热情会出现在不同地方和时刻",
        coreSummary: "Reiko希望Gabe理解她的热情具有不同的表达时机和对象。",
        content: "Reiko明确告诉Gabe，她并不是缺少热情，只是热情会出现在不同的地方和时刻；她希望Gabe理解这种表达差异，而不是把它误解成冷淡。",
        whyRemembered: "这会影响Gabe以后如何理解Reiko的情感表达，避免把表达方式不同误判为关系降温。",
        sourceIds: [mixedCandidate.id],
        sourceLineNumbers: [3],
        importance: 8,
      },
      {
        type: "dynamic",
        title: "本地记忆插件准备发布到GitHub",
        coreSummary: "Reiko完成了本地记忆插件项目，并开始处理GitHub发布。",
        content: "Reiko完成了一个本地记忆插件项目，并开始准备将它发布到GitHub。这是项目从个人开发转向公开发布的重要进展。",
        whyRemembered: "这记录了Reiko长期项目的明确阶段变化，未来讨论维护、版本更新或推广时需要这个背景。",
        sourceIds: [mixedCandidate.id],
        sourceLineNumbers: [4],
        importance: 7,
      },
      {
        type: "permanent",
        title: "希望付出的努力被看见",
        coreSummary: "Reiko明确希望自己的努力能够被看见和认可。",
        content: "Reiko明确表达，她希望自己投入的努力能够被看见和认可；这种认可对她而言不是泛泛的赞美，而是确认她实际付出的时间和完成的成果。",
        whyRemembered: "这项稳定需求会影响未来回应Reiko成果和付出时应关注的重点，有助于给出具体而非空泛的认可。",
        sourceIds: [mixedCandidate.id],
        sourceLineNumbers: [5],
        importance: 8,
      },
    ] }),
  };
};
const mixedResult = await processPendingSmartCaptureJobs({ maxCandidates: 6 });
assert.equal(mixedResult.outputCandidates, 3);
assert.equal(mixedAttempt, 2);
const splitMemories = (await ccp_memory_list_candidates()).data.items;
assert.equal(splitMemories.length, 3);
assert(splitMemories.every((item) => !(/[？?]/.test(item.body))));
assert(splitMemories.every((item) => !(item.body.includes("GitHub") && item.body.includes("认可"))));
assert(splitMemories.some((item) => item.title.includes("GitHub")));
assert(splitMemories.some((item) => item.title.includes("努力被看见")));
for (const item of splitMemories) {
  assert.equal((await ccp_memory_reject_candidate({ id: item.id })).success, true);
}

const newlineCapture = await captureStructuredCandidates({
  summary: "Reiko决定完成当前版本后，将本地记忆插件作为公开项目继续维护。",
  sourceId: "organizer-json-newline-regression",
  items: [{
    type: "plans",
    title: "继续维护本地记忆插件",
    coreSummary: "Reiko决定把本地记忆插件作为公开项目继续维护。",
    body: "Reiko决定完成当前版本后继续维护本地记忆插件，并把后续改进作为公开项目的一部分。",
    importance: 8,
  }],
});
assert.equal(newlineCapture.pendingAdded, 1);
chatResponder = async () => ({
  aiResponse: '{"memories":[{"title":"继续维护本地记忆插件","content":"Reiko决定完成当前版本后继续维护本地记忆插件。' + String.fromCharCode(10) + '后续质量改进会作为公开项目的一部分持续进行。","why":"这项明确决定能帮助未来理解项目仍在持续维护，而不是一次性完成后停止。","lines":[1,2,3],"type":"plans","importance":8}]}',
});
const newlineResult = await processPendingSmartCaptureJobs({ maxCandidates: 1 });
assert.equal(newlineResult.outputCandidates, 1);
const newlinePending = (await ccp_memory_list_candidates()).data.items;
assert.equal(newlinePending.length, 1);
assert.match(newlinePending[0].body, /持续进行/);
assert.equal((await ccp_memory_reject_candidate({ id: newlinePending[0].id })).success, true);
await saveMemorySettings({ ...savedSettings, summaryCaptureEnabled: true, smartSummaryCaptureEnabled: false });

const hookResult = await onPromptFinalize({
  eventName: "before_send_to_model",
  eventPayload: {
    stage: "before_send_to_model",
    rawInput: "raw current message",
    processedInput: "processed current message",
    preparedHistory: [{ kind: "USER", content: "raw current message" }],
    metadata: { activePrompt: { type: "character_card", id: "gabe-card", name: "Gabe" } },
  },
});
assert.equal(typeof hookResult, "object");
assert.match(hookResult.processedInput, /\[Core memory\]/);
assert.equal("preparedHistory" in hookResult, false);

const historicalAdd = await ccp_memory_add({
  id: "historical-medication-id",
  body: "过去某次对话中，Reiko提到前天调整过药物剂量。",
  core_summary: "Reiko曾在过去的对话中提到调整药物剂量。",
  tags: ["药物剂量", "historical"],
});
assert.equal(historicalAdd.success, true);
const historicalHookResult = await onPromptFinalize({
  eventName: "before_send_to_model",
  eventPayload: {
    stage: "before_send_to_model",
    rawInput: "还记得药物剂量那件事吗？",
    processedInput: "还记得药物剂量那件事吗？",
    preparedHistory: [{ kind: "USER", content: "还记得药物剂量那件事吗？" }],
    metadata: { activePrompt: { type: "character_card", id: "gabe-card", name: "Gabe" } },
  },
});
assert.match(historicalHookResult.processedInput, /\[Temporary memory context\]/);
assert.match(historicalHookResult.processedInput, /从过往对话或事件中检索出的历史记忆/);
assert.match(historicalHookResult.processedInput, /不代表当前状态/);
assert.match(historicalHookResult.processedInput, /\[过去的记忆\]/);
const blockedHookResult = await onPromptFinalize({
  eventName: "before_send_to_model",
  eventPayload: {
    stage: "before_send_to_model",
    rawInput: "raw current message",
    processedInput: "processed current message",
    preparedHistory: [{ kind: "USER", content: "raw current message" }],
    metadata: { activePrompt: { type: "character_card", id: "other-card", name: "Other" } },
  },
});
assert.equal(blockedHookResult, null);

const stagingRoot = "C:/staging";
ensureDirectory(stagingRoot);
const duplicateSource = createManualMemory({ id: "staging-duplicate", body: "staging body" });
files.set(`${stagingRoot}/one.md`, serializeBucketMarkdown(duplicateSource));
files.set(`${stagingRoot}/two.md`, serializeBucketMarkdown({ ...duplicateSource, title: "duplicate copy" }));

const preview = await previewOmbreStagingImport(stagingRoot);
assert.equal(preview.valid, 2);
assert.equal(preview.newCount, 1);
assert.equal(preview.duplicateCount, 1);

await assert.rejects(
  previewOmbreStagingImport("C:/plugin-config/com.claude_capability_pack.memory"),
  /must not overlap the active memory bucket directory/
);

console.log("memory-toolpkg runtime tests ok");
