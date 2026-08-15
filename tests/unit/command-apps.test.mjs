import test from "node:test";
import assert from "node:assert/strict";

import {
  CommandAppsError,
  COMMAND_APPS_ERROR_STATUS,
  getCommandApp,
  listCommandApps,
  normalizeCommandAppsConfig,
  validateAppSettings,
} from "../../lib/command-apps/index.mjs";

const windowsPath = "C:\\Apps\\Antigravity\\Antigravity.exe";

test("registry exposes the built-in Antigravity definition", () => {
  const app = getCommandApp("antigravity");
  assert.equal(app.displayName, "Antigravity");
  assert.deepEqual(app.defaultArgs, ["--no-sandbox"]);
  assert.deepEqual(app.supportedPlatforms, ["win32"]);
  assert.equal(listCommandApps().length, 1);
});

test("normalizeCommandAppsConfig keeps only known app settings", () => {
  const config = normalizeCommandAppsConfig({
    apps: {
      antigravity: { executablePath: windowsPath, lastLaunchedAt: "2026-08-15T02:00:00.000Z" },
      unknown: { executablePath: windowsPath },
    },
  }, { platform: "win32" });
  assert.deepEqual(Object.keys(config.apps), ["antigravity"]);
  assert.equal(config.apps.antigravity.manuallyConfigured, false);
});

test("validateAppSettings rejects unsafe Windows paths", () => {
  const app = getCommandApp("antigravity");
  assert.throws(
    () => validateAppSettings(app, { executablePath: "Antigravity.exe" }, {
      platform: "win32",
      fileExists: () => true,
    }),
    CommandAppsError,
  );
  assert.throws(
    () => validateAppSettings(app, { executablePath: "C:\\Apps\\Antigravity\\app.cmd" }, {
      platform: "win32",
      fileExists: () => true,
    }),
    CommandAppsError,
  );
});

test("validateAppSettings accepts an existing absolute exe", () => {
  const app = getCommandApp("antigravity");
  const result = validateAppSettings(app, { executablePath: windowsPath }, {
    platform: "win32",
    fileExists: (p) => p === windowsPath,
  });
  assert.equal(result.executablePath, windowsPath);
});

import { discoverCommandApp } from "../../lib/command-apps/infra/discovery.mjs";

test("discovery ranks well-known paths before registry and PATH", async () => {
  const app = getCommandApp("antigravity");
  const existing = new Set([
    "C:\\Users\\xtea\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe",
    "C:\\Windows\\Antigravity.exe",
  ]);
  const result = await discoverCommandApp(app, {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\xtea\\AppData\\Local", PATH: "C:\\Windows" },
    fileExists: (p) => existing.has(p),
    statFile: async () => ({ isFile: () => true }),
    queryAppPaths: async () => ["C:\\Windows\\Antigravity.exe"],
    searchPathDirs: async () => ["C:\\Windows"],
    readShortcutTarget: async () => "",
  });
  assert.equal(result.candidates.length, 2);
  assert.equal(result.selected.path, "C:\\Users\\xtea\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe");
});

test("discovery filters missing and non-exe candidates", async () => {
  const app = getCommandApp("antigravity");
  const result = await discoverCommandApp(app, {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\xtea\\AppData\\Local" },
    fileExists: (p) => p === "C:\\Users\\xtea\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe",
    statFile: async () => ({ isFile: () => true }),
    queryAppPaths: async () => ["C:\\Missing\\App.exe"],
    searchPathDirs: async () => [],
    readShortcutTarget: async () => "",
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.strategy, "well-known-localappdata");
});


import {
  createCommandAppsProcessStore,
  findProcessesByExecutable,
  terminateProcessTree,
} from "../../lib/command-apps/infra/windows-processes.mjs";

test("process store records and clears managed children", () => {
  const store = createCommandAppsProcessStore();
  const child = { pid: 4242, unref() {} };
  store.record("antigravity", child);
  assert.equal(store.get("antigravity").pid, 4242);
  store.clear("antigravity", 4242);
  assert.equal(store.get("antigravity"), null);
});

test("windows process matching is exact and case-insensitive", () => {
  const matches = findProcessesByExecutable([
    { pid: 1, executablePath: "C:\\Apps\\ANTIGRAVITY\\Antigravity.exe" },
    { pid: 2, executablePath: "C:\\Apps\\Other\\Antigravity.exe" },
  ], "c:\\apps\\antigravity\\antigravity.exe", { platform: "win32" });
  assert.deepEqual(matches.map((p) => p.pid), [1]);
});

test("terminating a process uses taskkill with argument array", async () => {
  const calls = [];
  const execFile = (file, args, options, cb) => {
    calls.push({ file, args, options });
    cb(null, "", "");
  };
  await terminateProcessTree(4242, { execFile });
  assert.equal(calls[0].file, "taskkill");
  assert.deepEqual(calls[0].args, ["/PID", "4242", "/T", "/F"]);
  assert.equal(calls[0].options.windowsHide, true);
});
