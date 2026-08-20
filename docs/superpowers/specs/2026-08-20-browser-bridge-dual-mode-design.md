# Browser Bridge Dual Mode (MCP + CLI) Design

## 1. Overview & Goals

This document designs a standalone, lightweight, zero-external-dependency **Browser Bridge** that connects AI Agents and CLI users directly to a real user Chrome browser (preserving cookies, SSO logins, and active tabs) without relying on `--remote-debugging-port=9222`.

### Goals
1. **Dual-Mode Access**:
   - **MCP Mode (`mcp-server`)**: Standard Model Context Protocol over stdio for Cursor, Claude Code, Codex, Antigravity.
   - **CLI Mode (`bcli`)**: Ergonomic command-line interface for human developers, shell scripts, and traditional terminal tools.
2. **Standalone & Zero-Dependency**:
   - Built entirely on Node.js built-in standard modules (`node:http`, `node:readline`, `node:events`).
   - Works independently without requiring the Shrimp Gateway to be running.
3. **Chrome Extension (MV3) Integration**:
   - Enhances the existing extension (`extensions/leo-cookie-txt-locally`) with DOM manipulation (`click`, `fill`, `snapshot`), page evaluation (`eval`), CDP screenshots (`screenshot`), and tab management (`tabs`, `goto`, `new-tab`).
   - Maintains full backward compatibility with Netscape `cookies.txt` export for `video-kb` and `yt-dlp`.
   - Manifest V3 keep-alive via `chrome.alarms` and long-polling timeout loop.
4. **Port & Gateway Agnostic**:
   - Bridge defaults to dedicated browser port `19527`.
   - Extension auto-detects bridge / gateway endpoints with graceful fallback.

---

## 2. Architecture & Data Flow

```text
┌─────────────────────────────────────────────────────────────┐
│                    Caller Interfaces                        │
├─────────────────────────────┬───────────────────────────────┤
│          CLI Mode           │           MCP Mode            │
│   (Terminal / Shell Script) │    (Claude / Cursor / Codex)  │
│                             │                               │
│    $ bcli click --text "登录"│    call_tool("browser_click") │
│             │               │               │               │
│             ▼               │               ▼               │
│      [ CLI Adapter ]        │      [ MCP Stdio Server ]     │
└─────────────┬───────────────┴───────────────┬───────────────┘
              │                               │
              ▼ (Internal memory / HTTP POST) ▼
┌─────────────────────────────────────────────────────────────┐
│             Bridge Server Engine (Port 19527)               │
│    • In-memory command queue with TTL & Promise wait        │
│    • Diagnostic & Health APIs (/health, /doctor)            │
│    • Long-polling dispatcher (/ext/poll, /ext/result)       │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP Long-Polling (GET /ext/poll)
                              │ Result post (POST /ext/result)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│             Chrome Extension (Manifest V3)                  │
│    • background.js (alarms keep-alive + long-poll loop)     │
│    • Execution Handlers:                                    │
│       - cookies: chrome.cookies.getAll                      │
│       - tabs: chrome.tabs.query / create / update / remove  │
│       - dom: scripting.executeScript (click, fill, snap)    │
│       - cdp: debugger.attach + Page.captureScreenshot       │
└─────────────────────────────┬───────────────────────────────┘
                              ▼
                 [ Real Chrome User Browser ]
```

---

## 3. Communication Protocol

### Bridge HTTP Endpoints (Default: `http://127.0.0.1:19527`)

1. **`GET /health`**:
   - Returns `{ ok: true, bridge: true, extensionOnline: boolean, lastSeenMs: number }`.
2. **`GET /doctor`**:
   - Returns full diagnostic details (port, uptime, extension info, active tasks).
3. **`POST /cmd`**:
   - Request: `{ type: string, params: object, timeoutMs?: number }`
   - Response: `{ ok: true, id: string, result: any }` or `{ ok: false, id: string, error: string }`.
4. **`POST /ext/hello`**:
   - Extension registers with capabilities: `["cookies", "tabs", "dom", "cdp"]`.
5. **`GET /ext/poll?waitMs=25000`**:
   - Extension long-polls for next pending command. If empty, holds request up to 25s.
6. **`POST /ext/result`**:
   - Extension returns `{ id: string, ok: boolean, result?: any, error?: string }`.

---

## 4. MCP Tools Schema

| Tool Name | Parameters | Description |
| :--- | :--- | :--- |
| `browser_open_tabs` | `{}` | List all open tabs in real Chrome |
| `browser_new_tab` | `{ url?: string }` | Open a new tab |
| `browser_goto` | `{ url: string, tabId?: number }` | Navigate tab to URL |
| `browser_click` | `{ selector?: string, text?: string, tabId?: number }` | Click element by CSS selector or text |
| `browser_fill` | `{ selector: string, value: string, tabId?: number }` | Fill input field |
| `browser_snapshot` | `{ tabId?: number }` | Get lightweight accessibility / interactive element tree |
| `browser_eval` | `{ script: string, tabId?: number }` | Execute JavaScript expression in page context |
| `browser_screenshot` | `{ tabId?: number, fullPage?: boolean }` | Capture PNG screenshot (base64) |
| `browser_cookies` | `{ domain: string }` | Extract cookies for domain |
| `browser_health` | `{}` | Check bridge and extension connection status |

---

## 5. CLI Subcommands (`bcli`)

```bash
bcli health                         # Check connection status
bcli doctor                         # Diagnostic report
bcli tabs                           # List open tabs
bcli new-tab https://example.com    # Open new tab
bcli goto https://example.com       # Navigate active tab
bcli click --text "登录"             # Click by visible text
bcli click --selector "#btn-submit" # Click by CSS selector
bcli fill --selector "#user" --val "admin"
bcli snapshot                       # Dump interactive DOM tree
bcli eval "document.title"          # Evaluate JS
bcli screenshot --out ./shot.png    # Save screenshot to file
bcli cookies --domain bilibili.com  # Print cookies
```
