#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const SNAPSHOT_FILE = path.join(SKILL_DIR, "references", "official-typesafe-ai.md");
const METADATA_FILE = path.join(SKILL_DIR, "official-source.json");

export function parseSyncArgs(argv) {
  const args = { mode: "check" };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--check") args.mode = "check";
    else if (token === "--diff") args.mode = "diff";
    else if (token === "--apply") args.mode = "apply";
    else if (token === "--source") {
      if (!argv[i + 1]) throw new Error("Missing value for --source");
      args.source = argv[++i];
    } else if (token === "--help" || token === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

export function findOfficialSkill(explicitSource, homeDir = os.homedir()) {
  const candidates = [
    explicitSource,
    process.env.LEO_TYPESAFE_OFFICIAL_SKILL,
    path.join(homeDir, ".agents", "skills", "typesafe-ai", "SKILL.md"),
    path.join(homeDir, ".codex", "skills", "typesafe-ai", "SKILL.md"),
  ].filter(Boolean).map((candidate) => path.resolve(candidate));

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Official typesafe-ai skill not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

export function portableSourceLabel(source, homeDir = os.homedir()) {
  const relative = path.relative(homeDir, source);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~/${relative.replaceAll("\\", "/")}`;
  }
  return source.replaceAll("\\", "/");
}

export function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

export function summarizeDiff(oldText, newText) {
  const oldLines = oldText.split(/\r?\n/);
  const newLines = newText.split(/\r?\n/);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;

  return {
    old_lines: oldLines.length,
    new_lines: newLines.length,
    first_changed_line: prefix + 1,
    old_changed_lines: oldLines.length - prefix - suffix,
    new_changed_lines: newLines.length - prefix - suffix,
    old_excerpt: oldLines.slice(prefix, Math.min(prefix + 12, oldLines.length - suffix)),
    new_excerpt: newLines.slice(prefix, Math.min(prefix + 12, newLines.length - suffix)),
  };
}

function printHelp() {
  console.log(`Sync the embedded snapshot of TypeSafe's official skill.

Usage:
  node scripts/sync-official.mjs --check [--source PATH]
  node scripts/sync-official.mjs --diff [--source PATH]
  node scripts/sync-official.mjs --apply [--source PATH]

--check reports whether the official source changed.
--diff prints a compact changed-region summary.
--apply replaces only references/official-typesafe-ai.md and official-source.json.
`);
}

async function main() {
  const args = parseSyncArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const source = findOfficialSkill(args.source);
  const official = fs.readFileSync(source, "utf-8");
  const snapshot = fs.existsSync(SNAPSHOT_FILE) ? fs.readFileSync(SNAPSHOT_FILE, "utf-8") : "";
  const officialHash = sha256(official);
  const snapshotHash = sha256(snapshot);
  const changed = officialHash !== snapshotHash;

  if (args.mode === "check") {
    console.log(JSON.stringify({
      changed,
      source,
      snapshot: SNAPSHOT_FILE,
      official_sha256: officialHash,
      snapshot_sha256: snapshotHash,
    }, null, 2));
    if (changed) process.exitCode = 2;
    return;
  }

  if (args.mode === "diff") {
    console.log(JSON.stringify({
      changed,
      ...summarizeDiff(snapshot, official),
    }, null, 2));
    return;
  }

  if (!changed) {
    console.log("Official snapshot is already current.");
    return;
  }

  fs.writeFileSync(SNAPSHOT_FILE, official, "utf-8");
  fs.writeFileSync(METADATA_FILE, `${JSON.stringify({
    name: "typesafe-ai",
    license: "MIT",
    source: portableSourceLabel(source),
    snapshot: path.relative(SKILL_DIR, SNAPSHOT_FILE).replaceAll("\\", "/"),
    sha256: officialHash,
    synced_at: new Date().toISOString(),
  }, null, 2)}\n`, "utf-8");
  console.log(`Updated ${SNAPSHOT_FILE}`);
}

const isMain = process.argv[1]
  && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  main().catch((error) => {
    console.error(`sync-official: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
