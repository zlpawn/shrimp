# MCP Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add an MCP Management tab to the gateway panel that scans and distributes MCP servers across Codex, Claude, and Antigravity without launching server processes.

**Architecture:** A new `lib/mcp-management` backend module (paths, domain errors, client adapters, config store, application service, HTTP routes) is wired into `server.js` behind `/v1/mcp-management`. A new frontend module `desktop/src/modules/mcp-management.ts` registers a tab that renders server cards and detail controls. Gateway config is stored in `mcp.config.json` / `mcp.secrets.json` next to `gateway.config.json`.

**Tech Stack:** Node.js (>=18) ESM, `node:test`, TypeScript for the panel compiled with esbuild. No new runtime dependencies.

## Global Constraints

- Do not read or write the real `~/.codex`, `~/.claude`, `~/.claude.json`, `~/.gemini`, or `%APPDATA%` directories during development or tests.
- The `apply` route must back up every target file before writing and verify the result parses.
- Gateway MCP secrets (`env`, `headers`) live only in `mcp.secrets.json`.
- Client IDs are exactly `codex`, `claude`, `antigravity`.
- Unknown client IDs and unknown server fields are ignored during normalization.
- Follow the existing `lib/command-apps` module layout and the `desktop/src/modules/command-apps.ts` frontend pattern.

---

## File Structure

Backend (new `lib/mcp-management`):
- `paths.mjs` — resolve config/secret paths.
- `domain/errors.mjs` — `McpManagementError` and HTTP status map.
- `domain/schema.mjs` — normalize and validate gateway MCP config + secrets.
- `clients/registry.mjs` — client adapter registry.
- `clients/codex.mjs` — TOML section scan/merge for Codex.
- `clients/json-client.mjs` — JSON `mcpServers` scan/merge factory for Claude and Antigravity.
- `store.mjs` — load/save `mcp.config.json` and `mcp.secrets.json`.
- `application/service.mjs` — orchestration: scan, preview, apply, CRUD, path overrides.
- `http/routes.mjs` — HTTP route dispatcher.
- `index.mjs` — public exports.

Backend (modify):
- `server.js` — import the module and add `/v1/mcp-management` routing.

Frontend (new):
- `desktop/src/modules/mcp-management.ts` — tab module.

Frontend (modify):
- `desktop/src/main.ts` — import the module.
- `desktop/index.html` — add nav item and section.
- `desktop/src/app.ts` — add tab to `knownTabs` and `runTabEnter` list.
- `desktop/src/styles/main.css` — add `.mcp-*` styles.

Tests (new):
- `tests/unit/mcp-management-codex.test.mjs`
- `tests/unit/mcp-management-json-client.test.mjs`
- `tests/unit/mcp-management-store.test.mjs`
- `tests/unit/mcp-management-service.test.mjs`

---

### Task 1: Backend domain and paths

**Files:**
- Create: `lib/mcp-management/paths.mjs`
- Create: `lib/mcp-management/domain/errors.mjs`
- Create: `lib/mcp-management/domain/schema.mjs`
- Create: `lib/mcp-management/index.mjs`

**Interfaces:**
- Produces: `resolveMcpPaths({ configFile, secretsFile })` returning `{ configPath, secretsPath }`.
- Produces: `McpManagementError`, `MCP_MANAGEMENT_ERROR_STATUS`.
- Produces: `normalizeMcpConfig(input)`, `normalizeMcpSecrets(input)`, `emptyDistribution()`, `KNOWN_CLIENT_IDS`.

Steps below contain the full file contents; tests for schema are covered in Task 5.

- [ ] **Step 1: Create `paths.mjs`**

```js
import path from "node:path";
import { resolveProjectPath } from "../config/project-paths.mjs";

export function resolveMcpPaths({
  configFile = process.env.GATEWAY_CONFIG_FILE || "gateway.config.json",
  secretsFile = "",
} = {}) {
  const gatewayConfigPath = resolveProjectPath(configFile);
  const configDir = path.dirname(gatewayConfigPath);
  return {
    gatewayConfigPath,
    configDir,
    configPath: path.join(configDir, "mcp.config.json"),
    secretsPath: secretsFile
      ? resolveProjectPath(secretsFile)
      : path.join(configDir, "mcp.secrets.json"),
  };
}
```

