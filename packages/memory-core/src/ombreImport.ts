import { serializeBucketMarkdown } from "./markdown";
import { clampText, firstUsefulLine } from "./text";
import { BucketType, MemoryBucket } from "./types";

type OmbreScalar = string | number | boolean | null | string[];

export interface OmbreImportOptions {
  includeHidden?: boolean;
  includeArchive?: boolean;
  includeSpecial?: boolean;
  now?: string;
}

export interface OmbreImportCandidate {
  bucket: MemoryBucket;
  markdown: string;
  relativeOutputPath: string;
  sourcePath: string;
}

export interface OmbreImportSkip {
  sourcePath: string;
  reason: string;
}

export type OmbreImportResult =
  | { status: "import"; candidate: OmbreImportCandidate }
  | { status: "skip"; skip: OmbreImportSkip };

const BUCKET_TYPES = new Set<BucketType>(["dynamic", "permanent", "feel", "plans", "archive"]);
const SPECIAL_ROOTS = new Set(["_app", "letters"]);

export function convertOmbreBucketMarkdown(
  sourcePath: string,
  rootPath: string,
  input: string,
  options: OmbreImportOptions = {}
): OmbreImportResult {
  const relativePath = normalizeRelativePath(rootPath, sourcePath);
  const segments = relativePath.split("/").filter(Boolean);
  const topLevel = segments[0] || "";

  if (!options.includeArchive && segments.includes("archive")) {
    return skip(sourcePath, "archive");
  }
  if (!options.includeSpecial && SPECIAL_ROOTS.has(topLevel)) {
    return skip(sourcePath, `special:${topLevel}`);
  }

  const parsed = parseOmbreMarkdown(input);
  if (!parsed) {
    return skip(sourcePath, "missing_frontmatter");
  }

  const meta = parsed.meta;
  if (!options.includeHidden && readBoolean(meta, "dont_surface", false)) {
    return skip(sourcePath, "dont_surface");
  }
  if (readBoolean(meta, "tombstone", false) || readString(meta, "deleted_at") || readString(meta, "tombstoned_at")) {
    return skip(sourcePath, "deleted_or_tombstone");
  }

  const body = parsed.body.trim();
  if (!body) {
    return skip(sourcePath, "empty_body");
  }

  const id = readString(meta, "id") || inferIdFromPath(sourcePath);
  if (!id) {
    return skip(sourcePath, "missing_id");
  }

  const domain = readStringArray(meta, "domain");
  const tags = readStringArray(meta, "tags");
  const type = normalizeBucketType(readString(meta, "type"), domain, tags, segments);
  const createdAt = readString(meta, "created") || readString(meta, "created_at") || options.now;
  const lastActiveAt = readString(meta, "last_active") || readString(meta, "last_active_at") || null;
  const updatedAt = readString(meta, "updated_at") || lastActiveAt || createdAt;
  const pinned = readBoolean(meta, "pinned", false);
  const title = readString(meta, "title") || readString(meta, "name") || id;

  const bucket: MemoryBucket = {
    id,
    type,
    domain,
    tags,
    createdAt,
    updatedAt,
    lastActiveAt,
    activationCount: readNumber(meta, "activation_count", 0),
    importance: clampImportance(readNumber(meta, "importance", 5)),
    valence: readOptionalNumber(meta, "valence"),
    arousal: readOptionalNumber(meta, "arousal"),
    resolved: readBoolean(meta, "resolved", false),
    digested: readBoolean(meta, "digested", false),
    pinned,
    pinnedOrder: 1000,
    pinnedScope: "global",
    source: "ombre-brain",
    sourceId: id,
    coreSummary: pinned ? clampText(firstUsefulLine(body), 80) : undefined,
    title,
    body,
    filePath: sourcePath,
  };

  const markdown = serializeBucketMarkdown(bucket);
  return {
    status: "import",
    candidate: {
      bucket,
      markdown,
      relativeOutputPath: bucketOutputPath(bucket),
      sourcePath,
    },
  };
}

