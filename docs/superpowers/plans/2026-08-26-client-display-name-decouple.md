# 代理节点展示名称与路由标识解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Shrimp 本地网关自定义代理节点的「展示名称（Display Name）」与「路由标识（Route Slug）」解耦，使得用户可在 UI 和 CLI 中为代理节点设置任意友好的业务名称（支持中文/空格）并随时重命名，同时保持稳定的 URL 路由路径和完全的向后兼容性。

**Architecture:**
- 在 `gateway.config.json` 的 `clients[slug]` 对象中引入可选的 `display_name` 字段；若未配置则平滑回退至 `slug`。
- 路由寻址逻辑（`server.js`）继续使用 `slug` 作为路径主键（`http://127.0.0.1:8787/{slug}/`），确保下游客户端零破坏。
- 全局升级 `clientDisplayName(client)` 解析器，使侧边栏、标题、看板、统计、工具选择器等统一展示自定义别名。
- 新建弹窗支持显示名称与路由标识智能联动输入；节点详情页头部提供一键重命名操作。
- CLI 增加 `--name` 参数以及 `shrimp client rename` 指令。

**Tech Stack:** Node.js (ESM), Vanilla TypeScript / DOM, esbuild, Node.js built-in test runner.

---

## Global Constraints
- **Zero Breaking Changes**: Existing `gateway.config.json` without `display_name` must continue to function identically with fallback to slug key.
- **Built-in Protection**: Built-in clients (`code`, `desktop`, `codex`, `deeptutor`) must remain immutable to custom renaming to prevent core gateway corruption.
- **Slug Stability**: `slug` must always be lowercase alphanumeric + hyphen (`[a-z0-9-]+`), max 40 chars. `display_name` max 60 chars.

---

### Task 1: Backend Data Layer & CLI Service Support

**Files:**
- Modify: `lib/clis/shrimp/domain/client-service.mjs`
- Modify: `lib/clis/shrimp/commands/client.mjs`
- Modify: `server.js`
- Test: `tests/unit/clis/shrimp/client-copy-service.test.mjs`
- Test: `tests/unit/gateway-config-store.test.mjs`

**Interfaces:**
- `clientService.addClient({ configPath, secretsPath, client, displayName, protocol, copyFrom, mode })` -> `{ client, displayName, protocol, ... }`
- `clientService.renameClient({ configPath, secretsPath, client, displayName })` -> `{ client, display_name }`
- `POST /v1/config/add-client` body: `{ client, displayName, protocol, copyFrom, mode }`
- `POST /v1/config/rename-client` body: `{ client, displayName }`

- [ ] **Step 1: Write failing tests for client-service and config store**

Add tests to `tests/unit/clis/shrimp/client-copy-service.test.mjs` verifying:
1. `addClient` preserves `displayName` in `config.clients[client].display_name`.
2. `renameClient` updates `display_name` and rejects renaming built-in clients.
3. `listClients` and `getClient` return `display_name`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/clis/shrimp/client-copy-service.test.mjs`
Expected: FAIL with missing functions / assertions.

- [ ] **Step 3: Implement data layer in client-service.mjs, commands/client.mjs, and server.js**

1. In `lib/clis/shrimp/domain/client-service.mjs`:
   - Support `displayName` in `addClient`.
   - Add `renameClient({ configPath, secretsPath, client, displayName })`.
   - Update `listClients` and `getClient` to include `display_name: body.display_name || name`.
2. In `lib/clis/shrimp/commands/client.mjs`:
   - Support `--name` / `--display-name` in `client.add`.
   - Register `client.rename` command.
3. In `server.js`:
   - In `POST /v1/config/add-client`, persist `displayName` to `config.clients[client].display_name`.
   - Add `POST /v1/config/rename-client` route handler.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/clis/shrimp/client-copy-service.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/clis/shrimp/ server.js tests/unit/clis/shrimp/client-copy-service.test.mjs
git commit -m "feat(backend): support display_name and rename in client service and api"
```

---

### Task 2: Frontend Global Display Name & Resolvers