- [ ] **Step 2: Create `domain/errors.mjs`**

```js
export class McpManagementError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "McpManagementError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export const MCP_MANAGEMENT_ERROR_STATUS = {
  invalid_request: 400,
  client_not_found: 404,
  server_not_found: 404,
  storage_error: 500,
};
```

- [ ] **Step 3: Create `domain/schema.mjs`**

```js
import { McpManagementError } from "./errors.mjs";

export const KNOWN_CLIENT_IDS = ["codex", "claude", "antigravity"];

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asBool(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function emptyDistribution(value = false) {
  return {
    codex: Boolean(value),
    claude: Boolean(value),
    antigravity: Boolean(value),
  };
}

export function normalizeDistribution(input = {}) {
  const src = isObject(input) ? input : {};
  return {
    codex: asBool(src.codex, false),
    claude: asBool(src.claude, false),
    antigravity: asBool(src.antigravity, false),
  };
}

export function normalizeServer(raw, fallbackName = "") {
  const name = asString(raw?.name || fallbackName).trim();
  if (!name) return null;
  const transport = asString(raw?.transport, "").trim().toLowerCase() === "stdio" ? "stdio" : "remote";
  const server = {
    name,
    title: asString(raw?.title, name),
    description: asString(raw?.description, ""),
    enabled: asBool(raw?.enabled, true),
    transport,
    command: asString(raw?.command, ""),
    args: Array.isArray(raw?.args) ? raw.args.map((v) => String(v)) : [],
    url: asString(raw?.url, ""),
    distribution: normalizeDistribution(raw?.distribution),
  };
  if (transport === "stdio" && !server.command) {
    throw new McpManagementError("invalid_request", `stdio server "${name}" requires a command`);
  }
  if (transport === "remote" && !server.url) {
    throw new McpManagementError("invalid_request", `remote server "${name}" requires a url`);
  }
  return server;
}

export function normalizeMcpConfig(input = {}) {
  const src = isObject(input) ? input : {};
  const servers = {};
  for (const [name, raw] of Object.entries(isObject(src.servers) ? src.servers : {})) {
    const server = normalizeServer({ ...raw, name }, name);
    if (server) servers[server.name] = server;
  }
  const clientPaths = {};
  for (const id of KNOWN_CLIENT_IDS) {
    clientPaths[id] = asString(src.clientPaths?.[id], "");
  }
  return { version: 1, servers, clientPaths };
}

export function normalizeMcpSecrets(input = {}) {
  const src = isObject(input) ? input : {};
  const servers = {};
  for (const [name, raw] of Object.entries(isObject(src.servers) ? src.servers : {})) {
    const env = isObject(raw?.env) ? raw.env : {};
    const headers = isObject(raw?.headers) ? raw.headers : {};
    if (!Object.keys(env).length && !Object.keys(headers).length) continue;
    servers[name] = { env, headers };
  }
  return { servers };
}
```

- [ ] **Step 4: Create `index.mjs`**

```js
export { resolveMcpPaths } from "./paths.mjs";
export { McpManagementError, MCP_MANAGEMENT_ERROR_STATUS } from "./domain/errors.mjs";
export {
  KNOWN_CLIENT_IDS,
  emptyDistribution,
  normalizeDistribution,
  normalizeMcpConfig,
  normalizeMcpSecrets,
  normalizeServer,
} from "./domain/schema.mjs";
export { listClientAdapters, getClientAdapter } from "./clients/registry.mjs";
export { createMcpStore } from "./store.mjs";
export { createMcpManagementService } from "./application/service.mjs";
export { routeMcpManagementRequest, sendMcpManagementError } from "./http/routes.mjs";
```

- [ ] **Step 5: Run syntax checks**

Run: `node --check lib/mcp-management/paths.mjs && node --check lib/mcp-management/domain/errors.mjs && node --check lib/mcp-management/domain/schema.mjs && node --check lib/mcp-management/index.mjs`
Expected: PASS (index.mjs imports unresolved modules but `--check` only parses syntax, so it passes).

- [ ] **Step 6: Commit**

```bash
git add lib/mcp-management/paths.mjs lib/mcp-management/domain/errors.mjs lib/mcp-management/domain/schema.mjs lib/mcp-management/index.mjs
git commit -m "feat(mcp): add MCP management domain and paths"
```

