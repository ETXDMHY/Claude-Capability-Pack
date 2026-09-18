import { clampText } from "./text";
import { BucketType, MemoryBucket, PinnedScope } from "./types";

export interface CreateMemoryInput {
  id: string;
  body: string;
  type?: BucketType;
  domain?: string[];
  tags?: string[];
  title?: string;
  importance?: number;
  source?: string;
  sourceId?: string;
  now?: string;
  pinned?: boolean;
  pinnedOrder?: number;
  pinnedScope?: PinnedScope;
  characterId?: string;
  chatId?: string;
  projectId?: string;
  coreSummary?: string;
}

export interface UpdateMemoryInput {
  body?: string;
  domain?: string[];
  tags?: string[];
  title?: string;
  importance?: number;
  resolved?: boolean;
  digested?: boolean;
  coreSummary?: string;
  now?: string;
}

export function createManualMemory(input: CreateMemoryInput): MemoryBucket {
  const now = input.now || new Date().toISOString();
  const body = input.body.trim();
  if (!input.id.trim()) {
    throw new Error("memory id is required");
  }
  if (!body) {
    throw new Error("memory body is required");
  }

  return {
    id: input.id.trim(),
    type: input.type || "dynamic",
    domain: input.domain || [],
    tags: input.tags || [],
    createdAt: now,
    updatedAt: now,
    lastActiveAt: null,
    activationCount: 0,
    importance: clampImportance(input.importance ?? 5),
    resolved: false,
    digested: false,
    pinned: Boolean(input.pinned),
    pinnedOrder: input.pinnedOrder ?? 1000,
    pinnedScope: input.pinnedScope || "global",
    characterId: input.characterId,
    chatId: input.chatId,
    projectId: input.projectId,
    source: input.source || "manual",
    sourceId: input.sourceId,
    coreSummary: input.coreSummary ? clampText(input.coreSummary, 80) : undefined,
    title: input.title,
    body,
  };
}

export function updateMemory(bucket: MemoryBucket, input: UpdateMemoryInput): MemoryBucket {
  const nextBody = input.body == null ? bucket.body : input.body.trim();
  if (!nextBody) {
    throw new Error("memory body is required");
  }

  return {
    ...bucket,
    body: nextBody,
    domain: input.domain ?? bucket.domain,
    tags: input.tags ?? bucket.tags,
    title: input.title ?? bucket.title,
    importance: input.importance == null ? bucket.importance : clampImportance(input.importance),
    resolved: input.resolved ?? bucket.resolved,
    digested: input.digested ?? bucket.digested,
    coreSummary: input.coreSummary == null ? bucket.coreSummary : clampText(input.coreSummary, 80),
    updatedAt: input.now || new Date().toISOString(),
  };
}

export function archiveMemory(bucket: MemoryBucket, now = new Date().toISOString()): MemoryBucket {
  return {
    ...bucket,
    type: "archive",
    pinned: false,
    updatedAt: now,
  };
}

export function markMemoryActive(bucket: MemoryBucket, now = new Date().toISOString()): MemoryBucket {
  return {
    ...bucket,
    activationCount: bucket.activationCount + 1,
    lastActiveAt: now,
    updatedAt: now,
  };
}

export function makeMemoryId(seed: string, now = new Date().toISOString()): string {
  const text = `${seed}:${now}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `m_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function clampImportance(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(value)));
}
