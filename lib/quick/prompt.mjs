export const MAX_SAFE_QUICK_CONTEXT_CHARS = 45000;

export function pruneQuickMessages(messages, maxChars = MAX_SAFE_QUICK_CONTEXT_CHARS) {
  if (!Array.isArray(messages) || messages.length <= 2) return messages;

  const calcChars = (msgs) => msgs.reduce((acc, m) => {
    const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content || "");
    return acc + c.length;
  }, 0);

  if (calcChars(messages) <= maxChars) return messages;

  const hasSystem = messages[0]?.role === "system" || messages[0]?.role === "developer";
  const systemMsg = hasSystem ? messages[0] : null;
  const nonSystem = hasSystem ? messages.slice(1) : [...messages];

  while (nonSystem.length > 1 && (calcChars(nonSystem) + (systemMsg ? calcChars([systemMsg]) : 0)) > maxChars) {
    nonSystem.shift();
  }

  return systemMsg ? [systemMsg, ...nonSystem] : nonSystem;
}

export function applyQuickPromptAdjustments(upstreamBody, conversationId) {
  if (!upstreamBody) return;
  if (conversationId && !upstreamBody.conversation_id) {
    upstreamBody.conversation_id = conversationId;
  }
  if (!Array.isArray(upstreamBody.messages)) return;

  // Guard against AWS Quick 55KB WebSocket frame overflow and attachment errors
  upstreamBody.messages = pruneQuickMessages(upstreamBody.messages);
}
