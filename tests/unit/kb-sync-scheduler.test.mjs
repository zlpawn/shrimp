import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncHistoryStore } from "../../lib/knowledge-base/sync-history.mjs";
import { SyncScheduler } from "../../lib/knowledge-base/sync-scheduler.mjs";
import { ChannelSecretsStore } from "../../lib/knowledge-base/channel-secrets.mjs";

describe("SyncScheduler & SyncHistoryStore", () => {
  it("records daily synced highlights and groups them by date for user inspection", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-hist-"));
    try {
      const hist = new SyncHistoryStore({ dataDir: tmpDir });

      hist.recordSync({
        channel: "weread",
        channelName: "微信读书",
        status: "success",
        summary: "更新 1 本书，新增 2 条划线",
        booksAffected: 1,
        highlightsCount: 2,
        items: [
          {
            type: "highlight",
            book_id: "book_1",
            book_title: "纳瓦尔宝典",
            chapter_title: "第一章 积累财富",
            mark_text: "靠出租自己的时间是无法发财的。",
            create_time: 1788698000,
            deep_link: "https://weread.qq.com/...",
          },
          {
            type: "highlight",
            book_id: "book_1",
            book_title: "纳瓦尔宝典",
            chapter_title: "第一章 积累财富",
            mark_text: "把自己产品化。",
            create_time: 1788698100,
            deep_link: "https://weread.qq.com/...",
          },
        ],
      });

      const list = hist.load();
      assert.equal(list.length, 1);
      assert.equal(list[0].books_affected, 1);
      assert.equal(list[0].items.length, 2);
      assert.equal(list[0].items[0].book_title, "纳瓦尔宝典");
      assert.ok(list[0].items[0].create_time_str);

      // Verify grouped by date
      const grouped = hist.getRecentHighlightsGroupedByDate();
      assert.ok(grouped.length >= 1);
      assert.equal(grouped[0].total_items, 2);
      assert.equal(grouped[0].items[0].mark_text, "靠出租自己的时间是无法发财的。");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("calculates next run info and handles incremental watermark skipping", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sched-test-"));
    try {
      const channelSecrets = new ChannelSecretsStore({ dataDir: tmpDir, env: {} });
      channelSecrets.updateSchedule({
        enabled: true,
        mode: "daily",
        daily_time: "04:00",
      });

      const syncHistory = new SyncHistoryStore({ dataDir: tmpDir });

      let fetchBookNotesCalled = false;
      const mockWeread = {
        setApiKey: () => {},
        listNotebooks: async () => ({
          books: [
            {
              bookId: "b_1",
              title: "书A",
              sort: 100,
              totalNotes: 5,
            },
          ],
        }),
        fetchBookNotes: async () => {
          fetchBookNotesCalled = true;
          return { bookmarks: [], reviews: [], chapters: [], book: {} };
        },
        formatBookMarkdown: () => "mock md",
      };

      const mockPipeline = {
        ingestWereadBookNotes: async () => ({ id: "doc_mock" }),
      };

      const scheduler = new SyncScheduler({
        channelSecrets,
        wereadChannel: mockWeread,
        craftChannel: null,
        pipeline: mockPipeline,
        syncHistory,
        store: {},
      });

      scheduler.scheduleNext();
      const nextRun = scheduler.getNextRunInfo();
      assert.ok(nextRun);
      assert.ok(nextRun.time_str.includes("04:00"));

      // Set watermark so book sort <= watermark -> should be skipped!
      channelSecrets.setBookWatermark("weread", "b_1", { last_sort: 100 });
      channelSecrets.updateChannel("weread", { credentials: { api_key: "mock" } });

      const syncRes = await scheduler.runSync({ trigger: "manual" });
      assert.equal(syncRes.ok, true);
      assert.equal(syncRes.booksAffected, 0); // 0 cost skip!
      assert.equal(fetchBookNotesCalled, false);

      scheduler.stop();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
