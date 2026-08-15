import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { createCodexReader } from "../../lib/session-kanban/infra/codex-reader.mjs";
import { createClaudeReader } from "../../lib/session-kanban/infra/claude-reader.mjs";
import { createAntigravityReader } from "../../lib/session-kanban/infra/antigravity-reader.mjs";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kanban-reader-"));
}

test("codex reader normalizes thread metadata", async () => {
  const dir = tempDir();
  const stateFile = path.join(dir, "state_5.sqlite");
  const db = new DatabaseSync(stateFile);
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT NOT NULL, cwd TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, archived INTEGER NOT NULL, rollout_path TEXT NOT NULL)");
  db.prepare("INSERT INTO threads VALUES ('thread-1', 'Fix gateway', 'D:/repo', 1000, 2000, 0, 'C:/rollout.jsonl')").run();
  db.close();
  const sessions = await createCodexReader({ stateFile }).list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].client, "codex");
  assert.equal(sessions[0].id, "thread-1");
  assert.equal(sessions[0].title, "Fix gateway");
  assert.equal(sessions[0].workspacePath, "D:/repo");
  assert.equal(sessions[0].lastActivityAt, new Date(2000).toISOString());
  assert.equal(sessions[0].archived, false);
  assert.equal(sessions[0].dispatchTarget, "thread-1");
});

test("claude reader reads desktop sessions and skips subagents", async () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "session.jsonl"), [
    JSON.stringify({ timestamp: "2026-08-15T01:00:00.000Z", cwd: "D:/repo", entrypoint: "claude-desktop-3p", type: "user", message: { content: "Please continue" } }),
    JSON.stringify({ timestamp: "2026-08-15T01:01:00.000Z", type: "assistant", message: { content: "Done" } }),
  ].join("\n"));
  fs.writeFileSync(path.join(dir, "agent-sub.jsonl"), "{}\n");
  const sessions = await createClaudeReader({ projectsDir: dir }).list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].client, "claude");
  assert.equal(sessions[0].id, "session");
  assert.equal(sessions[0].title, "Please continue");
  assert.equal(sessions[0].workspacePath, "D:/repo");
  assert.equal(sessions[0].lastActivityAt, "2026-08-15T01:01:00.000Z");
});

test("antigravity reader reads conversations and excludes missing transcripts", async () => {
  const dir = tempDir();
  const convo = path.join(dir, "conversation-1");
  fs.mkdirSync(path.join(convo, ".system_generated", "logs"), { recursive: true });
  fs.writeFileSync(path.join(convo, ".system_generated", "logs", "transcript.jsonl"), [
    JSON.stringify({ timestamp: "2026-08-15T02:00:00.000Z", type: "USER_INPUT", content: "Generate images" }),
    JSON.stringify({ timestamp: "2026-08-15T02:02:00.000Z", type: "PLANNER_RESPONSE", content: "Completed" }),
  ].join("\n"));
  fs.mkdirSync(path.join(dir, "conversation-2"), { recursive: true });
  const sessions = await createAntigravityReader({ brainDir: dir }).list();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].client, "antigravity");
  assert.equal(sessions[0].id, "conversation-1");
  assert.equal(sessions[0].title, "Generate images");
  assert.equal(sessions[0].lastActivityAt, "2026-08-15T02:02:00.000Z");
});
