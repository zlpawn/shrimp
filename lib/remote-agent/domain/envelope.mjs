import { RemoteAgentError, errorStatus } from "./errors.mjs";

function requiredString(value, field) {
  const text = String(value ?? "").trim();
  if (!text) {
    throw new RemoteAgentError(
      "invalid_request",
      `${field} is required`,
      { status: errorStatus("invalid_request") },
    );
  }
  return text;
}

export function buildBindingKey({ platform, chatType, chatId, userId }) {
  if (chatType === "private") return `${platform}:private:${chatId}`;
  return `${platform}:group:${chatId}:user:${userId}`;
}

export function normalizeEnvelope(input = {}) {
  const platform = requiredString(input.platform, "platform").toLowerCase();
  const chatType = requiredString(input.chatType, "chatType").toLowerCase();
  if (chatType !== "private" && chatType !== "group") {
    throw new RemoteAgentError(
      "invalid_request",
      "chatType must be private or group",
      { status: errorStatus("invalid_request") },
    );
  }
  const chatId = requiredString(input.chatId, "chatId");
  const userId = requiredString(input.userId, "userId");
  let text = String(input.text ?? "");
  if (!text.trim()) text = "/agent help";

  return {
    platform,
    chatType,
    chatId,
    userId,
    userName: String(input.userName || "").trim(),
    messageId: String(input.messageId || "").trim(),
    replyToMessageId: String(input.replyToMessageId || "").trim(),
    text,
    timestamp: String(input.timestamp || "").trim(),
    bindingKey: buildBindingKey({ platform, chatType, chatId, userId }),
  };
}
