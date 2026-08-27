import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { normalizeOfficialRemoteLink } from "../domain/schema.mjs";
import { OfficialRemoteLinkError } from "../domain/errors.mjs";

function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createOfficialRemoteLinkSqliteStore({ dbPath = "gateway.db" } = {}) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS official_remote_links (" +
    "id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, " +
    "kind TEXT NOT NULL DEFAULT 'antigravity', created_at INTEGER NOT NULL, " +
    "updated_at INTEGER NOT NULL);"
  );

  const selectAll = db.prepare("SELECT * FROM official_remote_links ORDER BY updated_at DESC, name COLLATE NOCASE");
  const selectOne = db.prepare("SELECT * FROM official_remote_links WHERE id = ?");
  const insert = db.prepare(
    "INSERT INTO official_remote_links (id, name, url, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  const update = db.prepare(
    "UPDATE official_remote_links SET name = ?, url = ?, kind = ?, updated_at = ? WHERE id = ?"
  );
  const remove = db.prepare("DELETE FROM official_remote_links WHERE id = ?");

  function createId() {
    return "agrl_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  return {
    list() {
      return selectAll.all().map(publicRow);
    },
    get(id) {
      return publicRow(selectOne.get(String(id || "")));
    },
    create(input = {}) {
      const now = Date.now();
      const normalized = normalizeOfficialRemoteLink(input);
      const record = { ...normalized, id: createId(), createdAt: now, updatedAt: now };
      insert.run(record.id, record.name, record.url, record.kind, record.createdAt, record.updatedAt);
      return record;
    },
    update(id, input = {}) {
      const current = selectOne.get(String(id || ""));
      if (!current) return null;
      const normalized = normalizeOfficialRemoteLink({ ...publicRow(current), ...input, id: current.id });
      const record = { ...normalized, createdAt: current.created_at, updatedAt: Date.now() };
      update.run(record.name, record.url, record.kind, record.updatedAt, record.id);
      return record;
    },
    delete(id) {
      const current = selectOne.get(String(id || ""));
      if (!current) return null;
      remove.run(current.id);
      return publicRow(current);
    },
    close() {
      db.close();
    },
  };
}
