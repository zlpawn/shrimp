# Claude Code Settings.json Sync Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle switch to the Claude Code proxy node page that is default OFF, preventing changes made on the page from syncing to `~/.claude/settings.json` unless explicitly turned ON.

**Architecture:** Introduce `sync_settings` boolean in `config.clients.code` (defaulting to `false`). The gateway backend intercepts `syncClaudeCodeSettingsIfEnabled` and skips sync if `sync_settings !== true`. The desktop frontend provides a modern toggle switch card on the Claude Code page, preserves the setting across all save scopes in `node-drafts.mjs`, and displays clear toast feedback.

**Tech Stack:** Node.js (ESM), Vanilla TypeScript/HTML/CSS for desktop panel, esbuild, Node test runner (`node --test`).

## Global Constraints

- Default state must be OFF (`false`).
- When OFF, neither `~/.claude/settings.json` nor its backup file may be modified on save.
- Backwards compatibility: Existing configs without `sync_settings` or with `sync_settings: false` must treat sync as disabled.
- Follow existing project code patterns and maintain clean build outputs without bundling errors.

---

### Task 1: Backend Sync Interception Logic

**Files:**
- Create: `tests/unit/claude-code-settings-toggle.test.mjs`
- Modify: `server.js:13740-13760`

**Interfaces:**
- Consumes: `GATEWAY_CONFIG.clients.code.sync_settings`
- Produces: `syncClaudeCodeSettingsIfEnabled(config)` returning `{ updated: false, reason: "disabled-by-client-config" }` when `sync_settings !== true`

- [ ] **Step 1: Write the failing unit test**

Create `tests/unit/claude-code-settings-toggle.test.mjs`:
```javascript
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { syncClaudeCodeSettingsIfEnabledInternal } from "./helpers/claude-code-sync-helper.mjs";

test("syncClaudeCodeSettingsIfEnabled skips sync when sync_settings is false or undefined", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-toggle-test-"));
  const settingsFile = path.join(tempDir, "settings.json");

  const configDisabled = {
    clients: {
      code: {
        sync_settings: false,
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["claude-3-5-sonnet"] }],
      },
    },
  };

  const res1 = syncClaudeCodeSettingsIfEnabledInternal(configDisabled, { settingsPath: settingsFile });
  assert.equal(res1.updated, false);
  assert.equal(res1.reason, "disabled-by-client-config");
  assert.equal(fs.existsSync(settingsFile), false);

  const configUndefined = {
    clients: {
      code: {
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["claude-3-5-sonnet"] }],
      },
    },
  };

  const res2 = syncClaudeCodeSettingsIfEnabledInternal(configUndefined, { settingsPath: settingsFile });
  assert.equal(res2.updated, false);
  assert.equal(res2.reason, "disabled-by-client-config");
  assert.equal(fs.existsSync(settingsFile), false);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("syncClaudeCodeSettingsIfEnabled proceeds when sync_settings is explicitly true", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-toggle-test-"));
  const settingsFile = path.join(tempDir, "settings.json");

  const configEnabled = {
    clients: {
      code: {
        sync_settings: true,
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["claude-3-5-sonnet"] }],
      },
    },
  };

  const res = syncClaudeCodeSettingsIfEnabledInternal(configEnabled, { settingsPath: settingsFile });
  assert.equal(res.updated, true);
  assert.equal(fs.existsSync(settingsFile), true);

  fs.rmSync(tempDir, { recursive: true, force: true });
});
```

Create `tests/unit/helpers/claude-code-sync-helper.mjs`:
```javascript
import { syncClaudeCodeSettings } from "../../../lib/config/claude-code-settings.mjs";

export function syncClaudeCodeSettingsIfEnabledInternal(config, { settingsPath } = {}) {
  if (config?.clients?.code?.sync_settings !== true) {
    return { updated: false, reason: "disabled-by-client-config" };
  }
  return syncClaudeCodeSettings({
    config,
    settingsPath,
    authToken: "all",
    gatewayBaseUrl: "http://127.0.0.1:8787/code",
  });
}
```

- [ ] **Step 2: Run test to verify it passes for helper**

Run: `node --test tests/unit/claude-code-settings-toggle.test.mjs`
Expected: PASS

- [ ] **Step 3: Modify server.js to use the check**

