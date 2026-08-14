// Logical protocol codec for Remote Session.

import { RemoteSessionError } from "./errors.mjs";

export const MESSAGE_TYPES = Object.freeze([
  "PEER_HELLO",
  "ATTACH_BACKEND",
  "LIST_PROJECTS",
  "CREATE_SESSION",
  "DISPATCH_PROMPT",
  "SESSION_EVENT",
  "APPROVAL_REQUIRED",
  "APPROVAL_DECISION",
  "RESUME_SESSION",
  "SESSION_END",
]);

const MESSAGE_TYPE_SET = new Set(MESSAGE_TYPES);

export function encodeMessage(type, payload = {}, { ts = Date.now() } = {}) {
  if (!MESSAGE_TYPE_SET.has(type)) {
    throw new RemoteSessionError("protocol_error", `unknown message type: ${type}`);
  }
  return {
    type,
    payload: payload && typeof payload === "object" ? payload : {},
    ts: Number(ts) || Date.now(),
  };
}

export function decodeMessage(raw) {
  const value =
    typeof raw === "string"
      ? (() => {
          try {
            return JSON.parse(raw);
          } catch {
            throw new RemoteSessionError("protocol_error", "message is not valid JSON");
          }
        })()
      : raw;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RemoteSessionError("protocol_error", "message must be an object");
  }
  if (!MESSAGE_TYPE_SET.has(value.type)) {
    throw new RemoteSessionError(
      "protocol_error",
      `unknown message type: ${value?.type || "<missing>"}`,
    );
  }
  return {
    type: value.type,
    payload:
      value.payload && typeof value.payload === "object" && !Array.isArray(value.payload)
        ? value.payload
        : {},
    ts: Number(value.ts) || Date.now(),
  };
}
