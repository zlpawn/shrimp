# Dynamic Skill Discovery/Distribution & MCP Hub Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automatic discovery, status inspection, path customization, and one-click distribution for skills and MCP servers across all custom agent clients (e.g. `work-buddy`) alongside built-in clients (`codex`, `claude`, `antigravity`), with zero configuration pollution in `gateway.config.json` and 100% backward compatibility.

**Architecture:**
- **Skill Layer (`lib/session-sync/skill-installer.mjs`)**: Dynamic discovery roots and multi-client presence tracking using convention-based directory inference (`~/.${slug}/skills`).
- **MCP Hub Layer (`lib/mcp-management/`)**: Dynamic client ID resolution, standard `JsonClientAdapter` instantiation for custom nodes, and convention-based MCP file resolution (`~/.${slug}/mcp.json`).
- **HTTP Layer (`server.js` & `lib/mcp-management/http/routes.mjs`)**: Injects active custom client keys from `GATEWAY_CONFIG.clients` into Skill and MCP service operations.
- **Frontend Layer (`desktop/src/app.ts` & `desktop/src/modules/mcp-management.ts`)**: Dynamically renders skill install badges, MCP client status cards, custom path editors, and distribution matrix checkboxes.

**Tech Stack:** Node.js, TypeScript/ESM, ESBuild, Node.js native test runner (`node:test`).

## Global Constraints

- Zero breaking changes to built-in clients (`codex`, `claude`, `claude_code`, `antigravity`, `claudeDesktop3p`).
- Zero schema pollution of `gateway.config.json`; path overrides live in `mcp.config.json` (`clientPaths`) and `skills.config.json` (`clientPaths`).
- Convention-over-configuration: Custom clients resolve paths automatically from `~/.${stripped}/...` and `~/.${raw}/...` without requiring initial configuration.
- Missing files/directories must fail soft (`status: "missing"`, non-throwing) until explicit install/distribution creates them.

---

### Task 1: Backend Domain & Service Layer for Dynamic Skill Discovery & Distribution

**Files:**
- Modify: `lib/session-sync/skill-installer.mjs`
- Modify: `lib/clis/shrimp/domain/skill-service.mjs`
- Test: `tests/unit/skills-library.test.mjs`

**Interfaces:**
- Produces:
  - `SkillInstaller.resolveCustomSkillDir(client, homeDir, customPaths): string`
  - `SkillInstaller.getDiscoveryRoots(homeDir, customClients): Array<{ id, dir, client, label, isCustom }>`
  - `SkillInstaller.buildPresentIn(homeDir, skillName, customClients): Record<string, boolean>`
  - `SkillInstaller.linkSkillToClient(skillName, client, enable, homeDir, customClients): boolean`
  - `SkillInstaller.loadSkillsConfig(configPath): { version: number, clientPaths: Record<string, string> }`
  - `SkillInstaller.saveSkillsConfig(configPath, config): boolean`

- [ ] **Step 1: Write the failing tests in `tests/unit/skills-library.test.mjs`**

