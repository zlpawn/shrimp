# Antigravity Live Turn Path (StartCascade + SendUserCascadeMessage)

Date: 2026-08-15
Status: LIVE PROVEN on running Antigravity language_server

## Working end-to-end recipe

1. Discover dynamic endpoint + CSRF from main.log / SPA config
2. StartCascade
3. SendUserCascadeMessage with model config
4. Poll GetCascadeTrajectory until IDLE and assistant text exists

### StartCascade

```json
{
  "cascadeId": "<uuid>",
  "source": "CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT",
  "trajectoryType": "CORTEX_TRAJECTORY_TYPE_CASCADE",
  "workspaceUris": ["file:///d:/agent-transfer"]
}
```

Important:
- Do NOT put ModelOrAlias objects into StartCascade.requestedModel
- That field is a proto enum and rejects objects

### SendUserCascadeMessage

Live-proven shape:

```json
{
  "cascadeId": "<uuid>",
  "items": [{ "text": "只回答数字：3+3=?" }],
  "cascadeConfig": {
    "plannerConfig": {
      "requestedModel": { "model": "MODEL_PLACEHOLDER_M298" },
      "planModel": "MODEL_PLACEHOLDER_M298",
      "plannerTypeConfig": {
        "case": "conversational",
        "value": {
          "plannerMode": "DEFAULT",
          "agenticMode": true
        }
      }
    }
  }
}
```

Model source:
- GetCascadeModelConfigData returns clientModelConfigs
- Gemini 3.7 Flash (High) maps to MODEL_PLACEHOLDER_M298

Item encoding notes:
- items: [{ text: "..." }] preserves user text and works
- items: [{ chunk: { case: "text", value: "..." } }] often arrives as empty item {}

## Integrated

local-host now supports experimental but live-proven:
- createConversation(projectId) via StartCascade
- dispatchPrompt(...) via SendUserCascadeMessage + poll inspect

Live smoke result:
- prompt: 只回答数字：3+3=?
- assistant: 6
- status: CASCADE_RUN_STATUS_IDLE

## Still missing for full Joint Session

- event streaming (StreamAgentStateUpdates / websocket frames)
- approvals
- automatic current-model selection from UI state (currently defaults / explicit model)
- joint UI visibility guarantees
- richer tool/event mapping beyond transcript inspect

## Product claim update

Can claim:
- real project list
- real conversation list/inspect via Connect RPC
- programmatically create a cascade
- programmatically dispatch a prompt and recover assistant response via poll

Cannot claim yet:
- fully UI-synced Joint Session remote coding loop
- approval workflow
- robust streaming subscription