**Files:**
- Modify: `desktop/src/app.ts`
- Modify: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- `clientDisplayName(client: string): string`: Checks `config.clients[client]?.display_name`, then `CLIENT_DISPLAY_NAMES[client]`, then fallback `client`.
- `renderCustomClientNav()`: Renders `clientDisplayName(name)` in sidebar title.
- `renderCustomClientSections()`: Renders `clientDisplayName(client)` in section header, with route slug shown in subtitle.

- [ ] **Step 1: Write failing unit test in config-panel.test.mjs**

Add tests verifying:
1. `clientDisplayName` returns `display_name` when present on custom client.
2. `clientDisplayName` falls back to `CLIENT_DISPLAY_NAMES` for built-ins.
3. `clientDisplayName` falls back to `client` slug when `display_name` is absent.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Update clientDisplayName and render methods in app.ts**

1. Update `clientDisplayName`:
```typescript
function clientDisplayName(client) {
    const key = String(client || '').trim();
    if (!key) return '';
    const customName = config.clients?.[key]?.display_name;
    if (customName && typeof customName === 'string' && customName.trim()) {
        return customName.trim();
    }
    return CLIENT_DISPLAY_NAMES[key] || key;
}
```
2. Update `renderCustomClientNav`:
   - Display `clientDisplayName(name)` in `.nav-item-name`.
3. Update `renderCustomClientSections`:
   - Header shows `<h2>${escapeHtml(clientDisplayName(client))} 代理</h2>`.
   - Subtitle shows `接入协议：${escapeHtml(protocolLabel(protocol))} · 路由标识 <code>/${escapeHtml(client)}/</code>`.

- [ ] **Step 4: Build panel bundle and run tests**

Run: `npm run build:panel && npm run test:config-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/app.ts tests/unit/config-panel.test.mjs
git commit -m "feat(ui): update clientDisplayName resolver and custom section rendering"
```

---

### Task 3: Frontend Create Client Modal & Rename Interaction

**Files:**
- Modify: `desktop/index.html`
- Modify: `desktop/src/app.ts`
- Test: `tests/unit/config-panel.test.mjs`

**Interfaces:**
- Modal form inputs: `#client-create-display-name` and `#client-create-slug`.
- Auto-sync: Input in display-name auto-slugifies into slug input unless manually edited.
- Function `window.renameCustomClient(client: string)`: Prompts or opens modal to rename, calls API, updates state, re-renders.

- [ ] **Step 1: Write failing test in config-panel.test.mjs**

Add assertions verifying:
1. Modal contains display-name and slug fields.
2. `renameCustomClient` is exported to `window` and wired in header actions.
3. Submit payload includes `displayName`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Update index.html and app.ts**

1. In `desktop/index.html`:
   - Update `#client-create-modal` with Display Name and Slug inputs.
2. In `desktop/src/app.ts`:
   - Add slug auto-derivation listener with `slugManualEdited` flag.
   - Update `submitCreateClient` to read both fields and pass `displayName`.
   - Implement `window.renameCustomClient(client)` with prompt/modal, validation, API call and feedback.
   - Add "重命名" button in custom client section header.
   - Update delete confirmation message to show `「${clientDisplayName(client)} (${client})」`.

- [ ] **Step 4: Build panel bundle and run tests**

Run: `npm run build:panel && npm run test:config-panel`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/index.html desktop/src/app.ts desktop/dist/ tests/unit/config-panel.test.mjs
git commit -m "feat(ui): add modal display name/slug input linkage and client rename action"
```

---

### Task 4: Full Suite Regression Verification & Documentation

**Files:**
- Test: Run all unit and integration test suites.

- [ ] **Step 1: Run comprehensive tests**

Run: `npm run build:panel && npm run release:check && npm test`
Expected: All tests PASS (100% clean).

- [ ] **Step 2: Verify live server behavior**

Test with temporary config:
- Create client with name "办公助手" and slug "work-buddy".
- Confirm sidebar shows "办公助手", subtitle shows `/work-buddy/`.
- Rename to "我的超强工作助手" -> confirm sidebar and title update, route remains `/work-buddy/`.
- Test API route `/work-buddy/models` or `/work-buddy/v1/chat/completions`.

- [ ] **Step 3: Final Commit and Summary**

```bash
git commit --allow-empty -m "chore: complete display_name and route slug decoupling verification"
```
