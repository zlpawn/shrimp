# Antigravity Remote Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Close Phase 1 NAT Traversal gaps, then ship Phase 2 Remote Session so machine A can open a controller-led coding session on machine B's already-running Antigravity backend over a stable peer link.

**Architecture:** Keep two modules separate. lib/nat-traversal owns tunnels, peers, link health, and frps dashboard proxy. lib/remote-session owns session lifecycle, host backend attach, prompt/event/approval relay, and resume. Remote Session depends only on NAT Traversal link API ensureLink / openService / testLink, never on frpc.ini or process details. Host execution stays on B; A is controller-led and holds only a projection/cache.

**Tech Stack:** Node.js ESM, existing Gateway HTTP + local auth, SSE event streams, injected fake host backend for unit tests, frpc provider already in-tree, desktop panel TypeScript modules.

## Global Constraints

- Product path is Client <-> multi-host agent backend, not CDP remote desktop and not a separate headless session world as the main path.
- Do not modify Antigravity app.asar / install package internals.
- Do not make Dream Skin a dependency of Remote Session. Dream Skin is unrelated product surface; only the existing system-extension packaging style may be reused as engineering pattern.
- NAT Traversal remains independently useful when Remote Session is disabled.
- 
emoteSession.enabled = true requires 
atTraversal.enabled = true.
- Secrets stay out of public config and frontend echo: frpc token, dashboard auth, any remote auth material.
- Host is the authority for conversation/execution/approvals/quota/workspace.
- Controller disconnect must not abort the current host turn; resume uses sessionId + event cursor.
- Phase 2 first UI is Gateway panel orchestration on A; Antigravity-native UI can come later without changing domain APIs.
- All new modules must be dependency-injected and unit-testable without real public frps or a real Antigravity install.
- Prefer fake host adapters in tests; real host probe results are recorded as notes and wired through one adapter interface.
- Work in the existing worktree at .worktrees/antigravity-remote-session on branch codex/antigravity-remote-session.

---

## Design Alignment Snapshot (write this into docs while implementing)

These are the Phase 1 design-vs-code decisions already made by the branch. The plan treats them as accepted unless a task explicitly revisits them.

| Topic | Original design | Current code | Plan decision |
| --- | --- | --- | --- |
| Dashboard UX | Prefer in-panel iframe reverse proxy | Gateway reverse proxy + open in new tab | Keep proxy + new tab. Document as accepted. Optional later iframe is non-blocking. |
| Local frpc import | Optional later | discover-frpc / import-frpc already shipped | Keep. Token stays in original frpc file; do not copy into gateway secrets by default. |
| Provider methods | ensureLink / openService on provider | Present on providers/frpc.mjs, not on service public surface | Expose through service + routes before Remote Session consumes them. |
| CLI | shrimp nat-traversal ... | Not required for Phase 1 acceptance | Optional after HTTP/panel are solid; do not block Remote Session. |
| Cross-platform tests | Core unit tests must pass | 2 Windows failures: shell fake binary + path-separator assertion | Fix in Task 1 before new feature work. |
| Host attach | Hang on already-running backend | Unknown official API surface | Probe-first adapter; if official attach is incomplete, ship blocked/partial attach with explicit error and fake-host path for domain tests. |

---

## File Structure

### Phase 1 closeout

- Modify: 	ests/unit/nat-traversal.test.mjs
- Modify: lib/nat-traversal/process/frpc-supervisor.mjs only if needed for injectable spawn / Windows fake binary support
- Modify: lib/nat-traversal/infra/frpc-config-io.mjs only if candidate-path tests need platform-safe matching helpers
- Modify: lib/nat-traversal/application/service.mjs
- Modify: lib/nat-traversal/http/routes.mjs
- Modify: lib/nat-traversal/index.mjs if new exports are needed
- Modify: docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md
- Create: docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md

### Phase 2 Remote Session

Create:

`	ext
lib/remote-session/
  index.mjs
  paths.mjs
  domain/
    errors.mjs
    config-schema.mjs
    session.mjs
    protocol.mjs
    status.mjs
  application/
    service.mjs
  host-attach/
    contract.mjs
    probe.mjs
    fake-host.mjs
    local-host.mjs
  transport/
    peer-client.mjs
    event-log.mjs
  http/
    routes.mjs
desktop/src/modules/remote-session.ts
tests/unit/remote-session-domain.test.mjs
tests/unit/remote-session-service.test.mjs
tests/unit/remote-session-host-attach.test.mjs
tests/integration/remote-session-api.test.mjs
`

