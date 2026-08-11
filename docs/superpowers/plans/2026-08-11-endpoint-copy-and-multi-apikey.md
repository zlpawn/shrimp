# Endpoint Copy and Multi-API-Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users copy one endpoint between clients through a reviewable draft, and add multiple API keys to supported configured endpoints with failover, round-robin, or random selection while preserving every legacy single-key path.

**Architecture:** Ship the work in two independently reviewable slices. Endpoint copy stays in the TypeScript panel and uses the existing config save API, while credential persistence and key selection are isolated in new server modules. `getEndpointApiKey(endpoint, secrets, env, allEndpoints)` remains unchanged; multi-key chat requests enter additive branches at `fetchConfiguredAnthropic` and `fetchConfiguredOpenAI`.

**Tech Stack:** Node.js ESM, TypeScript, esbuild, vanilla DOM/template strings, `node:test`, existing CSS variables and panel components.

## Global Constraints

- Use the isolated worktree `/Users/pa/project/AI/local-ai-gateway/.worktrees/feature-multi-apikey-node-dup`.
- Continue on branch `feature/multi-apikey-node-duplication`.
- Read and apply `design-taste-frontend` before Tasks 2 and 7.
- Add no npm dependencies.
- Keep `getEndpointApiKey(endpoint, secrets, env, allEndpoints)` byte-for-byte behaviorally compatible and keep its four-argument signature.
- Endpoints without a non-empty `api_keys` array must execute the existing single-key request code.
- Missing, `null`, or empty `api_keys` must render the current single-key editor.
- Persist credential metadata only as `{ "id": "cred_<uuid>" }`; `label?: string` exists only as a reserved TypeScript field.
- Generate endpoint IDs with `ep_${crypto.randomUUID()}` and credential IDs with `cred_${crypto.randomUUID()}`.
- Never persist `api_key`, `api_key_env`, `api_key_values`, `has_api_key`, masked previews, or copy-modal state in `gateway.config.json`.
- A multi-key endpoint may not retain a legacy `secrets.api_keys[endpointId]` entry after a successful save.
- A partially migrated config must still resolve the legacy endpoint-level secret until the next successful save.
- Validation checks metadata shape only; it must not reject startup because config and secrets are temporarily inconsistent.
- Retry limits are constants: 15 seconds per credential attempt, `min(configuredKeyCount, 3)` credential attempts, and 30 seconds total.
- The first runtime integration is bounded to requests already concentrated in `fetchConfiguredAnthropic` and `fetchConfiguredOpenAI`. Capability nodes are copyable; capability-specific runtimes that bypass these functions keep their existing single-key behavior and must not show a misleading multi-key editor.
- Preserve existing auth fallback and same-key retry behavior for legacy endpoints.
- Keep future endpoint-group routing above endpoint-local credential selection; do not add group concepts in this change.

## File Map

- Create `lib/config/credential-store.mjs`: credential IDs, secret-key parsing, secret resolution, masking, and credential-aware persistence helpers.
- Create `lib/config/key-strategy.mjs`: extensible strategy registry and deterministic selection.
- Modify `lib/config/gateway-config-store.mjs`: transient multi-key secret extraction, migration, pruning, validation, and additive lookup wrapper.
- Modify `lib/upstream-retry.mjs`: failover response classification and bounded credential-attempt runner.
- Modify `server.js`: secret reveal/preview API, public key status, and the two configured upstream integration points.
- Modify `desktop/src/core/types.ts`: credential metadata and transient editor types.
- Create `desktop/src/modules/copy-node.ts`: copy modal state, protocol inference, and copy draft construction.
- Create `desktop/src/modules/multi-key-editor.ts`: multi-key rendering and editor-state helpers.
- Modify `desktop/src/app.ts`: narrow wiring into existing render/save/window patterns.
- Modify `desktop/src/styles/panel.css`: copy modal and multi-key controls using the current design system.
- Add focused unit and integration tests under `tests/unit` and `tests/integration`.

---

## Slice A: Cross-Client Endpoint Copy

### Task 1: Define endpoint-copy types and pure draft construction

**Files:**
- Modify: `desktop/src/core/types.ts`
- Create: `desktop/src/modules/copy-node.ts`
- Test: `tests/unit/config-panel-copy-node.test.mjs`

**Interfaces:**
- Produces:
  - `Credential { id: string; label?: string }`
  - `Endpoint.api_keys?: Credential[]`
  - `Endpoint.key_strategy?: KeyStrategy`
  - `Endpoint.api_key_values?: Record<string, string>` as transient save payload
  - `inferCopiedEndpointType(targetClient, targetProtocol, sourceEndpoint)`
  - `buildEndpointCopyDraft(sourceEndpoint, target, revealedSecrets, idFactory, credentialIdFactory)`

- [ ] **Step 1: Write the failing source-contract tests**

Create `tests/unit/config-panel-copy-node.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");

test("copy-node module keeps copy rules in focused pure helpers", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/modules/copy-node.ts"),
    "utf8",
  ).catch(() => "");
  assert.match(source, /export function inferCopiedEndpointType/);
  assert.match(source, /export function buildEndpointCopyDraft/);
  assert.match(source, /is_default:\s*false/);
  assert.match(source, /credentialIdFactory/);
  assert.match(source, /api_key_values/);
});

test("endpoint type reserves credential metadata without requiring label", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/core/types.ts"),
    "utf8",
  );
  assert.match(source, /interface Credential\s*\{[\s\S]*id:\s*string;[\s\S]*label\?:\s*string;/);
  assert.match(source, /api_keys\?:\s*Credential\[\]/);
  assert.match(source, /key_strategy\?:\s*KeyStrategy/);
  assert.match(source, /api_key_values\?:\s*Record<string,\s*string>/);
});
```

- [ ] **Step 2: Run the test and confirm the module is missing**

Run:

```bash
node --test tests/unit/config-panel-copy-node.test.mjs
```

Expected: FAIL because `copy-node.ts` and the new type fields do not exist.

- [ ] **Step 3: Add the TypeScript types**

Add to `desktop/src/core/types.ts`:

```ts
export type KeyStrategy = "failover" | "round-robin" | "random";

export interface Credential {
  id: string;
  label?: string;
}
```

Extend `Endpoint` without removing existing fields:

```ts
api_key?: string;
api_keys?: Credential[];
key_strategy?: KeyStrategy;
api_key_values?: Record<string, string>;
```

Replace the current required `api_key: string` declaration with the optional
form above because `/v1/config` already strips stored keys from its response.

- [ ] **Step 4: Implement pure copy rules**

Create `desktop/src/modules/copy-node.ts` with these exported types and functions:

```ts
import type { AppConfig, Endpoint } from "../core/types";

export interface CopyTarget {
  client: string;
  protocol?: string;
}

export interface RevealedEndpointSecrets {
  single?: string;
  credentials?: Record<string, string>;
}

const CHAT_PROTOCOL_TYPES = new Set([
  "anthropic",
  "openai-chat",
  "openai-responses",
  "grok",
]);

export function inferCopiedEndpointType(
  targetClient: string,
  targetProtocol: string | undefined,
  sourceEndpoint: Endpoint,
): string {
  if (!CHAT_PROTOCOL_TYPES.has(sourceEndpoint.type)) return sourceEndpoint.type;
  if (targetClient === "codex" || targetClient === "deeptutor") {
    return "openai-responses";
  }
  if (targetClient === "code" || targetClient === "desktop") {
    return "anthropic";
  }
  return targetProtocol === "openai" ? "openai-responses" : "anthropic";
}

export function buildEndpointCopyDraft(
  sourceEndpoint: Endpoint,
  target: CopyTarget,
  revealedSecrets: RevealedEndpointSecrets,
  idFactory: () => string = () => `ep_${crypto.randomUUID()}`,
  credentialIdFactory: () => string = () => `cred_${crypto.randomUUID()}`,
): Endpoint {
  const draft = structuredClone(sourceEndpoint);
  draft.id = idFactory();
  draft.type = inferCopiedEndpointType(target.client, target.protocol, sourceEndpoint);
  draft.is_default = false;
  delete draft.api_key;
  delete draft.api_key_env;
  delete draft.has_api_key;
  delete draft.api_key_values;

  if (sourceEndpoint.api_keys?.length) {
    draft.api_keys = [];
    draft.api_key_values = {};
    for (const sourceCredential of sourceEndpoint.api_keys) {
      const nextId = credentialIdFactory();
      draft.api_keys.push({ id: nextId });
      const value = revealedSecrets.credentials?.[sourceCredential.id];
      if (value) draft.api_key_values[nextId] = value;
    }
  } else if (revealedSecrets.single) {
    draft.api_key = revealedSecrets.single;
  }
  return draft;
}
```

