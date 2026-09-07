# Hindsight Config Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hindsight runtime configuration changes strongly consistent by safely stopping the active target profile before persisting new settings and only reporting success after a verified healthy restart.

**Architecture:** Add a focused Hindsight lifecycle coordinator to the Command Apps application service. It serializes all Hindsight update/launch/stop operations, validates target PIDs before termination, persists env plus shared source config as a rollback-capable unit, and verifies the new endpoint and profile lock after startup.

**Tech Stack:** Node.js 18 ESM, Node test runner, existing Command Apps service dependency injection, existing Hindsight daemon adapters, esbuild/TypeScript desktop panel.

**Spec:** `docs/superpowers/specs/2026-09-07-hindsight-config-restart-design.md`

## Global Constraints

- Runtime patch fields are `llm`, `llmSource`, `embeddingSource`, and legacy top-level `provider`, `baseUrl`, `model`, `apiKey`; requests containing them always enter the apply workflow, even if values appear unchanged.
- Actual operation order is inspect -> stop old -> write/rollback -> start new -> verify.
- Stop probes use pre-save settings; start probes use post-save settings.
- A stopped profile remains stopped after save.
- A PID may be terminated only after its target-profile ownership is proven by profile lock, live process lineage, and live command line; default-profile commands may omit `-p default`; parent `hindsight-embed` and child `hindsight-api` are both valid when ownership is proven.
- The new endpoint must be unoccupied before start. `alreadyRunning` alone is never accepted as a successful configuration apply.
- All Hindsight profile update/launch/stop operations share one in-process async mutex.
- Failure details use `configSaved`, `configState` (`saved`/`rolled_back`/`unknown`), `restartRequired`, `restarted`, and `phase` (`stop`/`write`/`start`).
- Keep secrets out of logs, errors, and status responses.

---

### Task 1: Hindsight process identity and safe termination

**Files:**
- Create: `lib/command-apps/infra/hindsight-processes.mjs`
- Modify: `lib/command-apps/infra/hindsight-daemon.mjs` to export `daemonUrl`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces `listHindsightProcessDetails({ platform, execFile })`
- Produces `verifyHindsightProcessOwnership({ pid, profileName, processes, parentPid, lockPid, executablePath, platform })`
- Produces `findSafelyTerminableHindsightPids({ profileName, processes, lockPid, executablePath, platform })`
- Produces `commandLineMatchesHindsightProfile(commandLine, profileName)`

- [ ] **Step 1: Write failing ownership tests**

Add these tests near the existing Hindsight daemon tests:

```js
test("hindsight process identity accepts explicit and default profile commands", () => {
  assert.equal(commandLineMatchesHindsightProfile("/bin/hindsight-embed -p coding-agent daemon start", "coding-agent"), true);
  assert.equal(commandLineMatchesHindsightProfile("/bin/hindsight-embed daemon start", "default"), true);
  assert.equal(commandLineMatchesHindsightProfile("/bin/hindsight-embed -p other daemon start", "coding-agent"), false);
  assert.equal(commandLineMatchesHindsightProfile("/usr/bin/python /bin/hindsight-api --host 127.0.0.1", "coding-agent"), false);
});

test("hindsight process identity verifies parent and command before termination", () => {
  const processes = [
    { pid: 10, parentPid: 1, commandLine: "/bin/hindsight-embed -p coding-agent daemon start" },
    { pid: 20, parentPid: 10, commandLine: "/usr/bin/python /bin/hindsight-api --port 9077" },
    { pid: 30, parentPid: 1, commandLine: "/bin/hindsight-embed -p other daemon start" },
  ];
  assert.deepEqual(findSafelyTerminableHindsightPids({
    profileName: "coding-agent",
    processes,
    lockPid: 20,
    executablePath: "/bin/hindsight-embed",
    platform: "darwin",
  }), [10, 20]);
  assert.deepEqual(findSafelyTerminableHindsightPids({
    profileName: "coding-agent",
    processes,
    lockPid: 30,
    executablePath: "/bin/hindsight-embed",
    platform: "darwin",
  }), []);
});
```

Import the new functions in the test file.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected failure: module import failure for `hindsight-processes.mjs`.

- [ ] **Step 3: Implement process identity**

Implement the functions with this behavior:

```js
export function commandLineMatchesHindsightProfile(commandLine, profileName) {
  const normalized = normalizeProfile(profileName);
  const text = String(commandLine || "");
  if (!/hindsight-embed|hindsight-api|hindsight_api/i.test(text)) return false;
  if (normalized === "default") {
    return /hindsight-embed/i.test(text) && !/\s-p\s+\S+/.test(text);
  }
  return new RegExp(`\\s-p\\s+${escapeRegExp(normalized)}(?:\\s|$)`).test(text);
}
```

`listHindsightProcessDetails` returns `{ pid, parentPid, commandLine, executablePath }` rows. On POSIX it calls `ps -ax -o pid=,ppid=,command=`; on Windows it queries `Get-CimInstance Win32_Process` with `ProcessId,ParentProcessId,CommandLine,ExecutablePath`. Query failures return `[]`.

`findSafelyTerminableHindsightPids` accepts:

1. a command-line-verified `hindsight-embed` process for the exact profile, or
2. a command-line-verified child `hindsight-api` process whose live parent chain reaches such an exact-profile parent, or
3. the profile lock PID when it also satisfies rule 1 or 2.

It never returns PID `1`, current process PID, processes from the global fallback without exact command-line evidence, or unexplained PIDs.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected: new identity tests pass; existing suite has only the documented live-service deep-link baseline failure while local Hindsight is offline.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps/infra/hindsight-processes.mjs tests/unit/command-apps.test.mjs
git commit -m "feat(command-apps): verify hindsight process identity"
```

### Task 2: Global Hindsight lifecycle mutex

**Files:**
- Modify: `lib/command-apps/application/service.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces internal `withHindsightLifecycle(fn)`
- Consumes `daemonUrl` from `lib/command-apps/infra/hindsight-daemon.mjs`
- Updates `launch(appId)`, `stop(appId)`, and `updateConfig(appId, patch)` to acquire it for every `app.type === "cli-daemon"` Hindsight call.

- [ ] **Step 1: Write failing serialization test**

```js
test("hindsight lifecycle operations are serialized globally", async () => {
  const active = [];
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } } }), save() {} },
    platform: "darwin",
    fileExists: () => true,
    startHindsight: async () => {
      active.push("start");
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.push("start-done");
      return { pid: 1 };
    },
    stopHindsight: async () => {
      active.push("stop");
      await new Promise((resolve) => setTimeout(resolve, 10));
      active.push("stop-done");
    },
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    probeHindsight: async () => false,
  });
  await Promise.all([service.launch("hindsight"), service.stop("hindsight")]);
  assert.equal(active.indexOf("stop"), active.lastIndexOf("stop"));
  assert.ok(
    active.indexOf("stop") > active.indexOf("start-done")
    || active.indexOf("start") > active.indexOf("stop-done"),
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected failure: interleaved operations make the ordering assertion fail.

- [ ] **Step 3: Implement mutex**

Inside `createCommandAppsService`, add:

```js
let hindsightLifecycleTail = Promise.resolve();
function withHindsightLifecycle(operation) {
  const run = hindsightLifecycleTail.then(operation, operation);
  hindsightLifecycleTail = run.then(noop, noop);
  return run;
}
function noop() {}
```

For Hindsight `launch` and `stop`, rename existing method bodies to private helpers and expose wrappers that call `withHindsightLifecycle`. Do the same for the Hindsight runtime-config branch of `updateConfig`; non-Hindsight apps keep existing behavior.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected: serialization test passes; baseline deep-link test remains the only environment-dependent failure.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps/application/service.mjs tests/unit/command-apps.test.mjs
git commit -m "fix(command-apps): serialize hindsight lifecycle operations"
```

### Task 3: Stop-before-write apply workflow

