-- Trend Intelligence SQLite Database Schema

CREATE TABLE IF NOT EXISTS raw_items (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'trendradar',
    platform TEXT NOT NULL,
    country TEXT NOT NULL DEFAULT 'CN',
    language TEXT NOT NULL DEFAULT 'zh',
    type TEXT NOT NULL DEFAULT 'hotlist',
    title TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    rank INTEGER NOT NULL DEFAULT 0,
    previous_rank INTEGER DEFAULT 0,
    velocity TEXT DEFAULT '',
    score REAL DEFAULT 0,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    collected_at TEXT NOT NULL,
    raw TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_raw_items_platform ON raw_items(platform);
CREATE INDEX IF NOT EXISTS idx_raw_items_collected ON raw_items(collected_at);
CREATE INDEX IF NOT EXISTS idx_raw_items_rank ON raw_items(rank);

CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    rank INTEGER NOT NULL,
    score REAL,
    recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_item_time ON snapshots(item_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_platform ON snapshots(platform);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(recorded_at);

CREATE TABLE IF NOT EXISTS events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    platforms TEXT NOT NULL,         -- JSON array: ["weibo", "zhihu"]
    platform_count INTEGER NOT NULL DEFAULT 1,
    trend_state TEXT NOT NULL,       -- NEW, RISING, RAPID_RISING, PEAK, DECLINING, DEAD
    velocity REAL NOT NULL DEFAULT 0.0,
    world_importance_score REAL,     -- 1.0 - 10.0
    creator_value_score REAL,        -- 1.0 - 10.0
    creator_angles TEXT,             -- JSON array: ["角度1", "角度2"]
    matched_topic TEXT,              -- focus topic id e.g. "topic_cars"
    raw_item_ids TEXT,               -- JSON array of linked raw item ids
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_state ON events(trend_state);
CREATE INDEX IF NOT EXISTS idx_events_updated ON events(updated_at);
CREATE INDEX IF NOT EXISTS idx_events_world_score ON events(world_importance_score);
CREATE INDEX IF NOT EXISTS idx_events_creator_score ON events(creator_value_score);
CREATE INDEX IF NOT EXISTS idx_events_matched_topic ON events(matched_topic);

CREATE TABLE IF NOT EXISTS daily_briefs (
    date TEXT PRIMARY KEY,           -- YYYY-MM-DD
    markdown TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_briefs_date ON daily_briefs(date);
CREATE INDEX IF NOT EXISTS idx_briefs_created ON daily_briefs(created_at);
