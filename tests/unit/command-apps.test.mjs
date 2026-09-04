import test from "node:test";
import assert from "node:assert/strict";

import {
  CommandAppsError,
  COMMAND_APPS_ERROR_STATUS,
  getCommandApp,
  listCommandApps,
  normalizeCommandAppsConfig,
  parseUvToolList,
  inspectHindsightTool,
  installHindsightTool,
  updateHindsightTool,
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

  assert.equal(listCommandApps().length, 3);
});

test("normalizeCommandAppsConfig keeps only known app settings", () => {
  const config = normalizeCommandAppsConfig({
    apps: {
      antigravity: { executablePath: windowsPath, lastLaunchedAt: "2026-08-15T02:00:00.000Z" },
      unknown: { executablePath: windowsPath },
    },
  }, { platform: "win32" });
  assert.deepEqual(Object.keys(config.apps).sort(), ["antigravity", "hindsight", "shrimp"]);
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

test("hindsight tool manager parses only the uv-managed hindsight-embed package", () => {
  const tools = parseUvToolList(`
hindsight-api v0.9.2
- hindsight-api
hindsight-embed v0.9.3
- hindsight-embed
`);
  assert.deepEqual(tools, {
    installed: true,
    version: "0.9.3",
  });
});

test("hindsight tool manager reports missing uv without falling back to another installer", async () => {
  const status = await inspectHindsightTool({
    execFile: (_file, _args, _options, callback) => {
      const error = Object.assign(new Error("spawn uv ENOENT"), { code: "ENOENT" });
      callback(error, "", "");
    },
  });
  assert.equal(status.uvAvailable, false);
  assert.equal(status.installed, false);
  assert.equal(status.installCommand, "uv tool install hindsight-embed");
  assert.equal(status.updateCommand, "uv tool upgrade hindsight-embed");
});

test("hindsight tool manager uses fixed uv argument arrays for install and update", async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => {
    calls.push({ file, args, options });
    callback(null, "ok", "");
  };
  await installHindsightTool({ execFile });
  await updateHindsightTool({ execFile });
  assert.equal(calls[0].file, "uv");
  assert.deepEqual(calls[0].args, ["tool", "install", "hindsight-embed"]);
  assert.equal(calls[1].file, "uv");
  assert.deepEqual(calls[1].args, ["tool", "upgrade", "hindsight-embed"]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[1].options.shell, false);
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
  assert.equal(fx.spawnCalls[0][0], "runas.exe");
  assert.deepEqual(fx.spawnCalls[0][1], [
    "/trustlevel:0x20000",
    `"${fx.executable}" --no-sandbox`,
  ]);
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
  assert.equal(fx.spawnCalls[0][1].at(-1), `"${fx.executable}" --no-sandbox`);
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

test("service listApps on darwin returns supported=false for antigravity without throwing", async () => {
  const service = createCommandAppsService({
    configStore: { get: () => ({}), save() {} },
    platform: "darwin",
    listProcesses: async () => [],
  });
  const list = await service.listApps();
  const antigravity = list.find((item) => item.app.id === "antigravity");
  assert.ok(antigravity);
  assert.equal(antigravity.app.supported, false);
  assert.equal(antigravity.configured, false);
  assert.equal(antigravity.process.status, "stopped");

  const shrimp = list.find((item) => item.app.id === "shrimp");
  assert.ok(shrimp);
  assert.equal(shrimp.app.supported, true);
});

test("service listApps isolates individual app errors without breaking other apps", async () => {
  const service = createCommandAppsService({
    configStore: {
      get: () => ({ apps: {} }),
      save() {},
    },
    platform: "win32",
    discovery: async (app) => {
      if (app.id === "antigravity") throw new Error("Disk read failed");
      return { selected: { path: "C:\\Projects\\Shrimp" } };
    },
    fileExists: () => true,
  });

  const list = await service.listApps();
  assert.ok(list.length >= 3);

  const antigravity = list.find((item) => item.app.id === "antigravity");
  assert.ok(antigravity);
  assert.equal(antigravity.process.status, "error");
  assert.equal(antigravity.error, "Disk read failed");

  const shrimp = list.find((item) => item.app.id === "shrimp");
  assert.ok(shrimp);
  assert.equal(shrimp.app.id, "shrimp");
  assert.equal(shrimp.configured, true);
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
  assert.equal(spawnCalls[0][0], "powershell.exe");
  assert.ok(spawnCalls[0][1].join(" ").includes("Start-Process"));
  assert.ok(spawnCalls[0][1].join(" ").includes("-WindowStyle"));
  assert.equal(spawnCalls[0][2].detached, true);
  assert.equal(spawnCalls[0][2].stdio, "ignore");
  assert.equal(spawnCalls[0][2].windowsHide, true);
  assert.equal(child.unrefed, true);

  // Posix / Darwin launch
  const posixSpawnCalls = [];
  const posixService = createCommandAppsService({
    configStore: {
      get() { return { apps: { shrimp: { executablePath: "/Users/dev/shrimp" } } }; },
      save() {},
    },
    platform: "darwin",
    spawnProcess: (...args) => { posixSpawnCalls.push(args); return child; },
    fileExists: () => true,
    isPidAlive: () => true,
  });

  await posixService.launch("shrimp");
  assert.equal(posixSpawnCalls.length, 1);
  assert.equal(posixSpawnCalls[0][0], process.execPath);
  assert.deepEqual(posixSpawnCalls[0][1], [path.join("/Users/dev/shrimp", "scripts", "gateway.mjs"), "restart"]);
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
  assert.ok(listBody.apps.length >= 3);

  // Test restart route
  await routeCommandAppsRequest(reqFor("POST", "/v1/command-apps/apps/shrimp/restart"), res, null, "/v1/command-apps/apps/shrimp/restart", { service: fx.service });
  assert.equal(responses[1].status, 200);
});


import {
  parseEnvFile,
  publicLlmConfig,
  writeHindsightLlmConfig,
  sanitizeDaemonEnv,
  listHindsightProfileFiles,
  hindsightDaemonArgs,
  defaultHindsightConfigPath,
  readCodingAgentPluginConfig,
  writeCodingAgentPluginConfig,
} from "../../lib/command-apps/index.mjs";
import { inspectHindsightDaemon } from "../../lib/command-apps/infra/hindsight-daemon.mjs";
import { ensureHindsightControlPlane } from "../../lib/command-apps/infra/hindsight-control-plane.mjs";

test("registry exposes hindsight as a cross-platform cli daemon", () => {
  const app = getCommandApp("hindsight");
  assert.equal(app.type, "cli-daemon");
  assert.equal(app.executableName, "hindsight-embed");
  assert.deepEqual(app.defaultArgs, ["daemon", "start"]);
  assert.deepEqual(app.supportedPlatforms, ["win32", "darwin", "linux"]);
});

test("validateAppSettings accepts hindsight-embed without requiring .exe", () => {
  const app = getCommandApp("hindsight");
  const unixPath = "/Users/pa/.local/bin/hindsight-embed";
  const result = validateAppSettings(app, { executablePath: unixPath }, {
    platform: "darwin",
    fileExists: (p) => p === unixPath,
  });
  assert.equal(result.executablePath, unixPath);
});

test("discovery finds hindsight-embed on PATH and well-known local bin", async () => {
  const app = getCommandApp("hindsight");
  const localBin = "/Users/pa/.local/bin/hindsight-embed";
  const result = await discoverCommandApp(app, {
    platform: "darwin",
    env: { HOME: "/Users/pa", PATH: "/opt/bin:/usr/bin" },
    fileExists: (p) => p === localBin,
    statFile: async () => ({ isFile: () => true }),
    searchPathDirs: async () => ["/opt/bin"],
  });
  assert.equal(result.selected.path, localBin);
  assert.equal(result.selected.strategy, "well-known-local-bin");
});

test("sanitizeDaemonEnv strips SOCKS and HTTP proxy variables", () => {
  const env = sanitizeDaemonEnv({
    ALL_PROXY: "socks5://127.0.0.1:7897",
    all_proxy: "socks5://127.0.0.1:7897",
    HTTPS_PROXY: "http://127.0.0.1:7897",
    PATH: "/usr/bin",
    NO_PROXY: "example.com",
  });
  assert.equal(env.ALL_PROXY, undefined);
  assert.equal(env.all_proxy, undefined);
  assert.equal(env.HTTPS_PROXY, undefined);
  assert.match(env.NO_PROXY, /127\.0\.0\.1/);
  assert.equal(env.PATH, "/usr/bin");
});

test("hindsight llm config writes custom base url into embed env", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-embed-"));
  const configPath = path.join(tmp, "embed");
  writeHindsightLlmConfig({
    provider: "openai",
    baseUrl: "https://your-endpoint.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-test",
  }, {
    configPath,
    fileExists: () => false,
    readFile: () => "",
    writeFile: (filePath, content) => fs.writeFileSync(filePath, content),
    mkdir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
  });
  const saved = parseEnvFile(fs.readFileSync(configPath, "utf8"));
  assert.equal(saved.HINDSIGHT_API_LLM_PROVIDER, "openai");
  assert.equal(saved.HINDSIGHT_API_LLM_BASE_URL, "https://your-endpoint.com/v1");
  assert.equal(saved.HINDSIGHT_API_LLM_MODEL, "gpt-4o-mini");
  assert.equal(saved.HINDSIGHT_API_LLM_API_KEY, "sk-test");
  const pub = publicLlmConfig(saved);
  assert.equal(pub.hasApiKey, true);
  assert.notEqual(pub.apiKeyMasked, "sk-test");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("command apps settings support future hindsight profiles while normalizing default", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "command-apps-profiles-"));
  const store = createCommandAppsSqliteStore({
    dbPath: path.join(tmp, "gateway.db"),
    platform: "win32",
  });
  const source = {
    type: "gateway",
    client: "work-buddy",
    endpointId: null,
    model: "glm-5.2",
  };
  store.save({
    apps: {
      hindsight: {
        executablePath: "C:\Users\pa\.local\bin\hindsight-embed.exe",
      },
    },
    hindsightProfiles: {
      default: {
        displayName: "Default memory",
        llmSource: source,
      },
      research: {
        displayName: "Research memory",
        port: 9101,
        llmSource: source,
      },
    },
  });
  const saved = store.get();
  assert.equal(saved.hindsightProfiles.default.llmSource.model, "glm-5.2");
  assert.equal(saved.hindsightProfiles.research.port, 9101);
  assert.equal(saved.apps.hindsight.executablePath, "C:\Users\pa\.local\bin\hindsight-embed.exe");
  store.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("hindsight llm config writes important runtime and retrieval settings", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-embed-"));
  const configPath = path.join(tmp, "embed");
  writeHindsightLlmConfig({
    provider: "openai",
    baseUrl: "https://your-endpoint.com/v1",
    model: "gpt-4o-mini",
    apiKey: "sk-test",
    host: "127.0.0.1",
    port: 9100,
    logLevel: "debug",
    reasoningEffort: "low",
    temperature: "0.2",
    strictSchema: "true",
    embeddingsProvider: "openai",
    embeddingsModel: "text-embedding-3-small",
    rerankerProvider: "siliconflow",
    rerankerModel: "BAAI/bge-reranker-v2-m3",
    embeddingsApiKey: "sk-embed-test",
  }, {
    configPath,
    fileExists: () => false,
    readFile: () => "",
    writeFile: (filePath, content) => fs.writeFileSync(filePath, content),
    mkdir: (dirPath) => fs.mkdirSync(dirPath, { recursive: true }),
  });
  const saved = parseEnvFile(fs.readFileSync(configPath, "utf8"));
  assert.equal(saved.HINDSIGHT_API_HOST, "127.0.0.1");
  assert.equal(saved.HINDSIGHT_API_PORT, "9100");
  assert.equal(saved.HINDSIGHT_API_LOG_LEVEL, "debug");
  assert.equal(saved.HINDSIGHT_API_LLM_REASONING_EFFORT, "low");
  assert.equal(saved.HINDSIGHT_API_LLM_TEMPERATURE, "0.2");
  assert.equal(saved.HINDSIGHT_API_LLM_STRICT_SCHEMA, "true");
  assert.equal(saved.HINDSIGHT_API_EMBEDDINGS_PROVIDER, "openai");
  assert.equal(saved.HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL, "text-embedding-3-small");
  assert.equal(saved.HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY, "sk-embed-test");
  assert.equal(saved.HINDSIGHT_API_RERANKER_PROVIDER, "siliconflow");
  assert.equal(saved.HINDSIGHT_API_RERANKER_SILICONFLOW_MODEL, "BAAI/bge-reranker-v2-m3");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("service launches hindsight via daemon start without SOCKS proxy", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  const spawnCalls = [];
  const child = { pid: 4243, unref() { this.unrefed = true; } };
  let healthy = false;
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: { hindsight: { executablePath: executable } } }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    spawnProcess: (file, args, options) => {
      spawnCalls.push({ file, args, options });
      healthy = true;
      return child;
    },
    probeHindsight: async () => healthy,
    fileExists: (value) => value === executable,
    daemonEnv: () => sanitizeDaemonEnv({
      ALL_PROXY: "socks5://127.0.0.1:7897",
      HTTPS_PROXY: "http://127.0.0.1:7897",
      PATH: "/usr/bin",
    }),
    startHindsight: async (app, settings, options) => {
      const result = await options.spawnProcess(settings.executablePath, [...app.defaultArgs], {
        env: options.env,
        detached: true,
      });
      return { pid: result.pid, alreadyRunning: false, healthUrl: "http://127.0.0.1:8888/health", mcpUrl: "http://127.0.0.1:8888/mcp/default/", port: 8888 };
    },
  });
  const status = await service.launch("hindsight");
  assert.equal(status.app.id, "hindsight");
  assert.equal(spawnCalls[0].file, executable);
  assert.deepEqual(spawnCalls[0].args, ["daemon", "start"]);
  assert.equal(spawnCalls[0].options.env.ALL_PROXY, undefined);
  assert.equal(status.process.status, "running");
});

