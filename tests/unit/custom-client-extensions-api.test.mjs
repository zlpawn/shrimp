import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";

import { routeMcpManagementRequest } from "../../lib/mcp-management/http/routes.mjs";
import { createMcpManagementService } from "../../lib/mcp-management/application/service.mjs";
import { createMcpStore } from "../../lib/mcp-management/store.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

function mockReqRes({ method = "GET", body = null, customClientIds = [] } = {}) {
  const payload = body == null ? null : JSON.stringify(body);
  let dataCb = null;
  let endCb = null;
  let fired = false;
  const req = {
    method,
    customClientIds,
    on(event, cb) {
      if (event === "data") dataCb = cb;
      if (event === "end") endCb = cb;
      if (event === "error") return req;
      if (dataCb && endCb && !fired) {
        fired = true;
        queueMicrotask(() => {
          if (payload != null) dataCb(payload);
          endCb();
        });
      }
      return req;
    },
  };
  let status = 0;
  let responsePayload = null;
  const res = {
    writeHead(code) {
      status = code;
    },
    end(buf) {
      try {
        responsePayload = JSON.parse(String(buf || "{}"));
      } catch {
        responsePayload = String(buf || "");
      }
    },
  };
  return {
    req,
    res,
    get result() {
      return { status, payload: responsePayload };
    },
  };
}

