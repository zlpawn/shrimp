# Leo Lantern Stability and Stable Targets Design

## Goal

Make Leo Lantern safe and deterministic enough for daily Agent use, then add a stable element-target protocol for reliable page interaction.

The work ships in two ordered phases:

1. Stabilize the existing dual-mode bridge, task isolation, polling, and CDP lifecycle.
2. Add `state` / `find` element references and use them from `click` / `fill` with structured match results and errors.

The second phase must not begin until the first phase's regression tests pass.

## Non-Goals

This design does not add:

- Accessibility-tree snapshots
- iframe or Shadow DOM traversal
- network request or response bodies
- file upload, drag, hover, select, or download handling
- site adapters, plugins, or OpenCLI compatibility
- remote Bridge discovery or remote network exposure
- a general authentication system for the local Bridge

## Existing Architecture

```text
CLI / MCP
  -> local Lantern Bridge on 127.0.0.1:19527
  -> extension long-polling the Bridge and optional Shrimp Gateway
  -> task-scoped Chrome tabs / groups / windows
  -> chrome.scripting / chrome.debugger / chrome.cookies
```

The extension remains authoritative for Chrome task state. The Bridge remains a local command queue and a cached diagnostic view. CLI and MCP remain thin adapters over the same command protocol.

## Phase 1: Existing-Behavior Stabilization

### 1. Unified Task Tab Resolution

Every command that reads, navigates, reloads, closes, scripts, screenshots, or captures a tab must resolve its target through one shared task-boundary function.

Task ownership is a relationship, not an ID equality check. A live tab is task-owned only when the following predicate succeeds:

- for `sameWindow: false`, the tab belongs to the live dedicated `windowId` and, when a live `groupId` exists, also belongs to that group;
- for `sameWindow: true`, the tab belongs to the live `windowId` and the live `groupId`; a shared window by itself is never ownership evidence;
- a stored `claimedTabId` does not override either rule.

The resolver is a state machine:

1. Reject when there is no active task.
2. Read live window, group, claimed-tab, and optional explicit-tab metadata.
3. Clear a stale or relationship-invalid claim before choosing a target.
4. If an explicit `tabId` was supplied, validate that tab independently with the ownership predicate and either return it or fail `tab_outside_task`. A stale former claim must not block a different valid explicit tab.
5. If no explicit ID was supplied, return the valid claim or fail `no_claimed_tab`.

An absent group is usable ownership evidence only in a live dedicated task window. In a shared window, an absent group means that no existing tab is proven task-owned; only a task-aware creation path may create a new tab, group it, and claim it.

The resolver fails closed when the task window is unavailable, the explicit tab is missing or outside the ownership predicate, or there is no valid claim for a command that cannot create one.

`tabs.close` is subject to the same rules. Closing the claimed tab clears `claimedTabId`. Closing the last task tab leaves the task active but unclaimed so the next `tabs.new` creates a replacement.

`tabs.goto` must never use `groupId === null` as permission to navigate an arbitrary explicit tab.

### 2. Task-State Validation and Recovery

Startup validation must verify relationships, not only the existence of individual Chrome IDs:

- `claimedTabId` must exist in `windowId`;
- when `groupId` exists, the claimed tab must belong to that group;
- the group must belong to the task window through at least one live group tab;
- a missing group clears `groupId`; in a dedicated task window, a live claim in that window remains valid, while in a shared window the claim is cleared because the window alone proves nothing;
- a missing claimed tab clears only `claimedTabId`, preserving the active task.

The next `tabs.new` after a missing claimed tab creates and claims a replacement instead of repeatedly navigating a stale ID.

Recovery follows this matrix:

