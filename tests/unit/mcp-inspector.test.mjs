import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createInspectorManager } from "../../lib/mcp-management/infra/inspector-manager.mjs";
import { createMcpStore } from "../../lib/mcp-management/store.mjs";
import { createMcpManagementService } from "../../lib/mcp-management/application/service.mjs";
import { routeMcpManagementRequest } from "../../lib/mcp-management/http/routes.mjs";

test("InspectorManager - lifecycle start, status, list, and stop", async () => {
  let spawnedCmd = "";
  let spawnedArgs = [];
  let spawnedEnv = {};

  const fakeChild = new EventEmitter();
  fakeChild.pid = 12345;
  fakeChild.stdout = new EventEmitter();
  fakeChild.stderr = new EventEmitter();
  fakeChild.kill = (sig) => {
    fakeChild.emit("exit", 0, sig);
  };

  const mockSpawn = (cmd, args, opts) => {
    spawnedCmd = cmd;
    spawnedArgs = args;
    spawnedEnv = opts.env;
    // Simulate inspector ready output
    setTimeout(() => {
      fakeChild.stdout.emit("data", Buffer.from("MCP Inspector Web is up and running at:\n   http://localhost:5999\n"));
    }, 10);
    return fakeChild;
  };

  const manager = createInspectorManager({
    spawnImpl: mockSpawn,
    findPortImpl: async () => 5999,
  });

  const server = {
    name: "test-db",
    command: "node",
    args: ["./mcps/database-hub/index.mjs"],
    env: { DB_PORT: "3306" },
  };
  const secrets = {
    servers: {
      "test-db": {
        env: { DB_PASS: "secret123" },
      },
    },
  };

  const startRes = await manager.start("test-db", server, secrets);
  assert.equal(startRes.serverName, "test-db");
  assert.equal(startRes.running, true);
  assert.equal(startRes.port, 5999);
  assert.equal(startRes.url, "http://127.0.0.1:5999/");

  assert.ok(spawnedArgs.includes("@modelcontextprotocol/inspector"));
  assert.ok(spawnedArgs.includes("node"));
  assert.ok(spawnedArgs.includes("./mcps/database-hub/index.mjs"));
  assert.equal(spawnedEnv.DB_PORT, "3306");
  assert.equal(spawnedEnv.DB_PASS, "secret123");
  assert.equal(spawnedEnv.CLIENT_PORT, "5999");
  assert.equal(spawnedEnv.MCP_AUTO_OPEN_ENABLED, "false");
  assert.equal(spawnedEnv.DANGEROUSLY_OMIT_AUTH, "true");
  assert.equal(spawnedEnv.npm_config_allow_scripts, "");
  assert.equal(spawnedEnv.BROWSER, "none");

  const st = manager.status("test-db");
  assert.equal(st.running, true);
  assert.equal(st.port, 5999);

  const runningList = manager.listRunning();
  assert.equal(runningList.length, 1);
  assert.equal(runningList[0].serverName, "test-db");

  const stopRes = await manager.stop("test-db");
  assert.equal(stopRes.running, false);

  const stAfter = manager.status("test-db");
  assert.equal(stAfter.running, false);
});