Modify:

`	ext
server.js
desktop/src/main.ts
desktop/index.html
desktop/src/app.ts
desktop/src/styles/main.css
package.json
`

Responsibility boundaries:

- domain/*: pure session/protocol/config rules, no network/fs side effects beyond pure transforms.
- host-attach/*: discover/attach B's Antigravity backend; only place that knows host process details.
- 	ransport/*: peer HTTP/SSE client and append-only event log/cursor.
- pplication/service.mjs: only use-case entrypoint; injects natTraversal + hostAttach + eventLog.
- http/routes.mjs: parse/map only.
- Desktop module: operator UI for enable, peer/project pick, open session, approvals, event tail. Not the authority.


### Task 1: Phase 1 test hard-close and platform-safe NAT baseline

**Files:**
- Modify: `tests/unit/nat-traversal.test.mjs`
- Modify: `lib/nat-traversal/process/frpc-supervisor.mjs` if spawn strategy must accept Windows-safe fake binaries
- Modify: `lib/nat-traversal/infra/frpc-config-io.mjs` only if a path helper is needed
- Test: `tests/unit/nat-traversal.test.mjs`

**Interfaces:**
- Consumes: existing `createFrpcSupervisor`, `listFrpcCandidatePaths`
- Produces: green Windows/macOS unit baseline for NAT Traversal

- [ ] **Step 1: Rewrite the fake-binary supervisor test for cross-platform spawn**

Preferred concrete approach, pick one and keep it minimal:

1. Inject `spawnImpl` into `createFrpcSupervisor` and fake a running child process in the test.
2. Or generate a platform-native fake binary:
   - win32: `fake-frpc.cmd` with a tiny loop
   - posix: executable shell/node script

Recommended test shape with injection:

```js
test("frpc supervisor start/stop with fake binary", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frpc-sup-"));
  const configPath = path.join(tmp, "frpc.toml");
  const pidPath = path.join(tmp, "frpc.pid");
  const logPath = path.join(tmp, "frpc.log");
  fs.writeFileSync(configPath, 'serverAddr = "x"\n');

  const children = [];
  const spawnImpl = () => {
    const handlers = { error: [], exit: [] };
    const child = {
      pid: 4242,
      killed: false,
      stdout: { on() {} },
      stderr: { on() {} },
      on(event, cb) {
        handlers[event] = handlers[event] || [];
        handlers[event].push(cb);
      },
      kill() {
        this.killed = true;
        for (const cb of handlers.exit || []) cb(0, null);
        return true;
      },
    };
    children.push(child);
    return child;
  };

  const supervisor = createFrpcSupervisor({
    binPath: path.join(tmp, "fake-frpc"),
    configPath,
    pidPath,
    logPath,
    spawnImpl,
    isPidAlive: (pid) => children.some((c) => c.pid === pid && !c.killed),
  });

  const started = await supervisor.start();
  assert.equal(started.status, "running");
  assert.equal(started.pid, 4242);

  const stopped = await supervisor.stop();
  assert.equal(stopped.status, "stopped");
});
```

- [ ] **Step 2: Run the current suite and confirm the old failures**

Run:

```bash
node --test tests/unit/nat-traversal.test.mjs
```

Expected: still shows the old failures until Step 3/4 land.

- [ ] **Step 3: Implement the minimal supervisor testability fix**

If injection is chosen, update construction to accept:

```js
export function createFrpcSupervisor({
  binPath,
  configPath,
  pidPath,
  logPath,
  spawnImpl = spawn,
  isPidAlive,
} = {}) {
  // use spawnImpl(binPath, ["-c", configPath], {...})
}
```

Keep production defaults unchanged.

- [ ] **Step 4: Fix candidate path assertion to be platform-safe**

```js
test("listFrpcCandidatePaths finds versioned frp directories", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "frp-detect-"));
  const dir = path.join(tmp, "frp_0.71.0_darwin_arm64");
  fs.mkdirSync(dir, { recursive: true });
  const cfg = path.join(dir, "frpc.toml");
  fs.writeFileSync(cfg, 'serverAddr = "1.2.3.4"\nserverPort = 7000\n');
  const found = listFrpcCandidatePaths({ homeDir: tmp, env: {}, whichBin: () => "" });
  assert.ok(
    found.some((f) =>
      path.normalize(f).endsWith(path.normalize(path.join("frp_0.71.0_darwin_arm64", "frpc.toml"))),
    ),
  );
});
```

- [ ] **Step 5: Re-run tests and confirm green**

Run:

```bash
node --test tests/unit/nat-traversal.test.mjs
npm run check
```

Expected: NAT unit suite green, `npm run check` pass.

- [ ] **Step 6: Commit**

```bash
git add tests/unit/nat-traversal.test.mjs lib/nat-traversal/process/frpc-supervisor.mjs lib/nat-traversal/infra/frpc-config-io.mjs
git commit -m "test: harden nat-traversal unit suite for windows"
```

---

### Task 2: Expose NAT link API for Remote Session consumers

**Files:**
- Modify: `lib/nat-traversal/application/service.mjs`
- Modify: `lib/nat-traversal/http/routes.mjs`
- Modify: `tests/unit/nat-traversal.test.mjs`
- Optional modify: `lib/nat-traversal/index.mjs`

**Interfaces:**
- Consumes: provider methods `ensureLink(peer)`, `linkStatus(peer)`, `openService(peer, service)`
- Produces:

```js
service.ensureLink(peerId) -> {
  peerId: string,
  provider: string,
  status: "online" | "offline" | "error" | "unknown",
  endpoint: string,
  message?: string,
}

service.openService(peerId, serviceName) -> {
  service: "gateway-api" | "antigravity-backend" | "health",
  endpoint: string,
}
```

- [ ] **Step 1: Write failing service tests for ensureLink/openService**

```js
test("service ensureLink requires known peer", async () => {
  await assert.rejects(
    () => service.ensureLink("missing"),
    (error) => error.code === "peer_not_found",
  );
});

test("service openService returns gateway-api endpoint from peer services", async () => {
  await service.updateConfig({
    enabled: true,
    frpc: {
      serverAddr: "1.2.3.4",
      serverPort: 7000,
      proxies: [],
    },
    peers: [{
      id: "home",
      displayName: "Home",
      services: { gatewayApi: "127.0.0.1:18788" },
    }],
  });
  const endpoint = await service.openService("home", "gateway-api");
  assert.equal(endpoint.service, "gateway-api");
  assert.equal(endpoint.endpoint, "127.0.0.1:18788");
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/unit/nat-traversal.test.mjs
```

Expected: FAIL because service does not export `ensureLink` / `openService`.

- [ ] **Step 3: Implement service wrappers**

```js
async function ensureLink(peerId) {
  const cfg = getConfig();
  const peer = cfg.peers.find((item) => item.id === peerId);
  if (!peer) throw new NatTraversalError("peer_not_found", `peer '${peerId}' not found`);
  return activeProvider(cfg).ensureLink(peer);
}

async function openService(peerId, serviceName) {
  const cfg = getConfig();
  const peer = cfg.peers.find((item) => item.id === peerId);
  if (!peer) throw new NatTraversalError("peer_not_found", `peer '${peerId}' not found`);
  return activeProvider(cfg).openService(peer, serviceName);
}
```

Return them from the service object next to `testLink`.

- [ ] **Step 4: Add HTTP routes**

```text
POST /v1/nat-traversal/ensure-link   body: { peerId }
POST /v1/nat-traversal/open-service body: { peerId, service }
```

- [ ] **Step 5: Run tests and check**

```bash
node --test tests/unit/nat-traversal.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/nat-traversal/application/service.mjs lib/nat-traversal/http/routes.mjs tests/unit/nat-traversal.test.mjs
git commit -m "feat: expose nat-traversal ensureLink and openService"
```

---

### Task 3: Align design docs with Phase 1 reality and probe checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md`
- Create: `docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md`

**Interfaces:**
- Produces: accepted Phase 1 decisions + host probe checklist that Task 4/5 implement against

- [ ] **Step 1: Patch the design doc status and Phase 1 acceptance notes**

Update header:

```md
**状态：** Phase 1 已实现，待 Phase 2
**工作区：** `.worktrees/antigravity-remote-session`
```

Add a short Implementation deltas subsection under NAT Traversal:

```md
### Phase 1 implementation deltas

- frps Dashboard uses gateway reverse proxy and opens in a new tab by default; in-page iframe is deferred.
- Local frpc discovery/import is supported; token remains in the source frpc config file by default.
- Provider-level ensureLink/openService are exposed via service/API for Remote Session.
```

- [ ] **Step 2: Create host backend probe note with explicit success criteria**

Write `docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md` containing:

```md
# Antigravity Host Backend Probe

## Goal
Find a non-asar-modifying way for Host Gateway to attach the already-running Antigravity backend that the desktop UI uses.

## Probe order
1. Process presence: Antigravity / language_server running
2. Local discovery artifacts: ports, sockets, pipes, persistent_mode files, logs
3. Candidate local APIs: language_server HTTP/gRPC, agentapi, any loopback control port
4. Project list capability
5. Conversation create capability
6. Event subscribe capability
7. Approval subscribe/decide capability
8. Joint visibility: does desktop UI see the created conversation?

## Known background clues
- language_server binary exists under install resources
- older notes mention local ports 6045/6046 as background only, not a contract
- existing `lib/antigravity/*` is cloud/provider integration, not desktop host-session control

## Required output of probe run
- adapter method support matrix
- sample request/response fixtures if any API works
- hard blockers if Joint Session cannot be proven
```

- [ ] **Step 3: Commit docs**

```bash
git add docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md
git commit -m "docs: align remote-session design with phase1 and host probe"
```


---

### Task 4: Remote Session domain model, config, and protocol codec

**Files:**
- Create: `lib/remote-session/domain/errors.mjs`
- Create: `lib/remote-session/domain/config-schema.mjs`
- Create: `lib/remote-session/domain/session.mjs`
- Create: `lib/remote-session/domain/protocol.mjs`
- Create: `lib/remote-session/domain/status.mjs`
- Create: `lib/remote-session/index.mjs`
- Create: `tests/unit/remote-session-domain.test.mjs`

**Interfaces:**
- Produces:

```js
defaultRemoteSessionConfig() -> { enabled: false }
normalizeRemoteSessionConfig(input) -> { enabled: boolean }
validateRemoteSessionConfig(input, { natTraversalEnabled }) -> config

createSessionRecord({
  id, controllerPeerId, hostPeerId, hostProjectId, hostConversationId
}) -> RemoteSession

SESSION_STATES = [
  "connecting", "ready", "running",
  "awaiting_approval", "disconnected", "ended"
]

canTransition(from, to) -> boolean
encodeMessage(type, payload) -> { type, payload, ts }
decodeMessage(raw) -> { type, payload, ts }
assertControllerAction(session, actorPeerId, action) -> void
```

Protocol message types exactly:

```text
PEER_HELLO
ATTACH_BACKEND
LIST_PROJECTS
CREATE_SESSION
DISPATCH_PROMPT
SESSION_EVENT
APPROVAL_REQUIRED
APPROVAL_DECISION
RESUME_SESSION
SESSION_END
```

- [ ] **Step 1: Write failing domain tests**

```js
test("remote session requires natTraversal enabled", () => {
  assert.throws(
    () => validateRemoteSessionConfig({ enabled: true }, { natTraversalEnabled: false }),
    (error) => error.code === "dependency_disabled",
  );
});

test("only controller may decide approvals", () => {
  const session = createSessionRecord({
    id: "rs_1",
    controllerPeerId: "a",
    hostPeerId: "b",
    hostProjectId: "p1",
    hostConversationId: "c1",
  });
  assert.throws(
    () => assertControllerAction(session, "b", "APPROVAL_DECISION"),
    (error) => error.code === "not_controller",
  );
});

test("disconnect does not end session", () => {
  const session = createSessionRecord({ id: "rs_1", controllerPeerId: "a", hostPeerId: "b" });
  const next = transition(session, "disconnected");
  assert.equal(next.state, "disconnected");
  assert.notEqual(next.state, "ended");
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/unit/remote-session-domain.test.mjs
```

Expected: FAIL module not found.

- [ ] **Step 3: Implement pure domain modules**

Keep files small. `errors.mjs` should mirror NAT style:

```js
export class RemoteSessionError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
```

- [ ] **Step 4: Re-run domain tests**

```bash
node --test tests/unit/remote-session-domain.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/remote-session tests/unit/remote-session-domain.test.mjs
git commit -m "feat: add remote-session domain model and protocol"
```

---

### Task 5: Host-attach contract, probe, and fake host adapter

**Files:**
- Create: `lib/remote-session/host-attach/contract.mjs`
- Create: `lib/remote-session/host-attach/probe.mjs`
- Create: `lib/remote-session/host-attach/fake-host.mjs`
- Create: `lib/remote-session/host-attach/local-host.mjs`
- Create: `tests/unit/remote-session-host-attach.test.mjs`
- Modify: `docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md` with measured results if available

**Interfaces:**
- Produces:

```js
// HostBackend {
//   id, capabilities(), isRunning(), attach(), listProjects(),
//   createConversation(projectId), dispatchPrompt(...),
//   subscribeEvents(...), listPendingApprovals(...),
//   decideApproval(...), getConversation(...)
// }

createFakeHostBackend(seed?) -> HostBackend
createLocalHostBackend({ probe, logger }) -> HostBackend
probeLocalAntigravityBackend({ env, platform, fs, listProcesses, request }) -> ProbeReport
```

- [ ] **Step 1: Write failing contract tests with fake host**

```js
test("fake host supports coding loop primitives", async () => {
  const host = createFakeHostBackend({
    projects: [{ id: "p1", name: "demo", path: "/tmp/demo" }],
  });
  assert.equal(await host.isRunning(), true);
  await host.attach();
  const projects = await host.listProjects();
  assert.equal(projects[0].id, "p1");
  const { conversationId } = await host.createConversation("p1");
  const { turnId } = await host.dispatchPrompt({
    conversationId,
    prompt: "edit README",
    controllerPeerId: "a",
  });
  assert.ok(turnId);
});
```

```js
test("local host attach fails clearly when Antigravity is not running", async () => {
  const host = createLocalHostBackend({
    probe: async () => ({ running: false, reason: "process_not_found" }),
  });
  await assert.rejects(
    () => host.attach(),
    (error) => error.code === "host_backend_unavailable",
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/unit/remote-session-host-attach.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement fake host fully**

Fake host must cover:

- project list
- create conversation
- prompt dispatch
- streamed events (`assistant_text`, `tool_call`, `terminal`, `diff`, `approval_required`, `turn_completed`)
- approval decision
- resume from cursor

- [ ] **Step 4: Implement probe + local host skeleton**

`probeLocalAntigravityBackend` should check, in order:

1. process list for Antigravity / language_server
2. known install roots from `lib/antigravity/client-discovery.mjs` helpers if reusable for path only
3. candidate loopback ports / discovery files if found
4. return a structured report, never throw on "not found"

`createLocalHostBackend` should:

- call probe on attach
- if unsupported, throw `host_backend_unsupported` with the probe report
- if not running, throw `host_backend_unavailable` and message: open Antigravity on Host first

Do **not** invent asar patching. If no safe attach surface exists yet, leave methods throwing `unsupported_feature` while fake host remains the domain test double.

- [ ] **Step 5: Run host-attach tests**

```bash
node --test tests/unit/remote-session-host-attach.test.mjs
```

Expected: PASS for fake host and explicit local-host failure paths.

- [ ] **Step 6: Commit**

```bash
git add lib/remote-session/host-attach tests/unit/remote-session-host-attach.test.mjs docs/superpowers/specs/2026-08-14-antigravity-host-backend-probe.md
git commit -m "feat: add remote-session host attach contract and fake host"
```

---

### Task 6: Remote Session application service over NAT link + host backend

**Files:**
- Create: `lib/remote-session/paths.mjs`
- Create: `lib/remote-session/transport/event-log.mjs`
- Create: `lib/remote-session/transport/peer-client.mjs`
- Create: `lib/remote-session/application/service.mjs`
- Create: `tests/unit/remote-session-service.test.mjs`

**Interfaces:**
- Consumes:

```js
natTraversal.ensureLink(peerId)
natTraversal.openService(peerId, "gateway-api")
hostBackend.attach/listProjects/createConversation/dispatchPrompt/subscribeEvents/decideApproval
```

- Produces service API:

```js
createRemoteSessionService({
  configStore,
  natTraversal,
  hostBackendFactory,
  eventLogFactory,
  idFactory,
  clock,
  logger,
}) -> {
  getPublicConfig(),
  updateConfig(patch),
  status(),
  listPeers(),
  listProjects(peerId),
  openSession({ peerId, projectId, controllerPeerId }),
  dispatchPrompt({ sessionId, prompt, controllerPeerId }),
  listEvents({ sessionId, cursor }),
  subscribe({ sessionId, cursor }),
  decideApproval({ sessionId, approvalId, decision, controllerPeerId }),
  resumeSession({ sessionId, controllerPeerId, cursor }),
  endSession({ sessionId, controllerPeerId }),
}
```

- [ ] **Step 1: Write failing service tests using fake NAT + fake host**

```js
test("openSession attaches host backend and creates conversation", async () => {
  const service = makeService();
  await service.updateConfig({ enabled: true });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "controller-a",
  });
  assert.equal(session.state, "ready");
  assert.ok(session.hostConversationId);
});

test("dispatchPrompt emits events and can require approval", async () => {
  const service = makeService({
    host: createFakeHostBackend({
      projects: [{ id: "p1", name: "demo" }],
      scriptedTurns: [{
        events: [
          { type: "assistant_text", text: "editing" },
          { type: "approval_required", approvalId: "ap1", summary: "run rm" },
        ],
      }],
    }),
  });
  const session = await service.openSession({
    peerId: "local-host",
    projectId: "p1",
    controllerPeerId: "a",
  });
  await service.dispatchPrompt({
    sessionId: session.id,
    prompt: "delete temp",
    controllerPeerId: "a",
  });
  const events = await service.listEvents({ sessionId: session.id, cursor: 0 });
  assert.ok(events.some((e) => e.type === "approval_required"));
});
```

Also cover:

- non-controller cannot decide approval
- resume after disconnect continues from cursor
- controller disconnect does not end host turn

- [ ] **Step 2: Run tests to verify failure**

```bash
node --test tests/unit/remote-session-service.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement event log**

```js
export function createMemoryEventLog() {
  const events = [];
  return {
    append(event) {
      const record = { ...event, seq: events.length + 1, ts: event.ts || Date.now() };
      events.push(record);
      return record;
    },
    list(cursor = 0) {
      return events.filter((event) => event.seq > Number(cursor || 0));
    },
    latestSeq() {
      return events.length ? events[events.length - 1].seq : 0;
    },
  };
}
```

- [ ] **Step 4: Implement application service**

Critical behavior:

1. `openSession`
   - require `remoteSession.enabled`
   - `natTraversal.ensureLink(peerId)` when peer is remote; for local host mode, skip tunnel and attach local backend
   - `hostBackend.attach()`
   - `createConversation(projectId)`
   - state `ready`
2. `dispatchPrompt`
   - controller only
   - state `running`
   - append `SESSION_EVENT`s
   - on approval event -> state `awaiting_approval`
   - on turn complete -> state `ready`
3. `decideApproval`
   - controller only
   - hostBackend.decideApproval(...)
   - resume turn / state transition
4. `resumeSession`
   - mark connected
   - return snapshot + events after cursor
5. controller disconnect helper
   - state `disconnected`
   - do **not** cancel host turn

Phase 2 local simplification allowed and preferred for first vertical slice:

- Support `peerId = "local-host"` meaning "this machine is Host"
- Remote peer path can call peer gateway HTTP once local host path works
- Do not block local coding-loop tests on real dual-machine networking

- [ ] **Step 5: Run service tests**

```bash
node --test tests/unit/remote-session-service.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/remote-session/application lib/remote-session/transport lib/remote-session/paths.mjs tests/unit/remote-session-service.test.mjs
git commit -m "feat: add remote-session application service and event log"
```


---

### Task 7: HTTP routes, server mount, and integration tests

**Files:**
- Create: `lib/remote-session/http/routes.mjs`
- Modify: `lib/remote-session/index.mjs`
- Modify: `server.js`
- Create: `tests/integration/remote-session-api.test.mjs`

**Interfaces:**
- HTTP surface:

```text
GET  /v1/remote-session/capabilities
GET  /v1/remote-session/status
GET  /v1/remote-session/config
PUT  /v1/remote-session/config
GET  /v1/remote-session/projects?peerId=...
POST /v1/remote-session/sessions
GET  /v1/remote-session/sessions/:id
POST /v1/remote-session/sessions/:id/prompt
GET  /v1/remote-session/sessions/:id/events?cursor=0
GET  /v1/remote-session/sessions/:id/events/stream?cursor=0
POST /v1/remote-session/sessions/:id/approvals/:approvalId
POST /v1/remote-session/sessions/:id/resume
POST /v1/remote-session/sessions/:id/end
```

- [ ] **Step 1: Write failing integration test that boots routes with injected fakes**

Test `routeRemoteSessionRequest` directly first, then one thin server mount smoke if practical.

```js
test("POST sessions opens a fake-host remote session", async () => {
  const service = createRemoteSessionService({ /* fakes */ });
  // invoke route with mock req/res for POST /v1/remote-session/sessions
});
```

- [ ] **Step 2: Implement routes and error mapping**

Mirror NAT Traversal style:

```js
export async function routeRemoteSessionRequest(req, res, _context, reqPath, { service }) {
  // parse path/method, call service, map RemoteSessionError -> HTTP status
}
```

SSE response headers:

```js
res.writeHead(200, {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
});
```

Emit:

```text
id: <seq>
event: session_event
data: {...}
```

- [ ] **Step 3: Mount in server.js with local auth**

Follow existing pattern near NAT Traversal:

```js
if (reqPath.startsWith("/v1/remote-session")) {
  if (!checkLocalAuth(req, res)) return;
  await routeRemoteSessionRequest(req, res, context, reqPath, {
    service: ensureRemoteSessionService(),
  });
  return;
}
```

`ensureRemoteSessionService` must:

- read `GATEWAY_CONFIG.remoteSession`
- require/create host backend factory
- inject `ensureNatTraversalService()` as `natTraversal`
- save config via existing `saveGatewayState`, including `remoteSession`

Also extend config save allow-list wherever `dreamSkin` / `natTraversal` are persisted so `remoteSession` is not dropped.

- [ ] **Step 4: Run unit + integration tests**

```bash
node --test tests/unit/remote-session-domain.test.mjs tests/unit/remote-session-host-attach.test.mjs tests/unit/remote-session-service.test.mjs tests/integration/remote-session-api.test.mjs
npm run check
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/remote-session server.js tests/integration/remote-session-api.test.mjs
git commit -m "feat: mount remote-session http api"
```


---

### Task 8: Gateway panel for Remote Session operator flow

**Files:**
- Create: `desktop/src/modules/remote-session.ts`
- Modify: `desktop/src/main.ts`
- Modify: `desktop/index.html`
- Modify: `desktop/src/app.ts`
- Modify: `desktop/src/styles/main.css`

**Interfaces:**
- UI entry: `系统扩展 → 远程会话 (Remote Session)`
- Panel actions:
  1. enable/disable remote session
  2. show dependency status (`natTraversal.enabled`, link status)
  3. choose peer (`local-host` or configured NAT peer)
  4. list host projects
  5. open session
  6. send prompt
  7. render event tail
  8. approve/deny pending approvals
  9. resume/end session

- [ ] **Step 1: Add nav + section shell**

In `desktop/index.html`, next to NAT Traversal:

```html
<a href="#remote-session" class="nav-item" onclick="switchTab('remote-session')">
  远程会话 (Remote Session)
