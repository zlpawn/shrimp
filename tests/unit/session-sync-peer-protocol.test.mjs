import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { HubStore } from "../../lib/session-sync/hub-store.mjs";
import {
  generateManifest,
  getSessionSafely,
  mergeSessionLWW,
  verifySyncAuth,
  syncWithPeer,
} from "../../lib/session-sync/peer-protocol.mjs";

test("generateManifest returns lightweight session metadata", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-manifest-"));
  try {
    const hub = new HubStore({ baseDir: tmpDir });
    hub.saveSession({
      session_id: "test-sess-1",
      source_app: "claude-code",
      workspace_path: "/test/ws",
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
      summary: "test summary",
      updated_at: "2026-09-11T08:00:00.000Z",
    });

    const manifest = generateManifest(hub);
    assert.equal(manifest.sessions.length, 1);
    assert.equal(manifest.sessions[0].session_id, "test-sess-1");
    assert.equal(manifest.sessions[0].message_count, 2);
    assert.equal(manifest.sessions[0].messages, undefined); // lightweight
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getSessionSafely blocks directory traversal attempts", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-traversal-"));
  try {
    const hub = new HubStore({ baseDir: tmpDir });
    hub.saveSession({
      session_id: "valid-session",
      messages: [],
    });

    // Valid retrieval
    const session = getSessionSafely(hub, "valid-session");
    assert.ok(session);
    assert.equal(session.session_id, "valid-session");

    // Invalid / path traversal attempts
    assert.throws(() => getSessionSafely(hub, "../etc/passwd"), /invalid_session_id/);
    assert.throws(() => getSessionSafely(hub, "..\\windows\\win.ini"), /invalid_session_id/);
    assert.throws(() => getSessionSafely(hub, "dir/sub"), /invalid_session_id/);
    assert.throws(() => getSessionSafely(hub, " "), /invalid_session_id/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("mergeSessionLWW adheres to Last-Write-Wins based on updated_at", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-lww-"));
  try {
    const hub = new HubStore({ baseDir: tmpDir });
    hub.saveSession({
      session_id: "sess-conflict",
      summary: "Local v1",
      updated_at: "2026-09-11T10:00:00.000Z",
    });

    // 1. Incoming session is OLDER -> should NOT overwrite
    const olderIncoming = {
      session_id: "sess-conflict",
      summary: "Remote Older",
      updated_at: "2026-09-11T09:00:00.000Z",
    };
    const res1 = mergeSessionLWW(hub, olderIncoming);
    assert.equal(res1.updated, false);
    assert.equal(res1.action, "kept_local");
    assert.equal(hub.getSession("sess-conflict").summary, "Local v1");

    // 2. Incoming session is NEWER -> SHOULD overwrite
    const newerIncoming = {
      session_id: "sess-conflict",
      summary: "Remote Newer v2",
      updated_at: "2026-09-11T11:00:00.000Z",
    };
    const res2 = mergeSessionLWW(hub, newerIncoming);
    assert.equal(res2.updated, true);
    assert.equal(res2.action, "overwritten");
    assert.equal(hub.getSession("sess-conflict").summary, "Remote Newer v2");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("verifySyncAuth enforces authentication and bearer token checks", () => {
  const allowedTokens = ["peer-secret-abc"];

  // 1. Valid Bearer Token
  assert.equal(
    verifySyncAuth(
      { headers: { authorization: "Bearer peer-secret-abc" } },
      { expectedKey: "master-key", peerTokens: allowedTokens },
    ),
    true,
  );

  // 2. Valid x-api-key matching master-key
  assert.equal(
    verifySyncAuth(
      { headers: { "x-api-key": "master-key" } },
      { expectedKey: "master-key", peerTokens: allowedTokens },
    ),
    true,
  );

  // 3. Invalid token
  assert.equal(
    verifySyncAuth(
      { headers: { authorization: "Bearer wrong" } },
      { expectedKey: "master-key", peerTokens: allowedTokens },
    ),
    false,
  );

  // 4. Missing token when key is configured
  assert.equal(
    verifySyncAuth(
      { headers: {} },
      { expectedKey: "master-key", peerTokens: allowedTokens },
    ),
    false,
  );
});

test("syncWithPeer pulls remote sessions into local hub", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-sync-peer-"));
  try {
    const hub = new HubStore({ baseDir: tmpDir });

    const mockPeerClient = {
      request: async (method, url) => {
        if (url === "/v1/session-sync/manifest") {
          return {
            sessions: [
              {
                session_id: "remote-sess-1",
                updated_at: "2026-09-11T12:00:00.000Z",
              },
            ],
          };
        }
        if (url.startsWith("/v1/session-sync/file/remote-sess-1")) {
          return {
            session_id: "remote-sess-1",
            summary: "Pulled from remote",
            updated_at: "2026-09-11T12:00:00.000Z",
            messages: [{ role: "user", content: "hello" }],
          };
        }
        throw new Error("unexpected url: " + url);
      },
    };

    const result = await syncWithPeer({
      peerClient: mockPeerClient,
      hubStore: hub,
      direction: "pull",
    });

    assert.equal(result.pulled, 1);
    assert.equal(result.total, 1);
    assert.equal(hub.getSession("remote-sess-1").summary, "Pulled from remote");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