Also define modal state and rendering exports in the same file, but keep them dependent on these pure helpers:

```ts
export interface CopyNodeState {
  targetClient: string;
  sourceClient: string;
  sourceEndpointId: string;
}

export function listCopySources(config: AppConfig, targetClient: string) {
  return Object.entries(config.clients || {})
    .filter(([client]) => client !== targetClient)
    .map(([client, value]) => ({ client, endpoints: value.endpoints || [] }));
}
```

- [ ] **Step 5: Run the focused test and panel build**

Run:

```bash
node --test tests/unit/config-panel-copy-node.test.mjs
npm run build:panel
```

Expected: both PASS.

- [ ] **Step 6: Commit the pure copy foundation**

```bash
git add desktop/src/core/types.ts desktop/src/modules/copy-node.ts tests/unit/config-panel-copy-node.test.mjs
git commit -m "feat: add endpoint copy draft model"
```

### Task 2: Extend secret reveal safely and wire the copy modal

**Files:**
- Modify: `server.js`
- Modify: `desktop/src/modules/copy-node.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/app.ts`
- Modify: `desktop/src/styles/panel.css`
- Modify: `tests/unit/config-panel-copy-node.test.mjs`
- Test: `tests/integration/config-secret-routes.test.mjs`

**Interfaces:**
- Extends `GET /v1/config/secret?id=<endpointId>` with optional `credential_id`.
- Produces modal callbacks that return a copy draft; the caller inserts it into the target client and opens the existing editor.

- [ ] **Step 1: Write failing integration tests for credential-scoped reveal**

Create `tests/integration/config-secret-routes.test.mjs` using the existing isolated gateway pattern from `tests/integration/codex-catalog-write.test.mjs`. Cover these exact cases:

```js
test("secret reveal keeps legacy endpoint behavior", async () => {
  const response = await reveal("ep_single");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { api_key: "sk-single" });
});

test("secret reveal returns only the requested credential", async () => {
  const response = await reveal("ep_multi", "cred_b");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    credential_id: "cred_b",
    api_key: "sk-b",
  });
});

test("secret reveal rejects a credential not declared by the endpoint", async () => {
  const response = await reveal("ep_multi", "cred_missing");
  assert.equal(response.status, 404);
});

test("secret reveal still requires explicit reveal intent", async () => {
  const response = await fetch(`${base}/v1/config/secret?id=ep_single`);
  assert.equal(response.status, 403);
});
```

- [ ] **Step 2: Run the route tests and confirm credential reveal fails**

```bash
node --test tests/integration/config-secret-routes.test.mjs
```

Expected: legacy reveal passes; credential-scoped cases fail.

- [ ] **Step 3: Extend the existing route without adding a second full-secret endpoint**

In `server.js`, keep all existing auth and endpoint existence checks. Parse:

```js
const credentialId = String(url.searchParams.get("credential_id") || "").trim();
const endpoint = allGatewayEndpoints().find((item) => item.id === endpointId);
```

When `credentialId` is present:

```js
const declared = endpoint?.api_keys?.some((item) => item?.id === credentialId);
if (!declared) {
  sendPrivateJson(res, 404, {
    error: { type: "credential_not_found", message: "Credential not found." },
  });
  return;
}
const secretKey = `${endpointId}::${credentialId}`;
const credentialIndex = endpoint.api_keys.findIndex((item) => item.id === credentialId);
const storedSecret = String(
  GATEWAY_SECRETS?.api_keys?.[secretKey]
  || (credentialIndex === 0 ? GATEWAY_SECRETS?.api_keys?.[endpointId] : "")
  || "",
);
```

Return:

```js
sendPrivateJson(res, 200, credentialId
  ? { credential_id: credentialId, api_key: storedSecret }
  : { api_key: storedSecret });
```

Do not return every credential in one response.

- [ ] **Step 4: Finish modal rendering and secret loading**

In `desktop/src/modules/copy-node.ts`, add:

```ts
export async function revealEndpointSecrets(endpoint: Endpoint): Promise<RevealedEndpointSecrets> {
  if (!endpoint.id) return {};
  const headers = { "X-Gateway-Secret-Intent": "reveal" };
  if (!endpoint.api_keys?.length) {
    const response = await fetch(`/v1/config/secret?id=${encodeURIComponent(endpoint.id)}`, {
      headers,
      cache: "no-store",
    });
    if (response.status === 404) return {};
    if (!response.ok) throw new Error("读取源节点密钥失败");
    return { single: (await response.json()).api_key || "" };
  }

  const credentials: Record<string, string> = {};
  for (const credential of endpoint.api_keys) {
    const query = new URLSearchParams({
      id: endpoint.id,
      credential_id: credential.id,
    });
    const response = await fetch(`/v1/config/secret?${query}`, {
      headers,
      cache: "no-store",
    });
    if (response.status === 404) continue;
    if (!response.ok) throw new Error("读取源节点密钥失败");
    credentials[credential.id] = (await response.json()).api_key || "";
  }
  return { credentials };
}
```

Render a modal that:

- Excludes the target client from source clients.
- Disables confirm until a source endpoint is selected.
- Shows source name, base URL, type, and capability purpose.
- In Slice A, disables source endpoints with a non-empty `api_keys` array and
  shows `多密钥节点将在多密钥支持启用后可复制`. This guard is removed in Task 7
  only after Task 4 makes `api_key_values` safe to save.
- Closes on overlay click and `Escape`.
- Calls an injected `onConfirm(draft)` callback only after secrets load.
- Leaves the draft unsaved and opens the existing endpoint editor.

- [ ] **Step 5: Wire one copy button into built-in and custom client headers**

In `desktop/index.html`, add the copy button immediately before each built-in
client's `.add-node-dropdown` for `code`, `desktop`, `codex`, and `deeptutor`.

In `desktop/src/app.ts`:

- Add the same button to the custom-client header template immediately before
  its `.add-node-dropdown`.
- Call `openCopyNodeModal(client, config, async (draft) => { ... })`.
- Insert with `unshift`, set `selectedEndpoint = { client, index: 0 }`, close the modal, call `render()`, and focus the name field.
- Do not call `/v1/config/save` from the modal.
- Keep the existing save button as the only persistence action.
- Show a protocol-conversion hint in the detail editor from transient module state, not from a persisted endpoint field.

The insertion callback must be:

```ts
config.clients[targetClient].endpoints ||= [];
config.clients[targetClient].endpoints.unshift(draft);
selectedEndpoint = { client: targetClient, index: 0 };
render();
```

- [ ] **Step 6: Add restrained modal styles**

In `desktop/src/styles/panel.css`, reuse:

- `.section-header-actions`
- `.btn`
- `.add-node-option`
- `.skill-modal` spacing conventions
- existing `--surface`, `--input-bg`, `--border-color`, `--text-primary`, `--text-secondary`

Add classes `.copy-node-trigger`, `.copy-node-overlay`, `.copy-node-modal`, `.copy-node-source-list`, `.copy-node-source-item`, and `.protocol-hint`. Keep radii at the existing 6px/8px scale and add the existing mobile breakpoint at `760px`.

- [ ] **Step 7: Strengthen source-contract tests**

Append assertions:

```js
test("copy UI is preview-first and never auto-saves", async () => {
  const [app, index, module] = await Promise.all([
    readFile(path.join(ROOT, "desktop/src/app.ts"), "utf8"),
    readFile(path.join(ROOT, "desktop/index.html"), "utf8"),
    readFile(path.join(ROOT, "desktop/src/modules/copy-node.ts"), "utf8"),
  ]);
  assert.match(app + index, /复制节点/);
  assert.match(app, /selectedEndpoint\s*=\s*\{\s*client:\s*targetClient,\s*index:\s*0\s*\}/);
  assert.doesNotMatch(module, /\/v1\/config\/save/);
  assert.match(module, /credential_id/);
});
```

