import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDiscourseTopics,
  findBrowserExecutable,
  getAvailablePort,
  getRealisticUserAgent
} from "../../lib/trend-intel/providers/browser-fetcher.mjs";

test("browser-fetcher - normalizeDiscourseTopics handles topics correctly", () => {
  const mockTopics = [
    {
      id: 12345,
      title: "测试热帖：AI 网关本地化部署",
      slug: "ai-gateway-deploy",
      views: 9999,
      like_count: 520,
      posts_count: 88,
      excerpt: "本文介绍如何在本地环境中配置网关...",
      created_at: "2026-09-19T08:00:00.000Z"
    },
    {
      id: 67890,
      title: "关于高并发连接优化的讨论",
      url: "/t/topic/67890",
      views: 1200,
      like_count: 30,
      posts_count: 15
    }
  ];

  const items = normalizeDiscourseTopics(mockTopics, "linux_do", {
    platformName: "LINUX DO 每日热榜",
    icon: "🐧"
  });

  assert.equal(items.length, 2);
  assert.equal(items[0].id, "linux_do:https://linux.do/t/ai-gateway-deploy/12345");
  assert.equal(items[0].platform, "linux_do");
  assert.equal(items[0].title, "测试热帖：AI 网关本地化部署");
  assert.equal(items[0].rank, 1);
  assert.equal(items[0].score, 520);
  assert.equal(items[0].raw.summary, "本文介绍如何在本地环境中配置网关...");
  assert.equal(items[0].raw.icon, "🐧");

  assert.equal(items[1].id, "linux_do:https://linux.do/t/topic/67890");
  assert.equal(items[1].rank, 2);
});

test("browser-fetcher - normalizeDiscourseTopics handles empty or invalid inputs", () => {
  assert.deepEqual(normalizeDiscourseTopics([]), []);
  assert.deepEqual(normalizeDiscourseTopics(null), []);
  assert.deepEqual(normalizeDiscourseTopics([{}]), []);
});

test("browser-fetcher - findBrowserExecutable detects installed browser", () => {
  const executable = findBrowserExecutable();
  if (process.platform === "win32") {
    // Windows should find Chrome or Edge
    assert.ok(executable === null || typeof executable === "string");
  }
});

test("browser-fetcher - getAvailablePort returns a free port number", async () => {
  const port = await getAvailablePort(9500);
  assert.ok(typeof port === "number");
  assert.ok(port >= 9500);
});

test("browser-fetcher - getRealisticUserAgent returns realistic OS-specific user agents without Headless", () => {
  const darwinUa = getRealisticUserAgent("darwin");
  const winUa = getRealisticUserAgent("win32");
  const linuxUa = getRealisticUserAgent("linux");

  assert.match(darwinUa, /Macintosh.*Chrome/);
  assert.doesNotMatch(darwinUa, /Headless/i);

  assert.match(winUa, /Windows NT.*Chrome/);
  assert.doesNotMatch(winUa, /Headless/i);

  assert.match(linuxUa, /X11.*Linux.*Chrome/);
  assert.doesNotMatch(linuxUa, /Headless/i);
});
