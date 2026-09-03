import assert from "node:assert/strict";
import test from "node:test";

const integration = await import("../../lib/codexhost-integration/index.mjs").catch(() => null);

test("codexhost integration module is available", () => {
  assert.ok(integration, "expected lib/codexhost-integration/index.mjs to exist");
});

const skipUntilModuleExists = integration ? false : "codexhost integration is not implemented yet";

function validDescriptor(overrides = {}) {
  return {
    schema_version: 1,
    launcher_pid: 4242,
    control_port: 43124,
    nonce: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

function validConfig(port = 8788) {
  return [
    'model_provider = "custom"',
    'model_catalog_json = "C:/isolated/gateway-model-catalog.json"',
    `openai_base_url = "http://127.0.0.1:${port}/codex/v1"`,
    "",
    "[model_providers.custom]",
    'name = "Local AI Gateway"',
    `base_url = "http://127.0.0.1:${port}/codex/v1"`,
    'wire_api = "responses"',
  ].join("\n");
}

function createFixture(overrides = {}) {
  const executable = {
    executablePath: "C:\\Users\\tester\\AppData\\Roaming\\npm\\codexhost.cmd",
    entrypointPath: "C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\@codexhost\\cli\\bin\\codexhost.js",
    launcherPath: "C:\\Users\\tester\\AppData\\Roaming\\npm\\node_modules\\@codexhost\\cli-win32-x64\\bin\\codexhost.exe",
    version: "0.4.2",
  };
  const calls = { spawn: [], terminate: [], openOfficial: [] };
  let descriptor = overrides.descriptor === undefined ? null : overrides.descriptor;
  const service = integration?.createCodexhostService({
    platform: "win32",
    gatewayPort: 8788,
    discoverExecutable: async () => overrides.executable === undefined ? executable : overrides.executable,
    inspectInstallation: async () => overrides.installation || {
      desktopExecutable: "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\ChatGPT.exe",
      desktopProcessIds: overrides.desktopProcessIds || [],
    },
    readRuntimeDescriptor: async () => descriptor,
    probeRuntimeControl: async () => overrides.controlReady ?? Boolean(descriptor),
    probeGateway: async () => overrides.gatewayHealth === undefined ? {
      ok: true,
      service: "shrimp",
      process_id: 100,
      instance_id: "gateway-test-8788",
      models: ["test-model"],
    } : overrides.gatewayHealth,
    readCodexConfig: async () => ({
      path: "C:\\isolated\\.codex\\config.toml",
      text: overrides.configText === undefined ? validConfig() : overrides.configText,
    }),
    processExecutablePath: async (pid) => overrides.processExecutablePath || (pid === 4242 ? executable.launcherPath : ""),
    isProcessAlive: async () => overrides.processAlive ?? true,
    spawnProcess(command, args, options) {
      calls.spawn.push({ command, args, options });
      return { pid: 5252, unref() {} };
    },
    terminateProcess: async (pid) => { calls.terminate.push(pid); descriptor = null; },
    now: () => new Date("2026-09-03T08:00:00.000Z"),
    ...overrides.dependencies,
  });
  return { service, calls, executable };
}

test("status reports codexhost as an unavailable managed runtime when it is not installed", { skip: skipUntilModuleExists }, async () => {
  const { service } = createFixture({ executable: null });

  const status = await service.getStatus();

  assert.equal(status.runtime.id, "codexhost");
  assert.equal(status.runtime.kind, "managedRuntime");
  assert.equal(status.runtime.installed, false);
  assert.equal(status.process.status, "stopped");
  assert.equal(status.actions.canStart, false);
});

test("config guard accepts the existing gateway-backed Codex model selection without changing it", { skip: skipUntilModuleExists }, () => {
  const text = validConfig();

  const result = integration.inspectCodexConfig(text, {
    configPath: "C:\\isolated\\.codex\\config.toml",
    gatewayPort: 8788,
  });

  assert.equal(result.healthy, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.modelProvider, "custom");
  assert.equal(result.modelCatalogJson, "C:/isolated/gateway-model-catalog.json");
  assert.equal(result.openaiBaseUrl, "http://127.0.0.1:8788/codex/v1");
  assert.equal(text, validConfig(), "inspection must not mutate the source configuration");
});

test("config guard checks only the target port without treating default HTTPS as a gateway", { skip: skipUntilModuleExists }, () => {
  const text = validConfig(443).replace(/http:\/\/127\.0\.0\.1:443/g, "https://127.0.0.1");

  const result = integration.inspectCodexConfig(text, { gatewayPort: 8788 });

  assert.equal(result.healthy, false);
  assert.ok(result.issues.some((issue) => issue.code === "gateway_url_mismatch"));
  assert.ok(result.issues.some((issue) => issue.code === "provider_url_mismatch"));
});

test("start refuses to launch codexhost while the Shrimp gateway is offline", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createFixture({ gatewayHealth: null });

  await assert.rejects(
    () => service.start(),
    (error) => error?.code === "gateway_offline" && /8788/.test(error.message),
  );
  assert.deepEqual(calls.spawn, []);
});

test("start reports a conflict instead of taking over an already running official Codex Desktop", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createFixture({ desktopProcessIds: [7001], descriptor: null, controlReady: false });

  const status = await service.getStatus();
  assert.equal(status.process.status, "conflict");
  assert.deepEqual(status.process.desktopPids, [7001]);
  assert.equal(status.actions.canStart, false);
  await assert.rejects(() => service.start(), (error) => error?.code === "desktop_conflict");
  assert.deepEqual(calls.spawn, []);
});

