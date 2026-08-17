# Antigravity Command Apps Design

## Summary

Add a new System Extensions tab, **命令行程序 (Command Apps)**, for desktop programs that require command-line arguments on Windows. Phase 1 ships one managed app, Antigravity, with automatic executable discovery, one-click launch, running-state detection, last-launch time, and safe process termination.

The implementation is deliberately extensible: configuration and backend services model a collection of launch definitions. Phase 1 exposes only the built-in `antigravity` definition, so later apps can be added without redesigning storage, scanning, process control, or routing.

## Goals

1. Eliminate the need to open a terminal before launching Antigravity 2.0.
2. Automatically discover the installed Antigravity executable on Windows.
3. Launch Antigravity as `Antigravity.exe --no-sandbox` without keeping the gateway as its process parent.
4. Show whether Antigravity is running, even when it was launched outside this panel.
5. Stop only processes whose executable path matches the configured Antigravity path.
6. Preserve the existing System Extensions information architecture and visual language.
7. Keep the domain open for additional command apps without modifying core process logic.

## Non-Goals

- No general-purpose arbitrary command runner.
- No user-defined app CRUD in Phase 1.
- No shell command parsing, pipes, redirection, or environment-variable substitution.
- No macOS or Linux launcher support in Phase 1.
- No autostart-at-login or gateway startup hooks.
- No log streaming from Antigravity.

## User Experience

### Navigation

The new navigation item appears in the existing **系统扩展** group, alongside Dream Skin, NAT Traversal, and Browser Extensions:

```text
命令行程序 (Command Apps)
```

The route fragment is `#command-apps`, and the section id is `section-command-apps`.

### Main View

The main view is a calm, refined product panel rather than a marketing-style card grid. It contains:

- A status panel for Antigravity:
  - Detection state: detected, not detected, or manually configured.
  - Process state: stopped, running, launching, or error.
  - Resolved executable path in a monospace treatment.
  - Last launch time in the local timezone.
  - Launch argument badge: `--no-sandbox`.
- Primary actions:
  - **启动** when Antigravity can be launched.
  - **停止** when matching processes are running.
  - **重新扫描** to rerun executable discovery.
- Secondary configuration:
  - The executable path is editable when discovery has not resolved a valid executable.
  - After a successful automatic or manual resolution, the path is displayed read-only with a change affordance.

The panel uses the current design tokens, button hierarchy, badges, form controls, light/dark themes, and compact product density. Motion is limited to meaningful state transitions and tactile button feedback; all animations respect `prefers-reduced-motion`.

### State Design

All interface states are explicit:

- Loading: layout-matched skeleton rows, not a generic full-page spinner.
- Not detected: concise guidance, manual path form, and retry action.
- Running: status accent, executable path, process count, and last launch time.
- Stopped: primary launch action.
- Launching: temporarily disabled actions with state-preserving feedback.
- Error: inline alert containing the user-actionable cause and retry option.
- Unsupported platform: clear message that Phase 1 supports Windows only.

Copy is specific and non-celebratory. For example, the panel explains that Antigravity is launched with `--no-sandbox` for Windows compatibility without adding decorative micro-copy.

## Domain Model

The persisted configuration is a map of app definitions:

```json
{
  "commandApps": {
    "apps": {
      "antigravity": {
        "executablePath": "C:\\Users\\xtea\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe",
        "args": ["--no-sandbox"],
        "manuallyConfigured": false,
        "lastLaunchedAt": "2026-08-15T02:00:00.000Z"
      }
    }
  }
}
```

### Built-In Registry

A built-in registry defines immutable app metadata separately from user state:

```js
{
  id: "antigravity",
  displayName: "Antigravity",
  executableName: "Antigravity.exe",
  defaultArgs: ["--no-sandbox"],
  supportedPlatforms: ["win32"],
  discoveryStrategies: [
    "well-known-localappdata",
    "windows-app-paths",
    "path-environment",
    "start-menu-shortcuts"
  ]
}
```

This separation follows the open/closed principle:

- Adding an app means adding a registry entry and optional discovery strategy.
- Storage, routing, validation, process supervision, and UI rendering remain closed to modification.
- User settings override executable discovery results but cannot redefine app identity or arbitrary shell commands.

## Backend Architecture

Create `lib/command-apps/` with focused modules:

```text
lib/command-apps/
  domain/
    errors.mjs
    schema.mjs
    registry.mjs
  application/
    service.mjs
  infra/
    discovery.mjs
    process-store.mjs
    windows-processes.mjs
  http/
    routes.mjs
  index.mjs
```

### Responsibilities

- `schema.mjs`: normalizes and validates command app settings; enforces app id, absolute executable path, `.exe` suffix on Windows, bounded argument arrays, and exact-safe fixed arguments.
- `registry.mjs`: returns built-in app definitions and exposes lookup by id.
- `discovery.mjs`: resolves candidate executables through ranked strategies.
- `windows-processes.mjs`: enumerates matching processes and terminates them by process id.
- `process-store.mjs`: tracks the last gateway-launched child and last launch timestamp.
- `service.mjs`: sole application orchestration entry for discovery, config, status, launch, and stop.
- `routes.mjs`: translates HTTP requests into service calls and service errors into stable JSON errors.

### Gateway Integration

`server.js` lazily creates one `CommandAppsService`, following the NAT Traversal composition pattern. Settings are stored under `gateway.config.json` in `commandApps`, and the service receives a config store abstraction rather than reading or writing gateway state directly.

Routes are mounted before generic APIs:

```text
GET  /v1/command-apps/status
GET  /v1/command-apps/apps
GET  /v1/command-apps/discover
POST /v1/command-apps/apps/:id/launch
POST /v1/command-apps/apps/:id/stop
PUT  /v1/command-apps/apps/:id/config
```

All routes use the existing local authentication check.

## Discovery Strategy

Discovery runs only on Windows and returns ranked candidates without mutating settings.

Priority order:

1. Well-known locations:
   - `%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe`
   - `%LOCALAPPDATA%\Antigravity\Antigravity.exe`
   - `%PROGRAMFILES%\Antigravity\Antigravity.exe`
   - `C:\Program Files\Antigravity\Antigravity.exe`
2. Windows `App Paths` registry keys for `Antigravity.exe`.
3. Entries found on `PATH`.
4. Start Menu shortcut targets.

A candidate is valid only when it resolves to an existing regular file with an absolute path and `.exe` extension. The first valid candidate is returned as `selected`, and additional candidates are retained as alternatives for future UI use.

Discovery results may be copied into settings by explicit launch-time resolution or explicit user save; a discovery request alone does not overwrite a valid manual path.

## Process Control

### Launch

1. Resolve the built-in app by id.
2. Validate platform support.
3. Use the configured executable if it is valid; otherwise run discovery and save the first result.
4. Confirm the executable is an existing absolute `.exe` file.
5. Launch with argument arrays only:

```js
spawn(executablePath, ["--no-sandbox"], {
  detached: true,
  stdio: "ignore",
  windowsHide: true
});
```

6. Unref the child so closing the gateway does not close Antigravity.
7. Record executable path, process id, and timestamp in the in-memory process store.
8. Return current status after a short post-spawn liveness check.

No shell string is ever composed. Arguments are passed as a validated array.

### Status

Status combines two sources:

- The process-store pid, used to recognize recent gateway launches quickly.
- Windows process enumeration, used to detect Antigravity instances launched outside this panel.

The app is running when at least one process has an executable path equal to the configured path. Status includes process count and a boolean indicating whether the running instance was launched by this panel.

### Stop

1. Enumerate processes whose executable path exactly matches the configured Antigravity path.
2. Terminate only those process ids with Windows tree termination.
3. Clear matching entries from the process store.
4. Return refreshed status.

If no matching process is found, stop is idempotent and returns stopped status.

## Security and Safety

- Requests must pass the existing local gateway authentication check.
- Only registry-defined app ids are accepted.
- Executable paths must be absolute and point to an existing `.exe` file.
- Arguments are fixed by the built-in definition and are not accepted from requests.
- Launch and stop operate only on the configured app, never arbitrary app ids or paths.
- Path comparisons are case-insensitive on Windows and use normalized absolute paths.
- Registry, PowerShell, and process enumeration commands use `execFile`/`spawn` argument arrays, not interpolated command strings.
- Errors never expose unrelated process paths.

## Frontend Architecture

Create `desktop/src/modules/command-apps.ts`, following the existing module pattern:

- Typed API client.
- Local module state.
- Render functions for status, configuration, loading, empty, and error states.
- Registered tab enter/leave hooks.
- Escaped user-controlled path values.

The module does not import process APIs or infer launchability from browser state; the backend remains the source of truth.

Styling additions live in the existing panel stylesheet and use current CSS custom properties. They define only command-app-specific layout refinements, avoiding a parallel design system.

## Testing

### Unit Tests

Add `tests/unit/command-apps.test.mjs` covering:

- Built-in registry lookup.
- Config normalization and validation.
- Rejection of unknown app ids, relative paths, missing executables, non-`.exe` paths, and request-controlled arguments.
- Discovery ranking and candidate filtering with injected filesystem/registry probes.
- Status mapping for discovered external processes.
- Launch behavior with an injected spawner.
- Stop behavior with injected process enumeration and termination.
- Route methods, payload parsing, and error responses.

### Panel Tests

Extend `tests/unit/config-panel.test.mjs` to assert:

- The navigation item appears once under System Extensions.
- `command-apps` is a known tab.
- The section and module mount point exist.
- Module rendering includes the Antigravity status states, launch action, stop action, rescan action, and manual path form.

### Verification

- `npm run test:config-panel`
- `node --test tests/unit/command-apps.test.mjs`
- `npm run build:panel`
- Manual Windows verification:
  1. Reload the gateway panel.
  2. Open **系统扩展 → 命令行程序 (Command Apps)**.
  3. Confirm automatic detection of the installed executable.
  4. Launch Antigravity and confirm the desktop window opens without a terminal.
  5. Confirm status changes to running and last-launch time is displayed.
  6. Stop from the panel and confirm Antigravity exits.

## Rollout

Implementation occurs on branch `codex/command-apps` in the isolated worktree `D:\agent-transfer\.worktrees\command-apps`. The feature is local-first and requires no migration: absent `commandApps` settings normalize to an empty app map.

Future phases may add:

- Additional built-in apps to the registry.
- A create/edit experience for user-defined launch items.
- macOS and Linux process adapters.
- Per-app launch logs.

These are additive changes; Phase 1 must not couple process control or UI state to the single Antigravity instance.

## Self-Review

- No placeholders or unresolved decisions remain.
- The Phase 1 scope remains a single managed app while storage and services model multiple apps.
- Arbitrary shell execution is explicitly excluded.
- Manual path override is included because automatic discovery can never be guaranteed across future installer versions.
- The design preserves existing navigation conventions, local authentication, and configuration persistence patterns.
- Tests cover both backend safety and panel integration.
- Route naming and visible naming remain consistent: the exact visible label is **命令行程序 (Command Apps)**.