Add tests for:
1. `resolveCustomSkillDir` checking `~/.workbuddy/skills`, `~/.work-buddy/skills`, and custom override.
2. `getDiscoveryRoots` including custom client roots when directory exists.
3. `buildPresentIn` detecting skill presence in custom client root.
4. `linkSkillToClient` creating symlink in custom client root and unlinking properly.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/skills-library.test.mjs`
Expected: FAIL on new custom client assertions.

- [ ] **Step 3: Implement custom client resolution, discovery roots, and linking in `lib/session-sync/skill-installer.mjs`**

- Implement `resolveCustomSkillDir(client, homeDir, customPaths)` prioritizing config overrides, stripped slug directory (`~/.workbuddy/skills`), and raw slug directory (`~/.work-buddy/skills`).
- Extend `getDiscoveryRoots(homeDir, customClients = [])` to append custom roots.
- Extend `buildPresentIn(homeDir, skillName, customClients = [])` to check custom roots.
- Extend `linkSkillToClient(skillName, client, enable, homeDir, customClients = [])` to link/unlink custom client roots with directory creation.
- Add `loadSkillsConfig(configPath)` and `saveSkillsConfig(configPath, config)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/skills-library.test.mjs`
Expected: PASS (all tests passing).

- [ ] **Step 5: Commit**

```bash
git add lib/session-sync/skill-installer.mjs lib/clis/shrimp/domain/skill-service.mjs tests/unit/skills-library.test.mjs
git commit -m "feat(skills): support dynamic custom client discovery roots and distribution"
```

---

### Task 2: Backend MCP Hub Dynamic Client Management & Distribution

**Files:**
- Modify: `lib/mcp-management/domain/schema.mjs`
- Modify: `lib/mcp-management/clients/registry.mjs`
- Modify: `lib/mcp-management/application/service.mjs`
- Test: `tests/unit/mcp-management.test.mjs`

**Interfaces:**
- Produces:
  - `BUILTIN_CLIENT_IDS: string[]`
  - `resolveAllClientIds(customClientIds: string[]): string[]`
  - `normalizeDistribution(input: object, customClientIds: string[]): Record<string, boolean>`
  - `normalizeMcpConfig(input: object, customClientIds: string[]): McpConfig`
  - `getClientAdapter(clientId: string): ClientAdapter` (returns `JsonClientAdapter` for custom clients)
  - `McpService.scanClients(config, customClientIds): { clients: ClientStatus[], presentIn: Record<string, boolean[]> }`

- [ ] **Step 1: Write the failing tests in `tests/unit/mcp-management.test.mjs`**

Add tests for:
1. `normalizeDistribution` preserving custom client keys (`work-buddy: true`).
2. `normalizeMcpConfig` preserving `clientPaths["work-buddy"]`.
3. `getClientAdapter` returning `JsonClientAdapter` instance for arbitrary custom client IDs.
4. `McpService.scanClients` scanning custom clients, resolving `~/.workbuddy/mcp.json`, and reporting `status: "missing"` when file does not exist.
5. `McpService.distribute` writing `mcpServers` into custom client's JSON configuration file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/mcp-management.test.mjs`
Expected: FAIL on custom client schema normalization and adapter tests.

- [ ] **Step 3: Implement dynamic client handling in `lib/mcp-management/`**

- In `domain/schema.mjs`: Define `BUILTIN_CLIENT_IDS`, `resolveAllClientIds`, update `emptyDistribution`, `normalizeDistribution`, `normalizeMcpConfig`.
- In `clients/registry.mjs`: If `clientId` is not built-in, instantiate and return `JsonClientAdapter(clientId, "mcpServers")`.
- In `application/service.mjs`:
  - Add `resolveCustomMcpPath(client, config)` checking overrides, `~/.${stripped}/mcp.json`, `~/.${raw}/mcp.json`, and dotfile variants.
  - Update `scanClient`, `scanClients`, `resolveClientPath`, `distribute`, `importServer`, and `getState` to accept `customClientIds`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/mcp-management.test.mjs`
Expected: PASS (all tests passing).

- [ ] **Step 5: Commit**

```bash
git add lib/mcp-management/domain/schema.mjs lib/mcp-management/clients/registry.mjs lib/mcp-management/application/service.mjs tests/unit/mcp-management.test.mjs
git commit -m "feat(mcp): support dynamic custom client adapter resolution and distribution"
```

---

### Task 3: Backend HTTP API Layer & Dynamic Client Injection

**Files:**
- Modify: `lib/mcp-management/http/routes.mjs`
- Modify: `server.js`
- Test: `tests/unit/custom-client-extensions-api.test.mjs` (NEW)

**Interfaces:**
- Produces:
  - `GET /v1/skills/library`: Returns custom client status in `presentIn` and `clients`.
  - `POST /v1/skills/link`: Accepts custom client names.
  - `PUT /v1/skills/client-path`: Sets custom skill directory path in `skills.config.json`.
  - `GET /v1/mcp-management/state`: Returns cards and metadata for custom clients.
  - `PUT /v1/mcp-management/client-path`: Updates `clientPaths[client]` in `mcp.config.json`.
  - `POST /v1/mcp-management/apply`: Syncs MCP config to custom clients.

- [ ] **Step 1: Write the failing tests in `tests/unit/custom-client-extensions-api.test.mjs`**

Add tests verifying:
1. `GET /v1/skills/library` includes `work-buddy` in client presence when `work-buddy` is in `GATEWAY_CONFIG.clients`.
2. `POST /v1/skills/link` links a skill into `work-buddy`'s skill directory.
3. `GET /v1/mcp-management/state` returns a client card for `work-buddy`.
4. `PUT /v1/mcp-management/client-path` updates `clientPaths["work-buddy"]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/custom-client-extensions-api.test.mjs`
Expected: FAIL with missing custom client support in HTTP handlers.

- [ ] **Step 3: Implement route handlers and gateway config client extraction**

- In `server.js`:
  - Define `getCustomClientKeys()` helper extracting non-builtin keys from `GATEWAY_CONFIG.clients`.
  - Pass `getCustomClientKeys()` to `SkillInstaller.listSkillsCatalog`, `SkillInstaller.linkSkillToClient`, `SkillInstaller.consolidateAndDispatch`.
  - Add `PUT /v1/skills/client-path` endpoint.
  - Pass `getCustomClientKeys()` to `mcpService.getState`, `mcpService.scanClients`, `mcpService.distribute`, `mcpService.apply`.
- In `lib/mcp-management/http/routes.mjs`:
  - Ensure client path update and apply endpoints accept custom client keys without restriction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/custom-client-extensions-api.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server.js lib/mcp-management/http/routes.mjs tests/unit/custom-client-extensions-api.test.mjs
git commit -m "feat(api): connect custom gateway clients to skills and mcp endpoints"
```

