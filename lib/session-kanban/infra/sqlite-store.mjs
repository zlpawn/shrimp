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
  "scheduled",
  "waiting_quota",
  "dispatching",
  "dispatched",
  "failed",
  "canceled",
]);

function publicRow(row) {
  if (!row) return null;
  const scheduledAtMs = Number(row.scheduled_at_ms || 0);
  return {
    id: row.id,
    sessionId: row.session_id,
    message: row.message,
    status: row.status,
    attempts: Number(row.attempts || 0),
    error: row.error || "",
    dispatchCommand: row.dispatch_command || "",
    dispatchExitCode: row.dispatch_exit_code === null ? null : Number(row.dispatch_exit_code),
    scheduledAtMs,
    scheduledAt: scheduledAtMs ? new Date(scheduledAtMs).toISOString() : null,
    vendorTag: row.vendor_tag || "",
    createdAt: new Date(Number(row.created_at_ms)).toISOString(),
    updatedAt: new Date(Number(row.updated_at_ms)).toISOString(),
  };
}

function resolveScheduleMs({ scheduledAtMs, scheduledAt, delayMinutes } = {}, now = Date.now()) {
  if (typeof scheduledAtMs === "number" && Number.isFinite(scheduledAtMs) && scheduledAtMs > 0) {
    return Math.floor(scheduledAtMs);
  }
  if (typeof scheduledAt === "number" && Number.isFinite(scheduledAt) && scheduledAt > 0) {
    return Math.floor(scheduledAt);
  }
  if (typeof scheduledAt === "string" && scheduledAt.trim()) {
    const parsed = Date.parse(scheduledAt.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof delayMinutes === "number" && Number.isFinite(delayMinutes) && delayMinutes > 0) {
    return now + Math.floor(delayMinutes * 60 * 1000);
  }
  return 0;
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
    "scheduled_at_ms INTEGER NOT NULL DEFAULT 0, " +
    "vendor_tag TEXT NOT NULL DEFAULT '', " +
    "created_at_ms INTEGER NOT NULL, " +
    "updated_at_ms INTEGER NOT NULL);");
  db.exec("CREATE TABLE IF NOT EXISTS session_kanban_settings (" +
    "key TEXT PRIMARY KEY, " +
    "value TEXT NOT NULL, " +
    "updated_at_ms INTEGER NOT NULL);");

  // Migration guards for existing sqlite files
  try { db.exec("ALTER TABLE session_kanban_queue ADD COLUMN scheduled_at_ms INTEGER NOT NULL DEFAULT 0;"); } catch {}
  try { db.exec("ALTER TABLE session_kanban_queue ADD COLUMN vendor_tag TEXT NOT NULL DEFAULT '';"); } catch {}

  const selectById = db.prepare("SELECT * FROM session_kanban_queue WHERE id = :id");
  const insert = db.prepare("INSERT INTO session_kanban_queue " +
    "(id, session_id, message, status, attempts, error, dispatch_command, dispatch_exit_code, scheduled_at_ms, vendor_tag, created_at_ms, updated_at_ms) " +
    "VALUES (:id, :session_id, :message, :status, 0, '', '', NULL, :scheduled_at_ms, :vendor_tag, :now, :now)");
  const cancelUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'canceled', updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('pending', 'scheduled', 'waiting_quota', 'failed')");
  const claimUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'dispatching', updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('pending', 'scheduled', 'waiting_quota')");
  const dispatchedUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'dispatched', dispatch_command = :command, dispatch_exit_code = :exit_code, " +
    "error = '', updated_at_ms = :now WHERE id = :id AND status = 'dispatching'");
  const failedUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'failed', error = :error, updated_at_ms = :now " +
    "WHERE id = :id AND status = 'dispatching'");
  const waitingQuotaUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'waiting_quota', scheduled_at_ms = :scheduled_at_ms, vendor_tag = :vendor_tag, " +
    "error = :error, updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('dispatching', 'pending', 'scheduled', 'waiting_quota')");
  const scheduleUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = :status, scheduled_at_ms = :scheduled_at_ms, updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('pending', 'scheduled', 'waiting_quota', 'failed')");
  const cascadeRescheduleUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'waiting_quota', scheduled_at_ms = :scheduled_at_ms, vendor_tag = :vendor_tag, " +
    "error = :error, updated_at_ms = :now " +
    "WHERE session_id = :session_id AND status IN ('pending', 'scheduled', 'waiting_quota')");
  const retryUpdate = db.prepare("UPDATE session_kanban_queue " +
    "SET status = 'pending', attempts = attempts + 1, error = '', dispatch_command = '', " +
    "dispatch_exit_code = NULL, scheduled_at_ms = :scheduled_at_ms, vendor_tag = :vendor_tag, updated_at_ms = :now " +
    "WHERE id = :id AND status IN ('failed', 'canceled', 'waiting_quota')");

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
    enqueue({ sessionId, message, scheduledAtMs = 0, scheduledAt = null, delayMinutes = null, vendorTag = "" }) {
      if (!String(sessionId || "").trim()) throw new Error("sessionId is required");
      if (!String(message || "").trim()) throw new Error("message is required");
      const id = randomUUID();
      const now = Date.now();
      const finalScheduleMs = resolveScheduleMs({ scheduledAtMs, scheduledAt, delayMinutes }, now);
      const initialStatus = finalScheduleMs > now ? "scheduled" : "pending";

      insert.run({
        id,
        session_id: String(sessionId),
        message: String(message),
        status: initialStatus,
        scheduled_at_ms: finalScheduleMs,
        vendor_tag: String(vendorTag || ""),
        now,
      });
      return requireRow(id);
    },
    list() {
      return db.prepare("SELECT * FROM session_kanban_queue ORDER BY created_at_ms DESC, id DESC").all().map(publicRow);
    },
    countBySession(sessionId) {
      const row = db.prepare("SELECT COUNT(*) AS count FROM session_kanban_queue " +
        "WHERE session_id = :session_id AND status IN ('pending', 'scheduled', 'waiting_quota', 'dispatching')").get({ session_id: String(sessionId) });
      return Number(row.count || 0);
    },
    cancel(id) { return transition(cancelUpdate, { id, now: Date.now() }); },
    retry(id, { immediate = true } = {}) {
      const now = Date.now();
      return transition(retryUpdate, {
        id,
        scheduled_at_ms: immediate ? 0 : resolveScheduleMs({}, now),
        vendor_tag: immediate ? "" : undefined,
        now,
      });
    },
    updateSchedule(id, { scheduledAtMs = 0, scheduledAt = null, delayMinutes = null } = {}) {
      const now = Date.now();
      const finalScheduleMs = resolveScheduleMs({ scheduledAtMs, scheduledAt, delayMinutes }, now);
      const newStatus = finalScheduleMs > now ? "scheduled" : "pending";
      return transition(scheduleUpdate, {
        id,
        status: newStatus,
        scheduled_at_ms: finalScheduleMs,
        now,
      });
    },
    markWaitingQuota(id, { notBeforeMs = 0, vendorTag = "", error = "" } = {}) {
      const now = Date.now();
      return transition(waitingQuotaUpdate, {
        id,
        scheduled_at_ms: Number(notBeforeMs || 0),
        vendor_tag: String(vendorTag || ""),
        error: String(error || "Waiting for quota recovery"),
        now,
      });
    },
    rescheduleSessionQueue(sessionId, { notBeforeMs = 0, vendorTag = "", errorMsg = "" } = {}) {
      const now = Date.now();
      const result = cascadeRescheduleUpdate.run({
        session_id: String(sessionId),
        scheduled_at_ms: Number(notBeforeMs || 0),
        vendor_tag: String(vendorTag || ""),
        error: String(errorMsg || "Waiting for quota recovery"),
        now,
      });
      return result.changes;
    },
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