</a>

<section id="section-remote-session" class="tab-section" style="display: none;">
  <div id="remote-session-root" class="remote-session-root" aria-live="polite"></div>
</section>
```

Import module in `desktop/src/main.ts`:

```ts
import "./modules/remote-session";
```

Register tab id in `desktop/src/app.ts` knownTabs list.

- [ ] **Step 2: Implement panel module against real HTTP APIs**

Keep state local to the module, same style as `nat-traversal.ts`:

```ts
type RemoteState = {
  config: any;
  status: any;
  projects: Array<{ id: string; name: string }>;
  selectedPeerId: string;
  selectedProjectId: string;
  activeSessionId: string;
  events: any[];
  promptDraft: string;
  busy: boolean;
  error: string;
};
```

Minimum buttons:

- 保存配置
- 刷新状态
- 加载项目
- 打开会话
- 发送 Prompt
- 批准 / 拒绝
- 恢复会话
- 结束会话

- [ ] **Step 3: Build panel assets**

```bash
npm run build:panel
```

Expected: build succeeds.

- [ ] **Step 4: Manual smoke on one machine using fake/local host path**

If real Antigravity attach is still unsupported:

- enable remote session
- UI should still show clear `host_backend_unavailable` / `unsupported_feature` errors instead of blank failure

If real attach works on the machine:

- open Antigravity first
- list projects
- open session
- dispatch a trivial prompt

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/remote-session.ts desktop/src/main.ts desktop/index.html desktop/src/app.ts desktop/src/styles/main.css desktop/dist
git commit -m "feat: add remote-session operator panel"
```

