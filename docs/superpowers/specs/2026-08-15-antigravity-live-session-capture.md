# Antigravity Live Session Capture

Date: 2026-08-15
Mode: read-only after user-created session
User input: 你是一个什么东西？
Model selected in UI: Gemini 3.7 Flash (High)
Constraints: no asar changes, no restart of Antigravity/Codex desktop

## Captured session identity

- cascade_id / conversation db: 21335b56-743a-4e24-8066-43540024eb37
- trajectory_id: 4e80710-9f18-48c1-980a-4d6cdc8428cb
- workspace: d:/agent-transfer
- transcript:
  - C:/Users/xtea/.gemini/antigravity/brain/21335b56-743a-4e24-8066-43540024eb37/.system_generated/logs/transcript.jsonl
- sqlite store:
  - C:/Users/xtea/.gemini/antigravity/conversations/21335b56-743a-4e24-8066-43540024eb37.db

## What the session contains

From transcript.jsonl:

1. USER_INPUT
   - content includes <USER_REQUEST>你是一个什么东西？</USER_REQUEST>
   - settings change recorded: Model Selection -> Gemini 3.7 Flash (High)
2. SYSTEM CHECKPOINT
   - objective summary: Inquiring About AI Identity
3. MODEL PLANNER_RESPONSE
   - assistant answered as Antigravity / Gemini-powered coding assistant

From sqlite steps table:
- 3 steps present
- step payloads include cascade/trajectory ids, user text, assistant text, and cloud response ids

## Runtime path observed

language_server.log around the turn:

- CDP discovery to ws://127.0.0.1:9607/...
- then cloud calls:
  - https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
  - response ids like Msx_aremIvSn_uMPwMTNoQ4, Ncx_aoDhNczXjrEP8JDxyQI

Interpretation:

1. UI/session state is local cascade/trajectory storage
2. model generation is NOT a public local REST call on https://127.0.0.1:9608/
3. local HTTPS port remains SPA shell; actual turn execution goes UI/internal bridge -> language_server -> cloud SSE
4. RemoteControl remains disabled in earlier logs

## Implications for Remote Session attach

Confirmed now:

- real conversation create leaves a cascade_id db + brain transcript
- user prompt and model response are recoverable offline
- model choice is recorded in transcript metadata
- cloud generation path is visible in language_server logs

Still missing for full Joint Session control:

- a supported local API to create cascade/conversation
- a supported local API to dispatch prompt into that cascade
- a supported local API to subscribe to step/event stream
- a supported local API for approvals

## Practical next options

1. Treat cascade_id as the host conversation id in local-host partial mode
2. Add read-only conversation inspector:
   - list recent cascade dbs
   - read transcript.jsonl
3. Continue protocol research on language_server internal bridge
   - not SPA REST
   - likely proprietary RPC over local channel
4. Do not write directly into conversation sqlite/brain files as a fake joint session

## Immediate product stance

After this live capture, the honest boundary is unchanged but sharper:

- we can detect and inspect real Antigravity sessions after they happen
- we can list real projects
- we still cannot programmatically drive a new Antigravity turn through a confirmed supported API
