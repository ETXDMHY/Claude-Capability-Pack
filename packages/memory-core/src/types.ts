export type BucketType = "dynamic" | "permanent" | "feel" | "plans" | "archive";

export type PinnedScope = "global" | "character" | "chat" | "project";

export interface MemoryBucket {
  id: string;
  type: BucketType;
  domain: string[];
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
  lastActiveAt?: string | null;
  activationCount: number;
  importance: number;
  valence?: number;
  arousal?: number;
  resolved: boolean;
  digested: boolean;
  pinned: boolean;
  pinnedOrder: number;
  pinnedScope: PinnedScope;
  characterId?: string;
  chatId?: string;
  projectId?: string;
  source?: string;
  sourceId?: string;
  coreSummary?: string;
  title?: string;
  body: string;
  filePath?: string;
}

export interface MemoryScope {
  characterId?: string;
  chatId?: string;
  projectId?: string;
}

export interface MemoryQuery {
  kind: "explicit" | "entity" | "reference";
  text: string;
}

export interface TokenBudgetSettings {
  maxPinnedItems: number;
  maxPinnedCharsPerItem: number;
  maxPinnedPackChars: number;
  maxRetrievalItems: number;
  maxRetrievalCharsPerItem: number;
  maxRetrievalPackChars: number;
}

export interface RankedMemory {
  bucket: MemoryBucket;
  score: number;
  reasons: string[];
  summary: string;
}

export interface MemoryPackResult {
  coreText: string;
  retrievalText: string;
  coreItems: RankedMemory[];
  retrievalItems: RankedMemory[];
}

export const DEFAULT_TOKEN_BUDGET: TokenBudgetSettings = {
  maxPinnedItems: 3,
  maxPinnedCharsPerItem: 80,
  maxPinnedPackChars: 300,
  maxRetrievalItems: 3,
  maxRetrievalCharsPerItem: 120,
  maxRetrievalPackChars: 600,
};
