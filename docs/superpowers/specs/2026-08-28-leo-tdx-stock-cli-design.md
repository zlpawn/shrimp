# Leo TDX Stock CLI Design

## Status

Approved for implementation on 2026-08-28.

## Product Shape

- Executable and in-repo CLI name: `leo-tdx`.
- Managed Skill name: `leo-tdx-stock`.
- Implementation: Node.js ESM with zero runtime dependencies.
- Endpoint: `https://txmcp.tdx.com.cn:3001/txmcp`.
- Transport: MCP Streamable HTTP over Bearer authentication and SSE responses.

## Cross-Platform Token Storage and Extraction

Token resolution order:

1. `TDX_TOKEN` environment variable.
2. `~/.shrimp/secrets/tdx/token` (mode 600 under a mode-700 directory).

`SHRIMP_SECRETS_DIR` overrides the secrets root. No token is ever accepted as a command-line argument.

`leo-tdx token extract` reads WorkBuddy credentials and atomically writes the extracted token to the Shrimp secrets path. Candidate roots are resolved without tilde string expansion:

1. `WORKBUDDY_CONNECTORS_DIR`.
2. `${os.homedir()}/.workbuddy/connectors`.
3. `${APPDATA}/WorkBuddy/connectors` when present (Windows).
4. `${LOCALAPPDATA}/WorkBuddy/connectors` when present (Windows).

Every child path uses `path.join`, so both POSIX and Windows separators are valid. Each non-`default` user directory may contain:

- `.master.key`: exactly 32 bytes.
- `connector-states.v3.json`: WorkBuddy encrypted connector state.

Extraction:

1. Verify `encryption.keyCheck == base64(sha256(masterKey || salt)[:16])`.
2. Derive a 32-byte key with Node `crypto.hkdfSync("sha256", masterKey || userId, salt, "workbuddy-oauth-credentials-v1", 32)`.
3. Decrypt AES-256-GCM ciphertext using AAD `userId|connector-states:headerOverrides:tdx-connector|Authorization`.
4. Remove a `Bearer ` prefix and require the token to start with `TDX-`.
5. Write only the final token to the secrets file.

Failures never print master keys, ciphertext, IVs, resolved tokens, or full credential paths. The user is told to open WorkBuddy, connect the TDX connector, and rerun `leo-tdx token extract`.

Additional commands:

-`leo-tdx token set`: hidden interactive input, or `--stdin`.
-`leo-tdx token status`: configured/missing and source only.
-`leo-tdx token clear`.

## MCP Session Contract

Every invocation performs:

1. `initialize` with protocol version `2024-11-05`.
2. Capture `Mcp-Session-Id` from the response header.
3. Send `notifications/initialized`.
4. Send the requested JSON-RPC call.

All requests use:

-`Authorization: Bearer <token>`
-`Content-Type: application/json`
-`Accept: application/json, text/event-stream`
-`Mcp-Session-Id` after initialization.

Responses are parsed as SSE by concatenating every `data:` payload and decoding JSON.

## Command Surface

```bash
leo-tdx whoami
leo-tdx tools
leo-tdx schema <tool>
leo-tdx lookup <query> [--market SH|SZ|BJ|HK]
leo-tdx quotes <code> [setcode] [--market SH|SZ|BJ|HK]
leo-tdx kline <code> [setcode] [--period day|week|month|1m|5m] [--count N] [--market ...]
leo-tdx screener <query> [--limit N]
leo-tdx indicator <code> [--indicators a,b]
leo-tdx notice <code> [--type T] [--range R] [--limit N]
leo-tdx report <code> [--keyword K] [--range R] [--limit N]
leo-tdx news <keyword> [--category C] [--range R] [--limit N]
leo-tdx macro <indicator> [--range R] [--limit N]
leo-tdx api <entry> [--fixed-tag X] [--mode raw] [--params JSON]
leo-tdx call <tool> '<JSON arguments>'
```

Market mapping:

-`SH` → setcode `1`
-`SZ` → `0`
-`BJ` → `2`
-`HK` → `31`

When both setcode and market are supplied they must agree. Unknown combinations are parameter errors.

Default output is JSON for agents. `--output text` prints MCP text content for humans. `--output raw` prints the JSON-RPC response. Errors are concise and safe.

Exit codes:

-0 success
-2 argument error
-3 authentication/token invalid
-4 MCP/server error
-5 network error
-6 local credential/configuration error

## Skill

`lib/skills/leo-tdx-stock/SKILL.md` instructs agents to:

1. Use `leo-tdx`, never direct HTTP.
2. Start with lookup when stock code is unknown.
3. Inspect schema when unsure about a low-frequency tool.
4. Prefer concrete subcommands over `call`.
5. Never read or print the token file or WorkBuddy credentials.
6. Ask the user to run `leo-tdx token extract` on auth failure.

## Testing

Unit and integration tests use injected HTTP transports and temporary WorkBuddy fixtures. They cover:

- MCP initialize/session/notification/call ordering.
- SSE parsing.
- Bearer header and no token leakage.
- Market/setcode mapping.
- JSON/text/raw output.
- Exit-code classification.
- Cross-platform credential roots, including Windows APPDATA/LOCALAPPDATA.
- HKDF/AES-GCM extraction against a fixture generated with Node crypto.
- Restricted secret file permissions.
- CLI discovery and managed skill installation.

## Repository Integration

```text
clis/leo-tdx/
  index.mjs
  README.md
  package.json
  lib/
    mcp.mjs
    token.mjs
    cli.mjs
lib/skills/leo-tdx-stock/SKILL.md
```

The existing Wendao CLI is renamed from `wendao` to `leo-wendao`; its Skill remains `leo-xiecheng-wendao`.
