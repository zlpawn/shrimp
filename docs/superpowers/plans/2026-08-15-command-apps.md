# Command Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a System Extensions tab that discovers, launches, monitors, and stops Antigravity on Windows with a multi-app architecture.

**Architecture:** A built-in app registry defines immutable launch definitions; a Command Apps application service orchestrates discovery, config persistence, process supervision, and status. The existing gateway routes local HTTP requests to the service, while a registered frontend module renders the panel and calls the backend as the source of truth.

**Tech Stack:** Node.js ES modules, Node `child_process`, Node filesystem APIs, vanilla TypeScript frontend, existing CSS token system, `node:test`.

## Global Constraints

- Visible tab label: **命令行程序 (Command Apps)**.
- Route and tab id: `command-apps`.
- Phase 1 app id: `antigravity`.
- Antigravity args: exactly `["--no-sandbox"]`.
- Windows executable suffix: `.exe`.
- Phase 1 supported platform: `win32`.
- No shell command strings, pipes, redirection, or request-supplied arguments.
- All HTTP routes use `checkLocalAuth(req, res)`.
- Work only in `D:\agent-transfer\.worktrees\command-apps` on branch `codex/command-apps`.
- Preserve unrelated dirty state; never reset or checkout branches.

---

### Task 1: Domain Model and Registry

**Files:**
- Create: `lib/command-apps/domain/errors.mjs`
- Create: `lib/command-apps/domain/registry.mjs`
- Create: `lib/command-apps/domain/schema.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces `CommandAppsError(code, message, details)`.
- Produces `COMMAND_APPS_ERROR_STATUS`.
- Produces `listCommandApps() -> CommandAppDefinition[]`.
- Produces `getCommandApp(id) -> CommandAppDefinition | null`.
- Produces `normalizeCommandAppsConfig(input, { platform }) -> CommandAppsConfig`.
- Produces `validateAppSettings(app, settings, { platform, fileExists }) -> ValidatedAppSettings`.

- [ ] **Step 1: Write failing domain tests**

Create `tests/unit/command-apps.test.mjs` with these first tests:

```js
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

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
```

- [ ] **Step 2: Verify the domain tests fail**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: import failure because `lib/command-apps/index.mjs` does not exist.

- [ ] **Step 3: Implement the domain modules**

Implement:

```js
// errors.mjs
export class CommandAppsError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "CommandAppsError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
export const COMMAND_APPS_ERROR_STATUS = {
  invalid_request: 400,
  app_not_found: 404,
  unsupported_platform: 501,
  executable_not_found: 400,
  process_error: 500,
  storage_error: 500,
};
```

Create an immutable Antigravity registry entry with id, display name, executable name, args, platform, and discovery strategy names. Normalize persisted settings to `{ apps: { [id]: { executablePath, args, manuallyConfigured, lastLaunchedAt } } }`, always copying `args` from the registry rather than trusting stored args. Validation requires `path.isAbsolute`, `.exe` on Windows, and injected `fileExists`.

- [ ] **Step 4: Verify tests pass**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps tests/unit/command-apps.test.mjs
git commit -m "feat: add command apps domain"
```

---

### Task 2: Windows Executable Discovery

**Files:**
- Create: `lib/command-apps/infra/discovery.mjs`
- Modify: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces `discoverCommandApp(app, { platform, env, fileExists, statFile, queryAppPaths, searchPathDirs, readShortcutTarget }) -> Promise<{ selected, candidates }>`.

- [ ] **Step 1: Add failing discovery tests**

Append tests that inject filesystem and registry probes:

```js
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
    fileExists: (p) => p.endsWith("Antigravity.exe"),
    statFile: async (p) => ({ isFile: () => true }),
    queryAppPaths: async () => ["C:\\Missing\\App.exe"],
    searchPathDirs: async () => [],
    readShortcutTarget: async () => "",
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.selected.strategy, "well-known-localappdata");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: `discoverCommandApp is not defined`.

- [ ] **Step 3: Implement discovery**

Gather candidates in strategy order, validate absolute `.exe` regular files, de-duplicate by lowercased normalized path, and attach `strategy` plus `source`. Default adapters use:

- direct `fs.stat` for well-known paths;
- `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\Antigravity.exe /ve` through `execFile`, with HKLM fallback;
- PATH directory joins;
- Start Menu shortcut resolution through a PowerShell script argument passed to `execFile`.

Every external command uses argument arrays with `windowsHide: true` and a timeout.

- [ ] **Step 4: Verify tests pass**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps/infra/discovery.mjs tests/unit/command-apps.test.mjs
git commit -m "feat: discover windows command apps"
```

---

### Task 3: Process Store and Windows Process Adapter

