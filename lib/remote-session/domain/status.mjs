// Session status enums and transition rules.

export const SESSION_STATES = Object.freeze([
  "connecting",
  "ready",
  "running",
  "awaiting_approval",
  "disconnected",
  "ended",
]);

const ALLOWED = Object.freeze({
  connecting: new Set(["ready", "disconnected", "ended"]),
  ready: new Set(["running", "disconnected", "ended"]),
  running: new Set(["awaiting_approval", "ready", "disconnected", "ended"]),
  awaiting_approval: new Set(["running", "ready", "disconnected", "ended"]),
  disconnected: new Set(["ready", "running", "awaiting_approval", "ended"]),
  ended: new Set(),
});

export function canTransition(from, to) {
  if (!SESSION_STATES.includes(from) || !SESSION_STATES.includes(to)) return false;
  if (from === to) return true;
  return ALLOWED[from]?.has(to) === true;
}
