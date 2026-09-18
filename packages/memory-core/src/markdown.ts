import { BucketType, MemoryBucket, PinnedScope } from "./types";

type FrontmatterValue = string | number | boolean | null | string[];

const TYPE_VALUES = new Set<BucketType>(["dynamic", "permanent", "feel", "plans", "archive"]);
const PINNED_SCOPE_VALUES = new Set<PinnedScope>(["global", "character", "chat", "project"]);

export function parseBucketMarkdown(input: string, filePath?: string): MemoryBucket {
  const match = input.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(`Missing frontmatter${filePath ? ` in ${filePath}` : ""}`);
  }

  const meta = parseFrontmatter(match[1]);
  const body = match[2].trim();
  const id = readString(meta, "id") || inferIdFromPath(filePath);
  if (!id) {
    throw new Error(`Missing memory id${filePath ? ` in ${filePath}` : ""}`);
  }

  const rawType = readString(meta, "type") || "dynamic";
  const type = TYPE_VALUES.has(rawType as BucketType) ? (rawType as BucketType) : "dynamic";
  const rawPinnedScope = readString(meta, "pinned_scope") || "global";
  const pinnedScope = PINNED_SCOPE_VALUES.has(rawPinnedScope as PinnedScope)
    ? (rawPinnedScope as PinnedScope)
    : "global";

  return {
    id,
    type,
    domain: readStringArray(meta, "domain"),
    tags: readStringArray(meta, "tags"),
    createdAt: readString(meta, "created_at"),
    updatedAt: readString(meta, "updated_at"),
    lastActiveAt: readNullableString(meta, "last_active_at"),
    activationCount: readNumber(meta, "activation_count", 0),
    importance: readNumber(meta, "importance", 1),
    valence: readOptionalNumber(meta, "valence"),
    arousal: readOptionalNumber(meta, "arousal"),
    resolved: readBoolean(meta, "resolved", false),
    digested: readBoolean(meta, "digested", false),
    pinned: readBoolean(meta, "pinned", false),
    pinnedOrder: readNumber(meta, "pinned_order", 1000),
    pinnedScope,
    characterId: readString(meta, "character_id"),
    chatId: readString(meta, "chat_id"),
    projectId: readString(meta, "project_id"),
    source: readString(meta, "source"),
    sourceId: readString(meta, "source_id"),
    coreSummary: readString(meta, "core_summary"),
    title: readString(meta, "title"),
    body,
    filePath,
  };
}
export function serializeBucketMarkdown(bucket: MemoryBucket): string {
  const lines = [
    "---",
    `id: ${quote(bucket.id)}`,
    `type: ${quote(bucket.type)}`,
    `domain: ${formatArray(bucket.domain)}`,
    `tags: ${formatArray(bucket.tags)}`,
    optionalLine("created_at", bucket.createdAt),
    optionalLine("updated_at", bucket.updatedAt),
    nullableLine("last_active_at", bucket.lastActiveAt),
    `activation_count: ${bucket.activationCount}`,
    `importance: ${bucket.importance}`,
    optionalLine("valence", bucket.valence),
    optionalLine("arousal", bucket.arousal),
    `resolved: ${bucket.resolved}`,
    `digested: ${bucket.digested}`,
    `pinned: ${bucket.pinned}`,
    `pinned_order: ${bucket.pinnedOrder}`,
    `pinned_scope: ${quote(bucket.pinnedScope)}`,
    optionalLine("character_id", bucket.characterId),
    optionalLine("chat_id", bucket.chatId),
    optionalLine("project_id", bucket.projectId),
    optionalLine("source", bucket.source),
    optionalLine("source_id", bucket.sourceId),
    optionalLine("core_summary", bucket.coreSummary),
    optionalLine("title", bucket.title),
    "---",
    "",
    bucket.body.trim(),
    "",
  ].filter((line): line is string => line != null);

  return lines.join("\n");
}

function parseFrontmatter(input: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    result[key] = parseScalar(rawValue);
  }
  return result;
}

function parseScalar(rawValue: string): FrontmatterValue {
  if (rawValue === "null" || rawValue === "~") {
    return null;
  }
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
    return Number(rawValue);
  }
  if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
    const inner = rawValue.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean);
  }
  return stripQuotes(rawValue);
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function formatArray(values: string[]): string {
  return `[${values.map(quote).join(", ")}]`;
}

function optionalLine(key: string, value: string | number | undefined): string | null {
  if (value == null || value === "") {
    return null;
  }
  return typeof value === "number" ? `${key}: ${value}` : `${key}: ${quote(value)}`;
}

function nullableLine(key: string, value: string | null | undefined): string {
  return value == null || value === "" ? `${key}: null` : `${key}: ${quote(value)}`;
}

function readString(meta: Record<string, FrontmatterValue>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

function readNullableString(meta: Record<string, FrontmatterValue>, key: string): string | null | undefined {
  const value = meta[key];
  if (value === null) {
    return null;
  }
  return typeof value === "string" ? value : undefined;
}

function readStringArray(meta: Record<string, FrontmatterValue>, key: string): string[] {
  const value = meta[key];
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function readNumber(meta: Record<string, FrontmatterValue>, key: string, fallback: number): number {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(meta: Record<string, FrontmatterValue>, key: string): number | undefined {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(meta: Record<string, FrontmatterValue>, key: string, fallback: boolean): boolean {
  const value = meta[key];
  return typeof value === "boolean" ? value : fallback;
}

function inferIdFromPath(filePath?: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const normalized = filePath.replace(/\\/g, "/");
  const fileName = normalized.split("/").pop() || "";
  return fileName.replace(/\.md$/i, "") || undefined;
}
