import { randomUUID } from "node:crypto";
import { RemoteAgentError } from "../domain/errors.mjs";

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
  const events = buildDifySseEvents(result, {
    conversationId: mapped.conversationId,
    user: mapped.user,
  });
  return {
    status: 200,
    contentType: "text/event-stream; charset=utf-8",
    body: encodeSse(events),
    result,
    conversationId: events[0]?.conversation_id || mapped.conversationId,
  };
}
