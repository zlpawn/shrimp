# Leo Lantern Stability and Stable Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair Leo Lantern's historical isolation and lifecycle bugs, then add deterministic `state`/`find` element references and safe ref-aware `click`/`fill` operations.

**Architecture:** The Chrome extension remains authoritative for task and browser state. Focused extension modules own tab-boundary validation, serialized command execution, CDP sessions, target registries, and interaction semantics; `background.js` only coordinates them. The Bridge, CLI, and MCP adapters preserve the same structured protocol envelopes without inventing independent behavior.

**Tech Stack:** JavaScript ES modules, Chrome Extension Manifest V3 APIs, Node.js built-in test runner, local HTTP Bridge, MCP JSON-RPC over stdio.

**Spec:** `docs/superpowers/specs/2026-08-25-leo-lantern-stability-and-stable-targets-design.md`

## Global Constraints

- Execute Phase 1 completely before starting Phase 2.
- Every production behavior change starts with a failing test and ends with the focused test passing.
- Do not add runtime dependencies.
- Keep the Bridge bound to `127.0.0.1` by default and require `{ ok: true, bridge: true, service: "leo-lantern" }` for remote identity.
- Enforce one global extension command execution at a time across all polling URLs.
- Bound completed-command retention to 1,000 IDs and 5 minutes.
- Bound network capture to 1,000 requests and the document ref registry to 1,000 records.
- Preserve omitted optional booleans in CLI/MCP adapters.
- Preserve structured errors end-to-end; do not reconstruct outward errors from `Error.message`.
- Final verification commands are `npm run check` and `npm run test:leo-lantern`.

---

## File Structure

- Create `extensions/leo-cookie-txt-locally/errors.mjs`: construct, normalize, and serialize stable Lantern errors.
- Create `extensions/leo-cookie-txt-locally/task-target.mjs`: reconcile task/window/group/tab relationships and resolve task-owned targets.
- Modify `extensions/leo-cookie-txt-locally/task-state.mjs`: preserve task strategy while applying relationship-aware recovery.
- Modify `extensions/leo-cookie-txt-locally/task-chrome.mjs`: recover stale claims and recreate missing window/group resources.
- Modify `extensions/leo-cookie-txt-locally/background.js`: route all tab commands through shared modules and preserve structured results.
- Create `extensions/leo-cookie-txt-locally/command-queue.mjs`: serialize commands, merge duplicate waiters, replay bounded results.
- Modify `extensions/leo-cookie-txt-locally/poll-loop.mjs`: reconcile URL loops and hand claimed commands to the global queue.
- Create `extensions/leo-cookie-txt-locally/bridge-sync.mjs`: implement hello/heartbeat fallback without hiding non-2xx responses.
- Create `extensions/leo-cookie-txt-locally/cdp-session.mjs`: own debugger attachment, recovery, switching, detach, and bounded entries.
- Modify `extensions/leo-cookie-txt-locally/network-capture.mjs`: use an indexed bounded buffer instead of immutable full-array copies.
- Modify `clis/leo-lantern/lib/protocol.mjs`: add command constants and shared error helpers needed by adapters.
- Modify `clis/leo-lantern/lib/server.mjs`: Bridge identity, task heartbeat restore, timeout/error HTTP mapping.
- Modify `clis/leo-lantern/lib/cli.mjs`: alias normalization, omitted booleans, wait timeout allowance, server host/port, structured stderr.
- Modify `mcps/leo-lantern/lib/mcp-server.mjs`: identity probe, omitted booleans, timeout forwarding, structured tool failures.
- Create `extensions/leo-cookie-txt-locally/element-target.mjs`: target validation, semantic matching, document registry, fingerprints, refs.
- Create `extensions/leo-cookie-txt-locally/interaction.mjs`: unique target resolution, click, fill, and post-action verification.
- Add focused tests under `clis/leo-lantern/tests/` and `mcps/leo-lantern/tests/`.

---

### Task 1: Structured Errors and Task-Owned Tab Resolution

