import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function parseZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const eocdOffset = findEocdOffset(buf);
  if (eocdOffset < 0) throw new Error("Invalid ZIP archive: EOCD record not found.");

  const totalEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);
  if (totalEntries === 0xffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 archives are not supported.");
  }

  const entries = [];
  let cursor = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CD_SIG) {
      throw new Error("Invalid ZIP archive: corrupt central directory.");
    }
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const rawName = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    cursor += 46 + nameLen + extraLen + commentLen;

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error(`Invalid ZIP archive: corrupt local header for ${rawName}.`);
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) {
      throw new Error(`Invalid ZIP archive: truncated entry ${rawName}.`);
    }

    const payload = buf.subarray(dataStart, dataEnd);
    const isDir = rawName.endsWith("/");
    let data = Buffer.alloc(0);
    if (!isDir) {
      if (method === 0) data = Buffer.from(payload);
      else if (method === 8) data = zlib.inflateRawSync(payload);
      else throw new Error(`Unsupported ZIP compression method ${method} for ${rawName}.`);
    }
    entries.push({ name: rawName, isDir, data });
  }
  return entries;
}

export function extractZipBuffer(buffer, targetDir, { stripPrefix = "" } = {}) {
  const entries = normalizeZipEntries(parseZipEntries(buffer), stripPrefix);
  const root = path.resolve(targetDir);
  fs.mkdirSync(root, { recursive: true });

  const written = [];
  for (const entry of entries) {
    if (!entry.relPath) continue;
    const dest = path.resolve(root, entry.relPath);
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`Unsafe ZIP entry path: ${entry.name}`);
    }
    if (entry.isDir) {
      fs.mkdirSync(dest, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, entry.data);
    written.push(entry.relPath);
  }
  return written;
}

function normalizeZipEntries(entries, stripPrefix) {
  const normalized = entries.map((entry) => {
    const clean = entry.name.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!clean || clean.startsWith("/") || /^[A-Za-z]:/.test(clean) || clean.split("/").includes("..")) {
      throw new Error(`Unsafe ZIP entry path: ${entry.name}`);
    }
    return { ...entry, clean };
  });

  // Strip a single wrapping directory (either `<skillId>/...` or one common root folder) if all entries share it.
  const nonEmpty = normalized.filter((e) => e.clean.replace(/\/+$/, "") !== "");
  const topSegments = new Set(nonEmpty.map((e) => e.clean.split("/")[0]));
  let autoPrefix = "";
  if (topSegments.size === 1) {
    const only = [...topSegments][0];
    const allNested = nonEmpty.every((e) => e.clean === `${only}/` || e.clean.startsWith(`${only}/`));
    if (allNested && (only === stripPrefix || !nonEmpty.some((e) => e.clean === "SKILL.md"))) {
      autoPrefix = `${only}/`;
    }
  }

  return normalized.map((entry) => ({
    ...entry,
    relPath: autoPrefix && entry.clean.startsWith(autoPrefix)
      ? entry.clean.slice(autoPrefix.length)
      : entry.clean,
  }));
}

function findEocdOffset(buf) {
  const minOffset = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minOffset; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}
