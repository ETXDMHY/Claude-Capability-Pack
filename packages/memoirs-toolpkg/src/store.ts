import { memoirsDataPath, parentDir } from "./paths";
import type { MemoirsData, MemoirsSettings } from "./types";

export const DEFAULT_SETTINGS: MemoirsSettings = {
  maxPages: 120,
  cooldownDays: 30,
  minBodyChars: 20,
  excludeResolved: true,
  excludeDigested: false,
  chatBinding: "current",
  fixedChatId: "",
  autoInvitationEnabled: false,
  invitationIdleMinutes: 30,
};

export function defaultData(): MemoirsData {
  return {
    version: 4,
    dailyBooks: {},
    readingHistory: {},
    annotations: {},
    readingSessions: [],
    eventStates: {},
    settings: { ...DEFAULT_SETTINGS },
    activity: {},
    chatContexts: [],
    workflow: {},
  };
}

export async function loadData(): Promise<MemoirsData> {
  try {
    const parsed = JSON.parse(readText(await Tools.Files.read(memoirsDataPath()))) as Partial<MemoirsData>;
    return normalizeData(parsed);
  } catch (_error) {
    return defaultData();
  }
}

export async function saveData(data: MemoirsData): Promise<void> {
  const path = memoirsDataPath();
  await Tools.Files.mkdir(parentDir(path), true);
  await Tools.Files.write(path, JSON.stringify(normalizeData(data), null, 2), false);
}

function normalizeData(input: Partial<MemoirsData>): MemoirsData {
  const base = defaultData();
  const requiresBookReset = Number(input.version || 0) < 2;
  return {
    version: 4,
    dailyBooks: requiresBookReset ? {} : objectValue(input.dailyBooks),
    readingHistory: objectValue(input.readingHistory),
    annotations: objectValue(input.annotations),
    readingSessions: Array.isArray(input.readingSessions) ? input.readingSessions : [],
    eventStates: requiresBookReset ? {} : objectValue(input.eventStates),
    settings: {
      maxPages: bounded(input.settings?.maxPages, 2, 500, base.settings.maxPages),
      cooldownDays: bounded(input.settings?.cooldownDays, 0, 365, base.settings.cooldownDays),
      minBodyChars: bounded(input.settings?.minBodyChars, 0, 1000, base.settings.minBodyChars),
      excludeResolved: input.settings?.excludeResolved !== false,
      excludeDigested: input.settings?.excludeDigested === true,
      chatBinding: input.settings?.chatBinding === "fixed" ? "fixed" : "current",
      fixedChatId: String(input.settings?.fixedChatId || "").trim(),
      autoInvitationEnabled: input.settings?.autoInvitationEnabled === true,
      invitationIdleMinutes: bounded(input.settings?.invitationIdleMinutes, 15, 240, base.settings.invitationIdleMinutes),
    },
    activity: objectValue(input.activity),
    chatContexts: Array.isArray(input.chatContexts) ? input.chatContexts : [],
    workflow: input.workflow && typeof input.workflow === "object" ? input.workflow : {},
  };
}

function objectValue<T>(value: T | undefined): T {
  return (value && typeof value === "object" ? value : {}) as T;
}

function bounded(value: number | undefined, min: number, max: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value as number))) : fallback;
}

function readText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["content", "data", "text", "result", "value"]) {
    const nested = readText(record[key]);
    if (nested) return nested;
  }
  return "";
}
