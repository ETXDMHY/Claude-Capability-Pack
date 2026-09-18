import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const sourceDir = resolve(packageDir, "../memory-core/dist");
const targetDir = resolve(packageDir, "dist/memory-core");

if (!existsSync(sourceDir)) {
  throw new Error(`memory-core dist is missing: ${sourceDir}`);
}
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

copyDirectory(sourceDir, targetDir);

function copyDirectory(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source)) {
    const sourcePath = join(source, entry);
    const targetPath = join(target, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      if (entry === "test") {
        continue;
      }
      copyDirectory(sourcePath, targetPath);
    } else if (entry.endsWith(".js")) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}