- [ ] **Step 8: Run copy tests and build**

```bash
node --test tests/unit/config-panel-copy-node.test.mjs tests/integration/config-secret-routes.test.mjs
npm run build:panel
node --check server.js
```

Expected: all PASS.

- [ ] **Step 9: Commit the copy feature**

```bash
git add server.js desktop/src/modules/copy-node.ts desktop/index.html desktop/src/app.ts desktop/src/styles/panel.css tests/unit/config-panel-copy-node.test.mjs tests/integration/config-secret-routes.test.mjs
git commit -m "feat: add cross-client endpoint copy workflow"
```

### Task 3: Gate Slice A against historical behavior

**Files:**
- Modify only if a regression is found.

- [ ] **Step 1: Run existing config and panel tests**

```bash
node --test tests/unit/gateway-config-store.test.mjs tests/unit/config-panel.test.mjs tests/unit/config-panel-tabs.test.mjs
```

Expected: PASS with no changed legacy assertions.

- [ ] **Step 2: Run protocol integration tests**

```bash
npm run test:adapters
```

Expected: PASS; endpoint copying has not changed routing.

- [ ] **Step 3: Verify the copy payload manually**

Start an isolated gateway:

```bash
GATEWAY_NO_OPEN=1 npm start
```

Verify:

1. Copy a single-key Desktop endpoint to Codex.
2. Confirm the editor opens with a new endpoint ID, `openai-responses`, copied URL/models/mapping/key, and `is_default` false.
3. Edit the URL and save.
4. Reload and confirm the source endpoint is unchanged.
5. Copy a capability endpoint and confirm its pure capability type/purpose/options remain unchanged.

- [ ] **Step 4: Commit only if the gate required fixes**

```bash
git add -A
git commit -m "fix: preserve endpoint copy compatibility"
```

Skip this commit when the tree is clean.

---

## Slice B: Multi-API-Key Persistence and Routing

### Task 4: Add credential helpers and credential-aware save preparation

**Files:**
- Create: `lib/config/credential-store.mjs`
- Modify: `lib/config/gateway-config-store.mjs`
- Test: `tests/unit/credential-store.test.mjs`
- Modify: `tests/unit/gateway-config-store.test.mjs`

**Interfaces:**
- Produces:
  - `createCredentialId()`
  - `credentialSecretKey(endpointId, credentialId)`
  - `parseCredentialSecretKey(value)`
  - `resolveStoredSecret(value, env)`
  - `listEndpointCredentials(endpoint, secrets, env)`
  - `hasStoredEndpointCredential(endpoint, secrets)`
  - `maskApiKey(value)`
  - `getEndpointApiKeyByStrategy(endpoint, secrets, env, allEndpoints, context)`

- [ ] **Step 1: Write failing helper tests**

Create `tests/unit/credential-store.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCredentialId,
  credentialSecretKey,
  listEndpointCredentials,
  hasStoredEndpointCredential,
  maskApiKey,
  parseCredentialSecretKey,
  resolveStoredSecret,
} from "../../lib/config/credential-store.mjs";

test("credential ids are prefixed UUIDs and unique", () => {
  const ids = new Set(Array.from({ length: 100 }, () => createCredentialId()));
  assert.equal(ids.size, 100);
  for (const id of ids) assert.match(id, /^cred_[0-9a-f-]{36}$/);
});

test("credential secret keys round-trip", () => {
  const key = credentialSecretKey("ep_abc", "cred_001");
  assert.equal(key, "ep_abc::cred_001");
  assert.deepEqual(parseCredentialSecretKey(key), {
    endpointId: "ep_abc",
    credentialId: "cred_001",
  });
  assert.equal(parseCredentialSecretKey("ep_abc"), null);
});

test("stored env references resolve without exposing the env name as a key", () => {
  assert.equal(resolveStoredSecret("env:ARK_KEY", { ARK_KEY: "ark-live" }), "ark-live");
  assert.equal(resolveStoredSecret("sk-literal", {}), "sk-literal");
});

test("credential listing follows endpoint order and skips empty values", () => {
  const endpoint = {
    id: "ep_abc",
    api_keys: [{ id: "cred_a" }, { id: "cred_b" }, { id: "cred_c" }],
  };
  const secrets = {
    api_keys: {
      "ep_abc::cred_a": "sk-a",
      "ep_abc::cred_b": "",
      "ep_abc::cred_c": "env:C_KEY",
    },
  };
  assert.deepEqual(listEndpointCredentials(endpoint, secrets, { C_KEY: "sk-c" }), [
    { credentialId: "cred_a", apiKey: "sk-a" },
    { credentialId: "cred_c", apiKey: "sk-c" },
  ]);
});

test("partial migration maps the legacy endpoint secret to the first credential", () => {
  const endpoint = {
    id: "ep_abc",
    api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
  };
  const secrets = { api_keys: { ep_abc: "sk-legacy" } };
  assert.deepEqual(listEndpointCredentials(endpoint, secrets, {}), [
    { credentialId: "cred_a", apiKey: "sk-legacy" },
  ]);
});

test("stored credential presence counts env references without resolving them", () => {
  const endpoint = { id: "ep_env", api_keys: [{ id: "cred_env" }] };
  const secrets = { api_keys: { "ep_env::cred_env": "env:MISSING_KEY" } };
  assert.equal(hasStoredEndpointCredential(endpoint, secrets), true);
});

test("masking shows four leading and three trailing characters", () => {
  assert.equal(maskApiKey("ark-abcdefXYZ"), "ark-...XYZ");
  assert.equal(maskApiKey("short"), "****");
});
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

```bash
node --test tests/unit/credential-store.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the pure credential helpers**

Create `lib/config/credential-store.mjs`:

```js
import crypto from "node:crypto";

export function createCredentialId() {
  return `cred_${crypto.randomUUID()}`;
}

export function credentialSecretKey(endpointId, credentialId) {
  return `${endpointId}::${credentialId}`;
}

export function parseCredentialSecretKey(value) {
  const match = /^(.+)::([^:]+)$/.exec(String(value || ""));
  return match ? { endpointId: match[1], credentialId: match[2] } : null;
}

export function resolveStoredSecret(value, env = process.env) {
  const stored = String(value || "");
  if (!stored) return "";
  return stored.startsWith("env:") ? String(env[stored.slice(4)] || "") : stored;
}

export function listEndpointCredentials(endpoint, secrets, env = process.env) {
  const metadata = Array.isArray(endpoint?.api_keys) ? endpoint.api_keys : [];
  const values = secrets?.api_keys || {};
  return metadata.flatMap((credential, index) => {
    const scoped = values[credentialSecretKey(endpoint.id, credential.id)];
    const stored = scoped || (index === 0 ? values[endpoint.id] : "");
    const apiKey = resolveStoredSecret(stored, env);
    return apiKey ? [{ credentialId: credential.id, apiKey }] : [];
  });
}

export function hasStoredEndpointCredential(endpoint, secrets) {
  const values = secrets?.api_keys || {};
  return (endpoint?.api_keys || []).some((credential, index) =>
    Boolean(
      values[credentialSecretKey(endpoint.id, credential.id)]
      || (index === 0 ? values[endpoint.id] : ""),
    ));
}

export function maskApiKey(value) {
  const text = String(value || "");
  return text.length < 8 ? "****" : `${text.slice(0, 4)}...${text.slice(-3)}`;
}
```

- [ ] **Step 4: Add failing persistence tests**

Append to `tests/unit/gateway-config-store.test.mjs`:

```js
test("save migrates a legacy key and extracts transient multi-key values", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "gateway-multi-key-"));
  const configPath = path.join(root, "gateway.config.json");
  const secretsPath = path.join(root, "gateway.secrets.json");
  try {
    writeFileSync(secretsPath, JSON.stringify({
      api_keys: { ep_multi: "sk-old" },
    }));
    const result = saveGatewayState({
      configPath,
      secretsPath,
      config: {
        clients: {
          desktop: {
            endpoints: [{
              id: "ep_multi",
              name: "Multi",
              api_keys: [{ id: "cred_a" }, { id: "cred_b" }],
              key_strategy: "failover",
              api_key_values: { cred_b: "sk-new" },
              has_api_key: true,
            }],
          },
        },
      },
    });
    const endpoint = result.config.clients.desktop.endpoints[0];
    assert.deepEqual(endpoint.api_keys, [{ id: "cred_a" }, { id: "cred_b" }]);
    assert.equal(endpoint.key_strategy, "failover");
    assert.equal("api_key_values" in endpoint, false);
    assert.equal("has_api_key" in endpoint, false);
    assert.deepEqual(result.secrets.api_keys, {
      "ep_multi::cred_a": "sk-old",
      "ep_multi::cred_b": "sk-new",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save prunes removed credentials without pruning active scoped credentials", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "gateway-prune-credentials-"));
  const configPath = path.join(root, "gateway.config.json");
  const secretsPath = path.join(root, "gateway.secrets.json");
  try {
    writeFileSync(secretsPath, JSON.stringify({
      api_keys: {
        "ep_multi::cred_a": "sk-a",
        "ep_multi::cred_b": "sk-b",
        ep_single: "sk-single",
      },
    }));
    const result = saveGatewayState({
      configPath,
      secretsPath,
      config: {
        clients: {
          desktop: {
            endpoints: [
              { id: "ep_multi", name: "Multi", api_keys: [{ id: "cred_b" }] },
              { id: "ep_single", name: "Single" },
            ],
          },
        },
      },
    });
    assert.deepEqual(result.secrets.api_keys, {
      "ep_multi::cred_b": "sk-b",
      ep_single: "sk-single",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("multi-key migration is idempotent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "gateway-multi-idempotent-"));
  const configPath = path.join(root, "gateway.config.json");
  const secretsPath = path.join(root, "gateway.secrets.json");
  try {
    const config = {
      clients: {
        desktop: {
          endpoints: [{
            id: "ep_multi",
            name: "Multi",
            api_keys: [{ id: "cred_a" }],
            key_strategy: "failover",
            api_key_values: { cred_a: "sk-a" },
          }],
        },
      },
    };
    const first = saveGatewayState({ configPath, secretsPath, config });
    const second = saveGatewayState({
      configPath,
      secretsPath,
      config: first.config,
    });
    assert.equal(second.configChanged, false);
    assert.equal(second.secretsChanged, false);
    assert.deepEqual(second.secrets, first.secrets);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("legacy save behavior remains unchanged when api_keys is absent", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "gateway-legacy-key-"));
  const configPath = path.join(root, "gateway.config.json");
  const secretsPath = path.join(root, "gateway.secrets.json");
  try {
    const result = saveGatewayState({
      configPath,
      secretsPath,
      config: {
        clients: {
          desktop: {
            endpoints: [{
              id: "ep_legacy",
              name: "Legacy",
              api_key: "sk-legacy",
            }],
          },
        },
      },
    });
    assert.deepEqual(result.secrets.api_keys, { ep_legacy: "sk-legacy" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
```

Use real temporary files as existing tests do; do not mock the filesystem for these transformations.

- [ ] **Step 5: Make `prepareState` credential-aware**

In `lib/config/gateway-config-store.mjs`:

1. Import `credentialSecretKey` and `parseCredentialSecretKey`.
2. Extend the final `prepareState` options with
   `migrateCredentialSecrets = false`.
3. Keep current single-key extraction unchanged in the `else` branch.
4. For `endpoint.api_keys?.length > 0`:

```js
const credentials = endpoint.api_keys
  .map((item) => ({ id: String(item?.id || "").trim() }))
  .filter((item) => item.id);
endpoint.api_keys = credentials;
endpoint.key_strategy ||= "failover";

const submitted = endpoint.api_key_values && typeof endpoint.api_key_values === "object"
  ? endpoint.api_key_values
  : {};
const oldValue = apiKeys[endpoint.id];
if (migrateCredentialSecrets && oldValue && credentials[0]) {
  apiKeys[credentialSecretKey(endpoint.id, credentials[0].id)] ||= oldValue;
  delete apiKeys[endpoint.id];
}
for (const credential of credentials) {
  const value = typeof submitted[credential.id] === "string"
    ? submitted[credential.id]
    : "";
  if (value) apiKeys[credentialSecretKey(endpoint.id, credential.id)] = value;
}
```

5. Delete transient fields after extraction:

```js
delete endpoint.api_key;
delete endpoint.api_key_env;
delete endpoint.api_key_values;
delete endpoint.has_api_key;
```

6. Replace exact-ID pruning with credential-aware pruning:

```js
const activeCredentials = new Map();
for (const credential of credentials) {
  if (!activeCredentials.has(endpoint.id)) {
    activeCredentials.set(endpoint.id, new Set());
  }
  activeCredentials.get(endpoint.id).add(credential.id);
}

for (const secretKey of Object.keys(apiKeys)) {
  const parsed = parseCredentialSecretKey(secretKey);
  if (!parsed) {
    if (!endpointIds.has(secretKey)) delete apiKeys[secretKey];
    continue;
  }
  const allowed = activeCredentials.get(parsed.endpointId);
  if (!allowed?.has(parsed.credentialId)) delete apiKeys[secretKey];
}
```

Pass `migrateCredentialSecrets: true` only from `saveGatewayState`. Leave
`loadGatewayState` at the default `false`, so loading a partially migrated
configuration neither rejects it nor silently rewrites secrets during startup.

- [ ] **Step 6: Preserve crash recovery around the two files**

In `saveGatewayState`:

- Detect whether an endpoint-level secret is being migrated to scoped credentials.
- Create a backup of `gateway.secrets.json` before the first such migration when the file exists.
- Keep write order config first, secrets second.
- Return `secretsBackupPath` for tests and diagnostics.
- Do not claim cross-file atomicity.

Add this storage adapter beside the existing file helpers:

```js
export const defaultGatewayStorage = Object.freeze({
  readJson,
  writeJson: writeJsonIfChanged,
  exists: (filePath) => fs.existsSync(filePath),
  backup: createBackup,
});
```

Extend the options destructuring without changing existing callers:

```js
export function saveGatewayState({
  configPath,
  secretsPath = defaultSecretsPath(configPath),
  config,
  idFactory = createEndpointId,
  officialCodexIds = new Set(),
  storage = defaultGatewayStorage,
} = {}) {
```

Use `storage.readJson`, `storage.writeJson`, `storage.exists`, and
`storage.backup` inside this function. No other config-store function needs
dependency injection.

Add a test where `writeJsonIfChanged` is injected through an optional internal `storage` argument and throws on the secrets write:

```js
assert.throws(() => saveGatewayState({
  configPath,
  secretsPath,
  config,
  storage: {
    ...defaultGatewayStorage,
    writeJson(filePath, value, mode) {
      if (filePath === secretsPath) throw new Error("injected secrets write failure");
      return defaultGatewayStorage.writeJson(filePath, value, mode);
    },
  },
}));
assert.ok(JSON.parse(readFileSync(configPath, "utf8")).clients.desktop.endpoints[0].api_keys);
assert.equal(JSON.parse(readFileSync(secretsPath, "utf8")).api_keys.ep_multi, "sk-old");
assert.equal(
  listEndpointCredentials(
    JSON.parse(readFileSync(configPath, "utf8")).clients.desktop.endpoints[0],
    JSON.parse(readFileSync(secretsPath, "utf8")),
    {},
  )[0].apiKey,
  "sk-old",
);
```

Expose `defaultGatewayStorage` only for testing; production callers continue using the same `saveGatewayState({...})` call.

- [ ] **Step 7: Run credential and config-store tests**

```bash
node --test tests/unit/credential-store.test.mjs tests/unit/gateway-config-store.test.mjs
```

Expected: PASS, including all pre-existing tests.

- [ ] **Step 8: Commit persistence support**

```bash
git add lib/config/credential-store.mjs lib/config/gateway-config-store.mjs tests/unit/credential-store.test.mjs tests/unit/gateway-config-store.test.mjs
git commit -m "feat: persist endpoint credential sets compatibly"
```

### Task 5: Add metadata validation, public status, and masked previews

