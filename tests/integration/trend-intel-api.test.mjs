import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTrendIntelService } from "../../lib/trend-intel/service.mjs";
import { createTrendIntelScheduler } from "../../lib/trend-intel/scheduler.mjs";
import { routeTrendIntelRequest } from "../../lib/trend-intel/routes.mjs";

function createMockFetch(responses = {}) {
  return async (url, options) => {
    const urlStr = String(url);
    for (const [pattern, handler] of Object.entries(responses)) {
      if (urlStr.includes(pattern)) {
        if (typeof handler === "function") {
          return handler(urlStr, options);
        }
        return new Response(JSON.stringify(handler), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    }
    // Default NewsNow mock response
    return new Response(JSON.stringify({
      status: "success",
      data: [
        { id: "mock-1", title: "DeepSeek 发布新一代开源大模型推理引擎", url: "https://example.com/1", hot_value: "950000" },
        { id: "mock-2", title: "OpenAI 发布 GPT-5 预览版技术报告", url: "https://example.com/2", hot_value: "880000" },
        { id: "mock-3", title: "某明星现身时尚红毯造型引发讨论", url: "https://example.com/3", hot_value: "500000" }
      ]
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
}

test("routes - GET /v1/trend-intel/config returns valid config", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const service = createTrendIntelService({ dataDir });
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/config`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.focus_topics);
    assert.ok(data.scheduler);
    assert.ok(data.platforms);
  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("routes - PUT /v1/trend-intel/config updates config", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const service = createTrendIntelService({ dataDir });
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const putRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scheduler: { interval_minutes: 15 },
        platforms: { weibo: false }
      })
    });
    assert.equal(putRes.status, 200);
    const updated = await putRes.json();
    assert.equal(updated.scheduler.interval_minutes, 15);
    assert.equal(updated.platforms.weibo, false);

    const getRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/config`);
    const fetched = await getRes.json();
    assert.equal(fetched.scheduler.interval_minutes, 15);
    assert.equal(fetched.platforms.weibo, false);
  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("routes - POST /v1/trend-intel/crawl executes crawl and records items & snapshots", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const mockFetch = createMockFetch();
  const service = createTrendIntelService({ dataDir, fetchImpl: mockFetch });
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const crawlRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/crawl`, {
      method: "POST"
    });
    assert.equal(crawlRes.status, 200);
    const crawlData = await crawlRes.json();
    assert.ok(crawlData.count > 0);

    // Verify raw-items endpoint
    const rawRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/raw-items?limit=10`);
    assert.equal(rawRes.status, 200);
    const rawData = await rawRes.json();
    const items = rawData.items || rawData;
    assert.ok(Array.isArray(items));
    assert.ok(items.length > 0);
  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("routes - POST /v1/trend-intel/generate-brief and GET /v1/trend-intel/brief & events", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const mockFetch = createMockFetch();
  const service = createTrendIntelService({ dataDir, fetchImpl: mockFetch });
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    // 1. Initial crawl
    await fetch(`http://127.0.0.1:${port}/v1/trend-intel/crawl`, { method: "POST" });

    // 2. Generate brief
    const genRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/generate-brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-08-26" })
    });
    assert.equal(genRes.status, 200);
    const genData = await genRes.json();
    assert.ok(genData.brief);
    assert.ok(genData.brief.markdown.includes("每日热点与趋势情报简报"));
    assert.ok(Array.isArray(genData.events));

    // Verify artifact export
    assert.ok(fs.existsSync(path.join(dataDir, "latest_brief.md")));
    assert.ok(fs.existsSync(path.join(dataDir, "latest_events.json")));

    // 3. GET /v1/trend-intel/brief
    const briefRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/brief`);
    assert.equal(briefRes.status, 200);
    const briefData = await briefRes.json();
    assert.equal(briefData.date, "2026-08-26");
    assert.ok(briefData.markdown.includes("① 今天必须知道"));

    // 4. GET /v1/trend-intel/events
    const eventsRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/events`);
    assert.equal(eventsRes.status, 200);
    const eventsData = await eventsRes.json();
    const eventsList = eventsData.events || eventsData;
    assert.ok(Array.isArray(eventsList));
    assert.ok(eventsList.length > 0);

    const firstEvent = eventsList[0];
    assert.ok(firstEvent.event_id);

    // 5. GET /v1/trend-intel/events/:id/history
    const histRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/events/${firstEvent.event_id}/history`);
    assert.equal(histRes.status, 200);
    const histData = await histRes.json();
    assert.equal(histData.event.event_id, firstEvent.event_id);
    assert.ok(Array.isArray(histData.snapshots));

    // 6. Non-existent event history returns 404
    const notFoundHistRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/events/non-existent-id/history`);
    assert.equal(notFoundHistRes.status, 404);
  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("routes - POST /v1/trend-intel/generate-brief automatically crawls if database is empty", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const mockFetch = createMockFetch();
  const service = createTrendIntelService({ dataDir, fetchImpl: mockFetch });
  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      res.statusCode = 404;
      res.end();
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    // Generate brief directly WITHOUT prior crawl
    const genRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/generate-brief`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-08-27" })
    });
    assert.equal(genRes.status, 200);
    const genData = await genRes.json();
    assert.ok(genData.brief);
    assert.ok(Array.isArray(genData.events));
    assert.ok(genData.events.length > 0);
  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("routes - unknown trend-intel subpath returns 404 and unhandled returns false", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const service = createTrendIntelService({ dataDir });
  let nonIntelHandled = true;

  const server = http.createServer(async (req, res) => {
    const handled = await routeTrendIntelRequest(req, res, service);
    if (!handled) {
      nonIntelHandled = false;
      res.statusCode = 404;
      res.end("NOT_TREND_INTEL");
    }
  });

  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  try {
    const unknownRes = await fetch(`http://127.0.0.1:${port}/v1/trend-intel/unknown-action`);
    assert.equal(unknownRes.status, 404);
    const unknownJson = await unknownRes.json();
    assert.equal(unknownJson.error.type, "not_found");

    const otherRes = await fetch(`http://127.0.0.1:${port}/v1/other-service/test`);
    assert.equal(otherRes.status, 404);
    const text = await otherRes.text();
    assert.equal(text, "NOT_TREND_INTEL");
    assert.equal(nonIntelHandled, false);
  } finally {
    server.close();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("scheduler - start, stop and status lifecycle", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "trend-intel-route-test-"));
  const mockFetch = createMockFetch();
  const service = createTrendIntelService({ dataDir, fetchImpl: mockFetch });
  const scheduler = createTrendIntelScheduler(service, {
    intervalMinutes: 1,
    dailyBriefTimes: ["12:00"]
  });

  try {
    const statusBefore = scheduler.getStatus();
    assert.equal(statusBefore.running, false);

    scheduler.start();
    const statusRunning = scheduler.getStatus();
    assert.equal(statusRunning.running, true);

    scheduler.stop();
    const statusStopped = scheduler.getStatus();
    assert.equal(statusStopped.running, false);
  } finally {
    scheduler.stop();
    service.destroy();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
