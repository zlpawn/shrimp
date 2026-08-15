// Host backend contract helpers for Remote Session.

export const HOST_CAPABILITIES = Object.freeze([
  "attach",
  "listProjects",
  "createConversation",
  "dispatchPrompt",
  "subscribeEvents",
  "listPendingApprovals",
  "decideApproval",
  "getConversation",
]);

export const HOST_EVENT_TYPES = Object.freeze([
  "assistant_text",
  "tool_call",
  "terminal",
  "diff",
  "approval_required",
  "turn_completed",
]);

export function summarizeHostBackend(backend) {
  return {
    id: backend?.id || "",
    capabilities: typeof backend?.capabilities === "function" ? backend.capabilities() : [],
  };
}
