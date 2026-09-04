import assert from "node:assert/strict";
import test from "node:test";

const integration = await import("../../lib/codexhost-integration/index.mjs").catch(() => null);
const discovery = await import("../../lib/codexhost-integration/discovery.mjs").catch(() => null);
const processManager = await import("../../lib/codexhost-integration/process-manager.mjs").catch(() => null);

test("codexhost integration module is available", () => {
  assert.ok(integration, "expected lib/codexhost-integration/index.mjs to exist");
});

const skipUntilModuleExists = integration ? false : "codexhost integration is not implemented yet";
const skipProcessManager = processManager ? false : "codexhost process manager is not implemented yet";
const skipDiscovery = discovery ? false : "codexhost discovery is not implemented yet";

test("discovery accepts the platform package nested under @codexhost/cli", { skip: skipDiscovery }, async () => {
  const files = new Set([
    "/global/node_modules/@codexhost/cli/bin/codexhost.js",
    "/global/node_modules/@codexhost/cli/node_modules/@codexhost/cli-darwin-arm64/bin/codexhost",
  ]);
  const result = await discovery.discoverCodexhostExecutable({
    platform: "darwin",
    arch: "arm64",
    environment: { PATH: "/bin" },
    fileExists: (value) => files.has(value),
    execFileImpl: async (command, args) => {
      if (args[0] === "root" && args[1] === "-g") return { stdout: "/global/node_modules" };
      assert.equal(command, process.execPath);
      assert.deepEqual(args.slice(0, 2), ["/global/node_modules/@codexhost/cli/bin/codexhost.js", "--version"]);
      return { stdout: "0.4.4\n" };
    },
  });

  assert.equal(result.version, "0.4.4");
  assert.equal(
    result.launcherPath,
    "/global/node_modules/@codexhost/cli/node_modules/@codexhost/cli-darwin-arm64/bin/codexhost",
  );
});

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
    probeConfigGateway: async (healthUrl) => {
      if (healthUrl === "http://127.0.0.1:8787/health") return overrides.externalGatewayHealth === undefined
        ? {
            ok: true,
            service: "shrimp",
            process_id: 200,
            instance_id: "gateway-main-8787",
            models: ["main-model"],
          }
        : overrides.externalGatewayHealth;
      return overrides.gatewayHealth === undefined
        ? { ok: true, service: "shrimp", process_id: 100, models: ["test-model"] }
        : overrides.gatewayHealth;
    },
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