---

### Task 9: Dual-machine path over NAT peer gateway

**Files:**
- Modify: `lib/remote-session/transport/peer-client.mjs`
- Modify: `lib/remote-session/application/service.mjs`
- Modify: `tests/unit/remote-session-service.test.mjs`
- Modify: `docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md`

**Interfaces:**
- When `peerId !== "local-host"`:

```js
const link = await natTraversal.ensureLink(peerId)
const { endpoint } = await natTraversal.openService(peerId, "gateway-api")
// peer client calls Host Gateway remote-session host endpoints
```

Host Gateway needs host-local endpoints that do not recurse into another peer hop:

```text
POST /v1/remote-session/host/attach
GET  /v1/remote-session/host/projects
POST /v1/remote-session/host/conversations
POST /v1/remote-session/host/conversations/:id/prompt
GET  /v1/remote-session/host/conversations/:id/events
POST /v1/remote-session/host/conversations/:id/approvals/:approvalId
```

Controller machine stores RemoteSession projection; Host machine owns conversation execution.

- [ ] **Step 1: Write failing peer-client tests with mocked fetch**

```js
test("peer client lists projects from host gateway endpoint", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/v1\/remote-session\/host\/projects$/);
    return new Response(JSON.stringify({ projects: [{ id: "p1", name: "demo" }] }), { status: 200 });
  };
  const client = createPeerClient({ baseUrl: "http://127.0.0.1:18788", fetchImpl });
  const projects = await client.listProjects();
  assert.equal(projects[0].id, "p1");
});
```

