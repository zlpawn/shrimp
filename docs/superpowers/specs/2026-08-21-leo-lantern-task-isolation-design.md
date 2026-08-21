# Leo Lantern Task Isolation Design

## Goal

Add product-grade task isolation to Leo Lantern so CLI and MCP can drive the user's real Chrome without polluting everyday browsing.

This phase covers only task isolation:

- start / reuse / end a single active task
- claim a tab into an Agent-owned group
- default independent background window
- same-task single-tab reuse unless `--force`
- restore task state across MV3 service-worker restarts

Out of scope for this phase:

- `wait` / `content` / `press` / `reload` page-driving upgrades
- CDP network capture (`net-start` / `net-get` / `net-stop`)
- OpenCLI-style element refs / AX targeting
- bridge discovery for non-default ports
- auth token work already deferred

Success means an agent can run:

1. `start-task`
2. repeated `new-tab --url ...`
3. `claim` only when explicitly needed
4. `end-task`

and by default will not steal focus, will not rename the user's existing tab groups, and will survive extension service-worker restart with a recoverable active task.

## Architecture

Keep the existing dual-mode control path:

```text
CLI / MCP
  -> Lantern bridge :19527
  -> extension long-poll
  -> real Chrome tabs / groups / windows
```

Authority split:

- Extension owns the authoritative task state.
- Bridge caches a task summary for `doctor` and MCP queries.
- CLI / MCP remain thin adapters over `/cmd` and local bridge helpers.

Why extension-owned state:

- Task isolation ultimately mutates Chrome `tabs` / `tabGroups` / `windows`.
- MV3 service workers restart often; state must live in extension storage.
- Bridge restart should not invent new Chrome IDs; it should resync from extension hello / heartbeat / command results.

Open/closed shape:

- Core poll / dispatch / result loop stays unchanged.
- New commands register as handlers and protocol constants.
- Window / tab / group behavior is implemented behind strategy modules so later phases can add wait/network without rewriting task isolation.
- Task state includes a reserved `extensions` object for future feature-private fields.

## Data Model

Authoritative state in the extension:

```json
{
  "version": 1,
  "activeTask": {
    "taskId": "task_01HZX...",
    "title": "deploy-core",
    "color": "blue",
    "groupId": 123,
    "windowId": 45,
    "claimedTabId": 678,
    "sameWindow": false,
    "createdAt": 1710000000000,
    "updatedAt": 1710000000000,
    "extensions": {}
  }
}
```

Rules:

- At most one active task at a time.
- `activeTask = null` means idle.
- `groupId`, `windowId`, and `claimedTabId` are Chrome IDs and must be revalidated after restore.
- Invalid IDs are cleared; the next `task.start` recreates what is missing.
- `extensions` is opaque to core `doctor` summary logic.

Bridge cache summary:

```json
{
  "online": true,
  "task": {
    "taskId": "task_01HZX...",
    "title": "deploy-core",
    "groupId": 123,
    "windowId": 45,
    "claimedTabId": 678,
    "sameWindow": false,
    "updatedAt": 1710000000000
  }
}
```

The bridge never allocates Chrome tab/group/window IDs itself.

## Command Contract

### `task.start`

Params:

- `title?: string`
- `color?: string`
- `sameWindow?: boolean` default `false`
- `focus?: boolean` default `false`

Behavior:

- If an active task exists, reuse it and refresh title/color only when provided.
- If idle, create Agent-owned task state and ensure the target window exists.
- Default window strategy: create or reuse an independent background window immediately on start.
- `--same-window` / `sameWindow=true` keeps work in the current window and does not create a new window.
- Task group may be created lazily on first claimed/new tab if Chrome requires a tab before grouping, but the chosen window strategy is fixed at start.
- Never adopt or rename an existing user work group as the task group.

### `tabs.claim`

Params:

- `tabId: number|string` (required)
- `focus?: boolean` default `false`
- `sameWindow?: boolean` default inherits active task / start defaults

Behavior:

- `tabId` is required.
- Claiming the user's current active tab is never inferred; the caller must pass that tab's id explicitly.
- If no active task exists, fail and ask the caller to `task.start` first.
- Detach the target tab from any existing user group, then place it into the Agent task group.
- Update `claimedTabId` and task summary.

