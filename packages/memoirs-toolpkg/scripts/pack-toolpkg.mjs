import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(rootDir, "build", "volume-of-memoirs.toolpkg");
const entries = [
  { source: "manifest.json", name: "manifest.json" },
  { source: "README.md", name: "README.md" },
  ...collectFiles("dist"),
].sort((left, right) => left.name.localeCompare(right.name));

validateInputs();

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[index] = value >>> 0;
}

function collectFiles(relativeRoot) {
  const absoluteRoot = path.join(rootDir, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const result = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory)) {
      const absolutePath = path.join(directory, entry);
      const stat = fs.statSync(absolutePath);
      if (stat.isDirectory()) walk(absolutePath);
      else if (stat.isFile()) {
        const source = path.relative(rootDir, absolutePath).replace(/\\/g, "/");
        result.push({ source, name: source });
      }
    }
  }
  walk(absoluteRoot);
  return result;
}

function validateInputs() {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8"));
  if (manifest.version !== packageJson.version) throw new Error("Manifest and package versions differ");
  if (!fs.existsSync(path.join(rootDir, ...manifest.main.split("/")))) throw new Error(`Missing ${manifest.main}`);
  for (const subpackage of manifest.subpackages || []) {
    if (!fs.existsSync(path.join(rootDir, ...subpackage.entry.split("/")))) throw new Error(`Missing ${subpackage.entry}`);
  }
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(value) { const buffer = Buffer.allocUnsafe(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value) { const buffer = Buffer.allocUnsafe(4); buffer.writeUInt32LE(value); return buffer; }
function localHeader(name, data) {
  const fileName = Buffer.from(name, "utf8");
  return Buffer.concat([u32(0x04034b50),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc32(data)),u32(data.length),u32(data.length),u16(fileName.length),u16(0),fileName]);
}
function centralHeader(name, data, offset) {
  const fileName = Buffer.from(name, "utf8");
  return Buffer.concat([u32(0x02014b50),u16(20),u16(20),u16(0),u16(0),u16(0),u16(0),u32(crc32(data)),u32(data.length),u32(data.length),u16(fileName.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),fileName]);
}
function endRecord(count, size, offset) {
  return Buffer.concat([u32(0x06054b50),u16(0),u16(0),u16(count),u16(count),u32(size),u32(offset),u16(0)]);
}

const localParts = [];
const records = [];
let offset = 0;
for (const entry of entries) {
  const data = fs.readFileSync(path.join(rootDir, ...entry.source.split("/")));
  const header = localHeader(entry.name, data);
  records.push({ name: entry.name, data, offset });
  localParts.push(header, data);
  offset += header.length + data.length;
}
const central = Buffer.concat(records.map((record) => centralHeader(record.name, record.data, record.offset)));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat([...localParts, central, endRecord(records.length, central.length, offset)]));
console.log(`Packed ${path.relative(rootDir, outputPath).replace(/\\/g, "/")} (${records.length} files)`);
