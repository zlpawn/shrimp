import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("trend intel - navigation and main app registration", () => {
  const main = fs.readFileSync(path.join(root, "desktop/src/main.ts"), "utf8");
  const html = fs.readFileSync(path.join(root, "desktop/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "desktop/src/app.ts"), "utf8");

  assert.match(main, /modules\/trend-intel/);
  assert.match(html, /section-trend-intel/);
  assert.match(html, /trend-intel-root/);
  assert.match(html, /switchTab\('trend-intel'\)/);
  assert.match(html, /热点情报 \(Trend Radar\)/);
  assert.match(app, /'trend-intel'/);
});

test("trend intel - module implements 4 subviews and core REST routes", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/trend-intel.ts"), "utf8");

  // Subviews
  assert.match(source, /"brief"/);
  assert.match(source, /"raw"/);
  assert.match(source, /"explorer"/);
  assert.match(source, /"settings"/);

  // REST API routes
  assert.match(source, /\/v1\/trend-intel\/brief/);
  assert.match(source, /\/v1\/trend-intel\/raw-items/);
  assert.match(source, /\/v1\/trend-intel\/events/);
  assert.match(source, /\/v1\/trend-intel\/config/);
  assert.match(source, /\/v1\/trend-intel\/crawl/);
  assert.match(source, /\/v1\/trend-intel\/generate-brief/);
  assert.match(source, /\/v1\/trend-intel\/events\/.*\/history/);

  // Lifecycle
  assert.match(source, /registerTab\("trend-intel"/);
});

test("trend intel - module implements dynamic focus topics and 3-tier model selector", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/trend-intel.ts"), "utf8");

  // Dynamic focus topics
  assert.match(source, /__trendIntelAddFocusTopic/);
  assert.match(source, /__trendIntelRemoveFocusTopic/);
  assert.match(source, /__trendIntelUpdateTopic/);
  assert.match(source, /focus_topics/);

  // 3-tier cascaded model selector
  assert.match(source, /__trendIntelSelectModelClient/);
  assert.match(source, /__trendIntelSelectModelEndpoint/);
  assert.match(source, /__trendIntelSelectModel/);
  assert.match(source, /model_route/);
});

test("trend intel - module provides AI analysis and ideation prompt actions", () => {
  const source = fs.readFileSync(path.join(root, "desktop/src/modules/trend-intel.ts"), "utf8");

  assert.match(source, /copyRawAnalyzePrompt/);
  assert.match(source, /copyEventIdeatePrompt/);
  assert.match(source, /__trendIntelAnalyzeRaw/);
  assert.match(source, /__trendIntelIdeateEvent/);
  assert.match(source, /__trendIntelCopyBriefMarkdown/);
});

test("trend intel - styles define responsive dashboard and theme support", () => {
  const css = fs.readFileSync(path.join(root, "desktop/src/styles/panel.css"), "utf8");

  assert.match(css, /\.trend-intel-root-wrap/);
  assert.match(css, /\.trend-intel-nav/);
  assert.match(css, /\.trend-intel-sections-grid/);
  assert.match(css, /\.trend-intel-kpi-grid/);
  assert.match(css, /\.trend-intel-table/);
  assert.match(css, /\.trend-intel-events-grid/);
  assert.match(css, /\.trend-intel-trajectory-timeline/);
  assert.match(css, /\.trend-intel-topic-item-card/);
});

test("trend intel - build outputs bundle cleanly", () => {
  const bundleJs = path.join(root, "desktop/dist/panel.bundle.js");
  const bundleCss = path.join(root, "desktop/dist/panel.css");

  assert.ok(fs.existsSync(bundleJs), "panel.bundle.js must exist");
  assert.ok(fs.existsSync(bundleCss), "panel.css must exist");

  const jsContent = fs.readFileSync(bundleJs, "utf8");
  const cssContent = fs.readFileSync(bundleCss, "utf8");

  assert.match(jsContent, /__trendIntelSwitchView/);
  assert.match(jsContent, /trend-intel-root/);
  assert.match(cssContent, /trend-intel-root-wrap/);
});
