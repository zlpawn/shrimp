# Leo TDX Stock CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Build `leo-tdx`, a zero-dependency Node CLI and `leo-tdx-stock` managed Skill for TDX MCP data, with cross-platform WorkBuddy token extraction.

**Architecture:** A small MCP HTTP/SSE client handles initialize/session/notification/tool calls. Token storage uses Shrimp secrets and extraction scans POSIX and Windows WorkBuddy roots using Node crypto HKDF/AES-GCM. The CLI dispatch maps stable subcommands to MCP tools without exposing credentials.

**Tech Stack:** Node.js ESM, node:test, node:crypto, built-in fetch.

**Spec:** docs/superpowers/specs/2026-08-28-leo-tdx-stock-cli-design.md

## Global Constraints

- Executable/in-repo CLI name: `leo-tdx`; Skill name: `leo-tdx-stock`.
- No token is accepted as a command-line argument.
- Token path: `~/.shrimp/secrets/tdx/token`; `SHRIMP_SECRETS_DIR` overrides root.
- Windows candidate roots include APPDATA and LOCALAPPDATA WorkBuddy directories.
- Default output is JSON; text/raw are explicit.
- Exit codes: 0 success, 2 argument, 3 auth, 4 server, 5 network, 6 local config.

## Task 1: Rename Wendao executable

Move `clis/wendao` to `clis/leo-wendao`, change bin to `leo-wendao`, update README, Skill examples, tests, package files/check. Keep Skill `leo-xiecheng-wendao`.

## Task 2: TDX token and MCP foundation

Create `clis/leo-tdx/lib/token.mjs` and `mcp.mjs`.

Token tests must cover resolution precedence, restricted permissions, hidden set/`--stdin`, status/clear, cross-platform WorkBuddy root ordering, and fixture-based HKDF/AES-GCM extraction.

MCP tests must cover initialize, session header capture, initialized notification, tool call, SSE parsing, auth/network/server error classes, and timeout.

## Task 3: CLI dispatch and tools

Create `clis/leo-tdx/lib/cli.mjs` and `index.mjs`.

Tests must cover whoami/tools/schema/lookup/quotes/kline/screener and remaining query commands through a fake transport. Assert JSON/text/raw outputs, market/setcode mapping and conflicts, missing args, and exit-code mapping helpers.

## Task 4: Skill and repository integration

Create `clis/leo-tdx/package.json`, README, and `lib/skills/leo-tdx-stock/SKILL.md`; add managed catalog entry; include `clis/leo-tdx` and renamed `clis/leo-wendao` in npm files; update `npm run check`.

Tests must verify in-repo CLI discovery, managed skill installation, package paths, and help documentation.

## Task 5: Verification

Run all TDX/Wendao/package/skills tests, `npm run check`, `npm pack --dry-run`, and diff review. Commit each completed task.
