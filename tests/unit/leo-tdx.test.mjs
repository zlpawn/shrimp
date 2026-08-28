import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  candidateWorkBuddyRoots,
  extractWorkBuddyToken,
  readToken,
  resolveSecretPaths,
  saveToken,
} from "../../clis/leo-tdx/lib/token.mjs";
import { createMcpClient, McpError } from "../../clis/leo-tdx/lib/mcp.mjs";
import { runCli } from "../../clis/leo-tdx/lib/cli.mjs";
import { scanInRepoClis } from "../../lib/cli-core/discovery.mjs";
import { SkillInstaller } from "../../lib/session-sync/skill-installer.mjs";

const TOKEN = "TDX-1-test-token";

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "leo-tdx-"));
}

test("token file resolves and persists with restricted permissions", () => {
  const home = tempHome();
  try {
    saveToken(TOKEN, { homeDir: home, env: {} });
    const file = path.join(home, ".shrimp", "secrets", "tdx", "token");
    assert.equal(fs.readFileSync(file, "utf8"), TOKEN + "\n");
    if (process.platform !== "win32") {
      assert.equal(fs.statSync(path.dirname(path.dirname(file))).mode & 0o777, 0o700);
      assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700);
      assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    }
    assert.equal(readToken({ homeDir: home, env: {} }), TOKEN);
    assert.equal(readToken({ homeDir: home, env: { TDX_TOKEN: " " } }), TOKEN);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("work buddy roots support explicit override, POSIX home, and Windows app data", () => {
  const home = tempHome();
  const appData = path.join(home, "AppData", "Roaming");
  const localAppData = path.join(home, "AppData", "Local");
  try {
    const roots = candidateWorkBuddyRoots({
      homeDir: home,
      env: {
        WORKBUDDY_CONNECTORS_DIR: path.join(home, "custom-connectors"),
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
      },
    });
    assert.deepEqual(roots, [
      path.join(home, "custom-connectors"),
      path.join(home, ".workbuddy", "connectors"),
      path.join(appData, "WorkBuddy", "connectors"),
      path.join(localAppData, "WorkBuddy", "connectors"),
    ]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("extracts TDX token from WorkBuddy fixture on both path styles", () => {
  const home = tempHome();
  const root = path.join(home, "AppData", "Roaming", "WorkBuddy", "connectors");
  const userId = "user-001";
  const userDir = path.join(root, userId);
  fs.mkdirSync(userDir, { recursive: true });

  const master = crypto.randomBytes(32);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.hkdfSync("sha256", Buffer.concat([master, Buffer.from(userId)]), salt, "workbuddy-oauth-credentials-v1", 32);
  const aad = Buffer.from(`${userId}|connector-states:headerOverrides:tdx-connector|Authorization`);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update("Bearer " + TOKEN, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const state = {
    encryption: {
      salt: salt.toString("base64"),
      keyCheck: crypto.createHash("sha256").update(Buffer.concat([master, salt])).digest().subarray(0, 16).toString("base64"),
    },
    headerOverrides: {
      "tdx-connector": {
        Authorization: {
          iv: iv.toString("base64"),
          ct: ciphertext.subarray(0, ciphertext.length - 16).toString("base64"),
          tag: ciphertext.subarray(ciphertext.length - 16).toString("base64"),
        },
      },
    },
  };
  fs.writeFileSync(path.join(userDir, ".master.key"), master);
  fs.writeFileSync(path.join(userDir, "connector-states.v3.json"), JSON.stringify(state));

  try {
    const extracted = extractWorkBuddyToken({
      homeDir: home,
      env: { APPDATA: path.join(home, "AppData", "Roaming") },
    });
    assert.equal(extracted, TOKEN);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("MCP client initializes, captures session, notifies, calls tools, and parses SSE", async () => {
  const requests = [];
  const client = createMcpClient({
    token: TOKEN,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({ headers: init.headers, body });
      const response = {
        initialize: {
          jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "tdx-finance-mcp-server", version: "1.0.0" } },
        },
        "notifications/initialized": null,
        "tools/call": {
          jsonrpc: "2.0", id: body.id,
          result: { content: [{ type: "text", text: "{\"ok\":true}" }] },
        },
      };
      const payload = response[body.method];
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => name === "Mcp-Session-Id" ? "session-123" : null },
        text: async () => "event: message\ndata: " + JSON.stringify(payload) + "\n\n",
      };
    },
  });

  const result = await client.callTool("tdx_quotes", { code: "600519", setcode: "1" });
  assert.deepEqual(JSON.parse(result), { ok: true });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].headers.Authorization, "Bearer " + TOKEN);
  assert.equal(requests[1].headers["Mcp-Session-Id"], "session-123");
  assert.equal(requests[2].headers["Mcp-Session-Id"], "session-123");
  assert.equal(requests[2].body.params.name, "tdx_quotes");
});

test("CLI maps commands, markets, and outputs without exposing credentials", async () => {
  const calls = [];
  const transport = {
    callTool: async (name, args) => {
      calls.push([name, args]);
      return JSON.stringify({ tool: name, args });
    },
    listTools: async () => [{ name: "tdx_quotes", inputSchema: { type: "object" } }],
    initialize: async () => ({ serverInfo: { name: "tdx-finance-mcp-server", version: "1.0.0" } }),
  };
  const env = { TDX_TOKEN: TOKEN };

  const quote = JSON.parse(await runCli(["quotes", "600519", "--market", "SH"], { env, transport }));
  assert.deepEqual(calls.at(-1), ["tdx_quotes", { code: "600519", setcode: "1" }]);
  assert.equal(quote.ok, true);

  await runCli(["kline", "000001", "--market", "SZ", "--period", "day", "--count", "30"], { env, transport });
  assert.deepEqual(calls.at(-1), ["tdx_kline", { code: "000001", setcode: "0", period: "day", count: 30 }]);

  await runCli(["lookup", "茅台"], { env, transport });
  assert.deepEqual(calls.at(-1), ["tdx_lookup_stock", { query: "茅台" }]);

  const tools = JSON.parse(await runCli(["tools"], { env, transport }));
  assert.equal(tools.result.tools[0].name, "tdx_quotes");

  const text = await runCli(["quotes", "600519", "1", "--output", "text"], { env, transport });
  assert.equal(text, JSON.stringify({ tool: "tdx_quotes", args: { code: "600519", setcode: "1" } }));
});

test("whoami performs a real MCP handshake and raw output preserves JSON-RPC response", async () => {
  const transport = {
    initialize: async () => ({ serverInfo: { name: "tdx-finance-mcp-server", version: "1.0.0" } }),
    listTools: async () => [],
    callToolRaw: async () => transport.lastResponse,
    lastResponse: { jsonrpc: "2.0", id: 9, result: { content: [] } },
  };
  const whoami = JSON.parse(await runCli(["whoami"], { env: { TDX_TOKEN: TOKEN }, transport }));
  assert.equal(whoami.result.serverInfo.name, "tdx-finance-mcp-server");

  const raw = await runCli(["quotes", "600519", "1", "--output", "raw"], { env: { TDX_TOKEN: TOKEN }, transport });
  assert.deepEqual(JSON.parse(raw), transport.lastResponse);
});

test("token set only accepts hidden stdin input and output format is validated", async () => {
  const env = {};
  const saved = [];
  const tokenManager = {
    readToken,
    extractWorkBuddyToken,
    saveToken: (token, options) => {
      saved.push(token);
      return saveToken(token, options);
    },
    resolveSecretPaths,
  };

  await assert.rejects(
    runCli(["token", "set", TOKEN], { env, tokenManager }),
    /token set --stdin/i,
  );
  await runCli(["token", "set", "--stdin"], {
    env,
    tokenManager,
    readStdin: async () => TOKEN,
  });
  assert.deepEqual(saved, [TOKEN]);

  await assert.rejects(
    runCli(["tools", "--output", "yaml"], { env: { TDX_TOKEN: TOKEN }, transport: { listTools: async () => [] } }),
    /Unsupported output format/i,
  );
});

test("MCP errors classify authentication, server, and network failures", async () => {
  assert.equal(new McpError("HTTP 401", 401).exitCode, 3);
  assert.equal(new McpError("HTTP 500", 500).exitCode, 4);
  const networkError = new TypeError("fetch failed");
  assert.equal(McpError.from(networkError).exitCode, 5);
});

test("CLI wraps JSON argument errors as parameter errors", async () => {
  const transport = { callTool: async () => "", listTools: async () => [] };
  await assert.rejects(
    runCli(["call", "tdx_quotes", "{invalid"], { env: { TDX_TOKEN: TOKEN }, transport }),
    (error) => {
      assert.equal(error.exitCode, 2);
      assert.match(error.message, /Invalid JSON arguments/i);
      return true;
    },
  );
});


test("leo-tdx in-repo CLI and managed skill are discoverable", async () => {
  const cli = scanInRepoClis(process.cwd()).find((item) => item.name === "leo-tdx");
  assert.ok(cli);
  assert.equal(cli.args[0], "./clis/leo-tdx/index.mjs");

  const skill = SkillInstaller.getManagedSkill("leo-tdx-stock");
  assert.ok(skill);
  assert.ok(fs.existsSync(path.join(process.cwd(), "lib", "skills", "leo-tdx-stock", "SKILL.md")));
});