**Files:**
- Modify: `lib/config/gateway-config-store.mjs`
- Modify: `server.js`
- Modify: `tests/unit/gateway-config-store.test.mjs`
- Modify: `tests/integration/config-secret-routes.test.mjs`

**Interfaces:**
- Produces `GET /v1/config/secret-preview?id=<endpointId>`.
- Keeps `/v1/config` secret-free while exposing credential IDs and accurate `has_api_key`.

- [ ] **Step 1: Add failing validation tests**

Append:

```js
test("validation accepts legacy endpoints without api_keys", () => {
  const issues = validateGatewayConfig({
    clients: { desktop: { endpoints: [{ id: "ep_legacy", name: "Legacy" }] } },
  });
  assert.equal(issues.some((item) => item.code.startsWith("credential_")), false);
});

test("validation rejects empty and duplicate credential ids", () => {
  const issues = validateGatewayConfig({
    clients: {
      desktop: {
        endpoints: [{
          id: "ep_multi",
          name: "Multi",
          api_keys: [{ id: "cred_a" }, { id: "" }, { id: "cred_a" }],
        }],
      },
    },
  });
  assert.ok(issues.some((item) => item.code === "empty_credential_id"));
  assert.ok(issues.some((item) => item.code === "duplicate_credential_id"));
});

test("validation rejects an explicitly empty api_keys array", () => {
  const issues = validateGatewayConfig({
    clients: {
      desktop: {
        endpoints: [{ id: "ep_multi", name: "Multi", api_keys: [] }],
      },
    },
  });
  assert.ok(issues.some((item) => item.code === "empty_api_keys"));
});

test("validation rejects unsupported key strategies only when present", () => {
  const issues = validateGatewayConfig({
    clients: {
      desktop: {
        endpoints: [{
          id: "ep_multi",
          name: "Multi",
          api_keys: [{ id: "cred_a" }],
          key_strategy: "weighted",
        }],
      },
    },
  });
  assert.ok(issues.some((item) => item.code === "invalid_key_strategy"));
});
```

- [ ] **Step 2: Add format-only validation**

Inside the existing endpoint validation loop:

```js
if (Array.isArray(endpoint.api_keys)) {
  if (endpoint.api_keys.length === 0) {
    issues.push({ code: "empty_api_keys", client: clientName, endpoint_id: endpoint.id });
  }
  const seen = new Set();
  for (const credential of endpoint.api_keys) {
    const id = String(credential?.id || "").trim();
    if (!id) issues.push({ code: "empty_credential_id", client: clientName, endpoint_id: endpoint.id });
    else if (seen.has(id)) issues.push({ code: "duplicate_credential_id", client: clientName, endpoint_id: endpoint.id, credential_id: id });
    seen.add(id);
  }
}
if (
  endpoint.key_strategy != null
  && !["failover", "round-robin", "random"].includes(endpoint.key_strategy)
) {
  issues.push({ code: "invalid_key_strategy", client: clientName, endpoint_id: endpoint.id });
}
```

Do not inspect secrets in `validateGatewayConfig`.

- [ ] **Step 3: Write failing preview and public-config integration tests**

Add cases:

```js
test("secret preview masks every declared credential without returning values", async () => {
  const response = await preview("ep_multi");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    credentials: [
      { id: "cred_a", configured: true, preview: "sk-a...AAA" },
      { id: "cred_b", configured: true, preview: "sk-b...BBB" },
    ],
  });
});

test("public config reports multi-key status but contains no secret values", async () => {
  const response = await fetch(`${base}/v1/config`);
  const payload = await response.json();
  const endpoint = payload.clients.desktop.endpoints.find((item) => item.id === "ep_multi");
  assert.equal(endpoint.has_api_key, true);
  assert.deepEqual(endpoint.api_keys, [{ id: "cred_a" }, { id: "cred_b" }]);
  assert.equal(JSON.stringify(payload).includes("sk-a"), false);
});
```

- [ ] **Step 4: Implement preview and accurate status**

In `server.js` import:

```js
import {
  hasStoredEndpointCredential,
  listEndpointCredentials,
  maskApiKey,
} from "./lib/config/credential-store.mjs";
```

For `publicGatewayConfig`, set:

```js
endpoint.has_api_key = endpoint.api_keys?.length
  ? hasStoredEndpointCredential(endpoint, GATEWAY_SECRETS)
  : Boolean(GATEWAY_SECRETS?.api_keys?.[endpoint.id]);
if (endpoint.api_keys) {
  endpoint.api_keys = endpoint.api_keys.map((credential) => ({ id: credential.id }));
}
delete endpoint.api_key;
delete endpoint.api_key_env;
delete endpoint.api_key_values;
```

Add `GET /v1/config/secret-preview` beside the existing reveal route:

- Require local auth and `x-gateway-secret-intent: reveal`.
- Resolve the endpoint by ID.
- Return entries in metadata order.
- Set `configured` from the stored scoped value, or from the legacy endpoint
  value for the first credential during partial migration.
- Resolve `env:` references only for masking. If the referenced environment
  variable is absent, return `preview: "****"` without exposing the variable
  name.
- Return `{ configured: false, preview: "****" }` for an empty declared credential.
- Never include `api_key`, stored `env:` references, or undeclared orphan secrets.

- [ ] **Step 5: Run validation and route tests**

```bash
node --test tests/unit/gateway-config-store.test.mjs tests/integration/config-secret-routes.test.mjs
node --check server.js
```

Expected: PASS.

- [ ] **Step 6: Commit validation and preview support**

```bash
git add lib/config/gateway-config-store.mjs server.js tests/unit/gateway-config-store.test.mjs tests/integration/config-secret-routes.test.mjs
git commit -m "feat: expose safe endpoint credential metadata"
```

### Task 6: Implement the extensible key-strategy registry

**Files:**
- Create: `lib/config/key-strategy.mjs`
- Modify: `lib/config/gateway-config-store.mjs`
- Test: `tests/unit/key-strategy.test.mjs`

**Interfaces:**
- Produces:
  - `createKeyStrategyRegistry({ counterStore, random })`
  - `defaultKeyStrategyRegistry`
  - `selectEndpointCredential(endpoint, secrets, env, context, registry)`

- [ ] **Step 1: Write deterministic failing tests**

Create `tests/unit/key-strategy.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  createKeyStrategyRegistry,
  selectEndpointCredential,
} from "../../lib/config/key-strategy.mjs";

const endpoint = {
  id: "ep_multi",
  api_keys: [{ id: "cred_a" }, { id: "cred_b" }, { id: "cred_c" }],
};
const secrets = {
  api_keys: {
    "ep_multi::cred_a": "sk-a",
    "ep_multi::cred_b": "sk-b",
    "ep_multi::cred_c": "sk-c",
  },
};

test("failover is default and selects by attempt", () => {
  assert.deepEqual(selectEndpointCredential(endpoint, secrets, {}, { attempt: 0 }), {
    credentialId: "cred_a",
    apiKey: "sk-a",
  });
  assert.deepEqual(selectEndpointCredential(endpoint, secrets, {}, { attempt: 1 }), {
    credentialId: "cred_b",
    apiKey: "sk-b",
  });
});

test("round-robin advances per endpoint and resets with an injected store", () => {
  const registry = createKeyStrategyRegistry({ counterStore: new Map(), random: () => 0 });
  const rr = { ...endpoint, key_strategy: "round-robin" };
  assert.equal(selectEndpointCredential(rr, secrets, {}, {}, registry).credentialId, "cred_a");
  assert.equal(selectEndpointCredential(rr, secrets, {}, {}, registry).credentialId, "cred_b");
  assert.equal(selectEndpointCredential(rr, secrets, {}, {}, registry).credentialId, "cred_c");
});

test("random uses injected RNG", () => {
  const registry = createKeyStrategyRegistry({
    counterStore: new Map(),
    random: () => 0.6,
  });
  const selected = selectEndpointCredential(
    { ...endpoint, key_strategy: "random" },
    secrets,
    {},
    {},
    registry,
  );
  assert.equal(selected.credentialId, "cred_b");
});

test("selection skips missing credentials and returns an empty result when none resolve", () => {
  assert.deepEqual(
    selectEndpointCredential(endpoint, { api_keys: {} }, {}, {}),
    { credentialId: null, apiKey: "" },
  );
});

test("new strategies can be registered without changing selection dispatch", () => {
  const registry = createKeyStrategyRegistry({ counterStore: new Map(), random: () => 0 });
  registry.register("last", ({ credentials }) => credentials.at(-1));
  const selected = registry.select("last", {
    endpoint,
    credentials: [
      { credentialId: "cred_a", apiKey: "sk-a" },
      { credentialId: "cred_b", apiKey: "sk-b" },
    ],
    context: {},
  });
  assert.equal(selected.credentialId, "cred_b");
});
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

```bash
node --test tests/unit/key-strategy.test.mjs
```

- [ ] **Step 3: Implement registry-based selection**

Create `lib/config/key-strategy.mjs`:

```js
import { listEndpointCredentials } from "./credential-store.mjs";