test("service updateConfig writes hindsight llm settings without changing args", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const writes = [];
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    writeHindsightLlm: (patch) => writes.push(patch),
    readHindsightLlm: () => ({
      provider: "openai",
      baseUrl: "https://your-endpoint.com/v1",
      model: "gpt-4o-mini",
      hasApiKey: true,
      apiKeyMasked: "sk-t****test",
    }),
    probeHindsight: async () => false,
  });
  const status = await service.updateConfig("hindsight", {
    llm: {
      provider: "openai",
      baseUrl: "https://your-endpoint.com/v1",
      model: "gpt-4o-mini",
      apiKey: "sk-test",
    },
  });
  assert.deepEqual(writes[0].baseUrl, "https://your-endpoint.com/v1");
  assert.equal(status.llm.baseUrl, "https://your-endpoint.com/v1");
  assert.equal(status.llm.hasApiKey, true);
});

test("hindsight default profile stores gateway source references and renders env snapshot", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  const envWrites = [];
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: { hindsight: { executablePath: executable } } }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    writeHindsightLlm: (patch) => envWrites.push(patch),
    readHindsightLlm: () => ({
      provider: "openai",
      baseUrl: "http://127.0.0.1:8787/work-buddy/",
      model: "glm-5.2",
      hasApiKey: true,
      apiKeyMasked: "all",
    }),
    probeHindsight: async () => false,
  });
  const status = await service.updateConfig("hindsight", {
    llmSource: {
      type: "gateway",
      client: "work-buddy",
      endpointId: null,
      model: "glm-5.2",
    },
    embeddingSource: {
      type: "gateway",
      client: "work-buddy",
      endpointId: null,
      model: "text-embedding-3-small",
    },
  });
  assert.deepEqual(saved.at(-1).hindsightProfiles.default.llmSource, {
    type: "gateway",
    client: "work-buddy",
    endpointId: null,
    model: "glm-5.2",
  });
  assert.equal(envWrites[0].provider, "openai");
  assert.equal(envWrites[0].baseUrl, "http://127.0.0.1:8787/work-buddy/");
  assert.equal(envWrites[0].model, "glm-5.2");
  assert.equal(envWrites[0].apiKey, "all");
  assert.equal(status.llm.provider, "openai");
});

