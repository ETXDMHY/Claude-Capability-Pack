declare function require(name: string): unknown;

import { createLocalMemoryStore } from "./localStore";
import { memoryConfigRoot } from "./settings";

export interface MemoryCandidateRecord {
  id: string;
  sourceLine: string;
  createdAt: string;
  pinOnApprove: boolean;
  memory: Record<string, unknown>;
}

interface CandidateQueueFile {
  version: number;
  updatedAt: string;
  items: MemoryCandidateRecord[];
}

const { createManualMemory, extractMemoriesFromSummary } = require("./memory-core/index") as {
  createManualMemory: (input: Record<string, unknown>) => Record<string, unknown>;
  extractMemoriesFromSummary: (
    summary: string,
    options?: Record<string, unknown>
  ) => Array<{ sourceLine: string; memory: Record<string, unknown> }>;
};

const QUEUE_VERSION = 1;

export async function captureSummaryCandidates(params: {
  summary: string;
  sourceId?: string;
  chatId?: string;
  characterId?: string;
  projectId?: string;
  pinOnApprove?: boolean;
}): Promise<Record<string, unknown>> {
  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  const queue = await readCandidateQueue();
  const activeIds = new Set(loaded.buckets.map((bucket) => textOf(bucket.id)));
  const activeSummaries = new Set(
    loaded.buckets
      .map((bucket) => textOf((bucket as unknown as Record<string, unknown>).coreSummary).trim())
      .filter(Boolean)
  );
  const pendingIds = new Set(queue.map((item) => item.id));
  const pendingSummaries = new Set(queue.map((item) => textOf(item.memory.coreSummary).trim()).filter(Boolean));
  const extracted = extractMemoriesFromSummary(params.summary, {
    sourceId: params.sourceId,
    pinCore: false,
    scope: {
      chatId: params.chatId,
      characterId: params.characterId,
      projectId: params.projectId,
    },
  });

  const added: MemoryCandidateRecord[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const candidate of extracted) {
    const id = textOf(candidate.memory.id);
    const coreSummary = textOf(candidate.memory.coreSummary).trim();
    if (activeIds.has(id) || (coreSummary && activeSummaries.has(coreSummary))) {
      skipped.push({ id, reason: "already_active" });
      continue;
    }
    if (pendingIds.has(id) || (coreSummary && pendingSummaries.has(coreSummary))) {
      skipped.push({ id, reason: "already_pending" });
      continue;
    }
    const record: MemoryCandidateRecord = {
      id,
      sourceLine: candidate.sourceLine,
      createdAt: new Date().toISOString(),
      pinOnApprove: Boolean(params.pinOnApprove),
      memory: { ...candidate.memory, pinned: false },
    };
    queue.push(record);
    added.push(record);
    pendingIds.add(id);
    if (coreSummary) pendingSummaries.add(coreSummary);
  }

  if (added.length) await writeCandidateQueue(queue);
  return {
    candidates: extracted.length,
    pendingAdded: added.length,
    skipped: skipped.length,
    pendingTotal: queue.length,
    items: added.map(summarizeCandidate),
    skippedItems: skipped,
  };
}

export async function listMemoryCandidates(): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
  const items = await readCandidateQueue();
  return { count: items.length, items: items.map(summarizeCandidate) };
}

export async function approveMemoryCandidate(
  id: string,
  options: { pin?: boolean } = {}
): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  const candidate = queue.find((item) => item.id === id);
  if (!candidate) throw new Error(`candidate not found: ${id}`);

  const store = createLocalMemoryStore();
  const loaded = await store.loadBuckets();
  if (loaded.buckets.some((bucket) => textOf(bucket.id) === id)) {
    await writeCandidateQueue(queue.filter((item) => item.id !== id));
    return { id, approved: false, duplicate: true };
  }

  const pinned = options.pin ?? candidate.pinOnApprove;
  const bucket = createManualMemory({
    ...candidate.memory,
    pinned,
    pinnedOrder: pinned ? 1000 : candidate.memory.pinnedOrder,
  });
  const path = await store.writeBucket(bucket as never);
  await writeCandidateQueue(queue.filter((item) => item.id !== id));
  return { id, approved: true, pinned, path };
}

export async function rejectMemoryCandidate(id: string): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  if (!queue.some((item) => item.id === id)) throw new Error(`candidate not found: ${id}`);
  await writeCandidateQueue(queue.filter((item) => item.id !== id));
  return { id, rejected: true };
}

export async function updateMemoryCandidate(
  id: string,
  input: { title?: unknown; body?: unknown; coreSummary?: unknown; importance?: unknown }
): Promise<Record<string, unknown>> {
  const queue = await readCandidateQueue();
  const candidate = queue.find((item) => item.id === id);
  if (!candidate) throw new Error(`candidate not found: ${id}`);

  const title = textOf(input.title).trim();
  const body = textOf(input.body).trim();
  const coreSummary = textOf(input.coreSummary).trim();
  if (!title) throw new Error("candidate title is required");
  if (!body) throw new Error("candidate body is required");
  if (!coreSummary) throw new Error("candidate core summary is required");

  const parsedImportance = Number.parseInt(textOf(input.importance), 10);
  candidate.memory = {
    ...candidate.memory,
    title: title.slice(0, 80),
    body: body.slice(0, 1200),
    coreSummary: coreSummary.slice(0, 160),
    importance: Number.isFinite(parsedImportance)
      ? Math.max(1, Math.min(10, parsedImportance))
      : candidate.memory.importance,
  };
  await writeCandidateQueue(queue);
  return { id, updated: true, candidate: summarizeCandidate(candidate) };
}

function summarizeCandidate(candidate: MemoryCandidateRecord): Record<string, unknown> {
  return {
    id: candidate.id,
    sourceLine: candidate.sourceLine,
    createdAt: candidate.createdAt,
    pinOnApprove: candidate.pinOnApprove,
    type: candidate.memory.type,
    title: candidate.memory.title,
    body: candidate.memory.body,
    coreSummary: candidate.memory.coreSummary,
    domain: candidate.memory.domain,
    tags: candidate.memory.tags,
    importance: candidate.memory.importance,
  };
}

async function readCandidateQueue(): Promise<MemoryCandidateRecord[]> {
  try {
    const result = await Tools.Files.read(candidateQueuePath());
    const text = readText(result);
    if (!text.trim()) return [];
    const parsed = JSON.parse(text) as CandidateQueueFile;
    return parsed.version === QUEUE_VERSION && Array.isArray(parsed.items) ? parsed.items : [];
  } catch (_error) {
    return [];
  }
}

async function writeCandidateQueue(items: MemoryCandidateRecord[]): Promise<void> {
  const path = candidateQueuePath();
  await Tools.Files.mkdir(parentDir(path), true);
  const payload: CandidateQueueFile = {
    version: QUEUE_VERSION,
    updatedAt: new Date().toISOString(),
    items,
  };
  await Tools.Files.write(path, JSON.stringify(payload, null, 2), false);
}

function candidateQueuePath(): string {
  return joinPath(memoryConfigRoot(), "memory/candidates/pending.json");
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["data", "content", "text", "result", "value"]) {
    const nested = readText(record[key]);
    if (nested) return nested;
  }
  return "";
}

function parentDir(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

function joinPath(base: string, child: string): string {
  return `${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function textOf(value: unknown): string {
  return value == null ? "" : String(value);
}
