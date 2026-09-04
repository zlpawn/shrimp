import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import { normalizeCommandAppsConfig } from "../domain/schema.mjs";
import { CommandAppsError } from "../domain/errors.mjs";

export function createCommandAppsSqliteStore({
  dbPath = "gateway.db",
  platform = process.platform,
} = {}) {
  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS command_apps_settings (
      app_id TEXT PRIMARY KEY,
      executable_path TEXT NOT NULL,
      args_json TEXT NOT NULL DEFAULT '[]',
      daemon_json TEXT,
      manually_configured INTEGER NOT NULL DEFAULT 0,
      last_launched_at TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS command_apps_hindsight_profiles (
      profile_name TEXT PRIMARY KEY,
      profile_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
  `);

  const select = db.prepare("SELECT * FROM command_apps_settings ORDER BY app_id");
  const upsert = db.prepare(`
    INSERT INTO command_apps_settings
      (app_id, executable_path, args_json, daemon_json, manually_configured, last_launched_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      executable_path = excluded.executable_path,
      args_json = excluded.args_json,
      daemon_json = excluded.daemon_json,
      manually_configured = excluded.manually_configured,
      last_launched_at = excluded.last_launched_at,
      updated_at = excluded.updated_at
  `);
  const selectProfiles = db.prepare("SELECT * FROM command_apps_hindsight_profiles ORDER BY profile_name");
  const upsertProfile = db.prepare(`
    INSERT INTO command_apps_hindsight_profiles
      (profile_name, profile_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(profile_name) DO UPDATE SET
      profile_json = excluded.profile_json,
      updated_at = excluded.updated_at
  `);

  function readRow(row) {
    if (!row) return null;
    let args = [];
    try { args = JSON.parse(row.args_json || "[]"); } catch { args = []; }
    let daemon = {};
    try { daemon = JSON.parse(row.daemon_json || "{}"); } catch { daemon = {}; }
    return {
      executablePath: row.executable_path,
      args: Array.isArray(args) ? args : [],
      manuallyConfigured: Boolean(row.manually_configured),
      lastLaunchedAt: row.last_launched_at || null,
      ...(daemon && typeof daemon === "object" ? daemon : {}),
    };
  }

  function readProfiles() {
    const profiles = {};
    for (const row of selectProfiles.all()) {
      try {
        profiles[row.profile_name] = JSON.parse(row.profile_json || "{}");
      } catch {
        profiles[row.profile_name] = {};
      }
    }
    return normalizeCommandAppsConfig({ hindsightProfiles: profiles }, { platform }).hindsightProfiles;
  }

  return {
    get() {
      const apps = {};
      for (const row of select.all()) apps[row.app_id] = readRow(row);
      return normalizeCommandAppsConfig({ apps, hindsightProfiles: readProfiles() }, { platform });
    },
    save(next) {
      const normalized = normalizeCommandAppsConfig(next || {}, { platform });
      const now = Date.now();
      db.prepare("BEGIN").run();
      try {
        for (const [appId, settings] of Object.entries(normalized.apps)) {
          upsert.run(
            appId,
            settings.executablePath,
            JSON.stringify(settings.args),
            (() => {
              if (appId !== "langbot") return "{}";
              const { cwd, dataRoot, port } = settings;
              return JSON.stringify({ cwd, dataRoot, port });
            })(),
            settings.manuallyConfigured ? 1 : 0,
            settings.lastLaunchedAt,
            now,
          );
        }
        for (const [profileName, profile] of Object.entries(normalized.hindsightProfiles)) {
          upsertProfile.run(profileName, JSON.stringify(profile), now);
        }
        db.prepare("COMMIT").run();
      } catch (error) {
        try { db.prepare("ROLLBACK").run(); } catch {}
        throw new CommandAppsError("storage_error", "Failed to save Command Apps settings", {
          reason: error.message,
        });
      }
      return normalized;
    },
    close() { db.close(); },
  };
}
