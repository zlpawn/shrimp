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

import { createCommandAppsService } from "../../lib/command-apps/application/service.mjs";
import { routeCommandAppsRequest } from "../../lib/command-apps/http/routes.mjs";

function createFixture() {
  const executable = "C:\\Apps\\Antigravity\\Antigravity.exe";
  const saved = [];
  const configStore = {
    get() { return saved.at(-1) || { apps: {} }; },
    save(next) { saved.push(next); return next; },
  };
  const processStore = createCommandAppsProcessStore();
  const child = { pid: 4242, unref() { this.unrefed = true; }, unrefed: false };
  const spawnCalls = [];
  const service = createCommandAppsService({
    configStore,
    platform: "win32",
    discovery: async () => ({
      selected: { path: executable, strategy: "test" },
      candidates: [{ path: executable, strategy: "test" }],
    }),
    processStore,
    listProcesses: async () => [
      { pid: 4242, executablePath: executable },
      { pid: 9999, executablePath: "C:\\Apps\\Other\\Antigravity.exe" },
    ],
    terminateProcess: async () => {},
    spawnProcess: (...args) => { spawnCalls.push(args); return child; },
    fileExists: (value) => value === executable,
  });
  return { service, saved, spawnCalls, child, processStore, executable };
}

test("service launch discovers, persists, and spawns Antigravity safely", async () => {
  const fx = createFixture();
  const result = await fx.service.launch("antigravity");
  assert.equal(result.executablePath, fx.executable);
  assert.equal(fx.saved[0].apps.antigravity.executablePath, fx.executable);
  assert.equal(fx.spawnCalls.length, 1);
  assert.equal(fx.spawnCalls[0][0], fx.executable);
  assert.deepEqual(fx.spawnCalls[0][1], ["--no-sandbox"]);
  assert.equal(fx.spawnCalls[0][2].detached, true);
  assert.equal(fx.spawnCalls[0][2].stdio, "ignore");
  assert.equal(fx.spawnCalls[0][2].windowsHide, true);
  assert.equal(fx.child.unrefed, true);
  assert.equal(result.process.status, "running");
  assert.equal(result.process.launchedByPanel, true);
});

test("service reports externally launched processes and stops only matches", async () => {
  const fx = createFixture();
  const stopped = [];
  fx.service = createCommandAppsService({
    configStore: { get: () => ({ apps: { antigravity: { executablePath: fx.executable } } }), save() {} },
    platform: "win32",
    processStore: fx.processStore,
    listProcesses: async () => [
      { pid: 4242, executablePath: fx.executable },
      { pid: 9999, executablePath: "C:\\Apps\\Other\\Antigravity.exe" },
    ],
    terminateProcess: async (pid) => stopped.push(pid),
    spawnProcess: () => { throw new Error("should not spawn"); },
    fileExists: () => true,
  });
  const status = await fx.service.getStatus("antigravity");
  assert.equal(status.process.status, "running");
  assert.equal(status.process.count, 1);
  assert.equal(status.process.launchedByPanel, false);
  await fx.service.stop("antigravity");
  assert.deepEqual(stopped, [4242]);
});

test("service config update rejects request args and invalid paths", async () => {
  const fx = createFixture();
  await assert.rejects(
    () => fx.service.updateConfig("antigravity", { executablePath: fx.executable, args: ["--danger"] }),
    CommandAppsError,
  );
  await assert.rejects(
    () => fx.service.updateConfig("antigravity", { executablePath: "C:\\Missing\\Antigravity.exe" }),
    CommandAppsError,
  );
});

function createRouteFixture() {
  const fx = createFixture();
  const responses = [];
  const reqFor = (method, url, body) => ({
    method,
    url,
    headers: {},
    on(event, listener) {
      if (event === "data" && body) listener(Buffer.from(JSON.stringify(body)));
      if (event === "end") listener();
      return this;
    },
  });
  const res = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { responses.push({ status: this.status, body }); },
  };
  return { fx, reqFor, res, responses };
}

