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

test("registry exposes built-in app definitions", () => {
  const antigravity = getCommandApp("antigravity");
  assert.equal(antigravity.displayName, "Antigravity");
  assert.deepEqual(antigravity.defaultArgs, ["--no-sandbox"]);
  assert.deepEqual(antigravity.supportedPlatforms, ["win32"]);

  const shrimp = getCommandApp("shrimp");
  assert.equal(shrimp.displayName, "Shrimp");
  assert.equal(shrimp.type, "project");
  assert.equal(shrimp.command, "npm run gateway:restart");
  assert.deepEqual(shrimp.defaultArgs, ["run", "gateway:restart"]);
  assert.deepEqual(shrimp.supportedPlatforms, ["win32", "darwin", "linux"]);

  assert.equal(listCommandApps().length, 2);
});

test("normalizeCommandAppsConfig keeps only known app settings", () => {
  const config = normalizeCommandAppsConfig({
    apps: {
      antigravity: { executablePath: windowsPath, lastLaunchedAt: "2026-08-15T02:00:00.000Z" },
      unknown: { executablePath: windowsPath },
    },
  }, { platform: "win32" });
  assert.deepEqual(Object.keys(config.apps).sort(), ["antigravity", "shrimp"]);
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
  const shrimpPath = "C:\\Apps\\Shrimp";
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
    discovery: async (app) => {
      const p = app.id === "shrimp" ? shrimpPath : executable;
      return {
        selected: { path: p, strategy: "test" },
        candidates: [{ path: p, strategy: "test" }],
      };
    },
    processStore,
    listProcesses: async () => [
      { pid: 4242, executablePath: executable },
      { pid: 9999, executablePath: "C:\\Apps\\Other\\Antigravity.exe" },
    ],
    terminateProcess: async () => {},
    spawnProcess: (...args) => { spawnCalls.push(args); return child; },
    fileExists: (value) => value === executable || value === shrimpPath || value === path.join(shrimpPath, "package.json"),
  });
  return { service, saved, spawnCalls, child, processStore, executable, shrimpPath };
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

test("validateAppSettings validates project directory and package.json for Shrimp", () => {
  const shrimp = getCommandApp("shrimp");
  const projectDir = "C:\\Projects\\Shrimp";
  const existingFiles = new Set([
    projectDir,
    path.join(projectDir, "package.json"),
  ]);

  const validated = validateAppSettings(shrimp, { executablePath: projectDir }, {
    platform: "win32",
    fileExists: (p) => existingFiles.has(p),
  });
  assert.equal(validated.executablePath, projectDir);
  assert.deepEqual(validated.args, ["run", "gateway:restart"]);

  // Non-existing directory throws
  assert.throws(
    () => validateAppSettings(shrimp, { executablePath: "C:\\Missing\\Shrimp" }, {
      platform: "win32",
      fileExists: () => false,
    }),
    CommandAppsError,
  );

  // Existing directory without package.json throws
  assert.throws(
    () => validateAppSettings(shrimp, { executablePath: projectDir }, {
      platform: "win32",
      fileExists: (p) => p === projectDir,
    }),
    CommandAppsError,
  );
});

test("discovery locates Shrimp root dynamically by climbing ancestor directories", async () => {
  const shrimp = getCommandApp("shrimp");
  const mockRepoRoot = "D:\\code\\my-shrimp-fork";
  const mockSubdir = path.join(mockRepoRoot, "lib", "command-apps", "infra");
  const existingFiles = new Set([
    mockRepoRoot,
    mockSubdir,
    path.join(mockRepoRoot, "package.json"),
    path.join(mockRepoRoot, "scripts", "gateway.mjs"),
  ]);

  const result = await discoverCommandApp(shrimp, {
    platform: "win32",
    currentModuleDir: mockSubdir,
    fileExists: (p) => existingFiles.has(p),
    readJson: (p) => {
      if (p === path.join(mockRepoRoot, "package.json")) {
        return { name: "@wuhezhizhong/shrimp", scripts: { "gateway:restart": "node scripts/gateway.mjs restart" } };
      }
      return null;
    },
  });

  assert.ok(result.selected);
  assert.equal(result.selected.path, mockRepoRoot);
  assert.equal(result.selected.strategy, "runtime-ancestor");
});

test("service launch runs gateway script directly with hidden window and detached", async () => {
  const shrimp = getCommandApp("shrimp");
  const projectDir = "C:\\Projects\\Shrimp";
  const saved = [];
  const spawnCalls = [];
  const child = { pid: 8888, unref() { this.unrefed = true; }, unrefed: false };
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: { shrimp: { executablePath: projectDir } } }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "win32",
    spawnProcess: (...args) => { spawnCalls.push(args); return child; },
    fileExists: () => true,
    isPidAlive: () => true,
  });

  const status = await service.launch("shrimp");
  assert.equal(status.app.id, "shrimp");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0][0], process.execPath);
  assert.deepEqual(spawnCalls[0][1], [path.join(projectDir, "scripts", "gateway.mjs"), "restart"]);
  assert.equal(spawnCalls[0][2].cwd, projectDir);
  assert.equal(spawnCalls[0][2].detached, true);
  assert.equal(spawnCalls[0][2].stdio, "ignore");
  assert.equal(spawnCalls[0][2].windowsHide, true);
  assert.equal(child.unrefed, true);
});

test("service status for shrimp reads gateway.pid.json and checks liveness", async () => {
  const projectDir = "C:\\Projects\\Shrimp";
  const pidData = { pid: 1234, startedAt: "2026-08-17T12:00:00.000Z" };
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { shrimp: { executablePath: projectDir } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (p) => p === path.join(projectDir, "gateway.pid.json") || p === projectDir,
    readFile: () => JSON.stringify(pidData),
    isPidAlive: (pid) => pid === 1234,
  });

  const status = await service.getStatus("shrimp");
  assert.equal(status.app.id, "shrimp");
  assert.equal(status.process.status, "running");
  assert.equal(status.process.count, 1);
  assert.equal(status.lastLaunchedAt, "2026-08-17T12:00:00.000Z");
});

test("routes handle /v1/command-apps/apps listing and shrimp restart", async () => {
  const { fx, reqFor, res, responses } = createRouteFixture();
  // Test listing all apps
  await routeCommandAppsRequest(reqFor("GET", "/v1/command-apps/apps"), res, null, "/v1/command-apps/apps", { service: fx.service });
  assert.equal(responses[0].status, 200);
  const listBody = JSON.parse(responses[0].body);
  assert.ok(Array.isArray(listBody.apps));
  assert.equal(listBody.apps.length, 2);

  // Test restart route
  await routeCommandAppsRequest(reqFor("POST", "/v1/command-apps/apps/shrimp/restart"), res, null, "/v1/command-apps/apps/shrimp/restart", { service: fx.service });
  assert.equal(responses[1].status, 200);
});

