#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, resolvePath } from "../config.mjs";
import { pullRemoteGit } from "./remote-git.mjs";

const SHRIMP_DIR = path.join(os.homedir(), ".shrimp", "skills", "leo-workspace-router");
const LOGS_DIR = path.join(SHRIMP_DIR, "logs");
const AUTOPULL_FILE = path.join(SHRIMP_DIR, "autopull.json");

export function ensureLogsDir() {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true, mode: 0o700 });
  }
  return LOGS_DIR;
}

export function loadAutopullConfig() {
  if (!fs.existsSync(SHRIMP_DIR)) {
    fs.mkdirSync(SHRIMP_DIR, { recursive: true, mode: 0o700 });
  }
  if (!fs.existsSync(AUTOPULL_FILE)) {
    return { version: 1, tasks: {} };
  }
  try {
    const raw = fs.readFileSync(AUTOPULL_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.tasks) parsed.tasks = {};
    return parsed;
  } catch {
    return { version: 1, tasks: {} };
  }
}

export function saveAutopullConfig(cfg) {
  if (!fs.existsSync(SHRIMP_DIR)) {
    fs.mkdirSync(SHRIMP_DIR, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(AUTOPULL_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/**
 * Check if interval string represents random daily schedule
 */
export function isRandomDaily(interval) {
  if (!interval) return false;
  const s = String(interval).toLowerCase().trim();
  return s === "random-daily" || s === "human-workday" || s === "daily-random" || s === "random";
}

/**
 * Check if a date falls on a weekend (Saturday or Sunday)
 */
export function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Advance a date to the next valid working day (skipping Saturday and Sunday)
 */
export function getNextWorkday(date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  while (isWeekend(next)) {
    next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Generate pool of valid minutes from midnight:
 * 10:01 ~ 12:29 (601 ~ 749), excluding m % 60 === 0
 * 14:01 ~ 18:59 (841 ~ 1139), excluding m % 60 === 0
 */
export function getValidWorkMinutesPool(minAfter = 0) {
  const pool = [];
  // Morning: 10:01 to 12:29
  for (let m = 601; m <= 749; m++) {
    if (m % 60 !== 0 && m >= minAfter) {
      pool.push(m);
    }
  }
  // Afternoon: 14:01 to 18:59
  for (let m = 841; m <= 1139; m++) {
    if (m % 60 !== 0 && m >= minAfter) {
      pool.push(m);
    }
  }
  return pool;
}

function getSimpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Compute a randomized, non-on-the-hour, workday slot for a project on a specific date
 */
export function computeRandomWorkSlot(taskName, targetDate, minAfter = 0, claimedMinutes = new Set()) {
  const year = targetDate.getFullYear();
  const month = String(targetDate.getMonth() + 1).padStart(2, "0");
  const day = String(targetDate.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`;

  const pool = getValidWorkMinutesPool(minAfter);
  if (pool.length === 0) return null;

  const hash = getSimpleHash(`${taskName}:${dateStr}`);
  let selectedMinute = pool[hash % pool.length];

  // Avoid minute collisions between different tasks on the same date
  let attempts = 0;
  while (claimedMinutes.has(selectedMinute) && attempts < pool.length) {
    attempts++;
    selectedMinute = pool[(hash + attempts * 17) % pool.length];
  }
  claimedMinutes.add(selectedMinute);

  const slot = new Date(targetDate);
  const hour = Math.floor(selectedMinute / 60);
  const minute = selectedMinute % 60;
  const second = (hash % 50) + 5; // Jitter second as well (5..54s)
  slot.setHours(hour, minute, second, 0);

  return slot;
}

/**
 * Compute the next run timestamp for any task (strictly skipping weekends)
 */
export function computeNextRunAt(task, claimedMinutes = new Set()) {
  if (task.status !== "RUNNING") return null;

  if (!isRandomDaily(task.interval)) {
    const intervalMs = parseInterval(task.interval);
    const lastPullAt = task.lastPullAt ? new Date(task.lastPullAt).getTime() : null;
    return lastPullAt ? lastPullAt + intervalMs : Date.now();
  }

  const now = new Date();
  const todayStr = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
  const lastPullDate = task.lastPullAt ? new Date(task.lastPullAt) : null;
  const lastPullDateStr = lastPullDate ? [lastPullDate.getFullYear(), String(lastPullDate.getMonth() + 1).padStart(2, "0"), String(lastPullDate.getDate()).padStart(2, "0")].join("-") : "";

  // 1. If today is a weekend: strictly schedule for upcoming Monday
  if (isWeekend(now)) {
    const nextWorkday = getNextWorkday(now);
    const slot = computeRandomWorkSlot(task.name, nextWorkday, 0, claimedMinutes);
    return slot ? slot.getTime() : null;
  }

  // 2. If already pulled today on a weekday: schedule for next workday (Mon-Thu -> tomorrow, Fri -> next Monday)
  if (lastPullDateStr === todayStr) {
    const nextWorkday = getNextWorkday(now);
    const slot = computeRandomWorkSlot(task.name, nextWorkday, 0, claimedMinutes);
    return slot ? slot.getTime() : null;
  }

  // 3. Not pulled today on a weekday
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // If current time is past 18:59, today's window is closed -> schedule next workday
  if (currentMinutes >= 1139) {
    const nextWorkday = getNextWorkday(now);
    const slot = computeRandomWorkSlot(task.name, nextWorkday, 0, claimedMinutes);
    return slot ? slot.getTime() : null;
  }

  // If today's slot is still in the future:
  const todaySlot = computeRandomWorkSlot(task.name, now, 0, claimedMinutes);
  if (todaySlot && todaySlot.getTime() > now.getTime()) {
    return todaySlot.getTime();
  }

  // Today's slot was earlier (e.g. before start): pick from remaining slots today
  const remainingSlot = computeRandomWorkSlot(task.name, now, currentMinutes + 3, claimedMinutes);
  if (remainingSlot && remainingSlot.getTime() > now.getTime()) {
    return remainingSlot.getTime();
  }

  // If no remaining slots today, schedule next workday
  const nextWorkday = getNextWorkday(now);
  const slot = computeRandomWorkSlot(task.name, nextWorkday, 0, claimedMinutes);
  return slot ? slot.getTime() : null;
}

/**
 * Parse human interval string (e.g. "5m", "15m", "1h", "2h", "1d", "30s", "random-daily") into milliseconds
 */
export function parseInterval(str) {
  if (!str) return 5 * 60 * 1000; // default 5m
  if (typeof str === "number") return str;
  if (isRandomDaily(str)) return 24 * 60 * 60 * 1000;

  const match = String(str).trim().match(/^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i);
  if (!match) return 5 * 60 * 1000;

  const val = parseFloat(match[1]);
  const unit = (match[2] || "m").toLowerCase();

  switch (unit) {
    case "s": return Math.round(val * 1000);
    case "m": return Math.round(val * 60 * 1000);
    case "h": return Math.round(val * 60 * 60 * 1000);
    case "d": return Math.round(val * 24 * 60 * 60 * 1000);
    default: return Math.round(val * 60 * 1000);
  }
}

/**
 * Format milliseconds into human interval string (e.g. 300000 -> "5m")
 */
export function formatInterval(ms, rawStr = null) {
  if (isRandomDaily(rawStr)) return "🎲 每日随机 (10~19点)";
  if (!ms || ms <= 0) return "0s";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}

/**
 * Format countdown to next run
 */
export function formatCountdown(nextRunAt, status, interval = null) {
  if (status === "PAUSED") return "-- (已暂停)";
  if (status === "STOPPED") return "-- (已停止)";
  if (!nextRunAt) return "即刻准备";

  const diff = nextRunAt - Date.now();
  if (diff <= 0) return "即将执行";

  const target = new Date(nextRunAt);
  const hour = String(target.getHours()).padStart(2, "0");
  const min = String(target.getMinutes()).padStart(2, "0");
  const timeStr = `${hour}:${min}`;

  const now = new Date();
  const isToday = target.toDateString() === now.toDateString();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = target.toDateString() === tomorrow.toDateString();

  const dayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const targetDayName = dayNames[target.getDay()];

  let label = "";
  if (isToday) {
    label = `今天 ${timeStr}`;
  } else if (isTomorrow) {
    label = `明天 (${targetDayName}) ${timeStr}`;
  } else {
    const diffDays = Math.round((target.getTime() - now.getTime()) / (24 * 3600 * 1000));
    if (diffDays <= 7) {
      label = `下${targetDayName} (${target.getMonth() + 1}/${target.getDate()}) ${timeStr}`;
    } else {
      label = `${target.getMonth() + 1}/${target.getDate()} ${timeStr}`;
    }
  }

  if (isRandomDaily(interval)) {
    if (isWeekend(now)) {
      return `${label} (周末已跳过)`;
    }
    if (isTomorrow || !isToday) {
      return `${label} (今日已完成)`;
    }
  }

  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${label} (${mins} 分钟后)`;
  const hours = Math.floor(mins / 60);
  return `${label} (${hours} 小时后)`;
}

/**
 * Append log entry to task log file
 */
export function appendTaskLog(taskName, entry) {
  ensureLogsDir();
  const logFile = path.join(LOGS_DIR, `${taskName}.log`);
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${entry}\n`;
  try {
    fs.appendFileSync(logFile, line, { mode: 0o600 });
  } catch {}
}

/**
 * Read recent log lines
 */
export function getTaskLogs(taskName, maxLines = 30) {
  ensureLogsDir();
  const logFile = path.join(LOGS_DIR, `${taskName}.log`);
  if (!fs.existsSync(logFile)) return [];
  try {
    const raw = fs.readFileSync(logFile, "utf-8");
    const lines = raw.trim().split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

/**
 * Retrieve all autopull tasks
 */
export function listTasks() {
  const cfg = loadAutopullConfig();
  const tasks = cfg.tasks || {};
  const list = [];
  const claimedMinutes = new Set();

  for (const [name, t] of Object.entries(tasks)) {
    const intervalMs = parseInterval(t.interval);
    const nextRunAt = computeNextRunAt(t, claimedMinutes);

    list.push({
      name,
      host: t.host,
      remotePath: t.remotePath,
      interval: t.interval || "5m",
      intervalMs,
      status: t.status || "RUNNING",
      lastPullAt: t.lastPullAt || null,
      lastSummary: t.lastSummary || "等待首次拉取",
      lastSuccess: t.lastSuccess !== false,
      nextRunAt,
      countdown: formatCountdown(nextRunAt, t.status, t.interval)
    });
  }

  return list;
}

/**
 * Start or update an autopull task
 */
export function startTask(name, { host, remotePath, interval = "5m" }) {
  if (!name) throw new Error("Task name is required");
  const cfg = loadAutopullConfig();
  if (!cfg.tasks) cfg.tasks = {};

  const existing = cfg.tasks[name] || {};
  const baseCfg = loadConfig();
  const targetHost = host || existing.host || baseCfg.default_host;
  const targetRemote = remotePath || existing.remotePath;

  if (!targetHost) throw new Error("Host is required");
  if (!targetRemote) throw new Error("Remote path is required");

  cfg.tasks[name] = {
    name,
    host: targetHost,
    remotePath: targetRemote,
    interval: interval || existing.interval || "5m",
    status: "RUNNING",
    lastPullAt: existing.lastPullAt || null,
    lastSummary: existing.lastSummary || "已启动，等待执行",
    lastSuccess: existing.lastSuccess !== false,
    updatedAt: new Date().toISOString()
  };

  saveAutopullConfig(cfg);
  appendTaskLog(name, `Task started (host: ${targetHost}, interval: ${interval}, remotePath: ${targetRemote})`);
  return cfg.tasks[name];
}

/**
 * Pause / Stop an autopull task
 */
export function stopTask(name) {
  if (!name) throw new Error("Task name is required");
  const cfg = loadAutopullConfig();
  if (!cfg.tasks || !cfg.tasks[name]) {
    throw new Error(`Task '${name}' not found`);
  }

  cfg.tasks[name].status = "PAUSED";
  cfg.tasks[name].updatedAt = new Date().toISOString();
  saveAutopullConfig(cfg);
  appendTaskLog(name, "Task paused by user");
  return cfg.tasks[name];
}

/**
 * Resume a paused task
 */
export function resumeTask(name) {
  if (!name) throw new Error("Task name is required");
  const cfg = loadAutopullConfig();
  if (!cfg.tasks || !cfg.tasks[name]) {
    throw new Error(`Task '${name}' not found`);
  }

  cfg.tasks[name].status = "RUNNING";
  cfg.tasks[name].updatedAt = new Date().toISOString();
  saveAutopullConfig(cfg);
  appendTaskLog(name, "Task resumed by user");
  return cfg.tasks[name];
}

/**
 * Remove an autopull task
 */
export function removeTask(name) {
  if (!name) throw new Error("Task name is required");
  const cfg = loadAutopullConfig();
  if (!cfg.tasks || !cfg.tasks[name]) {
    return false;
  }

  delete cfg.tasks[name];
  saveAutopullConfig(cfg);
  appendTaskLog(name, "Task removed");
  return true;
}

/**
 * Run a task immediately
 */
export async function runTaskNow(name) {
  const cfg = loadAutopullConfig();
  if (!cfg.tasks || !cfg.tasks[name]) {
    throw new Error(`Task '${name}' not found`);
  }

  const task = cfg.tasks[name];
  appendTaskLog(name, `Triggering pull on ${task.host}:${task.remotePath}...`);

  const result = await pullRemoteGit(task.host, task.remotePath);
  const nowIso = new Date().toISOString();

  task.lastPullAt = nowIso;
  task.lastSuccess = result.success;
  task.lastSummary = result.summary;
  task.updatedAt = nowIso;

  cfg.tasks[name] = task;
  saveAutopullConfig(cfg);

  appendTaskLog(name, `Pull finished: ${result.summary} (success: ${result.success})`);
  return { task, result };
}

/**
 * Scheduler Tick: Check and run all due tasks
 */
export async function tickScheduler() {
  const tasks = listTasks();
  const now = Date.now();
  const executed = [];

  for (const t of tasks) {
    if (t.status !== "RUNNING") continue;
    if (!t.nextRunAt || t.nextRunAt <= now) {
      try {
        const res = await runTaskNow(t.name);
        executed.push({ name: t.name, success: res.result.success, summary: res.result.summary });
      } catch (err) {
        executed.push({ name: t.name, success: false, summary: err.message });
      }
    }
  }

  return executed;
}

/**
 * Render visual CLI table dashboard
 */
export function renderDashboardTable(taskList) {
  if (!taskList || taskList.length === 0) {
    return "\n当前暂无 autopull 任务。可以使用 router.mjs autopull start <name> --remote=<path> 添加。\n";
  }

  const rows = [
    ["任务名称", "主机", "远程路径", "频率", "状态", "上次拉取结果", "下次执行"]
  ];

  for (const t of taskList) {
    const statusIcon = t.status === "RUNNING"
      ? (t.lastSuccess ? "🟢 RUNNING" : "🔴 ERROR")
      : (t.status === "PAUSED" ? "🟡 PAUSED" : "⚪ STOPPED");

    const pullSummary = t.lastSummary.length > 32
      ? t.lastSummary.slice(0, 29) + "..."
      : t.lastSummary;

    const displayInterval = isRandomDaily(t.interval) ? "🎲 每日随机 (10~19点)" : t.interval;

    rows.push([
      t.name,
      t.host,
      t.remotePath,
      displayInterval,
      statusIcon,
      pullSummary,
      t.countdown
    ]);
  }

  // Calculate column widths
  const colWidths = rows[0].map((_, colIdx) => {
    return Math.max(...rows.map(row => {
      const val = row[colIdx] || "";
      // Account for unicode/chinese width roughly
      let len = 0;
      for (const ch of val) {
        len += ch.charCodeAt(0) > 255 ? 2 : 1;
      }
      return len;
    })) + 2;
  });

  const padStr = (str, width) => {
    let len = 0;
    for (const ch of str) {
      len += ch.charCodeAt(0) > 255 ? 2 : 1;
    }
    const pad = Math.max(0, width - len);
    return str + " ".repeat(pad);
  };

  const lineSep = "├" + colWidths.map(w => "─".repeat(w)).join("┼") + "┤";
  const topSep = "┌" + colWidths.map(w => "─".repeat(w)).join("┬") + "┐";
  const bottomSep = "└" + colWidths.map(w => "─".repeat(w)).join("┴") + "┘";

  const formattedRows = rows.map((row, rowIdx) => {
    const cells = row.map((val, colIdx) => padStr(val, colWidths[colIdx]));
    return "│ " + cells.join("│ ").trimEnd() + " │";
  });

  const output = [
    topSep,
    formattedRows[0],
    lineSep,
    ...formattedRows.slice(1),
    bottomSep
  ];

  return output.join("\n");
}