test("saving gateway llm with local embeddings does not force openai embeddings", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  const envWrites = [];
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: { hindsight: { executablePath: executable } } }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    writeHindsightLlm: (patch) => envWrites.push({ ...patch }),
    readHindsightLlm: () => ({
      provider: "openai",
      baseUrl: "http://127.0.0.1:8787/hindsight/",
      model: "glm-5.3-zp",
      hasApiKey: true,
      apiKeyMasked: "all",
      embeddingsProvider: "local",
      hasEmbeddingsApiKey: false,
    }),
    probeHindsight: async () => false,
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
  });
  const status = await service.updateConfig("hindsight:coding-agent", {
    llm: {
      provider: "openai",
      baseUrl: "http://127.0.0.1:8787/hindsight/",
      model: "glm-5.3-zp",
      embeddingsProvider: "local",
      embeddingsModel: "",
      embeddingsApiKey: "",
    },
    llmSource: {
      type: "gateway",
      client: "hindsight",
      endpointId: null,
      model: "glm-5.3-zp",
    },
    embeddingSource: {
      type: "local",
      client: "",
      endpointId: null,
      model: "",
    },
  });
  assert.equal(saved.at(-1).hindsightProfiles["coding-agent"].embeddingSource.type, "local");
  const merged = Object.assign({}, ...envWrites);
  assert.equal(merged.embeddingsProvider, "local");
  assert.notEqual(merged.embeddingsProvider, "openai");
  assert.ok(!merged.embeddingsApiKey);
  assert.equal(status.llm.embeddingsProvider, "local");
  assert.deepEqual(status.llmSource, {
    type: "gateway",
    client: "hindsight",
    endpointId: null,
    model: "glm-5.3-zp",
  });
  assert.equal(status.embeddingSource.type, "local");
});

