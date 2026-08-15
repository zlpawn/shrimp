# Antigravity Event Subscription Path

Date: 2026-08-15
Status: practical poll-stream proven; native Connect stream researched

## Practical path (implemented)

Because native StreamAgentStateUpdates requires Connect streaming envelopes and
long-lived framing, local-host now exposes:

- subscribeEvents({ conversationId, cursor, intervalMs, timeoutMs })

Implementation:
- poll GetCascadeTrajectory
- map steps to events
- re-emit in-place text updates when planner response fills empty text

Live smoke:
- prompt: 只回答数字：5+5=?
- stream events:
  1. user_text
  2. checkpoint
  3. assistant_text "" (generating)
  3. assistant_text "10" (updated, idle)
- has assistant: true

## Native stream research notes

Endpoint:
POST /exa.language_server_pb.LanguageServerService/StreamAgentStateUpdates

Frontend request fields:
- conversationId
- subscriberId
- initialStepsPageBounds
- trajectoryVerbosity (PROD_UI/FULL/...)

Observed:
- application/json unary => 415
- application/connect+json without proper framing => incomplete envelope errors
- websocket upgrade on companion port /connect-websocket succeeds
- stream is long-lived and not a simple unary response

Therefore:
- keep poll-stream as default production-practical path now
- native Connect/WebSocket stream remains next research track

## Product boundary

Can claim:
- create cascade
- dispatch prompt
- recover assistant response
- subscribe to turn progress via poll-stream events

Cannot claim yet:
- native low-latency StreamAgentStateUpdates bridge
- approvals
- full joint UI sync guarantees
