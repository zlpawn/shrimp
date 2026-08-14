import test from "node:test";
import assert from "node:assert/strict";

import {
  RemoteSessionError,
  validateRemoteSessionConfig,
  createSessionRecord,
  transition,
  assertControllerAction,
  encodeMessage,
  decodeMessage,
  canTransition,
  MESSAGE_TYPES,
} from "../../lib/remote-session/index.mjs";

test("remote session requires natTraversal enabled", () => {
  assert.throws(
    () => validateRemoteSessionConfig({ enabled: true }, { natTraversalEnabled: false }),
    (error) => error instanceof RemoteSessionError && error.code === "dependency_disabled",
  );

  const cfg = validateRemoteSessionConfig(
    { enabled: true },
    { natTraversalEnabled: true },
  );
  assert.equal(cfg.enabled, true);
});

test("only controller may decide approvals", () => {
  const session = createSessionRecord({
    id: "rs_1",
    controllerPeerId: "a",
    hostPeerId: "b",
    hostProjectId: "p1",
    hostConversationId: "c1",
  });

  assert.throws(
    () => assertControllerAction(session, "b", "APPROVAL_DECISION"),
    (error) => error instanceof RemoteSessionError && error.code === "not_controller",
  );

  assert.doesNotThrow(() => assertControllerAction(session, "a", "APPROVAL_DECISION"));
});

test("disconnect does not end session", () => {
  const session = createSessionRecord({
    id: "rs_1",
    controllerPeerId: "a",
    hostPeerId: "b",
    state: "running",
  });
  const next = transition(session, "disconnected");
  assert.equal(next.state, "disconnected");
  assert.notEqual(next.state, "ended");
  assert.equal(canTransition("disconnected", "ready"), true);
  assert.equal(canTransition("ended", "ready"), false);
});

test("protocol codec round-trips known message types", () => {
  for (const type of MESSAGE_TYPES) {
    const encoded = encodeMessage(type, { ok: true }, { ts: 123 });
    assert.equal(encoded.type, type);
    assert.equal(encoded.ts, 123);
    const decoded = decodeMessage(JSON.stringify(encoded));
    assert.deepEqual(decoded, encoded);
  }
});

test("protocol codec rejects unknown types", () => {
  assert.throws(
    () => encodeMessage("NOT_A_REAL_TYPE", {}),
    (error) => error instanceof RemoteSessionError && error.code === "protocol_error",
  );
  assert.throws(
    () => decodeMessage({ type: "NOPE", payload: {} }),
    (error) => error instanceof RemoteSessionError && error.code === "protocol_error",
  );
});
