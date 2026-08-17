# Grok subscription tool and subscription usage design

## Goal

Add a Grok subscription mini-tool and expose remaining subscription usage for Grok, Codex, and Antigravity without changing request routing or authentication behavior.

## Scope

- Copy local private runtime files (gateway.config.json and antigravity.secrets.json) into the isolated worktree. They remain uncommitted.
- Add a Grok provider to the existing subscription-auth registry.
- Add a normalized usage object to provider status responses.
- Render one usage summary component in each subscription detail view.

## Components

### Grok subscription provider

- Read credentials from GROK_AUTH_PATH or ~/.grok/auth.json.
- Detect the first scope containing a session key.
- Report state as missing auth, ready, expiring soon, or expired.
- Count endpoints whose type is grok or grok-subscription.
- Fetch models through the existing Grok model discovery action.
- Do not implement an OAuth login flow. Instruct users to run grok login; the Grok CLI refreshes and owns the token.

### Grok usage reader

- Call GET {GROK base URL}/billing?format=credits.
- Use the same credential and proxy behavior as Grok model discovery.
- Include official CLI-compatible headers: bearer token, X-XAI-Token-Auth, x-userid, x-grok-client-version, and x-grok-client-mode.
- Parse the response defensively: creditUsagePercent maps to used percent; remaining percent is 100 minus used; currentPeriod or legacy period fields are retained; prepaidBalance.val, onDemandUsed.val, and onDemandCap.val are USD cents.
- Failure returns a structured error and does not fail the rest of status.

### Codex usage reader

- Start codex app-server --stdio as a short-lived child process.
- Initialize the JSON-RPC connection, call account/rateLimits/read, and terminate the process after the response.
- Normalize primary and secondary windows, multi-bucket limits, credits, used percent, remaining percent, and reset timestamps.
- This is not a direct HTTP request. It reuses the official local app-server transport and auth logic.

### Antigravity usage capture

- Extend the v1internal protobuf decoder for wrapper fields 3 (consumed_credits) and 4 (remaining_credits).
- Persist only the latest usage snapshot in memory when an Antigravity response arrives.
- Status returns the latest snapshot and its update time. If no Antigravity request has occurred, usage is marked unavailable.

### Detail view rendering

- Each provider status exposes usage.available, remaining_percent, reset_at, period boundaries, credits, and an error message.
- Existing token remaining time remains token lifetime information. The new field is labeled subscription remaining usage to avoid ambiguity.
- Usage fetch errors show a concise reason and never block auth, model discovery, or node configuration.

## Error handling

- Missing auth: no usage request is sent.
- Upstream HTTP error: structured error with HTTP status.
- Codex app-server timeout: structured timeout error and process termination.
- Antigravity missing snapshot: unavailable, not an error.
- Malformed usage payloads: ignore unknown fields; require only fields actually displayed.

## Testing

- Unit tests for Grok auth state, node counting, billing normalization, and official headers.
- Unit tests for Codex JSON-RPC framing and response normalization with an injected process runner.
- Unit tests for Antigravity protobuf credit decoding and usage cache updates.
- Config-panel tests assert the Grok detail route and usage rendering hooks.
- Run subscription unit tests and npm run build:panel.
