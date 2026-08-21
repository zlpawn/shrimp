# Leo Lantern Page Drive + Network Capture Design

## Goal

Add the next product layer on top of task isolation so Leo Lantern can wait, read, keypress, reload, and capture XHR/fetch from the active task tab.

This phase follows the direction of stable-chrome and OpenCLI:

- wait for text/selector before acting
- read compact page content instead of screenshots-first
- press keys for submit/confirm flows
- reload claimed task tabs
- capture network requests from the task tab to discover APIs

## Scope

In scope:

- `dom.wait`
- `dom.content`
- `dom.press`
- `tabs.reload`
- `cdp.net-start` / `cdp.net-get` / `cdp.net-stop`
- CLI + MCP adapters
- task-scoped defaults (claimed / task-owned tab only)

Out of scope:

- OpenCLI-style numeric refs / AX trees
- sitemap / adapter generation
- listening to the user's non-task tabs
- auth token / port discovery

## Architecture

Keep existing path:

```text
CLI / MCP -> bridge :19527 -> extension long-poll -> real Chrome
```

Authority:

- Extension executes page/network operations.
- Network session state lives under `activeTask.extensions.network`.
- Bridge remains a queue + doctor cache.
- New commands register beside existing handlers.

## Command Contract

### `dom.wait`
Params: `text?`, `selector?`, `timeoutMs?` default 20000, `tabId?`
Requires text or selector. Polls the task tab until match or timeout.

### `dom.content`
Params: `tabId?`, `maxChars?` default 4000
Returns `{ title, url, text }`.

### `dom.press`
Params: `key` required, `selector?`, `tabId?`
Dispatches keyboard events to selector target or `document.activeElement` / body.

### `tabs.reload`
Params: `bypassCache?`, `tabId?`
Reloads claimed/task-owned tab.

### `cdp.net-start`
Params: `tabId?`
Attaches debugger, enables Network domain, stores session under task extensions.

### `cdp.net-get`
Params: `grep?`, `tabId?`
Returns captured request summaries without stopping.

### `cdp.net-stop`
Params: `grep?`, `tabId?`
Stops capture, detaches debugger if owned, returns final list.

## Defaults

- All commands require an active task unless operating on an explicit task-owned tab already claimed.
- Default tab is `claimedTabId`.
- Network capture is task-scoped.
- Fail closed on missing task/claimed tab/timeout.
- Do not steal focus.

## Surfaces

CLI: `wait`, `content`, `press`, `reload`, `net-start`, `net-get`, `net-stop`
MCP: `browser_wait`, `browser_content`, `browser_press`, `browser_reload`, `browser_net_start`, `browser_net_get`, `browser_net_stop`

## Testing

- Pure helpers for wait matching / network filtering
- CLI/MCP command mapping tests
- Extension handler unit seams where practical
- Full `npm run test:leo-lantern`