test("gateway source status round-trips client and model after save", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  const envWrites = [];
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: { hindsight: { executablePath: executable } } }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    writeHindsightLlm: (patch) => envWrites.push({ ...patch }),
    readHindsightLlm: () => {
      const last = envWrites.at(-1) || {};
      return {
        provider: last.provider || "openai",
        baseUrl: last.baseUrl || "http://127.0.0.1:8787/hindsight/",
        model: last.model || "glm-5.3-zp",
        hasApiKey: true,
        apiKeyMasked: "all",
        embeddingsProvider: last.embeddingsProvider || "local",
        hasEmbeddingsApiKey: false,
      };
    },
    probeHindsight: async () => false,
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
  });
  await service.updateConfig("hindsight:coding-agent", {
    llm: {
      provider: "openai",
      baseUrl: "http://127.0.0.1:8787/hindsight/",
      model: "glm-5.3-zp",
      embeddingsProvider: "local",
      embeddingsModel: "",
      embeddingsApiKey: "",
    },
    llmSource: {
      type: "gateway",
      client: "codex",
      endpointId: null,
      model: "deepseek-v4-pro-jiyuan",
    },
    embeddingSource: {
      type: "local",
      client: "",
      endpointId: null,
      model: "",
    },
  });
  const status = await service.getStatus("hindsight:coding-agent");
  assert.deepEqual(status.llmSource, {
    type: "gateway",
    client: "codex",
    endpointId: null,
    model: "deepseek-v4-pro-jiyuan",
  });
  assert.equal(status.embeddingSource.type, "local");
  const merged = Object.assign({}, ...envWrites);
  assert.equal(merged.model, "deepseek-v4-pro-jiyuan");
  assert.equal(merged.baseUrl, "http://127.0.0.1:8787/codex/");
  assert.equal(merged.apiKey, "all");
  assert.equal(merged.embeddingsProvider, "local");
});


test("gateway llm source keeps pointing at the stable local gateway even on a worktree port", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  const envWrites = [];
  const previousPort = process.env.GATEWAY_PORT;
  process.env.GATEWAY_PORT = "8788";
  try {
    const service = createCommandAppsService({
      configStore: {
        get() { return saved.at(-1) || { apps: { hindsight: { executablePath: executable } } }; },
        save(next) { saved.push(next); return next; },
      },
      platform: "darwin",
      fileExists: (value) => value === executable,
      writeHindsightLlm: (patch) => envWrites.push({ ...patch }),
      readHindsightLlm: () => ({
        provider: "openai",
        baseUrl: envWrites.at(-1)?.baseUrl || "",
        model: envWrites.at(-1)?.model || "",
        hasApiKey: true,
        apiKeyMasked: "all",
        embeddingsProvider: "local",
        hasEmbeddingsApiKey: false,
      }),
      probeHindsight: async () => false,
      inspectHindsight: async () => ({ status: "stopped", pid: null }),
    });
    await service.updateConfig("hindsight:coding-agent", {
      llmSource: {
        type: "gateway",
        client: "codex",
        endpointId: null,
        model: "deepseek-v4-pro-jiyuan",
      },
      embeddingSource: {
        type: "local",
        client: "",
        endpointId: null,
        model: "",
      },
    });
    assert.equal(envWrites[0].baseUrl, "http://127.0.0.1:8787/codex/");
    assert.equal(envWrites[0].model, "deepseek-v4-pro-jiyuan");
    assert.equal(envWrites[0].apiKey, "all");
  } finally {
    if (previousPort === undefined) delete process.env.GATEWAY_PORT;
    else process.env.GATEWAY_PORT = previousPort;
  }
});