- [ ] **Step 2: Implement peer client + host routes**

Host routes call local `hostBackend` only. Controller routes use peer client when peer is remote.

- [ ] **Step 3: Wire service branch**

```js
if (peerId === "local-host") {
  host = localHostBackend;
} else {
  await natTraversal.ensureLink(peerId);
  const { endpoint } = await natTraversal.openService(peerId, "gateway-api");
  host = createPeerHostProxy(createPeerClient({ baseUrl: normalizeBaseUrl(endpoint) }));
}
```

- [ ] **Step 4: Tests green**

```bash
node --test tests/unit/remote-session-service.test.mjs tests/integration/remote-session-api.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/remote-session tests/unit/remote-session-service.test.mjs tests/integration/remote-session-api.test.mjs docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md
git commit -m "feat: proxy remote-session host APIs over nat peer link"
```

---

### Task 10: End-to-end acceptance script and final alignment

**Files:**
- Create: scripts/remote-session-smoke.mjs
- Modify: package.json to add focused remote-session test script
- Modify: docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md success/status section

**Interfaces:**
- Smoke modes:
  1. --mode fake local coding loop
  2. --mode local-host against real local Antigravity if probe allows
  3. --mode peer --peer <id> dual-machine if configured

- [ ] **Step 1: Write smoke script for fake mode first**

