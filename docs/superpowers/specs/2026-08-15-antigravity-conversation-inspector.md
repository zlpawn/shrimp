# Antigravity Conversation Inspector (Partial Host)

Date: 2026-08-15
Mode: read-only partial enhancement
Scope: local-host backend only; no Joint Session control claims

## Goal

Expose real Antigravity cascade sessions as inspectable host conversations
without inventing a write path into sqlite/brain storage.

## What landed

1. `lib/remote-session/host-attach/conversation-store.mjs`
   - list cascade `*.db` under `~/.gemini/antigravity/conversations`
   - treat `cascade_id` as host conversation id
   - read `transcript.jsonl` under brain dir
   - extract user preview / model selection / workspace path when available
2. Local-host partial capabilities
   - `listConversations`
   - `getConversation` (offline inspect mode)
3. Application/HTTP surface
   - `GET /v1/remote-session/conversations?peerId=&limit=`
   - `GET /v1/remote-session/conversations/:id?peerId=`
   - host peer equivalents under `/v1/remote-session/host/conversations`
4. Tests
   - unit fixture for store + local-host inspect
   - HTTP route inspect smoke on fake host

## Verified on this machine

Against the live session created by user prompt `你是一个什么东西？`:

- cascade_id / conversation id: `21335b56-743a-4e24-8066-43540024eb37`
- model: `Gemini 3.7 Flash (High)`
- workspace: `d:\agent-transfer`
- inspect status: `offline_readonly`
- events recovered: user_text + checkpoint + assistant_text

## Explicit non-goals

Still unsupported and intentionally rejected:

- `createConversation` on real Antigravity
- `dispatchPrompt`
- live event subscribe
- approvals
- writing sqlite/brain as fake joint session
- CDP UI automation as main control path

## Product boundary after this step

Can claim:

- list real projects
- discover dynamic local endpoint
- list/inspect real cascade conversations offline after they happen

Cannot claim:

- programmatically drive a real Antigravity turn
- UI-synced Joint Session remote coding loop