**Files:**
- Create: `extensions/leo-cookie-txt-locally/errors.mjs`
- Create: `extensions/leo-cookie-txt-locally/task-target.mjs`
- Modify: `extensions/leo-cookie-txt-locally/task-state.mjs`
- Test: `clis/leo-lantern/tests/task-target.test.mjs`
- Test: `clis/leo-lantern/tests/task-state.test.mjs`

**Interfaces:**
- Produces: `lanternError(code, message, candidates?)`, `normalizeLanternError(error, fallbackCode?)`, `reconcileTaskRelationships(task, live)`, and `resolveTaskTab({ task, explicitTabId, live, allowMissingClaim })`.
- `live` contains `windowsById`, `groupsById`, and `tabsById` Maps built from Chrome metadata.
- `resolveTaskTab` returns `{ tabId, task }` so stale claims cleared during resolution can be persisted by the caller.

- [ ] **Step 1: Write failing ownership tests**

```js
test("explicit tab outside a shared-window task group fails closed", () => {
  const task = { sameWindow: true, windowId: 1, groupId: null, claimedTabId: null };
  assert.throws(
    () => resolveTaskTab({ task, explicitTabId: 9, live: liveState({ tabs: [{ id: 9, windowId: 1, groupId: -1 }] }) }),
    (err) => err.code === "tab_outside_task"
  );
});

test("stale claim does not block another explicit task-owned tab", () => {
  const result = resolveTaskTab({
    task: { sameWindow: false, windowId: 2, groupId: 7, claimedTabId: 99 },
    explicitTabId: 10,
    live: liveState({ tabs: [{ id: 10, windowId: 2, groupId: 7 }], windows: [{ id: 2 }], groups: [{ id: 7, windowId: 2 }] }),
  });
  assert.equal(result.tabId, 10);
  assert.equal(result.task.claimedTabId, null);
});
```

- [ ] **Step 2: Run ownership tests and verify failure**

Run: `node --test clis/leo-lantern/tests/task-target.test.mjs`

Expected: FAIL because `task-target.mjs` does not exist.

- [ ] **Step 3: Implement stable error objects and the ownership predicate**

```js
export function lanternError(code, message, candidates) {
  const error = new Error(message);
  error.code = code;
  error.lanternError = { code, message, ...(candidates ? { candidates } : {}) };
  return error;
}

export function isTaskOwnedTab(task, tab, live) {
  if (!tab || !live.windowsById.has(Number(task.windowId))) return false;
  if (tab.windowId !== Number(task.windowId)) return false;
  if (task.sameWindow) return task.groupId != null && tab.groupId === Number(task.groupId);
  return task.groupId == null || tab.groupId === Number(task.groupId);
}
```

- [ ] **Step 4: Add recovery-matrix tests**

Cover valid state, stale claim, missing group in dedicated/shared windows, missing window, mismatched group window, and repeated task upsert preserving `sameWindow` when omitted.

- [ ] **Step 5: Run tests and verify failure**

Run: `node --test clis/leo-lantern/tests/task-target.test.mjs clis/leo-lantern/tests/task-state.test.mjs`

Expected: FAIL on relationship-aware recovery assertions.

- [ ] **Step 6: Implement relationship-aware reconciliation**

Make `validateTaskState` accept live tabs/windows/groups with relationships, clear invalid Chrome IDs according to the spec matrix, preserve task metadata, and make `upsertActiveTask` ignore omitted strategy fields rather than defaulting them.

- [ ] **Step 7: Run focused tests**

