import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const core = await import(pathToFileURL(path.join(packageDir, "dist/index.js")).href);

const DEFAULT_OUTPUT = path.resolve(packageDir, "../../artifacts/ombre-import");

const options = parseArgs(process.argv.slice(2));
if (!options.source) {
  printHelp();
  throw new Error("--source is required");
}
const sourceRoot = path.resolve(options.source);
const outputRoot = path.resolve(options.output || DEFAULT_OUTPUT);

if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
  throw new Error(`Ombre bucket directory does not exist: ${sourceRoot}`);
}

const sourceFiles = listMarkdownFiles(sourceRoot);
const imported = [];
const skipped = [];
const errors = [];
const ids = new Map();
const outputPaths = new Map();

for (const sourcePath of sourceFiles) {
  let input;
  try {
    input = fs.readFileSync(sourcePath, "utf8");
  } catch (error) {
    errors.push({ sourcePath, message: errorMessage(error) });
    continue;
  }

  try {
    const result = core.convertOmbreBucketMarkdown(sourcePath, sourceRoot, input, {
      includeHidden: options.includeHidden,
      includeArchive: options.includeArchive,
      includeSpecial: options.includeSpecial,
      now: options.now,
    });

    if (result.status === "skip") {
      skipped.push(result.skip);
      continue;
    }

    const { candidate } = result;
    const previousId = ids.get(candidate.bucket.id);
    if (previousId) {
      errors.push({
        sourcePath,
        message: `duplicate id ${candidate.bucket.id}; first seen at ${previousId}`,
      });
      continue;
    }
    ids.set(candidate.bucket.id, sourcePath);

    const previousOutput = outputPaths.get(candidate.relativeOutputPath);
    if (previousOutput) {
      errors.push({
        sourcePath,
        message: `output path collision ${candidate.relativeOutputPath}; first seen at ${previousOutput}`,
      });
      continue;
    }
    outputPaths.set(candidate.relativeOutputPath, sourcePath);
    imported.push(candidate);
  } catch (error) {
    errors.push({ sourcePath, message: errorMessage(error) });
  }
}

const report = {
  sourceRoot,
  outputRoot,
  dryRun: options.dryRun,
  options: {
    includeHidden: options.includeHidden,
    includeArchive: options.includeArchive,
    includeSpecial: options.includeSpecial,
  },
  counts: {
    scanned: sourceFiles.length,
    imported: imported.length,
    skipped: skipped.length,
    errors: errors.length,
  },
  imported: imported.map((candidate) => ({
    id: candidate.bucket.id,
    type: candidate.bucket.type,
    title: candidate.bucket.title,
    sourcePath: candidate.sourcePath,
    outputPath: candidate.relativeOutputPath,
  })),
  skipped,
  errors,
};

if (!options.dryRun) {
  writeImportedFiles(imported, outputRoot);
}
fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "import-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  ...report.counts,
  dryRun: options.dryRun,
  report: path.join(outputRoot, "import-report.json"),
}, null, 2));

function parseArgs(args) {
  const result = {
    source: undefined,
    output: DEFAULT_OUTPUT,
    dryRun: false,
    includeHidden: false,
    includeArchive: false,
    includeSpecial: false,
    now: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--include-hidden") {
      result.includeHidden = true;
    } else if (arg === "--include-archive") {
      result.includeArchive = true;
    } else if (arg === "--include-special") {
      result.includeSpecial = true;
    } else if (arg === "--source" || arg === "--output" || arg === "--now") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      result[arg.slice(2).replace("-", "")] = value;
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return result;
}

function listMarkdownFiles(root) {
  const result = [];
  walk(root);
  return result.sort((left, right) => left.localeCompare(right));

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        result.push(absolutePath);
      }
    }
  }
}

function writeImportedFiles(candidates, root) {
  for (const candidate of candidates) {
    const destination = path.join(root, ...candidate.relativeOutputPath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, candidate.markdown, "utf8");
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function printHelp() {
  console.log(`Usage: node scripts/import-ombre.mjs [options]

Options:
  --source <dir>          Ombre buckets directory
  --output <dir>          Staging output directory
  --dry-run               Scan and report without writing converted buckets
  --include-hidden        Include dont_surface buckets
  --include-archive       Include archive directory buckets
  --include-special       Include _app and letters documents when parseable
  --now <iso>             Fallback timestamp for records without created time
  --help                  Show this help
`);
}
