function displayClient(client) {
  const value = String(client || "").toLowerCase();
  if (value === "codex") return "Codex";
  if (value === "claude") return "Claude";
  if (value === "antigravity") return "Antigravity";
  return value || "Unknown";
}

function displayPath(workspacePath) {
  return String(workspacePath || "").replace(/\//g, "\\") || "(unknown workspace)";
}

function sessionLine(session) {
  return `${displayClient(session.client)} | ${displayPath(session.workspacePath)} | ${session.title || session.id || "untitled"}`;
}

export function formatHelp() {
  return [
    "远程 Agent 命令：",
    "/agent list",
    "/agent use <序号|sessionId>",
    "/agent status",
    "/agent unbind",
    "/agent confirm [token]",
    "/agent cancel",
    "/agent help",
    "",
    "绑定后直接发送普通文本，就会进入对应本地会话队列。",
    "危险操作会先要求确认。",
  ].join("\n");
}

export function formatSessionList(sessions = []) {
  if (!sessions.length) {
    return [
      "当前没有可用的本地会话。",
      "请先在 Codex / Claude / Antigravity 中打开一个项目会话。",
    ].join("\n");
  }
  const lines = ["可用会话："];
  sessions.forEach((session, index) => {
    lines.push(`${index + 1}. ${sessionLine(session)}`);
  });
  lines.push("");
  lines.push("用法：/agent use 1");
  return lines.join("\n");
}

export function formatBindSuccess(session) {
  return [
    "已绑定当前聊天到：",
    sessionLine(session),
    "",
    "之后直接发任务即可。",
  ].join("\n");
}

export function formatQueued(session, position) {
  return [
    `已加入队列，当前排在第 ${Number(position) || 1} 位。`,
    `会话: ${sessionLine(session)}`,
  ].join("\n");
}

export function formatStatus(binding, queueItem = null) {
  const lines = [
    "当前绑定：",
    sessionLine(binding),
    `sessionId: ${binding.sessionId}`,
  ];
  if (queueItem) {
    lines.push("");
    lines.push(`最近队列: ${queueItem.status}${queueItem.id ? ` (${queueItem.id})` : ""}`);
  } else {
    lines.push("");
    lines.push("最近队列: 无");
  }
  return lines.join("\n");
}

export function formatUnbound() {
  return "当前聊天尚未绑定会话。先发送 /agent list，再用 /agent use <序号> 绑定。";
}

export function formatUnknown(command) {
  return [
    `未知命令: /agent ${command || ""}`.trim(),
    "",
    formatHelp(),
  ].join("\n");
}


function truncate(text, max = 180) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return value.slice(0, Math.max(max - 1, 1)) + "…";
}

export function formatCompletion(item = {}, { panelUrl = "" } = {}) {
  const lines = [
    "已派发完成。",
    `任务: ${item.id || "unknown"}`,
    `会话: ${sessionLine(item)}`,
  ];
  if (item.message) lines.push(`内容: ${truncate(item.message, 120)}`);
  if (panelUrl) lines.push(`面板: ${panelUrl}`);
  return lines.join("\n");
}

export function formatFailure(item = {}, { panelUrl = "" } = {}) {
  const lines = [
    "任务失败。",
    `任务: ${item.id || "unknown"}`,
    `会话: ${sessionLine(item)}`,
    `原因: ${truncate(item.error || "unknown error", 180)}`,
  ];
  if (panelUrl) lines.push(`面板: ${panelUrl}`);
  return lines.join("\n");
}


export function formatConfirmationRequired({ token, message, reason = "dangerous", expiresInMinutes = 10 } = {}) {
  const why = reason === "confirm_all" ? "当前策略要求确认全部任务" : "检测到危险操作";
  return [
    `需要确认后才能投递（${why}）。`,
    `内容: ${String(message || "").slice(0, 160)}`,
    `确认码: ${token}`,
    "",
    `请在 ${Number(expiresInMinutes) || 10} 分钟内发送：`,
    `/agent confirm ${token}`,
    "取消：/agent cancel",
  ].join("\n");
}

export function formatConfirmationQueued(session, position, token) {
  return [
    `已确认并加入队列，当前排在第 ${Number(position) || 1} 位。`,
    `会话: ${sessionLine(session)}`,
    token ? `确认码: ${token}` : "",
  ].filter(Boolean).join("\n");
}

export function formatConfirmationInvalid() {
  return "确认码无效或已过期。请重新发送任务，或发送 /agent cancel 取消。";
}

export function formatConfirmationCancelled() {
  return "已取消待确认任务。";
}

export function formatNoPendingConfirmation() {
  return "当前没有待确认任务。";
}