### `tabs.new`

Params:

- `url: string`
- `force?: boolean` default `false`
- `focus?: boolean` default `false`

Behavior:

- Requires an active task. If idle, fail and ask the caller to `task.start` first.
- If `claimedTabId` exists and `force` is false, navigate that tab to `url`.
- If there is an active task but no `claimedTabId`, create one tab in the task window/group and claim it.
- Only `force=true` creates an additional tab in the task group.
- Default remains unfocused / background.

### `tabs.goto`

Params:

- `url: string`
- `tabId?: number|string`
- `focus?: boolean` default `false`

Behavior:

- Requires an active task. If idle, fail and ask the caller to `task.start` first.
- Navigate the claimed tab by default.
- If a specific `tabId` is provided, navigate that tab only when it belongs to the active task context; do not silently operate on arbitrary user tabs outside task rules.

### `task.end`

Params:

- `closeGroup?: boolean` default `false`

Behavior:

- Clear active task state.
- Default does not close the user's unrelated everyday tabs.
- Optional `closeGroup=true` may dissolve/close the Agent-owned group according to safe Chrome group APIs, without reabsorbing user groups.

### Surfaces

CLI:

- `leo-lantern start-task`
- `leo-lantern claim`
- `leo-lantern end-task`
- existing `new-tab` / `goto` obey the new task policy

MCP:

- `browser_start_task`
- `browser_claim_tab`
- `browser_end_task`
- existing `browser_new_tab` / `browser_goto` obey the same policy

`doctor` / `browser_doctor` must include the bridge-cached task summary.

## Default Product Semantics

1. Independent background window by default.
2. Same-task single-tab reuse by default.
3. No focus stealing unless `focus=true`.
4. No adoption of the user's existing named/work groups.
5. Claim is allowed, but never the default path for ordinary automation.
6. Fail closed: no silent fallback to anonymous tabs, random current tabs, or 9222.

## Persistence And Recovery

- Persist authoritative state in extension storage.
- On startup / alarm wake / hello:
  - load state
  - validate group/window/tab IDs against Chrome
  - clear broken references
  - sync summary to bridge
- If the claimed tab disappeared but the task still exists, keep the task and require the next `new-tab` / `claim` to re-establish `claimedTabId`.
- If the task group disappeared, recreate on next mutating task command rather than pretending isolation still holds.

## Error Handling

Explicit failures for:

- extension offline
- corrupt / unreadable task state
- claim target missing
- attempting to break single-tab policy without `force`
- operating when required task context cannot be established

Errors return stable message text through the existing `{ ok: false, error }` path. No silent degradation.

## Testing Strategy

Minimum coverage:

1. Task policy unit tests
   - reuse active task on repeated `start`
   - single-tab reuse vs `force`
   - claim does not adopt existing groups
2. Persistence tests
   - restore valid state
   - clear invalid Chrome IDs after restart
3. Bridge summary sync tests
   - doctor shows active task summary after command result / hello
4. CLI and MCP adapter tests
   - new commands map to protocol types and params
   - `new-tab` / `goto` pass `force` / `focus` correctly

Manual acceptance:

1. `start-task` opens or uses a background window without focusing the user.
2. two `new-tab` calls without `--force` stay on one claimed tab.
3. `claim --tabId` moves only that tab into the Agent group.
4. reload the extension; `doctor` still shows recoverable task state or a cleanly cleared idle state if Chrome IDs died.
5. MCP and CLI can both finish the same mini flow.

## Implementation Boundaries

Touch:

- `extensions/leo-cookie-txt-locally/` task state + handlers
- `clis/leo-lantern/` protocol/CLI adapters/tests
- `mcps/leo-lantern/` tool adapters/tests
- shared bridge summary fields used by doctor
- this design's follow-up implementation plan

Avoid:

- rewriting the long-poll engine
- gateway cookie-export redesign
- page-orb / CORS / token work in this phase

## Rollout

Ship on `feat/browser-bridge-dual-mode` as an additive phase after the current hardened bridge work. Keep cookie export behavior unchanged. After this phase lands, page-driving upgrades and network capture can register as new command families without changing the task-state core.