test("MCP Management HTTP route layer passes customClientIds to state and preview/apply", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-route-test-"));
  try {
    const configPath = path.join(tempDir, "mcp.config.json");
    const secretsPath = path.join(tempDir, "mcp.secrets.json");
    const store = createMcpStore({ configPath, secretsPath });
    const service = createMcpManagementService({
      store,
      homeDir: tempDir,
    });

    const customClientIds = ["work-buddy", "cursor"];

    // 1. GET /v1/mcp-management/state with customClientIds option
    const stateHttp = mockReqRes({ method: "GET" });
    await routeMcpManagementRequest(
      stateHttp.req,
      stateHttp.res,
      {},
      "/v1/mcp-management/state",
      { service, customClientIds },
    );

    assert.equal(stateHttp.result.status, 200);
    const statePayload = stateHttp.result.payload;
    const wbMeta = statePayload.clientsMeta.find((m) => m.id === "work-buddy");
    const cursorMeta = statePayload.clientsMeta.find((m) => m.id === "cursor");
    assert.ok(wbMeta, "work-buddy client card should exist in state");
    assert.ok(cursorMeta, "cursor client card should exist in state");
    assert.equal(wbMeta.custom, true);
    assert.equal(wbMeta.path, path.join(tempDir, ".workbuddy", "mcp.json"));
    assert.equal(statePayload.paths["work-buddy"], path.join(tempDir, ".workbuddy", "mcp.json"));

    // 2. PUT /v1/mcp-management/client-path for custom client
    const customConfigPath = path.join(tempDir, "custom-wb-mcp.json");
    const pathHttp = mockReqRes({
      method: "PUT",
      body: { client: "work-buddy", path: customConfigPath },
    });
    await routeMcpManagementRequest(
      pathHttp.req,
      pathHttp.res,
      {},
      "/v1/mcp-management/client-path",
      { service, customClientIds },
    );

    assert.equal(pathHttp.result.status, 200);
    assert.equal(pathHttp.result.payload.paths["work-buddy"], customConfigPath);

    // 3. POST /v1/mcp-management/apply with custom client distribution
    store.saveConfig({
      version: 1,
      servers: {
        "test-tool": {
          name: "test-tool",
          transport: "stdio",
          command: "node",
          args: ["tool.js"],
          env: {},
          distribution: { codex: false, claude: false, claude_code: false, antigravity: false, "work-buddy": true },
        },
      },
      clientPaths: { "work-buddy": customConfigPath },
    });

    const applyHttp = mockReqRes({
      method: "POST",
      body: { serverName: "test-tool" },
    });
    await routeMcpManagementRequest(
      applyHttp.req,
      applyHttp.res,
      {},
      "/v1/mcp-management/apply",
      { service, customClientIds },
    );

    assert.equal(applyHttp.result.status, 200);
    assert.ok(fs.existsSync(customConfigPath), "custom client config file should be created");
    const written = JSON.parse(fs.readFileSync(customConfigPath, "utf8"));
    assert.ok(written.mcpServers["test-tool"]);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Live Gateway Server: Custom Client Dynamic Injection for Skills and MCP HTTP Endpoints", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gateway-custom-client-e2e-"));
  const tempHome = path.join(tempDir, "home");
  fs.mkdirSync(tempHome, { recursive: true });

  const gatewayConfigFile = path.join(tempDir, "gateway.config.json");
  const gatewaySecretsFile = path.join(tempDir, "gateway.secrets.json");
  const skillsConfigFile = path.join(tempDir, "skills.config.json");
  const mcpConfigFile = path.join(tempDir, "mcp.config.json");
  const mcpSecretsFile = path.join(tempDir, "mcp.secrets.json");

  // Create mock custom client directories and skills
  const wbSkillDir = path.join(tempHome, ".workbuddy", "skills");
  const centralSkillDir = path.join(tempHome, ".agents", "skills");
  fs.mkdirSync(wbSkillDir, { recursive: true });
  fs.mkdirSync(centralSkillDir, { recursive: true });

  // Add a sample skill in central agents
  const sampleSkillDir = path.join(centralSkillDir, "sample-buddy-skill");
  fs.mkdirSync(sampleSkillDir, { recursive: true });
  fs.writeFileSync(
    path.join(sampleSkillDir, "SKILL.md"),
    `---
name: sample-buddy-skill
description: A sample skill for testing work-buddy client
---
# Sample Buddy Skill
`,
    "utf8",
  );

  const gatewayPort = 8794;
  const initialGatewayConfig = {
    server: { host: "127.0.0.1", port: gatewayPort },
    clients: {
      code: { endpoints: [] },
      desktop: { endpoints: [] },
      codex: { endpoints: [] },
      deeptutor: { endpoints: [] },
      "work-buddy": {
        name: "work-buddy",
        display_name: "WorkBuddy Agent",
        protocol: "openai-chat",
        endpoints: [],
      },
    },
    sessionSync: {
      enabled: true,
      targets: {
        antigravity: false,
        claude: false,
        codex: false,
      },
    },
  };

  fs.writeFileSync(gatewayConfigFile, JSON.stringify(initialGatewayConfig, null, 2));
  fs.writeFileSync(gatewaySecretsFile, JSON.stringify({}, null, 2));
  fs.writeFileSync(skillsConfigFile, JSON.stringify({ version: 1, clientPaths: {} }, null, 2));
  fs.writeFileSync(mcpConfigFile, JSON.stringify({ version: 1, servers: {}, clientPaths: {} }, null, 2));
  fs.writeFileSync(mcpSecretsFile, JSON.stringify({ version: 1, secrets: {} }, null, 2));

  // Spawn gateway child process
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      GATEWAY_HOST: "127.0.0.1",
      GATEWAY_PORT: String(gatewayPort),
      HOME: tempHome,
      USERPROFILE: tempHome,
      GATEWAY_CONFIG_FILE: gatewayConfigFile,
      GATEWAY_SECRETS_FILE: gatewaySecretsFile,
      SKILLS_CONFIG_FILE: skillsConfigFile,
      MCP_CONFIG_FILE: mcpConfigFile,
      MCP_SECRETS_FILE: mcpSecretsFile,
      GATEWAY_NO_OPEN: "1",
      CLAUDE_3P_SYNC_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  t.after(async () => {
    if (child.exitCode == null && child.signalCode == null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  // Wait for gateway health
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(`Gateway exited early with code ${child.exitCode}`);
    }
    try {
      const healthRes = await fetch(`http://127.0.0.1:${gatewayPort}/health`);
      if (healthRes.ok) break;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const baseUrl = `http://127.0.0.1:${gatewayPort}`;

  // 1. Test GET /v1/skills/library includes "work-buddy" in client presence tracking
  const libRes = await fetch(`${baseUrl}/v1/skills/library`);
  assert.equal(libRes.status, 200);
  const libData = await libRes.json();
  assert.equal(libData.success, true);
  const sampleSkill = libData.skills.find((s) => s.name === "sample-buddy-skill");
  assert.ok(sampleSkill, "sample-buddy-skill should be found in library");
  assert.ok("work-buddy" in sampleSkill.presentIn, "presentIn must track work-buddy client");
  assert.equal(sampleSkill.presentIn["work-buddy"], false, "work-buddy presence should initially be false");

  // 2. Test POST /v1/skills/link links skill to custom client "work-buddy"
  const linkRes = await fetch(`${baseUrl}/v1/skills/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skill: "sample-buddy-skill",
      client: "work-buddy",
      action: "link",
    }),
  });
  assert.equal(linkRes.status, 200);
  const linkData = await linkRes.json();
  assert.equal(linkData.success, true);
  assert.equal(linkData.linked, true);
  assert.equal(linkData.client, "work-buddy");

  // Verify file symlink exists on disk
  const targetLink = path.join(wbSkillDir, "sample-buddy-skill");
  assert.ok(fs.existsSync(targetLink), "symlink in work-buddy skill dir should exist");

  // Verify updated library reports presence true for work-buddy
  const updatedSkill = linkData.skillLibrary.skills.find((s) => s.name === "sample-buddy-skill");
  assert.equal(updatedSkill.presentIn["work-buddy"], true);

  // 3. Test PUT /v1/skills/client-path updates and persists custom skill directory
  const customWbSkillDir = path.join(tempDir, "custom-workbuddy-skills");
  const pathRes = await fetch(`${baseUrl}/v1/skills/client-path`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client: "work-buddy",
      path: customWbSkillDir,
    }),
  });
  assert.equal(pathRes.status, 200);
  const pathData = await pathRes.json();
  assert.equal(pathData.success, true);
  assert.equal(pathData.client, "work-buddy");
  assert.equal(pathData.path, customWbSkillDir);

  // Verify persisted in skills.config.json
  const savedSkillsConfig = JSON.parse(fs.readFileSync(skillsConfigFile, "utf8"));
  assert.equal(savedSkillsConfig.clientPaths["work-buddy"], customWbSkillDir);

  // 4. Test GET /v1/mcp-management/state returns client card and meta for "work-buddy"
  const mcpStateRes = await fetch(`${baseUrl}/v1/mcp-management/state`);
  assert.equal(mcpStateRes.status, 200);
  const mcpState = await mcpStateRes.json();
  const wbMcpMeta = mcpState.clientsMeta.find((m) => m.id === "work-buddy");
  assert.ok(wbMcpMeta, "work-buddy should be in clientsMeta");
  assert.equal(wbMcpMeta.custom, true);
  assert.ok("work-buddy" in mcpState.paths);

  // 5. Test PUT /v1/mcp-management/client-path updates clientPaths["work-buddy"]
  const customMcpPath = path.join(tempDir, "wb-mcp.json");
  const mcpPathRes = await fetch(`${baseUrl}/v1/mcp-management/client-path`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client: "work-buddy",
      path: customMcpPath,
    }),
  });
  assert.equal(mcpPathRes.status, 200);
  const mcpPathData = await mcpPathRes.json();
  assert.equal(mcpPathData.paths["work-buddy"], customMcpPath);

  // 6. Test POST /v1/skills/consolidate with custom client targets
  const consolidateRes = await fetch(`${baseUrl}/v1/skills/consolidate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targets: {
        claude: false,
        antigravity: false,
        claudeDesktop3p: false,
        "work-buddy": false, // Unlink work-buddy
      },
    }),
  });
  assert.equal(consolidateRes.status, 200);
  const consolidateData = await consolidateRes.json();
  assert.equal(consolidateData.success, true);

  // 7. Test POST /v1/skills/link with action: "unlink"
  const unlinkRes = await fetch(`${baseUrl}/v1/skills/link`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skill: "sample-buddy-skill",
      client: "work-buddy",
      action: "unlink",
    }),
  });
  assert.equal(unlinkRes.status, 200);
  const unlinkData = await unlinkRes.json();
  assert.equal(unlinkData.success, true);
  assert.equal(unlinkData.linked, false);

  // 8. Test PUT /v1/skills/client-path input validation
  const badPathRes = await fetch(`${baseUrl}/v1/skills/client-path`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "/some/path" }),
  });
  assert.equal(badPathRes.status, 400);

  // 9. Test GET /v1/mcp-management/scan includes work-buddy path and client discovery
  const scanRes = await fetch(`${baseUrl}/v1/mcp-management/scan`);
  assert.equal(scanRes.status, 200);
  const scanData = await scanRes.json();
  assert.ok("work-buddy" in scanData.paths);
  assert.ok(scanData.clients.some((c) => c.client === "work-buddy"));
});
