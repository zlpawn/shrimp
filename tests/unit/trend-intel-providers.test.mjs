import test from "node:test";
import assert from "node:assert/strict";
import { parseNewsNowResponse, fetchNewsNowPlatform } from "../../lib/trend-intel/providers/newsnow.mjs";
import { parseRssXml, fetchRssFeed } from "../../lib/trend-intel/providers/rss.mjs";
import { PLATFORMS, getPlatform, isSupportedPlatform, listPlatforms } from "../../lib/trend-intel/providers/platforms.mjs";
import { resolveProxyUrl, createProxyAgent, fetchWithProxy } from "../../lib/trend-intel/providers/proxy-helper.mjs";
import { crawlAllActivePlatforms } from "../../lib/trend-intel/providers/index.mjs";

test("platforms - should contain major platforms", () => {
  assert.ok(PLATFORMS.weibo);
  assert.ok(PLATFORMS.zhihu);
  assert.ok(PLATFORMS.baidu);
  assert.ok(PLATFORMS.bilibili);
  assert.ok(PLATFORMS.douyin);
  assert.ok(PLATFORMS.toutiao);
  assert.ok(PLATFORMS.github);
  assert.ok(PLATFORMS["36kr"]);
  assert.ok(PLATFORMS.wallstreetcn);
  assert.equal(PLATFORMS.weibo.name, "微博热搜");
  assert.equal(getPlatform("zhihu")?.name, "知乎热榜");
  assert.equal(getPlatform(null), null);
  assert.equal(isSupportedPlatform("baidu"), true);
  assert.equal(isSupportedPlatform("non_existent"), false);
  assert.equal(isSupportedPlatform(""), false);
  assert.ok(listPlatforms().length >= 9);
});

test("proxy-helper - resolveProxyUrl should handle direct, custom, and inherit modes", () => {
  // direct mode
  assert.equal(resolveProxyUrl({ mode: "direct", custom_url: "http://127.0.0.1:8080" }), null);

  // custom mode
  assert.equal(
    resolveProxyUrl({ mode: "custom", custom_url: "http://127.0.0.1:7890" }),
    "http://127.0.0.1:7890"
  );
  assert.equal(resolveProxyUrl({ mode: "custom", custom_url: "" }), null);

  // inherit mode with env
  const fakeEnv = { HTTPS_PROXY: "http://proxy.internal:8888" };
  assert.equal(
    resolveProxyUrl({ mode: "inherit" }, fakeEnv),
    "http://proxy.internal:8888"
  );
  assert.equal(resolveProxyUrl({}, fakeEnv), "http://proxy.internal:8888");

  // inherit mode without env
  assert.equal(resolveProxyUrl({ mode: "inherit" }, {}), null);
});

test("proxy-helper - createProxyAgent should instantiate appropriate agent", () => {
  const httpAgent = createProxyAgent("http://127.0.0.1:7890");
  assert.ok(httpAgent);

  const socksAgent = createProxyAgent("socks5://127.0.0.1:1080");
  assert.ok(socksAgent);

  assert.equal(createProxyAgent(""), null);
  assert.equal(createProxyAgent(null), null);
  assert.equal(createProxyAgent("invalid-protocol://foo"), null);
});

test("proxy-helper - fetchWithProxy should support custom fetchImpl and timeouts", async () => {
  let calledUrl = "";
  const mockFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      text: async () => "ok",
      json: async () => ({ success: true })
    };
  };

  const res = await fetchWithProxy("https://example.com/api", {
    fetchImpl: mockFetch
  });
  assert.equal(calledUrl, "https://example.com/api");
  assert.equal(res.ok, true);
});

test("newsnow - should parse standard newsnow payload into Standard Items", () => {
  const fakePayload = {
    status: "success",
    id: "weibo",
    updatedTime: 1724650000000,
    data: [
      { id: "1", title: "测试热搜1", url: "https://s.weibo.com/1", hot: 1200000 },
      { id: "2", title: "测试热搜2", url: "https://s.weibo.com/2", hot: 800000 }
    ]
  };
  const items = parseNewsNowResponse("weibo", fakePayload);
  assert.equal(items.length, 2);
  assert.equal(items[0].rank, 1);
  assert.equal(items[0].platform, "weibo");
  assert.equal(items[0].title, "测试热搜1");
  assert.equal(items[0].url, "https://s.weibo.com/1");
  assert.equal(items[0].score, 1200000);
  assert.ok(items[0].raw);
  assert.equal(items[1].rank, 2);
});

test("newsnow - should handle malformed or empty payloads gracefully", () => {
  assert.deepEqual(parseNewsNowResponse("weibo", null), []);
  assert.deepEqual(parseNewsNowResponse("weibo", {}), []);
  assert.deepEqual(parseNewsNowResponse("weibo", { data: "not-an-array" }), []);
  
  const payloadWithNestedItems = {
    data: {
      items: [
        { name: "嵌套items格式", heat: "5000" }
      ]
    }
  };
  const items = parseNewsNowResponse("zhihu", payloadWithNestedItems);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "嵌套items格式");
  assert.equal(items[0].score, 5000);
  assert.equal(items[0].rank, 1);
});

test("newsnow - fetchNewsNowPlatform should fetch and parse with retries", async () => {
  let callCount = 0;
  const mockFetch = async (url) => {
    callCount++;
    if (callCount === 1) {
      return {
        ok: false,
        status: 500,
        text: async () => "Internal Server Error"
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: "success",
        data: [{ id: "101", title: "重试成功标题", url: "https://example.com/101", hot: 999 }]
      })
    };
  };

  const items = await fetchNewsNowPlatform("weibo", {
    fetchImpl: mockFetch,
    retries: 2,
    retryDelay: 10
  });

  assert.equal(callCount, 2);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "重试成功标题");
});

