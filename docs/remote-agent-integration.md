# Remote Agent Integration Design

## Status

Proposal. No implementation is included in this change.

## Goal

Enable a user to send a coding instruction from an IM platform to LangBot and have Shrimp deliver that instruction to the correct local coding-agent session, preserve queue semantics, and return a concise completion result to the original chat.

The target user journey is:

1. A whitelisted user sends an instruction from QQ, Telegram, Lark, DingTalk, or another LangBot-supported platform.
2. LangBot resolves the sender, chat, and user intent.
3. Shrimp maps that interaction to a local Codex, Claude, or Antigravity session.
4. Shrimp queues the message using Session Kanban and dispatches it only when that session is idle.
5. The official CLI resumes its own session and records the turn in its native session format.
6. Shrimp returns a bounded summary, status, and link to the original chat.

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

The missing piece is a secure, IM-facing contract between LangBot and Shrimp.

## Non-Goals

- Do not write directly into Codex/Claude session JSONL or SQLite records.
- Do not run every incoming IM message as a privileged shell command.
- Do not make Shrimp responsible for platform adapters, upload media handling, or IM authentication.
- Do not replace LangBot's local-agent runtime in the first milestone.

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

LangBot already has a first-class Dify Service API runner and supports chat, agent, workflow, and chatflow application types. Shrimp could implement the subset of the Dify HTTP/SSE contract that LangBot's Dify client actually uses.

Advantages:

- Requires no LangBot plugin.
- Reuses LangBot's conversation handling, streaming, workflow events, human input, and form rendering.
- A Dify `conversation_id` can represent the binding between an IM conversation and a Shrimp workflow state.

Disadvantages:

- The protocol must match LangBot's vendored Dify client behavior, not merely the public Dify docs.
- Human-input and workflow-resume extensions are especially contract-sensitive.
- Compatibility can drift when either product changes.

The `agent` app type in LangBot's Dify configuration means a Dify-hosted agent application. It does not provide a generic custom-agent protocol. Choosing it still requires Dify-compatible responses.

This is appropriate only if Shrimp must inherit LangBot's rich workflow/form interactions without a plugin and the team accepts protocol-compatibility maintenance.

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

Use a two-stage approach.

### Stage 1: MCP-first MVP

Expose Shrimp Session Kanban operations as authenticated MCP tools and connect them to LangBot `local-agent`.

Initial tools:

- `list_agent_sessions`: return recent, inactive sessions with client, ID, title, workspace, and status.
- `dispatch_agent_message`: enqueue a message for one session and return queue ID and position.
- `get_agent_task_status`: return queue state, dispatch state, and last error.
- `get_agent_result_summary`: return a bounded transcript tail, files changed if available, and a panel URL.

Stage 1 intentionally answers with an immediate queued/dispatched status rather than holding an HTTP request open for a long coding run.

### Stage 2: Native conversational bridge

After the MCP tools prove reliable, add a small Shrimp notification/notification-subscription API:

- Persist a chat binding: platform, launcher type, launcher ID, sender ID, client, session ID.
- Emit task completion and failure events.
- Provide webhook or polling delivery for a LangBot plugin or future native runner.
- Add explicit approval semantics for dangerous or policy-gated actions.

If adoption justifies it, contribute a native LangBot Runner at that point instead of maintaining the plugin boundary.

## Session and Project Binding

Recommended ownership:

- LangBot owns platform identity and the original chat context.
- Shrimp owns the authoritative mapping from a stable integration key to local session and workspace state.

A binding record should include:

- Integration key (`platform + launcher_type + launcher_id + optional sender_id`)
- Shrimp session ID and client
- Workspace path
- Binding creator and creation time
- Required policy mode
- Last used time

Do not overload an OpenAI model name to represent a workspace/session. That works only as a temporary prototype and becomes ambiguous as projects multiply.

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

## API/MCP Shape

A first MCP tool set should be deliberately small:

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

### M1: contract and security

- Define normalized session and task schemas.
- Add authenticated external access policy.
- Decide MCP transport and token storage.
- Define result truncation and audit events.

### M2: MCP tools

- Implement read-only session and task status tools.
- Implement queue dispatch.
- Add unit and integration tests with a fake dispatcher.
- Connect LangBot `local-agent` and verify command intent and queued status.

### M3: completion notifications

- Add chat-binding persistence.
- Add task completion events or polling API.
- Return bounded summaries and panel links.
- Add retry and cancellation behavior.

### M4: approvals and production hardening

- Add policy modes and confirmation tokens.
- Add dangerous-action gates.
- Add concurrency, replay, and abuse tests.
- Evaluate a native LangBot Runner based on actual usage.

## Open Questions

- Which LangBot platforms need proactive result delivery in M3?
- Should multiple users in one group share one binding, or should bindings be per sender?
- What approval policy should apply to git commits, pushes, dependency installation, and test execution?
- Should Shrimp expose a URL-safe transcript artifact for long results instead of sending the full output to IM?
- Is a Dify-compatible endpoint worth maintaining after MCP tools exist?

