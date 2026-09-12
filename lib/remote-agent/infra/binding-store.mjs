import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

function publicBinding(row) {
  if (!row) return null;
  return {
    bindingKey: row.binding_key,
    platform: row.platform,
    chatType: row.chat_type,
    chatId: row.chat_id,
    userId: row.user_id || "",
    client: row.client,
    sessionId: row.session_id,
    workspacePath: row.workspace_path || "",
    title: row.title || "",
    boundByUserId: row.bound_by_user_id || "",
    pendingToken: row.pending_token || "",
    pendingMessage: row.pending_message || "",
    pendingReason: row.pending_reason || "",
    pendingExpiresAtMs: Number(row.pending_expires_at_ms || 0),
    createdAtMs: Number(row.created_at_ms || 0),
    updatedAtMs: Number(row.updated_at_ms || 0),
    lastUsedAtMs: Number(row.last_used_at_ms || 0),
  };
}

export function createRemoteAgentBindingStore({ dbPath = "gateway.db" } = {}) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS remote_agent_bindings (" +
      "binding_key TEXT PRIMARY KEY, " +
      "platform TEXT NOT NULL, " +
      "chat_type TEXT NOT NULL, " +
      "chat_id TEXT NOT NULL, " +
      "user_id TEXT NOT NULL DEFAULT '', " +
      "client TEXT NOT NULL, " +
      "session_id TEXT NOT NULL, " +
      "workspace_path TEXT NOT NULL DEFAULT '', " +
      "title TEXT NOT NULL DEFAULT '', " +
      "bound_by_user_id TEXT NOT NULL, " +
      "list_snapshot_json TEXT NOT NULL DEFAULT '[]', " +
      "list_snapshot_at_ms INTEGER NOT NULL DEFAULT 0, " +
      "pending_token TEXT NOT NULL DEFAULT '', " +
      "pending_message TEXT NOT NULL DEFAULT '', " +
      "pending_reason TEXT NOT NULL DEFAULT '', " +
      "pending_expires_at_ms INTEGER NOT NULL DEFAULT 0, " +
      "created_at_ms INTEGER NOT NULL, " +
      "updated_at_ms INTEGER NOT NULL, " +
      "last_used_at_ms INTEGER NOT NULL" +
    ");",
  );

  try { db.exec("ALTER TABLE remote_agent_bindings ADD COLUMN pending_token TEXT NOT NULL DEFAULT '';"); } catch {}
  try { db.exec("ALTER TABLE remote_agent_bindings ADD COLUMN pending_message TEXT NOT NULL DEFAULT '';"); } catch {}
  try { db.exec("ALTER TABLE remote_agent_bindings ADD COLUMN pending_reason TEXT NOT NULL DEFAULT '';"); } catch {}
  try { db.exec("ALTER TABLE remote_agent_bindings ADD COLUMN pending_expires_at_ms INTEGER NOT NULL DEFAULT 0;"); } catch {}

  const selectByKey = db.prepare("SELECT * FROM remote_agent_bindings WHERE binding_key = :binding_key");
  const upsert = db.prepare(
    "INSERT INTO remote_agent_bindings (" +
      "binding_key, platform, chat_type, chat_id, user_id, client, session_id, workspace_path, title, " +
      "bound_by_user_id, list_snapshot_json, list_snapshot_at_ms, pending_token, pending_message, pending_reason, pending_expires_at_ms, created_at_ms, updated_at_ms, last_used_at_ms" +
      ") VALUES (" +
      ":binding_key, :platform, :chat_type, :chat_id, :user_id, :client, :session_id, :workspace_path, :title, " +
      ":bound_by_user_id, COALESCE((SELECT list_snapshot_json FROM remote_agent_bindings WHERE binding_key = :binding_key), '[]'), " +
      "COALESCE((SELECT list_snapshot_at_ms FROM remote_agent_bindings WHERE binding_key = :binding_key), 0), " +
      "COALESCE((SELECT pending_token FROM remote_agent_bindings WHERE binding_key = :binding_key), ''), " +
      "COALESCE((SELECT pending_message FROM remote_agent_bindings WHERE binding_key = :binding_key), ''), " +
      "COALESCE((SELECT pending_reason FROM remote_agent_bindings WHERE binding_key = :binding_key), ''), " +
      "COALESCE((SELECT pending_expires_at_ms FROM remote_agent_bindings WHERE binding_key = :binding_key), 0), " +
      "COALESCE((SELECT created_at_ms FROM remote_agent_bindings WHERE binding_key = :binding_key), :now), " +
      ":now, :now" +
      ") ON CONFLICT(binding_key) DO UPDATE SET " +
      "platform = excluded.platform, " +
      "chat_type = excluded.chat_type, " +
      "chat_id = excluded.chat_id, " +
      "user_id = excluded.user_id, " +
      "client = excluded.client, " +
      "session_id = excluded.session_id, " +
      "workspace_path = excluded.workspace_path, " +
      "title = excluded.title, " +
      "bound_by_user_id = excluded.bound_by_user_id, " +
      "updated_at_ms = excluded.updated_at_ms, " +
      "last_used_at_ms = excluded.last_used_at_ms",
  );
  const clear = db.prepare("DELETE FROM remote_agent_bindings WHERE binding_key = :binding_key");
  const touch = db.prepare(
    "UPDATE remote_agent_bindings SET last_used_at_ms = :now, updated_at_ms = :now WHERE binding_key = :binding_key",
  );
  const saveSnapshot = db.prepare(
    "UPDATE remote_agent_bindings SET list_snapshot_json = :json, list_snapshot_at_ms = :now, updated_at_ms = :now " +
      "WHERE binding_key = :binding_key",
  );
  const ensureRowForSnapshot = db.prepare(
    "INSERT INTO remote_agent_bindings (" +
      "binding_key, platform, chat_type, chat_id, user_id, client, session_id, workspace_path, title, " +
      "bound_by_user_id, list_snapshot_json, list_snapshot_at_ms, pending_token, pending_message, pending_reason, pending_expires_at_ms, created_at_ms, updated_at_ms, last_used_at_ms" +
      ") VALUES (" +
      ":binding_key, '', '', '', '', '', '', '', '', '', :json, :now, '', '', '', 0, :now, :now, :now" +
      ") ON CONFLICT(binding_key) DO UPDATE SET " +
      "list_snapshot_json = excluded.list_snapshot_json, " +
      "list_snapshot_at_ms = excluded.list_snapshot_at_ms, " +
      "updated_at_ms = excluded.updated_at_ms",
  );
  const setPending = db.prepare(
    "UPDATE remote_agent_bindings SET pending_token = :token, pending_message = :message, pending_reason = :reason, " +
      "pending_expires_at_ms = :expires, updated_at_ms = :now WHERE binding_key = :binding_key",
  );
  const clearPending = db.prepare(
    "UPDATE remote_agent_bindings SET pending_token = '', pending_message = '', pending_reason = '', pending_expires_at_ms = 0, updated_at_ms = :now " +
      "WHERE binding_key = :binding_key",
  );

  return {
    close() {
      db.close();
    },
    upsertBinding(record = {}) {
      const now = Date.now();
      const bindingKey = String(record.bindingKey || "").trim();
      if (!bindingKey) throw new Error("bindingKey is required");
      upsert.run({
        binding_key: bindingKey,
        platform: String(record.platform || ""),
        chat_type: String(record.chatType || ""),
        chat_id: String(record.chatId || ""),
        user_id: String(record.userId || ""),
        client: String(record.client || ""),
        session_id: String(record.sessionId || ""),
        workspace_path: String(record.workspacePath || ""),
        title: String(record.title || ""),
        bound_by_user_id: String(record.boundByUserId || ""),
        now,
      });
      return publicBinding(selectByKey.get({ binding_key: bindingKey }));
    },
    getBinding(bindingKey) {
      const row = selectByKey.get({ binding_key: String(bindingKey || "") });
      if (!row || !String(row.session_id || "").trim()) return null;
      return publicBinding(row);
    },
    listBindings() {
      return db
        .prepare(
          "SELECT * FROM remote_agent_bindings WHERE TRIM(COALESCE(session_id, '')) != '' " +
            "ORDER BY last_used_at_ms DESC, updated_at_ms DESC, binding_key ASC",
        )
        .all()
        .map(publicBinding);
    },
    clearBinding(bindingKey) {
      clear.run({ binding_key: String(bindingKey || "") });
      return null;
    },
    touchBinding(bindingKey, nowMs = Date.now()) {
      touch.run({ binding_key: String(bindingKey || ""), now: Number(nowMs) || Date.now() });
      return publicBinding(selectByKey.get({ binding_key: String(bindingKey || "") }));
    },
    setPendingConfirmation(bindingKey, { token, message, reason = "", expiresAtMs } = {}) {
      const key = String(bindingKey || "").trim();
      if (!key) throw new Error("bindingKey is required");
      const now = Date.now();
      if (!selectByKey.get({ binding_key: key })) {
        ensureRowForSnapshot.run({ binding_key: key, json: "[]", now });
      }
      setPending.run({
        binding_key: key,
        token: String(token || ""),
        message: String(message || ""),
        reason: String(reason || ""),
        expires: Number(expiresAtMs) || 0,
        now,
      });
      return publicBinding(selectByKey.get({ binding_key: key }));
    },
    getPendingConfirmation(bindingKey, { nowMs = Date.now() } = {}) {
      const row = selectByKey.get({ binding_key: String(bindingKey || "") });
      if (!row || !String(row.pending_token || "").trim()) return null;
      const expires = Number(row.pending_expires_at_ms || 0);
      if (expires && Number(nowMs) > expires) return null;
      return {
        token: row.pending_token,
        message: row.pending_message || "",
        reason: row.pending_reason || "",
        expiresAtMs: expires,
      };
    },
    clearPendingConfirmation(bindingKey) {
      const key = String(bindingKey || "");
      clearPending.run({ binding_key: key, now: Date.now() });
      return publicBinding(selectByKey.get({ binding_key: key }));
    },
    saveListSnapshot(bindingKey, sessions = [], nowMs = Date.now()) {
      const key = String(bindingKey || "");
      const now = Number(nowMs) || Date.now();
      const json = JSON.stringify(Array.isArray(sessions) ? sessions : []);
      const existing = selectByKey.get({ binding_key: key });
      if (!existing) {
        ensureRowForSnapshot.run({ binding_key: key, json, now });
      } else {
        saveSnapshot.run({ binding_key: key, json, now });
      }
      return this.getListSnapshot(key, { nowMs: now, maxAgeMs: Number.MAX_SAFE_INTEGER });
    },
    getListSnapshot(bindingKey, { maxAgeMs = 600000, nowMs = Date.now() } = {}) {
      const row = selectByKey.get({ binding_key: String(bindingKey || "") });
      if (!row) return [];
      const age = Number(nowMs) - Number(row.list_snapshot_at_ms || 0);
      if (!Number.isFinite(age) || age > Number(maxAgeMs)) return [];
      try {
        const parsed = JSON.parse(row.list_snapshot_json || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
  };
}