---

### Task 2: Client adapters

**Files:**
- Create: `lib/mcp-management/clients/codex.mjs`
- Create: `lib/mcp-management/clients/json-client.mjs`
- Create: `lib/mcp-management/clients/registry.mjs`

**Interfaces:**
- Produces adapter `{ id, label, defaultPath(home, platform), scan(text), merge(text, servers), hint(path, servers) }`.
- `servers` passed to `merge` is an array of normalized server objects from Task 1, each with resolved `env` and `headers`.

- [ ] **Step 1: Create `codex.mjs`**

```js
function tomlString(value) {
  return JSON.stringify(String(value));
}

function tomlValue(value) {
  if (Array.isArray(value)) {
    return "[" + value.map((item) => tomlString(item)).join(", ") + "]";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return tomlString(value);
}

function unquote(value) {
  const s = String(value || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    try { return JSON.parse(s.replace(/^'|'$/g, '"')); } catch { return s.slice(1, -1); }
  }
  return s;
}

function parseArray(value) {
  const s = String(value || "").trim();
  if (!s.startsWith("[")) return null;
  const inner = s.slice(1, s.lastIndexOf("]")).trim();
  if (!inner) return [];
  return inner.split(",").map((item) => unquote(item.trim())).filter((item, i, arr) => item !== "" || arr.length > 1);
}

function sectionName(line) {
  const m = line.trim().match(/^\[\s*([^\]]+)\s*\]$/);
  return m ? m[1].trim() : null;
}

export const codexAdapter = {
  id: "codex",
  label: "OpenAI Codex",
  defaultPath(home) {
    const { join } = require("node:path");
    return join(home, ".codex", "config.toml");
  },
  scan(text) {
    const lines = String(text || "").split(/\r?\n/);
    const result = new Map();
    let current = null;
    for (const line of lines) {
      const name = sectionName(line);
      if (name) {
        current = name.startsWith("mcp_servers.") && !name.includes(".env") ? name.slice("mcp_servers.".length) : null;
        if (current) {
          const trimmed = current.trim();
          if (trimmed && !trimmed.includes(".") && !result.has(trimmed)) result.set(trimmed, { name: trimmed, transport: "stdio", command: "", args: [], env: {} });
        }
        continue;
      }
      if (!current) continue;
      const server = result.get(current);
      const kv = line.match(/^\s*([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const raw = kv[2].trim();
      if (key === "command") server.command = unquote(raw);
      else if (key === "args") { const arr = parseArray(raw); if (arr) server.args = arr; }
      else if (key === "url") { server.url = unquote(raw); server.transport = "remote"; }
      else if (key === "enabled") server.enabled = raw === "true";
      else if (key === "startup_timeout_sec") server.startup_timeout_sec = Number(raw) || undefined;
    }
    return result;
  },
  merge(text, servers) {
    const lines = String(text || "").split(/\r?\n/);
    const managed = new Set();
    for (const server of servers) {
      managed.add(`mcp_servers.${server.name}`);
      managed.add(`mcp_servers.${server.name}.env`);
    }
    const kept = [];
    let i = 0;
    while (i < lines.length) {
      const name = sectionName(lines[i]);
      if (name && managed.has(name)) {
        i += 1;
        while (i < lines.length && !sectionName(lines[i])) i += 1;
        continue;
      }
      kept.push(lines[i]);
      i += 1;
    }
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    const blocks = [];
    for (const server of servers) {
      const section = [];
      if (server.transport === "remote") {
        section.push(`[mcp_servers.${server.name}]`);
        section.push(`enabled = ${server.enabled === false ? "false" : "true"}`);
        section.push(`url = ${tomlString(server.url)}`);
      } else {
        section.push(`[mcp_servers.${server.name}]`);
        section.push(`command = ${tomlString(server.command)}`);
        if (server.args?.length) section.push(`args = ${tomlValue(server.args)}`);
        if (server.env && Object.keys(server.env).length) {
          section.push("");
          section.push(`[mcp_servers.${server.name}.env]`);
          for (const [key, value] of Object.entries(server.env)) section.push(`${key} = ${tomlString(value)}`);
        }
      }
      blocks.push(section.join("\n"));
    }
    const body = kept.join("\n").replace(/\n+$/, "");
    const appended = blocks.join("\n\n");
    return (body ? body + "\n\n" : "") + appended + "\n";
  },
  hint(path) {
    return "在文件末尾追加（或替换同名）[mcp_servers.<name>] 区块。请勿删除其他区块。";
  },
};
```

