import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWebScraper, rewriteHtmlImages, extractImageUrlsFromHtml } from "../../lib/knowledge-base/scraper.mjs";

test("Scraper: extractImageUrlsFromHtml finds all img src and data-src", () => {
  const html = `
    <html>
      <head><title>测试文章</title></head>
      <body>
        <h1>标题</h1>
        <p>正文一</p>
        <img src="https://example.com/pic1.png" alt="图1" />
        <p>正文二</p>
        <img data-src="https://example.com/pic2.jpg" class="lazy" />
        <img src="data:image/png;base64,iVBORw0KGgo..." />
      </body>
    </html>
  `;
  const urls = extractImageUrlsFromHtml(html, "https://example.com/article/1");
  assert.equal(urls.includes("https://example.com/pic1.png"), true);
  assert.equal(urls.includes("https://example.com/pic2.jpg"), true);
  // Base64 data urls should be skipped
  assert.equal(urls.some(u => u.startsWith("data:")), false);
});

test("Scraper: rewriteHtmlImages maps remote image tags to local asset paths", () => {
  const html = `<html><body><article><p>Hello</p><img src="https://example.com/img1.png" alt="Test"/><img data-src="https://example.com/img2.jpg"/></article></body></html>`;
  const imageMap = new Map([
    ["https://example.com/img1.png", "/v1/kb/files/doc_123/assets/img_0.png"],
    ["https://example.com/img2.jpg", "/v1/kb/files/doc_123/assets/img_1.jpg"],
  ]);
  const rewritten = rewriteHtmlImages(html, imageMap);
  assert.equal(rewritten.includes("/v1/kb/files/doc_123/assets/img_0.png"), true);
  assert.equal(rewritten.includes("/v1/kb/files/doc_123/assets/img_1.jpg"), true);
  assert.equal(rewritten.includes("https://example.com/img1.png"), false);
});

test("Scraper: extractTitleFromHtml extracts title correctly", () => {
  const scraper = createWebScraper({});
  const html1 = "<html><head><title>我的博客文章 - 知识库</title></head><body></body></html>";
  const title1 = scraper.extractTitle(html1);
  assert.equal(title1, "我的博客文章 - 知识库");

  const html2 = "<html><body><h1>正文大标题</h1><p>内容</p></body></html>";
  const title2 = scraper.extractTitle(html2);
  assert.equal(title2, "正文大标题");
});
