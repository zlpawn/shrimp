import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeCollection } from "./meta-store.mjs";

const DISPLAY_CONFIDENCE = 0.85;
const ROLES = new Set(["primary", "mention"]);
const SOURCES = new Set(["manual", "rule", "model"]);

function rowToAnchor(row) {
  if (!row) return null;
  return {
    id: row.id,
    collection: row.collection,
    object_type: row.object_type,
    object_id: row.object_id,
    video_id: row.video_id,
    start_seconds: Number(row.start_seconds || 0),
    end_seconds: Number(row.end_seconds || 0),
    quote: row.quote || "",
    role: row.role || "primary",
    confidence: Number(row.confidence || 0),
    confirmed: Number(row.confirmed || 0),
    source: row.source || "manual",
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

export function createClipAnchorStore({ dbPath }) {
  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS clip_anchors (
      id TEXT PRIMARY KEY,
      collection TEXT NOT NULL,
      object_type TEXT NOT NULL,
      object_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      start_seconds REAL NOT NULL,
      end_seconds REAL NOT NULL,
      quote TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'primary',
      confidence REAL NOT NULL DEFAULT 0,
      confirmed INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clip_anchors_unique
      ON clip_anchors(collection, object_type, object_id, video_id, start_seconds, end_seconds);
  `);

  const selectById = db.prepare("SELECT * FROM clip_anchors WHERE id = ?");
  const selectByUnique = db.prepare(`
    SELECT * FROM clip_anchors
    WHERE collection = ? AND object_type = ? AND object_id = ? AND video_id = ? AND start_seconds = ? AND end_seconds = ?
  `);
  const deleteById = db.prepare("DELETE FROM clip_anchors WHERE id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO clip_anchors (
      id, collection, object_type, object_id, video_id, start_seconds, end_seconds,
      quote, role, confidence, confirmed, source, created_at, updated_at
    ) VALUES (
      @id, @collection, @object_type, @object_id, @video_id, @start_seconds, @end_seconds,
      @quote, @role, @confidence, @confirmed, @source, @created_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      collection = excluded.collection,
      object_type = excluded.object_type,
      object_id = excluded.object_id,
      video_id = excluded.video_id,
      start_seconds = excluded.start_seconds,
      end_seconds = excluded.end_seconds,
      quote = excluded.quote,
      role = excluded.role,
      confidence = excluded.confidence,
      confirmed = excluded.confirmed,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);

  return {
    upsertAnchor(input = {}) {
      const start = Number(input.start_seconds);
      const end = Number(input.end_seconds);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        throw new Error("end_seconds must be greater than start_seconds");
      }
      const role = String(input.role || "primary");
      if (!ROLES.has(role)) throw new Error(`Invalid role: ${role}`);
      const source = String(input.source || "manual");
      if (!SOURCES.has(source)) throw new Error(`Invalid source: ${source}`);
      const now = Date.now();
      const collection = normalizeCollection(input.collection);
      const objectType = String(input.object_type || "").trim();
      const objectId = String(input.object_id || "").trim();
      const videoId = String(input.video_id || "").trim();
      const existing = (input.id ? selectById.get(String(input.id)) : null)
        || selectByUnique.get(collection, objectType, objectId, videoId, start, end);
      const payload = {
        id: String(existing?.id || input.id || randomUUID()),
        collection,
        object_type: objectType,
        object_id: objectId,
        video_id: videoId,
        start_seconds: start,
        end_seconds: end,
        quote: String(input.quote || "").trim(),
        role,
        confidence: Number(input.confidence || 0),
        confirmed: input.confirmed ? 1 : 0,
        source,
        created_at: Number(existing?.created_at || now),
        updated_at: now,
      };
      if (!payload.object_type) throw new Error("object_type is required");
      if (!payload.object_id) throw new Error("object_id is required");
      if (!payload.video_id) throw new Error("video_id is required");
      insertStmt.run(payload);
      return rowToAnchor(selectById.get(payload.id));
    },

    getAnchor(id) {
      return rowToAnchor(selectById.get(String(id || "")));
    },

    listAnchors({
      collection,
      object_type,
      object_id,
      confirmed,
      role,
      for_display = false,
    } = {}) {
      const where = [];
      const params = [];
      if (collection) {
        where.push("collection = ?");
        params.push(normalizeCollection(collection));
      }
      if (object_type) {
        where.push("object_type = ?");
        params.push(String(object_type));
      }
      if (object_id) {
        where.push("object_id = ?");
        params.push(String(object_id));
      }
      if (role) {
        where.push("role = ?");
        params.push(String(role));
      }
      if (confirmed === 1 || confirmed === true) {
        where.push("confirmed = 1");
      }
      if (for_display) {
        where.push("role = 'primary'");
        where.push("(confirmed = 1 OR confidence >= ?)");
        params.push(DISPLAY_CONFIDENCE);
      }
      const sql = `SELECT * FROM clip_anchors${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY start_seconds ASC, created_at ASC`;
      return db.prepare(sql).all(...params).map(rowToAnchor);
    },

    deleteAnchor(id) {
      deleteById.run(String(id || ""));
      return { ok: true, id: String(id || "") };
    },

    close() {
      try { db.close(); } catch { /* ignore */ }
    },
  };
}