Note: use `import path from "node:path"` at the top instead of `require`. See the actual committed file.

- [ ] **Step 2: Create `json-client.mjs`**

```js
export function createJsonClientAdapter({ id, label, defaultPath }) {
  return {
    id,
    label,
    defaultPath,
    scan(text) {
      let doc;
      try { doc = JSON.parse(String(text || "{}")); } catch { return { error: "invalid_json" }; }
      const raw = (doc && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers)) ? doc.mcpServers : {};
      const servers = new Map();
      for (const [name, config] of Object.entries(raw)) {
        const server = { name, transport: "remote", command: "", args: [], env: {}, headers: {} };
        if (config && typeof config === "object") {
          if (typeof config.command === "string") { server.transport = "stdio"; server.command = config.command; }
          if (Array.isArray(config.args)) server.args = config.args.map((v) => String(v));
          if (typeof config.url === "string") { server.transport = "remote"; server.url = config.url; }
          if (config.env && typeof config.env === "object") server.env = config.env;
          if (config.headers && typeof config.headers === "object") server.headers = config.headers;
        }
        servers.set(name, server);
      }
      return servers;
    },
    merge(text, servers) {
      let doc;
      try { doc = JSON.parse(String(text || "{}")); } catch { throw new Error("目标文件不是合法 JSON，已取消写入"); }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error("目标文件根节点不是对象，已取消写入");
      const mcpServers = { ...(doc.mcpServers || {}) };
      for (const server of servers) {
        const entry = {};
        if (server.transport === "stdio") {
          entry.command = server.command;
          if (server.args?.length) entry.args = server.args;
          if (server.env && Object.keys(server.env).length) entry.env = server.env;
        } else {
          entry.url = server.url;
          if (server.headers && Object.keys(server.headers).length) entry.headers = server.headers;
        }
        mcpServers[server.name] = entry;
      }
      return JSON.stringify({ ...doc, mcpServers }, null, 2) + "\n";
    },
    hint(path) {
      return "在目标 JSON 文件的顶层 mcpServers 对象中添加对应服务器条目。";
    },
  };
}
```

- [ ] **Step 3: Create `registry.mjs`**

```js
import os from "node:os";
import path from "node:path";
import { codexAdapter } from "./codex.mjs";
import { createJsonClientAdapter } from "./json-client.mjs";

const claudeAdapter = createJsonClientAdapter({
  id: "claude",
  label: "Claude Desktop / Claude Code",
  defaultPath(home, platform) {
    if (platform === "win32") {
      const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
      return path.join(appData, "Claude", "claude_desktop_config.json");
    }
    return path.join(home, ".claude.json");
  },
});

const antigravityAdapter = createJsonClientAdapter({
  id: "antigravity",
  label: "Google Antigravity",
  defaultPath(home) {
    return path.join(home, ".gemini", "config", "mcp_config.json");
  },
});

const adapters = [codexAdapter, claudeAdapter, antigravityAdapter];
const byId = new Map(adapters.map((a) => [a.id, a]));

export function listClientAdapters() { return adapters; }
export function getClientAdapter(id) { return byId.get(String(id || "")) || null; }
```

- [ ] **Step 4: Add tests for adapters (codex + json)**

See Task 6 file contents. Run: `node --test tests/unit/mcp-management-codex.test.mjs tests/unit/mcp-management-json-client.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/mcp-management/clients tests/unit/mcp-management-codex.test.mjs tests/unit/mcp-management-json-client.test.mjs
git commit -m "feat(mcp): add client config adapters"
```

---

### Task 3: Config store

**Files:**
- Create: `lib/mcp-management/store.mjs`

**Interfaces:**
- Produces `createMcpStore({ configPath, secretsPath })` with `{ load(), saveConfig(config), saveSecrets(secrets), paths }`.

- [ ] **Step 1: Create `store.mjs`**