test("hindsight status is launching when lock pid is alive but health is down", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const lastLaunchedAt = new Date().toISOString();
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable, lastLaunchedAt } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    inspectHindsight: async () => ({ status: "launching", pid: 10766 }),
    probeHindsight: async () => false,
  });
  const status = await service.getStatus("hindsight");
  assert.equal(status.process.status, "launching");
  assert.equal(status.process.count, 1);
});

test("hindsight stops reporting launching after the startup deadline", async () => {
  const app = getCommandApp("hindsight");
  const lastLaunchedAt = new Date(Date.now() - 181000).toISOString();
  const inspected = await inspectHindsightDaemon(app, { lastLaunchedAt }, {
    probe: async () => false,
    lockPid: 4242,
    isPidAlive: () => true,
  });
  assert.equal(inspected.status, "stopped");
  assert.equal(inspected.pid, null);
});

test("hindsight profile files and daemon args stay isolated", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-profiles-"));
  fs.mkdirSync(path.join(tmp, ".hindsight", "profiles"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".hindsight", "embed"), "HINDSIGHT_API_LLM_MODEL=default-model\n");
  fs.writeFileSync(path.join(tmp, ".hindsight", "profiles", "coding-agent.env"), "HINDSIGHT_API_LLM_MODEL=codex-model\n");
  const profiles = listHindsightProfileFiles({
    homeDir: tmp,
    fileExists: (filePath) => fs.existsSync(filePath),
    readDir: (dirPath) => fs.readdirSync(dirPath),
  });
  assert.deepEqual(profiles.map((item) => item.name).sort(), ["coding-agent", "default"]);
  assert.equal(defaultHindsightConfigPath(tmp, "default"), path.join(tmp, ".hindsight", "embed"));
  assert.equal(defaultHindsightConfigPath(tmp, "coding-agent"), path.join(tmp, ".hindsight", "profiles", "coding-agent.env"));
  assert.deepEqual(hindsightDaemonArgs("start", "default"), ["daemon", "start"]);
  assert.deepEqual(hindsightDaemonArgs("start", "coding-agent"), ["-p", "coding-agent", "daemon", "start"]);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("hindsight control plane reuses a healthy server and returns a bank deep link", async () => {
  const result = await ensureHindsightControlPlane({
    apiUrl: "http://127.0.0.1:9077",
    port: 19077,
    bankId: "coding-agent::local-ai-gateway",
    probe: async (url) => url === "http://127.0.0.1:19077/api/health",
    spawnProcess: () => {
      throw new Error("should not spawn when already healthy");
    },
  });
  assert.deepEqual(result, {
    running: true,
    alreadyRunning: true,
    port: 19077,
    apiUrl: "http://127.0.0.1:9077",
    bankId: "coding-agent::local-ai-gateway",
    url: "http://127.0.0.1:19077/banks/coding-agent%3A%3Alocal-ai-gateway",
  });
});

test("hindsight control plane starts on 0.0.0.0 to avoid the loopback redirect bug", async () => {
  const spawnCalls = [];
  let healthy = false;
  const child = { pid: 99123, unref() { this.unrefed = true; }, unrefed: false };
  const result = await ensureHindsightControlPlane({
    apiUrl: "http://127.0.0.1:9077",
    port: 19077,
    bankId: "coding-agent::local-ai-gateway",
    probe: async () => healthy,
    spawnProcess: (...args) => {
      spawnCalls.push(args);
      healthy = true;
      return child;
    },
    waitMs: async () => {},
  });
  assert.equal(result.alreadyRunning, false);
  assert.equal(result.running, true);
  assert.equal(result.url, "http://127.0.0.1:19077/banks/coding-agent%3A%3Alocal-ai-gateway");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0][0], "npx");
  assert.deepEqual(spawnCalls[0][1], [
    "@vectorize-io/hindsight-control-plane@0.9.2",
    "--port",
    "19077",
    "--hostname",
    "0.0.0.0",
    "--api-url",
    "http://127.0.0.1:9077",
  ]);
  assert.equal(spawnCalls[0][2].detached, true);
  assert.equal(spawnCalls[0][2].stdio, "ignore");
  assert.equal(child.unrefed, true);
});

test("command apps service opens the coding-agent control plane deep link", async () => {
  const service = createCommandAppsService({
    configStore: { get: () => ({}), save() {} },
    platform: "darwin",
    ensureControlPlane: async ({ bankId }) => ({
      running: true,
      alreadyRunning: true,
      port: 19077,
      apiUrl: "http://127.0.0.1:9077",
      bankId,
      url: "http://127.0.0.1:19077/banks/" + encodeURIComponent(bankId),
    }),
  });
  const result = await service.openHindsightControlPlane({ bankId: "coding-agent::local-ai-gateway" });
  assert.equal(result.bankId, "coding-agent::local-ai-gateway");
  assert.equal(result.url, "http://127.0.0.1:19077/banks/coding-agent%3A%3Alocal-ai-gateway");
});

