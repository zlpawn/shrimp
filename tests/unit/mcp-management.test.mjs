import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMcpStore } from "../../lib/mcp-management/store.mjs";
import { createMcpManagementService } from "../../lib/mcp-management/application/service.mjs";
import { codexAdapter } from "../../lib/mcp-management/clients/codex.mjs";
import { createJsonClientAdapter } from "../../lib/mcp-management/clients/json-client.mjs";
import { McpManagementError } from "../../lib/mcp-management/domain/errors.mjs";

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "shrimp-mcp-test-"));
}

function makeService(root, {
  config = {},
  codexText = null,
  claudeText = null,
  claudeCodeText = null,
  antigravityText = null,
  fsImpl = fs,
} = {}) {
  const store = createMcpStore({
    configPath: path.join(root, "mcp.config.json"),
    secretsPath: path.join(root, "mcp.secrets.json"),
  });
  fs.writeFileSync(store.configPath, JSON.stringify({
    version: 1,
    servers: {},
    clientPaths: {},
    ...config,
  }));
  fs.writeFileSync(store.secretsPath, JSON.stringify({ servers: {} }));

  const clientPaths = {
    codex: path.join(root, "codex.toml"),
    claude: path.join(root, "claude.json"),
    claude_code: path.join(root, "claude_code.json"),
    antigravity: path.join(root, "antigravity.json"),
  };
  if (codexText !== null) fs.writeFileSync(clientPaths.codex, codexText);
  if (claudeText !== null) fs.writeFileSync(clientPaths.claude, claudeText);
  if (claudeCodeText !== null) fs.writeFileSync(clientPaths.claude_code, claudeCodeText);
  if (antigravityText !== null) fs.writeFileSync(clientPaths.antigravity, antigravityText);

  const service = createMcpManagementService({
    store,
    home: root,
    platform: process.platform,
    fsImpl,
  });
  service.setClientPath({ client: "codex", path: clientPaths.codex });
  service.setClientPath({ client: "claude", path: clientPaths.claude });
  service.setClientPath({ client: "claude_code", path: clientPaths.claude_code });
  service.setClientPath({ client: "antigravity", path: clientPaths.antigravity });
  return { service, store, clientPaths };
}

function remoteServer(name = "safe", distribution = { codex: true, claude: true, claude_code: true, antigravity: true }) {
  return {
    name,
    title: name,
    description: "",
    enabled: true,
    transport: "remote",
    url: "https://example.test/mcp",
    distribution,
  };
}

