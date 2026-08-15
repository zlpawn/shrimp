# Antigravity Local API Reverse Notes

Date: 2026-08-15
Mode: read-only
Constraints: no asar changes, no restart of Antigravity/Codex desktop, no extra gateway start

Related:
- docs/superpowers/specs/2026-08-15-antigravity-host-backend-probe-results.md
- docs/superpowers/specs/2026-08-15-antigravity-local-api-reverse-result.json
- docs/superpowers/specs/2026-08-15-antigravity-mainjs-api-extract.json
- docs/superpowers/specs/2026-08-15-antigravity-mainjs-context.json
- docs/superpowers/specs/2026-08-15-antigravity-api-store-probe.json

## Bottom line

Current local endpoint https://127.0.0.1:9608/ is NOT a usable public REST control API.
Many candidate GET/POST/OPTIONS paths with/without CSRF return status 200 + text/html SPA shell.
Including /api/projects, /api/conversations, /v1/conversations, /api/store, /graphql, /rpc.
Therefore createConversation/dispatchPrompt/approvals cannot be wired to this HTTPS port yet.

## Confirmed

1. Endpoint is dynamic and CSRF-bearing via language_server --https_server_port 0 and SPA csrfToken.
2. Frontend main.js has conversation/project domain symbols (openNewConversation, getConversationItems, loadedProjects, ArtifactApprovalStatus, RemoteControl*). These look like frontend store/internal RPC symbols, not stable public HTTP routes.
3. /api/store is not a JSON control plane; all GET/POST/OPTIONS return SPA HTML.
4. CDP is available on 9607 (/json/version, /json/list), research-only, not main path.
5. Filesystem remains the only confirmed partial surface: project list JSON, conversation dbs, main.log endpoint discovery.

## Why full attach is still blocked

Need: create/bind conversation, dispatch prompt, stream events, approve/deny, preferably joint UI visibility.
Have: process presence, dynamic SPA endpoint, filesystem project list, conversation DB files.
Missing: stable create conversation API, prompt/event/approval API, UI-synced session bus.
Logs also show RemoteControlEnabled=false.

## Decision

Keep shipping: fake host full loop; local-host partial isRunning + dynamic endpoint + filesystem listProjects; NAT/panel/peer path unchanged.
Do not: write conversations DB as fake joint session; CDP UI main path; modify app.asar; claim full Joint Session complete.

Next research options:
1. Read-only browser network capture while manually creating conversation / sending prompt / approving in Antigravity.
2. Deeper language_server non-HTTP channel research around 9608/9609.
3. Read-only conversation DB schema inspection for model understanding only.

## Capability matrix

- process presence: YES
- install discovery: YES
- dynamic endpoint discovery: YES
- filesystem project list: YES
- HTTP JSON project API: NO
- HTTP JSON conversation create: NO
- HTTP JSON prompt/events/approvals: NO
- /api/store JSON control plane: NO
- CDP available: YES (not main path)
- full Joint Session attach: BLOCKED

## Product implication

Remote Session can honestly claim NAT works, fake host protocol loop works, real local projects can be listed, but prompt cannot yet be driven into a real Antigravity conversation with Joint UI sync.