test("opening the memory page ensures the Hindsight daemon is healthy first", async () => {
  const calls = [];
  const service = createCommandAppsService({
    configStore: { get: () => ({}), save() {} },
    platform: "darwin",
    probeHindsight: async (app, settings) => {
      calls.push(["probe", settings.profileName, settings.port]);
      return true;
    },
    ensureControlPlane: async ({ apiUrl, bankId }) => {
      calls.push(["control-plane", apiUrl, bankId]);
      return {
        running: true,
        alreadyRunning: true,
        port: 19077,
        apiUrl,
        bankId,
        url: "http://127.0.0.1:19077/banks/" + encodeURIComponent(bankId),
      };
    },
  });
  await service.openHindsightControlPlane({ bankId: "coding-agent::local-ai-gateway" });
  assert.deepEqual(calls[0], ["probe", "coding-agent", 9077]);
  assert.deepEqual(calls[1], ["control-plane", "http://127.0.0.1:9077", "coding-agent::local-ai-gateway"]);
});

test("routes open a Hindsight Control Plane bank page", async () => {
  const { fx, reqFor, res, responses } = createRouteFixture();
  const original = fx.service.openHindsightControlPlane;
  fx.service.openHindsightControlPlane = async (body) => ({
    running: true,
    alreadyRunning: true,
    port: 19077,
    apiUrl: "http://127.0.0.1:9077",
    bankId: body.bankId,
    url: "http://127.0.0.1:19077/banks/" + encodeURIComponent(body.bankId),
  });
  try {
    await routeCommandAppsRequest(
      reqFor("POST", "/v1/command-apps/hindsight/control-plane", { bankId: "coding-agent::local-ai-gateway" }),
      res,
      null,
      "/v1/command-apps/hindsight/control-plane",
      { service: fx.service },
    );
  } finally {
    fx.service.openHindsightControlPlane = original;
  }
  assert.equal(responses[0].status, 200);
  const body = JSON.parse(responses[0].body);
  assert.equal(body.bankId, "coding-agent::local-ai-gateway");
  assert.equal(body.url, "http://127.0.0.1:19077/banks/coding-agent%3A%3Alocal-ai-gateway");
});

test("service installs hindsight-embed with uv and rediscovers its executable", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  let installed = false;
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: {} }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    discovery: async (app) => installed && app.id.startsWith("hindsight")
      ? { selected: { path: executable, strategy: "path-environment" }, candidates: [] }
      : { selected: null, candidates: [] },
    fileExists: (value) => installed && value === executable,
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed,
      version: installed ? "0.9.3" : null,
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    installHindsightPackage: async () => { installed = true; },
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    probeHindsight: async () => false,
  });

  const result = await service.installHindsightTool();

  assert.equal(result.tool.installed, true);
  assert.equal(result.tool.version, "0.9.3");
  assert.equal(result.apps.find((item) => item.profileName === "default").executablePath, executable);
  assert.equal(saved.at(-1).apps.hindsight.executablePath, executable);
});

test("service install only rediscovers an existing uv tool when its saved path is missing", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  let installCalled = false;
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: {} }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    discovery: async () => ({ selected: { path: executable, strategy: "path-environment" }, candidates: [] }),
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: true,
      managedByUv: true,
      version: "0.9.3",
      executablePath: null,
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    installHindsightPackage: async () => { installCalled = true; },
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    probeHindsight: async () => false,
  });

  const result = await service.installHindsightTool();

  assert.equal(installCalled, false);
  assert.equal(result.tool.installed, true);
  assert.equal(result.tool.executablePath, executable);
  assert.equal(saved.at(-1).apps.hindsight.executablePath, executable);
});

test("service distinguishes an existing non-uv hindsight-embed installation", async () => {
  const executable = "/opt/tools/hindsight-embed";
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: false,
      managedByUv: false,
      version: null,
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    probeHindsight: async () => false,
  });

  const status = await service.getHindsightToolStatus();

  assert.equal(status.installed, true);
  assert.equal(status.managedByUv, false);
  assert.equal(status.executablePath, executable);
  assert.equal(status.version, null);
});

test("service keeps uv installation status without a saved path and rediscovers it during update", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const saved = [];
  let updated = false;
  const service = createCommandAppsService({
    configStore: {
      get() { return saved.at(-1) || { apps: {} }; },
      save(next) { saved.push(next); return next; },
    },
    platform: "darwin",
    fileExists: (value) => updated && value === executable,
    discovery: async () => updated
      ? { selected: { path: executable, strategy: "path-environment" }, candidates: [] }
      : { selected: null, candidates: [] },
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: true,
      managedByUv: true,
      version: updated ? "0.9.4" : "0.9.3",
      executablePath: null,
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    updateHindsightPackage: async () => { updated = true; },
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    probeHindsight: async () => false,
  });

  const before = await service.getHindsightToolStatus();
  const result = await service.updateHindsightTool();

  assert.equal(before.installed, true);
  assert.equal(before.managedByUv, true);
  assert.equal(before.executablePath, null);
  assert.equal(result.tool.version, "0.9.4");
  assert.equal(result.tool.executablePath, executable);
  assert.equal(saved.at(-1).apps.hindsight.executablePath, executable);
});

test("service rejects uv update for a non-uv hindsight-embed installation", async () => {
  const executable = "/opt/tools/hindsight-embed";
  let updateCalled = false;
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: false,
      managedByUv: false,
      version: null,
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    updateHindsightPackage: async () => { updateCalled = true; },
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    probeHindsight: async () => false,
  });

  await assert.rejects(
    () => service.updateHindsightTool(),
    (error) => error instanceof CommandAppsError
      && error.code === "invalid_request"
      && /not managed by uv/.test(error.message),
  );
  assert.equal(updateCalled, false);
});

