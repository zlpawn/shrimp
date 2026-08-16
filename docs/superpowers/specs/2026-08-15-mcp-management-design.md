# MCP Management Design

## Goal

Add an **MCP Management** tab to the gateway web panel at the same navigation level as **预置技能 (Agent Skills)**. It scans MCP servers already configured in local agent clients, hosts a gateway-managed catalog of third-party MCP servers, and distributes enabled servers to target clients.

## Clients in scope

- OpenAI Codex Desktop / CLI
- Claude Desktop / Claude Code
- Google Antigravity Desktop

Clients are represented by adapter modules in a registry so future clients can be added without changing the UI or distribution flow.

## Out of scope

- Starting or supervising MCP server processes. The gateway only reads and writes client config files.
- `~/.gemini/settings.json`. Antigravity MCP config is read/written from `~/.gemini/config/mcp_config.json` by default; the user may override the path.
- Modifying the gateway's model routing or skill distribution.

## Requirements

1. Scan installed MCP servers from Codex, Claude, and Antigravity.
2. Show, for each discovered server, which clients currently have it configured.
3. Host a catalog of third-party MCP servers in the gateway.
4. Distribute enabled gateway-managed MCP servers to selected clients with one click.
5. The default action generates a config snippet and tells the user which file and location to edit.
6. An optional write-to-client-config action modifies the client file directly, but only after an explicit confirmation dialog.
7. The write path must back up the target file before modifying it.
8. Support both Windows and macOS with different default paths.
9. Allow the user to choose, per client, which file stores MCP configuration.

## File storage

Gateway-managed MCP definitions live next to `gateway.config.json` in the active config directory:

- `mcp.config.json` — public definitions and distribution preferences.
- `mcp.secrets.json` — sensitive `env` and `headers` values, gitignored.

This mirrors the existing `gateway.secrets.json` / `nat-traversal.secrets.json` convention and keeps model routing separate from MCP management.

### `mcp.config.json`

```json
{
  "version": 1,
  "servers": {
    "craft": {
      "name": "craft",
      "title": "Craft MCP",
      "description": "Craft document tools",
      "enabled": true,
      "transport": "remote",
      "url": "https://mcp.craft.do/links/GaXJmJAdyNg/mcp",
      "distribution": {
        "codex": true,
        "claude": true,
        "antigravity": true
      }
    }
  },
  "clientPaths": {
    "codex": "",
    "claude": "",
    "antigravity": ""
  }
}
```

For a stdio server, `transport` is `"stdio"`, `command` is the executable, and `args` is an array. For a remote server, `transport` is `"remote"` and `url` is required.

### `mcp.secrets.json`

```json
{
  "servers": {
    "craft": {
      "env": {},
      "headers": {}
    }
  }
}
```

All `env` and `headers` values are treated as sensitive and stored only in the secrets file. The public config never carries secret values.

## Client adapters

Each adapter implements:

```js
{
  id,             // "codex" | "claude" | "antigravity"
  label,          // UI label
  defaultPath(home, platform), // default config file path
  scan(text),     // Map<string, config> parsed from file text
  merge(text, servers),        // new file text with MCP blocks merged
  hint(path, servers)          // human-readable "which file and where" guidance
}
```

### Codex

- Default path: `~/.codex/config.toml` on Windows and macOS.
- Format: TOML. Servers are `[mcp_servers.<name>]` sections with an optional nested `[mcp_servers.<name>.env]` section.
- Strategy: line-based section extraction and patching. `scan` finds `[mcp_servers.<name>]` headers and reads simple `key = value` entries until the next section header. `merge` removes existing `[mcp_servers.<name>]` and `[mcp_servers.<name>.env]` blocks and appends freshly serialized blocks at the end.

This deliberately avoids a full TOML parse/serialize round-trip. Unrelated sections and comments are preserved byte-for-byte.

### Claude

- Default paths:
  - Windows: `%APPDATA%\Claude\claude_desktop_config.json` (best-effort; the exact Windows path is unverified and can be overridden).
  - macOS: `~/.claude.json`.
- Format: JSON with a top-level `mcpServers` object.
- Strategy: parse JSON, merge only `mcpServers`, write indented JSON. The same adapter accepts any JSON file exposing `mcpServers`.

### Antigravity

- Default path: `~/.gemini/config/mcp_config.json` on Windows and macOS.
- Format: JSON with a top-level `mcpServers` object.
- Strategy: same as Claude.

## Gateway API

All routes are prefixed with `/v1/mcp-management` and protected by `checkLocalAuth`.

- `GET /v1/mcp-management/state` — catalog, resolved client paths, scan results, and per-client status.
- `GET /v1/mcp-management/scan` — rescan client files and return a normalized snapshot.
- `POST /v1/mcp-management/servers` — create or update a gateway-managed server.
- `DELETE /v1/mcp-management/servers/:name` — remove a gateway-managed server.
- `POST /v1/mcp-management/preview` — generate config snippets for selected clients without writing.
- `POST /v1/mcp-management/apply` — merge config into selected clients after backup.
- `PUT /v1/mcp-management/client-path` — set the custom config path for one client.

## Write safety

Every `apply` operation:

1. Reads the current target file.
2. Writes a timestamped backup at `<file>.mcp-backup-<timestamp>`.
3. Merges only MCP-related blocks or keys.
4. Writes the new text.
5. Reads the file back and verifies it parses before reporting success.

If verification fails, the original in-memory text is restored.

## Frontend

- New module: `desktop/src/modules/mcp-management.ts`.
- New section: `#section-mcp-management` in `desktop/index.html`.
- New nav item under **系统扩展**, peer of **预置技能 (Agent Skills)**, labeled **MCP 管理 (MCP Management)**.
- Register the tab via `registerTab("mcp-management", ...)` and add it to the `knownTabs` and `runTabEnter` lists in `desktop/src/app.ts`.

UI mirrors the skills library: server cards on the left, selected-server detail and distribution controls on the right, with rescan / add-server / preview / apply actions. The primary action is preview (snippet + hint); apply is a secondary action guarded by a confirmation modal.

## Error handling

- Missing client config files are shown as "not found" with the expected default path and a path override.
- Unparseable TOML/JSON is shown as a warning and never overwritten.
- Unknown client IDs are ignored.
- Disabled servers are not distributed; removing existing client entries is a separate future action.

## Testing strategy

Unit tests use temporary fixture files only. No test reads or writes the real `~/.codex`, `~/.claude`, `~/.claude.json`, `~/.gemini`, or `%APPDATA%` directories.

Because the user is actively using Codex, Claude, and Antigravity, the `apply` route is implemented but not exercised against live client files during development. Verification uses only fixture files and syntax checks.

## Non-goals

- Live process supervision of MCP servers.
- OAuth or browser login for remote MCP servers.
- Auto-merging hand-edited MCP blocks beyond the managed server names.