**Files:**
- Modify: `lib/command-apps/application/service.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Produces internal `applyHindsightRuntimeConfig({ app, patch })`
- Consumes Task 1 ownership helpers through injectable `listHindsightProcesses`
- Consumes existing `inspectHindsight`, `stopHindsight`, `terminateProcessByPlatform`, `isPidAlive`, `probeHindsight`

- [ ] **Step 1: Write failing core workflow tests**

Add five focused tests:

```js
test("saving runtime config stops active hindsight before writing and restarts after writing", async () => {
  const calls = [];
  const writes = [];
  const running = new Set(["coding-agent"]);
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } }, hindsightProfiles: { "coding-agent": { port: 9077 } } }), save() {} },
    platform: "darwin",
    fileExists: () => true,
    listHindsightProcesses: async () => [{ pid: 10, parentPid: 1, commandLine: "/bin/hindsight-embed -p coding-agent daemon start" }],
    inspectHindsight: async (_app, settings) => ({ status: running.has(settings.profileName) ? "running" : "stopped", pid: running.has(settings.profileName) ? 20 : null }),
    stopHindsight: async (_app, settings) => { calls.push(["stop", settings.port]); running.delete(settings.profileName); },
    readHindsightLlm: () => ({ provider: "openai", model: "new-model", hasApiKey: true }),
    writeHindsightLlm: (patch, name) => { calls.push(["write", name]); writes.push(patch); },
    startHindsight: async (_app, settings) => { calls.push(["start", settings.port]); running.add(settings.profileName); return { pid: 30, alreadyRunning: false }; },
    probeHindsight: async (_app, settings) => running.has(settings.profileName),
    isPidAlive: (pid) => pid === 30,
  });
  const status = await service.updateConfig("hindsight:coding-agent", { llm: { model: "new-model" } });
  assert.deepEqual(calls, [["stop", 9077], ["write", "coding-agent"], ["start", 9077]]);
  assert.deepEqual(status.configApply, { restartRequired: true, restarted: true });
});

test("saving runtime config keeps a stopped hindsight stopped", async () => {
  const calls = [];
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } } }), save() {} },
    platform: "darwin",
    fileExists: () => true,
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    writeHindsightLlm: (...args) => calls.push(["write", ...args]),
    stopHindsight: async () => calls.push(["stop"]),
    startHindsight: async () => calls.push(["start"]),
    probeHindsight: async () => false,
  });
  const status = await service.updateConfig("hindsight:coding-agent", { llm: { model: "new-model" } });
  assert.deepEqual(calls.map((row) => row[0]), ["write"]);
  assert.deepEqual(status.configApply, { restartRequired: false, restarted: false });
});

test("saving runtime config refuses to write when active hindsight cannot be proven and stopped", async () => {
  const writes = [];
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } } }), save() {} },
    platform: "darwin",
    fileExists: () => true,
    listHindsightProcesses: async () => [],
    inspectHindsight: async () => ({ status: "running", pid: 4242 }),
    stopHindsight: async () => {},
    writeHindsightLlm: (patch) => writes.push(patch),
    startHindsight: async () => { throw new Error("must not start"); },
    probeHindsight: async () => true,
    isPidAlive: () => true,
  });
  await assert.rejects(
    () => service.updateConfig("hindsight:coding-agent", { llm: { model: "new-model" } }),
    (error) => error.details?.configSaved === false && error.details?.configState === "rolled_back" && error.details?.phase === "stop",
  );
  assert.deepEqual(writes, []);
});

test("saving runtime config uses old port to stop and new port to start", async () => {
  const calls = [];
  const profiles = { "coding-agent": { port: 9077, llmSource: { type: "custom" } } };
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } }, hindsightProfiles: profiles }), save(next) { profiles.coding-agent = next.hindsightProfiles["coding-agent"]; } },
    platform: "darwin",
    fileExists: () => true,
    listHindsightProcesses: async () => [{ pid: 10, parentPid: 1, commandLine: "/bin/hindsight-embed -p coding-agent daemon start" }],
    inspectHindsight: async (_app, settings) => ({ status: "running", pid: 20 }),
    stopHindsight: async (_app, settings) => calls.push(["stop", settings.port]),
    writeHindsightLlm: () => {},
    startHindsight: async (_app, settings) => { calls.push(["start", settings.port]); return { pid: 30 }; },
    probeHindsight: async () => false,
    isPidAlive: () => true,
  });
  await service.updateConfig("hindsight:coding-agent", { llm: { host: "127.0.0.1", port: "9177", model: "new-model" } });
  assert.deepEqual(calls, [["stop", 9077], ["start", 9177]]);
});

