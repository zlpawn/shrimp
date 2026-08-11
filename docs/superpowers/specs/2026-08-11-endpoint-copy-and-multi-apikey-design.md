# Endpoint Cross-Client Copy and Multi-API-Key Design
## Goal
Two related improvements to endpoint management:
1. **Cross-client endpoint copy** - let users copy a single endpoint from one
   client to another with protocol auto-inference and a preview/edit step, so
   they do not have to re-enter base_url, models, and api_key by hand when two
   clients share the same upstream provider.
2. **Multi-API-key per endpoint** - let a single endpoint hold multiple API
   keys with a selection strategy (failover / round-robin / random), so users
   who created several keys for the same provider can use them without
   duplicating the entire endpoint configuration.
## Background
### Current data model
`gateway.config.json` stores endpoint metadata per client:
```json
{
  "clients": {
    "desktop": {
      "endpoints": [
        {
          "id": "ep_7c7373fc-...",
          "name": "huoshan-agentplan",
          "type": "anthropic",
          "base_url": "https://ark.cn-beijing.volces.com/api/plan",
          "auth": "bearer",
          "models": [],
          "model_mapping": { "claude-haiku-4-7": "glm-5.2" }
        }
      ]
    }
  }
}
```
`gateway.secrets.json` is a flat map of `endpoint_id -> api_key`:
```json
{
  "api_keys": {
    "ep_7c7373fc-...": "ark-xxxAAA"
  }
}
```
### Current copy capability
Only client-level copy exists (`copyClientEndpoints` in
`lib/config/gateway-config-store.mjs`, exposed via `/v1/config/copy-client` and
`/v1/config/add-client` with `copyFrom`). It clones all endpoints from one
client to another. There is no endpoint-level copy.
### Current key lookup
`getEndpointApiKey(endpoint, secrets, env, allEndpoints)` in
`lib/config/gateway-config-store.mjs:210` is the single entry point for key
retrieval. It looks up `secrets.api_keys[endpoint.id]`, with a fallback to an
endpoint sharing the same `base_url`. All routing, model discovery, and
analytics code calls this function or `hasConfiguredApiKey` (which wraps it).
## Part 1: Cross-Client Endpoint Copy
### User flow
1. User is on a target client page (e.g. codex).
2. Next to the existing "add node" button, a new "copy node" button appears.
3. Clicking it opens a modal with two selectors:
   - Source client (code / desktop / codex / custom clients).
   - Source endpoint (from the selected client's endpoints).
4. After selecting, the user clicks "copy" and lands on the endpoint detail
   editor pre-filled with the source endpoint's data. This reuses the existing
   `selectedEndpoint` + `render()` pattern.
5. The user can edit any field (base_url, type, models, model_mapping,
   api_key) before saving.
6. On save, the endpoint is persisted to the target client with a new
   `ep_${crypto.randomUUID()}` id.
### Protocol auto-inference
The `type` field is auto-inferred from the target client's protocol:
- Target `code` or `desktop` -> `type: "anthropic"`
- Target `codex` or `deeptutor` -> `type: "openai-responses"`
The source endpoint's `type` is overridden. `base_url` is copied as-is; the
user adjusts the path in the preview editor if needed (e.g. `/api/coding` ->
`/api/coding/v3`). `models`, `model_mapping`, and `api_key` are copied
verbatim. `is_default` is always `false` on the copy.
### What gets copied
| Field | Copied? | Notes |
|-------|---------|-------|
| name | yes | user can rename in preview |
| type | auto-inferred | based on target client protocol |
| base_url | yes | user may need to adjust path |
| auth | yes | |
| models | yes | |
| model_mapping | yes | user may need to clean up |
| api_key | yes | carried into secrets under new endpoint id |
| is_default | no | always false |
| purpose / provider | yes | for capability endpoints |
| model_capabilities | yes | |
| proxy | yes | |
### Capability endpoints
Capability endpoints (vision_fallback, web_search, embedding, media) are
copyable. Their `purpose`, `provider`, and `options` fields are copied
verbatim. The `type` is auto-inferred if the endpoint has a chat protocol
type; pure capability types (e.g. `tavily`) keep their type.
### API
No new server endpoint needed. The copy is handled client-side in the desktop
UI: the source endpoint data is read from the in-memory `config` object,
cloned, assigned a new id, and pushed into the target client's `endpoints`
array. Save goes through the existing `/v1/config/save`.
### Secrets handling
The api_key is read from the source endpoint via `/v1/config/secret?id=...`
with the reveal header (same mechanism as `togglePasswordVisibility`). The
retrieved key is attached to the new endpoint's `api_key` field and persisted
through `/v1/config/save`, which extracts it into `gateway.secrets.json`
under the new endpoint id.
## Part 2: Multi-API-Key Per Endpoint
### Data model
An endpoint may optionally carry an `api_keys` array and a `key_strategy`:
```json
{
  "id": "ep_abc123",
  "name": "huoshan-codingplan",
  "type": "anthropic",
  "base_url": "https://ark.cn-beijing.volces.com/api/coding",
  "models": ["glm-5.2", "minimax-m3"],
  "model_mapping": {},
  "api_keys": [
    { "id": "cred_001" },
    { "id": "cred_002" }
  ],
  "key_strategy": "failover"
}
```
- `api_keys[].id` is `cred_${crypto.randomUUID()}`.
- `label` is defined in the interface but not stored or shown. Reserved for
  future use.
- `key_strategy` is one of `failover` (default), `round-robin`, `random`.
Endpoints without `api_keys` behave exactly as before.
### Secrets format
Single-key endpoints (no `api_keys` array) keep the existing format:
```json
{ "api_keys": { "ep_abc123": "ark-xxxAAA" } }
```
Multi-key endpoints use `endpoint_id::cred_id` as the key:
```json
{ "api_keys": { "ep_abc123::cred_001": "ark-xxxAAA", "ep_abc123::cred_002": "ark-xxxBBB" } }
```
The two formats never coexist on the same endpoint. When a user adds a second
key to a single-key endpoint, the existing key is migrated from
`ep_abc123` to `ep_abc123::cred_001` in the same write that adds the new key.
### Credential ID generation
```js
function createCredentialId() {
  return `cred_${crypto.randomUUID()}`;
}
```
UUID v4 guarantees global uniqueness. The `cred_` prefix avoids collision with
endpoint ids and makes multi-key entries identifiable in the secrets file.
### Strategies
| Strategy | Behavior | Default |
|----------|----------|---------|
| `failover` | Try keys in order. On failure (429/5xx/timeout/network error) switch to next key and retry. | yes |
| `round-robin` | Rotate through keys evenly per request. Stateless (no persisted cursor). | |
| `random` | Pick a random key each request. | |
With one key, all strategies behave identically (use that key).
### Retry limits (hardcoded)
| Limit | Value | Purpose |
|-------|-------|---------|
| Per-credential attempt timeout | 15s | Abort and mark the credential as failed |
| Max key attempts | `min(keys.length, 3)` | Do not try every key |
| Total elapsed timeout | 30s | Hard ceiling, return error to caller |
These are constants in `lib/upstream-retry.mjs`, not configurable.
They can be promoted to a `server.upstream_retry` config block later if needed.
### Key selection function
The existing
`getEndpointApiKey(endpoint, secrets, env, allEndpoints)` function keeps its
four-argument signature and legacy behavior. Multi-key routing uses a new
additive wrapper that returns the selected key and credential id:
```js
function getEndpointApiKeyByStrategy(
  endpoint,
  secrets,
  env,
  allEndpoints,
  strategyContext,
) {
  // Selects from endpoint.api_keys when present.
  // Delegates to getEndpointApiKey for the legacy single-key fallback.
}
```
The strategy context carries:
- `attempt`: current attempt number (0-indexed), set by the retry loop.
- `lastCredentialId`: the credential id that failed, for failover.
For `round-robin`, a process-level in-memory counter per endpoint id tracks
the last-used index. It is not persisted; on restart it resets to 0.
### Retry integration
The runtime uses **Inline Execution** at the two existing configured-upstream
entry points: `fetchConfiguredAnthropic` and `fetchConfiguredOpenAI`.

- Endpoints without a non-empty `api_keys` array execute the existing function
  bodies unchanged, including configured-key preference, caller-key fallback,
  401/403 fallback, request timeout, and same-key overload retries.
- `failover` resolves the ordered credential list once and runs
  `runCredentialFailover`. It moves to the next credential after 429, any 5xx,
  network errors, or per-credential timeouts. The runner enforces 15 seconds
  per credential, at most `min(keyCount, 3)` credential attempts, and 30
  seconds total.
- `round-robin` and `random` select one credential once per request through
  `getEndpointApiKeyByStrategy`, then preserve the existing
  `UPSTREAM_RETRY_COUNT` and `shouldRetryUpstreamResponse` same-key loop.
- Runtime logs contain endpoint and credential IDs only. API key values are
  never logged.

This keeps endpoint selection unchanged and makes credential execution an
internal concern of the selected endpoint. Future group routing can therefore
remain above this layer and delegate the chosen endpoint to the same
credential executor.
### UI changes
#### Multi-key editor
In the endpoint detail editor, when an endpoint has a single key (or none),
the existing api_key input is shown as-is. A button "add another key" appears
below it. Clicking it:
1. If the endpoint has no `api_keys` array, migrates the existing key to
   `endpoint_id::cred_001` format (in the secrets file) and creates the
   `api_keys` array with that credential.
2. Adds a new credential entry with `cred_${randomUUID}` and an empty key.
3. Shows a strategy selector (failover / round-robin / random).
Each key row shows:
- A masked preview: first 4 chars + `...` + last 3 chars (e.g. `ark-...AAA`).
- An input field (password type) for entering/editing the key, with the
  existing reveal toggle.
- A delete button to remove that credential.
#### Masked preview
A new `/v1/config/secret-preview` endpoint returns the masked prefix for all
credentials of an endpoint in one call, so the UI can render previews without
revealing full keys. The preview format is
`${key.slice(0,4)}...${key.slice(-3)}`. Keys shorter than 8 characters show
as `****`.
Gated by the same `x-gateway-secret-intent: reveal` header used by
`/v1/config/secret`, so previews are not leaked to every config reader.
#### Copy-node button
A "copy node" button is added next to the existing "add node" button on each
client page. Clicking it opens a modal with source client and source endpoint
selectors. On confirm, the endpoint detail editor opens with the cloned data.
### Validation
`validateGatewayConfig` is extended to check:
- `api_keys[].id` is non-empty and unique within the endpoint.
- `key_strategy` is one of the three allowed values (or absent).
- If `api_keys` is present, it has at least one entry.
- Secrets for multi-key endpoints use `endpoint_id::cred_id` format; no
  orphan `endpoint_id` entry remains after migration.
### Migration safety
The single-to-multi-key migration happens in `saveGatewayState`:
1. Read existing secrets.
2. If an endpoint now has `api_keys` but its old key is still under
   `endpoint_id` (not `endpoint_id::cred_id`), move it to
   `endpoint_id::cred_001`.
3. Write secrets atomically (temp file + rename, mode 0o600).
4. A `.bak` copy of the secrets file is created before the first migration.
### Backward compatibility
- Endpoints without `api_keys`: zero change. Secrets lookup, routing,
  analytics, everything works as before.
- Endpoints with `api_keys`: `getEndpointApiKey` returns the selected key;
  `hasConfiguredApiKey` returns true if any credential has a key.
- `publicGatewayConfig` exposes `has_api_key` as before (true if any
  credential is configured). It also exposes `api_keys` (id array only) and
  `key_strategy` for the UI.
### What is NOT changing
- `gateway.config.json` overall structure (still `clients.*.endpoints`).
- `gateway.secrets.json` overall structure (still flat `api_keys` map).
- Existing endpoint fields.
- Routing logic (still selects one endpoint per request; key selection is
  internal to that endpoint).
- Model discovery, model_mapping, analytics, proxy - all unaffected.
## Testing
### Unit tests
- `createCredentialId` produces unique ids.
- `getEndpointApiKey` with multi-key endpoint returns the correct key per
  strategy and attempt.
- Migration: single-key -> multi-key migrates the old key correctly.
- `validateGatewayConfig` catches invalid `api_keys` / `key_strategy`.
- Round-robin counter advances across calls and resets per endpoint.
### Integration tests
- Copy endpoint from desktop to codex: type auto-inferred, api_key carried.
- Copy endpoint preserves models and model_mapping.
- Failover: first key 429, second key succeeds.
- Failover: all keys fail, max-attempts respected, error returned.
- Round-robin: requests distributed across keys.
- Total-timeout: slow upstream triggers 30s ceiling.
## Resolved decisions
- **Secrets preview**: separate `/v1/config/secret-preview` call, gated by
  `x-gateway-secret-intent: reveal` header. Not a field on every config
  response.
- **Round-robin counter**: in-memory only, not persisted. Resets on restart.
- **Retry limits**: hardcoded constants. Config block deferred per YAGNI.
- **label field**: defined in interface, not stored. Reserved for future.
- **Copy interaction**: "copy node" button on target client page, opens modal
  to pick source client + source endpoint, then lands on preview editor.

### TypeScript integration

The desktop frontend is written in TypeScript with native DOM manipulation
(no framework). The multi-key and copy-node features integrate as follows:

- `desktop/src/core/types.ts` adds `Credential` interface and `api_keys` /
  `key_strategy` fields to `Endpoint`.
- `desktop/src/app.ts` adds `window.openCopyNodeModal`,
  `window.confirmCopyNode`, `window.addApiKey`, `window.removeApiKey`,
  `window.setKeyStrategy` functions following the existing `window.*` pattern.
- Multi-key editor rendering is extracted into a dedicated module
  `desktop/src/modules/multi-key-editor.ts` (following the existing
  `modules/iching.ts`, `modules/video-kb.ts` pattern), keeping `app.ts` from
  growing further.
- Copy-node modal rendering is extracted into
  `desktop/src/modules/copy-node.ts`.
- All CSS classes from the prototype are added to `panel.css`, using existing
  CSS variables for automatic dark/light theme support.
- No new dependencies are introduced. The existing esbuild config builds the
  new modules automatically.

### UI components (visual reference)

Prototype: `visualizations/2026/08/11/endpoint-ui-prototype.html`

Four UI states are designed:

1. **Copy node button + modal**: A "copy node" button (copy icon) sits next to
   the existing "add node" button in each client section header. Clicking
   opens a modal (reusing the `.skill-modal` overlay pattern) with a source
   client select and a source endpoint list (reusing the `.add-node-option`
   grid layout: icon + name/url + type badge). A hint tells the user the
   protocol will be auto-inferred.

2. **Preview editor after copy**: The existing endpoint detail editor
   (`.form-grid` layout) opens pre-filled with the source endpoint data. A
   `.protocol-hint` banner at the top informs the user of the protocol
   conversion. A `.detail-badge` shows the source client. All fields are
   editable; api_key shows "configured" status.

3. **Multi-key editor**: When an endpoint has `api_keys`, the detail editor
   shows a strategy selector (3-column card grid, reusing
   `.client-create-mode-option` pattern) and a key list. Each key row has a
   masked preview (`ark-...AAA`), a password input with reveal toggle (reusing
   `.password-input-wrapper`), and a delete button. An "add key" button
   (dashed border, reusing `.nav-create-client` pattern) adds new entries.

4. **Single-key to multi-key transition**: A single-key endpoint shows the
   existing api_key input unchanged, with an "add another key" button below.
   Clicking it triggers the secrets migration and switches to the multi-key
   editor view.

All components use existing CSS variables for theming, existing button/form
classes, and follow the established visual language (zinc neutrals, no accent
color, 6px/8px radius scale, 13px base font).

## Backward compatibility safeguards

The guiding principle: **single-key endpoints follow the exact same code path
as before. Multi-key is purely additive logic.** No existing function signature
is changed. No existing code path is branched based on the new fields.

### Safeguard 1: getEndpointApiKey signature unchanged

The existing `getEndpointApiKey(endpoint, secrets, env, allEndpoints)` is not
modified. A new independent function is introduced:

```js
function getEndpointApiKeyByStrategy(endpoint, secrets, env, allEndpoints, strategyContext) {
  // Only called from the retry loop when endpoint.api_keys is non-empty.
  // Delegates to getEndpointApiKey for the single-key fallback.
}
```

All 6 existing call sites in `server.js` are untouched. The retry loop checks
`endpoint.api_keys?.length > 0` before deciding whether to call
`getEndpointApiKeyByStrategy` or the original `getEndpointApiKey`.

### Safeguard 2: Validation does not reject legacy configs

`validateGatewayConfig` new checks are format-only:

- `api_keys[].id` is non-empty and unique within the endpoint (only when
  `api_keys` is present).
- `key_strategy` is one of the allowed values (only when present).

The validator does NOT check secrets-to-config consistency. A config with
`api_keys` but mismatched secrets format is not a validation error. It is
silently repaired by `saveGatewayState` (see Safeguard 3). This ensures that
manually edited configs, partial migrations, or edge cases never block gateway
startup.

### Safeguard 3: Migration write order is config-first, secrets-second

The single-to-multi-key migration in `saveGatewayState`:

1. Write `gateway.config.json` (with the new `api_keys` array) first.
2. Then migrate and write `gateway.secrets.json`.

If step 1 succeeds but step 2 fails (crash, disk full):

- The config has `api_keys` but secrets still has the old `ep_abc123` key.
- `getEndpointApiKey` falls back to the `base_url` lookup
  (`gateway-config-store.mjs:213`), so the key is still found.
- On next `saveGatewayState`, the migration retry completes.

Secrets writing itself is atomic (temp file + rename, mode 0o600), and a
`.bak` copy of the secrets file is created before the first migration.

### Safeguard 4: Frontend renders undefined api_keys as single-key

All frontend rendering uses `endpoint.api_keys?.length > 0` to decide which
view to show. Undefined, null, empty array, and missing field all fall through
to the existing single-key rendering path. The single-key path code is not
modified, only wrapped in an `if/else`.

## Extensibility and open-closed principle

The design is structured so future evolution toward a group model (multiple
endpoints sharing a routing group) can be added without rewriting the multi-key
layer.

### Strategy pattern for key selection

Key selection is behind a strategy interface, not hardcoded conditionals:

```js
// lib/config/key-strategy.mjs (new file)
export const KEY_STRATEGIES = {
  failover: { select: selectFailover, retry: true },
  'round-robin': { select: selectRoundRobin, retry: false },
  random: { select: selectRandom, retry: false },
};

export function selectKey(endpoint, secrets, env, allEndpoints, context) {
  const strategy = KEY_STRATEGIES[endpoint.key_strategy] || KEY_STRATEGIES.failover;
  return strategy.select(endpoint, secrets, env, allEndpoints, context);
}
```

Adding a new strategy (e.g. `weighted-round-robin`, `least-latency`) means
adding one entry to `KEY_STRATEGIES` and one function. No existing strategy
code is modified. This is open for extension, closed for modification.

### Credential abstraction is reusable for groups

The `Credential` type (`{id, label?}`) and the `endpoint_id::cred_id` secrets
naming convention are designed to generalize:

- Today: one endpoint, multiple credentials.
- Future group model: one group, multiple endpoints, each with credentials.

The `cred_id` namespace (`endpoint_id::cred_id`) already separates credential
identity from endpoint identity. If groups are introduced, a group's
credentials can use `group_id::cred_id` with the same lookup pattern, or
endpoints within a group can retain their own `endpoint_id::cred_id` entries.
Either path is additive, not a rewrite.

### Strategy context is forward-compatible

The `strategyContext` parameter passed to the key selection function carries
`strategy`, `attempt`, and `lastCredentialId`. This context can be extended
with group-level routing information (e.g. `groupId`, `endpointIndex`) without
changing the function signature, because it is an object that callers populate
progressively.

### Module boundaries

- `lib/config/key-strategy.mjs`: key selection strategies (new, isolated).
- `lib/config/credential-store.mjs`: credential CRUD, migration, secrets
  format helpers (new, isolated).
- `lib/config/gateway-config-store.mjs`: existing config store, only adds
  calls to the above modules when `api_keys` is present.
- `desktop/src/modules/multi-key-editor.ts`: frontend multi-key UI (new).
- `desktop/src/modules/copy-node.ts`: frontend copy-node modal (new).

Each module has a single responsibility. The existing config store and app.ts
are not aware of strategy internals or credential migration details. They
delegate to the new modules. Future group logic can be added as a new module
(e.g. `lib/config/endpoint-group.mjs`) that sits alongside, not inside, the
existing code.

### What this means for future group evolution

If the project later moves to group-based routing (multiple endpoints in a
group, with cross-endpoint failover):

1. Add `lib/config/endpoint-group.mjs` with group resolution logic.
2. Extend `strategyContext` with group fields.
3. The existing `key-strategy.mjs` and `credential-store.mjs` continue to work
   as-is, because they operate on credential selection within a single
   endpoint, which is a sub-problem of group selection.
4. The retry loop gains a "try next endpoint in group" branch, but the
   "try next credential within endpoint" branch is unchanged.

No rewrite of the multi-key layer is needed. The group layer is built on top.
