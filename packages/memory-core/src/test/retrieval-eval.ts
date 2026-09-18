import { buildMemoryPack, buildQueries, createManualMemory, MemoryBucket } from "../index";

interface EvalCase {
  name: string;
  input: string;
  recentContext?: string;
  expectedId?: string;
}

function memory(id: string, body: string, tags: string[] = [], importance = 6): MemoryBucket {
  return createManualMemory({
    id,
    body,
    title: body.slice(0, 32),
    tags,
    importance,
    coreSummary: body,
    now: "2026-09-17T00:00:00.000Z",
  });
}

const buckets = [
  memory("qixi", "七夕时，Reiko 和 Gabe 约定一起挑选具有纪念意义的礼物。", ["七夕", "约定"], 9),
  memory("hospital", "医院陪护期间需要延续此前确认的作息和照护安排。", ["医院陪护", "照护"], 8),
  memory("operit", "Claude Capability Pack 的本地记忆使用 Markdown buckets，并在发送前召回。", ["Operit", "memory"], 8),
  memory("food", "Reiko 某天晚餐吃了牛肉。", ["饮食"], 3),
  memory("visual", "本地记忆界面采用雾紫、透明纸和银扣装订结构。", ["界面", "视觉"], 6),
];

const cases: EvalCase[] = [
  { name: "explicit-history", input: "还记得七夕的约定吗？", expectedId: "qixi" },
  { name: "known-entity", input: "继续 Operit 记忆项目", expectedId: "operit" },
  { name: "reference-with-context", input: "之前那个后来怎么安排？", recentContext: "我们谈到医院陪护和作息。", expectedId: "hospital" },
  { name: "new-daily-topic", input: "我今天吃了牛肉。" },
  { name: "no-reliable-result", input: "还记得量子葡萄温室吗？" },
];

let reciprocalRank = 0;
let expectedCases = 0;
let hitAt3 = 0;
let falsePositives = 0;
const details: Array<Record<string, unknown>> = [];

for (const item of cases) {
  const queries = buildQueries(item.input, item.recentContext || "");
  const pack = buildMemoryPack(buckets, queries, {}, { maxPinnedItems: 0, maxRetrievalItems: 3 });
  const ids = pack.retrievalItems.map((result) => result.bucket.id);
  if (item.expectedId) {
    expectedCases += 1;
    const rank = ids.indexOf(item.expectedId) + 1;
    if (rank > 0 && rank <= 3) hitAt3 += 1;
    if (rank > 0) reciprocalRank += 1 / rank;
  } else if (ids.length) {
    falsePositives += 1;
  }
  details.push({ name: item.name, queries: queries.map((query) => query.text), ids });
}

const metrics = {
  hitAt3: expectedCases ? hitAt3 / expectedCases : 1,
  mrr: expectedCases ? reciprocalRank / expectedCases : 1,
  falsePositives,
  cases: details,
};

if (metrics.hitAt3 !== 1) throw new Error(`retrieval Hit@3 regression: ${JSON.stringify(metrics)}`);
if (metrics.mrr < 0.8) throw new Error(`retrieval MRR regression: ${JSON.stringify(metrics)}`);
if (metrics.falsePositives !== 0) throw new Error(`retrieval false positive regression: ${JSON.stringify(metrics)}`);

console.log(`memory retrieval eval ok ${JSON.stringify(metrics)}`);