function createDarwinFixture(overrides = {}) {
  const executable = {
    executablePath: "/opt/homebrew/bin/codexhost",
    entrypointPath: "/opt/homebrew/lib/node_modules/@codexhost/cli/bin/codexhost.js",
    launcherPath: "/opt/homebrew/lib/node_modules/@codexhost/cli-darwin-arm64/bin/codexhost",
    version: "0.4.2",
  };
  const calls = { spawn: [], terminate: [] };
  let descriptor = overrides.descriptor === undefined ? null : overrides.descriptor;
  const service = integration?.createCodexhostService({
    platform: "darwin",
    gatewayPort: 8788,
    discoverExecutable: async () => executable,
    inspectInstallation: async () => overrides.installation || {
      desktopExecutable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      desktopLauncher: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      desktopProcessIds: [],
    },
    readRuntimeDescriptor: async () => descriptor,
    probeRuntimeControl: async () => Boolean(descriptor),
    probeGateway: async () => ({
      ok: true,
      service: "shrimp",
      process_id: 100,
      instance_id: "gateway-darwin-8788",
      models: ["test-model"],
    }),
    readCodexConfig: async () => ({
      path: "/Users/tester/.codex/config.toml",
      text: [
        'model_provider = "custom"',
        'model_catalog_json = "/Users/tester/.codex/gateway-model-catalog.json"',
        'openai_base_url = "http://127.0.0.1:8788/codex/v1"',
        "",
        "[model_providers.custom]",
        'base_url = "http://127.0.0.1:8788/codex/v1"',
      ].join("\n"),
    }),
    processExecutablePath: async (pid) => overrides.processExecutablePath === undefined
      ? (pid === 4242 ? executable.launcherPath : "")
      : overrides.processExecutablePath,
    isProcessAlive: async () => true,
    spawnProcess(command, args, options) {
      calls.spawn.push({ command, args, options });
      return { pid: 5252, unref() {} };
    },
    terminateProcess: async (pid) => { calls.terminate.push(pid); descriptor = null; },
    now: () => new Date("2026-09-04T08:00:00.000Z"),
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

test("config guard accepts the existing gateway-backed Codex model selection without changing it", { skip: skipUntilModuleExists }, async () => {
  const text = validConfig();

  const result = await integration.inspectCodexConfig(text, {
    probeGateway: async () => ({ ok: true, service: "shrimp" }),
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

test("config guard checks only the target port without treating default HTTPS as a gateway", { skip: skipUntilModuleExists }, async () => {
  const text = validConfig(443).replace(/http:\/\/127\.0\.0\.1:443/g, "https://127.0.0.1");

  const result = await integration.inspectCodexConfig(text, { gatewayPort: 8788, probeGateway: async () => null });

  assert.equal(result.healthy, false);
  assert.ok(result.issues.some((issue) => issue.code === "gateway_url_mismatch"));
  assert.ok(result.issues.some((issue) => issue.code === "provider_url_mismatch"));
});

test("status allows a Codex model config backed by another healthy local Shrimp gateway", { skip: skipUntilModuleExists }, async () => {
  const { service } = createFixture({
    configText: validConfig(8787),
  });

  const status = await service.getStatus();

  assert.equal(status.codexConfig.healthy, true);
  assert.deepEqual(status.codexConfig.issues, []);
  assert.equal(status.codexConfig.dataPlane.gatewayPort, 8787);
  assert.equal(status.codexConfig.dataPlane.external, true);
  assert.equal(status.codexConfig.dataPlane.healthy, true);
  assert.equal(status.actions.canStart, true);
});

test("data plane follows the selected model provider when root and provider URLs differ", { skip: skipUntilModuleExists }, async () => {
  const text = [
    'model_provider = "custom"',
    'model_catalog_json = "C:/isolated/gateway-model-catalog.json"',
    'openai_base_url = "http://127.0.0.1:8788/codex/v1"',
    "",
    "[model_providers.custom]",
    'base_url = "http://127.0.0.1:8787/codex/v1"',
  ].join("\n");

  const result = await integration.inspectCodexConfig(text, {
    gatewayPort: 8788,
    probeGateway: async () => ({ ok: true, service: "shrimp" }),
  });

  assert.equal(result.healthy, true);
  assert.equal(result.dataPlane.gatewayPort, 8787);
  assert.equal(result.dataPlane.external, true);
});

test("start refuses an external model gateway that is offline or is not Shrimp", { skip: skipUntilModuleExists }, async () => {
  for (const externalGatewayHealth of [null, { ok: true, service: "other" }]) {
    const { service, calls } = createFixture({
      configText: validConfig(8787),
      externalGatewayHealth,
    });

    await assert.rejects(
      () => service.start(),
      (error) => error?.code === "codex_config_invalid"
        && error?.details?.issues?.some((issue) => issue.message.includes("http://127.0.0.1:8787/codex/v1")),
    );
    assert.deepEqual(calls.spawn, []);
  }
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

test("macOS resolves a PID executable through ps output", { skip: skipProcessManager }, async () => {
  const calls = [];
  const execFileImpl = async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: "/opt/homebrew/lib/node_modules/@codexhost/cli-darwin-arm64/bin/codexhost\n" };
  };

  const result = await processManager.processExecutablePath(4242, {
    platform: "darwin",
    execFileImpl,
  });

  assert.equal(result, "/opt/homebrew/lib/node_modules/@codexhost/cli-darwin-arm64/bin/codexhost");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "ps");
  assert.deepEqual(calls[0].args, ["-p", "4242", "-o", "comm="]);
});

test("macOS PID path probing treats a vanished process as unverified instead of throwing", { skip: skipProcessManager }, async () => {
  const result = await processManager.processExecutablePath(4242, {
    platform: "darwin",
    execFileImpl: async () => {
      const error = new Error("no such process");
      error.code = 1;
      throw error;
    },
  });

  assert.equal(result, "");
});

test("macOS termination waits for the launcher to exit after SIGTERM", { skip: skipProcessManager }, async () => {
  const originalKill = process.kill;
  const signals = [];
  const sleeps = [];
  const alive = [true, true, false];
  process.kill = (pid, signal) => { signals.push([pid, signal]); };
  try {
    await processManager.terminateProcess(4242, {
      platform: "darwin",
      isProcessAlive: async () => alive.length ? alive.shift() : false,
      sleep: async (ms) => { sleeps.push(ms); },
    });
  } finally {
    process.kill = originalKill;
  }

  assert.deepEqual(signals, [[4242, "SIGTERM"]]);
  assert.equal(sleeps.length, 2);
});

test("macOS termination reports a launcher that ignores SIGTERM", { skip: skipProcessManager }, async () => {
  await assert.rejects(
    () => processManager.terminateProcess(4242, {
      platform: "darwin",
      sendSignal: () => {},
      isProcessAlive: async () => true,
      sleep: async () => {},
      timeoutMs: 250,
    }),
    (error) => error?.code === "process_error" && /did not exit/.test(error.message),
  );
});

test("macOS stop verifies and terminates the installed launcher", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createDarwinFixture({ descriptor: validDescriptor() });

  const status = await service.stop({ confirmInterrupt: true });

  assert.deepEqual(calls.terminate, [4242]);
  assert.equal(status.process.status, "stopped");
});

test("macOS stop refuses a launcher PID owned by another executable", { skip: skipUntilModuleExists }, async () => {
  const { service, calls } = createDarwinFixture({
    descriptor: validDescriptor(),
    processExecutablePath: "/tmp/malware/codexhost",
  });

  await assert.rejects(
    () => service.stop({ confirmInterrupt: true }),
    (error) => error?.code === "runtime_owner_mismatch",
  );
  assert.deepEqual(calls.terminate, []);
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