test("state scans clients without recursive scan call", () => {
  const root = makeRoot();
  try {
    const { service } = makeService(root);
    const result = service.state();
    assert.equal(result.clients.length, 4);
    assert.deepEqual(Object.keys(result.presentIn), []);
    assert.equal(result.clientsMeta.length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("server names are restricted to safe identifiers", () => {
  const root = makeRoot();
  try {
    const { service } = makeService(root);
    assert.throws(
      () => service.upsertServer({ ...remoteServer("bad name"), name: "bad name" }),
      (error) => error instanceof McpManagementError && error.code === "invalid_request",
    );
    assert.throws(
      () => service.upsertServer({ ...remoteServer("bad]name"), name: "bad]name" }),
      McpManagementError,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("codex adapter supports multiline arrays, comments, and preserves unrelated content", () => {
  const original = [
    "# keep this comment",
    "model = \"gpt-5\"",
    "",
    "[mcp_servers.existing]",
    "command = \"node\"",
    "args = [",
    "  \"one.js\",",
    "  \"two.js\",",
    "]",
    "",
    "[mcp_servers.existing.env]",
    "KEEP = \"yes\"",
    "",
    "[other]",
    "value = 1",
  ].join("\n");
  const scanned = codexAdapter.scan(original);
  assert.deepEqual([...scanned.get("existing").args], ["one.js", "two.js"]);
  assert.equal(scanned.get("existing").env.KEEP, "yes");

  const merged = codexAdapter.merge(original, [{
    ...remoteServer("existing"),
    transport: "stdio",
    command: "node",
    args: ["one.js", "two.js"],
    env: { KEEP: "yes" },
  }]);
  assert.match(merged, /# keep this comment/);
  assert.match(merged, /model = "gpt-5"/);
  assert.match(merged, /\[other\]/);
  assert.doesNotThrow(() => {
    const rescanned = codexAdapter.scan(merged);
    assert.deepEqual([...rescanned.get("existing").args], ["one.js", "two.js"]);
  });
});

test("json adapter preserves unrelated keys and rejects invalid root documents", () => {
  const adapter = createJsonClientAdapter({ id: "claude", label: "Claude", defaultPath: () => "/tmp/x" });
  const merged = adapter.merge(
    JSON.stringify({ keep: 1, mcpServers: { existing: { command: "node" } } }),
    [{ ...remoteServer("managed"), distribution: undefined }],
  );
  const parsed = JSON.parse(merged);
  assert.equal(parsed.keep, 1);
  assert.equal(parsed.mcpServers.existing.command, "node");
  assert.equal(parsed.mcpServers.managed.url, remoteServer().url);
  assert.throws(() => adapter.merge("{ invalid", []), /合法 JSON/);
});

test("apply prevalidates every target and writes nothing when one target is invalid", () => {
  const root = makeRoot();
  try {
    const { service, clientPaths } = makeService(root, {
      codexText: "model = \"x\"\n",
      claudeText: "{\"keep\":1}",
      antigravityText: "{ invalid json",
    });
    service.upsertServer(remoteServer());
    assert.throws(
      () => service.apply({ targets: { codex: true, claude: true, antigravity: true } }),
      (error) => error instanceof McpManagementError && error.code === "invalid_config",
    );
    assert.equal(fs.readFileSync(clientPaths.codex, "utf8"), "model = \"x\"\n");
    assert.equal(fs.readFileSync(clientPaths.claude, "utf8"), "{\"keep\":1}");
    assert.equal(fs.readFileSync(clientPaths.antigravity, "utf8"), "{ invalid json");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("apply removes a newly-created file when post-write verification fails", () => {
  const root = makeRoot();
  const written = new Map();
  const failingFs = {
    readFileSync(filePath, encoding) {
      if (written.has(filePath)) return "not the managed config";
      return fs.readFileSync(filePath, encoding);
    },
    existsSync(filePath) {
      return written.has(filePath) || fs.existsSync(filePath);
    },
    mkdirSync() {},
    writeFileSync(filePath, text) {
      written.set(filePath, text);
    },
    unlinkSync(filePath) {
      written.delete(filePath);
    },
  };
  try {
    const { service } = makeService(root, { fsImpl: failingFs });
    service.upsertServer(remoteServer("verify-fail", { codex: true }));
    assert.throws(
      () => service.apply({ targets: { codex: true } }),
      (error) => error instanceof McpManagementError && error.code === "storage_error",
    );
    assert.equal(written.size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("apply verifies managed values instead of only JSON object shape", () => {
  const root = makeRoot();
  try {
    const { service } = makeService(root, {
      claudeText: "{}",
    });
    service.upsertServer(remoteServer("safe", { claude: true }));
    service.apply({ targets: { claude: true } });
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "claude.json"), "utf8"));
    assert.equal(parsed.mcpServers.safe.url, "https://example.test/mcp");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("adapters refuse to replace a divergent manually configured server", () => {
  const root = makeRoot();
  try {
    const { service } = makeService(root, {
      claudeText: "{\"mcpServers\":{\"safe\":{\"url\":\"https://manual.example/mcp\"}}}",
    });
    service.upsertServer(remoteServer("safe", { claude: true }));
    assert.throws(
      () => service.apply({ targets: { claude: true } }),
      (error) => error instanceof McpManagementError && error.code === "conflict",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("store fails closed when an existing config or secrets file is invalid", () => {
  const root = makeRoot();
  try {
    const configPath = path.join(root, "mcp.config.json");
    const secretsPath = path.join(root, "mcp.secrets.json");
    fs.writeFileSync(configPath, "{ invalid");
    fs.writeFileSync(secretsPath, "{\"servers\":{}}");
    const store = createMcpStore({ configPath, secretsPath });
    assert.throws(() => store.load(), McpManagementError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("custom client paths must use the client config extension", () => {
  const root = makeRoot();
  try {
    const { service } = makeService(root);
    assert.throws(
      () => service.setClientPath({ client: "codex", path: path.join(root, "wrong.json") }),
      McpManagementError,
    );
    assert.throws(
      () => service.setClientPath({ client: "claude", path: path.join(root, "wrong.toml") }),
      McpManagementError,
    );
    service.setClientPath({ client: "codex", path: "~/nested/config.toml" });
    const state = service.state();
    assert.equal(
      state.config.clientPaths.codex,
      "~/nested/config.toml",
    );
    assert.equal(
      state.paths.codex,
      path.join(root, "nested", "config.toml"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("upsert replaces provided secret maps and null clears them", () => {
  const root = makeRoot();
  try {
    const { service, store } = makeService(root);
    service.upsertServer({
      ...remoteServer("secretful", { codex: false, claude: false, antigravity: false }),
      env: { FIRST: "one" },
      headers: { Authorization: "Bearer one" },
    });
    assert.deepEqual(store.load().secrets.servers.secretful, {
      env: { FIRST: "one" },
      headers: { Authorization: "Bearer one" },
    });
    service.upsertServer({
      ...remoteServer("secretful", { codex: false, claude: false, antigravity: false }),
      env: { SECOND: "two" },
      headers: null,
    });
    assert.deepEqual(store.load().secrets.servers.secretful, {
      env: { SECOND: "two" },
      headers: {},
    });
    service.upsertServer({
      ...remoteServer("secretful", { codex: false, claude: false, antigravity: false }),
      env: null,
      headers: null,
    });
    assert.equal(store.load().secrets.servers.secretful, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("single server preview and apply only affects the specified server", () => {
  const root = makeRoot();
  try {
    const { service, clientPaths } = makeService(root, {
      claudeText: "{}",
    });
    service.upsertServer(remoteServer("server_a", { claude: true }));
    service.upsertServer(remoteServer("server_b", { claude: true }));

    // Preview single server
    const previewA = service.preview({ targets: { claude: true }, serverName: "server_a" });
    assert.equal(previewA.serverName, "server_a");
    assert.equal(previewA.previews[0].servers.length, 1);
    assert.equal(previewA.previews[0].servers[0], "server_a");

    // Apply single server_a only
    const applyA = service.apply({ targets: { claude: true }, serverName: "server_a" });
    assert.equal(applyA.serverName, "server_a");
    const parsed = JSON.parse(fs.readFileSync(clientPaths.claude, "utf8"));
    assert.ok(parsed.mcpServers.server_a);
    assert.equal(parsed.mcpServers.server_b, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("remote server url placeholder interpolation dynamically merges secret variables", () => {
  const root = makeRoot();
  try {
    const { service, clientPaths } = makeService(root, {
      claudeText: "{}",
    });
    service.upsertServer({
      name: "remote_api",
      title: "Remote API",
      description: "",
      enabled: true,
      transport: "remote",
      url: "https://mcp.example.com/sse?api_key=${MY_API_KEY}&tenant=${TENANT_ID}",
      distribution: { claude: true },
      env: {
        MY_API_KEY: "secret-token-12345",
        TENANT_ID: "team-alpha",
      },
    });

    // Verify preview renders the interpolated URL
    const preview = service.preview({ targets: { claude: true }, serverName: "remote_api" });
    assert.match(preview.previews[0].text, /https:\/\/mcp\.example\.com\/sse\?api_key=secret-token-12345&tenant=team-alpha/);

    // Verify apply writes the interpolated URL
    service.apply({ targets: { claude: true }, serverName: "remote_api" });
    const parsed = JSON.parse(fs.readFileSync(clientPaths.claude, "utf8"));
    assert.equal(
      parsed.mcpServers.remote_api.url,
      "https://mcp.example.com/sse?api_key=secret-token-12345&tenant=team-alpha",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("service state auto-detects in-repo custom MCPs under mcps/ directory", () => {
  const root = makeRoot();
  try {
    const mcpsDir = path.join(root, "mcps");
    fs.mkdirSync(path.join(mcpsDir, "node_tool"), { recursive: true });
    fs.writeFileSync(path.join(mcpsDir, "node_tool", "index.mjs"), "// node mcp");

    fs.mkdirSync(path.join(mcpsDir, "py_tool"), { recursive: true });
    fs.writeFileSync(path.join(mcpsDir, "py_tool", "server.py"), "# py mcp");

    const { service } = makeService(root);
    const s = service.state();
    assert.ok(Array.isArray(s.inRepoMcps));
    const nodeFound = s.inRepoMcps.find((m) => m.name === "node_tool");
    const pyFound = s.inRepoMcps.find((m) => m.name === "py_tool");
    assert.ok(nodeFound);
    assert.equal(nodeFound.lang, "node");
    assert.equal(nodeFound.command, "node");
    assert.deepEqual(nodeFound.args, ["./mcps/node_tool/index.mjs"]);

    assert.ok(pyFound);
    assert.equal(pyFound.lang, "python");
    assert.equal(pyFound.command, "uv");
    assert.deepEqual(pyFound.args, ["run", "--directory", "./mcps/py_tool", "server.py"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("frontend state declares path and secret draft fields used by the panel", () => {
  const source = fs.readFileSync(
    new URL("../../desktop/src/modules/mcp-management.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /pathClient: "",/);
  assert.match(source, /pathDraft: "",/);
  assert.match(source, /env: "",/);
  assert.match(source, /headers: "",/);
});

test("distribution expands relative mcps args to absolute paths for client configs", () => {
  const root = makeRoot();
  try {
    const { service, clientPaths } = makeService(root, { claudeText: "{}" });
    service.upsertServer({
      name: "in_repo_db",
      title: "DB Hub",
      transport: "stdio",
      command: "node",
      args: ["./mcps/database-hub/index.mjs"],
      distribution: { claude: true },
      env: { order_db: "sqlite:///d:/data/app.db" },
    });

    service.apply({ targets: { claude: true } });
    const parsed = JSON.parse(fs.readFileSync(clientPaths.claude, "utf8"));
    const distributedArgs = parsed.mcpServers.in_repo_db.args;
    const expectedAbsolute = path.resolve(root, "mcps/database-hub/index.mjs").replace(/\\/g, "/");
    assert.deepEqual(distributedArgs, [expectedAbsolute]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

