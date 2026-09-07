import test from "node:test";
import assert from "node:assert/strict";
import { createFxRateService } from "../../lib/analytics/fx-rate.mjs";

test("getRate returns default rate on startup", () => {
  const svc = createFxRateService();
  const rate = svc.getRate();
  assert.equal(typeof rate.usd_to_cny, "number");
  assert.ok(rate.usd_to_cny > 0);
  assert.equal(typeof rate.source, "string");
  assert.equal(typeof rate.updated_at, "number");
});

test("getRate returns a reasonable CNY rate (>5, <10)", () => {
  const svc = createFxRateService();
  const rate = svc.getRate();
  assert.ok(rate.usd_to_cny > 5, `expected > 5, got ${rate.usd_to_cny}`);
  assert.ok(rate.usd_to_cny < 10, `expected < 10, got ${rate.usd_to_cny}`);
});
test("setRefreshIntervalHours re-arms the refresh timer", () => {
  const svc = createFxRateService();
  assert.equal(svc.getRefreshIntervalMs(), 6 * 60 * 60 * 1000);
  svc.setRefreshIntervalHours(12);
  assert.equal(svc.getRefreshIntervalMs(), 12 * 60 * 60 * 1000);
  // Floor of 1h
  svc.setRefreshIntervalHours(0.5);
  assert.equal(svc.getRefreshIntervalMs(), 60 * 60 * 1000);
});

test("stopRefresh/startRefresh control the background timer", () => {
  const svc = createFxRateService();
  svc.stopRefresh();
  // No throw on double stop; restart re-arms silently
  svc.stopRefresh();
  svc.startRefresh();
  svc.startRefresh();
  assert.equal(typeof svc.getRate().usd_to_cny, "number");
});
