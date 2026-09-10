# Remote Agent Integration Design

## Status

Stage 1 is implemented:

- authenticated `POST /v1/remote-agent/message`
- Dify-compatible `POST /dify/v1/chat-messages`
- desktop System Extensions page: **IM 会话投递**
- chat binding store, `/agent` command parser, and Session Kanban enqueue

Stage 2 async completion notifications are not implemented yet.

## Decision

Shrimp owns the remote-agent command system.

Bot frameworks such as LangBot or AstrBot act as transport adapters only:

- receive the IM message
- forward a normalized envelope to Shrimp
- send Shrimp's plain-text reply back to the original chat

Users never see JSON. JSON is only the internal contract between the bot framework and Shrimp.

### Product placement

In the desktop System Extensions area, present this as part of a session-connectivity family:

```text
系统扩展
  └─ 会话互联
       ├─ 远程会话
       │    本机控制远端 Antigravity 会话
       └─ IM 会话投递
            把聊天消息投到本机 Codex / Claude 会话
```

Do not overload the existing Remote Session page. Remote Session is host-to-peer control. IM session delivery is chat-to-local-session delivery.

## Goal

Enable a user to send a coding instruction from an IM platform and have Shrimp deliver that instruction to the correct local coding-agent session, preserve queue semantics, and return a concise completion result to the original chat.

The target user journey is:

1. A whitelisted user sends text from QQ, Telegram, Lark, DingTalk, or another supported platform.
2. The bot framework forwards the original text plus chat identity to Shrimp.
3. Shrimp parses commands such as `/agent list` and `/agent use 1`, or treats ordinary text as a task for the currently bound session.
4. Shrimp maps the chat binding to a local Codex, Claude, or Antigravity session.
5. Shrimp queues the message using Session Kanban and dispatches it only when that session is idle.
6. The official CLI resumes its own session and records the turn in its native session format.
7. Shrimp returns plain-text status or results; the bot framework posts that text back to the original chat.

## Existing Building Blocks

Shrimp already contains most of the local execution plane:

- `lib/session-kanban/infra/codex-reader.mjs` scans Codex sessions and exposes session ID, title, workspace path, activity time, and source path.
- `lib/session-kanban/infra/claude-reader.mjs` provides equivalent discovery for Claude sessions.
- `lib/session-kanban/infra/antigravity-reader.mjs` provides equivalent discovery for Antigravity sessions.
- `lib/session-kanban/application/service.mjs` provides queue persistence, per-session readiness checks, dispatch, quota handling, and failure states.
- `lib/session-kanban/infra/cli-dispatchers.mjs` resumes sessions through official CLI paths:
  - Codex: `codex exec resume <sessionId> <message>`
  - Claude: `claude --resume <sessionId> --print <message>`
  - Antigravity: resumes through its supported CLI bridge
- `POST /v1/session-kanban/queue` already accepts a session ID and message and persists a queue item.
- The desktop Session Kanban panel already proves the interaction model.

The missing piece is a stable, framework-agnostic IM bridge into Shrimp:

- inbound message envelope
- gateway-owned command parser
- chat-to-session binding store
- plain-text reply contract
- later async completion notification

## Non-Goals

- Do not write directly into Codex/Claude session JSONL or SQLite records.
- Do not run every incoming IM message as a privileged shell command.
- Do not make Shrimp responsible for Telegram/QQ/Lark SDK connections or media upload pipelines.
- Do not put command semantics in LangBot or AstrBot if the goal is multi-framework reuse.
- Do not replace LangBot's local-agent runtime unless a later native Runner is explicitly adopted.

## Integration Options

### Option A: LangBot plugin plus Shrimp queue

LangBot hosts a dedicated plugin that:

1. Intercepts messages or slash commands.
2. Authenticates the sender and chat.
3. Resolves or creates a binding from the LangBot conversation to a Shrimp session.
4. Calls a Shrimp API to enqueue work.
5. Polls for completion or receives a callback.
6. Sends progress and results back to the original chat using LangBot platform APIs.

Advantages:

- The plugin retains native platform and conversation context, making asynchronous result delivery natural.
- Shrimp remains focused on queueing and agent execution.
- Explicit commands can provide predictable remote-control behavior.

Disadvantages:

- Requires developing and packaging a LangBot plugin.
- Binding, command UX, and result polling are implemented in the plugin.

This is the best fit when Shrimp must remain behind explicit commands and users need precise control over project/session selection.

### Option B: Dify-compatible workflow endpoint