test("newsnow - fetchNewsNowPlatform should not retry on HTTP 404", async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount++;
    return {
      ok: false,
      status: 404,
      text: async () => "Platform Not Found"
    };
  };

  await assert.rejects(
    () => fetchNewsNowPlatform("invalid_platform", {
      fetchImpl: mockFetch,
      retries: 3,
      retryDelay: 10
    }),
    /HTTP 404/
  );
  assert.equal(callCount, 1); // no retries for 404
});

test("rss - should parse standard RSS XML feed", () => {
  const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0">
    <channel>
      <title>科技快讯</title>
      <item>
        <title><![CDATA[某科技公司发布新一代产品 &amp; 评测]]></title>
        <link>https://example.com/news/1</link>
        <pubDate>Wed, 26 Aug 2026 08:00:00 GMT</pubDate>
        <description><![CDATA[产品详细介绍与评测...]]></description>
      </item>
    </channel>
  </rss>`;
  const items = parseRssXml("tech_rss", sampleXml, "https://example.com/rss");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "某科技公司发布新一代产品 & 评测");
  assert.equal(items[0].url, "https://example.com/news/1");
  assert.equal(items[0].platform, "tech_rss");
  assert.equal(items[0].source, "rss");
  assert.ok(items[0].raw);
});

test("rss - should parse Atom XML feed format and resolve relative links", () => {
  const sampleAtom = `<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
    <title>GitHub Trending RSS</title>
    <entry>
      <title>awesome-project</title>
      <link href="/example/awesome-project"/>
      <id>tag:github.com,2026:awesome-project</id>
      <updated>2026-08-26T08:00:00Z</updated>
      <summary>A great project</summary>
    </entry>
  </feed>`;
  const items = parseRssXml("github_atom", sampleAtom, "https://github.com/trending");
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "awesome-project");
  assert.equal(items[0].url, "https://github.com/example/awesome-project");
  assert.equal(items[0].rank, 1);
});

test("rss - parseRssXml should handle empty or malformed xml gracefully", () => {
  assert.deepEqual(parseRssXml("tech", ""), []);
  assert.deepEqual(parseRssXml("tech", null), []);
  assert.deepEqual(parseRssXml("tech", "<root><no-items/></root>"), []);
});

test("rss - fetchRssFeed should fetch and parse feed", async () => {
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => `
      <rss version="2.0">
        <channel>
          <item>
            <title>Feed Item 1</title>
            <link>https://news.example.com/1</link>
          </item>
        </channel>
      </rss>
    `
  });

  const items = await fetchRssFeed("https://news.example.com/rss", {
    fetchImpl: mockFetch,
    sourceId: "my_feed"
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Feed Item 1");
  assert.equal(items[0].platform, "my_feed");
});

test("index - crawlAllActivePlatforms should orchestrate fetching across active platforms and RSS sources with error resilience", async () => {
  const errorsReported = [];
  const successesReported = [];

  const mockFetch = async (url) => {
    if (url.includes("id=failing_platform")) {
      return {
        ok: false,
        status: 500,
        text: async () => "Internal error"
      };
    }
    if (url.includes("newsnow.busiyi.world")) {
      const parsedUrl = new URL(url);
      const id = parsedUrl.searchParams.get("id") || "unknown";
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: "success",
          data: [
            { id: `${id}_1`, title: `${id} 热点1`, url: `https://${id}.com/1`, hot: 1000 }
          ]
        })
      };
    }
    if (url.includes("failing-feed.com")) {
      throw new Error("DNS resolution failed");
    }
    if (url.includes("feed.com")) {
      return {
        ok: true,
        status: 200,
        text: async () => `
          <rss version="2.0">
            <channel>
              <item>
                <title>RSS 科技头条</title>
                <link>https://tech.feed.com/1</link>
              </item>
            </channel>
          </rss>
        `
      };
    }
    return {
      ok: false,
      status: 404,
      text: async () => "Not Found"
    };
  };

  const config = {
    platforms: {
      weibo: true,
      zhihu: true,
      baidu: false, // disabled
      failing_platform: true
    },
    focus_topics: [
      {
        id: "topic_ai",
        name: "人工智能",
        enabled: true,
        rss_sources: ["https://feed.com/ai.xml", "https://failing-feed.com/rss"]
      },
      {
        id: "topic_disabled",
        name: "已停用话题",
        enabled: false,
        rss_sources: ["https://feed.com/disabled.xml"]
      }
    ],
    proxy: {
      mode: "direct"
    }
  };

  const items = await crawlAllActivePlatforms(config, {
    fetchImpl: mockFetch,
    concurrency: 2,
    retries: 1,
    onPlatformSuccess: (p) => successesReported.push(p),
    onPlatformError: (p, err) => errorsReported.push({ type: "platform", id: p, err }),
    onRssSuccess: (u) => successesReported.push(u),
    onRssError: (u, err) => errorsReported.push({ type: "rss", id: u, err })
  });

  assert.ok(items.length >= 3);
  const platformsCrawled = new Set(items.map((i) => i.platform));
  assert.ok(platformsCrawled.has("weibo"));
  assert.ok(platformsCrawled.has("zhihu"));
  assert.ok(!platformsCrawled.has("baidu"));
  assert.ok(platformsCrawled.has("topic_ai"));

  // Check error reporting
  assert.equal(errorsReported.length, 2);
  assert.ok(errorsReported.some((e) => e.id === "failing_platform"));
  assert.ok(errorsReported.some((e) => e.id === "https://failing-feed.com/rss"));
});
