import fs from "node:fs";
import path from "node:path";

function maskSecret(val) {
  const str = String(val || "").trim();
  if (!str) return "";
  if (str.length <= 8) return "******";
  return `${str.slice(0, 4)}...${str.slice(-4)}`;
}

export function resolveSecretValue(val, env = process.env) {
  const str = String(val || "").trim();
  if (!str) return "";
  if (str.startsWith("env:")) {
    const envKey = str.slice(4).trim();
    return String(env[envKey] || "").trim();
  }
  return str;
}

export function defaultChannelSecretsConfig() {
  return {
    version: "1.0",
    schedule: {
      enabled: false,
      mode: "daily", // "daily" | "interval"
      daily_time: "04:00", // HH:mm
      interval_hours: 12,
      sync_on_startup: true,
      target_collection_id: "col_default",
    },
    channels: {
      weread: {
        id: "weread",
        name: "微信读书",
        enabled: true,
        credentials: {
          api_key: "",
        },
        settings: {
          sync_underlines: true,
          sync_reviews: true,
          sync_finished_only: false,
        },
        sync_state: {
          last_synced_at: 0,
          last_status: "idle",
          last_summary: "",
          book_watermarks: {},
        },
      },
      craft: {
        id: "craft",
        name: "Craft 笔记",
        enabled: true,
        credentials: {
          mcp_url: "",
        },
        settings: {},
        sync_state: {
          last_synced_at: 0,
          last_status: "idle",
          last_summary: "",
          doc_watermarks: {},
        },
      },
    },
  };
}

export class ChannelSecretsStore {
  constructor({ dataDir, env = process.env }) {
    this.dataDir = dataDir;
    this.env = env;
    this.filePath = path.join(dataDir, "channel-secrets.json");
    this._cached = null;
  }

  load() {
    if (this._cached) return this._cached;
    if (!fs.existsSync(this.filePath)) {
      this._cached = defaultChannelSecretsConfig();
      return this._cached;
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const defaults = defaultChannelSecretsConfig();
      this._cached = {
        version: parsed.version || defaults.version,
        schedule: { ...defaults.schedule, ...(parsed.schedule || {}) },
        channels: {
          weread: {
            ...defaults.channels.weread,
            ...(parsed.channels?.weread || {}),
            credentials: { ...defaults.channels.weread.credentials, ...(parsed.channels?.weread?.credentials || {}) },
            settings: { ...defaults.channels.weread.settings, ...(parsed.channels?.weread?.settings || {}) },
            sync_state: { ...defaults.channels.weread.sync_state, ...(parsed.channels?.weread?.sync_state || {}) },
          },
          craft: {
            ...defaults.channels.craft,
            ...(parsed.channels?.craft || {}),
            credentials: { ...defaults.channels.craft.credentials, ...(parsed.channels?.craft?.credentials || {}) },
            settings: { ...defaults.channels.craft.settings, ...(parsed.channels?.craft?.settings || {}) },
            sync_state: { ...defaults.channels.craft.sync_state, ...(parsed.channels?.craft?.sync_state || {}) },
          },
          ...(parsed.channels || {}),
        },
      };
      return this._cached;
    } catch (err) {
      console.warn("读取 channel-secrets.json 失败，回退默认设置:", err.message);
      this._cached = defaultChannelSecretsConfig();
      return this._cached;
    }
  }

  save(data) {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this._cached = data;
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf8");
  }

  getPublicConfig() {
    const data = this.load();
    const channelsPublic = {};
    for (const [id, ch] of Object.entries(data.channels || {})) {
      const creds = ch.credentials || {};
      const maskedCreds = {};
      for (const [k, v] of Object.entries(creds)) {
        maskedCreds[k] = maskSecret(resolveSecretValue(v, this.env));
      }

      // Check fallback from env if empty
      let hasCred = false;
      if (id === "weread") {
        hasCred = Boolean(this.getChannelCredential("weread", "api_key"));
      } else if (id === "craft") {
        hasCred = Boolean(this.getChannelCredential("craft", "mcp_url"));
      } else {
        hasCred = Object.values(creds).some((v) => Boolean(resolveSecretValue(v, this.env)));
      }

      channelsPublic[id] = {
        id: ch.id,
        name: ch.name,
        enabled: ch.enabled,
        has_credentials: hasCred,
        credentials_masked: maskedCreds,
        settings: ch.settings || {},
        sync_state: ch.sync_state || {},
      };
    }

    return {
      version: data.version,
      schedule: data.schedule,
      channels: channelsPublic,
    };
  }

  getChannelCredential(channelId, keyName) {
    const data = this.load();
    const channel = data.channels?.[channelId];
    const val = channel?.credentials?.[keyName];
    const resolved = resolveSecretValue(val, this.env);
    if (resolved) return resolved;

    // Fallbacks to system environment variables
    if (channelId === "weread" && keyName === "api_key") {
      return String(this.env.WEREAD_API_KEY || "").trim();
    }
    if (channelId === "craft" && keyName === "mcp_url") {
      return String(this.env.CRAFT_MCP_URL || "").trim();
    }
    return "";
  }

  updateSchedule(patch) {
    const data = this.load();
    data.schedule = {
      ...data.schedule,
      ...patch,
    };
    this.save(data);
    return data.schedule;
  }

  updateChannel(channelId, { credentials, settings, enabled }) {
    const data = this.load();
    const existing = data.channels[channelId] || {
      id: channelId,
      name: channelId,
      enabled: true,
      credentials: {},
      settings: {},
      sync_state: {},
    };

    if (credentials && typeof credentials === "object") {
      for (const [k, v] of Object.entries(credentials)) {
        if (typeof v === "string" && !v.includes("...")) {
          existing.credentials[k] = v.trim();
        }
      }
    }

    if (settings && typeof settings === "object") {
      existing.settings = { ...existing.settings, ...settings };
    }

    if (typeof enabled === "boolean") {
      existing.enabled = enabled;
    }

    data.channels[channelId] = existing;
    this.save(data);
    return existing;
  }

  updateChannelSyncState(channelId, patch) {
    const data = this.load();
    const ch = data.channels[channelId];
    if (ch) {
      ch.sync_state = {
        ...ch.sync_state,
        ...patch,
      };
      data.channels[channelId] = ch;
      this.save(data);
    }
  }

  setBookWatermark(channelId, bookId, watermark) {
    const data = this.load();
    const ch = data.channels[channelId];
    if (ch) {
      if (!ch.sync_state.book_watermarks) ch.sync_state.book_watermarks = {};
      ch.sync_state.book_watermarks[bookId] = {
        ...(ch.sync_state.book_watermarks[bookId] || {}),
        ...watermark,
      };
      this.save(data);
    }
  }
}
