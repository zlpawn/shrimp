import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

function safeJsonParse(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== "string") return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

export function createTrendIntelDb(dataDir) {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, "trend-intel.db");
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");

  // Load and execute schema
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const schemaPath = path.join(__dirname, "schema.sql");
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, "utf-8");
    db.exec(schemaSql);
  }

  const saveRawItemStmt = db.prepare(`
    INSERT INTO raw_items (
      id, source, platform, country, language, type,
      title, url, rank, previous_rank, velocity, score,
      first_seen_at, last_seen_at, collected_at, raw
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      previous_rank = CASE WHEN raw_items.rank != excluded.rank THEN raw_items.rank ELSE raw_items.previous_rank END,
      rank = excluded.rank,
      score = excluded.score,
      velocity = excluded.velocity,
      title = excluded.title,
      url = excluded.url,
      last_seen_at = excluded.last_seen_at,
      collected_at = excluded.collected_at,
      raw = excluded.raw;
  `);

  function saveRawItems(items = []) {
    for (const item of items) {
      const now = new Date().toISOString();
      const rawStr = typeof item.raw === "string" ? item.raw : JSON.stringify(item.raw || {});
      saveRawItemStmt.run(
        String(item.id),
        item.source || "trendradar",
        item.platform || "",
        item.country || "CN",
        item.language || "zh",
        item.type || "hotlist",
        item.title || "",
        item.url || "",
        Number(item.rank) || 0,
        Number(item.previous_rank) || 0,
        String(item.velocity || ""),
        Number(item.score) || 0,
        item.first_seen_at || item.collected_at || now,
        item.last_seen_at || item.collected_at || now,
        item.collected_at || now,
        rawStr
      );
    }
  }

  function getRawItems(options = {}) {
    const conditions = [];
    const params = [];

    if (options.platform) {
      conditions.push("platform = ?");
      params.push(options.platform);
    }
    if (options.since) {
      conditions.push("collected_at >= ?");
      params.push(options.since);
    }

    let sql = "SELECT * FROM raw_items";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY rank ASC, score DESC";
    if (options.limit && Number.isInteger(Number(options.limit))) {
      sql += " LIMIT " + Number(options.limit);
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
      ...r,
      raw: safeJsonParse(r.raw, {})
    }));
  }

  const recordSnapshotStmt = db.prepare(`
    INSERT INTO snapshots (item_id, platform, rank, score, recorded_at)
    VALUES (?, ?, ?, ?, ?);
  `);

  function recordSnapshots(snapshots = []) {
    for (const s of snapshots) {
      recordSnapshotStmt.run(
        String(s.item_id),
        s.platform || "",
        Number(s.rank) || 0,
        s.score !== undefined && s.score !== null ? Number(s.score) : null,
        s.recorded_at || new Date().toISOString()
      );
    }
  }

  function getItemSnapshots(itemId, options = {}) {
    let sql = "SELECT * FROM snapshots WHERE item_id = ? ORDER BY recorded_at " + (options.order === "desc" ? "DESC" : "ASC");
    if (options.limit && Number.isInteger(Number(options.limit))) {
      sql += " LIMIT " + Number(options.limit);
    }
    return db.prepare(sql).all(String(itemId));
  }

  const saveEventStmt = db.prepare(`
    INSERT INTO events (
      event_id, title, summary, platforms, platform_count,
      trend_state, velocity, world_importance_score, creator_value_score,
      creator_angles, matched_topic, raw_item_ids,
      first_seen_at, last_seen_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?
    ) ON CONFLICT(event_id) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      platforms = excluded.platforms,
      platform_count = excluded.platform_count,
      trend_state = excluded.trend_state,
      velocity = excluded.velocity,
      world_importance_score = excluded.world_importance_score,
      creator_value_score = excluded.creator_value_score,
      creator_angles = excluded.creator_angles,
      matched_topic = excluded.matched_topic,
      raw_item_ids = excluded.raw_item_ids,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at;
  `);

  function saveEvents(events = []) {
    for (const evt of events) {
      const now = new Date().toISOString();
      const platformsStr = Array.isArray(evt.platforms) ? JSON.stringify(evt.platforms) : JSON.stringify([]);
      const anglesStr = Array.isArray(evt.creator_angles) ? JSON.stringify(evt.creator_angles) : (evt.creator_angles ? JSON.stringify([evt.creator_angles]) : JSON.stringify([]));
      const rawItemIdsStr = Array.isArray(evt.raw_item_ids) ? JSON.stringify(evt.raw_item_ids) : JSON.stringify([]);

      saveEventStmt.run(
        String(evt.event_id),
        evt.title || "",
        evt.summary || "",
        platformsStr,
        Number(evt.platform_count) || (Array.isArray(evt.platforms) ? evt.platforms.length : 1),
        evt.trend_state || "NEW",
        Number(evt.velocity) || 0.0,
        evt.world_importance_score !== undefined && evt.world_importance_score !== null ? Number(evt.world_importance_score) : null,
        evt.creator_value_score !== undefined && evt.creator_value_score !== null ? Number(evt.creator_value_score) : null,
        anglesStr,
        evt.matched_topic || null,
        rawItemIdsStr,
        evt.first_seen_at || now,
        evt.last_seen_at || now,
        evt.updated_at || now
      );
    }
  }

  function getEvents(options = {}) {
    const conditions = [];
    const params = [];

    if (options.event_id) {
      conditions.push("event_id = ?");
      params.push(options.event_id);
    }
    const stateFilter = options.state || options.trend_state;
    if (stateFilter) {
      conditions.push("trend_state = ?");
      params.push(stateFilter);
    }
    if (options.min_score !== undefined && options.min_score !== null) {
      conditions.push("(world_importance_score >= ? OR creator_value_score >= ?)");
      params.push(Number(options.min_score), Number(options.min_score));
    }
    if (options.min_world_score !== undefined && options.min_world_score !== null) {
      conditions.push("world_importance_score >= ?");
      params.push(Number(options.min_world_score));
    }
    if (options.min_creator_score !== undefined && options.min_creator_score !== null) {
      conditions.push("creator_value_score >= ?");
      params.push(Number(options.min_creator_score));
    }
    if (options.matched_topic) {
      conditions.push("matched_topic = ?");
      params.push(options.matched_topic);
    }

    let sql = "SELECT * FROM events";
    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }
    sql += " ORDER BY " + (options.order_by || "updated_at DESC");
    if (options.limit && Number.isInteger(Number(options.limit))) {
      sql += " LIMIT " + Number(options.limit);
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
      ...r,
      platforms: safeJsonParse(r.platforms, []),
      creator_angles: safeJsonParse(r.creator_angles, []),
      raw_item_ids: safeJsonParse(r.raw_item_ids, [])
    }));
  }

  const saveBriefStmt = db.prepare(`
    INSERT INTO daily_briefs (date, markdown, metadata, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      markdown = excluded.markdown,
      metadata = excluded.metadata,
      created_at = excluded.created_at;
  `);

  function saveBrief(brief) {
    const metaStr = typeof brief.metadata === "string" ? brief.metadata : JSON.stringify(brief.metadata || {});
    saveBriefStmt.run(
      String(brief.date),
      brief.markdown || "",
      metaStr,
      brief.created_at || new Date().toISOString()
    );
  }

  function getLatestBrief() {
    const row = db.prepare("SELECT * FROM daily_briefs ORDER BY date DESC, created_at DESC LIMIT 1").get();
    if (!row) return null;
    return {
      ...row,
      metadata: safeJsonParse(row.metadata, {})
    };
  }

  function getBriefByDate(date) {
    const row = db.prepare("SELECT * FROM daily_briefs WHERE date = ? LIMIT 1").get(String(date));
    if (!row) return null;
    return {
      ...row,
      metadata: safeJsonParse(row.metadata, {})
    };
  }

  function close() {
    db.close();
  }

  return {
    db,
    saveRawItems,
    getRawItems,
    recordSnapshots,
    getItemSnapshots,
    saveEvents,
    getEvents,
    saveBrief,
    getLatestBrief,
    getBriefByDate,
    close
  };
}
