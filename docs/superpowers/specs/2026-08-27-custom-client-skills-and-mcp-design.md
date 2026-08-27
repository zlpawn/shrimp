# Design Specification: Dynamic Skill Discovery/Distribution & MCP Hub Management for Custom Agent Clients

- **Date**: 2026-08-27
- **Status**: Approved
- **Branch**: `feat/custom-client-skills-mcp`
- **Worktree**: `.worktrees/custom-client-skills-mcp`

---

## 1. Background & Problem Statement

Shrimp Local AI Gateway supports creating custom agent proxy nodes (e.g. `work-buddy`, `cursor`, `cline`, `windsurf`) alongside built-in clients (`code`, `desktop`, `codex`, `deeptutor`).

However, the System Extensions modules (Skill Library & MCP Hub) currently have rigid, hardcoded client bindings:
1. **Skill Library (`lib/session-sync/skill-installer.mjs`)**: Discovery roots and distribution targets are hardcoded to `central` (Codex), `antigravity`, `claude`, and `claudeDesktop3p`. Custom agent nodes have no scanning roots and cannot be selected in the skill installation/distribution modal.
2. **MCP Hub (`lib/mcp-management/`)**: `KNOWN_CLIENT_IDS` is hardcoded to `["codex", "claude", "claude_code", "antigravity"]`. Custom agent nodes do not appear in the MCP client status grid, cannot have their MCP config paths inspected/customized, and cannot be targeted for MCP distribution.

### Core Objectives
1. **Dynamic Client Awareness**: Automatically discover all active custom agent clients defined in `gateway.config.json` without hardcoding.
2. **Zero Pollution of `gateway.config.json`**: Skill and MCP path overrides are maintained independently in `skills.config.json` (optional) and `mcp.config.json` (`clientPaths`), keeping `gateway.config.json` focused purely on gateway routing and endpoint definitions.
3. **Convention-Over-Configuration (零配置即用)**: Out of the box, default paths for custom clients are inferred automatically (e.g. `~/.workbuddy/skills` and `~/.workbuddy/mcp.json` for `work-buddy`).
4. **Full Feature Parity**: Custom agent nodes get full scanning, status inspection, custom path editing, and one-click distribution in both Skill Library and MCP Hub.
5. **Zero Breaking Changes**: 100% backward compatibility for all existing built-in clients (Codex TOML, Claude Desktop 3P plugin copy, Claude Code JSON, Antigravity JSON).

---

## 2. Path Conventions & Configuration Architecture

### 2.1 Default Path Resolution Conventions

For any custom client identifier `client` (e.g., `work-buddy`):
* Normalized slug forms:
  * `raw`: `client` (e.g., `work-buddy`)
  * `stripped`: `client.replace(/[-_]/g, '')` (e.g., `workbuddy`)

#### Skill Directory Resolution Priority:
1. Explicit custom path from `skills.config.json` (`clientPaths[client]`), if configured.
2. `~/.${stripped}/skills` if directory exists.
3. `~/.${raw}/skills` if directory exists.
4. Default target (when creating/installing for the first time): `~/.${stripped}/skills` (e.g. `~/.workbuddy/skills`).

#### MCP Configuration File Resolution Priority:
1. Explicit custom path from `mcp.config.json` (`clientPaths[client]`), if configured.
2. `~/.${stripped}/mcp.json` if file exists.
3. `~/.${raw}/mcp.json` if file exists.
4. `~/.${stripped}/.mcp.json` if file exists.
5. `~/.${raw}/.mcp.json` if file exists.
6. Default target (when creating/installing for the first time): `~/.${stripped}/mcp.json` (e.g. `~/.workbuddy/mcp.json`).

### 2.2 Storage Model

* **`gateway.config.json`**: Purely read-only source of truth for the list of active clients (`Object.keys(GATEWAY_CONFIG.clients)`).
* **`mcp.config.json`**:
  ```json
  {
    "version": 1,
    "servers": {
      "database-hub": {
        "name": "database-hub",
        "distribution": {
          "codex": true,
          "claude": false,
          "claude_code": false,
          "antigravity": false,
          "work-buddy": true
        }
      }
    },
    "clientPaths": {
      "codex": "",
      "claude": "",
      "claude_code": "",
      "antigravity": "",
      "work-buddy": "~/.workbuddy/mcp.json"
    }
  }
  ```
* **`skills.config.json`** (Optional, created only when user customizes a non-default path):
  ```json
  {
    "version": 1,
    "clientPaths": {
      "work-buddy": "~/.workbuddy/skills"
    }
  }
  ```

---

## 3. Backend Implementation

### 3.1 Skill Installer Layer (`lib/session-sync/skill-installer.mjs`)

1. **Dynamic Discovery Roots**:
   - Update `SkillInstaller.getDiscoveryRoots(homeDir = os.homedir(), customClients = [])`:
     * Returns built-in roots (`central`, `antigravity`, `claude`).
     * Appends entries for all `customClients` whose resolved skill directories exist on disk.
     * Each custom root object: `{ id: client, dir: resolvedSkillDir, client, label: clientDisplayName(client), isCustom: true }`.
2. **Dynamic Presence Check**:
   - Update `SkillInstaller.buildPresentIn(homeDir, skillName, customClients = [])`:
     * Checks built-in roots and dynamically populates `presentIn[client] = fs.existsSync(path.join(resolvedDir, skillName, "SKILL.md"))`.