**Files:**
- Create: `lib/command-apps/infra/process-store.mjs`
- Create: `lib/command-apps/infra/windows-processes.mjs`
- Modify: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces `createCommandAppsProcessStore() -> { record(appId, child), clear(appId, pid), get(appId) }`.
- Produces `listWindowsProcesses({ execFile }) -> Promise<Array<{ pid, executablePath }>>`.
- Produces `findProcessesByExecutable(processes, executablePath, { platform }) -> Array<{ pid, executablePath }>`.
- Produces `terminateProcessTree(pid, { execFile }) -> Promise<void>`.

- [ ] **Step 1: Add failing process tests**

Cover store lifecycle, case-insensitive Windows matching, ignored malformed rows, and taskkill invocation:

```js
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
```

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: process functions are not defined.

- [ ] **Step 3: Implement process modules**

Use PowerShell `Get-CimInstance Win32_Process` with `ProcessId,ExecutablePath` and CSV output to enumerate processes. Parse with a small quoted-CSV parser. Validate positive integer pids and absolute executable paths. Normalize matching with `path.resolve` plus lowercase on Windows. Terminate with `taskkill` argument arrays.

- [ ] **Step 4: Verify tests pass**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: 9 passing tests.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps/infra tests/unit/command-apps.test.mjs
git commit -m "feat: manage command app processes"
```

---

### Task 4: Application Service and HTTP Routes

**Files:**
- Create: `lib/command-apps/application/service.mjs`
- Create: `lib/command-apps/http/routes.mjs`
- Modify: `lib/command-apps/index.mjs`
- Modify: `server.js`
- Modify: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces `createCommandAppsService({ configStore, platform, discovery, processStore, listProcesses, terminateProcess, spawnProcess, logger })`.
- Service methods:
  - `listApps()`
  - `discover(appId)`
  - `getStatus(appId)`
  - `launch(appId)`
  - `stop(appId)`
  - `updateConfig(appId, patch)`
- Produces `routeCommandAppsRequest(req, res, context, reqPath, { service })`.

- [ ] **Step 1: Add failing service and route tests**

Inject a fake config store, fake process list, fake spawner, and fake terminator. Assert:

- launch resolves discovery and persists the executable;
- launch uses `spawnProcess(executable, ["--no-sandbox"], { detached: true, stdio: "ignore", windowsHide: true })`;
- external matching processes are reported as running;
- stop terminates only matching pids;
- config updates reject request args and invalid paths;
- `PUT /v1/command-apps/apps/antigravity/config` accepts `{ executablePath }`;
- unknown app id returns 404;
- launch body containing `{ args: ["--danger"] }` does not alter fixed args.

- [ ] **Step 2: Verify tests fail**

Run: `node --test tests/unit/command-apps.test.mjs`
Expected: service and route symbols are not defined.

- [ ] **Step 3: Implement service and routes**

Service uses config-store abstraction `{ get(), save(next) }`. It never reads `gateway.config.json` directly. Launch resolves the configured path, validates it, spawns detached, calls `child.unref()`, records pid/timestamp, and returns status. Stop enumerates exact executable matches and terminates each pid. Routes parse bounded JSON bodies and map `CommandAppsError` through `COMMAND_APPS_ERROR_STATUS`.

- [ ] **Step 4: Integrate gateway composition and dispatch**

In `server.js`:

- import `createCommandAppsService` and `routeCommandAppsRequest`;
- add `let globalCommandAppsService = null`;
- add `ensureCommandAppsService()` using `GATEWAY_CONFIG.commandApps` and a save callback that persists `commandApps`;
- route authenticated `/v1/command-apps` before generic API handlers.

- [ ] **Step 5: Run backend checks**

Run:
```bash
node --check server.js
node --test tests/unit/command-apps.test.mjs
```
Expected: syntax check passes and all command-apps tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/command-apps server.js tests/unit/command-apps.test.mjs
git commit -m "feat: add command apps API"
```

---

### Task 5: Frontend Tab and Refined Panel

**Files:**
- Create: `desktop/src/modules/command-apps.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/main.ts`
- Modify: `desktop/src/app.ts`
- Modify: `desktop/src/styles/panel.css`
- Modify: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Registered tab id: `command-apps`.
- API response shape consumed by UI:

```ts
type CommandAppStatus = {
  app: {
    id: string;
    displayName: string;
    args: string[];
    supported: boolean;
  };
  configured: boolean;
  executablePath: string;
  manuallyConfigured: boolean;
  lastLaunchedAt: string | null;
  process: {
    status: "stopped" | "running" | "error";
    count: number;
    launchedByPanel: boolean;
  };
};
```

- [ ] **Step 1: Add failing panel tests**

Append to `config-panel.test.mjs`:

```js
test("command apps tab is integrated into system extensions", async () => {
  const html = await readSources();
  assert.match(html, /命令行程序 \(Command Apps\)/);
  assert.match(html, /section-command-apps/);
  assert.match(html, /command-apps-root/);
  assert.match(html, /command-apps/);
  assert.match(html, /重新扫描/);
  assert.match(html, /手动路径/);
});

test("command apps module renders complete action states", async () => {
  const source = await readFile(path.join(ROOT, "desktop", "src", "modules", "command-apps.ts"), "utf8");
  assert.match(source, /Antigravity/);
  assert.match(source, /启动/);
  assert.match(source, /停止/);
  assert.match(source, /正在检测/);
  assert.match(source, /当前系统暂不支持/);
  assert.match(source, /escapeHtml/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*`[^`]*\$\{[^}]*executablePath[^}]*\}`(?!)/);
});
```

If the final `doesNotMatch` expression is too brittle after implementation, replace it with an explicit test helper `renderStatus()` covered by a VM fixture; never weaken escaping itself.

- [ ] **Step 2: Verify panel tests fail**

Run: `npm run test:config-panel`
Expected: new command apps assertions fail.

- [ ] **Step 3: Add navigation and section shell**

Add a System Extensions navigation link between NAT Traversal and Analytics with an existing terminal-style SVG icon, label `命令行程序 (Command Apps)`, href `#command-apps`, and `switchTab('command-apps')`. Add a hidden section with header copy `管理需要命令行参数启动的本机桌面程序。` and `<div id="command-apps-root">`.

- [ ] **Step 4: Implement the frontend module**

Create typed state `{ loading, error, status, pathDraft, editing, actionBusy }`, fetch helpers, render functions, event handlers, and `registerTab("command-apps", ...)`. Render:

- status card with semantic dot and badge;
- executable path row;
- fixed argument badges;
- last launch row;
- launch/stop/rescan actions;
- manual path form and save/cancel;
- loading skeleton;
- inline error;
- unsupported-platform state.

Use `escapeHtml` for every dynamic value. Add `command-apps` to known tabs and tab hook dispatch.

- [ ] **Step 5: Add refined CSS**

Add a scoped `.command-apps-*` block using current CSS variables. Use one 14px corner radius, a two-column metadata grid collapsing to one column under 900px, monospace path styling, semantic status colors, tactile button active states, skeleton animation, and a `prefers-reduced-motion` fallback. Do not introduce a new palette or card grid language.

- [ ] **Step 6: Verify frontend**

Run:
```bash
npm run test:config-panel
npm run build:panel
```
Expected: all panel tests pass and build completes.

- [ ] **Step 7: Commit**

```bash
git add desktop tests/unit/config-panel.test.mjs
git commit -m "feat: add command apps panel"
```

---

### Task 6: End-to-End Verification and Documentation Sweep

**Files:**
- Modify only if verification exposes a concrete issue.
- Possible focused fixes: `lib/command-apps/**`, `desktop/src/modules/command-apps.ts`, `desktop/src/styles/panel.css`, `server.js`.

**Interfaces:**
- No new interfaces.

- [ ] **Step 1: Run full relevant checks**

```bash
node --check server.js
node --test tests/unit/command-apps.test.mjs
npm run test:config-panel
npm run build:panel
```

- [ ] **Step 2: Start the worktree gateway safely**

Run: `npm start` in a separate terminal session from the worktree.
Expected: gateway starts without a command-apps import error.

- [ ] **Step 3: Verify API discovery**

Call `GET /v1/command-apps/status` with the existing local auth mechanism from the browser panel.
Expected: `configured: true` and the detected path is `C:\Users\xtea\AppData\Local\Programs\antigravity\Antigravity.exe`.

- [ ] **Step 4: Manual UI verification**

Open `/#command-apps`; verify:

1. navigation appears under 系统扩展;
2. loading skeleton appears;
3. detected path renders;
4. clicking 启动 opens Antigravity without a terminal window;
5. status becomes 运行中 and process count is at least 1;
6. last launch time renders;
7. clicking 停止 exits Antigravity;
8. status returns 已停止;
9. rescan keeps a valid manual path unchanged.

- [ ] **Step 5: Stop gateway and inspect worktree**

Stop the gateway process started for verification. Run `git status --short`.
Expected: only intentional source changes; no logs, databases, or build artifacts committed.

- [ ] **Step 6: Final commit if fixes were needed**

```bash
git add lib/command-apps desktop server.js tests
git commit -m "fix: polish command apps integration"
```

If no fixes are needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: registry, discovery, process control, security, routes, frontend states, styles, tests, Windows manual verification, and rollout are represented by Tasks 1 through 6.
- Placeholder scan: no unresolved placeholders or deferred implementation language remain.
- Type consistency: app id, route names, status shape, registry functions, and service method names are consistent across tasks.
- The plan remains a single cohesive vertical feature; backend and frontend are separately testable but not independently shippable.
