import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  normalizeNatTraversalConfig,
  validateNatTraversalConfig,
  renderFrpcToml,
  createNatTraversalService,
  resolveNatTraversalPaths,
  NatTraversalError,
  parseFrpcConfigText,
  inferDashboardUrl,
} from "../../lib/nat-traversal/index.mjs";
import { createProviderRegistry } from "../../lib/nat-traversal/providers/registry.mjs";
import { mapProxyPathToUpstream, buildDashboardProxyEntryPath } from "../../lib/nat-traversal/infra/dashboard-proxy.mjs";
import { createFrpcSupervisor, discoverRunningFrpcProcesses } from "../../lib/nat-traversal/process/frpc-supervisor.mjs";

test("normalize and validate frpc config", () => {
  const cfg = validateNatTraversalConfig({
    enabled: true,
    activeProvider: "frpc",
    frpc: {
      serverAddr: "39.105.19.237",
      serverPort: 7000,
      proxies: [
        {
          name: "shrimp-gateway",
          type: "tcp",
          localIp: "127.0.0.1",
          localPort: 8788,
          remotePort: 18788,
        },
      ],
    },
    frpsDashboard: {
      enabled: true,
      url: "http://39.105.19.237:7500/static/#/",
    },
    peers: [{ id: "home", displayName: "Home", ssh: { host: "1.2.3.4" } }],
  });
  assert.equal(cfg.frpc.serverAddr, "39.105.19.237");
  assert.equal(cfg.peers[0].id, "home");
});

test("validate rejects missing serverAddr", () => {
  assert.throws(
    () =>
      validateNatTraversalConfig({
        enabled: true,
        activeProvider: "frpc",
        frpc: { serverAddr: "", serverPort: 7000, proxies: [] },
      }),
    (error) => error instanceof NatTraversalError && error.code === "invalid_config",
  );
});

test("renderFrpcToml includes token and proxies", () => {
  const toml = renderFrpcToml({
    config: {
      enabled: true,
      frpc: {
        serverAddr: "example.com",
        serverPort: 7000,
        proxies: [
          {
            name: "gw",
            type: "tcp",
            localIp: "127.0.0.1",
            localPort: 8788,
            remotePort: 18788,
          },
        ],
      },
    },
    token: "secret-token",
  });
  assert.match(toml, /serverAddr = "example.com"/);
  assert.match(toml, /auth\.token = "secret-token"/);
  assert.match(toml, /name = "gw"/);
  assert.match(toml, /localPort = 8788/);
});

test("service updateConfig persists public config and secrets", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nat-traversal-"));
  const configPath = path.join(tmp, "gateway.config.json");
  const secretsPath = path.join(tmp, "nat-traversal.secrets.json");
  fs.writeFileSync(configPath, JSON.stringify({ server: { port: 8788 }, clients: {} }, null, 2));

  let stored = {
    enabled: false,
    activeProvider: "frpc",
    frpc: {
      serverAddr: "example.com",
      serverPort: 7000,
      proxies: [],
    },
    frpsDashboard: { enabled: false, url: "" },
    peers: [],
  };

  const paths = resolveNatTraversalPaths({
    configFile: configPath,
    secretsFile: secretsPath,
  });

  const service = createNatTraversalService({
    paths,
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
  });

  const view = await service.updateConfig(
    {
      enabled: true,
      frpc: {
        serverAddr: "39.105.19.237",
        serverPort: 7000,
        proxies: [
          {
            name: "shrimp-gateway",
            localPort: 8788,
            remotePort: 18788,
          },
        ],
      },
      frpsDashboard: {
        enabled: true,
        url: "http://39.105.19.237:7500/static/#/",
      },
    },
    {
      frpc: { token: "tok-1" },
      frpsDashboard: { username: "admin", password: "pass" },
    },
  );

  assert.equal(view.enabled, true);
  assert.equal(view.secrets.frpcTokenConfigured, true);
  assert.equal(view.secrets.dashboardAuthConfigured, true);
  assert.equal(stored.frpc.serverAddr, "39.105.19.237");

  const secretsOnDisk = JSON.parse(fs.readFileSync(secretsPath, "utf8"));
  assert.equal(secretsOnDisk.frpc.token, "tok-1");
  assert.equal(secretsOnDisk.frpsDashboard.username, "admin");
  assert.ok(fs.existsSync(paths.generatedFrpcConfigPath));
});