| Live relationship | Startup reconciliation | Next `tabs.new` or repeated `task.start` |
| --- | --- | --- |
| Window, group, and claim valid | Preserve all IDs | Reuse them |
| Claim missing/invalid, window and group valid | Clear only `claimedTabId` | Create, group, and claim a replacement tab |
| Group missing, dedicated window valid | Clear `groupId`; preserve only a claim in that window | Recreate the group around the preserved or new claimed tab |
| Group missing, shared window valid | Clear `groupId` and `claimedTabId` | Create a new tab in that window, create a group, and claim it |
| Window missing | Clear `windowId`, `groupId`, and `claimedTabId`, but preserve task metadata and `sameWindow` | Re-establish a window according to the original strategy, then create/group/claim a tab |

For a missing dedicated window, recovery creates a new dedicated Chrome window. For a missing shared window, recovery chooses the current normal browser window; it never treats pre-existing tabs in that window as task-owned.

Repeated `task.start` reuses the active task. It may update `title` and `color`, but it must not change the established `sameWindow` strategy. Valid Chrome IDs are preserved; invalid IDs may be replaced only according to the recovery matrix. CLI and MCP must preserve the distinction between an omitted boolean and explicit `false`.

### 3. Bridge and Gateway Registration

For each configured target URL, registration follows this sequence:

1. Try `POST /ext/hello`.
2. Treat every non-2xx response as unsupported, not as success.
3. Fall back to `POST /v1/extensions/register`.
4. Report the target online only after one registration path succeeds.

Heartbeat uses the same non-2xx fallback rule. The Bridge heartbeat handler consumes the optional task summary and refreshes its cached `doctor` state so a Bridge restart can recover an already active extension task without requiring an extension restart.

Changing `gatewayUrl` reconciles the desired URL set: loops for removed URLs are aborted and only the new Bridge/Gateway URLs remain active.

### 4. Global Command Serialization

The extension may poll the standalone Bridge and Shrimp Gateway concurrently, but Chrome mutations must execute through one global promise queue.

Requirements:

- at most one command handler runs at a time across all URLs;
- the dedupe key is the protocol command ID string, shared across all polling URLs;
- an in-flight record owns one execution promise and a set of source URLs waiting for its result;
- a duplicate from another URL joins that record rather than executing or being discarded;
- the final success or failure envelope is posted once to every source URL that supplied the command;
- a completed-result cache replays the same envelope when a source claims a recently completed ID;
- failure of one command does not permanently reject the queue;
- stopping or reconciling a URL prevents new claims from that URL but does not interrupt a command already executing or suppress the result post to the captured source URL;
- completed results are retained for at most 1,000 IDs and 5 minutes, whichever bound evicts them first.

This protects the single authoritative `taskState` from lost updates and prevents concurrent debugger or tab mutations.

### 5. CDP Network-Capture Ownership

Network capture records explicit debugger ownership:

```json
{
  "tabId": 123,
  "attachedByLantern": true,
  "startedAt": 0,
  "stoppedAt": null,
  "entryCount": 0,
  "recovered": false,
  "entriesLost": false
}
```

Rules:

- starting capture on the already captured tab is idempotent and resets the bounded entry buffer without attaching twice;
- starting capture on a different tab validates the new tab as task-owned before stopping or detaching the old session;
- after that validation succeeds, switching capture stops and detaches the old session first;
- if `attach`, `Network.enable`, or state persistence fails partway through startup, any attachment acquired by that attempt is released;
- `net-get` and `net-stop` reject an explicit `tabId` that does not match the active capture;
- `task.end` and successful `net-stop` detach when `attachedByLantern` is true;
- debugger detach events clear stale capture state.

Network entries are capped at 1,000 requests. Updating an entry must not copy and persist an unbounded array for every CDP event. Runtime capture uses an indexed in-memory buffer. Durable state contains only `tabId`, `attachedByLantern`, timestamps, `entryCount`, and recovery flags; full entries are never persisted.

On MV3 service-worker startup, capture reconciliation compares durable state with `chrome.debugger.getTargets()` and live task ownership:

- if the recorded tab remains task-owned and its debugger target is attached, rebuild an active empty runtime buffer and set `recovered: true`, `entriesLost: true`;
- if the recorded tab is no longer task-owned, detach it when `attachedByLantern` is true and clear the session;
- if the target is no longer attached, mark the durable session stopped and clear active ownership;
- entries observed before the restart are unavailable after recovery; `net-get` returns the empty recovered buffer plus `entriesLost: true` rather than inventing or replaying entries.

### 6. CLI and MCP Mapping Corrections

CLI argument normalization uses this explicit alias table:

| Canonical option | Accepted raw flags |
| --- | --- |
| `fullPage` | `--full-page`, `--fullPage` |
| `bypassCache` | `--bypass-cache`, `--bypassCache`, `--bypasscache` |
| `sameWindow` | `--same-window`, `--sameWindow`, `--samewindow` |
| `closeGroup` | `--close-group`, `--closeGroup`, `--closegroup` |
| `timeoutMs` | `--timeout-ms`, `--timeoutMs` |
| `port` | `--port` |
| `host` | `--host` |

`wait.timeoutMs` controls both the extension-side wait and the Bridge command timeout. The Bridge timeout is the requested wait plus a 2-second transport allowance, with the existing default used when no timeout is supplied.

MCP preserves omitted optional booleans rather than converting every missing value to `false`.

### 7. Remote Bridge Identity

An occupied port is not automatically a Lantern Bridge. Before forwarding commands, MCP must probe `/health` and require a stable identity response:

```json
{
  "ok": true,
  "bridge": true,
  "service": "leo-lantern"
}
```

If the port is occupied by another service, startup completes in a diagnosable unavailable state, `browser_health` reports `bridgeOnline: false`, and browser commands fail without being forwarded to the unrelated service.

### 8. Structured Error Transport

All commands migrated in Phase 1 and all new Phase 2 commands return failures as:

```json
{
  "ok": false,
  "error": {
    "code": "no_active_task",
    "message": "No browser task is active",
    "candidates": []
  }
}
```

`code` and `message` are mandatory; `candidates` is optional. Legacy string errors are allowed only for command types that have not yet been migrated and are not used by the Phase 1 or Phase 2 feature set. Bridge result caching, CLI, and MCP preserve the object without reducing it to a string.

Phase 1 codes are `invalid_request`, `no_active_task`, `task_window_missing`, `tab_not_found`, `tab_outside_task`, `no_claimed_tab`, `capture_not_active`, `capture_tab_mismatch`, `debugger_attach_failed`, `bridge_unavailable`, and `command_timeout`.

## Phase 2: Stable Target Protocol MVP

### 1. Target Model

Interaction targets use a discriminated union:

```json
{ "kind": "ref", "ref": 12, "generation": "4d0f..." }
{ "kind": "css", "selector": "button.primary" }
{ "kind": "semantic", "role": "button", "name": "Sign in", "match": "exact", "caseSensitive": false }
```

Exactly one target object is accepted. `ref` must be a positive integer and must be accompanied by the opaque document `generation` string returned by `state` or `find`. A semantic target must contain at least one of `role`, `name`, `text`, `label`, or `testId`; all supplied fields are combined with AND. `role` and `testId` are exact fields. `name`, `text`, and `label` use `match: "exact" | "contains"` with `exact` as the default. String comparison trims and collapses Unicode whitespace and is case-insensitive unless `caseSensitive: true`.

Legacy top-level `selector` or `text` is translated to one CSS or semantic target only when no `target` object or other legacy target field is present. Supplying multiple target forms fails `invalid_target`; there is no implicit priority order.

Semantic locator fields supported in this MVP:

- `role`
- `name`
- `text`
- `label`
- `testId`

A write action requires exactly one live, visible match. Disabled matches fail `target_disabled`. Multiple matches are never resolved by silently choosing the first element.

The MVP semantic implementation uses a deterministic DOM approximation rather than the full accessibility tree:

- implicit roles cover `button`, `a[href]`, `input` by type, `select`, `textarea`, `summary`, and `h1` through `h6`;
- accessible name precedence is `aria-label`, referenced `aria-labelledby` text, associated `<label>` text, `alt`, button/input value, then normalized visible text;
- `label` means an associated `<label>` or wrapping-label text;
- discovery excludes elements hidden by `hidden`, `aria-hidden="true"`, `display:none`, `visibility:hidden`, zero rendered rectangles, or a hidden ancestor;
- `disabled` and `aria-disabled="true"` are reported but are not actionable.

### 2. State Snapshot

Add protocol command `dom.state`, CLI command `state`, and MCP tool `browser_state`.

The extension returns:

```json
{
  "url": "https://example.com",
  "title": "Example",
  "generation": "4d0f3d6c-...",
  "elements": [
    {
      "ref": 12,
      "tag": "button",
      "role": "button",
      "name": "Sign in",
      "text": "Sign in",
      "visible": true,
      "disabled": false
    }
  ]
}
```

Refs are scoped to a tab and document generation. The caller must submit both fields for a ref action. A top-level navigation creates a new generation and invalidates old refs. Numeric IDs may be reused only in a different generation. The snapshot is bounded to the first 200 visible interactive or semantically important elements in deterministic DOM order.

Each top-level document owns an extension-isolated-world registry at `globalThis.__leoLanternTargets`. It contains a random generation token, a `WeakMap<Node, number>`, and a `Map<number, Node>` for the document lifetime. `state`, `find`, `click`, and `fill` all consult this registry. Top-level navigation destroys the isolated world and therefore the registry; the next command creates a new token. An MV3 worker restart does not recreate a live document registry, so refs remain valid when the isolated world survives. Extension reload or registry loss creates a new token, making old generations fail closed.

### 3. Find

Add `dom.find`, CLI `find`, and MCP `browser_find`.

`find` accepts one CSS or semantic target and returns up to 200 matches with allocated refs and the document generation. Zero matches is a successful response with `matches_n: 0`; locator syntax errors remain failures. It is the smaller alternative to a full state snapshot when the caller already knows the likely locator.

### 4. Fingerprints and Reidentification

Each ref stores a compact fingerprint:

- tag name
- stable ID, name, test ID, and href when present
- role and accessible name
- normalized visible text prefix
- ordinal among equivalent candidates

Resolution returns one of:

- `exact`: the original live node still matches the fingerprint;
- `stable`: strong identity fields match and only soft fields changed;
- `reidentified`: the original node disappeared and exactly one replacement matches the fingerprint;
- error: no safe unique match exists.

`exact` means the registry still contains the original Node and its fingerprint is compatible. Reidentification runs only within the same submitted generation. The MVP does not attempt cross-navigation or cross-frame reidentification.

### 5. Click and Fill

`dom.click` and `dom.fill` accept the target union. Existing `text` and `selector` compatibility is translated under the conflict rules in the Target Model.

Success envelopes include:

```json
{
  "clicked": true,
  "target": "12",
  "matches_n": 1,
  "match_level": "exact"
}
```

`fill` supports `input`, `textarea`, and `contenteditable`. It verifies the resulting live value/text and returns `filled`, `verified`, `actual`, `matches_n`, and `match_level`.

### 6. Target Error Codes and Precedence

Phase 2 adds `invalid_target`, `stale_ref_generation`, `stale_ref_node`, `reidentification_ambiguous`, `invalid_selector`, `selector_not_found`, `selector_ambiguous`, `semantic_not_found`, `semantic_ambiguous`, `unsupported_target`, `target_disabled`, and `fill_verification_failed`.

The failure boundary is deterministic:

| Condition | Code |
| --- | --- |
| Missing, malformed, or multiple target forms | `invalid_target` |
| No active task or target tab outside task | Phase 1 task code |
| Submitted generation differs from the live document registry | `stale_ref_generation` |
| Same-generation ref node disappeared and has no safe replacement | `stale_ref_node` |
| More than one replacement has the best fingerprint score | `reidentification_ambiguous` |
| CSS parsing throws | `invalid_selector` |
| CSS action has zero or multiple matches | `selector_not_found` / `selector_ambiguous` |
| Semantic action has zero or multiple matches | `semantic_not_found` / `semantic_ambiguous` |
| Element type cannot perform the requested action | `unsupported_target` |
| Unique action target is disabled | `target_disabled` |
| Fill dispatch completes but live value/text differs | `fill_verification_failed` |