test("service update stops active hindsight profiles and restores them after uv upgrade", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const running = new Set(["default", "coding-agent"]);
  const calls = [];
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    listHindsightProfiles: () => ([
      { name: "default", configPath: "/tmp/.hindsight/embed", port: 8888 },
      { name: "coding-agent", configPath: "/tmp/.hindsight/profiles/coding-agent.env", port: 9077 },
    ]),
    inspectHindsight: async (_app, settings) => ({
      status: running.has(settings.profileName) ? "running" : "stopped",
      pid: running.has(settings.profileName) ? 4242 : null,
    }),
    stopHindsight: async (_app, settings) => {
      calls.push(`stop:${settings.profileName}`);
      running.delete(settings.profileName);
    },
    startHindsight: async (_app, settings) => {
      calls.push(`start:${settings.profileName}`);
      running.add(settings.profileName);
      return { pid: 5000 };
    },
    updateHindsightPackage: async () => { calls.push("uv:update"); },
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: true,
      version: "0.9.3",
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    discovery: async () => ({ selected: { path: executable, strategy: "path-environment" }, candidates: [] }),
    probeHindsight: async () => false,
  });

  const result = await service.updateHindsightTool();

  assert.deepEqual(calls, [
    "stop:default",
    "stop:coding-agent",
    "uv:update",
    "start:default",
    "start:coding-agent",
  ]);
  assert.equal(result.tool.version, "0.9.3");
  assert.deepEqual([...running].sort(), ["coding-agent", "default"]);
});

test("service restores active hindsight profiles when uv upgrade fails", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const running = new Set(["coding-agent"]);
  const calls = [];
  const updateError = new CommandAppsError("process_error", "uv upgrade failed");
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    listHindsightProfiles: () => ([
      { name: "default", configPath: "/tmp/.hindsight/embed", port: 8888 },
      { name: "coding-agent", configPath: "/tmp/.hindsight/profiles/coding-agent.env", port: 9077 },
    ]),
    inspectHindsight: async (_app, settings) => ({
      status: running.has(settings.profileName) ? "running" : "stopped",
      pid: running.has(settings.profileName) ? 4242 : null,
    }),
    stopHindsight: async (_app, settings) => {
      calls.push(`stop:${settings.profileName}`);
      running.delete(settings.profileName);
    },
    startHindsight: async (_app, settings) => {
      calls.push(`start:${settings.profileName}`);
      running.add(settings.profileName);
      return { pid: 5000 };
    },
    updateHindsightPackage: async () => {
      calls.push("uv:update");
      throw updateError;
    },
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: true,
      version: "0.9.2",
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    discovery: async () => ({ selected: { path: executable, strategy: "path-environment" }, candidates: [] }),
    probeHindsight: async () => false,
  });

  await assert.rejects(
    () => service.updateHindsightTool(),
    (error) => error === updateError,
  );
  assert.deepEqual(calls, ["stop:coding-agent", "uv:update", "start:coding-agent"]);
  assert.deepEqual([...running], ["coding-agent"]);
});

test("service reports a restore failure after a successful uv upgrade", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const running = new Set(["coding-agent"]);
  const warnings = [];
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    listHindsightProfiles: () => ([
      { name: "default", configPath: "/tmp/.hindsight/embed", port: 8888 },
      { name: "coding-agent", configPath: "/tmp/.hindsight/profiles/coding-agent.env", port: 9077 },
    ]),
    inspectHindsight: async (_app, settings) => ({
      status: running.has(settings.profileName) ? "running" : "stopped",
      pid: running.has(settings.profileName) ? 4242 : null,
    }),
    stopHindsight: async (_app, settings) => { running.delete(settings.profileName); },
    startHindsight: async () => { throw new Error("daemon start failed"); },
    updateHindsightPackage: async () => {},
    inspectHindsightToolState: async () => ({
      uvAvailable: true,
      installed: true,
      version: "0.9.3",
      installCommand: "uv tool install hindsight-embed",
      updateCommand: "uv tool upgrade hindsight-embed",
    }),
    discovery: async () => ({ selected: { path: executable, strategy: "path-environment" }, candidates: [] }),
    probeHindsight: async () => false,
    logger: { warn(message) { warnings.push(message); } },
  });

  await assert.rejects(
    () => service.updateHindsightTool(),
    (error) => error instanceof CommandAppsError
      && error.code === "process_error"
      && /restore/.test(error.message),
  );
  assert.equal(warnings.length, 1);
  assert.deepEqual([...running], []);
});

test("routes expose Hindsight tool status, install, and update actions", async () => {
  const { fx, reqFor, res, responses } = createRouteFixture();
  fx.service.getHindsightToolStatus = async () => ({ installed: false, uvAvailable: true });
  fx.service.installHindsightTool = async () => ({ tool: { installed: true, version: "0.9.3" }, apps: [] });
  fx.service.updateHindsightTool = async () => ({ tool: { installed: true, version: "0.9.4" }, apps: [] });

  await routeCommandAppsRequest(reqFor("GET", "/v1/command-apps/hindsight/tool"), res, null, "/v1/command-apps/hindsight/tool", { service: fx.service });
  await routeCommandAppsRequest(reqFor("POST", "/v1/command-apps/hindsight/install", {}), res, null, "/v1/command-apps/hindsight/install", { service: fx.service });
  await routeCommandAppsRequest(reqFor("POST", "/v1/command-apps/hindsight/update", {}), res, null, "/v1/command-apps/hindsight/update", { service: fx.service });

  assert.equal(JSON.parse(responses[0].body).installed, false);
  assert.equal(JSON.parse(responses[1].body).tool.version, "0.9.3");
  assert.equal(JSON.parse(responses[2].body).tool.version, "0.9.4");
});

