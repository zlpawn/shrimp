import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createInspectorManager } from "../../lib/mcp-management/infra/inspector-manager.mjs";
import { createInspectorProxy } from "../../lib/mcp-management/infra/inspector-proxy.mjs";
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
      fakeChild.stdout.emit("data", Buffer.from("MCP Inspector is running on http://localhost:5999\n"));
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
  assert.equal(startRes.url, "/v1/mcp-management/inspector-proxy/test-db/");

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

test("InspectorProxy - returns 404 page when instance is not running", async () => {
  const manager = createInspectorManager();
  const proxy = createInspectorProxy({ inspectorManager: manager });

  let statusCode = 0;
  let headers = {};
  let body = "";

  const req = { method: "GET", url: "/v1/mcp-management/inspector-proxy/not-running/" };
  const res = {
    writeHead(code, h) {
      statusCode = code;
      headers = h;
    },
    end(data) {
      body += data || "";
    },
  };

  await proxy.handle(req, res, "not-running", "/");
  assert.equal(statusCode, 404);
  assert.ok(body.includes("MCP Inspector 未启动"));
  assert.ok(body.includes("not-running"));
});

test("InspectorProxy - proxies HTML and injects base href and path rewrites", async () => {
  // Create a mock upstream HTTP server
  const upstreamServer = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!DOCTYPE html><html><head><title>Inspector</title></head><body><script src="/assets/main.js"></script><a href="/sse">SSE</a></body></html>`);
    } else if (req.url === "/assets/main.js") {
      res.writeHead(200, { "Content-Type": "application/javascript" });
      res.end('console.log("inspector js");');
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
  const upstreamPort = upstreamServer.address().port;

  try {
    const fakeManager = {
      getInstance(name) {
        if (name === "my-mcp") return { port: upstreamPort, serverName: "my-mcp" };
        return null;
      },
    };

    const proxy = createInspectorProxy({ inspectorManager: fakeManager });

    // Test HTML request
    let statusCode = 0;
    let headers = {};
    let body = "";

    const req = { method: "GET", url: "/v1/mcp-management/inspector-proxy/my-mcp/", headers: {} };
    const res = {
      writeHead(code, h) {
        statusCode = code;
        headers = h;
      },
      end(data) {
        body += data || "";
      },
    };

    await proxy.handle(req, res, "my-mcp", "/");
    assert.equal(statusCode, 200);
    assert.ok(body.includes('<base href="/v1/mcp-management/inspector-proxy/my-mcp/">'));
    assert.ok(body.includes('src="/v1/mcp-management/inspector-proxy/my-mcp/assets/main.js"'));

    // Test asset request
    let assetCode = 0;
    let assetBody = "";
    const assetReq = { method: "GET", url: "/v1/mcp-management/inspector-proxy/my-mcp/assets/main.js", headers: {} };
    const assetRes = new EventEmitter();
    assetRes.writeHead = (code) => { assetCode = code; };
    assetRes.write = (chunk) => { assetBody += chunk; return true; };
    assetRes.end = (chunk) => { if (chunk) assetBody += chunk; };

    await proxy.handle(assetReq, assetRes, "my-mcp", "/assets/main.js");
    assert.equal(assetCode, 200);
    assert.ok(assetBody.includes('console.log("inspector js");'));
  } finally {
    await new Promise((resolve) => upstreamServer.close(resolve));
  }
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
      setTimeout(() => fakeChild.stdout.emit("data", Buffer.from("running on http://127.0.0.1:6111\n")), 10);
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