Run: `node --test clis/leo-lantern/tests/task-target.test.mjs clis/leo-lantern/tests/task-state.test.mjs`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add extensions/leo-cookie-txt-locally/errors.mjs extensions/leo-cookie-txt-locally/task-target.mjs extensions/leo-cookie-txt-locally/task-state.mjs clis/leo-lantern/tests/task-target.test.mjs clis/leo-lantern/tests/task-state.test.mjs
git commit -m "fix(lantern): enforce task-owned tab resolution"
```

### Task 2: Wire Task Recovery into Chrome Commands

**Files:**
- Modify: `extensions/leo-cookie-txt-locally/task-chrome.mjs`
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Modify: `clis/leo-lantern/tests/task-policy.test.mjs`
- Create: `clis/leo-lantern/tests/task-chrome.test.mjs`

**Interfaces:**
- Consumes: `resolveTaskTab`, `reconcileTaskRelationships`, and stable errors from Task 1.
- Produces: `ensureRecoverableTaskResources(task, options, chrome)` and stale-claim-safe `createOrNavigateTaskTab`.

- [ ] **Step 1: Write failing Chrome recovery tests**

Test that a missing claimed tab makes `tabs.new` create/group/claim a replacement, missing dedicated/shared windows recreate according to the stored strategy, and invalid explicit `goto`/`close` never call `tabs.update`/`tabs.remove`.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test clis/leo-lantern/tests/task-chrome.test.mjs clis/leo-lantern/tests/task-policy.test.mjs`

Expected: FAIL because stale `claimedTabId` is still navigated and close is unguarded.

- [ ] **Step 3: Implement recoverable resource creation**

Clear stale claims before selecting `navigate-claimed`; create a new tab when the claim is invalid; rebuild group/window resources without changing the established `sameWindow` strategy.

- [ ] **Step 4: Route every tab-affecting background command through the resolver**

Use one path for `goto`, `close`, `reload`, DOM commands, page eval, screenshot, and CDP capture. Persist any task cleanup returned by the resolver before performing the Chrome mutation. Closing the claimed tab clears the claim.

- [ ] **Step 5: Run focused and baseline tests**

Run: `node --test clis/leo-lantern/tests/task-chrome.test.mjs clis/leo-lantern/tests/task-policy.test.mjs clis/leo-lantern/tests/page-drive.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/leo-cookie-txt-locally/task-chrome.mjs extensions/leo-cookie-txt-locally/background.js clis/leo-lantern/tests/task-chrome.test.mjs clis/leo-lantern/tests/task-policy.test.mjs
git commit -m "fix(lantern): recover stale task tabs safely"
```

### Task 3: Bridge/Gateway Registration and Heartbeat Reconciliation

**Files:**
- Create: `extensions/leo-cookie-txt-locally/bridge-sync.mjs`
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Modify: `clis/leo-lantern/lib/server.mjs`
- Create: `clis/leo-lantern/tests/bridge-sync.test.mjs`
- Modify: `clis/leo-lantern/tests/server.test.mjs`

**Interfaces:**
- Produces: `registerTarget(url, payload, fetchImpl)`, `heartbeatTarget(url, payload, fetchImpl)`.
- Both return `{ online, mode: "bridge" | "gateway" | null }` and treat every non-2xx response as a fallback trigger.

- [ ] **Step 1: Write failing 404 fallback tests**

Assert `/ext/hello` 404 invokes `/v1/extensions/register`, `/ext/heartbeat` 404 invokes `/v1/extensions/heartbeat`, and fallback non-2xx returns offline.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/bridge-sync.test.mjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement sync helper and wire background**

Use response `ok` checks for both attempts and include the task summary in Bridge heartbeat payloads.

- [ ] **Step 4: Write Bridge heartbeat task-cache tests**

Assert heartbeat restores a task after Bridge restart and heartbeat `{ task: null }` clears stale cached state.

- [ ] **Step 5: Run and verify failure**

Run: `node --test --test-name-pattern="heartbeat" clis/leo-lantern/tests/server.test.mjs`

Expected: FAIL because `/ext/heartbeat` ignores `body.task`.

- [ ] **Step 6: Implement Bridge heartbeat task restore**