test("service lists each on-disk hindsight profile as its own card", async () => {
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const service = createCommandAppsService({
    configStore: {
      get() { return { apps: { hindsight: { executablePath: executable } } }; },
      save() {},
    },
    platform: "darwin",
    fileExists: (value) => value === executable,
    listHindsightProfiles: () => ([
      { name: "default", configPath: "/tmp/.hindsight/embed", port: 8888 },
      { name: "coding-agent", configPath: "/tmp/.hindsight/profiles/coding-agent.env", port: 9077 },
    ]),
    readHindsightLlm: (profileName = "default") => ({
      provider: "openai",
      model: profileName === "coding-agent" ? "codex-model" : "default-model",
      baseUrl: profileName === "coding-agent" ? "http://127.0.0.1:9077" : "http://127.0.0.1:8888",
      hasApiKey: false,
      apiKeyMasked: null,
    }),
    probeHindsight: async () => false,
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
  });
  const list = await service.listApps();
  const cards = list.filter((item) => String(item.app.id).startsWith("hindsight"));
  assert.equal(cards.length, 2);
  assert.equal(cards[0].app.id, "hindsight");
  assert.equal(cards[0].profileName, "default");
  assert.equal(cards[1].app.id, "hindsight:coding-agent");
  assert.equal(cards[1].profileName, "coding-agent");
  assert.equal(cards[1].llm.model, "codex-model");
});

test("coding-agent plugin profile is listed even before its env file exists", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-plugin-"));
  fs.mkdirSync(path.join(tmp, ".hindsight"), { recursive: true });
  fs.writeFileSync(path.join(tmp, ".hindsight", "embed"), "HINDSIGHT_API_LLM_MODEL=default-model\n");
  fs.writeFileSync(path.join(tmp, ".hindsight", "coding-agent.json"), JSON.stringify({ serverMode: "daemon" }));
  const profiles = listHindsightProfileFiles({
    homeDir: tmp,
    fileExists: (filePath) => fs.existsSync(filePath),
    readDir: (dirPath) => fs.existsSync(dirPath) ? fs.readdirSync(dirPath) : [],
    readFile: (filePath) => fs.readFileSync(filePath, "utf8"),
  });
  assert.deepEqual(profiles.map((item) => item.name).sort(), ["coding-agent", "default"]);
  const pluginProfile = profiles.find((item) => item.name === "coding-agent");
  assert.equal(pluginProfile.declaredByPlugin, true);
  assert.equal(pluginProfile.port, 9077);
  assert.equal(pluginProfile.exists, false);
  const plugin = readCodingAgentPluginConfig({
    homeDir: tmp,
    fileExists: (filePath) => fs.existsSync(filePath),
    readFile: (filePath) => fs.readFileSync(filePath, "utf8"),
  });
  assert.equal(plugin.daemonProfile, "coding-agent");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("service always lists coding-agent and can point Codex at another profile", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hindsight-plugin-bind-"));
  const home = path.join(tmp, ".hindsight");
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, "embed"), "HINDSIGHT_API_LLM_MODEL=default-model\n");
  fs.writeFileSync(path.join(home, "coding-agent.json"), JSON.stringify({ serverMode: "daemon", retainTags: ["keep-me"] }));
  const executable = "/Users/pa/.local/bin/hindsight-embed";
  const originalHome = process.env.HOME;
  process.env.HOME = tmp;
  try {
    const service = createCommandAppsService({
      configStore: {
        get() { return { apps: { hindsight: { executablePath: executable } } }; },
        save() {},
      },
      platform: "darwin",
      fileExists: (value) => value === executable || fs.existsSync(value),
      probeHindsight: async () => false,
      inspectHindsight: async () => ({ status: "stopped", pid: null }),
    });
    const listed = await service.listApps();
    const cards = listed.filter((item) => String(item.app.id).startsWith("hindsight"));
    assert.equal(cards.length, 2);
    const coding = cards.find((item) => item.profileName === "coding-agent");
    const fallback = cards.find((item) => item.profileName === "default");
    assert.equal(coding.app.id, "hindsight:coding-agent");
    assert.equal(coding.plugin.usedByCodex, true);
    assert.equal(coding.plugin.daemonProfile, "coding-agent");
    assert.equal(fallback.plugin.usedByCodex, false);

    const updated = await service.updateConfig("hindsight", { daemonProfile: "default" });
    assert.equal(updated.plugin.usedByCodex, true);
    assert.equal(updated.plugin.daemonProfile, "default");
    const after = await service.listApps();
    const afterCards = after.filter((item) => String(item.app.id).startsWith("hindsight"));
    assert.deepEqual(afterCards.map((item) => item.profileName).sort(), ["coding-agent", "default"]);
    assert.equal(afterCards.find((item) => item.profileName === "default").plugin.usedByCodex, true);
    assert.equal(afterCards.find((item) => item.profileName === "coding-agent").plugin.usedByCodex, false);
    const raw = JSON.parse(fs.readFileSync(path.join(home, "coding-agent.json"), "utf8"));
    assert.equal(raw.daemonProfile, "default");
    assert.deepEqual(raw.retainTags, ["keep-me"]);
  } finally {
    process.env.HOME = originalHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