test("start uses only the discovered npm entrypoint and does not accept request arguments", { skip: skipUntilModuleExists }, async () => {
  const { service, calls, executable } = createFixture();

  const status = await service.start({ args: ["--custom-install", "C:\\Untrusted"] });

  assert.equal(status.process.status, "launching");
  assert.equal(calls.spawn.length, 1);
  assert.equal(calls.spawn[0].command, process.execPath);
  assert.deepEqual(calls.spawn[0].args, [executable.entrypointPath]);
  assert.equal(calls.spawn[0].options.detached, true);
  assert.equal(calls.spawn[0].options.windowsHide, true);
  assert.equal(calls.spawn[0].options.stdio, "ignore");
});

test("stop requires explicit interruption confirmation before terminating a managed Desktop", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createFixture({ descriptor: validDescriptor() });

  await assert.rejects(
    () => service.stop({ confirmInterrupt: false }),
    (error) => error?.code === "confirmation_required" && /未完成任务/.test(error.message),
  );
  assert.deepEqual(calls.terminate, []);
});

test("stop refuses a descriptor whose launcher PID belongs to another executable", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createFixture({
    descriptor: validDescriptor(),
    processExecutablePath: "C:\\Malware\\codexhost.exe",
  });

  await assert.rejects(
    () => service.stop({ confirmInterrupt: true }),
    (error) => error?.code === "runtime_owner_mismatch",
  );
  assert.deepEqual(calls.terminate, []);
});

test("stop terminates only the launcher verified by the runtime descriptor and installed package", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createFixture({ descriptor: validDescriptor() });

  const status = await service.stop({ confirmInterrupt: true });

  assert.deepEqual(calls.terminate, [4242]);
  assert.equal(status.process.status, "stopped");
});

test("open official waits for the verified launcher and descriptor cleanup before launching normal mode", { skip: skipUntilModuleExists }, async () => {
  const { service, calls, executable } = createFixture({
    descriptor: validDescriptor(),
    dependencies: {
      inspectInstallation: async () => ({
        desktopExecutable: "C:\\Program Files\\Codex\\app\\ChatGPT.exe",
        desktopLauncher: "C:\\Program Files\\Codex\\codex.exe",
        desktopProcessIds: [],
      }),
      readRuntimeDescriptor: async () => { throw new Error("temporary descriptor race"); },
    },
  });

  await assert.rejects(
    () => service.openOfficial({ confirmInterrupt: true }),
    (error) => error?.code === "runtime_state_unavailable",
  );
  assert.deepEqual(calls.terminate, []);
  assert.deepEqual(calls.spawn, []);
  assert.equal(executable.entrypointPath.length > 0, true);
});

test("codexhost routes expose stable status, start, stop, and official Desktop actions", { skip: skipUntilModuleExists }, async () => {
  const calls = [];
  const service = {
    getStatus: async () => ({ process: { status: "stopped" } }),
    start: async (body) => { calls.push(["start", body]); return { process: { status: "launching" } }; },
    stop: async (body) => { calls.push(["stop", body]); return { process: { status: "stopped" } }; },
    openOfficial: async (body) => { calls.push(["open-official", body]); return { process: { status: "official" } }; },
  };
  const request = (method, url, body) => ({
    method,
    url,
    on(event, listener) {
      if (event === "data" && body) listener(Buffer.from(JSON.stringify(body)));
      if (event === "end") listener();
      return this;
    },
  });
  const responses = [];
  const response = () => ({
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { responses.push({ status: this.status, body: JSON.parse(body) }); },
  });

  await integration.routeCodexhostRequest(request("GET", "/v1/cli-tools/codexhost/status"), response(), "/v1/cli-tools/codexhost/status", { service });
  await integration.routeCodexhostRequest(request("POST", "/v1/cli-tools/codexhost/start", { args: ["ignored"] }), response(), "/v1/cli-tools/codexhost/start", { service });
  await integration.routeCodexhostRequest(request("POST", "/v1/cli-tools/codexhost/stop", { confirmInterrupt: true }), response(), "/v1/cli-tools/codexhost/stop", { service });
  await integration.routeCodexhostRequest(request("POST", "/v1/cli-tools/codexhost/open-official", { confirmInterrupt: true }), response(), "/v1/cli-tools/codexhost/open-official", { service });

  assert.deepEqual(responses.map((item) => item.status), [200, 200, 200, 200]);
  assert.deepEqual(calls, [
    ["start", { args: ["ignored"] }],
    ["stop", { confirmInterrupt: true }],
    ["open-official", { confirmInterrupt: true }],
  ]);
});
