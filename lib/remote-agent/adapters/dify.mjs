import { randomUUID } from "node:crypto";
import { RemoteAgentError } from "../domain/errors.mjs";
import { formatCompletion, formatFailure } from "../domain/replies.mjs";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeChatType(launcherType) {
  const value = String(launcherType || "").trim().toLowerCase();
  if (["group", "guild", "channel", "room"].includes(value)) return "group";
  return "private";
}

function extractBearer(authorization) {
  const value = String(authorization || "").trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

export function mapDifyChatRequest(body = {}, { authorization = "" } = {}) {
  const inputs = asObject(body.inputs);
  const platform = String(inputs.platform || inputs.adapter || "dify").trim() || "dify";
  const launcherType = String(inputs.launcher_type || inputs.chat_type || "private").trim();
  const chatType = normalizeChatType(launcherType);
  const chatId = String(
    inputs.launcher_id
    || inputs.chat_id
    || body.conversation_id
    || body.user
    || "",
  ).trim();
  const userId = String(inputs.sender_id || body.user || chatId || "").trim();
  const text = String(body.query ?? body.text ?? "").trim() || "/agent help";

  if (!chatId) {
    throw new RemoteAgentError(
      "invalid_request",
      "Dify request is missing launcher_id/conversation_id/user",
      { status: 400, reply: "缺少会话标识，无法投递。" },
    );
  }
  if (!userId) {
    throw new RemoteAgentError(
      "invalid_request",
      "Dify request is missing sender_id/user",
      { status: 400, reply: "缺少发送者标识，无法投递。" },
    );
  }

  return {
    authorization: authorization || (body.api_key ? `Bearer ${body.api_key}` : ""),
    envelope: {
      platform,
      chatType,
      chatId,
      userId,
      userName: String(inputs.sender_name || inputs.user_name || "").trim(),
      messageId: String(inputs.message_id || "").trim(),
      text,
      timestamp: String(inputs.timestamp || "").trim(),
    },
    conversationId: String(body.conversation_id || "").trim(),
    user: String(body.user || userId).trim(),
    responseMode: String(body.response_mode || "streaming").trim().toLowerCase() || "streaming",
  };
}

export function buildDifySseEvents(result, { conversationId = "", user = "" } = {}) {
  const messageId = `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const nextConversationId = conversationId || `conv_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const answer = String(result?.reply || "");
  const createdAt = Math.floor(Date.now() / 1000);
  return [
    {
      event: "message",
      message_id: messageId,
      conversation_id: nextConversationId,
      answer,
      created_at: createdAt,
    },
    {
      event: "message_end",
      message_id: messageId,
      conversation_id: nextConversationId,
      metadata: {
        usage: null,
        shrimp: {
          taskId: result?.taskId || null,
          sessionId: result?.sessionId || null,
          bindingKey: result?.bindingKey || null,
          user,
        },
      },
    },
  ];
}

export function encodeSse(events = []) {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function encodeSseEvent(event) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function heartbeatEvent(conversationId = "") {
  return {
    event: "ping",
    conversation_id: conversationId,
    created_at: Math.floor(Date.now() / 1000),
  };
}

function timeoutReply(taskId) {
  return [
    "等待超时：任务仍在运行。",
    taskId ? `任务ID: ${taskId}` : "",
    "稍后可发送 /agent status 查看进度。",
  ].filter(Boolean).join("\n");
}

function settledResult(task, taskId, bindingKey, sessionId) {
  if (task?.status === "failed") {
    return {
      ok: true,
      reply: formatFailure(task),
      taskId,
      sessionId: task?.sessionId || sessionId || null,
      bindingKey,
      actions: ["task_failed"],
    };
  }
  return {
    ok: true,
    reply: formatCompletion(task),
    taskId,
    sessionId: task?.sessionId || sessionId || null,
    bindingKey,
    actions: ["task_dispatched"],
  };
}

export async function* createDifySseStream({
  initialResult,
  conversationId = "",
  user = "",
  getTask = null,
  pollIntervalMs = 2000,
  heartbeatIntervalMs = 15000,
  maxWaitMs = 180000,
  now = () => Date.now(),
} = {}) {
  const taskId = initialResult?.taskId || null;
  yield encodeSseEvent({
    event: "message",
    message_id: `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    conversation_id: conversationId || `conv_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    answer: String(initialResult?.reply || ""),
    created_at: Math.floor(now() / 1000),
  });

  if (!taskId || typeof getTask !== "function") {
    yield encodeSseEvent({
      event: "message_end",
      message_id: null,
      conversation_id: conversationId,
      metadata: { usage: null, shrimp: initialResult || null },
    });
    return;
  }

  const startedAt = now();
  let lastHeartbeat = startedAt;
  for (;;) {
    const task = await getTask(taskId);
    if (task && ["dispatched", "failed", "canceled"].includes(task.status)) {
      const finalResult = settledResult(
        task,
        taskId,
        initialResult?.bindingKey || "",
        initialResult?.sessionId || null,
      );
      for (const event of buildDifySseEvents(finalResult, { conversationId, user })) {
        if (event.event === "message") {
          event.answer = finalResult.reply;
        }
        yield encodeSseEvent(event);
      }
      return;
    }

    const currentTime = now();
    if (maxWaitMs <= 0 || currentTime - startedAt >= maxWaitMs) {
      const finalResult = {
        ...initialResult,
        reply: timeoutReply(taskId),
        actions: ["sync_wait_timeout"],
      };
      for (const event of buildDifySseEvents(finalResult, { conversationId, user })) {
        yield encodeSseEvent(event);
      }
      return;
    }

    if (heartbeatIntervalMs > 0 && currentTime - lastHeartbeat >= heartbeatIntervalMs) {
      lastHeartbeat = currentTime;
      yield encodeSseEvent(heartbeatEvent(conversationId));
    }
    await new Promise(resolve => setTimeout(resolve, Math.max(Number(pollIntervalMs) || 2000, 1)));
  }
}

export async function handleDifyChatMessages(service, req, body) {
  const mapped = mapDifyChatRequest(body, {
    authorization: req.headers?.authorization || "",
  });
  if (mapped.responseMode && mapped.responseMode !== "streaming") {
    throw new RemoteAgentError(
      "invalid_request",
      "Only streaming response_mode is supported",
      { status: 400, reply: "当前仅支持 streaming 模式。" },
    );
  }
  // Prefer Authorization header; fall back to mapped bearer if callers stuffed api_key.
  const authorization = extractBearer(req.headers?.authorization)
    ? req.headers.authorization
    : mapped.authorization;
  const result = await service.handleMessage(mapped.envelope, { authorization });
  const getTask = typeof service.getTask === "function" ? service.getTask.bind(service) : null;
  return {
    status: 200,
    contentType: "text/event-stream; charset=utf-8",
    stream: createDifySseStream({
      initialResult: result,
      conversationId: mapped.conversationId,
      user: mapped.user,
      getTask,
      pollIntervalMs: Number(process.env.REMOTE_AGENT_SYNC_POLL_MS || 2000),
      heartbeatIntervalMs: Number(process.env.REMOTE_AGENT_SYNC_HEARTBEAT_MS || 15000),
      maxWaitMs: Number(process.env.REMOTE_AGENT_SYNC_MAX_WAIT_MS || 180000),
    }),
    result,
    conversationId: mapped.conversationId,
  };
}