test("saving runtime config rejects an occupied new endpoint before start", async () => {
  const calls = [];
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } }, hindsightProfiles: { "coding-agent": { port: 9077 } } }), save() {} },
    platform: "darwin",
    fileExists: () => true,
    listHindsightProcesses: async () => [{ pid: 10, parentPid: 1, commandLine: "/bin/hindsight-embed -p coding-agent daemon start" }],
    inspectHindsight: async () => ({ status: "running", pid: 20 }),
    stopHindsight: async () => {},
    writeHindsightLlm: () => { calls.push("write"); },
    startHindsight: async () => { calls.push("start"); },
    probeHindsight: async (_app, settings) => settings.port === 9077,
    isPidAlive: () => true,
  });
  await assert.rejects(
    () => service.updateConfig("hindsight:coding-agent", { llm: { host: "127.0.0.1", port: "9177", model: "new-model" } }),
    (error) => error.details?.configSaved === true && error.details?.configState === "saved" && error.details?.phase === "start" && !calls.includes("start"),
  );
  assert.deepEqual(calls, ["write"]);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected failures: `status.configApply` undefined, writes occur before stop, unknown PID is terminated, and endpoint collision calls start.

- [ ] **Step 3: Implement workflow**

Implement `applyHindsightRuntimeConfig`:

1. Capture `before = settingsWithProfile(app, profileName)`.
2. `inspectHindsight(app, before)`; treat `running`/`launching` as active.
3. For active instances, stop using old settings. After `stopHindsight`, require old health false and all prior PIDs dead. If not dead, use only ownership-verified PIDs from Task 1 for one termination attempt; recheck. If still alive, throw stop-phase details with `configState: "rolled_back"`.
4. Build the same merged LLM/source patch as the current two branches.
5. Snapshot old env text through injectable `readHindsightEnvFile`; snapshot old shared config. Write env, then shared config. On failure restore env and shared config; report `rolled_back` or `unknown`.
6. If inactive, return decorated status with `restartRequired: false`.
7. Read new settings; reject occupied endpoint before calling `startHindsight`.
8. Call `startHindsight`; reject `alreadyRunning: true`. After health, require a verified target lock/process PID. Record PID and launch metadata.
9. Decorate successful status with `configApply`; wrap start failures as saved/start details.

Inject `listHindsightProcesses`, `readHindsightEnvFile`, `writeHindsightEnvFile`, and `readHindsightLockPid`; default them to Task 1, raw config-file IO scoped to `settings.configPath`, and `readHindsightLockPid({ lockPath: defaultHindsightLockPath(undefined, profileName) })` from hindsight-daemon. Do not add secrets to errors.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected: new workflow tests pass; only documented live-service baseline failure remains.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps/application/service.mjs tests/unit/command-apps.test.mjs
git commit -m "fix(command-apps): apply hindsight config through safe restart"
```

### Task 4: Rollback and structured failure details

**Files:**
- Modify: `lib/command-apps/application/service.mjs`
- Test: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Consumes Task 3 workflow details.
- Produces stable error detail objects defined in Global Constraints.

- [ ] **Step 1: Write failing persistence failure tests**

```js
test("hindsight config write failure restores env and shared source config", async () => {
  const saved = [];
  const env = [];
  const service = createCommandAppsService({
    configStore: {
      get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } }, hindsightProfiles: { "coding-agent": { port: 9077 } } }),
      save(next) { saved.push(next); if (saved.length === 1) throw new Error("disk full"); },
    },
    platform: "darwin",
    fileExists: () => true,
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    readHindsightEnvFile: () => "HINDSIGHT_API_LLM_MODEL=old-model\n",
    writeHindsightEnvFile: (_path, text) => env.push(text),
    writeHindsightLlm: () => {},
    probeHindsight: async () => false,
  });
  await assert.rejects(
    () => service.updateConfig("hindsight:coding-agent", { llm: { model: "new-model" } }),
    (error) => error.details?.phase === "write" && error.details?.configState === "rolled_back",
  );
  assert.deepEqual(env, ["HINDSIGHT_API_LLM_MODEL=old-model\n"]);
});

