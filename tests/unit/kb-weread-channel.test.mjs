import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { WereadChannel } from "../../lib/knowledge-base/weread-channel.mjs";

describe("WereadChannel: API & Markdown Formatter", () => {
  it("formats book notes to structured markdown with metadata, chapters, underlines, and reviews", () => {
    const channel = new WereadChannel({ apiKey: "test-key" });

    const mockData = {
      bookId: "123456",
      book: {
        title: "被讨厌的勇气",
        author: "岸见一郎 / 古贺史健",
        category: "心理学",
        cover: "https://wfqqreader-1252317822.image.myqcloud.com/cover/456/123456/t6_123456.jpg",
        intro: "“被讨厌的勇气”并不是要去吸引被讨厌的负向能量，而是有直面被讨厌的勇气。",
        deepLink: "https://weread.qq.com/web/reader/123456",
      },
      chapters: [
        { chapterUid: 1, chapterIdx: 1, title: "引言" },
        { chapterUid: 2, chapterIdx: 2, title: "第一夜 我们的不幸是谁的错" },
      ],
      bookmarks: [
        {
          bookmarkId: "bm_1",
          chapterUid: 2,
          markText: "所谓的自由，就是被人讨厌。",
          createTime: 1788698000,
        },
        {
          bookmarkId: "bm_2",
          chapterUid: 2,
          markText: "决定我们自身的不是过去的经历，而是我们自己赋予经历的意义。",
          createTime: 1788698100,
        },
      ],
      reviews: [
        {
          reviewId: "rev_1",
          content: "阿德勒心理学是勇气的心理学，不是决定论，而是目的论！",
          abstract: "决定我们自身的不是过去的经历",
          chapterUid: 2,
          createTime: 1788698200,
        },
        {
          reviewId: "rev_book",
          content: "彻底颠覆三观的一本书，读完受益匪浅。",
          star: 5,
          isFinish: 1,
          createTime: 1788698300,
        },
      ],
    };

    const md = channel.formatBookMarkdown(mockData);

    assert.ok(md.includes("# 被讨厌的勇气"));
    assert.ok(md.includes("岸见一郎 / 古贺史健"));
    assert.ok(md.includes("[📚 在微信读书中打开原书 ↗](https://weread.qq.com/web/reader/123456)"));
    assert.ok(md.includes("### 📖 作品简介"));
    assert.ok(md.includes("### 第一夜 我们的不幸是谁的错"));
    assert.ok(md.includes("> 所谓的自由，就是被人讨厌。"));
    assert.ok(md.includes("💭 **想法**：阿德勒心理学是勇气的心理学"));
    assert.ok(md.includes("### 🌟 整体书评与读后感"));
    assert.ok(md.includes("⭐⭐⭐⭐⭐"));
  });

  it("calls API gateway with flattened body and skill_version: 1.0.4", async () => {
    let capturedReq = null;
    let authHeader = "";

    const server = http.createServer((req, res) => {
      authHeader = req.headers.authorization;
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        capturedReq = JSON.parse(body);
        if (capturedReq.api_name === "/user/notebooks") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            errcode: 0,
            totalBookCount: 1,
            totalNoteCount: 10,
            books: [
              {
                bookId: "b_1",
                book: { title: "测试书名", author: "测试作者" },
                noteCount: 8,
                reviewCount: 2,
                sort: 1788699000,
              },
            ],
          }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });

    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const mockUrl = `http://127.0.0.1:${port}/api/agent/gateway`;

    try {
      const channel = new WereadChannel({ apiKey: "wrk-mock-key-123", baseUrl: mockUrl });

      const status = await channel.getStatus();
      assert.equal(status.connected, true);
      assert.equal(status.totalBookCount, 1);
      assert.equal(authHeader, "Bearer wrk-mock-key-123");
      assert.equal(capturedReq.skill_version, "1.0.4");
      assert.equal(capturedReq.api_name, "/user/notebooks");

      const notebooks = await channel.listNotebooks({ count: 10 });
      assert.equal(notebooks.books.length, 1);
      assert.equal(notebooks.books[0].title, "测试书名");
      assert.equal(notebooks.books[0].totalNotes, 10);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
