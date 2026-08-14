# Antigravity Host Backend Probe

**日期：** 2026-08-14  
**状态：** 待实测  
**关联设计：** `docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md`  
**关联实现计划：** `docs/superpowers/plans/2026-08-14-antigravity-remote-session.md`  
**目标阶段：** Phase 2 前置探测，不阻塞 Phase 1

---

## 1. Goal

Find a **non-asar-modifying** way for Host Gateway to attach the **already-running** Antigravity backend that the desktop UI uses.

Success means Remote Session can:

1. detect that Antigravity is running on Host
2. attach the same backend the desktop UI is using
3. list projects
4. create/bind a conversation
5. dispatch prompt
6. subscribe to events (text / tools / terminal / diff)
7. receive and decide approvals
8. preferably make the conversation visible in Host desktop UI (Joint Session)

If any step is impossible without patching the install package, document it as a hard blocker and keep the domain layer on a fake-host adapter.

---

## 2. Hard constraints

- Do **not** modify Antigravity `app.asar` / install package internals
- Do **not** make CDP UI automation the main path
- Do **not** invent a separate headless session world as the main Joint Session path
- Prefer attach-to-running-backend over launching a second hidden backend
- Probe code must be injectable and unit-testable without a real Antigravity install

---

## 3. Probe order

Run in this order and stop only after recording evidence for each step.

### 3.1 Process presence

Check whether Host currently has:

- Antigravity desktop process
- `language_server` / related helper processes

Record:

- process names
- PIDs
- command lines if available
- install root if derivable

### 3.2 Install / binary discovery

Reuse path ideas from `lib/antigravity/client-discovery.mjs` only for filesystem roots, not for cloud auth:

- Windows: `%LOCALAPPDATA%\Programs\Antigravity`, Program Files candidates
- macOS: `/Applications/Antigravity.app`
- Linux: `~/.local/share/Antigravity`, `/opt/Antigravity`

Record:

- install root
- whether `language_server` binary exists
- whether logs / state directories exist

### 3.3 Local discovery artifacts

Search for local control surfaces:

- loopback ports
- named pipes / sockets
- discovery files
- `persistent_mode` traces
- recent logs mentioning local API / agent backend / conversation store

Known background clue only (not a contract):

- older notes mention local ports `6045` / `6046`

### 3.4 Candidate local APIs

For each candidate endpoint, test:

1. health / version
2. auth requirements
3. project list
4. conversation list/create
5. event subscribe
6. approval subscribe/decide

Possible families to inspect:

- language_server HTTP/gRPC
- agentapi-like local control APIs
- any loopback gateway already opened by desktop

### 3.5 Project list capability

Need a stable shape roughly like:

```json
{
  "projects": [
    { "id": "p1", "name": "demo", "path": "/path/to/project" }
  ]
}
```

Record:

- endpoint
- request/response sample
- whether path is absolute and usable

### 3.6 Conversation create capability

Need:

```json
{
  "conversationId": "c1",
  "projectId": "p1"
}
```

Record whether created conversation becomes visible to desktop UI.

### 3.7 Event subscribe capability

Need stream or poll for at least:

- assistant_text
- tool_call
- terminal
- diff
- approval_required
- turn_completed

Prefer SSE/WebSocket/local stream. Polling is acceptable only as temporary fallback.

### 3.8 Approval capability

Need:

- pending approval list or push event
- decide allow/deny from controller session

Record whether Host UI also sees the same approval.

### 3.9 Joint visibility check

After remote create/dispatch:

1. Does Host Antigravity show the conversation?
2. Does it update live without manual refresh?
3. If not, is there any supported “open conversation” hook?

If conversation executes but UI never sees it, mark Joint Session as **partial**.

---

## 4. Known background clues

- `language_server` binary exists under install resources
- existing `lib/antigravity/*` is primarily **cloud/provider integration**, not desktop host-session control
- older internal notes mention ports `6045` / `6046` only as background, not a stable contract
- Dream Skin CDP launcher patterns are **not** the Remote Session attach path

---

## 5. Adapter contract expected by implementation

Probe results should feed one adapter interface:

```js
HostBackend = {
  id,
  capabilities(),
  isRunning(),
  attach(),
  listProjects(),
  createConversation(projectId),
  dispatchPrompt({ conversationId, prompt, controllerPeerId }),
  subscribeEvents({ conversationId, cursor }),
  listPendingApprovals(conversationId),
  decideApproval({ conversationId, approvalId, decision, controllerPeerId }),
  getConversation(conversationId),
}
```

If real attach is incomplete:

- `createLocalHostBackend` may throw:
  - `host_backend_unavailable` when Antigravity is not running
  - `host_backend_unsupported` when no safe attach surface exists
  - `unsupported_feature` for specific missing methods
- domain/service tests continue on `createFakeHostBackend`

---

## 6. Required output of a real probe run

Fill this table after measuring a machine with Antigravity installed/running.

| Capability | Status | Evidence | Notes |
| --- | --- | --- | --- |
| process presence | pending |  |  |
| install root discovery | pending |  |  |
| local port/socket discovery | pending |  |  |
| project list API | pending |  |  |
| conversation create API | pending |  |  |
| event subscribe API | pending |  |  |
| approval decide API | pending |  |  |
| joint UI visibility | pending |  |  |

Also attach:

- sample request/response fixtures if any API works
- exact blocker text if Joint Session cannot be proven
- recommended first-slice mode:
  - `fake`
  - `local-host partial`
  - `local-host full`
  - `peer full`

---

## 7. Decision rules for Phase 2

1. If process detection works but no attach API:
   - ship domain + fake host + clear unsupported errors
   - do not fake Joint Session success
2. If attach/project/conversation work but events/approvals incomplete:
   - mark Remote Session as partial
   - keep controller-led protocol stable
3. If full coding loop works but desktop UI does not show conversation:
   - accept as Phase 2 functional success with Joint UX gap
4. Only claim Phase 2 complete when A can drive a real Host coding turn with approvals and Host-side authority

---

## 8. Immediate next actions

1. Implement probe skeleton in `lib/remote-session/host-attach/probe.mjs`
2. Implement fake host fully for domain tests
3. Run real-machine probe on at least one Host
4. Update this document with measured results before claiming Joint Session support
