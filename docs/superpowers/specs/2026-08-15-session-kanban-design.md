# Session Kanban Design

## Goal

Provide one Shrimp panel that lists active conversations from Codex Desktop, Claude Desktop, and Antigravity 2.0, shows their execution state, and lets the user queue a follow-up that is delivered automatically after the target conversation is no longer running.

## Scope

- Sources: local Codex state, local Claude Desktop transcripts, and local Antigravity 2.0 transcripts.
- Queue: messages are persisted in the gateway SQLite database before dispatch.
- Dispatch:
  - Claude conversations use the official `claude --resume <session-id> --print` CLI.
  - Antigravity conversations use the official `agy --conversation <id> --print` CLI.
  - Codex conversations use an official CLI path when available. Writing Codex's private `queue_1.sqlite` payload is allowed only after its payload schema is positively identified; otherwise the adapter reports an unsupported-schema error instead of guessing.
- Panel: a new System Extensions tab named Session Kanban.

## Unified states

1. `idle`: no recent running signal and no queued follow-up.
2. `queued`: a follow-up is waiting for the conversation to become idle.
3. `running`: the source transcript or process signals active execution.
4. `waiting_input`: the latest turn ended and the conversation appears ready for input.
5. `completed`: the latest turn ended and has remained quiet beyond a cooldown.
6. `error`: source parsing or dispatch failed.

`running` is inferred conservatively. If a client does not expose an explicit runtime signal, transcript recency plus a configured active window is used.

## Data flow

1. A reader adapter normalizes each client's local records into `KanbanSession`.
2. The queue store assigns each user message `pending`, `dispatching`, `dispatched`, `failed`, or `canceled`.
3. Dispatch runs only when the target session is not `running`.
4. A client dispatcher receives `(session, message)` and invokes that client's supported official path.
5. Dispatch results update the queue record; failures remain visible and retryable.

## Safety

- No private client database is written unless the adapter has verified the exact schema for the installed version.
- Official CLI dispatch inherits the source workspace directory and never launches a shell; arguments are passed through `execFile`.
- Dispatch is serialized per target session to prevent duplicate turns.
- Queue changes run in SQLite transactions.
- All HTTP routes use the gateway's local authentication check.

## Non-goals

- No cloud synchronization.
- No cross-host remote sessions in v1.
- No reliance on UI automation or keyboard injection.
- No modification of client binaries.

## Testing

- Unit tests for all readers using temporary fixtures.
- Unit tests for queue transitions and per-session dispatch locking.
- Dispatcher tests with a fake command runner.
- HTTP route tests with temporary storage.
- Panel build and focused panel-contract tests.