3. **Dynamic Installation / Uninstallation / Batch Dispatch**:
   - Update `SkillInstaller.linkSkillToClient(skillName, client, enable, homeDir, customClients = [])`:
     * If `client` is custom, resolves target directory, ensures parent directory exists (`mkdir -p`), and establishes symlink (or copy on Windows) from `~/.agents/skills/{skillName}`.
   - Update `SkillInstaller.consolidateAndDispatch({ homeDir, targets, customClients = [] })`:
     * Supports dispatching central skills to all selected custom clients.
4. **Skills Config Store**:
   - Add `SkillInstaller.loadSkillsConfig(configPath)` and `SkillInstaller.saveSkillsConfig(configPath, nextConfig)` for custom skill directory overrides.

### 3.2 MCP Hub Management Layer (`lib/mcp-management/`)

1. **Domain & Schema (`domain/schema.mjs`)**:
   - Change static `KNOWN_CLIENT_IDS` to `BUILTIN_CLIENT_IDS = ["codex", "claude", "claude_code", "antigravity"]`.
   - Add `resolveAllClientIds(customClientIds = [])` returning `[...BUILTIN_CLIENT_IDS, ...customClientIds]`.
   - Update `emptyDistribution(customClientIds)` and `normalizeDistribution(input, customClientIds)` to dynamically accept and preserve boolean flags for all valid client keys.
   - Update `normalizeMcpConfig(input, customClientIds)` to preserve `clientPaths` for all known and custom clients.
2. **Client Adapters & Registry (`clients/registry.mjs`)**:
   - For all custom client IDs, map to the standard `JsonClientAdapter` targeting standard `"mcpServers"` top-level object.
3. **Application Service (`application/service.mjs`)**:
   - Pass `customClientIds` through `scanClients`, `resolveClientPath`, `distribute`, `importServer`, and `getState`.
   - For any custom client whose configuration file does not exist, return `{ client, path, status: "missing", servers: [] }` (clean status pill in UI).

### 3.3 HTTP API Layer (`server.js` & `lib/mcp-management/http/routes.mjs`)

1. Extract active custom client keys:
   ```javascript
   function getCustomClientKeys() {
     const builtin = new Set(["code", "desktop", "codex", "deeptutor"]);
     return Object.keys(GATEWAY_CONFIG.clients || {}).filter(k => !builtin.has(k));
   }
   ```
2. Pass `getCustomClientKeys()` into:
   - `GET /v1/skills/library`: Catalog enriched with custom client presence.
   - `POST /v1/skills/link`: Target any client (link / unlink).
   - `POST /v1/skills/consolidate`: Batch dispatch to selected clients.
   - `PUT /v1/skills/client-path`: Custom skill directory override.
   - `GET /v1/mcp-management/state`: State includes custom client cards, detection, and distribution.
   - `PUT /v1/mcp-management/client-path`: Update MCP config path for any client.
   - `POST /v1/mcp-management/apply` & `POST /v1/mcp-management/sync`: Sync to all selected clients.

---

## 4. Frontend UI Implementation

### 4.1 Skill Library Modal (`desktop/src/app.ts`)
* In the Skill details/install modal:
  * Dynamically list all clients (built-in + custom).
  * Render client labels using `clientDisplayName(client)`.
  * Display install status badge per client (`已安装` / `未安装`).
  * Allow toggling install/unlink per client individually or via batch dispatch.

### 4.2 MCP Hub Client Status Grid (`desktop/src/modules/mcp-management.ts`)
* In `renderClientList()`:
  * Map over all clients returned by `/v1/mcp-management/state` (including custom clients).
  * Display custom client cards with status pills (`X 个已安装` / `配置文件未创建` / `配置文件解析失败`).
  * Display detected local MCP list with `📥 导入托管` and `🔍 调试` action buttons.
  * Provide `自定义路径` button and editor for custom clients.

### 4.3 MCP Distribution Matrix (`desktop/src/modules/mcp-management.ts`)
* In `renderServerCards()` and MCP edit modal:
  * Dynamically render distribution checkboxes for all available clients.
  * Checkbox labels format: `[√] WorkBuddy 代理` (using `clientDisplayName`).
  * "一键写入客户端" triggers multi-client sync across both built-in and custom client configs.

---

## 5. Backward Compatibility & Edge Cases

| Scenario | Behavior |
| :--- | :--- |
| **No custom clients exist** | System behavior, API payloads, and UI render exactly as before. |
| **Custom client directory/file does not exist** | Skill scan skips quietly; MCP Hub displays `配置文件未创建`. Installing auto-creates parent folders. |
| **Custom client is deleted in gateway** | Leftover entries in `mcp.config.json` are safely ignored by schema normalization without errors. |
| **Windows compatibility** | Symlinks vs directory copy adheres to existing Windows platform fallback strategies. |

---

## 6. Testing Strategy

1. **Unit Tests**:
   - `tests/unit/skills-library.test.mjs`: Test dynamic custom client discovery roots, presence detection, linking, and unlinking.
   - `tests/unit/mcp-management.test.mjs`: Test schema normalization with dynamic client IDs, custom client JSON adapter read/write/verify, and path resolution.
   - `tests/unit/config-panel.test.mjs`: Test frontend dynamic rendering for Skill modal and MCP cards.
2. **Integration Verification**:
   - End-to-end verification of adding a custom client `work-buddy`, creating a local `~/.workbuddy/mcp.json`, verifying live detection in MCP Hub, and performing one-click distribution.
