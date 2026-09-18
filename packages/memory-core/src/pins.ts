import { clampText } from "./text";
import { MemoryBucket, MemoryScope, PinnedScope } from "./types";

export interface PinOptions {
  scope?: PinnedScope;
  order?: number;
  coreSummary?: string;
  currentScope?: MemoryScope;
}
export function pinBucket(bucket: MemoryBucket, options: PinOptions = {}): MemoryBucket {
  const pinnedScope = options.scope || bucket.pinnedScope || "global";
  return {
    ...bucket,
    pinned: true,
    pinnedScope,
    pinnedOrder: options.order ?? bucket.pinnedOrder ?? 1000,
    coreSummary: clampText(options.coreSummary || bucket.coreSummary || bucket.body, 80),
    characterId: pinnedScope === "character" ? options.currentScope?.characterId || bucket.characterId : bucket.characterId,
    chatId: pinnedScope === "chat" ? options.currentScope?.chatId || bucket.chatId : bucket.chatId,
    projectId: pinnedScope === "project" ? options.currentScope?.projectId || bucket.projectId : bucket.projectId,
  };
}

export function unpinBucket(bucket: MemoryBucket): MemoryBucket {
  return {
    ...bucket,
    pinned: false,
  };
}

export function listPinnedBuckets(buckets: MemoryBucket[], scope: MemoryScope = {}): MemoryBucket[] {
  return buckets
    .filter((bucket) => bucket.pinned)
    .filter((bucket) => {
      if (bucket.pinnedScope === "global") {
        return true;
      }
      if (bucket.pinnedScope === "character") {
        return Boolean(bucket.characterId && bucket.characterId === scope.characterId);
      }
      if (bucket.pinnedScope === "chat") {
        return Boolean(bucket.chatId && bucket.chatId === scope.chatId);
      }
      if (bucket.pinnedScope === "project") {
        return Boolean(bucket.projectId && bucket.projectId === scope.projectId);
      }
      return true;
    })
    .sort((left, right) => {
      if (left.pinnedOrder !== right.pinnedOrder) {
        return left.pinnedOrder - right.pinnedOrder;
      }
      return right.importance - left.importance;
    });
}