test("hindsight config rollback failure reports unknown state", async () => {
  const envWrites = [];
  let saveFailed;
  const service = createCommandAppsService({
    configStore: { get: () => ({ apps: { hindsight: { executablePath: "/bin/hindsight-embed" } } }), save() { if (!saveFailed) { saveFailed = true; throw new Error("disk full"); } } },
    platform: "darwin",
    fileExists: () => true,
    inspectHindsight: async () => ({ status: "stopped", pid: null }),
    readHindsightEnvFile: () => "old=1\n",
    writeHindsightEnvFile: (_path, text) => envWrites.push(text),
    writeHindsightLlm: () => {},
    probeHindsight: async () => false,
  });
  await assert.rejects(
    () => service.updateConfig("hindsight:coding-agent", { llm: { model: "new-model" } }),
    (error) => error.details?.phase === "write" && error.details?.configState === "unknown",
  );
});
```

- [ ] **Step 2: Verify RED**

Expected failures: workflow does not provide injectable raw env rollback or `configState`.

- [ ] **Step 3: Implement rollback**

Use explicit `configState` transitions from Task 3. Build next env text by parsing previous text, applying the exact same key mapping as `writeHindsightLlmConfig`, then atomically replacing that file through `writeHindsightEnvFile`. For rollback:

```js
try {
  writeHindsightEnvFile(nextEnvPath, previousEnvText);
  saveConfig(previousConfig);
  configState = "rolled_back";
} catch {
  configState = "unknown";
}
```

If the first write itself fails before changing env, state is `rolled_back`. If env changed and rollback env write fails, state is `unknown`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/unit/command-apps.test.mjs`

Expected: rollback tests pass; only documented baseline failure remains.

- [ ] **Step 5: Commit**

```bash
git add lib/command-apps/application/service.mjs tests/unit/command-apps.test.mjs
git commit -m "fix(command-apps): rollback hindsight config apply failures"
```

### Task 5: Frontend apply feedback

**Files:**
- Modify: `desktop/src/modules/command-apps.ts:32`
- Modify: `desktop/src/modules/command-apps.ts:1030`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Extends `CommandAppStatus` with `configApply?: { restartRequired: boolean; restarted: boolean }`
- Extends API error parsing to expose safe `error.details`

- [ ] **Step 1: Write failing source assertions**

Add source assertions following the existing config-panel test style:

```js
test("command apps llm save reports restart apply state", () => {
  const source = fs.readFileSync("desktop/src/modules/command-apps.ts", "utf8");
  assert.match(source, /configApply\?\.restarted/);
  assert.match(source, /LLM 配置已保存并重启生效/);
  assert.match(source, /LLM 配置已保存，将在下次启动时生效/);
  assert.match(source, /error\.details\?\.configSaved/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/unit/config-panel.test.mjs`

Expected failure: source lacks the new copy and structured-error branch.

- [ ] **Step 3: Implement UI feedback**

After successful save:

```ts
if (status.configApply?.restarted) {
  showToast("LLM 配置已保存并重启生效", "success");
} else if (status.configApply && !status.configApply.restartRequired) {
  showToast("LLM 配置已保存，将在下次启动时生效", "info");
} else {
  showToast("LLM 配置已保存", "success");
}
```

In the existing action catch path used by `runAction`, preserve generic handling but make the API error object expose `details`; in `saveLlm`, catch before `runAction` if needed and show `配置已保存，但 Hindsight 重启失败：${message}` when `details.configSaved === true`, otherwise show the existing danger message. Never parse message text to choose the branch.

- [ ] **Step 4: Verify GREEN and build**

Run:

```bash
node --test tests/unit/config-panel.test.mjs
npm run build:panel
```

Expected: test passes and panel builds.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/command-apps.ts tests/unit/config-panel.test.mjs desktop/dist
git commit -m "feat(desktop): explain hindsight config restart state"
```

### Task 6: Full verification

**Files:**
- No new files.

**Interfaces:**
- Verifies Tasks 1-5 together.

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/unit/command-apps.test.mjs tests/unit/config-panel.test.mjs`

Expected: all pass except documented `command apps service opens the coding-agent control plane deep link` when local Hindsight is offline.

- [ ] **Step 2: Syntax and build**

Run: `npm run check && npm run build:panel`

Expected: both succeed.

- [ ] **Step 3: Inspect diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only intended files changed.

- [ ] **Step 4: Final commit**

If verification exposed fixes, commit them:

```bash
git add <exact-fixed-files>
git commit -m "test(command-apps): verify hindsight config restart"
```

Otherwise record that no additional commit is needed.
