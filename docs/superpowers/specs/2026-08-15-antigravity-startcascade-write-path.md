# Antigravity StartCascade Write Path

Date: 2026-08-15
Mode: research + experimental write scaffolding
Constraints: no asar changes, no CDP main path, no sqlite/brain writes

## Confirmed

### StartCascade works

Service:
exa.language_server_pb.LanguageServerService/StartCascade

Working request shape:

- cascadeId: uuid
- source: CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT
- trajectoryType: CORTEX_TRAJECTORY_TYPE_CASCADE
- workspaceUris: [file:///d:/agent-transfer]

Also works:
- source numeric 1
- trajectoryType numeric 4

Does not work:
- short names like CASCADE_CLIENT without full enum prefix
- missing workspaceUris

Response:
- { cascadeId: ... }

### SendUserCascadeMessage is only partially solved

RPC accepts requests with HTTP 200, but real turn generation fails unless a valid model config is provided.

Observed cascade error when model missing/invalid:
neither PlanModel nor RequestedModel specified. You must specify a valid model.

Also observed that some item encodings arrive as empty userInput items.

Frontend path uses:
- items TextOrScopeItem chunk case=text value=...
- cascadeConfig.plannerConfig.requestedModel
- plannerTypeConfig.case = conversational

## Integrated now

1. Request builders in language-server-connect.mjs
2. Local-host experimental createConversation via StartCascade
3. Local-host experimental dispatchPrompt via SendUserCascadeMessage + inspect
4. Capability flags mark create/dispatch as experimental when live connect exists

## Not complete yet

Cannot claim real turn control until we solve:
1. valid model selection source
2. proven item encoding that preserves user text and yields PLANNER_RESPONSE
3. streaming event subscription
4. approvals

## Next

1. Re-run model turn probes once Antigravity language_server is stably up
2. Prefer reading current selected model from live RPC/user settings if available
3. Only then promote experimental write path to default full attach