---

### Task 4: Frontend UI Dynamic Rendering for Skills Modal & MCP Hub Grid

**Files:**
- Modify: `desktop/src/app.ts`
- Modify: `desktop/src/modules/mcp-management.ts`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Produces:
  - Dynamic Skill Library install/distribution toggles for all active custom clients using `clientDisplayName`.
  - Dynamic MCP client cards in `renderClientList` with status pills, path customization, and local MCP detection.
  - Dynamic MCP distribution checkboxes in server cards and server editor modal.

- [ ] **Step 1: Write the failing tests in `tests/unit/config-panel.test.mjs`**

Add tests for:
1. Skill modal renders checkbox for custom client `work-buddy` with display name `WorkBuddy 代理`.
2. `renderClientList` in MCP Hub renders custom client cards with status badge and path editor.
3. Server distribution list in MCP Hub includes checkboxes for custom clients.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`
Expected: FAIL on new custom client UI assertions.

- [ ] **Step 3: Update frontend templates and event handlers**

- In `desktop/src/app.ts`:
  - In `renderSkillModal` / `renderSkillCard`, iterate over dynamic client list (from catalog or `Object.keys(config.clients)`), render `clientDisplayName(client)` and link actions.
- In `desktop/src/modules/mcp-management.ts`:
  - In `renderClientList`, render all clients returned from state, mapping custom icons and formatted titles.
  - In `renderDistributionGrid` / modal distribution fields, dynamically render checkbox per client.
- Build panel: `npm run build:panel`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build:panel && node --test tests/unit/config-panel.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app.ts desktop/src/modules/mcp-management.ts desktop/dist/panel.bundle.js tests/unit/config-panel.test.mjs
git commit -m "feat(ui): dynamically render custom clients in skills modal and mcp hub"
```

---

### Task 5: Full Regression Testing & Live E2E Verification

**Files:**
- Test: `tests/unit/skills-library.test.mjs`
- Test: `tests/unit/mcp-management.test.mjs`
- Test: `tests/unit/config-panel.test.mjs`
- Test: `tests/unit/custom-client-extensions-api.test.mjs`
- Test: `tests/integration/gateway-cli.integration.test.mjs`

- [ ] **Step 1: Run complete test suite**

Run: `npm test && npm run test:config-panel && npm run test:cli`
Expected: All test suites PASS (100% green).

- [ ] **Step 2: Live end-to-end verification**

- Create dummy `~/.workbuddy/mcp.json` or verify detection in `/v1/mcp-management/state`.
- Verify `/v1/skills/library` includes `work-buddy`.
- Verify distribution writes to `~/.workbuddy/mcp.json`.

- [ ] **Step 3: Commit and update walkthrough**

```bash
git status
git commit -m "test: full test suite verification for custom client skills and mcp hub"
```

