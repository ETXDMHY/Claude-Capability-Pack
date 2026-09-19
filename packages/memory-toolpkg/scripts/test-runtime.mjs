import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const files = new Map();
const directories = new Set();

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
  Files: {
    async mkdir(path) {
      ensureDirectory(path);
      return { success: true };
    },
    async write(path, content) {
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
  onPromptFinalize,
} = require("../dist/main.js");
const { previewOmbreStagingImport } = require("../dist/importer.js");
const { rebuildMemoryLibraryStats } = require("../dist/browser.js");
const { createManualMemory, serializeBucketMarkdown } = require("../dist/memory-core/index.js");
const { loadMemorySettings, memorySettingsPath, saveMemorySettings } = require("../dist/settings.js");
const { settingsFromPayload, unwrapBridgeArgument } = require("../dist/ui/memory_settings/index.ui.js");
const { updateMemoryCandidate } = require("../dist/candidateStore.js");

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
  enabledCharacterIds: "gabe-card",
  enabledCharacterNames: "Gabe",
  maxPinnedItems: "8",
  maxRetrievalPackChars: "1888",
})])));
assert.equal(bridgeSettings.requireCharacterMatch, true);
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
