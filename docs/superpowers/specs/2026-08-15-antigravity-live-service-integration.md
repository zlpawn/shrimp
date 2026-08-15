# Antigravity Live Service Integration

Date: 2026-08-15
Status: service-level live integration proven

## What changed

The Remote Session application service now forwards model configuration across
the full session path:

- openSession -> host createConversation
- dispatchPrompt -> host dispatchPrompt
- HTTP POST /v1/remote-session/sessions
- HTTP POST /v1/remote-session/sessions/:id/prompt
- host peer conversation endpoints

The event subscription path can now merge live host events into the session
event log:

- service.subscribe({ includeHostEvents: true })
- SSE GET /v1/remote-session/sessions/:id/events/stream?includeHostEvents=true

For the local Antigravity backend, this uses the proven
GetCascadeTrajectory poll-stream and re-emits in-place planner text updates.

Peer proxy clients also forward model/modelAlias/cascadeConfig to the host
gateway.

## Live verification

Service-level smoke against the running Antigravity backend:

- prompt: 只回答数字：7+7=?
- assistant: 14
- streamed events:
  - session_opened
  - user_text
  - checkpoint
  - assistant_text "14"

Verification commands:

- npm run test:remote-session
  - 45 tests, 45 pass
- npm run check
  - exit 0
- node scripts/remote-session-live-service-smoke.mjs
  - exit 0

## Remaining boundary

This does not yet complete Joint Session:

- approvals remain fake-host-only
- native StreamAgentStateUpdates/WebSocket stream is not the default
- automatic current-UI model selection is not implemented
- joint UI visibility is not guaranteed