test("routes expose config update and unknown app errors", async () => {
  const { fx, reqFor, res, responses } = createRouteFixture();
  await routeCommandAppsRequest(reqFor("PUT", "/v1/command-apps/apps/antigravity/config", { executablePath: fx.executable }), res, null, "/v1/command-apps/apps/antigravity/config", { service: fx.service });
  assert.equal(responses[0].status, 200);
  await routeCommandAppsRequest(reqFor("POST", "/v1/command-apps/apps/unknown/launch", { args: ["--danger"] }), res, null, "/v1/command-apps/apps/unknown/launch", { service: fx.service });
  assert.equal(responses[1].status, 404);
});

test("launch request cannot override fixed arguments", async () => {
  const { fx, reqFor, res } = createRouteFixture();
  await routeCommandAppsRequest(reqFor("POST", "/v1/command-apps/apps/antigravity/launch", { args: ["--danger"] }), res, null, "/v1/command-apps/apps/antigravity/launch", { service: fx.service });
  assert.deepEqual(fx.spawnCalls[0][1], ["--no-sandbox"]);
});

test("windows process matching falls back to executable name when path is unavailable", () => {
  const matches = findProcessesByExecutable([
    { pid: 10, executablePath: "", name: "Antigravity.exe" },
    { pid: 11, executablePath: "", name: "Other.exe" },
  ], "C:\\Apps\\antigravity\\Antigravity.exe", { platform: "win32" });
  assert.deepEqual(matches.map((p) => p.pid), [10]);
});

test("service status reports platform support accurately", async () => {
  const service = createCommandAppsService({
    configStore: { get: () => ({}), save() {} },
    platform: "win32",
    listProcesses: async () => [],
  });
  const status = await service.getStatus("antigravity");
  assert.equal(status.app.supported, true);
});

test("status auto-discovers and persists an unconfigured executable", async () => {
  const executable = "C:\\Apps\\Antigravity\\Antigravity.exe";
  const saved = [];
  const service = createCommandAppsService({
    configStore: { get: () => saved.at(-1) || { apps: {} }, save(next) { saved.push(next); } },
    platform: "win32",
    discovery: async () => ({ selected: { path: executable }, candidates: [] }),
    listProcesses: async () => [{ pid: 77, executablePath: executable }],
    fileExists: (value) => value === executable,
  });
  const status = await service.getStatus("antigravity");
  assert.equal(status.configured, true);
  assert.equal(status.executablePath, executable);
  assert.equal(status.process.status, "running");
  assert.equal(saved[0].apps.antigravity.executablePath, executable);
});

test("status infers launch time from running processes when panel never launched", async () => {
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { antigravity: { executablePath: "C:\\Apps\\Antigravity\\Antigravity.exe" } } }), save() {} },
    platform: "win32",
    listProcesses: async () => [{ pid: 1, name: "Antigravity.exe", executablePath: "", createdAt: "2026-08-15T01:00:00.000Z" }],
    fileExists: () => true,
  });
  const status = await service.getStatus("antigravity");
  assert.equal(status.process.status, "running");
  assert.equal(status.lastLaunchedAt, "2026-08-15T01:00:00.000Z");
});

import { createCommandAppsSqliteStore } from "../../lib/command-apps/infra/sqlite-store.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

test("command apps sqlite store persists settings outside gateway config", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "command-apps-sqlite-"));
  const store = createCommandAppsSqliteStore({
    dbPath: path.join(tmp, "gateway.db"),
    platform: "win32",
  });
  const settings = {
    executablePath: "C:\\Apps\\Antigravity\\Antigravity.exe",
    args: ["--danger"],
    manuallyConfigured: true,
    lastLaunchedAt: "2026-08-15T01:00:00.000Z",
  };
  store.save({ apps: { antigravity: settings } });
  assert.deepEqual(store.get().apps.antigravity, {
    executablePath: settings.executablePath,
    args: ["--no-sandbox"],
    manuallyConfigured: true,
    lastLaunchedAt: settings.lastLaunchedAt,
  });
  store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