export function createKeyStrategyRegistry({
  counterStore = new Map(),
  random = Math.random,
} = {}) {
  const strategies = new Map();
  const api = {
    register(name, selector) {
      strategies.set(name, selector);
      return api;
    },
    select(name, input) {
      const selector = strategies.get(name) || strategies.get("failover");
      return selector?.(input) || { credentialId: null, apiKey: "" };
    },
  };

  api.register("failover", ({ credentials, context }) =>
    credentials[Number(context?.attempt || 0)] || { credentialId: null, apiKey: "" });

  api.register("round-robin", ({ endpoint, credentials }) => {
    if (!credentials.length) return { credentialId: null, apiKey: "" };
    const next = counterStore.get(endpoint.id) || 0;
    counterStore.set(endpoint.id, (next + 1) % credentials.length);
    return credentials[next % credentials.length];
  });

  api.register("random", ({ credentials }) => {
    if (!credentials.length) return { credentialId: null, apiKey: "" };
    return credentials[Math.floor(random() * credentials.length)];
  });

  return api;
}

export const defaultKeyStrategyRegistry = createKeyStrategyRegistry();

export function selectEndpointCredential(
  endpoint,
  secrets,
  env = process.env,
  context = {},
  registry = defaultKeyStrategyRegistry,
) {
  const credentials = listEndpointCredentials(endpoint, secrets, env);
  return registry.select(endpoint?.key_strategy || "failover", {
    endpoint,
    credentials,
    context,
  });
}
```

- [ ] **Step 4: Add the strategy wrapper without changing the legacy getter**

Import `selectEndpointCredential` in `gateway-config-store.mjs`. Leave the
existing `getEndpointApiKey` function untouched and add immediately after it:

```js
export function getEndpointApiKeyByStrategy(
  endpoint,
  secrets,
  env = process.env,
  allEndpoints = [],
  context = {},
) {
  if (!endpoint?.api_keys?.length) {
    return {
      apiKey: getEndpointApiKey(endpoint, secrets, env, allEndpoints),
      credentialId: null,
    };
  }
  return selectEndpointCredential(endpoint, secrets, env, context);
}
```

Append to `tests/unit/key-strategy.test.mjs`:

```js
import {
  getEndpointApiKey,
  getEndpointApiKeyByStrategy,
} from "../../lib/config/gateway-config-store.mjs";

test("strategy wrapper keeps the legacy single-key lookup result", () => {
  const endpoint = { id: "ep_single" };
  const secrets = { api_keys: { ep_single: "sk-single" } };
  assert.equal(getEndpointApiKey(endpoint, secrets, {}, []), "sk-single");
  assert.deepEqual(
    getEndpointApiKeyByStrategy(endpoint, secrets, {}, [], {}),
    { credentialId: null, apiKey: "sk-single" },
  );
});
```

- [ ] **Step 5: Run strategy and config tests**

```bash
node --test tests/unit/key-strategy.test.mjs tests/unit/credential-store.test.mjs tests/unit/gateway-config-store.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit the strategy layer**

```bash
git add lib/config/key-strategy.mjs lib/config/gateway-config-store.mjs tests/unit/key-strategy.test.mjs
git commit -m "feat: add extensible endpoint key strategies"
```

### Task 7: Build the multi-key editor and transient save payload

**Files:**
- Create: `desktop/src/modules/multi-key-editor.ts`
- Modify: `desktop/src/app.ts`
- Modify: `desktop/src/styles/panel.css`
- Modify: `tests/unit/config-panel.test.mjs`
- Test: `tests/unit/config-panel-multi-key.test.mjs`

**Interfaces:**
- Produces:
  - `supportsMultiKeyRuntime(endpoint)`
  - `renderEndpointKeyEditor(client, index, endpoint)`
  - `addCredential(endpoint)`
  - `removeCredential(endpoint, credentialId)`
  - `setCredentialValue(endpoint, credentialId, value)`
  - `loadCredentialPreviews(endpoint)`

- [ ] **Step 1: Write failing UI source-contract tests**

Create `tests/unit/config-panel-multi-key.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(".");

test("multi-key editor is isolated and keeps single-key fallback", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/modules/multi-key-editor.ts"),
    "utf8",
  ).catch(() => "");
  assert.match(source, /endpoint\.api_keys\?\.length/);
  assert.match(source, /添加更多密钥/);
  assert.match(source, /故障转移/);
  assert.match(source, /轮询/);
  assert.match(source, /随机/);
  assert.match(source, /secret-preview/);
});

test("transient values are removed after a successful save", async () => {
  const source = await readFile(path.join(ROOT, "desktop/src/app.ts"), "utf8");
  assert.match(source, /delete endpoint\.api_key_values/);
});

test("unsupported capability runtimes do not advertise multi-key routing", async () => {
  const source = await readFile(
    path.join(ROOT, "desktop/src/modules/multi-key-editor.ts"),
    "utf8",
  ).catch(() => "");
  assert.match(source, /supportsMultiKeyRuntime/);
  assert.match(source, /purpose/);
});
```

- [ ] **Step 2: Run the tests and confirm the module is missing**

```bash
node --test tests/unit/config-panel-multi-key.test.mjs
```

- [ ] **Step 3: Implement editor-state helpers**

Create `desktop/src/modules/multi-key-editor.ts`:

```ts
import type { Endpoint, KeyStrategy } from "../core/types";

const SUPPORTED_TYPES = new Set(["anthropic", "openai-chat", "openai-responses"]);
const pendingLegacyCredentialIds = new WeakMap<Endpoint, string>();

export function supportsMultiKeyRuntime(endpoint: Endpoint): boolean {
  const purpose = String(endpoint.purpose || "");
  return SUPPORTED_TYPES.has(endpoint.type)
    && (!purpose || purpose === "vision_fallback");
}

export function addCredential(endpoint: Endpoint): string {
  endpoint.api_keys ||= [];
  if (endpoint.api_keys.length === 0) {
    const firstId = `cred_${crypto.randomUUID()}`;
    endpoint.api_keys.push({ id: firstId });
    endpoint.key_strategy = "failover";
    if (endpoint.has_api_key) pendingLegacyCredentialIds.set(endpoint, firstId);
    const currentValue = String(endpoint.api_key || "");
    if (currentValue) {
      endpoint.api_key_values ||= {};
      endpoint.api_key_values[firstId] = currentValue;
      delete endpoint.api_key;
    }
  }
  const id = `cred_${crypto.randomUUID()}`;
  endpoint.api_keys.push({ id });
  endpoint.api_key_values ||= {};
  return id;
}

export function removeCredential(endpoint: Endpoint, credentialId: string): boolean {
  if (!endpoint.api_keys || endpoint.api_keys.length <= 1) return false;
  if (pendingLegacyCredentialIds.get(endpoint) === credentialId) return false;
  endpoint.api_keys = endpoint.api_keys.filter((item) => item.id !== credentialId);
  if (endpoint.api_key_values) delete endpoint.api_key_values[credentialId];
  return true;
}

export function setCredentialValue(
  endpoint: Endpoint,
  credentialId: string,
  value: string,
): void {
  endpoint.api_key_values ||= {};
  endpoint.api_key_values[credentialId] = value;
}

export function setKeyStrategy(endpoint: Endpoint, strategy: KeyStrategy): void {
  endpoint.key_strategy = strategy;
}
```

The renderer must:

- Return the existing single-key markup unchanged when `api_keys?.length` is false.
- Show `添加更多密钥` only when `supportsMultiKeyRuntime(endpoint)` is true.
- Render strategy choices as a segmented/radio control.
- Render each row with stable grid columns, masked preview, password input, eye icon, and trash icon.
- Disable deleting the last credential and provide a tooltip explaining why.
- Disable deleting the first migration credential until the first successful
  save when it represents an existing endpoint-level secret. The module-level
  `WeakMap` above tracks this without adding a persisted field.
- Treat empty edited input as “preserve stored value”; deleting the credential is the explicit removal action.
- Display configured counts from preview response, not from metadata length.

Before calling `addCredential`, the `window.addApiKey` handler must read the
current single-key input value into `endpoint.api_key`. This preserves a key
the user typed but has not saved yet. If the field is empty and
`endpoint.has_api_key` is true, leave `endpoint.api_key` absent; the server
migrates the stored endpoint-level secret into the first credential on save.

- [ ] **Step 4: Wire editor actions into existing app patterns**

In `desktop/src/app.ts`:

- Replace only the API-key form block with `renderEndpointKeyEditor(...)`.
- Add `window.addApiKey`, `window.removeApiKey`, `window.updateApiKey`, `window.setKeyStrategy`, and `window.toggleMultiKeyVisibility`.
- Call `loadCredentialPreviews` after opening or re-rendering a multi-key endpoint.
- Remove Task 2's `api_keys?.length` copy-source guard. Multi-key source
  endpoints are now enabled because the target draft's `api_key_values` will
  be extracted by Task 4's save path.
- On save success:

```ts
if (endpoint.api_key) endpoint.has_api_key = true;
if (endpoint.api_key_values) endpoint.has_api_key = true;
delete endpoint.api_key;
delete endpoint.api_key_env;
delete endpoint.api_key_values;
```

- Reload `/v1/config` after a successful node save so `has_api_key` and preview state reflect server truth, while preserving `selectedEndpoint` by endpoint ID.
  Replacing the endpoint object from that response also clears the `WeakMap`
  migration guard, so the credential can be deleted in a later save.

- [ ] **Step 5: Add panel styles**

Add `.strategy-selector`, `.strategy-option`, `.multi-key-list`, `.multi-key-row`, `.multi-key-preview`, `.multi-key-input`, `.multi-key-actions`, and `.add-key-btn`.

Use:

```css
.multi-key-row {
  display: grid;
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr) 32px 32px;
  align-items: center;
  gap: 8px;
}

@media (max-width: 760px) {
  .strategy-selector { grid-template-columns: 1fr; }
  .multi-key-row { grid-template-columns: 1fr 32px 32px; }
  .multi-key-preview { grid-column: 1 / -1; }
}
```

Do not introduce a new accent palette, nested cards, or instructional feature prose.

- [ ] **Step 6: Run panel tests and build**

```bash
node --test tests/unit/config-panel.test.mjs tests/unit/config-panel-multi-key.test.mjs tests/unit/config-panel-copy-node.test.mjs
npm run build:panel
```

Expected: PASS.

- [ ] **Step 7: Commit the multi-key UI**

```bash
git add desktop/src/modules/multi-key-editor.ts desktop/src/app.ts desktop/src/styles/panel.css tests/unit/config-panel.test.mjs tests/unit/config-panel-multi-key.test.mjs
git commit -m "feat: add endpoint multi-key editor"
```

### Task 8: Add bounded failover and integrate both configured upstream paths

**Files:**
- Modify: `lib/upstream-retry.mjs`
- Modify: `server.js`
- Modify: `tests/unit/upstream-retry.test.mjs`
- Test: `tests/integration/multi-key-routing.test.mjs`

**Interfaces:**
- Produces:
  - `MULTI_KEY_RETRY_LIMITS`
  - `shouldFailoverCredential(response)`
  - `runCredentialFailover({ credentials, request, parentSignal, limits, clock })`
- Integrates only through `fetchConfiguredAnthropic` and `fetchConfiguredOpenAI`.

- [ ] **Step 1: Write failing retry-runner tests**

Append to `tests/unit/upstream-retry.test.mjs`:

```js
test("credential failover retries 429 and every 5xx but not deterministic quota", async () => {
  assert.equal(await shouldFailoverCredential(new Response("", { status: 500 })), true);
  assert.equal(await shouldFailoverCredential(new Response("", { status: 529 })), true);
  assert.equal(await shouldFailoverCredential(new Response("", { status: 400 })), false);
  assert.equal(await shouldFailoverCredential(new Response(JSON.stringify({
    error: { code: "AccountQuotaExceeded" },
  }), { status: 429 })), true);
});

test("credential failover stops after min(key count, 3)", async () => {
  const seen = [];
  const response = await runCredentialFailover({
    credentials: [
      { credentialId: "a", apiKey: "key-a" },
      { credentialId: "b", apiKey: "key-b" },
      { credentialId: "c", apiKey: "key-c" },
      { credentialId: "d", apiKey: "key-d" },
    ],
    request: async ({ credential }) => {
      seen.push(credential.credentialId);
      return new Response("", { status: 503 });
    },
    limits: { perAttemptMs: 50, maxAttempts: 3, totalMs: 200 },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(seen, ["a", "b", "c"]);
});

test("credential failover moves on after network errors", async () => {
  const seen = [];
  const response = await runCredentialFailover({
    credentials: [
      { credentialId: "a", apiKey: "key-a" },
      { credentialId: "b", apiKey: "key-b" },
    ],
    request: async ({ credential }) => {
      seen.push(credential.credentialId);
      if (credential.credentialId === "a") throw new Error("socket closed");
      return new Response("ok", { status: 200 });
    },
    limits: { perAttemptMs: 50, maxAttempts: 3, totalMs: 200 },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ["a", "b"]);
});

test("credential failover enforces per-attempt and total deadlines", async () => {
  const started = Date.now();
  await assert.rejects(() => runCredentialFailover({
    credentials: [
      { credentialId: "a", apiKey: "key-a" },
      { credentialId: "b", apiKey: "key-b" },
    ],
    request: ({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(
        Object.assign(new Error("aborted"), { name: "AbortError" }),
      ));
    }),
    limits: { perAttemptMs: 20, maxAttempts: 3, totalMs: 35 },
  }));
  assert.ok(Date.now() - started < 150);
});
```

- [ ] **Step 2: Implement the reusable runner**

In `lib/upstream-retry.mjs`:

```js
export const MULTI_KEY_RETRY_LIMITS = Object.freeze({
  perAttemptMs: 15_000,
  maxAttempts: 3,
  totalMs: 30_000,
});

export async function shouldFailoverCredential(response) {
  const status = Number(response?.status || 0);
  if (status >= 500 && status <= 599) return true;
  return status === 429;
}
```

Implement `runCredentialFailover` so it:

- Uses at most `Math.min(credentials.length, limits.maxAttempts)`.
- Creates one `AbortController` per credential.
- Mirrors `parentSignal` into the attempt controller.
- Aborts at `min(perAttemptMs, remainingTotalMs)`.
- Returns the first response that does not satisfy `shouldFailoverCredential`.
- Rotates after retryable responses, network errors, and attempt timeouts.
- Returns the final retryable response when responses were received.
- Throws the final error when every attempt failed before a response.
- Clears timers and parent listeners in `finally`.

Use an injected `clock` object:

```js
const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
};
```

This keeps deadline tests deterministic without changing production limits.

- [ ] **Step 3: Write failing Anthropic and OpenAI integration tests**

Create `tests/integration/multi-key-routing.test.mjs` with an isolated mock upstream that records auth headers.

Cover:

```js
test("Anthropic configured endpoint fails over from first key to second", async () => {
  const fixture = await startMultiKeyFixture(t, {
    protocol: "anthropic",
    auth: "x-api-key",
    strategy: "failover",
    onRequest({ apiKey, response }) {
      response.writeHead(apiKey === "key-a" ? 503 : 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(anthropicPayload()));
    },
  });
  const response = await fixture.post("/desktop/v1/messages", {
    model: "claude-test",
    max_tokens: 16,
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.seenApiKeys, ["key-a", "key-b"]);
});

test("OpenAI configured endpoint fails over from first key to second", async () => {
  const fixture = await startMultiKeyFixture(t, {
    protocol: "openai-chat",
    auth: "bearer",
    strategy: "failover",
    onRequest({ apiKey, response }) {
      response.writeHead(apiKey === "key-a" ? 429 : 200, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(chatCompletionPayload()));
    },
  });
  const response = await fixture.post("/v1/chat/completions", {
    model: "gpt-test",
    messages: [{ role: "user", content: "hi" }],
  });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.seenApiKeys, ["key-a", "key-b"]);
});

test("round-robin starts consecutive requests on different keys", async () => {
  const fixture = await startMultiKeyFixture(t, {
    protocol: "openai-chat",
    strategy: "round-robin",
  });
  assert.equal((await fixture.postChat()).status, 200);
  assert.equal((await fixture.postChat()).status, 200);
  assert.deepEqual(fixture.seenApiKeys.slice(0, 2), ["key-a", "key-b"]);
});

test("random selects one configured key and never logs API key values", async () => {
  const fixture = await startMultiKeyFixture(t, {
    protocol: "openai-chat",
    strategy: "random",
  });
  assert.equal((await fixture.postChat()).status, 200);
  assert.ok(["key-a", "key-b"].includes(fixture.seenApiKeys[0]));
  assert.equal(fixture.logs.includes("key-a"), false);
  assert.equal(fixture.logs.includes("key-b"), false);
});

test("single-key endpoint preserves caller auth fallback and existing retries", async () => {
  const fixture = await startLegacyFixture(t, {
    responses: [503, 200],
    configuredKey: "legacy-key",
  });
  const response = await fixture.postChat({
    authorization: "Bearer caller-key",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(fixture.seenApiKeys, ["legacy-key", "legacy-key"]);
});
```

Define `startMultiKeyFixture`, `startLegacyFixture`, `anthropicPayload`, and
`chatCompletionPayload` in the same test file by extracting the spawn,
temporary-config, health-wait, and mock-upstream helpers already used in
`tests/integration/protocol-adapters.test.mjs`. Each fixture must register
`t.after(...)` cleanup before returning.

Use `REQUEST_TIMEOUT_MS=1000` in the spawned gateway environment so a failed test cannot hang.

- [ ] **Step 4: Add explicit multi-key branches to both request functions**

At the top of `fetchConfiguredAnthropic` after `base_url` validation:

```js
if (provider.api_keys?.length) {
  return fetchConfiguredAnthropicWithCredentials(provider, body, clientReq);
}
```

At the top of `fetchConfiguredOpenAI` after `base_url` validation:

```js
if (provider.api_keys?.length) {
  return fetchConfiguredOpenAIWithCredentials(
    provider,
    endpointPath,
    body,
    clientReq,
    signal,
  );
}
```

Do not edit the remaining legacy bodies except for moving them intact if required by linting.

The new helpers must:

1. Resolve configured credentials with `listEndpointCredentials`.
2. Return the existing missing-key error when no credential resolves.
3. For `failover`, pass ordered credentials into `runCredentialFailover`.
4. For `round-robin` and `random`, call `getEndpointApiKeyByStrategy` once for the request, then apply the existing `UPSTREAM_RETRY_COUNT`/`shouldRetryUpstreamResponse` same-key loop.
5. Build headers through the existing `providerHeaders`.
6. Preserve the caller-provided `signal` for OpenAI by passing it as `parentSignal`.
7. Log credential IDs only, never API key values:

```js
logInfo("credential_failover", {
  provider: provider.id,
  credential_id: credential.credentialId,
  attempt: attempt + 1,
});
```

- [ ] **Step 5: Update configured-key presence without changing capability lookups**

Update `getConfiguredProviderApiKey` and `hasConfiguredApiKey` only with guarded multi-key branches:

```js
if (provider?.api_keys?.length) {
  return getEndpointApiKeyByStrategy(
    provider,
    GATEWAY_SECRETS,
    process.env,
    allGatewayEndpoints(),
    { attempt: 0 },
  ).apiKey;
}
```

The existing branches remain unchanged below this guard.

- [ ] **Step 6: Run retry and routing tests**

```bash
node --test tests/unit/upstream-retry.test.mjs tests/integration/multi-key-routing.test.mjs
node --check server.js
```

Expected: PASS for both protocol families.

- [ ] **Step 7: Run the legacy protocol suite**

```bash
npm run test:adapters
node --test tests/integration/codex-gateway.test.mjs
```

Expected: PASS; the guarded branch did not change single-key requests.

- [ ] **Step 8: Commit routing support**

```bash
git add lib/upstream-retry.mjs server.js tests/unit/upstream-retry.test.mjs tests/integration/multi-key-routing.test.mjs
git commit -m "feat: route configured requests across endpoint keys"
```

### Task 9: End-to-end compatibility and release gate

**Files:**
- Modify only when a gate exposes a defect.

- [ ] **Step 1: Run focused feature tests**

```bash
node --test \
  tests/unit/credential-store.test.mjs \
  tests/unit/key-strategy.test.mjs \
  tests/unit/upstream-retry.test.mjs \
  tests/unit/config-panel-copy-node.test.mjs \
  tests/unit/config-panel-multi-key.test.mjs \
  tests/integration/config-secret-routes.test.mjs \
  tests/integration/multi-key-routing.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Run all compatibility gates**

```bash
npm run check
npm run build:panel
npm run test:config-panel
npm run test:codex:unit
npm run test:adapters
npm run test:codex:catalog-write
npm run test:codex:integration
```

Expected: PASS. If an unrelated environment-dependent test cannot run, record the exact command and error in the final report.

- [ ] **Step 3: Inspect persisted files**

After saving a migrated endpoint, verify:

```bash
node -e '
const fs=require("fs");
const config=JSON.parse(fs.readFileSync(process.env.GATEWAY_CONFIG_FILE,"utf8"));
const secrets=JSON.parse(fs.readFileSync(process.env.GATEWAY_SECRETS_FILE,"utf8"));
const text=JSON.stringify(config);
if (/api_key_values|has_api_key|api_key_env/.test(text)) process.exit(1);
if (Object.keys(secrets.api_keys).some((key) => key === process.env.ENDPOINT_ID)) process.exit(2);
console.log("credential persistence shape ok");
'
```

Expected: `credential persistence shape ok`.

- [ ] **Step 4: Perform the UI smoke matrix**

Verify at desktop and mobile widths:

1. Existing single-key nodes look and save exactly as before.
2. Copy button is adjacent to Add Node for Code, Desktop, Codex, DeepTutor, and custom clients.
3. Copy modal filters the target client, supports empty source clients, and opens a draft instead of saving.
4. Copying a multi-key endpoint creates new endpoint and credential IDs while preserving key values.
5. Clicking Add More Keys migrates only on save.
6. Strategy selector persists and reloads.
7. Masked previews never reveal the full key.
8. The last credential cannot be deleted.
9. Unsupported capability runtimes do not display multi-key controls.
10. No text, buttons, menus, or key rows overlap at `375x812`, `768x1024`, and `1440x900`.

- [ ] **Step 5: Review the final diff for compatibility boundaries**

Run:

```bash
git diff 1af8624...HEAD -- \
  lib/config/gateway-config-store.mjs \
  lib/config/credential-store.mjs \
  lib/config/key-strategy.mjs \
  lib/upstream-retry.mjs \
  server.js \
  desktop/src
```

Confirm:

- The old `getEndpointApiKey` implementation is unchanged.
- Both configured fetch functions have one early multi-key guard.
- No API key value appears in logs, public config, previews, or tests outside fixtures.
- New strategy dispatch is registry-based.
- Credential selection remains endpoint-local and contains no group routing.

- [ ] **Step 6: Commit gate fixes only when necessary**

```bash
git add -A
git commit -m "fix: close multi-key compatibility gaps"
```

Skip this commit when no changes were required.

## Execution Notes

- Slice A is independently shippable after Task 3.
- Slice B depends on Slice A's credential-aware secret reveal for copying multi-key endpoints, but its runtime and persistence code remain separately reviewable.
- The two-file config/secrets save is recoverable, not transactional. Atomic rename protects each file; the secret backup and legacy-secret fallback protect the migration window.
- A future endpoint-group feature should select an endpoint first, then reuse this endpoint-local credential selector unchanged.
