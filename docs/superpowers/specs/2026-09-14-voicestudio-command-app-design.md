# VoiceStudio Command App Design

Date: 2026-09-14
Status: Approved for implementation

## Goal

Integrate VoiceStudio into the gateway desktop's **Command Apps (系统扩展 - 命令行程序)** tab on both Windows and macOS as a managed desktop application (`type: "executable"`) with cross-platform automatic discovery, manual path configuration, process lifecycle management (one-click launch and stop), HTTP health probing (`:3900/health`), and a quick entry point to open its local Web / API docs (`http://127.0.0.1:3900/docs`).

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│             Desktop Web Panel (Command Apps)                │
│  - Launch / Stop / Rescan / Configure Path                  │
│  - Status Display (Stopped / Running / Launching)           │
│  - Web API Entry (:3900 /docs)                              │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP /v1/command-apps/...
┌─────────────────────────────▼───────────────────────────────┐
│                    CommandAppsService                       │
│  - Registry: id "voicestudio", type "executable"            │
│  - Cross-platform Discovery (Win32 shortcuts / macOS .app)  │
│  - Process Lifecycle & Multi-platform Process Matcher       │
│  - Endpoint & Health Probe (:3900/health)                   │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
       (Windows Win32)                  (macOS Darwin)
┌──────────────▼──────────────┐ ┌──────────────▼──────────────┐
│ omnivoice-studio.exe        │ │ VoiceStudio.app             │
│ - D:\VoiceStudio or AppData │ │ - /Applications or ~/Apps   │
│ - FastApi @ 127.0.0.1:3900  │ │ - FastApi @ 127.0.0.1:3900  │
│ - Health @ /health          │ │ - Health @ /health          │
└─────────────────────────────┘ └─────────────────────────────┘
```

## Source of Truth & Registry Definition

VoiceStudio is registered as a cross-platform executable desktop application:

```javascript
{
  id: "voicestudio",
  displayName: "VoiceStudio",
  description: "本地多模型语音克隆与 TTS/ASR 制作套件，内置 3900 本地 API 服务。",
  type: "executable",
  executableName: "omnivoice-studio.exe",
  macExecutableName: "VoiceStudio.app",
  defaultArgs: [],
  supportedPlatforms: ["win32", "darwin"],
  defaultPort: 3900,
  healthPath: "/health",
  appPath: "/docs",
  discoveryStrategies: [
    "start-menu-shortcuts",
    "well-known-appdata",
    "common-drive-roots",
    "macos-applications",
    "path-environment"
  ]
}
```

### Metadata & Config Boundaries

| Concern | Owner | Location |
| --- | --- | --- |
| Static App Defaults | Shrimp Registry | In-code `voicestudio` definition in `lib/command-apps/domain/registry.mjs` |
| User-configured Executable Path | Shrimp DB | `gateway.db` `command_apps_settings` (keyed by `voicestudio`) |
| VoiceStudio Models, Weights & DB | VoiceStudio | `%LOCALAPPDATA%\OmniVoice` (Win) or `~/Library/Application Support/OmniVoice` (macOS) |
| Runtime HTTP Service | VoiceStudio Python Backend | Port 3900, loopback `127.0.0.1` |

## Discovery Strategy

### 1. Windows (`win32`)
Discovery runs across several prioritized tiers:
1. **Start Menu Shortcuts**:
   Scan `%ProgramData%\Microsoft\Windows\Start Menu\Programs` and `%APPDATA%\Microsoft\Windows\Start Menu\Programs` for `.lnk` shortcuts matching `*VoiceStudio*` or `*omnivoice*` and extract the target path (e.g. `D:\VoiceStudio\omnivoice-studio.exe`).
2. **Common Drive Roots & Installation Dirs**:
   Scan known fixed paths across drives:
   - `D:\VoiceStudio\omnivoice-studio.exe`
   - `C:\Program Files\VoiceStudio\omnivoice-studio.exe`
   - `C:\Program Files (x86)\VoiceStudio\omnivoice-studio.exe`
   - `%LOCALAPPDATA%\Programs\VoiceStudio\omnivoice-studio.exe`
   - `%LOCALAPPDATA%\VoiceStudio\omnivoice-studio.exe`
3. **Windows Registry App Paths**:
   Query `HKCU\...\App Paths\omnivoice-studio.exe` and `HKLM\...\App Paths\omnivoice-studio.exe` (and `VoiceStudio.exe`).
4. **PATH Environment**:
   Search directory entries in `%PATH%` for `omnivoice-studio.exe` or `VoiceStudio.exe`.

### 2. macOS (`darwin`)
1. **Standard Applications Dirs**:
   Check `/Applications/VoiceStudio.app` and `~/Applications/VoiceStudio.app`.
   Accept both the `.app` bundle directory itself and the inner binary (`Contents/MacOS/VoiceStudio` or `Contents/MacOS/omnivoice-studio`).
2. **PATH Environment**:
   Search directory entries in `$PATH` for `VoiceStudio` or `omnivoice-studio`.

### 3. Manual Path Override
The user can provide a manual path via the Web UI at any time. When manually configured:
- On Windows: Validated as an absolute path pointing to an existing `.exe`.
- On macOS: Validated as an absolute path pointing to an existing `.app` bundle or binary executable.

## Process Lifecycle Management

### 1. Process Launching
- **Windows**:
  - Spawn detached process: Use `runas.exe /trustlevel:0x20000` (or `spawn(..., { detached: true, stdio: "ignore" })`) with the resolved executable path.
  - Store child reference in `processStore`.
- **macOS**:
  - If executablePath ends with `.app`: Launch via `open -a "${executablePath}"` (or `spawn("open", ["-a", executablePath], { detached: true })`).
  - If executablePath is a direct binary: Spawn detached process directly.

### 2. Process Identification & Matching
- **Windows**:
  - Query running processes via CIM (`Win32_Process`).
  - Match processes where `executablePath` or `name` matches `omnivoice-studio.exe` or `VoiceStudio.exe`.
- **macOS**:
  - Query running processes via `ps -ax -o pid=,ppid=,command=`.
  - Match processes whose command contains `VoiceStudio.app` or `omnivoice-studio`.
  - Extract matching PIDs.

### 3. Process Termination (Stop)
- **Windows**:
  - Terminate matching process tree using `taskkill /PID <pid> /T /F`.
- **macOS**:
  - Terminate matching process / process group using `kill` (SIGTERM, followed by SIGKILL if still alive).

### 4. Health Probing & Endpoints
- Port: `3900`
- Health probe: `GET http://127.0.0.1:3900/health` (timeout 1500ms).
- App / Documentation URL: `http://127.0.0.1:3900/docs`.
- In `getStatus("voicestudio")`:
  - When process is running, probe `/health`.
  - Include `endpoints: { port: 3900, healthUrl: "http://127.0.0.1:3900/health", appUrl: "http://127.0.0.1:3900/docs" }`.
  - Include `healthy: boolean`.