Parse the body, refresh extension identity/lastSeen, and call `setTaskSummary` whenever the `task` property is present.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/bridge-sync.test.mjs clis/leo-lantern/tests/server.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/bridge-sync.mjs extensions/leo-cookie-txt-locally/background.js clis/leo-lantern/lib/server.mjs clis/leo-lantern/tests/bridge-sync.test.mjs clis/leo-lantern/tests/server.test.mjs
git commit -m "fix(lantern): reconcile bridge and gateway heartbeats"
```

### Task 4: Global Serialized Polling Queue and URL Reconciliation

**Files:**
- Create: `extensions/leo-cookie-txt-locally/command-queue.mjs`
- Modify: `extensions/leo-cookie-txt-locally/poll-loop.mjs`
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Create: `clis/leo-lantern/tests/command-queue.test.mjs`
- Modify: `clis/leo-lantern/tests/poll-loop.test.mjs`

**Interfaces:**
- Produces: `createCommandQueue({ execute, report, now, maxCompleted: 1000, ttlMs: 300000 })` with `submit(sourceUrl, command)`.
- `createMultiUrlPollLoop` adds `reconcile(urls)` and `stopUrl(url)` while preserving in-progress result routing.

- [ ] **Step 1: Write failing queue tests**

Cover global max concurrency of one, in-flight duplicate joining, result to every source, completed replay, failure recovery, TTL eviction, and count eviction.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/command-queue.test.mjs`

Expected: FAIL because `command-queue.mjs` does not exist.

- [ ] **Step 3: Implement the queue**

Use a tail promise that always recovers with `.catch(() => undefined)`, an in-flight Map of source waiters, and an access-pruned completed Map storing the exact result envelope.

- [ ] **Step 4: Write URL reconcile tests**

Assert removed URLs abort their long polls, retained URLs do not duplicate loops, new URLs start, and an already claimed command still posts to its captured source.

- [ ] **Step 5: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/poll-loop.test.mjs`

Expected: FAIL because `start` only adds URLs.

- [ ] **Step 6: Implement reconciliation and wire settings changes**

Replace repeated `start(urls)` calls with `reconcile(urls)` and submit all claimed commands through one queue instance.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/command-queue.test.mjs clis/leo-lantern/tests/poll-loop.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/command-queue.mjs extensions/leo-cookie-txt-locally/poll-loop.mjs extensions/leo-cookie-txt-locally/background.js clis/leo-lantern/tests/command-queue.test.mjs clis/leo-lantern/tests/poll-loop.test.mjs
git commit -m "fix(lantern): serialize commands across polling targets"
```

### Task 5: CDP Session Ownership and Bounded Network Capture

**Files:**
- Create: `extensions/leo-cookie-txt-locally/cdp-session.mjs`
- Modify: `extensions/leo-cookie-txt-locally/network-capture.mjs`
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Modify: `clis/leo-lantern/tests/network-capture.test.mjs`
- Create: `clis/leo-lantern/tests/cdp-session.test.mjs`

**Interfaces:**
- Produces: `createNetworkBuffer(limit)`, `startCapture`, `getCapture`, `stopCapture`, `reconcileCapture`, `handleDebuggerDetach`, and `handleNetworkEvent`.
- Durable capture state excludes full request entries.

- [ ] **Step 1: Write failing buffer tests**

Assert keyed updates do not copy an unbounded session, insertion order is bounded to 1,000 requests, and summaries/filtering remain compatible.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/network-capture.test.mjs`

Expected: FAIL on cap/index assertions.

- [ ] **Step 3: Implement bounded indexed buffer**

Use a Map keyed by `requestId`; update in place, delete the oldest key before adding request 1,001, and materialize summaries only for reads.

- [ ] **Step 4: Write failing lifecycle tests**

Cover same-tab idempotence, validate-new-tab-before-old-detach, cross-tab detach/attach, partial failure cleanup, explicit tab mismatch, task-end detach, debugger detach cleanup, and MV3 reconciliation with `entriesLost: true`.

- [ ] **Step 5: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/cdp-session.test.mjs`

Expected: FAIL because lifecycle ownership is embedded in `background.js`.

- [ ] **Step 6: Implement CDP session module and wire events**

