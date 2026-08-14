// Pure session record helpers.

import { RemoteSessionError } from "./errors.mjs";
import { canTransition, SESSION_STATES } from "./status.mjs";

const CONTROLLER_ACTIONS = new Set([
  "DISPATCH_PROMPT",
  "APPROVAL_DECISION",
  "RESUME_SESSION",
  "SESSION_END",
]);

export function createSessionRecord({
  id,
  controllerPeerId,
  hostPeerId,
  hostProjectId = "",
  hostConversationId = "",
  controlMode = "controller-led",
  state = "connecting",
  createdAt = Date.now(),
  lastEventAt = Date.now(),
} = {}) {
  if (!id) {
    throw new RemoteSessionError("invalid_request", "session id is required");
  }
  if (!controllerPeerId) {
    throw new RemoteSessionError("invalid_request", "controllerPeerId is required");
  }
  if (!hostPeerId) {
    throw new RemoteSessionError("invalid_request", "hostPeerId is required");
  }
  if (!SESSION_STATES.includes(state)) {
    throw new RemoteSessionError("invalid_request", `invalid session state: ${state}`);
  }

  return {
    id: String(id),
    controllerPeerId: String(controllerPeerId),
    hostPeerId: String(hostPeerId),
    hostProjectId: hostProjectId ? String(hostProjectId) : "",
    hostConversationId: hostConversationId ? String(hostConversationId) : "",
    controlMode: controlMode || "controller-led",
    state,
    createdAt: Number(createdAt) || Date.now(),
    lastEventAt: Number(lastEventAt) || Date.now(),
  };
}

export function transition(session, nextState, { at = Date.now() } = {}) {
  if (!session || typeof session !== "object") {
    throw new RemoteSessionError("invalid_request", "session is required");
  }
  if (!canTransition(session.state, nextState)) {
    throw new RemoteSessionError(
      "invalid_transition",
      `cannot transition from ${session.state} to ${nextState}`,
    );
  }
  return {
    ...session,
    state: nextState,
    lastEventAt: Number(at) || Date.now(),
  };
}

export function assertControllerAction(session, actorPeerId, action) {
  if (!session || typeof session !== "object") {
    throw new RemoteSessionError("invalid_request", "session is required");
  }
  if (!CONTROLLER_ACTIONS.has(action)) {
    throw new RemoteSessionError("invalid_request", `unknown controller action: ${action}`);
  }
  if (String(actorPeerId || "") !== String(session.controllerPeerId || "")) {
    throw new RemoteSessionError(
      "not_controller",
      `peer '${actorPeerId || ""}' is not the controller of session '${session.id}'`,
    );
  }
}
