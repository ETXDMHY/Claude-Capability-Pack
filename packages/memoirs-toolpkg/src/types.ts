export type MemoryType = "dynamic" | "permanent" | "feel" | "plans" | "archive";

export interface MemoryBucket {
  id: string;
  type: MemoryType;
  domain: string[];
  tags: string[];
  title?: string;
  body: string;
  coreSummary?: string;
  createdAt?: string;
  updatedAt?: string;
  importance: number;
  resolved: boolean;
  digested: boolean;
  pinned: boolean;
  characterId?: string;
  chatId?: string;
  projectId?: string;
  filePath?: string;
}

export interface MemoirScope {
  chatId?: string;
  characterId?: string;
  projectId?: string;
}

export interface DailyBook {
  id: string;
  date: string;
  createdAt: string;
  scope: MemoirScope;
  pages: string[];
  sourceCount: number;
}

export interface ReadingHistoryEntry {
  memoryId: string;
  lastReadAt: string;
  readCount: number;
  selectedByUser: number;
  selectedByAssistant: number;
}

export interface Annotation {
  id: string;
  memoryId: string;
  author: "user" | "assistant";
  authorName: string;
  date: string;
  content: string;
  sessionId?: string;
}

export interface ReadingSession {
  id: string;
  date: string;
  readAt: string;
  userPage: number;
  assistantPage: number;
  items: Array<{
    memoryId: string;
    page: number;
    selectedBy: Array<"user" | "assistant">;
  }>;
}

export type EventStatus = "not_triggered" | "accepted" | "skipped" | "completed";

export interface EventState {
  date: string;
  chatId?: string;
  status: EventStatus;
  userPage?: number;
  assistantPage?: number;
  updatedAt: string;
}

export interface MemoirsSettings {
  maxPages: number;
  cooldownDays: number;
  minBodyChars: number;
  excludeResolved: boolean;
  excludeDigested: boolean;
  chatBinding: "current" | "fixed";
  fixedChatId: string;
  autoInvitationEnabled: boolean;
  invitationIdleMinutes: number;
}

export interface PendingChatContext {
  id: string;
  kind: "invitation" | "reading";
  chatId: string;
  date: string;
  sessionId?: string;
  status: "pending" | "in_flight" | "consumed" | "cancelled";
  createdAt: string;
  injectedAt?: string;
  leaseUntil?: string;
  consumedAt?: string;
}

export interface MemoirsData {
  version: 4;
  dailyBooks: Record<string, DailyBook>;
  readingHistory: Record<string, ReadingHistoryEntry>;
  annotations: Record<string, Annotation[]>;
  readingSessions: ReadingSession[];
  eventStates: Record<string, EventState>;
  settings: MemoirsSettings;
  activity: Record<string, { lastUserAt?: number; lastAssistantAt?: number; roleName?: string }>;
  chatContexts: PendingChatContext[];
  workflow: { id?: string; installedAt?: string };
}