Persist only summary state after lifecycle transitions; keep entries in one runtime buffer and register both `onEvent` and `onDetach` handlers.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/network-capture.test.mjs clis/leo-lantern/tests/cdp-session.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/cdp-session.mjs extensions/leo-cookie-txt-locally/network-capture.mjs extensions/leo-cookie-txt-locally/background.js clis/leo-lantern/tests/network-capture.test.mjs clis/leo-lantern/tests/cdp-session.test.mjs
git commit -m "fix(lantern): own and bound CDP network sessions"
```

### Task 6: CLI/MCP Mapping, Bridge Identity, Timeouts, and Error Transport

**Files:**
- Modify: `clis/leo-lantern/lib/protocol.mjs`
- Modify: `clis/leo-lantern/lib/server.mjs`
- Modify: `clis/leo-lantern/lib/cli.mjs`
- Modify: `mcps/leo-lantern/lib/mcp-server.mjs`
- Modify: `clis/leo-lantern/tests/cli.test.mjs`
- Modify: `clis/leo-lantern/tests/server.test.mjs`
- Modify: `mcps/leo-lantern/tests/mcp.test.mjs`

**Interfaces:**
- Produces: stable health identity, `LanternProtocolError`, alias normalization, and `commandTimeoutFor(type, params)`.

- [ ] **Step 1: Add failing CLI mapping tests**

Cover `--full-page`/`--fullPage`, all bypass/same-window/close-group/timeout aliases, server host/port, explicit false versus omission, and wait timeout plus 2,000 ms.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/cli.test.mjs`

Expected: FAIL on full-page, lowercase aliases, server params, and omitted values.

- [ ] **Step 3: Implement canonical normalization and timeout forwarding**

Normalize raw parameter keys once, include booleans only when provided, instantiate the server with parsed host/port, and set `/cmd.timeoutMs` for waits to `requested + 2000`.

- [ ] **Step 4: Add failing Bridge/MCP identity and error tests**

Assert health includes `service: "leo-lantern"`; generic `{ok:true}` on an occupied port is rejected; extension errors retain objects through HTTP 422, CLI stderr, and MCP `isError` plus `structuredContent`.

- [ ] **Step 5: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/server.test.mjs mcps/leo-lantern/tests/mcp.test.mjs`

Expected: FAIL because identity and errors are currently flattened.

- [ ] **Step 6: Implement stable Bridge errors and remote probe**

Attach the original payload to internal errors, map HTTP status by code, verify all three health identity fields, and make MCP unavailable rather than remote when probing fails.

- [ ] **Step 7: Run Phase 1 focused suite and commit**

Run: `npm run test:leo-lantern`

```bash
git add clis/leo-lantern/lib/protocol.mjs clis/leo-lantern/lib/server.mjs clis/leo-lantern/lib/cli.mjs mcps/leo-lantern/lib/mcp-server.mjs clis/leo-lantern/tests/cli.test.mjs clis/leo-lantern/tests/server.test.mjs mcps/leo-lantern/tests/mcp.test.mjs
git commit -m "fix(lantern): preserve adapter options and protocol errors"
```

### Task 7: Phase 1 Gate and Historical Bug Review

**Files:**
- Modify only files required by failures found during verification.

**Interfaces:**
- Consumes all Phase 1 tasks.
- Produces a green, reviewed stabilization baseline before Phase 2.

- [ ] **Step 1: Run syntax checks**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 2: Run the complete Lantern suite**

Run: `npm run test:leo-lantern`

Expected: PASS with no skipped stabilization cases.

- [ ] **Step 3: Review the Phase 1 diff**

Run: `git diff feat/browser-bridge-dual-mode...HEAD --check && git status --short`

Inspect every task-boundary mutation, catch block, timeout, result routing path, and debugger detach path. Add a failing regression test before fixing any issue found.

- [ ] **Step 4: Commit only if review produces fixes**

```bash
git add -u
git commit -m "fix(lantern): close stabilization review gaps"
```

### Task 8: Target Schema, Semantic Matching, and Document Registry

**Files:**
- Create: `extensions/leo-cookie-txt-locally/element-target.mjs`
- Create: `clis/leo-lantern/tests/element-target.test.mjs`

**Interfaces:**
- Produces: `normalizeTarget(params)`, `ensureDocumentRegistry(globalObject)`, `collectState(document, registry)`, `findTargets(document, registry, target)`, `fingerprintElement(element)`, and `resolveRef(document, registry, target)`.

- [ ] **Step 1: Write failing target-schema tests**

Assert exactly one target form, ref requires integer plus generation, semantic fields combine with AND, explicit semantic text defaults exact, and legacy text translates to contains.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/element-target.test.mjs`

