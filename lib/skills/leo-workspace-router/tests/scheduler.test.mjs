import assert from "node:assert/strict";
import test from "node:test";
import {
  parseInterval,
  formatInterval,
  formatCountdown,
  renderDashboardTable,
  startTask,
  stopTask,
  resumeTask,
  removeTask,
  listTasks,
  loadAutopullConfig,
  saveAutopullConfig,
  isRandomDaily,
  getValidWorkMinutesPool,
  computeRandomWorkSlot,
  computeNextRunAt,
  isWeekend,
  getNextWorkday
} from "../scripts/modules/scheduler.mjs";

test("parseInterval and formatInterval convert accurately", () => {
  assert.equal(parseInterval("30s"), 30000);
  assert.equal(parseInterval("5m"), 300000);
  assert.equal(parseInterval("1h"), 3600000);
  assert.equal(parseInterval("2d"), 172800000);
  assert.equal(parseInterval(60000), 60000);

  assert.equal(formatInterval(30000), "30s");
  assert.equal(formatInterval(300000), "5m");
  assert.equal(formatInterval(3600000), "1h");
  assert.equal(formatInterval(172800000), "2d");
});

test("formatCountdown handles various statuses", () => {
  assert.equal(formatCountdown(Date.now() + 10000, "PAUSED"), "-- (已暂停)");
  assert.equal(formatCountdown(Date.now() + 10000, "STOPPED"), "-- (已停止)");
  assert.equal(formatCountdown(null, "RUNNING"), "即刻准备");
  assert.equal(formatCountdown(Date.now() - 5000, "RUNNING"), "即将执行");
  assert.match(formatCountdown(Date.now() + 120000, "RUNNING"), /分钟后/);
});

test("startTask, stopTask, resumeTask, and removeTask lifecycle", () => {
  const origCfg = JSON.parse(JSON.stringify(loadAutopullConfig()));
  const taskName = "test-unit-task";
  
  try {
    // 1. Start task
    const started = startTask(taskName, {
      host: "macc",
      remotePath: "/workspace/test",
      interval: "10m"
    });
    assert.equal(started.name, taskName);
    assert.equal(started.status, "RUNNING");
    assert.equal(started.interval, "10m");

    // 2. Verify list contains it
    let tasks = listTasks();
    let found = tasks.find(t => t.name === taskName);
    assert.ok(found);
    assert.equal(found.status, "RUNNING");

    // 3. Pause task
    const paused = stopTask(taskName);
    assert.equal(paused.status, "PAUSED");
    tasks = listTasks();
    found = tasks.find(t => t.name === taskName);
    assert.equal(found.status, "PAUSED");

    // 4. Resume task
    const resumed = resumeTask(taskName);
    assert.equal(resumed.status, "RUNNING");
    tasks = listTasks();
    found = tasks.find(t => t.name === taskName);
    assert.equal(found.status, "RUNNING");

    // 5. Remove task
    const removed = removeTask(taskName);
    assert.equal(removed, true);
    tasks = listTasks();
    found = tasks.find(t => t.name === taskName);
    assert.equal(found, undefined);
  } finally {
    saveAutopullConfig(origCfg);
  }
});

test("renderDashboardTable outputs clean ASCII board with headers", () => {
  const mockTasks = [
    {
      name: "ZK",
      host: "macc",
      remotePath: "/Users/pa/project/ZK",
      interval: "5m",
      status: "RUNNING",
      lastSuccess: true,
      lastSummary: "All 1 repo(s) are already up to date.",
      countdown: "4 分钟后"
    },
    {
      name: "api",
      host: "macc",
      remotePath: "/Users/pa/project/api",
      interval: "1h",
      status: "PAUSED",
      lastSuccess: true,
      lastSummary: "用户主动暂停",
      countdown: "-- (已暂停)"
    }
  ];

  const table = renderDashboardTable(mockTasks);
  assert.match(table, /任务名称/);
  assert.match(table, /远程路径/);
  assert.match(table, /ZK/);
  assert.match(table, /🟢 RUNNING/);
  assert.match(table, /🟡 PAUSED/);
});

test("random daily work slot respects constraints: 10~19h, skips lunch, no exact hour, distinct per task", () => {
  assert.equal(isRandomDaily("random-daily"), true);
  assert.equal(isRandomDaily("human-workday"), true);
  assert.equal(isRandomDaily("5m"), false);

  const pool = getValidWorkMinutesPool(0);
  assert.ok(pool.length > 300);

  for (const m of pool) {
    // Must be in 10:01..12:29 or 14:01..18:59
    const inMorning = m >= 601 && m <= 749;
    const inAfternoon = m >= 841 && m <= 1139;
    assert.ok(inMorning || inAfternoon, `Minute ${m} outside allowed windows`);
    assert.ok(m % 60 !== 0, `Minute ${m} must not be on the hour`);
  }

  const testDate = new Date("2026-11-28T09:00:00Z");
  const slotA = computeRandomWorkSlot("project-alpha", testDate, 0);
  const slotB = computeRandomWorkSlot("project-beta", testDate, 0);

  assert.ok(slotA instanceof Date);
  assert.ok(slotB instanceof Date);

  // Different projects should receive different slots
  assert.notEqual(slotA.getTime(), slotB.getTime());

  // Hours must be valid
  assert.ok(
    (slotA.getHours() >= 10 && slotA.getHours() < 12) ||
    (slotA.getHours() === 12 && slotA.getMinutes() <= 29) ||
    (slotA.getHours() >= 14 && slotA.getHours() <= 18)
  );
  assert.notEqual(slotA.getMinutes() % 60, 0);
});

test("computeNextRunAt enforces at most once per day and strictly skips weekends", () => {
  const task = {
    name: "ZK",
    status: "RUNNING",
    interval: "random-daily",
    lastPullAt: new Date().toISOString() // already pulled today
  };

  const nextRun = computeNextRunAt(task);
  assert.ok(nextRun);

  const nextDate = new Date(nextRun);
  // Next run must never be Saturday or Sunday
  assert.notEqual(nextDate.getDay(), 0, "Next run must not be Sunday");
  assert.notEqual(nextDate.getDay(), 6, "Next run must not be Saturday");
  assert.ok(nextDate.getTime() > Date.now());

  // Test getNextWorkday explicitly
  const friday = new Date("2026-11-27T10:00:00Z"); // Friday
  const monday = getNextWorkday(friday);
  assert.equal(monday.getDay(), 1, "Next workday after Friday must be Monday");

  const saturday = new Date("2026-11-28T10:00:00Z"); // Saturday
  const mondayFromSat = getNextWorkday(saturday);
  assert.equal(mondayFromSat.getDay(), 1, "Next workday after Saturday must be Monday");
});
