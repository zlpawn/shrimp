# Antigravity Language Server Connect Bridge

Date: 2026-08-15
Mode: read-only research + partial integration
Constraints:
- no Antigravity app.asar modification
- no CDP UI automation as main path
- no write into conversation sqlite/brain as fake joint session
- smoke/probes must not disturb already-open Codex desktop

## Breakthrough

The local control surface is not SPA REST under random /api/* paths.

It is a Connect-JSON RPC service on the dynamic HTTPS port:

- Service: exa.language_server_pb.LanguageServerService
- Base: https://127.0.0.1:<dynamic-port>
- Header: connect-protocol-version: 1
- CSRF header: x-codeium-csrf-token
- Content-Type: application/json

Confirmed companion ports on this machine:

| Port | Role |
|---|---|
| 9608 | HTTPS SPA + Connect RPC |
| 9609 | WebSocket /connect-websocket (upgrade succeeds) |
| 9607 | CDP (research only, not main path) |

## Confirmed read-only RPCs

Working with empty/minimal JSON bodies:

- GetAllCascadeTrajectories -> live conversation list
- GetCascadeTrajectory -> full trajectory + steps
- GetCascadeTrajectorySteps -> paged steps
- SearchConversations -> title/snippet search
- GetUserStatus -> account/plan status
- GetCascadeNuxes
- GetAvailableCascadePlugins

Observed for write-ish methods (not integrated):

- StartCascade exists, but empty body returns invalid_argument: CortexTrajectorySource is unspecified
- SendUserCascadeMessage exists, but missing trajectory returns trajectory not found
- StreamAgentStateUpdates exists, but unary JSON gets 415 (needs streaming content-type / websocket bridge)

## What we integrated

1. lib/remote-session/host-attach/language-server-connect.mjs
2. local-host partial upgrade prefers live Connect for list/inspect
3. filesystem inspector remains fallback
4. transport becomes local-connect-readonly when live RPC works
5. support.liveConnect flag
6. tests + live smoke green

## Live verification

User prompt: 你是一个什么东西？
Model in UI: Gemini 3.7 Flash (High)

Via live RPC:

- cascade/conversation id: 21335b56-743a-4e24-8066-43540024eb37
- title: Inquiring About AI Identity
- status: CASCADE_RUN_STATUS_IDLE
- events recovered: user_text, checkpoint, assistant_text

Host attach result:

- transport: local-connect-readonly
- listProjects/listConversations/getConversation/liveConnect: true
- createConversation/dispatchPrompt/subscribeEvents/decideApproval: false

## Product boundary after this step

Can claim:

- NAT channel management
- fake-host full protocol loop
- real project listing
- real conversation list/inspect via local Connect RPC
- offline filesystem fallback inspector

Still cannot claim:

- programmatically create a real Antigravity conversation with correct trajectory source
- programmatically dispatch prompt into a real turn
- live event subscribe/approvals
- UI-synced Joint Session remote coding loop

## Next research/implementation order

1. Reverse exact StartCascade request shape (CortexTrajectorySource + workspace/project fields)
2. Reverse SendUserCascadeMessage request shape for an existing cascade
3. Wire streaming via Connect streaming content-type or websocket /connect-websocket frames
4. Only after those are confirmed, implement real local-host createConversation/dispatchPrompt/subscribeEvents/approvals

## Safety notes

- CSRF token is required and dynamic per language_server boot
- Do not treat SPA HTML 200 as API success
- Do not write cascade sqlite/brain files as a control path
- Keep CDP as research-only unless product decision changes
