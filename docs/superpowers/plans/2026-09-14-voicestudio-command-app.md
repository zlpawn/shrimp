# VoiceStudio Command App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate VoiceStudio into the gateway desktop's Command Apps panel with cross-platform (Windows & macOS) auto-discovery, manual path configuration, one-click process launch & stop, 3900 HTTP health probing, and Web API documentation deep link.

**Architecture:** Extend Shrimp's built-in `command-apps` subsystem by registering `voicestudio` in `registry.mjs`. Enhance `discovery.mjs` to resolve Windows Start Menu shortcuts/fixed drive paths and macOS `/Applications` bundles. Enhance `schema.mjs` to validate macOS `.app` bundles alongside Windows `.exe` files. Enhance `service.mjs` to handle macOS `open -a` launching, cross-platform process listing & stopping, and 3900 health probing. Update `command-apps.ts` to render the Web/API metadata and action button.

**Tech Stack:** Node.js, TypeScript, PowerShell (win32), Unix shell / ps (darwin), native HTTP/fetch, HTML/CSS.

## Global Constraints

- Must support both Windows (`win32`) and macOS (`darwin`).
- Must not break existing command apps (`antigravity`, `shrimp`, `hindsight`, `langbot`).
- VoiceStudio default port is `3900`, health path is `/health`, Web/API path is `/docs`.
- Windows executable names: `omnivoice-studio.exe` (primary) and `VoiceStudio.exe`.
- macOS executable / bundle names: `VoiceStudio.app` (primary) and `omnivoice-studio`.

---

### Task 1: Domain Registry & Schema Platform Expansion

**Files:**
- Modify: `lib/command-apps/domain/registry.mjs`
- Modify: `lib/command-apps/domain/schema.mjs`
- Modify: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Consumes: Built-in registry pattern, `validateAppSettings`, `normalizeCommandAppsConfig`.
- Produces: `voicestudio` definition in `listCommandApps()` and `getCommandApp("voicestudio")`.

- [ ] **Step 1: Write the failing tests**
In `tests/unit/command-apps.test.mjs`, add tests for `voicestudio` in registry and schema validation on `win32` and `darwin`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node tests/unit/command-apps.test.mjs`
Expected: FAIL due to missing `voicestudio` app.

- [ ] **Step 3: Update `registry.mjs` and `schema.mjs`**
Add `voicestudio` to `BUILT_IN_APPS` in `registry.mjs`. In `schema.mjs`, allow `.app` bundles or binaries when platform is `darwin` and `.exe` when platform is `win32`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node tests/unit/command-apps.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/command-apps/domain/ tests/unit/command-apps.test.mjs
git commit -m "feat(command-apps): register voicestudio in registry and expand schema validation"
```

---

### Task 2: Cross-Platform Discovery for VoiceStudio

**Files:**
- Modify: `lib/command-apps/infra/discovery.mjs`
- Modify: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Consumes: `app` definition from `registry.mjs`.
- Produces: `discoverCommandApp(app, options)` returns resolved path for `voicestudio`.

- [ ] **Step 1: Write the failing tests for discovery**
In `tests/unit/command-apps.test.mjs`, add tests verifying `discoverCommandApp` finds VoiceStudio via:
- Windows Start Menu shortcuts
- Windows common drives (e.g. `D:\VoiceStudio\omnivoice-studio.exe`, `C:\Program Files\VoiceStudio\...`)
- macOS `/Applications/VoiceStudio.app` and `~/Applications/VoiceStudio.app`

