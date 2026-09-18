import { parseBucketMarkdown } from "./markdown";
import { MemoryBucket } from "./types";

export interface MemoryFileSystem {
  readText(path: string): Promise<string>;
  listFiles(root: string): Promise<string[]>;
}
export interface LoadBucketsResult {
  buckets: MemoryBucket[];
  errors: Array<{ path: string; message: string }>;
}

export async function loadBucketsFromDirectory(
  fs: MemoryFileSystem,
  root: string
): Promise<LoadBucketsResult> {
  const paths = (await fs.listFiles(root)).filter((path) => path.toLowerCase().endsWith(".md"));
  const buckets: MemoryBucket[] = [];
  const errors: Array<{ path: string; message: string }> = [];

  for (const path of paths) {
    try {
      const content = await fs.readText(path);
      buckets.push(parseBucketMarkdown(content, path));
    } catch (error) {
      errors.push({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { buckets, errors };
}
