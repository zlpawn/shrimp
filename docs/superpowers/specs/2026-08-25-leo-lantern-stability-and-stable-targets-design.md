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

The resolver accepts the current task, an optional explicit `tabId`, and live Chrome metadata. It returns a numeric tab ID only when one of these conditions is true:

- the explicit ID equals `claimedTabId`; or
- the explicit ID belongs to the active task group and task window; or
- no explicit ID was supplied and a valid claimed tab exists.

It fails closed when:

- there is no active task;
- the claimed tab no longer exists;
- an explicit tab is outside the task group or task window;
- the task has no established claimed tab and the command cannot create one.

`tabs.close` is subject to the same rules. Closing the claimed tab clears `claimedTabId`. Closing the last task tab leaves the task active but unclaimed so the next `tabs.new` creates a replacement.

`tabs.goto` must never use `groupId === null` as permission to navigate an arbitrary explicit tab.

### 2. Task-State Validation and Recovery

Startup validation must verify relationships, not only the existence of individual Chrome IDs:

- `claimedTabId` must exist in `windowId`;
- when `groupId` exists, the claimed tab must belong to that group;
- the group must belong to the task window through at least one live group tab;
- a missing group clears both `groupId` and any claimed tab that cannot still be proven task-owned;
- a missing claimed tab clears only `claimedTabId`, preserving the active task.

The next `tabs.new` after a missing claimed tab creates and claims a replacement instead of repeatedly navigating a stale ID.

Repeated `task.start` reuses the active task. It may update `title` and `color`, but it must not change `sameWindow`, `windowId`, `groupId`, or `claimedTabId`. CLI and MCP must preserve the distinction between an omitted boolean and explicit `false`.

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
- command IDs currently in flight or recently completed are not executed twice;
- failure of one command does not permanently reject the queue;
- stopping or reconciling a URL prevents new work from that URL but does not interrupt a command already executing;
- completed-ID retention is bounded.

This protects the single authoritative `taskState` from lost updates and prevents concurrent debugger or tab mutations.

### 5. CDP Network-Capture Ownership

Network capture records explicit debugger ownership:

```json
{
  "tabId": 123,
  "attachedByLantern": true,
  "startedAt": 0,
  "stoppedAt": null,
  "entries": []
}
```

Rules:

- starting capture on the already captured tab is idempotent and resets the bounded entry buffer without attaching twice;
- starting capture on a different task-owned tab stops and detaches the old session first;
- if `attach`, `Network.enable`, or state persistence fails partway through startup, any attachment acquired by that attempt is released;
- `net-get` and `net-stop` reject an explicit `tabId` that does not match the active capture;
- `task.end` and successful `net-stop` detach when `attachedByLantern` is true;
- debugger detach events clear stale capture state.

Network entries are capped at 1,000 requests. Updating an entry must not copy and persist an unbounded array for every CDP event. Runtime capture uses an indexed in-memory buffer; persisted task state contains only bounded summaries needed for recovery and diagnostics.

### 6. CLI and MCP Mapping Corrections

CLI argument normalization supports both documented kebab-case flags and their existing camel-case aliases:

- `--full-page`
- `--bypass-cache` and `--bypasscache`
- `--same-window` and `--samewindow`
- `--close-group` and `--closegroup`
- `--timeout-ms`
- `server --port N` and `server --host HOST`

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

## Phase 2: Stable Target Protocol MVP

### 1. Target Model

Interaction targets use one of three forms:

```text
numeric ref | CSS selector | semantic locator
```

Semantic locator fields supported in this MVP:

- `role`
- `name`
- `text`
- `label`
- `testId`

A write action requires exactly one live match. Multiple matches are never resolved by silently choosing the first element.

### 2. State Snapshot

Add protocol command `dom.state`, CLI command `state`, and MCP tool `browser_state`.

The extension returns:

```json
{
  "url": "https://example.com",
  "title": "Example",
  "generation": 4,
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

Refs are scoped to a tab and document generation. A top-level navigation changes the generation and invalidates old refs. The snapshot is bounded to 200 interactive or semantically important elements.

### 3. Find

Add `dom.find`, CLI `find`, and MCP `browser_find`.

`find` accepts CSS or one semantic locator and returns all bounded matches with allocated refs. It is the smaller alternative to a full state snapshot when the caller already knows the likely locator.

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

The MVP does not attempt cross-navigation or cross-frame reidentification.

### 5. Click and Fill

`dom.click` and `dom.fill` accept `ref`, CSS, or semantic locator fields. Existing `text` and `selector` compatibility remains.

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

### 6. Structured Errors

Bridge and extension errors preserve a stable code:

- `no_active_task`
- `tab_outside_task`
- `no_claimed_tab`
- `not_found`
- `stale_ref`
- `invalid_selector`
- `selector_not_found`
- `selector_ambiguous`
- `semantic_not_found`
- `semantic_ambiguous`
- `unsupported_target`

The HTTP response remains compatible with `{ ok: false, error }`, where `error` may be an object containing `code`, `message`, and optional `candidates`. MCP tool failures render the same object as JSON text instead of discarding the code.

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
- restored IDs with invalid relationships are cleared;
- repeated `task.start` preserves the window strategy;
- HTTP 404 triggers Gateway registration and heartbeat fallbacks;
- Bridge heartbeat restores task summary;
- URL reconciliation stops removed polling loops;
- commands from two URLs execute globally in order and duplicate IDs run once;
- repeated and cross-tab `net-start` attach/detach correctly;
- partial CDP startup failure cleans up;
- `net-get` / `net-stop` validate the requested tab;
- CLI raw argv maps documented aliases and server port;
- long waits receive sufficient Bridge timeout;
- non-Lantern services on the port are never used as a remote Bridge.

Phase 2 coverage includes:

- bounded state snapshots allocate deterministic refs;
- CSS and semantic find return match counts and refs;
- refs resolve as exact, stable, or uniquely reidentified;
- navigation generation changes reject stale refs;
- ambiguous selectors and semantic locators fail without acting;
- click returns the structured match envelope;
- fill updates and verifies input, textarea, and contenteditable values;
- all target operations remain limited to a validated task-owned tab;
- CLI and MCP expose the same protocol fields and error codes.

The final verification commands are:

```bash
npm run check
npm run test:leo-lantern
```

## Delivery Order

1. Task-boundary and recovery fixes.
2. Gateway/Bridge synchronization and global command serialization.
3. CDP ownership and bounded network state.
4. CLI/MCP mapping and remote-Bridge identity fixes.
5. Stable error transport.
6. State/find refs and fingerprints.
7. Ref-aware click and verified fill.
8. Full regression suite and documentation updates.

Each numbered item ends in a focused commit with its tests passing.