test("Inspector Routes - start, status, stop, and state dispatch", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-mcp-routes-test-"));
  try {
    const store = createMcpStore({
      configPath: path.join(root, "mcp.config.json"),
      secretsPath: path.join(root, "mcp.secrets.json"),
    });
    fs.writeFileSync(store.configPath, JSON.stringify({
      version: 1,
      servers: {
        "demo-server": {
          name: "demo-server",
          transport: "stdio",
          command: "node",
          args: ["./index.mjs"],
          enabled: true,
        },
      },
      clientPaths: {},
    }));
    fs.writeFileSync(store.secretsPath, JSON.stringify({ servers: {} }));

    const fakeChild = new EventEmitter();
    fakeChild.pid = 99999;
    fakeChild.stdout = new EventEmitter();
    fakeChild.stderr = new EventEmitter();
    fakeChild.kill = (sig) => { fakeChild.emit("exit", 0, sig); };

    const mockSpawn = () => {
      setTimeout(() => fakeChild.stdout.emit("data", Buffer.from("MCP Inspector Web is up and running at:\n   http://127.0.0.1:6111\n")), 10);
      return fakeChild;
    };

    const inspectorManager = createInspectorManager({
      spawnImpl: mockSpawn,
      findPortImpl: async () => 6111,
    });

    const service = createMcpManagementService({
      store,
      home: root,
      inspectorManager,
    });

    function mockRes() {
      let code = 0;
      let headers = {};
      let body = "";
      return {
        writeHead(c, h) { code = c; headers = h; },
        end(data) { body += data || ""; },
        json() { return JSON.parse(body); },
        code: () => code,
      };
    }

    // 1. Status initially running = false
    const resStatus1 = mockRes();
    await routeMcpManagementRequest(
      { method: "GET" },
      resStatus1,
      {},
      "/v1/mcp-management/inspector/demo-server/status",
      { service }
    );
    assert.equal(resStatus1.code(), 200);
    assert.equal(resStatus1.json().running, false);

    // 2. Start inspector
    const resStart = mockRes();
    await routeMcpManagementRequest(
      { method: "POST" },
      resStart,
      {},
      "/v1/mcp-management/inspector/demo-server/start",
      { service }
    );
    assert.equal(resStart.code(), 200);
    assert.equal(resStart.json().running, true);
    assert.equal(resStart.json().port, 6111);

    // 3. Status now running = true
    const resStatus2 = mockRes();
    await routeMcpManagementRequest(
      { method: "GET" },
      resStatus2,
      {},
      "/v1/mcp-management/inspector/demo-server/status",
      { service }
    );
    assert.equal(resStatus2.code(), 200);
    assert.equal(resStatus2.json().running, true);

    // 4. state() includes runningInspectors
    const state = await service.state();
    assert.ok(state.runningInspectors.some((i) => i.serverName === "demo-server"));

    // 5. Stop inspector
    const resStop = mockRes();
    await routeMcpManagementRequest(
      { method: "POST" },
      resStop,
      {},
      "/v1/mcp-management/inspector/demo-server/stop",
      { service }
    );
    assert.equal(resStop.code(), 200);
    assert.equal(resStop.json().running, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("InspectorManager - timeout terminates and forgets the child", async () => {
  const killSignals = [];
  const fakeChild = new EventEmitter();
  fakeChild.pid = 4321;
  fakeChild.stdout = new EventEmitter();
  fakeChild.stderr = new EventEmitter();
  fakeChild.kill = (signal) => killSignals.push(signal);

  const manager = createInspectorManager({
    spawnImpl: () => {
      setTimeout(() => {
        fakeChild.stdout.emit("data", Buffer.from("stdout message\n"));
        fakeChild.stderr.emit("data", Buffer.from("stderr message\n"));
      }, 0);
      return fakeChild;
    },
    findPortImpl: async () => 6222,
    startupTimeoutMs: 20,
    pollIntervalMs: 10,
  });

  await assert.rejects(
    () => manager.start("slow-mcp", { command: "node", args: ["./slow.mjs"] }),
    (error) => {
      assert.match(error.message, /Inspector 启动超时/);
      assert.match(error.message, /stdout message/);
      assert.match(error.message, /stderr message/);
      return true;
    },
  );

  assert.deepEqual(killSignals, ["SIGTERM"]);
  assert.equal(manager.status("slow-mcp").running, false);
  assert.deepEqual(manager.listRunning(), []);
});

test("InspectorManager - uses Inspector's HTTP transport for MCP URLs ending in /mcp", async () => {
  let actualArgs = [];
  const fakeChild = new EventEmitter();
  fakeChild.pid = 4322;
  fakeChild.stdout = new EventEmitter();
  fakeChild.stderr = new EventEmitter();
  fakeChild.kill = () => {};

  const manager = createInspectorManager({
    spawnImpl: (cmd, args) => {
      actualArgs = args;
      fakeChild.stdout.emit("data", Buffer.from("MCP Inspector Web is up and running at:\n"));
      setTimeout(() => fakeChild.emit("exit", 0), 0);
      return fakeChild;
    },
    findPortImpl: async () => 6333,
  });

  await assert.rejects(
    () => manager.start("remote-mcp", { transport: "remote", url: "https://mcp.example.test/link/mcp" }),
    /Inspector 启动异常已退出/,
  );
  assert.ok(actualArgs.includes("http"));
  assert.ok(actualArgs.includes("https://mcp.example.test/link/mcp"));
});

test("Inspector start receives the selected server's interpolated URL", async () => {
  let startedServer = null;
  const fakeManager = {
    start: async (name, server) => {
      startedServer = server;
      return { serverName: name, running: true, port: 6444, url: "http://127.0.0.1:6444/" };
    },
    stop: async () => {},
    status: () => ({ running: false }),
    listRunning: () => [],
    getInstance: () => null,
  };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-inspector-url-test-"));
  const store = createMcpStore({
    configPath: path.join(root, "mcp.config.json"),
    secretsPath: path.join(root, "mcp.secrets.json"),
  });
  const configText = JSON.stringify({
    version: 1,
    servers: {
      "secret-remote": {
        name: "secret-remote",
        enabled: true,
        transport: "remote",
        url: "https://mcp.example.test/link/" + "${token}/mcp",
      },
    },
    clientPaths: {},
  });
  fs.writeFileSync(store.configPath, configText);
  fs.writeFileSync(store.secretsPath, JSON.stringify({
    variables: { token: "secret-token" },
    servers: {},
  }));
  const service = createMcpManagementService({
    store,
    home: "/tmp",
    inspectorManager: fakeManager,
  });

  await service.startInspector("secret-remote");
  assert.equal(startedServer.url, "https://mcp.example.test/link/secret-token/mcp");
});