Validation uses table order: malformed requests are rejected before browser state is touched; after task resolution, ref-generation failures precede node/reidentification failures; locator cardinality precedes actionability and fill verification.

## File Boundaries

Create focused extension modules rather than expanding `background.js` further:

- `task-target.mjs`: live task-tab relationship validation and resolution
- `command-queue.mjs`: global serialization and bounded command-ID dedupe
- `cdp-session.mjs`: debugger attachment and network-session lifecycle
- `element-target.mjs`: snapshot, locator matching, fingerprints, and ref resolution
- `interaction.mjs`: click and verified fill operations
- `errors.mjs`: stable protocol error construction and serialization

`background.js` coordinates these modules and maps protocol command types to their handlers.

CLI and MCP may share protocol constants and normalization helpers, but the stdio and human CLI surfaces remain separate adapters.

## Testing Strategy

All production behavior is implemented test-first.

Phase 1 regression coverage includes:

- explicit `goto` and `close` reject task-external tabs when the group is absent or removed;
- stale claimed tabs recover through the next `new-tab`;
- restored IDs with invalid relationships and each missing-window/group/claim recovery-matrix row are covered;
- repeated `task.start` preserves the window strategy;
- HTTP 404 triggers Gateway registration and heartbeat fallbacks;
- Bridge heartbeat restores task summary;
- URL reconciliation stops removed polling loops;
- commands from two URLs execute globally in order, in-flight duplicates share one execution, every source receives a result, completed results replay, failures do not poison the queue, and count/TTL retention is bounded;
- repeated and cross-tab `net-start` attach/detach correctly, including validation before old-session teardown;
- partial CDP startup failure cleans up;
- `net-get` / `net-stop` validate the requested tab;
- CLI raw argv covers every canonical/alias table row plus server host and port;
- long waits receive sufficient Bridge timeout;
- MCP omitted booleans remain omitted;
- heartbeat `task: null` clears stale Bridge task state;
- `task.end`, debugger detach events, the 1,000-entry cap, and MV3 capture recovery obey their lifecycle contracts;
- non-Lantern services on the port are never used as a remote Bridge;
- every Phase 1 error condition preserves its structured code through extension, Bridge, CLI, and MCP boundaries.

Phase 2 coverage includes:

- bounded state snapshots allocate deterministic refs;
- CSS and semantic find return match counts and refs;
- refs resolve as exact, stable, or uniquely reidentified;
- cross-tab and cross-generation ref use fails closed, while same-document refs survive a worker restart;
- ambiguous selectors and semantic locators fail without acting;
- click returns the structured match envelope;
- fill updates and verifies input, textarea, and contenteditable values;
- all target operations remain limited to a validated task-owned tab;
- CLI and MCP expose the same protocol fields and the complete Phase 2 error-code matrix.

The final verification commands are:

```bash
npm run check
npm run test:leo-lantern
```

## Delivery Order

1. Task-boundary and recovery fixes.
2. Gateway/Bridge synchronization and global command serialization.
3. CDP ownership and bounded network state.
4. CLI/MCP mapping, remote-Bridge identity, and Phase 1 structured-error fixes.

Phase 1 is complete only when steps 1–4 pass all Phase 1 regression tests plus `npm run check` and `npm run test:leo-lantern`.

5. State/find refs, document registry, and fingerprints.
6. Ref-aware click and verified fill.
7. Full Phase 2 regression suite and documentation updates.

Phase 2 is complete only when steps 5–7 pass all Phase 2 tests plus `npm run check` and `npm run test:leo-lantern`.

Each numbered item ends in a focused commit with its tests passing.
