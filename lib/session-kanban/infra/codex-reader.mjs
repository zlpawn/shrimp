import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function isoOrNull(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? new Date(value).toISOString() : null;
}

export function normalizeWorkspacePath(value) {
  return String(value || "").replace(/^\\\\\?\\/, "");
}

export function cleanSessionTitle(value, maxLength = 100) {
  const source = String(value || "");
  const userRequest = source.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i)?.[1];
  const withoutLinks = (userRequest || source).replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const withoutTags = withoutLinks.replace(/<[^>]+>/g, " ");
  const withoutRuntime = withoutTags
    .replace(/The current local time is:[\s\S]*$/i, " ")
    .replace(/The user changed setting[\s\S]*$/i, " ");
  const compact = withoutRuntime.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return compact.length > maxLength ? compact.slice(0, maxLength - 1).trimEnd() + "…" : compact;
}

export function createCodexReader({
  stateFile = path.join(os.homedir(), ".codex", "state_5.sqlite"),
  indexFile = path.join(os.homedir(), ".codex", "session_index.jsonl"),
} = {}) {
  function loadRenamedTitles() {
    if (!fs.existsSync(indexFile)) return new Map();
    const titles = new Map();
    for (const line of fs.readFileSync(indexFile, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (!item?.id || !item?.thread_name) continue;
        const previous = titles.get(item.id);
        if (!previous || new Date(item.updated_at || 0) >= previous.updatedAt) {
          titles.set(item.id, { title: String(item.thread_name), updatedAt: new Date(item.updated_at || 0) });
        }
      } catch {}
    }
    return titles;
  }
  return {
    async list() {
      if (!fs.existsSync(stateFile)) return [];
      const db = new DatabaseSync(stateFile, { readOnly: true });
      try {
        const rows = db.prepare(
          "SELECT id, title, cwd, created_at_ms, updated_at_ms, archived, rollout_path FROM threads ORDER BY COALESCE(updated_at_ms, 0) DESC"
        ).all();
        const renamedTitles = loadRenamedTitles();
        return rows.map(row => ({
          client: "codex",
          id: row.id,
          dispatchTarget: row.id,
          title: cleanSessionTitle(renamedTitles.get(row.id)?.title || row.title || row.id),
          workspacePath: normalizeWorkspacePath(row.cwd),
          createdAt: isoOrNull(row.created_at_ms),
          lastActivityAt: isoOrNull(row.updated_at_ms),
          archived: Boolean(row.archived),
          sourcePath: row.rollout_path || "",
        }));
      } finally {
        db.close();
      }
    },
  };
}