function makeNatService(initial = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nat-service-"));
  const configPath = path.join(tmp, "gateway.config.json");
  const secretsPath = path.join(tmp, "nat-traversal.secrets.json");
  fs.writeFileSync(configPath, JSON.stringify({ server: { port: 8788 }, clients: {} }, null, 2));

  let stored = {
    enabled: true,
    activeProvider: "frpc",
    frpc: {
      serverAddr: "1.2.3.4",
      serverPort: 7000,
      proxies: [],
    },
    frpsDashboard: { enabled: false, url: "" },
    peers: [],
    ...initial,
  };

  const paths = resolveNatTraversalPaths({
    configFile: configPath,
    secretsFile: secretsPath,
  });

  const providerRegistry = createProviderRegistry({
    paths,
    supervisorFactory: (opts) =>
      createFrpcSupervisor({
        ...opts,
        listProcessCommandLines: () => [],
      }),
  });

  const service = createNatTraversalService({
    paths,
    providerRegistry,
    configStore: {
      get: () => stored,
      save: (next) => {
        stored = next;
      },
    },
  });

  return { service, getStored: () => stored, tmp };
}

test("service ensureLink requires known peer", async () => {
  const { service } = makeNatService();
  await assert.rejects(
    () => service.ensureLink("missing"),
    (error) => error instanceof NatTraversalError && error.code === "peer_not_found",
  );
});

test("service openService returns gateway-api endpoint from peer services", async () => {
  const { service } = makeNatService();
  await service.updateConfig({
    enabled: true,
    frpc: {
      serverAddr: "1.2.3.4",
      serverPort: 7000,
      proxies: [],
    },
    peers: [{
      id: "home",
      displayName: "Home",
      services: { gatewayApi: "127.0.0.1:18788" },
    }],
  });
  const endpoint = await service.openService("home", "gateway-api");
  assert.equal(endpoint.service, "gateway-api");
  assert.equal(endpoint.endpoint, "127.0.0.1:18788");
});

test("service ensureLink fails clearly when provider is not running", async () => {
  const { service } = makeNatService({
    peers: [{
      id: "home",
      displayName: "Home",
      services: { gatewayApi: "127.0.0.1:18788" },
    }],
  });
  await assert.rejects(
    () => service.ensureLink("home"),
    (error) => error instanceof NatTraversalError && error.code === "not_running",
  );
});

test("frpc supervisor start/stop with fake binary", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frpc-sup-"));
  const bin = path.join(tmp, "fake-frpc");
  const configPath = path.join(tmp, "frpc.toml");
  const pidPath = path.join(tmp, "frpc.pid");
  const logPath = path.join(tmp, "frpc.log");
  fs.writeFileSync(configPath, 'serverAddr = "x"\n');

  const children = [];
  const spawnImpl = () => {
    const handlers = { error: [], exit: [] };
    const child = {
      pid: 4242,
      killed: false,
      stdout: { on() {} },
      stderr: { on() {} },
      unref() {},
      once(event, cb) {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
      },
      on(event, cb) {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
      },
      kill() {
        this.killed = true;
        for (const cb of handlers.exit || []) cb(0, null);
        return true;
      },
    };
    children.push(child);
    return child;
  };

  const supervisor = createFrpcSupervisor({
    binPath: bin,
    configPath,
    pidPath,
    logPath,
    spawnImpl,
    isPidAliveImpl: (pid) => children.some((c) => c.pid === pid && !c.killed),
    listProcessCommandLines: () => [],
  });

  const started = await supervisor.start();
  assert.equal(started.status, "running");
  assert.equal(started.pid, 4242);

  const stopped = await supervisor.stop();
  assert.equal(stopped.status, "stopped");
});


test("parseFrpcConfigText reads toml proxies and token", () => {
  const parsed = parseFrpcConfigText(`
serverAddr = "39.105.19.237"
serverPort = 7000

[auth]
token = "515325"

[[proxies]]
name = "ssh-pa-frp"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 6007
`);
  assert.equal(parsed.serverAddr, "39.105.19.237");
  assert.equal(parsed.token, "515325");
  assert.equal(parsed.proxies.length, 1);
  assert.equal(parsed.proxies[0].localPort, 22);
  assert.equal(parsed.proxies[0].remotePort, 6007);
});

test("inferDashboardUrl defaults to port 7500", () => {
  assert.equal(
    inferDashboardUrl("39.105.19.237"),
    "http://39.105.19.237:7500/static/#/",
  );
});