Create scripts/remote-session-smoke.mjs that opens a fake-host session, dispatches a prompt, decides any approval, resumes from cursor, ends session, and exits 0.

- [ ] **Step 2: Run automated suites**

Run remote-session unit/integration tests, nat-traversal unit tests, and npm run check.
Expected: all pass.

- [ ] **Step 3: Update design success status**

Mark Phase 1 complete, Phase 2 fake/local API loop complete, and real Antigravity Joint Session as complete/partial/blocked based on probe evidence. If blocked, document exact missing host API surface.

- [ ] **Step 4: Final commit**

git add scripts/remote-session-smoke.mjs package.json docs/superpowers/specs/2026-08-14-antigravity-remote-session-design.md
git commit -m "test: add remote-session smoke and finalize phase alignment"

---

## Self-Review

### Spec coverage

- NAT Traversal first, Remote Session second: Tasks 1-3 then 4-10
- Dual module boundary preserved: no Remote Session import of frpc process internals
- Controller-led approvals: Task 4 + Task 6
- Host authority + disconnect continues turn: Task 6
- No asar modification: Task 5 local host rules
- Peer link dependency: Task 2 + Task 9
- Panel operator flow: Task 8
- Open host-backend questions handled by probe adapter, not ignored: Task 3 + Task 5 + Task 10

### Explicit non-goals in this plan

- Dream Skin integration
- Device pairing codes
- Auto-launch Antigravity
- Multi-tenant device market
- Official Antigravity menu takeover
- Full frps server orchestration

### Placeholder scan

No TBD/implement-later steps remain. Where real Antigravity attach is unknown, the plan requires explicit unsupported_feature / probe report behavior and fake-host coverage so domain work still lands.

### Type/API consistency

- NAT service exposes ensureLink(peerId) and openService(peerId, serviceName)
- Remote Session service consumes those names exactly
- Protocol message names match the design doc list
- Config keys are natTraversal and remoteSession

---

## Execution Handoff

Plan complete and saved to docs/superpowers/plans/2026-08-14-antigravity-remote-session.md.

Recommended execution order:

1. Tasks 1-3: close Phase 1 and freeze design alignment
2. Tasks 4-7: Remote Session domain/API vertical slice with fake host
3. Task 8: operator panel
4. Tasks 9-10: peer path + acceptance

Two execution options:

1. Subagent-Driven (recommended) - fresh subagent per task, review between tasks
2. Inline Execution - run tasks in this session with checkpoints

Which approach?