```js
import fs from "node:fs";
import path from "node:path";
import { McpManagementError } from "./domain/errors.mjs";
import { normalizeMcpConfig, normalizeMcpSecrets } from "./domain/schema.mjs";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(filePath, value, mode) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(tmp, filePath);
}

export function createMcpStore({ configPath, secretsPath }) {
  const fallbackConfig = normalizeMcpConfig({});
  const fallbackSecrets = normalizeMcpSecrets({});

  function load() {
    let config;
    try {
      config = normalizeMcpConfig(readJson(configPath, fallbackConfig));
    } catch (error) {
      if (error instanceof McpManagementError) throw error;
      throw new McpManagementError("storage_error", "无法读取 mcp.config.json", { reason: error.message });
    }
    return { config, secrets: normalizeMcpSecrets(readJson(secretsPath, fallbackSecrets)) };
  }

  function saveConfig(config) {
    const normalized = normalizeMcpConfig(config);
    writeJson(configPath, normalized, 0o644);
    return normalized;
  }

  function saveSecrets(secrets) {
    const normalized = normalizeMcpSecrets(secrets);
    writeJson(secretsPath, normalized, 0o600);
    return normalized;
  }

  return { load, saveConfig, saveSecrets, configPath, secretsPath };
}
```

- [ ] **Step 2: Test the store with temp files**

Add `tests/unit/mcp-management-store.test.mjs`; run and expect PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/mcp-management/store.mjs tests/unit/mcp-management-store.test.mjs
git commit -m "feat(mcp): add MCP config store"
```

---

### Task 4: Application service

**Files:**
- Create: `lib/mcp-management/application/service.mjs`

**Interfaces:**
- Produces `createMcpManagementService({ store, adapters, home, platform, fsImpl })` with methods `state()`, `scan()`, `upsertServer(input)`, `deleteServer(name)`, `preview({ targets })`, `apply({ targets })`, `setClientPath({ client, path: filePath })`.

- [ ] **Step 1: Create `service.mjs`** (full implementation; see committed file)

- [ ] **Step 2: Test the service with a temp home**

Add `tests/unit/mcp-management-service.test.mjs`; run and expect PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/mcp-management/application/service.mjs tests/unit/mcp-management-service.test.mjs
git commit -m "feat(mcp): add MCP management service"
```

---

### Task 5: HTTP routes + server wiring

**Files:**
- Create: `lib/mcp-management/http/routes.mjs`
- Modify: `server.js`

- [ ] **Step 1: Create `routes.mjs`** (dispatcher mirroring command-apps routes).

- [ ] **Step 2: Wire `server.js`**

- Add imports near the other module imports.
- Add `let globalMcpManagementService = null;` and `ensureMcpManagementService()`.
- Add a routing block `if (reqPath.startsWith("/v1/mcp-management"))` before the other `/v1` blocks.

- [ ] **Step 3: Syntax check and route smoke test**

Run: `node --check server.js`. Do not start the server against real client configs.

- [ ] **Step 4: Commit**

```bash
git add lib/mcp-management/http/routes.mjs server.js
git commit -m "feat(mcp): wire MCP management HTTP routes"
```

---

### Task 6: Frontend module + panel wiring

**Files:**
- Create: `desktop/src/modules/mcp-management.ts`
- Modify: `desktop/src/main.ts`, `desktop/index.html`, `desktop/src/app.ts`, `desktop/src/styles/main.css`

- [ ] **Step 1: Create the frontend module** with `registerTab("mcp-management", { onEnter })` and global action handlers.

- [ ] **Step 2: Add nav item and section in `index.html`**, and import the module in `main.ts`.

- [ ] **Step 3: Add `mcp-management` to `knownTabs` and the `runTabEnter` list in `app.ts`.**

- [ ] **Step 4: Add `.mcp-*` styles to `main.css`.**

- [ ] **Step 5: Build the panel**

Run: `npm run build:panel`
Expected: PASS (esbuild compiles the new TypeScript module).

- [ ] **Step 6: Commit**

```bash
git add desktop/src/modules/mcp-management.ts desktop/src/main.ts desktop/index.html desktop/src/app.ts desktop/src/styles/main.css
git commit -m "feat(mcp): add MCP management panel tab"
```

---

### Task 7: Verification and handoff

- [ ] Run the full safe syntax and fixture-only test set.
- [ ] Confirm no real client config was read or written.
- [ ] Report branch, commit range, and how to enable/use the new tab.