Expected: FAIL because `element-target.mjs` does not exist.

- [ ] **Step 3: Implement schema normalization and deterministic semantic helpers**

Implement whitespace/case normalization, implicit roles, accessible-name precedence, visibility, disabled state, label association, and test ID matching as pure functions over DOM-like test fixtures.

- [ ] **Step 4: Add failing registry/state/find tests**

Cover deterministic DOM order, 200-response bound, generation creation, numeric refs, same-document ref reuse, 1,000-record LRU eviction, registry loss, zero-match find success, selector syntax errors, and same-document worker restart behavior.

- [ ] **Step 5: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/element-target.test.mjs`

Expected: FAIL on registry/state/find assertions.

- [ ] **Step 6: Implement registry, state, and find**

Keep reverse identity in a WeakMap, store fingerprints plus WeakRefs in the access-ordered Map, and return `{ url, title, generation, elements }` or `{ generation, matches_n, elements }`.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/element-target.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/element-target.mjs clis/leo-lantern/tests/element-target.test.mjs
git commit -m "feat(lantern): add stable document targets"
```

### Task 9: Fingerprint Resolution and Safe Reidentification

**Files:**
- Modify: `extensions/leo-cookie-txt-locally/element-target.mjs`
- Modify: `clis/leo-lantern/tests/element-target.test.mjs`

**Interfaces:**
- Extends: `resolveRef` to return `{ element, ref, generation, matchLevel }`.

- [ ] **Step 1: Write failing fingerprint decision-table tests**

Cover exact original node, connected node losing a stable attribute resolving `stable`, connected soft-field changes, unique disconnected-node replacement, hard conflicts, below-threshold candidate, score tie, margin below 10, stale generation, evicted ref, and cross-tab registry use.

- [ ] **Step 2: Run and verify failure**

Run: `node --test --test-name-pattern="fingerprint|ref" clis/leo-lantern/tests/element-target.test.mjs`

Expected: FAIL because scoring/reidentification is not implemented.

- [ ] **Step 3: Implement the exact scoring table**

Apply hard conflicts, weights `100/80/50/40/20/20/10/5`, acceptance thresholds, unique-best requirement, and 10-point margin exactly as specified.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/element-target.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/element-target.mjs clis/leo-lantern/tests/element-target.test.mjs
git commit -m "feat(lantern): resolve stable element fingerprints"
```

### Task 10: State/Find Protocol Surfaces

**Files:**
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Modify: `clis/leo-lantern/lib/protocol.mjs`
- Modify: `clis/leo-lantern/lib/cli.mjs`
- Modify: `mcps/leo-lantern/lib/mcp-server.mjs`
- Modify: `clis/leo-lantern/tests/cli.test.mjs`
- Modify: `mcps/leo-lantern/tests/mcp.test.mjs`

**Interfaces:**
- Adds: `dom.state`, `dom.find`, CLI `state`/`find`, MCP `browser_state`/`browser_find`.

- [ ] **Step 1: Write failing CLI/MCP protocol mapping tests**

Assert the new commands and tools preserve `target`, `tabId`, `generation`, refs, `matches_n`, and structured locator errors.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/cli.test.mjs mcps/leo-lantern/tests/mcp.test.mjs`

Expected: FAIL because commands/tools are absent.

- [ ] **Step 3: Wire extension commands and adapters**

Resolve the task-owned tab first, execute the document helper in the extension isolated world, and return its envelope unchanged through Bridge/CLI/MCP.

