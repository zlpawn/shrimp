export function buildCompletionEvent(item = {}, { reply = "", panelUrl = "", now = () => Date.now() } = {}) {
  const status = String(item.status || "").trim().toLowerCase();
  const type = status === "failed" ? "remote_agent.task_failed" : "remote_agent.task_dispatched";
  return {
    type,
    taskId: item.id || null,
    status: status || null,
    reply: String(reply || ""),
    bindingKey: item.bindingKey || "",
    platform: item.platform || "",
    chatType: item.chatType || "",
    chatId: item.chatId || "",
    userId: item.userId || "",
    replyToMessageId: item.replyToMessageId || "",
    sessionId: item.sessionId || null,
    panelUrl: panelUrl || "",
    occurredAt: new Date(now()).toISOString(),
  };
}
