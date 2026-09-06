import { formatTimestamp } from "./sync-history.mjs";

export class SyncScheduler {
  constructor({ channelSecrets, wereadChannel, craftChannel, pipeline, syncHistory, store }) {
    this.channelSecrets = channelSecrets;
    this.wereadChannel = wereadChannel;
    this.craftChannel = craftChannel;
    this.pipeline = pipeline;
    this.syncHistory = syncHistory;
    this.store = store;

    this._timer = null;
    this._running = false;
    this._nextRunTimestamp = null;
  }

  start() {
    this.scheduleNext();

    // Check sync_on_startup
    const config = this.channelSecrets.load();
    if (config.schedule?.enabled && config.schedule?.sync_on_startup) {
      setTimeout(() => {
        void this.runSync({ trigger: "startup" });
      }, 5000);
    }
  }

  stop() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._nextRunTimestamp = null;
  }

  restart() {
    this.stop();
    this.start();
  }

  getNextRunInfo() {
    if (!this._nextRunTimestamp) return null;
    return {
      timestamp: this._nextRunTimestamp,
      time_str: formatTimestamp(this._nextRunTimestamp),
    };
  }

  scheduleNext() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }

    const config = this.channelSecrets.load();
    const schedule = config.schedule || {};

    if (!schedule.enabled) {
      this._nextRunTimestamp = null;
      return;
    }

    const now = Date.now();
    let delayMs = 60000; // default 1 min fallback

    if (schedule.mode === "daily") {
      const [hStr, mStr] = String(schedule.daily_time || "04:00").split(":");
      const targetHour = parseInt(hStr || "4", 10);
      const targetMinute = parseInt(mStr || "0", 10);

      const target = new Date(now);
      target.setHours(targetHour, targetMinute, 0, 0);

      if (target.getTime() <= now + 1000) {
        // Target time already passed today, target tomorrow
        target.setDate(target.getDate() + 1);
      }
      delayMs = Math.max(target.getTime() - now, 5000);
      this._nextRunTimestamp = target.getTime();
    } else {
      // interval mode
      const hours = Math.max(Number(schedule.interval_hours) || 12, 1);
      delayMs = hours * 3600 * 1000;
      this._nextRunTimestamp = now + delayMs;
    }

    this._timer = setTimeout(() => {
      void this.runSync({ trigger: "schedule" });
    }, delayMs);
  }

  async runSync({ trigger = "manual" } = {}) {
    if (this._running) {
      return { ok: false, error: "增量同步任务正在运行中，请稍候..." };
    }

    this._running = true;
    const startTime = Date.now();
    let totalHighlights = 0;
    let totalReviews = 0;
    let booksAffected = 0;
    const collectedItems = [];
    const errors = [];

    try {
      const config = this.channelSecrets.load();
      const targetCollectionId = config.schedule?.target_collection_id || "col_default";

      // 1. WeRead Sync
      const wereadConfig = config.channels?.weread || {};
      if (wereadConfig.enabled) {
        try {
          const wereadResult = await this._syncWeReadIncremental({
            targetCollectionId,
            wereadConfig,
          });
          totalHighlights += wereadResult.highlightsCount;
          totalReviews += wereadResult.reviewsCount;
          booksAffected += wereadResult.booksAffected;
          collectedItems.push(...wereadResult.items);
        } catch (err) {
          console.error("[SyncScheduler] 微信读书增量同步失败:", err);
          errors.push(`微信读书: ${err.message}`);
        }
      }

      // Record Sync History
      const isSuccess = errors.length === 0;
      let summary = "";
      if (booksAffected > 0 || totalHighlights > 0 || totalReviews > 0) {
        summary = `增量同步成功：共更新 ${booksAffected} 本书，新增 ${totalHighlights} 条划线与 ${totalReviews} 条想法`;
      } else {
        summary = isSuccess ? "检查完毕，所有书籍划线与笔记均已是最新状态" : `同步出现异常: ${errors.join("; ")}`;
      }

      this.syncHistory.recordSync({
        channel: "all",
        channelName: "多渠道增量同步",
        status: isSuccess ? "success" : "failed",
        summary,
        error: errors.length > 0 ? errors.join("; ") : null,
        booksAffected,
        highlightsCount: totalHighlights,
        reviewsCount: totalReviews,
        items: collectedItems,
      });

      // Update Channel State
      this.channelSecrets.updateChannelSyncState("weread", {
        last_synced_at: startTime,
        last_status: isSuccess ? "success" : "failed",
        last_summary: summary,
      });

      return {
        ok: isSuccess,
        summary,
        booksAffected,
        highlightsCount: totalHighlights,
        reviewsCount: totalReviews,
        itemsCount: collectedItems.length,
        errors,
      };
    } finally {
      this._running = false;
      this.scheduleNext();
    }
  }

  async _syncWeReadIncremental({ targetCollectionId, wereadConfig }) {
    const apiKey = this.channelSecrets.getChannelCredential("weread", "api_key");
    if (!apiKey) {
      throw new Error("未配置微信读书 API Key");
    }
    this.wereadChannel.setApiKey(apiKey);

    const notebooksRes = await this.wereadChannel.listNotebooks({ count: 100, fetchAll: true });
    const books = notebooksRes.books || [];

    const watermarks = wereadConfig.sync_state?.book_watermarks || {};
    let booksAffected = 0;
    let highlightsCount = 0;
    let reviewsCount = 0;
    const items = [];

    for (const b of books) {
      const bookId = b.bookId;
      const curSort = b.sort || 0;
      const lastSort = watermarks[bookId]?.last_sort || 0;

      // If sort hasn't changed and book was already synced, skip!
      if (lastSort > 0 && curSort <= lastSort) {
        continue;
      }

      // Fetch full details & notes
      const notesData = await this.wereadChannel.fetchBookNotes(bookId);
      const markdown = this.wereadChannel.formatBookMarkdown(notesData);

      // Ingest or update in KB pipeline
      const doc = await this.pipeline.ingestWereadBookNotes({
        bookId,
        title: `《${b.title}》微信读书精读笔记`,
        author: b.author,
        cover: b.cover,
        readingProgress: b.readingProgress,
        category: b.category,
        collectionId: targetCollectionId,
        markdown,
        deepLink: notesData.book?.deepLink || `https://weread.qq.com/web/reader/${bookId}`,
      });

      // Track newly added highlights
      const newBookmarks = (notesData.bookmarks || []).filter((bm) => {
        return !lastSort || (bm.createTime && bm.createTime > lastSort);
      });
      const newReviews = (notesData.reviews || []).filter((rev) => {
        return !lastSort || (rev.createTime && rev.createTime > lastSort);
      });

      for (const bm of newBookmarks) {
        items.push({
          type: "highlight",
          book_id: bookId,
          book_title: b.title,
          chapter_title: notesData.chapters.find((c) => String(c.chapterUid) === String(bm.chapterUid))?.title || "章节划线",
          mark_text: bm.markText,
          create_time: bm.createTime,
          deep_link: notesData.book?.deepLink || `https://weread.qq.com/web/reader/${bookId}`,
          doc_id: doc.id,
        });
      }

      for (const rev of newReviews) {
        items.push({
          type: "review",
          book_id: bookId,
          book_title: b.title,
          chapter_title: rev.chapterName || "读后感/批注",
          mark_text: rev.content,
          create_time: rev.createTime,
          deep_link: notesData.book?.deepLink || `https://weread.qq.com/web/reader/${bookId}`,
          doc_id: doc.id,
        });
      }

      highlightsCount += newBookmarks.length;
      reviewsCount += newReviews.length;
      booksAffected++;

      // Update watermark
      this.channelSecrets.setBookWatermark("weread", bookId, {
        last_sort: curSort,
        note_count: b.totalNotes,
        title: b.title,
        doc_id: doc.id,
      });
    }

    return {
      booksAffected,
      highlightsCount,
      reviewsCount,
      items,
    };
  }
}