- [ ] **Step 4: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/cli.test.mjs mcps/leo-lantern/tests/mcp.test.mjs clis/leo-lantern/tests/element-target.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/background.js clis/leo-lantern/lib/protocol.mjs clis/leo-lantern/lib/cli.mjs mcps/leo-lantern/lib/mcp-server.mjs clis/leo-lantern/tests/cli.test.mjs mcps/leo-lantern/tests/mcp.test.mjs
git commit -m "feat(lantern): expose state and find targets"
```

### Task 11: Ref-Aware Click and Verified Fill

**Files:**
- Create: `extensions/leo-cookie-txt-locally/interaction.mjs`
- Modify: `extensions/leo-cookie-txt-locally/background.js`
- Modify: `clis/leo-lantern/lib/cli.mjs`
- Modify: `mcps/leo-lantern/lib/mcp-server.mjs`
- Create: `clis/leo-lantern/tests/interaction.test.mjs`
- Modify: `clis/leo-lantern/tests/cli.test.mjs`
- Modify: `mcps/leo-lantern/tests/mcp.test.mjs`

**Interfaces:**
- Produces: `clickTarget(document, registry, normalizedTarget)` and `fillTarget(document, registry, normalizedTarget, value)`.

- [ ] **Step 1: Write failing interaction tests**

Cover ref exact/stable/reidentified click, CSS/semantic `located`, zero/ambiguous matches without action, disabled rejection, input/textarea/contenteditable fill, event dispatch, live verification, and `fill_verification_failed`.

- [ ] **Step 2: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/interaction.test.mjs`

Expected: FAIL because `interaction.mjs` does not exist.

- [ ] **Step 3: Implement unique resolution and interaction envelopes**

Allocate/touch refs for locator actions, echo the normalized target, return integer `ref`, generation, `matches_n: 1`, and the specified `match_level`; set contenteditable text through `textContent` and verify it after input/change events.

- [ ] **Step 4: Add failing adapter parity tests**

Assert CLI and MCP accept the same target union and preserve every success/error field.

- [ ] **Step 5: Run and verify failure**

Run: `node --test clis/leo-lantern/tests/cli.test.mjs mcps/leo-lantern/tests/mcp.test.mjs`

Expected: FAIL until adapter schemas/mappings are updated.

- [ ] **Step 6: Wire click/fill and preserve legacy behavior**

Translate legacy selector or text only under the target-conflict rules; route all interactions through validated task-owned tabs and the document registry.

- [ ] **Step 7: Run focused tests and commit**

Run: `node --test clis/leo-lantern/tests/interaction.test.mjs clis/leo-lantern/tests/cli.test.mjs mcps/leo-lantern/tests/mcp.test.mjs`

```bash
git add extensions/leo-cookie-txt-locally/interaction.mjs extensions/leo-cookie-txt-locally/background.js clis/leo-lantern/lib/cli.mjs mcps/leo-lantern/lib/mcp-server.mjs clis/leo-lantern/tests/interaction.test.mjs clis/leo-lantern/tests/cli.test.mjs mcps/leo-lantern/tests/mcp.test.mjs
git commit -m "feat(lantern): add safe ref-aware interactions"
```

### Task 12: Full Verification and Delivery Review

**Files:**
- Modify: `extensions/leo-cookie-txt-locally/README.md`
- Modify: `clis/leo-lantern/README.md`
- Modify: `mcps/leo-lantern/README.md`
- Modify only production/tests required by final failures.

**Interfaces:**
- Produces the complete stable-target MVP with documented CLI/MCP examples.

- [ ] **Step 1: Update usage documentation**

Document task isolation, state/find output, target union examples, generation requirements, match levels, error objects, network recovery semantics, and all CLI aliases.

- [ ] **Step 2: Run syntax verification**

Run: `npm run check`

Expected: PASS.

- [ ] **Step 3: Run all Lantern tests**

Run: `npm run test:leo-lantern`

Expected: PASS with all Phase 1 and Phase 2 regression cases.

- [ ] **Step 4: Inspect final diff and worktree**

Run: `git diff feat/browser-bridge-dual-mode...HEAD --check && git status --short`

Verify no generated files, secrets, debugging logs, ignored failures, unbounded caches, or task-boundary bypasses remain.

- [ ] **Step 5: Commit docs or final review fixes**

```bash
git add extensions/leo-cookie-txt-locally/README.md clis/leo-lantern/README.md mcps/leo-lantern/README.md
git add -u
git commit -m "docs(lantern): document stable target protocol"
```
