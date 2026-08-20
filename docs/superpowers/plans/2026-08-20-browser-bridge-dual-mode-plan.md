# Browser Bridge Dual Mode (MCP + CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a standalone, zero-dependency Browser Bridge with dual MCP and CLI interfaces that attaches directly to user's real Chrome browser via Manifest V3 extension.

**Architecture:** A lightweight Node.js Bridge Server running on port 19527 managing an in-memory command queue. A stdio MCP Server for AI Agent tool calls, an ergonomic CLI client (`bcli`), and an enhanced Chrome MV3 extension executing DOM, CDP, cookie, and tab actions.

**Tech Stack:** Node.js (ESM, `node:http`, `node:readline`, `node:events`), Chrome Extension Manifest V3 (`chrome.tabs`, `chrome.scripting`, `chrome.debugger`, `chrome.cookies`, `chrome.alarms`).

---

### Task 1: Bridge Server Engine (`lib/browser-bridge/server.mjs`)
- [ ] Implement `BridgeServer` class with `start()`, `stop()`, `dispatchCommand()`.
- [ ] Implement endpoints: `GET /health`, `GET /doctor`, `POST /cmd`, `POST /ext/hello`, `GET /ext/poll`, `POST /ext/result`.
- [ ] Add unit tests for command dispatch, timeout, and extension polling.

### Task 2: CLI Client (`lib/browser-bridge/cli.mjs` & `bin/bcli.js`)
- [ ] Implement command parser for `health`, `doctor`, `tabs`, `new-tab`, `goto`, `click`, `fill`, `eval`, `snapshot`, `screenshot`, `cookies`.
- [ ] Implement HTTP client to communicate with Bridge Server.
- [ ] Add unit tests for CLI argument parsing and execution.

### Task 3: MCP Server (`lib/browser-bridge/mcp-server.mjs` & `bin/browser-mcp.js`)
- [ ] Implement stdio JSON-RPC MCP Server protocol with tool discovery.
- [ ] Expose tools: `browser_open_tabs`, `browser_new_tab`, `browser_goto`, `browser_click`, `browser_fill`, `browser_eval`, `browser_snapshot`, `browser_screenshot`, `browser_cookies`, `browser_health`, `browser_doctor`.
- [ ] Auto-instantiate embedded BridgeServer when running as MCP server.
- [ ] Add unit tests for MCP tool calls.

### Task 4: Chrome Extension Enhancement (`extensions/leo-cookie-txt-locally/`)
- [ ] Update `manifest.json` with permissions (`debugger`, `scripting`, `tabs`, `tabGroups`).
- [ ] Update `background.js` with command handlers for tabs, DOM actions (click, fill, snapshot), JS eval, CDP screenshot, and cookies.
- [ ] Implement dual-polling (Bridge 19527 + Gateway fallback).

### Task 5: Integration, Verification & Git Push
- [ ] Run full test suite (`npm run check` and all unit tests).
- [ ] Commit all code with clear git messages.
- [ ] Push branch to remote GitHub repository.
