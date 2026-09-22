const TOOLPKG_ID = "com.volumeofmemoirs.operit";
const MEMORY_TOOLPKG_ID = "com.claude_capability_pack.memory";

export function memoirsRoot(): string {
  return normalizePath(ToolPkg.getConfigDir(TOOLPKG_ID));
}

export function memoirsDataPath(): string {
  return joinPath(memoirsRoot(), "memoirs/state.json");
}

export function memoryRootCandidates(): string[] {
  const roots: string[] = [];
  try {
    const memoryPluginRoot = normalizePath(ToolPkg.getConfigDir(MEMORY_TOOLPKG_ID));
    roots.push(memoryPluginRoot);
    roots.push(joinPath(memoryPluginRoot, "claude-capability-pack"));
  } catch (_error) {
  }
  try {
    const current = normalizePath(ToolPkg.getConfigDir());
    roots.push(joinPath(current, "claude-capability-pack"));
    roots.push(normalizePath(ToolPkg.getConfigDir("claude-capability-pack")));
  } catch (_error) {
  }
  return unique(roots.filter(Boolean));
}

export function joinPath(base: string, child: string): string {
  return normalizePath(`${base.replace(/[\\/]+$/, "")}/${child.replace(/^[\\/]+/, "")}`);
}

export function parentDir(path: string): string {
  const normalized = normalizePath(path);
  return normalized.slice(0, normalized.lastIndexOf("/")) || normalized;
}

export function normalizePath(path: string): string {
  return String(path || "").replace(/\\/g, "/").replace(/\/+/g, "/");
}

function unique(paths: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}
