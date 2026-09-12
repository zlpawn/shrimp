# Remote Agent Command Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gateway-owned remote-agent command bridge so IM bot frameworks can forward chat text to Shrimp, and Shrimp can parse `/agent` commands, bind chats to local sessions, and queue ordinary text into Session Kanban.

**Architecture:** Introduce a new `lib/remote-agent` module beside Session Kanban. Bot frameworks call authenticated `POST /v1/remote-agent/message` with a normalized envelope. Shrimp parses commands, stores chat bindings in SQLite, lists local sessions through the existing Session Kanban board API, and enqueues ordinary text through the existing queue/dispatch path. Users only ever see plain-text replies.

**Tech Stack:** Node.js ESM, `node:sqlite`, existing Session Kanban readers/dispatchers/scheduler, `node:test`.

**Spec:** `docs/remote-agent-integration.md`

## Global Constraints

- Shrimp owns command parsing; bot frameworks are transport-only.
- Never write directly into Codex/Claude/Antigravity session files.
- Reuse Session Kanban enqueue/dispatch; do not invent a second queue.
- Users never see JSON; JSON is only the bot-framework ↔ Shrimp contract.
- Stage 1 returns immediate queued/status replies; async completion webhooks are Stage 2 and out of scope for this plan.
- Default group binding mode is per-sender: `platform + chatType + chatId + userId`.
- Private-chat binding mode is per-chat: `platform + chatType + chatId`.
- Auth for Stage 1 is a shared bearer token from env `REMOTE_AGENT_TOKEN` or `gateway.secrets.json` key `remote_agent.token`.
- Keep public Session Kanban routes unchanged.

---

## File Map

| File | Responsibility |
|---|---|
| `lib/remote-agent/domain/errors.mjs` | Typed errors and HTTP status mapping |
| `lib/remote-agent/domain/envelope.mjs` | Validate inbound envelope and build binding keys |
| `lib/remote-agent/domain/commands.mjs` | Parse `/agent ...` and ordinary text |
| `lib/remote-agent/domain/replies.mjs` | Format plain-text user replies |
| `lib/remote-agent/infra/binding-store.mjs` | SQLite chat→session bindings |
| `lib/remote-agent/application/service.mjs` | Command orchestration over Session Kanban |
| `lib/remote-agent/http/routes.mjs` | HTTP adapter for `/v1/remote-agent/*` |
| `lib/remote-agent/index.mjs` | Public exports |
| `server.js` | Wire service + route |
| `tests/unit/remote-agent-*.test.mjs` | Unit coverage |
| `tests/integration/remote-agent-api.test.mjs` | HTTP integration coverage |

---

## Stage 1 Contract

### Auth

Request header:

```text
Authorization: Bearer <token>
```

Missing/invalid token → `401`

```json
{
  "ok": false,
  "error": {
    "type": "unauthorized",
    "message": "Invalid remote-agent token"
  }
}
```

### Inbound request

`POST /v1/remote-agent/message`

```json
{
  "platform": "telegram",
  "chatType": "private",
  "chatId": "123456",
  "userId": "7890",
  "userName": "alice",
  "messageId": "42",
  "text": "/agent list",
  "timestamp": "2026-09-09T12:00:00.000Z"
}
```

Required:

- `platform` non-empty string
- `chatType` one of `private|group`
- `chatId` non-empty string
- `userId` non-empty string
- `text` string (may be empty only for help fallback; Stage 1 treats blank as `/agent help`)

Optional:

- `userName`
- `messageId`
- `timestamp`
- `replyToMessageId`

### Success response

```json
{
  "ok": true,
  "reply": "plain text for the IM user",
  "taskId": null,
  "sessionId": null,
  "bindingKey": "telegram:private:123456",
  "actions": []
}
```

When a coding task is queued:

```json
{
  "ok": true,
  "reply": "已加入队列，当前排在第 1 位。\n会话: Codex | D:\\work\\AstrBot | 修复登录问题",
  "taskId": "uuid",
  "sessionId": "codex-session-id",
  "bindingKey": "telegram:private:123456",
  "actions": []
}
```

### Error responses

| HTTP | `error.type` | When |
|---|---|---|
| 400 | `invalid_request` | Missing fields / invalid chatType / invalid JSON / payload too large |
| 401 | `unauthorized` | Bad/missing bearer token |
| 404 | `not_found` | `/agent use` target missing, or unknown route |
| 409 | `conflict` | Ordinary text with no binding |
| 500 | `internal_error` | Unexpected failures |

Error body:

```json
{
  "ok": false,
  "error": {
    "type": "conflict",
    "message": "当前聊天尚未绑定会话。先发送 /agent list，再用 /agent use <序号> 绑定。"
  },
  "reply": "当前聊天尚未绑定会话。先发送 /agent list，再用 /agent use <序号> 绑定。"
}
```

Always include `reply` on command-facing errors so adapters can still post a useful IM message.

### Command surface

| Text | Behavior |
|---|---|
| `/agent` or `/agent help` | Help text |
| `/agent list` | Ranked recent sessions |
| `/agent use <n\|alias\|sessionId>` | Bind current chat |
| `/agent status` | Show binding + latest queue item for that session |
| `/agent unbind` | Clear binding |
| other text starting with `/agent` | Unknown command help |
| ordinary text | Queue into bound session |

### `/agent list` reply format

```text
可用会话：
1. Codex | D:\work\AstrBot | 修复登录问题
2. Claude | D:\work\shrimp | 配置面板重构
3. Codex | D:\work\demo | 数据库迁移

用法：/agent use 1
```

Ranking rules:

1. Prefer sessions with status `waiting_input`
2. Then `queued`
3. Then `running`
4. Then `completed`
5. Within same status, newest `lastActivityAt` first
6. Limit default 10

Each listed item must keep enough data server-side to resolve `use 1` against the same ranked snapshot for that chat. Stage 1 stores the latest list snapshot on the binding key for 10 minutes.

### Binding storage

Table `remote_agent_bindings`:

```sql
CREATE TABLE IF NOT EXISTS remote_agent_bindings (
  binding_key TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  chat_type TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  bound_by_user_id TEXT NOT NULL,
  list_snapshot_json TEXT NOT NULL DEFAULT '[]',
  list_snapshot_at_ms INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_used_at_ms INTEGER NOT NULL
);
```

Binding key builders:

- private: `${platform}:private:${chatId}`
- group: `${platform}:group:${chatId}:user:${userId}`

---

### Task 1: Domain envelope, errors, and command parser

**Files:**
- Create: `lib/remote-agent/domain/errors.mjs`
- Create: `lib/remote-agent/domain/envelope.mjs`
- Create: `lib/remote-agent/domain/commands.mjs`
- Create: `lib/remote-agent/domain/replies.mjs`
- Test: `tests/unit/remote-agent-domain.test.mjs`

**Interfaces:**
- Produces `RemoteAgentError(type, message, { status, reply })`
- Produces `normalizeEnvelope(input) -> { platform, chatType, chatId, userId, userName, messageId, text, timestamp, bindingKey }`
- Produces `parseCommand(text) -> { type: 'help'|'list'|'use'|'status'|'unbind'|'unknown'|'dispatch', raw, target? }`
- Produces reply helpers: `formatHelp()`, `formatSessionList(sessions)`, `formatBindSuccess(session)`, `formatQueued(session, position)`, `formatStatus(binding, queueItem?)`, `formatUnbound()`, `formatUnknown(command)`

- [ ] **Step 1: Write failing domain tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEnvelope } from "../../lib/remote-agent/domain/envelope.mjs";
import { parseCommand } from "../../lib/remote-agent/domain/commands.mjs";
import { formatSessionList } from "../../lib/remote-agent/domain/replies.mjs";

