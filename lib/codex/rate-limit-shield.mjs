import { ResponsesWriter } from "./responses-writer.mjs";

/**
 * Formats seconds into a human-readable duration like "约 4 小时 45 分钟后".
 */
export function formatDurationSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return "稍后重置";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return minutes > 0
      ? `约 ${hours} 小时 ${minutes} 分钟后`
      : `约 ${hours} 小时后`;
  }
  if (minutes > 0) {
    return `约 ${minutes} 分钟后`;
  }
  return `约 ${seconds} 秒后`;
}

/**
 * Parses upstream 429 response text or cached account usage to produce human-readable reset text.
 */
export function parseRateLimitResetInfo(errorText, fallbackResetsAt = null) {
  let clearsInSeconds = null;
  let resetTimestampMs = null;

  if (typeof errorText === "string" && errorText.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(errorText);
      const detail = parsed?.detail || parsed?.error?.detail || parsed?.error || {};

      if (Number.isFinite(Number(detail.clears_in))) {
        clearsInSeconds = Number(detail.clears_in);
        resetTimestampMs = Date.now() + clearsInSeconds * 1000;
      } else if (Number.isFinite(Number(parsed?.clears_in))) {
        clearsInSeconds = Number(parsed.clears_in);
        resetTimestampMs = Date.now() + clearsInSeconds * 1000;
      } else if (Number.isFinite(Number(detail.resets_at))) {
        const raw = Number(detail.resets_at);
        resetTimestampMs = raw > 1e11 ? raw : raw * 1000;
        clearsInSeconds = Math.max(0, Math.round((resetTimestampMs - Date.now()) / 1000));
      }
    } catch {
      // ignore JSON parse failure
    }
  }

  if (resetTimestampMs == null && fallbackResetsAt != null && Number.isFinite(Number(fallbackResetsAt))) {
    const raw = Number(fallbackResetsAt);
    resetTimestampMs = raw > 1e11 ? raw : raw * 1000;
    clearsInSeconds = Math.max(0, Math.round((resetTimestampMs - Date.now()) / 1000));
  }

  if (resetTimestampMs != null) {
    const date = new Date(resetTimestampMs);
    const timeStr = date.toLocaleTimeString("zh-CN", { hour12: false });
    const durationStr = formatDurationSeconds(clearsInSeconds);
    return {
      durationStr,
      targetTimeStr: timeStr,
      display: `${durationStr}（预计 ${timeStr} 恢复）`,
      clearsInSeconds,
      resetTimestampMs,
    };
  }

  return {
    durationStr: "稍后重置",
    targetTimeStr: null,
    display: "稍后重置（可通过网关账号中心查看详情）",
    clearsInSeconds: null,
    resetTimestampMs: null,
  };
}

/**
 * Detects whether the incoming request is for background title or summary generation.
 */
export function isTitleOrSummaryRequest(body) {
  if (!body) return false;
  const inputStr = JSON.stringify(body.input || body.messages || body.instructions || "").toLowerCase();
  return (
    inputStr.includes("generate a title") ||
    inputStr.includes("generate title") ||
    inputStr.includes("conversation title") ||
    inputStr.includes("thread title") ||
    inputStr.includes("5 words or fewer") ||
    inputStr.includes("short title") ||
    inputStr.includes("summary of the conversation")
  );
}

/**
 * Builds the user-facing markdown notice message for stream turns.
 */
export function buildRateLimitNoticeMarkdown({ model, resetInfo }) {
  const modelName = model || "官方模型";
  const resetDisplay = resetInfo?.display || "稍后重置";
  return [
    `⚠️ **官方模型当前配额已耗尽（HTTP 429 Rate Limit）**\n`,
    `- **受限模型**：\`${modelName}\``,
    `- **预计恢复时间**：${resetDisplay}`,
    `- **输入框已为您保持可用**：当前会话与发送按钮未被锁定。你可以在顶部模型下拉列表中随时切换至其他可用节点（如 \`glm-5.3-flash-zp\`、\`DeepSeek\`、\`AIT\` 等）继续对话，无需重开会话。`,
  ].join("\n");
}

/**
 * Handles official 429 errors by transforming them into 200 OK responses to prevent
 * the Codex Desktop client from disabling the send button or crashing background tasks.
 *
 * @returns {Promise<boolean>} true if intercepted and handled, false otherwise
 */
export async function handleOfficialRateLimit({
  upstream,
  clientRes,
  body = {},
  requestedModel = null,
  requestId = null,
  logInfo = () => {},
  errorText = "",
  fallbackResetsAt = null,
}) {
  if (upstream.status !== 429) {
    return false;
  }

  const isStream = Boolean(body.stream);
  const isTitle = isTitleOrSummaryRequest(body);
  const resetInfo = parseRateLimitResetInfo(errorText, fallbackResetsAt);

  logInfo("official_rate_limit_shield_triggered", {
    request_id: requestId,
    model: requestedModel,
    stream: isStream,
    is_title: isTitle,
    clears_in: resetInfo.clearsInSeconds,
    reset_display: resetInfo.display,
  });

  const responseId = `resp_shield_${Date.now()}`;

  if (isStream) {
    if (!clientRes.headersSent) {
      clientRes.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
    }

    const writer = new ResponsesWriter({
      model: requestedModel,
      responseId,
      emit(event, payload) {
        if (!clientRes.writableEnded) {
          clientRes.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        }
      },
    });

    const outputText = isTitle
      ? "新对话"
      : buildRateLimitNoticeMarkdown({ model: requestedModel, resetInfo });

    writer.textDelta(outputText);
    writer.completed({
      input_tokens: 0,
      output_tokens: Math.ceil(outputText.length / 2),
      total_tokens: Math.ceil(outputText.length / 2),
    });

    if (!clientRes.writableEnded) {
      clientRes.end();
    }
    return true;
  }

  // Non-stream response (e.g. background title or non-stream turn)
  const outputText = isTitle
    ? "新对话"
    : buildRateLimitNoticeMarkdown({ model: requestedModel, resetInfo });

  const payload = {
    id: responseId,
    object: "response",
    status: "completed",
    model: requestedModel,
    output: [
      {
        id: `msg_shield_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [
          {
            type: "text",
            text: outputText,
          },
        ],
      },
    ],
    usage: {
      input_tokens: 0,
      output_tokens: Math.ceil(outputText.length / 2),
      total_tokens: Math.ceil(outputText.length / 2),
    },
  };

  if (!clientRes.headersSent) {
    clientRes.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
  }
  clientRes.end(JSON.stringify(payload));
  return true;
}