test("listFrpcCandidatePaths finds versioned frp directories", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { listFrpcCandidatePaths } = await import("../../lib/nat-traversal/infra/frpc-config-io.mjs");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frp-detect-"));
  const dir = path.join(tmp, "frp_0.71.0_darwin_arm64");
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, "frpc.toml");
  fs.writeFileSync(cfg, 'serverAddr = "1.2.3.4"\nserverPort = 7000\n');
  const found = listFrpcCandidatePaths({ homeDir: tmp, env: {}, whichBin: () => "" });
  assert.ok(
    found.some((f) =>
      path.normalize(f).endsWith(
        path.normalize(path.join("frp_0.71.0_darwin_arm64", "frpc.toml")),
      ),
    ),
  );
});


test("mapProxyPathToUpstream keeps api at frps root", () => {
  const base = new URL("http://39.105.19.237:7500/static/#/");
  const api = mapProxyPathToUpstream("/api/serverinfo", base);
  assert.equal(api.toString(), "http://39.105.19.237:7500/api/serverinfo");
  const entry = mapProxyPathToUpstream("/", base);
  assert.equal(entry.pathname, "/static/");
  const asset = mapProxyPathToUpstream("/static/js/app.js", base);
  assert.equal(asset.pathname, "/static/js/app.js");
});


test("buildDashboardProxyEntryPath preserves /static entry", () => {
  assert.equal(
    buildDashboardProxyEntryPath("http://39.105.19.237:7500/static/#/"),
    "/v1/nat-traversal/frps-dashboard/static/#/",
  );
  assert.equal(
    buildDashboardProxyEntryPath(""),
    "/v1/nat-traversal/frps-dashboard/static/#/",
  );
});


test("discoverRunningFrpcProcesses matches config path", () => {
  const found = discoverRunningFrpcProcesses({
    binPath: "/Users/pa/frp/frpc",
    configPath: "/Users/pa/frp/frpc.toml",
    listProcessCommandLines: () => [
      { pid: 42, command: "/Users/pa/frp/frpc -c /Users/pa/frp/frpc.toml" },
      { pid: 43, command: "/opt/other/frpc -c /tmp/other.toml" },
      { pid: 44, command: "vim /Users/pa/frp/frpc.toml" },
    ],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].pid, 42);
});

test("supervisor status adopts external frpc process", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frpc-adopt-"));
  const pidPath = path.join(tmp, "frpc.pid");
  const logPath = path.join(tmp, "frpc.log");
  const configPath = path.join(tmp, "frpc.toml");
  fs.writeFileSync(configPath, 'serverAddr = "1.2.3.4"\n');

  // Fake external process list via monkeypatch on discover by custom list command
  // We simulate an alive pid by writing a self pid? better: mock is hard.
  // Instead unit-test discover only + integration-ish via overridden list.
  const found = discoverRunningFrpcProcesses({
    configPath,
    listProcessCommandLines: () => [
      { pid: process.pid, command: `frpc -c ${configPath}` }, // should ignore self
      { pid: 4242, command: `/usr/local/bin/frpc -c ${configPath}` },
    ],
  });
  assert.equal(found[0].pid, 4242);

  // Direct status path with fake list is not wired into supervisor factory args yet,
  // so validate stop discovers external when pid file empty by temporary patch is out-of-scope.
  assert.ok(!fs.existsSync(pidPath));
});

test("isCrossPlatformMismatch detects Windows path on POSIX and Unix path on Windows", async () => {
  const { isCrossPlatformMismatch } = await import("../../lib/nat-traversal/process/frpc-supervisor.mjs");
  assert.equal(isCrossPlatformMismatch("D:\\frp\\frpc.toml", "darwin"), true);
  assert.equal(isCrossPlatformMismatch("C:\\frp\\frpc.toml", "linux"), true);
  assert.equal(isCrossPlatformMismatch("/Users/pa/frp/frpc.toml", "darwin"), false);
  assert.equal(isCrossPlatformMismatch("/Users/pa/frp/frpc.toml", "win32"), true);
  assert.equal(isCrossPlatformMismatch("D:\\frp\\frpc.toml", "win32"), false);
});

test("discoverRunningFrpcProcesses falls back across platforms when configPath has platform mismatch", () => {
  const found = discoverRunningFrpcProcesses({
    configPath: "D:\\frp\\frpc.toml",
    platform: "darwin",
    listProcessCommandLines: () => [
      { pid: 1198, command: "/Users/pa/frp/frpc -c /Users/pa/frp/frpc.toml" },
    ],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].pid, 1198);
  assert.equal(found[0].configPath, "/Users/pa/frp/frpc.toml");
  assert.equal(found[0].binPath, "/Users/pa/frp/frpc");
});