test("normalizeEnvelope builds private and group binding keys", () => {
  assert.equal(
    normalizeEnvelope({ platform: "telegram", chatType: "private", chatId: "1", userId: "9", text: "/agent list" }).bindingKey,
    "telegram:private:1",
  );
  assert.equal(
    normalizeEnvelope({ platform: "telegram", chatType: "group", chatId: "1", userId: "9", text: "hi" }).bindingKey,
    "telegram:group:1:user:9",
  );
});

test("parseCommand recognizes use targets and ordinary dispatch text", () => {
  assert.deepEqual(parseCommand("/agent use 2"), { type: "use", raw: "/agent use 2", target: "2" });
  assert.deepEqual(parseCommand("继续修登录"), { type: "dispatch", raw: "继续修登录" });
});

test("formatSessionList uses stable numbered plain text", () => {
  const text = formatSessionList([
    { client: "codex", workspacePath: "D:/a", title: "登录" },
  ]);
  assert.match(text, /^可用会话：/);
  assert.match(text, /1\. Codex \| D:\\a \| 登录/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/remote-agent-domain.test.mjs`
Expected: FAIL because modules do not exist

- [ ] **Step 3: Implement domain modules**

Implement validation, key building, command parsing, and Chinese plain-text formatters exactly matching the Stage 1 contract above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/remote-agent-domain.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/remote-agent/domain tests/unit/remote-agent-domain.test.mjs
git commit -m "feat(remote-agent): add envelope validation and command parser"
```

---

### Task 2: Binding store

**Files:**
- Create: `lib/remote-agent/infra/binding-store.mjs`
- Test: `tests/unit/remote-agent-binding-store.test.mjs`

**Interfaces:**
- Consumes: none from Task 1 beyond plain objects
- Produces:
  - `createRemoteAgentBindingStore({ dbPath })`
  - `upsertBinding(record)`
  - `getBinding(bindingKey)`
  - `clearBinding(bindingKey)`
  - `touchBinding(bindingKey, nowMs?)`
  - `saveListSnapshot(bindingKey, sessions, nowMs?)`
  - `getListSnapshot(bindingKey, { maxAgeMs = 600000, nowMs } = {})`

- [ ] **Step 1: Write failing store tests**

```js
test("binding store round-trips chat bindings and list snapshots", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "remote-agent-bind-"));
  const store = createRemoteAgentBindingStore({ dbPath: path.join(dir, "t.sqlite") });
  store.upsertBinding({
    bindingKey: "telegram:private:1",
    platform: "telegram",
    chatType: "private",
    chatId: "1",
    userId: "",
    client: "codex",
    sessionId: "s1",
    workspacePath: "D:/repo",
    title: "登录",
    boundByUserId: "u1",
  });
  store.saveListSnapshot("telegram:private:1", [{ id: "s1", client: "codex", title: "登录", workspacePath: "D:/repo" }]);
  const binding = store.getBinding("telegram:private:1");
  assert.equal(binding.sessionId, "s1");
  assert.equal(store.getListSnapshot("telegram:private:1")[0].id, "s1");
  store.clearBinding("telegram:private:1");
  assert.equal(store.getBinding("telegram:private:1"), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/remote-agent-binding-store.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement SQLite binding store**

Create `remote_agent_bindings` with the schema above. Expired snapshots return `[]`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/remote-agent-binding-store.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/remote-agent/infra/binding-store.mjs tests/unit/remote-agent-binding-store.test.mjs
git commit -m "feat(remote-agent): persist chat-to-session bindings"
```

---

### Task 3: Application service

**Files:**
- Create: `lib/remote-agent/application/service.mjs`
- Test: `tests/unit/remote-agent-service.test.mjs`

**Interfaces:**
- Consumes:
  - `normalizeEnvelope`, `parseCommand`, reply helpers
  - binding store methods from Task 2
  - Session Kanban service methods: `board()`, `enqueue({ sessionId, message })`, `store.list()` or equivalent queue lookup
- Produces:
  - `createRemoteAgentService({ bindingStore, sessionKanban, token, now })`
  - `handleMessage(envelope, { authorization } = {}) -> response object`

Behavior matrix:

- `help` → help reply
- `list` → board sessions, rank, save snapshot under binding key, return formatted list
- `use` → resolve target from latest snapshot or direct session id/title match, upsert binding, success reply
- `status` → current binding + newest queue row for that session if any
- `unbind` → clear binding
- `dispatch` → require binding, enqueue, compute queue position, return queued reply
- unknown `/agent ...` → unknown-command reply with help

- [ ] **Step 1: Write failing service tests**

Cover:

1. unauthorized token
2. list + use + dispatch happy path
3. dispatch without binding returns conflict with Chinese reply
4. use with missing index returns not_found

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/unit/remote-agent-service.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement service**

Inject fake Session Kanban in tests. Do not call real CLIs here.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/unit/remote-agent-service.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/remote-agent/application/service.mjs tests/unit/remote-agent-service.test.mjs
git commit -m "feat(remote-agent): orchestrate list/use/status/unbind/dispatch"
```

---

### Task 4: HTTP routes and server wiring

**Files:**
- Create: `lib/remote-agent/http/routes.mjs`
- Create: `lib/remote-agent/index.mjs`
- Modify: `server.js`
- Test: `tests/integration/remote-agent-api.test.mjs`

**Interfaces:**
- Produces `routeRemoteAgentRequest(req, res, reqPath, { service })`
- Supports:
  - `POST /v1/remote-agent/message`
  - `GET /v1/remote-agent/health` → `{ ok: true, service: "remote-agent" }`
- `server.js` creates one service with:
  - binding DB path defaulting to the same `gateway.db`
  - existing `ensureSessionKanbanService()`
  - token from `process.env.REMOTE_AGENT_TOKEN` or secrets

- [ ] **Step 1: Write failing HTTP integration test**

Spin a tiny local server using the route function and fake service, asserting:

1. health endpoint
2. unauthorized
3. message success path

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/integration/remote-agent-api.test.mjs`
Expected: FAIL

- [ ] **Step 3: Implement routes and wire `server.js`**

Follow the Session Kanban route style: local `readJson`, `sendJson`, validation → 400, auth → 401, mapped RemoteAgentError statuses, unknown route → 404.

- [ ] **Step 4: Run integration and unit suites**

Run:

```bash
node --test tests/unit/remote-agent-domain.test.mjs tests/unit/remote-agent-binding-store.test.mjs tests/unit/remote-agent-service.test.mjs tests/integration/remote-agent-api.test.mjs
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/remote-agent server.js tests/integration/remote-agent-api.test.mjs
git commit -m "feat(remote-agent): expose authenticated message bridge API"
```

---

### Task 5: Docs sync and verification

**Files:**
- Modify: `docs/remote-agent-integration.md`
- Verify only

- [ ] **Step 1: Sync Stage 1 contract details into the design doc**

Ensure the design doc contains the final auth header, error table, binding schema, list ranking, and snapshot TTL exactly as implemented.

- [ ] **Step 2: Run full relevant verification**

```bash
node --test tests/unit/remote-agent-*.test.mjs tests/integration/remote-agent-api.test.mjs
npm run check
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/remote-agent-integration.md
git commit -m "docs: sync remote-agent stage 1 contract with implementation plan"
```

---

## Out of Scope for This Plan

- LangBot/AstrBot adapter packaging
- Async completion webhooks
- Approval tokens for dangerous actions
- MCP tool wrappers
- Desktop UI for remote-agent bindings

## Self-Review

1. Spec coverage: Stage 1 inbound envelope, gateway-owned commands, binding ownership, Session Kanban delivery, plain-text replies, and auth are all mapped to tasks.
2. Placeholder scan: none intentionally left.
3. Type consistency: `bindingKey`, command `type` union, and response fields are reused across tasks.
