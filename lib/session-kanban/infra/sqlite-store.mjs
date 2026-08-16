import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const SESSION_KANBAN_STATUSES = Object.freeze([
  "idle",
  "queued",
  "running",
  "waiting_input",
  "completed",
  "error",
]);

export const QUEUE_STATUSES = Object.freeze([
  "pending",
  "dispatching",
  "dispatched",
  "failed",
  "canceled",
]);

function publicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.session_id,
    message: row.message,
    status: row.status,
    attempts: Number(row.attempts || 0),
    error: row.error || "",
    dispatchCommand: row.dispatch_command || "",
    dispatchExitCode: row.dispatch_exit_code === null ? null : Number(row.dispatch_exit_code),
    createdAt: new Date(Number(row.created_at_ms)).toISOString(),
    updatedAt: new Date(Number(row.updated_at_ms)).toISOString(),
  };
}

export function createSessionKanbanStore({ dbPath = "gateway.db" } = {}) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("CREATE TABLE IF NOT EXISTS session_kanban_queue (" +
    "id TEXT PRIMARY KEY, " +
    "session_id TEXT NOT NULL, " +
    "message TEXT NOT NULL, " +
    "status TEXT NOT NULL, " +
    "attempts INTEGER NOT NULL DEFAULT 0, " +
    "error TEXT NOT NULL DEFAULT '', " +
    "dispatch_command TEXT NOT NULL DEFAULT '', " +
    "dispatch_exit_code INTEGER, " +
    "created_at_ms INTEGER NOT NULL, " +
    "updated_at_ms INTEGER NOT NULL);");
  db.exec("CREATE TABLE IF NOT EXISTS session_kanban_settings (" +
    "key TEXT PRIMARY KEY, " +
    "value TEXT NOT NULL, " +
    "updated_at_ms INTEGER NOT NULL);");

  const selectById = db.prepare("SELECT * FROM session_kanban_queue WHERE id = :id");
  const insert = db.prepare("INSERT INTO session_kanban_queue " +
    "(id, session_id, message, status, attempts, error, dispatch_command, dispatch_exit_code, created_at_ms, updated_at_ms) " +
    "VALUES (:id, :session_id, :message, 'pending', 0, '', '', NULL, :now, :now)");
  const cancelUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'canceled', updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('pending', 'failed')");
  const claimUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'dispatching', updated_at_ms = :now " +
    "WHERE id = :id AND status = 'pending'");
  const dispatchedUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'dispatched', dispatch_command = :command, dispatch_exit_code = :exit_code, " +
    "error = '', updated_at_ms = :now WHERE id = :id AND status = 'dispatching'");
  const failedUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'failed', error = :error, updated_at_ms = :now " +
    "WHERE id = :id AND status = 'dispatching'");
  const retryUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'pending', attempts = attempts + 1, error = '', dispatch_command = '', " +
    "dispatch_exit_code = NULL, updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('failed', 'canceled')");

  function requireRow(id) {
    const row = selectById.get({ id });
    if (!row) throw new Error("Queue item not found: " + id);
    return publicRow(row);
  }

  function transition(update, params) {
    const result = update.run(params);
    if (!result.changes) throw new Error("Queue item cannot transition from its current status");
    return requireRow(params.id);
  }

  return {
    close() { db.close(); },
    enqueue({ sessionId, message }) {
      if (!String(sessionId || "").trim()) throw new Error("sessionId is required");
      if (!String(message || "").trim()) throw new Error("message is required");
      const id = randomUUID();
      insert.run({ id, session_id: String(sessionId), message: String(message), now: Date.now() });
      return requireRow(id);
    },
    list() {
      return db.prepare("SELECT * FROM session_kanban_queue ORDER BY created_at_ms DESC, id DESC").all().map(publicRow);
    },
    countBySession(sessionId) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM session_kanban_queue " +
        "WHERE session_id = :session_id AND status IN ('pending', 'dispatching')").get({ session_id: String(sessionId) });
      return Number(row.count || 0);
    },
    cancel(id) { return transition(cancelUpdate, { id, now: Date.now() }); },
    retry(id) { return transition(retryUpdate, { id, now: Date.now() }); },
    claimForDispatch(id) {
      return new Promise((resolve, reject) => {
        try {
          resolve(transition(claimUpdate, { id, now: Date.now() }));
        } catch (error) {
          reject(error.message.includes("cannot transition")
            ? new Error("Queue item is already claimed or terminal")
            : error);
        }
      });
    },
    markDispatched(id, { command = "", exitCode = null } = {}) {
      return transition(dispatchedUpdate, {
        id,
        command: String(command || ""),
        exit_code: exitCode === null || exitCode === undefined ? null : Number(exitCode),
        now: Date.now(),
      });
    },
    markFailed(id, error) {
      return transition(failedUpdate, { id, error: String(error || "Dispatch failed"), now: Date.now() });
    },
    getSetting(key) {
      const row = db.prepare("SELECT value FROM session_kanban_settings WHERE key = :key").get({ key: String(key) });
      return row ? row.value : null;
    },
    setSetting(key, value) {
      db.prepare("INSERT OR REPLACE INTO session_kanban_settings (key, value, updated_at_ms) VALUES (:key, :value, :now)")
        .run({ key: String(key), value: String(value), now: Date.now() });
      return value;
    },
  };
}