In `server.js`, locate `syncClaudeCodeSettingsIfEnabled` (around line 13743):
```javascript
function syncClaudeCodeSettingsIfEnabled(config) {
  if (CLAUDE_CODE_SYNC_DISABLED) {
    return { updated: false, reason: "disabled" };
  }
  if (config?.clients?.code?.sync_settings !== true) {
    return { updated: false, reason: "disabled-by-client-config" };
  }
  return syncClaudeCodeSettings({
    config,
    ...(CLAUDE_CODE_SETTINGS_FILE
      ? { settingsPath: resolveUserPath(CLAUDE_CODE_SETTINGS_FILE) }
      : {}),
    authToken: CONFIGURED_API_KEY_SENTINEL,
    gatewayBaseUrl: `http://${LISTEN_HOST === "0.0.0.0" ? "127.0.0.1" : LISTEN_HOST}:${LISTEN_PORT}/code`,
  });
}
```

- [ ] **Step 4: Verify server.js syntax**

Run: `node --check server.js`
Expected: Return 0 with no errors.

- [ ] **Step 5: Commit backend changes**

```bash
git add tests/unit/claude-code-settings-toggle.test.mjs tests/unit/helpers/claude-code-sync-helper.mjs server.js
git commit -m "feat(server): intercept claude code settings sync based on sync_settings config"
```

---

### Task 2: Node Drafts Scoped Save Logic for sync_settings

**Files:**
- Modify: `desktop/src/modules/node-drafts.mjs`
- Test: `tests/unit/config-panel-node-drafts.test.mjs`

**Interfaces:**
- Consumes: `working.clients.code.sync_settings`
- Produces: `buildScopedSaveConfig` and `buildNodeSaveConfig` returning payload with `sync_settings` preserved on `clients.code`.

- [ ] **Step 1: Add unit tests in config-panel-node-drafts.test.mjs**

Add test case checking `sync_settings` preservation across scoped saves:
```javascript
test("scoped saves preserve clients.code.sync_settings", () => {
  const persisted = {
    clients: {
      code: {
        sync_settings: false,
        endpoints: [{ id: "ep1", name: "ep1", is_default: true, models: ["m1"] }],
      },
    },
  };
  const working = {
    clients: {
      code: {
        sync_settings: true,
        endpoints: [{ id: "ep1", name: "ep1-edited", is_default: true, models: ["m1"] }],
      },
    },
  };

  const nodeSave = buildScopedSaveConfig(persisted, working, {
    scope: "node",
    client: "code",
    endpoint: working.clients.code.endpoints[0],
  });
  assert.equal(nodeSave.clients.code.sync_settings, true);

  const defaultSave = buildScopedSaveConfig(persisted, working, {
    scope: "default",
    client: "code",
  });
  assert.equal(defaultSave.clients.code.sync_settings, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/unit/config-panel-node-drafts.test.mjs`
Expected: FAIL on `assert.equal(nodeSave.clients.code.sync_settings, true)`

- [ ] **Step 3: Update node-drafts.mjs**

In `desktop/src/modules/node-drafts.mjs`:
In `buildNodeSaveConfig`:
```javascript
  if (client === "code") {
    if (working?.clients?.code?.model_slots) {
      targetClient.model_slots = clone(working.clients.code.model_slots);
    }
    if (typeof working?.clients?.code?.sync_settings === "boolean") {
      targetClient.sync_settings = working.clients.code.sync_settings;
    }
  }
```
In `buildScopedSaveConfig` under default/exposure/proxy handling:
```javascript
  } else if (["default", "default-embedding", "default-web-search"].includes(scope)) {
    next = clone(persisted);
    const target = ensureClient(next, working, client);
    target.endpoints.forEach((endpoint, index) => {
      const workingIndex = endpointIndex(working, client, {
        id: endpoint.id,
        index,
      });
      if (workingIndex >= 0) {
        endpoint.is_default = endpointsOf(working, client)[workingIndex]
          .is_default === true;
      }
    });
    if (client === "code") {
      if (working?.clients?.code?.model_slots) {
        target.model_slots = clone(working.clients.code.model_slots);
      }
      if (typeof working?.clients?.code?.sync_settings === "boolean") {
        target.sync_settings = working.clients.code.sync_settings;
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/unit/config-panel-node-drafts.test.mjs`
Expected: PASS all tests.

- [ ] **Step 5: Commit node drafts changes**

```bash
git add desktop/src/modules/node-drafts.mjs tests/unit/config-panel-node-drafts.test.mjs
git commit -m "feat(desktop): preserve claude code sync_settings in scoped save configs"
```

---

### Task 3: Frontend UI & Toggle Interaction

**Files:**
- Modify: `desktop/index.html:187-191`
- Modify: `desktop/src/app.ts`
- Modify: `desktop/dist/` (via `npm run build:panel`)

**Interfaces:**
- Consumes: `config.clients.code.sync_settings`
- Produces: `window.toggleClaudeCodeSync(checked: boolean)` and dynamic card UI.

- [ ] **Step 1: Update desktop/index.html**

Replace the static `.usage-guide` in `#section-code`:
```html
                <div class="usage-guide sync-toggle-card">
                    <div class="sync-toggle-info">
                        <div class="sync-toggle-title-row">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--primary);">
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
                            </svg>
                            <h3 style="margin: 0; font-size: 14px;">自动同步到 ~/.claude/settings.json</h3>
                        </div>
                        <p id="claude-code-sync-desc" style="margin: 4px 0 0; font-size: 12px; color: var(--text-secondary);">
                            已关闭（默认）：保存节点或快捷模型时，仅更新网关配置，不会修改本地 ~/.claude/settings.json。
                        </p>
                    </div>
                    <div class="sync-toggle-control">
                        <label class="switch" title="开启或关闭自动同步到 ~/.claude/settings.json">
                            <input type="checkbox" id="claude-code-sync-toggle" onchange="toggleClaudeCodeSync(this.checked)">
                            <span class="slider round"></span>
                        </label>
                    </div>
                </div>
```

- [ ] **Step 2: Add CSS for sync-toggle-card in styles**

Ensure `.sync-toggle-card`, `.sync-toggle-info`, `.sync-toggle-title-row`, and `.switch`/`.slider` are properly styled in `desktop/src/styles/` or embedded cleanly so it renders responsively.

- [ ] **Step 3: Add logic in desktop/src/app.ts**

1. Add `renderClaudeCodeSyncToggle`:
```typescript
function renderClaudeCodeSyncToggle() {
    const toggle = document.getElementById('claude-code-sync-toggle') as HTMLInputElement | null;
    const desc = document.getElementById('claude-code-sync-desc');
    const isSync = Boolean(config.clients?.code?.sync_settings);
    if (toggle) {
        toggle.checked = isSync;
    }
    if (desc) {
        desc.textContent = isSync
            ? '已开启：保存节点或快捷模型时，网关会自动将最新代理与模型配置同步至 ~/.claude/settings.json。完全重启 Claude Code 后生效。'
            : '已关闭（默认）：保存节点或快捷模型时，仅更新网关配置，不会修改本地 ~/.claude/settings.json。';
    }
}
```
2. Call `renderClaudeCodeSyncToggle()` inside `render()` or `renderClaudeCodeModelSlots()`.
3. Add `window.toggleClaudeCodeSync`:
```typescript
(window as any).toggleClaudeCodeSync = function(checked: boolean) {
    if (!config.clients) config.clients = {} as any;
    if (!config.clients.code) config.clients.code = { endpoints: [] } as any;
    config.clients.code.sync_settings = Boolean(checked);
    const desc = document.getElementById('claude-code-sync-desc');
    if (desc) {
        desc.textContent = checked
            ? '已开启：保存节点或快捷模型时，网关会自动将最新代理与模型配置同步至 ~/.claude/settings.json。完全重启 Claude Code 后生效。'
            : '已关闭（默认）：保存节点或快捷模型时，仅更新网关配置，不会修改本地 ~/.claude/settings.json。';
    }
    const saveBtn = document.getElementById('save-btn');
    if (saveBtn) saveBtn.classList.add('dirty');
};
```
4. Adjust Toast handling in `app.ts` around lines 9052-9059:
When `payload.claudeCodeSync?.reason === 'disabled-by-client-config'`:
Show `showToast('节点已保存（Claude Code 本地配置未同步）', 'success')` or standard save toast, without error.
And in model slots help text (`renderClaudeCodeModelSlots`):
Adjust the text to reflect the toggle status (e.g. if sync is disabled, indicate it won't sync to settings.json).

- [ ] **Step 4: Build desktop bundle**

Run: `npm run build:panel`
Expected: Output `desktop/dist/panel.bundle.js` and `desktop/dist/panel.css` without errors.

- [ ] **Step 5: Commit frontend changes**

```bash
git add desktop/index.html desktop/src/app.ts desktop/src/styles/ desktop/dist/
git commit -m "feat(desktop): add settings sync toggle switch to claude code page"
```

---

### Task 4: Full System Verification

**Files:**
- Test: All unit tests and end-to-end checks

- [ ] **Step 1: Run unit tests**

Run: `node --test tests/unit/claude-code-settings-toggle.test.mjs tests/unit/config-panel-node-drafts.test.mjs tests/unit/claude-code-settings.test.mjs`
Expected: All tests pass.

- [ ] **Step 2: Verify desktop bundle build**

Run: `npm run build:panel`
Expected: Build passes with 0 errors.

- [ ] **Step 3: Syntax check**

Run: `node --check server.js`
Expected: Clean exit 0.
