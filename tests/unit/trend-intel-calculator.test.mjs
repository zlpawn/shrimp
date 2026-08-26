import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateVelocity,
  calculateVelocityAndState,
  calculateMultiPlatformSpread,
  TREND_STATES
} from "../../lib/trend-intel/engine/trend-calculator.mjs";

test("trend-calculator - constants should define all 6 trend states", () => {
  assert.ok(Array.isArray(TREND_STATES));
  assert.deepEqual(TREND_STATES, ["NEW", "RISING", "RAPID_RISING", "PEAK", "DECLINING", "DEAD"]);
});

test("trend-calculator - should detect RAPID_RISING when rank jumps significantly", () => {
  const now = Date.now();
  const snapshots = [
    { rank: 28, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 14, recorded_at: new Date(now - 1800000).toISOString() },
    { rank: 3, recorded_at: new Date(now).toISOString() }
  ];
  const res = calculateVelocityAndState(snapshots, { platformCount: 3 });
  assert.equal(res.state, "RAPID_RISING");
  assert.ok(res.velocity > 10);
  assert.equal(res.currentRank, 3);
  assert.equal(res.deltaRank, 25);
});

test("trend-calculator - should detect PEAK and DECLINING", () => {
  const now = Date.now();
  const peakSnapshots = [
    { rank: 2, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 1, recorded_at: new Date(now - 1800000).toISOString() },
    { rank: 2, recorded_at: new Date(now).toISOString() }
  ];
  const peakRes = calculateVelocityAndState(peakSnapshots, { platformCount: 1 });
  assert.equal(peakRes.state, "PEAK");
  assert.equal(peakRes.peakRank, 1);

  const decliningSnapshots = [
    { rank: 5, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 18, recorded_at: new Date(now - 1800000).toISOString() },
    { rank: 35, recorded_at: new Date(now).toISOString() }
  ];
  const decRes = calculateVelocityAndState(decliningSnapshots, { platformCount: 1 });
  assert.equal(decRes.state, "DECLINING");
  assert.ok(decRes.velocity < 0);
});

test("trend-calculator - should detect NEW for single snapshot or empty snapshots", () => {
  const emptyRes = calculateVelocityAndState([]);
  assert.equal(emptyRes.state, "NEW");
  assert.equal(emptyRes.velocity, 0);
  assert.equal(emptyRes.deltaRank, 0);

  const singleSnapshot = [{ rank: 15, recorded_at: new Date().toISOString() }];
  const singleRes = calculateVelocityAndState(singleSnapshot);
  assert.equal(singleRes.state, "NEW");
  assert.equal(singleRes.velocity, 0);
  assert.equal(singleRes.currentRank, 15);
});

test("trend-calculator - should detect RISING for steady moderate rank improvement", () => {
  const now = Date.now();
  const snapshots = [
    { rank: 30, recorded_at: new Date(now - 7200000).toISOString() },
    { rank: 26, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 22, recorded_at: new Date(now).toISOString() }
  ];
  const res = calculateVelocityAndState(snapshots, { platformCount: 1 });
  assert.equal(res.state, "RISING");
  assert.ok(res.velocity > 0 && res.velocity < 10);
  assert.equal(res.deltaRank, 8);
});

test("trend-calculator - should detect DEAD when rank drops out of hotlist", () => {
  const now = Date.now();
  const snapshots = [
    { rank: 10, recorded_at: new Date(now - 7200000).toISOString() },
    { rank: 35, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 65, recorded_at: new Date(now).toISOString() }
  ];
  const res = calculateVelocityAndState(snapshots);
  assert.equal(res.state, "DEAD");
  assert.ok(res.velocity < 0);
  assert.equal(res.currentRank, 65);
});

test("trend-calculator - should handle out-of-order snapshots correctly", () => {
  const now = Date.now();
  const unorderedSnapshots = [
    { rank: 3, recorded_at: new Date(now).toISOString() },
    { rank: 28, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 14, recorded_at: new Date(now - 1800000).toISOString() }
  ];
  const res = calculateVelocityAndState(unorderedSnapshots, { platformCount: 3 });
  assert.equal(res.state, "RAPID_RISING");
  assert.equal(res.currentRank, 3);
  assert.equal(res.deltaRank, 25);
});

test("trend-calculator - calculateVelocity wrapper should return expected interface", () => {
  const now = Date.now();
  const snapshots = [
    { rank: 20, recorded_at: new Date(now - 3600000).toISOString() },
    { rank: 10, recorded_at: new Date(now).toISOString() }
  ];
  const res = calculateVelocity(snapshots);
  assert.ok(typeof res.velocity === "number");
  assert.ok(typeof res.state === "string");
  assert.equal(res.deltaRank, 10);
  assert.ok(res.velocity > 0);
});

test("trend-calculator - should handle identical or zero duration timestamps safely", () => {
  const nowStr = new Date().toISOString();
  const snapshots = [
    { rank: 20, recorded_at: nowStr },
    { rank: 10, recorded_at: nowStr }
  ];
  const res = calculateVelocityAndState(snapshots);
  assert.ok(Number.isFinite(res.velocity));
  assert.equal(res.currentRank, 10);
});

test("trend-calculator - calculateMultiPlatformSpread should extract unique platforms and counts", () => {
  const items = [
    { platform: "weibo", title: "测试1" },
    { platform: "zhihu", title: "测试2" },
    { platform: "weibo", title: "测试3" },
    { platform: "36kr", title: "测试4" }
  ];
  const spread = calculateMultiPlatformSpread(items);
  assert.equal(spread.platformCount, 3);
  assert.deepEqual(spread.platforms.sort(), ["36kr", "weibo", "zhihu"]);

  const emptySpread = calculateMultiPlatformSpread([]);
  assert.equal(emptySpread.platformCount, 0);
  assert.deepEqual(emptySpread.platforms, []);

  const nullSpread = calculateMultiPlatformSpread(null);
  assert.equal(nullSpread.platformCount, 0);
  assert.deepEqual(nullSpread.platforms, []);
});
