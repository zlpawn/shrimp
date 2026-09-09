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
    "/agent help",
    "",
    "绑定后直接发送普通文本，就会进入对应本地会话队列。",
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