## Frontend Integration (`desktop/src/modules/command-apps.ts`)

In `renderCard(status)`:
- If `status.app?.id === "voicestudio"` (or generically when `status.endpoints?.appUrl` exists on an executable app):
  - In metadata `<dl class="command-apps-meta">`:
    - Add a metadata item for `Web / API`: displays `http://127.0.0.1:3900/docs` with `:3900` badge.
    - If running, display a health status badge (`服务就绪` if healthy, `启动中` if launching).
  - In action buttons:
    - Primary button: `启动` (when stopped) / `停止` (when running).
    - Add `打开 Web API` button: opens `http://127.0.0.1:3900/docs` in a new browser tab (disabled when stopped).
    - Standard `重新检测` and `配置路径` buttons.

## Verification Plan

### Automated Unit Tests
- `tests/unit/command-apps.test.mjs`:
  1. Built-in registry definition contains `voicestudio` supporting `win32` and `darwin`.
  2. Windows path validation accepts existing `.exe` (such as `D:\VoiceStudio\omnivoice-studio.exe`).
  3. macOS path validation accepts existing `.app` bundle directory or inner binary.
  4. Discovery finds VoiceStudio from Start Menu shortcut, well-known drive path, and macOS `/Applications`.
  5. Process matching recognizes `omnivoice-studio.exe` on Windows and `VoiceStudio.app` on macOS.
  6. Service launch spawns the executable properly on both platforms.
  7. Service stop terminates the process properly on both platforms.
  8. Health probe correctly returns healthy/unhealthy endpoint state.

### Manual Verification
- In the desktop UI (`#command-apps`):
  1. Open **系统扩展 → 命令行程序 (Command Apps)**.
  2. Verify the **VoiceStudio** card appears with automatically detected path `D:\VoiceStudio\omnivoice-studio.exe`.
  3. Click **启动**, verify VoiceStudio launches and card status changes to "运行中".
  4. Verify the `:3900` badge lights up and **打开 Web API** button becomes active.
  5. Click **打开 Web API**, confirm `http://127.0.0.1:3900/docs` opens in browser.
  6. Click **停止**, verify VoiceStudio terminates cleanly and card returns to "已停止".
