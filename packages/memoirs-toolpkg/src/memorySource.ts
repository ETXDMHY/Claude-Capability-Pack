import { joinPath, memoryRootCandidates, normalizePath } from "./paths";
import type { MemoryBucket, MemoryType } from "./types";

type DirectoryEntry = { name?: string; path?: string; isDirectory?: boolean; type?: string };
type FrontmatterValue = string | number | boolean | null | string[];

const TYPES = new Set<MemoryType>(["dynamic", "permanent", "feel", "plans", "archive"]);

export interface MemoryLoadResult {
  buckets: MemoryBucket[];
  errors: Array<{ path: string; message: string }>;
  roots: string[];
}

export async function loadMemoryBuckets(): Promise<MemoryLoadResult> {
  const configRoots = memoryRootCandidates();
  const roots = configRoots.map((root) => joinPath(root, "memory/buckets"));
  const merged = new Map<string, MemoryBucket>();
  const errors: Array<{ path: string; message: string }> = [];

  if (configRoots.length) {
    const primaryCache = await loadCachedBuckets(configRoots[0]);
    if (primaryCache && primaryCache.length) {
      return { buckets: primaryCache, errors, roots };
    }
  }

  for (const configRoot of configRoots) {
    const cached = await loadCachedBuckets(configRoot);
    for (const bucket of cached || []) {
      if (!merged.has(bucket.id)) merged.set(bucket.id, bucket);
    }
    const files = await listMarkdownFiles(joinPath(configRoot, "memory/buckets"));
    for (const path of files) {
      try {
        const bucket = parseBucketMarkdown(readText(await Tools.Files.read(path)), path);
        if (!merged.has(bucket.id)) merged.set(bucket.id, bucket);
      } catch (error) {
        errors.push({ path, message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  return { buckets: Array.from(merged.values()), errors, roots };
}

async function loadCachedBuckets(root: string): Promise<MemoryBucket[] | null> {
  try {
    const raw = JSON.parse(readText(await Tools.Files.read(joinPath(root, "memory/index/buckets-cache.json"))));
    if (raw?.version !== 2 || !Array.isArray(raw?.buckets)) return null;
    return raw.buckets.map(normalizeCachedBucket).filter((item: MemoryBucket | null): item is MemoryBucket => Boolean(item));
  } catch (_error) {
    return null;
  }
}

function normalizeCachedBucket(value: unknown): MemoryBucket | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = String(item.id || "").trim();
  const body = String(item.body || "").trim();
  if (!id || !body) return null;
  const type = String(item.type || "dynamic") as MemoryType;
  return {
    ...(item as unknown as MemoryBucket),
    id,
    body,
    type: TYPES.has(type) ? type : "dynamic",
    domain: Array.isArray(item.domain) ? item.domain.map(String) : [],
    tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
    importance: Number.isFinite(Number(item.importance)) ? Number(item.importance) : 1,
    resolved: item.resolved === true,
    digested: item.digested === true,
    pinned: item.pinned === true,
  };
}

async function listMarkdownFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  const seen = new Set<string>();

  async function walk(dir: string): Promise<void> {
    if (!dir || seen.has(dir)) return;
    seen.add(dir);
    let entries: DirectoryEntry[] = [];
    try {
      entries = extractEntries(await Tools.Files.list(dir));
    } catch (_error) {
      return;
    }
    for (const entry of entries) {
      const name = String(entry.name || "");
      const path = normalizePath(String(entry.path || (name ? joinPath(dir, name) : "")));
      if (!path) continue;
      const kind = String(entry.type || "").toLowerCase();
      const isDirectory = entry.isDirectory === true || kind === "directory" || kind === "dir";
      if (isDirectory) await walk(path);
      else if (/\.md$/i.test(path)) result.push(path);
    }
  }

  await walk(root);
  return result;
}

function extractEntries(value: unknown): DirectoryEntry[] {
  if (Array.isArray(value)) {
    return value.map((item) => typeof item === "string" ? { name: item } : item as DirectoryEntry);
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["entries", "files", "children", "items", "data", "result", "value"]) {
    const entries = extractEntries(record[key]);
    if (entries.length) return entries;
  }
  return [];
}

function parseBucketMarkdown(input: string, filePath: string): MemoryBucket {
  const match = input.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("Missing frontmatter");
  const meta = parseFrontmatter(match[1]);
  const body = match[2].trim();
  const id = stringValue(meta.id) || inferId(filePath);
  if (!id) throw new Error("Missing memory id");
  const rawType = stringValue(meta.type) as MemoryType;
  return {
    id,
    type: TYPES.has(rawType) ? rawType : "dynamic",
    domain: stringArray(meta.domain),
    tags: stringArray(meta.tags),
    title: stringValue(meta.title),
    body,
    coreSummary: stringValue(meta.core_summary),
    createdAt: stringValue(meta.created_at),
    updatedAt: stringValue(meta.updated_at),
    importance: numberValue(meta.importance, 1),
    resolved: booleanValue(meta.resolved, false),
    digested: booleanValue(meta.digested, false),
    pinned: booleanValue(meta.pinned, false),
    characterId: stringValue(meta.character_id),
    chatId: stringValue(meta.chat_id),
    projectId: stringValue(meta.project_id),
    filePath,
  };
}

function parseFrontmatter(input: string): Record<string, FrontmatterValue> {
  const result: Record<string, FrontmatterValue> = {};
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    result[line.slice(0, separator).trim()] = parseScalar(line.slice(separator + 1).trim());
  }
  return result;
}

function parseScalar(raw: string): FrontmatterValue {
  if (raw === "null" || raw === "~") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    return inner ? inner.split(",").map((item) => stripQuotes(item.trim())).filter(Boolean) : [];
  }
  return stripQuotes(raw);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function stringValue(value: FrontmatterValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function stringArray(value: FrontmatterValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return typeof value === "string" && value ? [value] : [];
}

function numberValue(value: FrontmatterValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: FrontmatterValue | undefined, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function inferId(path: string): string {
  return (normalizePath(path).split("/").pop() || "").replace(/\.md$/i, "");
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