- [ ] **Step 2: Run test to verify it fails**
Run: `node tests/unit/command-apps.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement discovery strategies in `discovery.mjs`**
Generalize shortcut scanning and well-known paths so `voicestudio` checks:
- Windows: shortcuts matching `*VoiceStudio*` / `*omnivoice*`, drives C/D/E/F `\VoiceStudio\omnivoice-studio.exe`, `Program Files`, and `LOCALAPPDATA`.
- macOS: `/Applications/VoiceStudio.app`, `~/Applications/VoiceStudio.app`.
Support both directory `.app` bundles and executable binaries.

- [ ] **Step 4: Run test to verify it passes**
Run: `node tests/unit/command-apps.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/command-apps/infra/discovery.mjs tests/unit/command-apps.test.mjs
git commit -m "feat(command-apps): add cross-platform discovery for VoiceStudio"
```

---

### Task 3: Process Lifecycle, Unix Process Listing & Health Probing

**Files:**
- Modify: `lib/command-apps/infra/unix-processes.mjs`
- Modify: `lib/command-apps/infra/windows-processes.mjs`
- Modify: `lib/command-apps/application/service.mjs`
- Modify: `tests/unit/command-apps.test.mjs`

**Interfaces:**
- Consumes: `discoverCommandApp`, `listWindowsProcesses`, `terminateUnixProcessGroup`.
- Produces: `service.launch("voicestudio")`, `service.stop("voicestudio")`, `service.getStatus("voicestudio")` with `endpoints` and port 3900 health probing.

- [ ] **Step 1: Write failing tests for launch, stop, and health probe**
Add tests in `tests/unit/command-apps.test.mjs` verifying:
- Spawning on Windows and macOS (`open -a` for `.app`).
- Process matching for `omnivoice-studio.exe` / `VoiceStudio.app`.
- Process termination on both Windows and Unix.
- Health probe populates `endpoints: { port: 3900, healthUrl, appUrl }` and `healthy`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node tests/unit/command-apps.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement process lifecycle and health probe in `service.mjs`**
- In `service.mjs`, when `app.id === "voicestudio"`:
  - Launch: on darwin, if path ends with `.app`, spawn `open -a <path>`; on win32, detached spawn.
  - Process matching: use platform-appropriate process list (Windows CIM / Unix `ps`) to match executable name / path.
  - Status: include `endpoints` with port 3900, `healthUrl`, and `appUrl`.
  - Health probe: when process count > 0, probe `http://127.0.0.1:3900/health`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node tests/unit/command-apps.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add lib/command-apps/ tests/unit/command-apps.test.mjs
git commit -m "feat(command-apps): implement VoiceStudio lifecycle, process matching, and health probing"
```

---

### Task 4: Frontend Card Rendering and Web API Deep Link

**Files:**
- Modify: `desktop/src/modules/command-apps.ts`
- Modify: `tests/unit/config-panel.test.mjs` (if relevant)

**Interfaces:**
- Consumes: `status.endpoints`, `status.app.id === "voicestudio"`.
- Produces: UI card displaying executable path, port 3900, health status, Launch/Stop buttons, and "打开 Web API" button.

- [ ] **Step 1: Update `renderCard` in `desktop/src/modules/command-apps.ts`**
- In metadata display, if `status.endpoints?.appUrl` is present:
  - Render a metadata item showing `Web / API` with `:3900` badge.
  - If running, show a badge indicating health status (`服务就绪` if healthy, `启动中` if launching).
- In action buttons:
  - Add `<button class="btn" onclick="window.__commandAppsOpenVoiceStudio()" ${!running ? "disabled" : ""}>打开 Web API</button>`.
  - Register `window.__commandAppsOpenVoiceStudio = () => window.open(status.endpoints?.appUrl || "http://127.0.0.1:3900/docs", "_blank")`.

- [ ] **Step 2: Run build / typecheck / unit tests**
Run: `node tests/unit/config-panel.test.mjs`
Run: `npm run build` or verification script.

- [ ] **Step 3: Commit**
```bash
git add desktop/src/modules/command-apps.ts tests/unit/config-panel.test.mjs
git commit -m "feat(command-apps): add Web API deep link and health status in desktop UI"
```

---

### Task 5: End-to-End Verification

**Files:**
- Test all unit tests across the repository.

- [ ] **Step 1: Run all unit and integration tests**
Run: `node tests/unit/command-apps.test.mjs`
Run: `npm test`

- [ ] **Step 2: Verify real VoiceStudio discovery on the local machine**
Run a test script to confirm `discoverCommandApp(getCommandApp("voicestudio"))` discovers `D:\VoiceStudio\omnivoice-studio.exe`.

- [ ] **Step 3: Commit final updates**
```bash
git commit --allow-empty -m "chore(command-apps): complete VoiceStudio integration"
```