export function parseOmbreMarkdown(input: string): { meta: Record<string, OmbreScalar>; body: string } | null {
  const match = input.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }
  return { meta: parseOmbreFrontmatter(match[1]), body: match[2] };
}

function parseOmbreFrontmatter(input: string): Record<string, OmbreScalar> {
  const result: Record<string, OmbreScalar> = {};
  const lines = input.split(/\r?\n/);
  let activeListKey: string | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (activeListKey && trimmed.startsWith("- ")) {
      const current = Array.isArray(result[activeListKey]) ? (result[activeListKey] as string[]) : [];
      const item = trimmed.slice(2).trim();
      if (!item.includes(":")) {
        current.push(stripQuotes(item));
        result[activeListKey] = current;
      }
      continue;
    }

    const separator = rawLine.indexOf(":");
    if (separator < 0 || /^\s/.test(rawLine)) {
      activeListKey = null;
      continue;
    }

    const key = rawLine.slice(0, separator).trim();
    const rawValue = rawLine.slice(separator + 1).trim();
    if (!rawValue) {
      result[key] = [];
      activeListKey = key;
      continue;
    }

    result[key] = parseScalar(rawValue);
    activeListKey = null;
  }

  return result;
}

function parseScalar(rawValue: string): OmbreScalar {
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
    return inner ? inner.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean) : [];
  }
  return stripQuotes(rawValue);
}

function normalizeBucketType(rawType: string | undefined, domain: string[], tags: string[], segments: string[]): BucketType {
  const normalized = rawType === "plan" ? "plans" : rawType;
  if (normalized && BUCKET_TYPES.has(normalized as BucketType)) {
    if (segments.includes("feel") || domain.includes("feel") || tags.includes("__feel__")) {
      return "feel";
    }
    return normalized as BucketType;
  }
  if (segments.includes("feel") || domain.includes("feel") || tags.includes("__feel__")) {
    return "feel";
  }
  if (segments.includes("plans") || segments.includes("plan") || domain.includes("plan")) {
    return "plans";
  }
  return "dynamic";
}

function bucketOutputPath(bucket: MemoryBucket): string {
  const domain = sanitizeSegment(bucket.domain[0] || "general");
  const title = sanitizeSegment(bucket.title || bucket.id);
  return `${bucket.type}/${domain}/${title}_${sanitizeSegment(bucket.id)}.md`;
}

function sanitizeSegment(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "memory";
}

function normalizeRelativePath(rootPath: string, sourcePath: string): string {
  const root = normalizePath(rootPath).replace(/\/$/, "");
  const source = normalizePath(sourcePath);
  return source.startsWith(`${root}/`) ? source.slice(root.length + 1) : source;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function inferIdFromPath(filePath: string): string {
  const fileName = normalizePath(filePath).split("/").pop() || "";
  return fileName.replace(/\.md$/i, "");
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function readString(meta: Record<string, OmbreScalar>, key: string): string | undefined {
  const value = meta[key];
  return typeof value === "string" ? value : undefined;
}

function readStringArray(meta: Record<string, OmbreScalar>, key: string): string[] {
  const value = meta[key];
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  if (typeof value === "string" && value) {
    return [value];
  }
  return [];
}

function readNumber(meta: Record<string, OmbreScalar>, key: string, fallback: number): number {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOptionalNumber(meta: Record<string, OmbreScalar>, key: string): number | undefined {
  const value = meta[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(meta: Record<string, OmbreScalar>, key: string, fallback: boolean): boolean {
  const value = meta[key];
  return typeof value === "boolean" ? value : fallback;
}

function clampImportance(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.max(1, Math.min(10, Math.round(value)));
}

function skip(sourcePath: string, reason: string): OmbreImportResult {
  return { status: "skip", skip: { sourcePath, reason } };
}
