import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  listConversationsFromStore,
  getConversationFromStore,
  extractUserRequest,
  extractModelSelection,
  createLocalHostBackend,
} from "../../lib/remote-session/index.mjs";

function writeFixtureConversation(root) {
  const cascadeId = "21335b56-743a-4e24-8066-43540024eb37";
  const conversationsDir = path.join(root, "conversations");
  const brainDir = path.join(root, "brain");
  const transcriptDir = path.join(
    brainDir,
    cascadeId,
    ".system_generated",
    "logs",
  );
  fs.mkdirSync(conversationsDir, { recursive: true });
  fs.mkdirSync(transcriptDir, { recursive: true });

  const dbPath = path.join(conversationsDir, `${cascadeId}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE trajectory_meta (
      trajectory_id TEXT,
      cascade_id TEXT,
      trajectory_type TEXT,
      source TEXT
    );
    CREATE TABLE steps (
      idx INTEGER,
      step_type INTEGER,
      status INTEGER,
      has_subtrajectory INTEGER,
      metadata BLOB,
      error_details BLOB,
      permissions BLOB,
      task_details BLOB,
      render_info BLOB,
      step_payload BLOB,
      step_format INTEGER
    );
    CREATE TABLE trajectory_metadata_blob (
      id TEXT,
      data BLOB
    );
  `);
  db.prepare(
    "INSERT INTO trajectory_meta (trajectory_id, cascade_id, trajectory_type, source) VALUES (?, ?, ?, ?)",
  ).run(
    "e4e80710-9f18-48c1-980a-4d6cdc8428cb",
    cascadeId,
    "4",
    "1",
  );
  db.prepare("INSERT INTO steps (idx, step_type, status, has_subtrajectory, step_format) VALUES (0, 14, 3, 0, 0)").run();
  db.prepare("INSERT INTO steps (idx, step_type, status, has_subtrajectory, step_format) VALUES (1, 1, 3, 0, 0)").run();
  db.prepare("INSERT INTO steps (idx, step_type, status, has_subtrajectory, step_format) VALUES (2, 2, 3, 0, 0)").run();
  db.prepare(
    "INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)",
  ).run(Buffer.from("file:///d:/agent-transfer\x00extra", "utf8"));
  db.close();

  const transcriptPath = path.join(transcriptDir, "transcript.jsonl");
  fs.writeFileSync(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-08-15T02:17:17Z",
        content:
          "<USER_REQUEST>\n你是一个什么东西？\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3.7 Flash (High).\n</USER_SETTINGS_CHANGE>",
      }),
      JSON.stringify({
        step_index: 1,
        source: "SYSTEM",
        type: "CHECKPOINT",
        status: "DONE",
        created_at: "2026-08-15T02:17:17Z",
        content: "checkpoint",
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-08-15T02:17:20Z",
        content: "我是 Antigravity",
        thinking: "identity",
      }),
    ].join("\n"),
    "utf8",
  );

  return {
    cascadeId,
    conversationsDir,
    brainDir,
    dbPath,
    transcriptPath,
  };
}

test("extract helpers parse user request and model selection", () => {
  const content =
    "<USER_REQUEST>\nhello world\n</USER_REQUEST>\nThe user changed setting `Model Selection` from None to Gemini 3.7 Flash (High).";
  assert.equal(extractUserRequest(content), "hello world");
  assert.equal(extractModelSelection(content), "Gemini 3.7 Flash (High)");
});

test("listConversationsFromStore reads cascade db and transcript", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rs-conv-"));
  const fixture = writeFixtureConversation(root);
  const items = listConversationsFromStore({
    conversationsDir: fixture.conversationsDir,
    brainDir: fixture.brainDir,
    limit: 10,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].cascadeId, fixture.cascadeId);
  assert.equal(items[0].conversationId, fixture.cascadeId);
  assert.equal(items[0].preview, "你是一个什么东西？");
  assert.equal(items[0].model, "Gemini 3.7 Flash (High)");
  assert.equal(items[0].transcriptAvailable, true);
  assert.equal(items[0].stepCount, 3);
  assert.match(String(items[0].workspacePath || "").replace(/\\/g, "/"), /d:\/agent-transfer/i);
});

test("getConversationFromStore returns offline transcript events", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rs-conv-detail-"));
  const fixture = writeFixtureConversation(root);
  const snapshot = getConversationFromStore({
    cascadeId: fixture.cascadeId,
    conversationsDir: fixture.conversationsDir,
    brainDir: fixture.brainDir,
  });
  assert.ok(snapshot);
  assert.equal(snapshot.status, "offline_readonly");
  assert.equal(snapshot.mode, "inspect");
  assert.equal(snapshot.events.length, 3);
  assert.equal(snapshot.events[0].type, "user_text");
  assert.equal(snapshot.events[0].text, "你是一个什么东西？");
  assert.equal(snapshot.events[2].type, "assistant_text");
  assert.match(snapshot.events[2].text, /Antigravity/);
});

test("local host partial attach can list and inspect conversations", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rs-local-conv-"));
  const fixture = writeFixtureConversation(root);
  const storeDir = path.join(root, "projects");
  const logsDir = path.join(root, "logs");
  fs.mkdirSync(storeDir, { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(storeDir, "p1.json"),
    JSON.stringify({
      id: "p1",
      name: "demo",
      projectResources: {
        resources: [{ gitFolder: { folderUri: "file:///tmp/demo" } }],
      },
    }),
  );
  fs.writeFileSync(
    path.join(logsDir, "main.log"),
    "Local:       https://127.0.0.1:9608/\n--csrf_token abc\n",
  );

  const host = createLocalHostBackend({
    probe: async () => ({
      running: true,
      supported: false,
      reason: "process_found_but_attach_surface_unconfirmed",
    }),
    paths: {
      projectStoreDir: storeDir,
      mainLogPath: path.join(logsDir, "main.log"),
      conversationsDir: fixture.conversationsDir,
    },
    brainDir: fixture.brainDir,
    logger: { warn() {}, log() {} },
  });

  const attached = await host.attach();
  assert.equal(attached.transport, "local-partial");
  assert.equal(attached.support.listConversations, true);
  assert.equal(attached.support.getConversation, true);

  const conversations = await host.listConversations({ limit: 5 });
  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].id, fixture.cascadeId);

  const snapshot = await host.getConversation(fixture.cascadeId);
  assert.equal(snapshot.conversationId, fixture.cascadeId);
  assert.equal(snapshot.events[0].type, "user_text");

  const caps = host.capabilities();
  assert.ok(caps.includes("listConversations"));
  assert.ok(caps.includes("getConversation"));
});