LangBot already has a first-class Dify Service API runner and supports chat, agent, workflow, and chatflow application types. Shrimp implements the subset of the Dify HTTP/SSE contract that LangBot's Dify client actually uses for Stage 1.

Current Stage 1 mapping:

- endpoint: `POST /dify/v1/chat-messages`
- auth: `Authorization: Bearer <REMOTE_AGENT_TOKEN>`
- required LangBot variables in `inputs`: `launcher_type`, `launcher_id`, `sender_id`
- optional `inputs.platform`
- response: SSE `message` + `message_end` with Shrimp's plain-text `reply` as `answer`

Advantages:

- Requires no LangBot plugin.
- Reuses LangBot's conversation handling and streaming client.
- Keeps command parsing inside Shrimp, so `/agent list` and `/agent use` remain framework-agnostic.

Disadvantages:

- The protocol must match LangBot's vendored Dify client behavior, not merely the public Dify docs.
- Human-input and workflow-resume extensions are especially contract-sensitive.
- Compatibility can drift when either product changes.

The `agent` app type in LangBot's Dify configuration means a Dify-hosted agent application. It does not provide a generic custom-agent protocol. Choosing it still requires Dify-compatible responses.

This is the recommended LangBot adapter for Stage 1 because it avoids a custom plugin while preserving Shrimp ownership of command semantics.

### Option C: LangBot local-agent plus Shrimp MCP tools

LangBot's built-in `local-agent` runner can call MCP tools. Shrimp exposes an MCP server with operations such as:

- `list_sessions`
- `bind_session`
- `dispatch_task`
- `get_task_status`
- `get_result_summary`
- `list_recent_diffs`

Advantages:

- Requires no LangBot plugin and no protocol impersonation.
- Uses LangBot's existing MCP support.
- Natural language intent is resolved by the LangBot agent, while Shrimp retains execution and safety policy.
- The same MCP surface can later serve AstrBot, Claude, Codex, or other MCP clients.

Disadvantages:

- Adds a model-driven orchestration step; command behavior is less deterministic than explicit slash commands.
- Tool response size and tool descriptions must be bounded.
- Long-running work still requires immediate queued status plus later result notification.

### Option D: Native Shrimp Runner

Add a first-class `shrimp-agent` Runner to LangBot, or contribute one upstream:

```python
@runner.runner_class("shrimp-agent")
class ShrimpAgentRunner(RequestRunner):
    ...
```

Advantages:

- Cleanest product-level integration.
- Shrimp can own session binding, workflow state, queueing, approvals, and result streaming.
- No protocol impersonation.

Disadvantages:

- Requires a LangBot code change or upstream contribution.
- LangBot's current runner list is built in; there is no generic custom-runner URL option.

## Recommended Path

Adopt a gateway-owned command bridge.

### Why this path

The product goal is a stable remote-coding command system that can outlive any one bot framework. If LangBot parses `/agent list` and `/agent use`, AstrBot would need a second implementation. If Shrimp parses those commands, LangBot and AstrBot both become thin adapters.

Selected architecture:

```text
IM platforms
  -> LangBot / AstrBot / other bot frameworks
  -> Shrimp remote-agent core
       ├─ native envelope: POST /v1/remote-agent/message
       └─ Dify-compatible adapter: POST /dify/v1/chat-messages
  -> Session Kanban
  -> Codex / Claude / Antigravity CLI resume
```

Desktop management lives under:

```text
系统扩展
  └─ 会话互联
       ├─ 远程会话
       └─ IM 会话投递
```

The IM page exposes Base URL, Token rotate/copy, binding list, and recent tasks. Do not create a proxy-node named `langbot-dify`; Dify-compatible is an adapter over the shared remote-agent core.

Ownership:

| Concern | Owner |
|---|---|
| Platform SDK login and message receive/send | Bot framework |
| Command parsing (`/agent ...`) | Shrimp |
| Chat-to-session binding | Shrimp |
| Local session discovery | Shrimp Session Kanban readers |
| Queue and serial dispatch | Shrimp Session Kanban |
| Plain-text user replies | Shrimp generates, bot framework delivers |
| Async completion callback | Shrimp emits, bot framework posts |

### Stage 1: synchronous command bridge

Add an authenticated inbound API such as:

```text
POST /v1/remote-agent/message
```

Bot frameworks forward every relevant chat message as a normalized envelope. Shrimp parses the text, executes the command or queues a task, and returns a plain-text `reply` immediately.

Stage 1 intentionally returns queued/dispatched status for coding tasks instead of waiting for the full agent run.

#### Auth

Request header:

```text
Authorization: Bearer <token>
```

Token resolution order:

1. `REMOTE_AGENT_TOKEN` environment variable
2. `gateway.secrets.json` → `remote_agent.token`

Missing/invalid token returns HTTP `401`.

#### Errors

| HTTP | `error.type` | When |
|---|---|---|
| 400 | `invalid_request` | Missing fields / invalid chatType / invalid JSON / payload too large |
| 401 | `unauthorized` | Bad/missing bearer token |
| 404 | `not_found` | Unknown route or `/agent use` target missing |
| 409 | `conflict` | Ordinary text with no binding |
| 500 | `internal_error` | Unexpected failures |

Command-facing errors should still include a plain-text `reply` so adapters can post a useful IM message.

Health endpoint:

```text
GET /v1/remote-agent/health
```

Returns `{ "ok": true, "service": "remote-agent" }`.

#### Dify-compatible adapter

```text
POST /dify/v1/chat-messages
```

LangBot points its Dify Service API Base URL at:

```text
http://127.0.0.1:<port>/dify/v1
```

and uses the remote-agent token as the Dify API Key. Shrimp maps the Dify request into the same envelope used by `POST /v1/remote-agent/message`, then returns SSE events:

1. `event: message` with `answer = reply`
2. `event: message_end` with Shrimp metadata such as `taskId`, `sessionId`, and `bindingKey`

Desktop management endpoints (local gateway auth):

- `GET /v1/remote-agent/status`
- `POST /v1/remote-agent/token/rotate`
- `DELETE /v1/remote-agent/bindings/:bindingKey`

### Stage 2: async completion notifications

After Stage 1 works, add:

- task completion and failure events
- optional webhook callback to the bot framework
- bounded result summaries and panel links
- confirmation tokens for dangerous actions

### Stage 3: optional native Runner

If one bot framework becomes dominant, contribute a native Runner later. The command semantics should still live in Shrimp so other frameworks remain compatible.

## Inbound Message Envelope

Bot frameworks send JSON to Shrimp. Users never see this JSON.

Example request:

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

Required fields:

- `platform`
- `chatType` (`private` or `group`)
- `chatId`
- `userId`
- `text`

Recommended fields:

- `userName`
- `messageId`
- `timestamp`
- `replyToMessageId`

Example immediate response:

```json
{
  "ok": true,
  "reply": "1. Codex | AstrBot | 修复登录问题\n2. Claude | Shrimp | 配置面板重构",
  "taskId": null,
  "sessionId": null,
  "bindingKey": "telegram:private:123456",
  "actions": []
}
```

For queued coding work:

```json
{
  "ok": true,
  "reply": "已加入队列，当前排在第 1 位。\n会话: Codex | AstrBot | 修复登录问题",
  "taskId": "task_123",
  "sessionId": "0193xxxx",
  "bindingKey": "telegram:private:123456",
  "actions": []
}
```

The bot framework posts only `reply` to the IM user.

## Command Surface

`/agent ...` is not a Telegram or LangBot built-in command. It is the Shrimp remote-agent command language.

Initial commands:

| User text | Meaning |
|---|---|
| `/agent list` | List recent local agent sessions |
| `/agent use <n\|alias\|sessionId>` | Bind the current chat to one session |
| `/agent status` | Show current binding and latest queue state |
| `/agent unbind` | Clear the current chat binding |
| `/agent help` | Show command help |
| ordinary text after binding | Queue the text into the bound session |

Example `/agent list` reply:

```text
可用会话：
1. Codex | D:\work\AstrBot | 修复登录问题
2. Claude | D:\work\shrimp | 配置面板重构
3. Codex | D:\work\demo | 数据库迁移

用法：/agent use 1
```

List ranking:

1. Prefer `waiting_input`
2. Then `queued`
3. Then `running`
4. Then `completed`
5. Newest `lastActivityAt` first within the same status
6. Default limit: 10

Stage 1 stores the latest ranked snapshot under the chat binding key for 10 minutes so `/agent use 1` resolves against the same list the user just saw.

Example `/agent use 1` reply:

```text
已绑定当前聊天到：
Codex | D:\work\AstrBot | 修复登录问题

之后直接发任务即可。
```

Example ordinary text after binding:

```text
用户：继续修登录问题，重点看 provider 初始化

机器人：已加入队列，当前排在第 1 位。
```

## Session and Project Binding

Recommended ownership:

- Bot framework owns live platform connectivity and original chat delivery.
- Shrimp owns command parsing and the authoritative mapping from chat identity to local agent session.

Binding key:

```text
platform + chatType + chatId [+ userId for per-sender mode]
```

A binding record should include:

- Binding key
- Client (`codex` / `claude` / `antigravity`)
- Session ID
- Workspace path
- Bound by user ID
- Created at / last used at
- Policy mode

Default recommendation for MVP:

- private chats: one binding per chat
- group chats: one binding per sender inside the group

Do not overload an OpenAI model name to represent a workspace/session. That works only as a temporary prototype and becomes ambiguous as projects multiply.

SQLite table:

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

## Delivery Mechanics

Do not write into Codex/Claude session files.

Delivery path after binding:

```text
POST /v1/remote-agent/message
  text = "继续修登录问题"
        |
        v
resolve binding -> sessionId
        |
        v
POST /v1/session-kanban/queue
  { sessionId, message }
        |
        v
scheduler waits until session idle
        |
        v
CLI resume
  Codex:        codex exec resume <sessionId> <message>
  Claude:       claude --resume <sessionId> --print <message>
  Antigravity:  agy --conversation <sessionId> --print <message>
```

## Security Policy

- Require authentication between LangBot and Shrimp; prefer scoped API keys or signed webhook callbacks.
- Restrict access to explicitly whitelisted users and chats.
- Audit every remote dispatch with sender, platform, chat, target session, message, queue ID, and policy decision.
- Separate read-only operations from dispatch and approval operations.
- Require confirmation for destructive or privileged actions.
- Bound message and result sizes.
- Never expose arbitrary host shell access as an MCP tool.
- Preserve Session Kanban's existing per-session serial dispatch; never concurrently resume one agent session.
- Treat remote requests as untrusted even though they originate from LangBot.

## Long-Running Task Behavior

Remote coding tasks cannot safely rely on one synchronous model request.

Required behavior:

1. Immediately persist the request and return a queue ID.
2. Report queue position and current session state.
3. Dispatch only when Session Kanban marks the target session idle.
4. Surface intermediate status where the platform supports it.
5. Return a bounded final summary and link.
6. Preserve errors, quota waits, and cancellation states.

## Bot Framework Adapter Contract

A LangBot or AstrBot adapter should do as little as possible:

1. Accept messages from allowed chats/users.
2. Forward the envelope to `POST /v1/remote-agent/message`.
3. Post the returned `reply` back to the same chat.
4. Later, accept Shrimp completion callbacks and post those replies too.

The adapter should not implement:

- `/agent list` parsing
- session ranking
- binding storage
- Codex/Claude resume logic

Those belong in Shrimp.

## Optional MCP Surface

MCP remains useful as a secondary interface for desktop agents and debugging, but it is not the primary IM command path.

Useful MCP tools:

```text
list_agent_sessions(limit?)
dispatch_agent_message(session_id, message, confirmation_token?)
get_agent_task_status(task_id)
get_agent_result_summary(task_id, max_chars?)
```

Later additions:

```text
create_agent_session(client, workspace, title)
cancel_agent_task(task_id)
approve_agent_action(task_id, action_id, decision)
subscribe_agent_events(callback_url)
```

## Implementation Milestones

### M1: inbound contract and command parser

- [x] Define the inbound envelope and plain-text reply schema.
- [x] Add authenticated `POST /v1/remote-agent/message`.
- [x] Implement `/agent help|list|use|status|unbind`.
- [x] Persist chat bindings in Shrimp.
- [x] Add unit tests for parser and binding resolution.

### M2: queue-backed delivery + Dify adapter + desktop page

- [x] Route ordinary text through Session Kanban enqueue.
- [x] Return immediate queued status to IM.
- [x] Reuse existing CLI resume dispatchers.
- [x] Add Dify-compatible `POST /dify/v1/chat-messages`.
- [x] Add desktop **IM 会话投递** page for token/endpoints/bindings/recent tasks.
- [x] Add integration tests with a fake dispatcher / Dify SSE adapter.

### M3: completion notifications

- Emit task completion and failure events.
- Support webhook callback to the bot framework.
- Return bounded summaries and panel links.
- Add retry and cancellation behavior.

### M4: approvals and production hardening

- Add policy modes and confirmation tokens.
- Add dangerous-action gates.
- Add concurrency, replay, and abuse tests.
- Add thin LangBot and AstrBot adapters against the same Shrimp contract.

## Open Questions

- Which platforms need proactive result delivery in M3 first: Telegram, QQ, Lark, or DingTalk?
- For group chats, confirm per-sender binding as the default.
- What approval policy should apply to git commits, pushes, dependency installation, and test execution?
- Should Shrimp expose a URL-safe transcript artifact for long results instead of sending the full output to IM?
- Should Stage 1 reject unbound ordinary text with a help message, or attempt heuristic session matching?
