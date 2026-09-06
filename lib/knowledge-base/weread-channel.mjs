import { formatTimestamp } from "./sync-history.mjs";

const WEREAD_GATEWAY_URL = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.4";

export class WereadChannel {
  constructor({ apiKey = "", baseUrl = WEREAD_GATEWAY_URL } = {}) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  setApiKey(key) {
    this.apiKey = String(key || "").trim();
  }

  async _callApi(apiName, payload = {}) {
    if (!this.apiKey) {
      throw new Error("未配置微信读书 API Key (可在设置中填写 wrk-xxxxxxxx 格式密钥)");
    }

    const body = {
      api_name: apiName,
      skill_version: SKILL_VERSION,
      ...payload,
    };

    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`微信读书 API 请求失败: HTTP ${res.status} ${errText}`);
    }

    const data = await res.json();
    if (data.errcode && data.errcode !== 0) {
      throw new Error(`微信读书接口错误 (${data.errcode}): ${data.errmsg || data.message || "未知错误"}`);
    }

    return data;
  }

  async getStatus() {
    try {
      const res = await this._callApi("/user/notebooks", { count: 1 });
      return {
        connected: true,
        totalBookCount: res.totalBookCount || 0,
        totalNoteCount: res.totalNoteCount || 0,
      };
    } catch (err) {
      return {
        connected: false,
        error: err.message,
      };
    }
  }

  async listNotebooks({ count = 50, lastSort = null, fetchAll = false } = {}) {
    let books = [];
    let curSort = lastSort;
    let pageCount = 0;
    const maxPages = fetchAll ? 20 : 1;

    while (pageCount < maxPages) {
      pageCount++;
      const payload = { count: Math.min(count, 100) };
      if (curSort) payload.lastSort = curSort;

      const res = await this._callApi("/user/notebooks", payload);
      const list = res.books || [];
      books.push(...list);

      if (!res.hasMore || list.length === 0 || !fetchAll) {
        break;
      }
      curSort = list[list.length - 1]?.sort;
      if (!curSort) break;
    }

    // Format notebook items for easy UI display
    const formatted = books.map((item) => {
      const b = item.book || {};
      const noteCount = item.noteCount || 0;
      const reviewCount = item.reviewCount || 0;
      const bookmarkCount = item.bookmarkCount || 0;
      return {
        bookId: item.bookId || b.bookId,
        title: b.title || "未命名书籍",
        author: b.author || "未知作者",
        cover: b.cover || "",
        category: b.category || "",
        readingProgress: item.readingProgress || 0,
        markedStatus: item.markedStatus === 1 ? "已读完" : "在读",
        noteCount,
        reviewCount,
        bookmarkCount,
        totalNotes: noteCount + reviewCount + bookmarkCount,
        sort: item.sort || 0,
        lastNoteTimeStr: item.sort ? formatTimestamp(item.sort) : "",
      };
    });

    return {
      books: formatted,
      totalCount: formatted.length,
    };
  }

  async fetchBookNotes(bookId) {
    if (!bookId) throw new Error("缺少 bookId 参数");

    const [bmRes, revRes, infoRes] = await Promise.all([
      this._callApi("/book/bookmarklist", { bookId }).catch((err) => ({ updated: [], chapters: [], error: err.message })),
      this._callApi("/review/list/mine", { bookid: bookId, count: 100 }).catch((err) => ({ reviews: [], error: err.message })),
      this._callApi("/book/info", { bookId }).catch(() => null),
    ]);

    const book = infoRes || bmRes.book || {};
    const chapters = bmRes.chapters || [];
    const bookmarks = bmRes.updated || [];
    const reviews = (revRes.reviews || []).map((r) => r.review).filter(Boolean);

    return {
      bookId,
      book,
      chapters,
      bookmarks,
      reviews,
    };
  }

  formatBookMarkdown({ bookId, book, chapters, bookmarks = [], reviews = [] }) {
    const title = book.title || "微信读书笔记";
    const author = book.author || "";
    const cover = book.cover || "";
    const intro = book.intro || "";
    const category = book.category || "";
    const deepLink = book.deepLink || `https://weread.qq.com/web/reader/${bookId}`;

    const lines = [];

    // Title & Book Metadata Header
    lines.push(`# ${title}\n`);
    lines.push(`> **作者**：${author || "未知"} · **类别**：${category || "通用"} · [📚 在微信读书中打开原书 ↗](${deepLink})\n`);

    if (cover) {
      lines.push(`<p align="center"><img src="${cover}" alt="${title}" style="max-height: 240px; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);" /></p>\n`);
    }

    if (intro) {
      lines.push(`### 📖 作品简介\n`);
      lines.push(`${intro.trim()}\n`);
    }

    // Stats Card
    lines.push(`---\n`);
    lines.push(`### 📊 笔记统计\n`);
    lines.push(`- **高亮划线**：${bookmarks.length} 条`);
    lines.push(`- **个人想法与书评**：${reviews.length} 条\n`);

    // Group bookmarks & thoughts by chapterUid
    const chapterMap = new Map();
    for (const ch of chapters) {
      chapterMap.set(String(ch.chapterUid), {
        title: ch.title,
        idx: ch.chapterIdx || 0,
        bookmarks: [],
        reviews: [],
      });
    }

    // Assign bookmarks to chapters
    const unassignedBookmarks = [];
    for (const bm of bookmarks) {
      const chKey = String(bm.chapterUid);
      if (chapterMap.has(chKey)) {
        chapterMap.get(chKey).bookmarks.push(bm);
      } else {
        unassignedBookmarks.push(bm);
      }
    }

    // Assign reviews to chapters or book-level
    const bookLevelReviews = [];
    for (const rev of reviews) {
      const chKey = rev.chapterUid ? String(rev.chapterUid) : null;
      if (chKey && chapterMap.has(chKey)) {
        chapterMap.get(chKey).reviews.push(rev);
      } else {
        bookLevelReviews.push(rev);
      }
    }

    // Book-level reviews / overall thoughts
    if (bookLevelReviews.length > 0) {
      lines.push(`### 🌟 整体书评与读后感\n`);
      for (const rev of bookLevelReviews) {
        if (rev.star && rev.star > 0) {
          lines.push(`**评分**：${"⭐".repeat(rev.star)}\n`);
        }
        lines.push(`${rev.content}\n`);
        if (rev.createTime) {
          lines.push(`<span style="font-size: 11px; color: #888;">— 评论于 ${formatTimestamp(rev.createTime)}</span>\n`);
        }
      }
      lines.push(`---\n`);
    }

    // Render Chapters
    lines.push(`## 📑 章节划线与精读笔记\n`);

    const sortedChapters = Array.from(chapterMap.values()).sort((a, b) => a.idx - b.idx);
    let renderedCount = 0;

    for (const ch of sortedChapters) {
      if (ch.bookmarks.length === 0 && ch.reviews.length === 0) continue;
      renderedCount++;
      lines.push(`### ${ch.title || `第 ${ch.idx} 章`}\n`);

      // Match thoughts that belong to a specific underline (via abstract)
      const matchedReviewIds = new Set();

      for (const bm of ch.bookmarks) {
        lines.push(`> ${bm.markText.trim()}\n`);
        const timeStr = bm.createTime ? formatTimestamp(bm.createTime) : "";
        lines.push(`<span style="font-size: 11px; color: #888;">📌 划线于 ${timeStr}</span>\n`);

        // Find review attached to this underline
        const attachedRev = ch.reviews.find((r) => !matchedReviewIds.has(r.reviewId) && r.abstract && bm.markText.includes(r.abstract.trim()));
        if (attachedRev) {
          matchedReviewIds.add(attachedRev.reviewId);
          lines.push(`💭 **想法**：${attachedRev.content.trim()}\n`);
        }
      }

      // Remaining reviews in this chapter
      for (const rev of ch.reviews) {
        if (!matchedReviewIds.has(rev.reviewId)) {
          lines.push(`💭 **章节点评**：${rev.content.trim()}`);
          if (rev.createTime) {
            lines.push(`<span style="font-size: 11px; color: #888;">— 批注于 ${formatTimestamp(rev.createTime)}</span>\n`);
          } else {
            lines.push("\n");
          }
        }
      }

      lines.push("");
    }

    if (unassignedBookmarks.length > 0) {
      lines.push(`### 其它划线摘录\n`);
      for (const bm of unassignedBookmarks) {
        lines.push(`> ${bm.markText.trim()}\n`);
        if (bm.createTime) {
          lines.push(`<span style="font-size: 11px; color: #888;">📌 划线于 ${formatTimestamp(bm.createTime)}</span>\n`);
        }
      }
    }

    if (renderedCount === 0 && unassignedBookmarks.length === 0) {
      lines.push(`*本书暂未提取到有效章节划线*`);
    }

    return lines.join("\n");
  }
}
