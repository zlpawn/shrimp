import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function formatTimestamp(secOrMs) {
  if (!secOrMs) return "";
  const ms = secOrMs < 10000000000 ? secOrMs * 1000 : secOrMs;
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateStr(secOrMs) {
  if (!secOrMs) return "";
  const ms = secOrMs < 10000000000 ? secOrMs * 1000 : secOrMs;
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export class SyncHistoryStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.filePath = path.join(dataDir, "sync-history.json");
    this._cached = null;
  }

  load(limit = 100) {
    if (!fs.existsSync(this.filePath)) {
      this._cached = [];
      return [];
    }
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      this._cached = JSON.parse(raw);
      if (!Array.isArray(this._cached)) this._cached = [];
      return this._cached.slice(0, limit);
    } catch {
      this._cached = [];
      return [];
    }
  }

  save(list) {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    this._cached = list;
    fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), "utf8");
  }

  recordSync({
    channel = "weread",
    channelName = "微信读书",
    status = "success",
    summary = "",
    error = null,
    booksAffected = 0,
    highlightsCount = 0,
    reviewsCount = 0,
    items = [],
  }) {
    const list = this.load(500);
    const now = Date.now();
    const entry = {
      id: `sync_${now}_${crypto.randomBytes(3).toString("hex")}`,
      timestamp: now,
      time_str: formatTimestamp(now),
      date_str: formatDateStr(now),
      channel,
      channel_name: channelName,
      status,
      summary,
      error: error ? String(error.message || error) : null,
      books_affected: booksAffected,
      highlights_count: highlightsCount,
      reviews_count: reviewsCount,
      items: (items || []).map((item) => ({
        ...item,
        create_time_str: formatTimestamp(item.create_time),
      })),
    };

    list.unshift(entry);
    // Keep max 200 sync batches
    const trimmed = list.slice(0, 200);
    this.save(trimmed);
    return entry;
  }

  getRecentHighlightsGroupedByDate(maxDays = 14) {
    const list = this.load(200);
    const groups = {}; // date_str -> { date: date_str, total_highlights: 0, items: [] }

    for (const batch of list) {
      if (!batch.items || batch.items.length === 0) continue;
      for (const item of batch.items) {
        const itemDate = item.create_time ? formatDateStr(item.create_time) : batch.date_str;
        if (!groups[itemDate]) {
          groups[itemDate] = {
            date: itemDate,
            channel: batch.channel,
            channel_name: batch.channel_name,
            total_items: 0,
            items: [],
          };
        }
        groups[itemDate].total_items++;
        groups[itemDate].items.push(item);
      }
    }

    const sortedDates = Object.keys(groups).sort().reverse().slice(0, maxDays);
    return sortedDates.map((d) => groups[d]);
  }
}
