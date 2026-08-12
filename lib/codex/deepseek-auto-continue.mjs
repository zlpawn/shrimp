/**
 * DeepSeek auto-continue:
 *
 * Codex multi-step turns sometimes end early when DeepSeek returns a pure-text
 * stage summary without any tool call. Other models keep going; DeepSeek tends
 * to stop and wait for the user to say "continue".
 *
 * This module rewrites that early stop into one internal continue round:
 *   assistant stage summary + synthetic user "continue" prompt
 *
 * It is intentionally DeepSeek-only and capped (default 1 attempt).
 */

import { isDeepSeekResponsesModel } from "./deepseek-input-sanitizer.mjs";

export const DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS = 1;
export const DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT =
  "继续执行未完成的任务，不要只做阶段性总结。如果还有下一步，请直接调用工具继续。";

const CONTINUE_HINTS = [
  /现在进入/,
  /接下来/,
  /下一步/,
  /然后/,
  /继续/,
  /先看/,
  /先做/,
  /现在做/,
  /开始做/,
  /Task\s*\d+/i,
  /Plan\s*\d+/i,
  /todo/i,
  /let me/i,
  /i(?:'| a)m going to/i,
  /next[,:]?\s/i,
  /now (?:enter|start|do|look|check)/i,
];

const DONE_HINTS = [
  /全部完成/,
  /都完成了/,
  /已经完成/,
  /最终结果/,
  /任务完成/,
  /没有更多/,
  /无需继续/,
  /如果你要继续/,
  /需要我继续/,
  /要不要继续/,
  /all (?:done|complete|finished)/i,
  /final (?:result|answer|summary)/i,
  /nothing more to do/i,
  /let me know if/i,
  /if you(?:'| woul)d like me to continue/i,
];

export function deepSeekAutoContinueMaxAttempts(env = process.env) {
  const raw = Number(env.DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS);
  if (!Number.isFinite(raw)) return DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS;
  if (raw <= 0) return 0;
  return Math.min(3, Math.trunc(raw));
}

export function deepSeekAutoContinuePrompt(env = process.env) {
  const configured = String(env.DEEPSEEK_AUTO_CONTINUE_PROMPT || "").trim();
  return configured || DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT;
}

export function responseHasToolCalls(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output.some((item) =>
    item
    && (item.type === "function_call" || item.type === "custom_tool_call"),
  );
}

export function extractResponseText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const chunks = [];
  for (const item of output) {
    if (!item || item.type !== "message") continue;
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "output_text" && typeof part.text === "string") {
          chunks.push(part.text);
        }
      }
    } else if (typeof item.text === "string") {
      chunks.push(item.text);
    }
  }
  return chunks.join("").trim();
}

export function looksLikeDeepSeekMidTaskStop(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (DONE_HINTS.some((re) => re.test(value))) return false;
  if (CONTINUE_HINTS.some((re) => re.test(value))) return true;

  // Short pure-text replies after tool-using agent turns often mean "paused".
  // Keep this conservative: only treat as mid-stop when text is non-trivial and
  // not clearly final.
  return value.length >= 24 && !/[?？]\s*$/.test(value);
}

export function shouldAttemptDeepSeekAutoContinue({
  model,
  provider = null,
  response = null,
  attempt = 0,
  maxAttempts = DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS,
} = {}) {
  if (!isDeepSeekResponsesModel(model, provider)) {
    return { ok: false, reason: "not_deepseek" };
  }
  if (!Number.isFinite(maxAttempts) || maxAttempts <= 0) {
    return { ok: false, reason: "disabled" };
  }
  if (attempt >= maxAttempts) {
    return { ok: false, reason: "max_attempts" };
  }
  if (!response || typeof response !== "object") {
    return { ok: false, reason: "no_response" };
  }
  if (response.status === "failed" || response.status === "incomplete") {
    return { ok: false, reason: "bad_status" };
  }
  if (responseHasToolCalls(response)) {
    return { ok: false, reason: "has_tool_calls" };
  }

  const text = extractResponseText(response);
  if (!text) {
    return { ok: false, reason: "empty_text" };
  }
  if (!looksLikeDeepSeekMidTaskStop(text)) {
    return { ok: false, reason: "not_mid_task_stop" };
  }

  return { ok: true, reason: "eligible", text };
}

function normalizeInput(body) {
  if (Array.isArray(body?.input)) return [...body.input];
  if (typeof body?.input === "string" && body.input.trim()) {
    return [{
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: body.input }],
    }];
  }
  return [];
}

function assistantMessageFromResponse(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  for (const item of output) {
    if (item?.type === "message" && item.role === "assistant") {
      const { output_index, ...rest } = item;
      return rest;
    }
  }

  const text = extractResponseText(response);
  return {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  };
}

export function appendDeepSeekAutoContinuePrompt(
  body,
  response,
  {
    prompt = DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT,
  } = {},
) {
  const input = normalizeInput(body);
  input.push(assistantMessageFromResponse(response));
  input.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: prompt }],
  });

  return {
    ...body,
    input,
    stream: false,
    // Do not force tools; just give the model another chance to keep going.
    tool_choice: body?.tool_choice && body.tool_choice !== "required"
      ? body.tool_choice
      : "auto",
  };
}

function resolveStopReason({ attempts, response, decision }) {
  if (attempts === 0) return decision?.reason || "not_eligible";
  if (responseHasToolCalls(response)) return "continued_with_tools";
  if (decision?.reason === "not_mid_task_stop" || decision?.reason === "empty_text") {
    return "still_text";
  }
  if (decision?.reason === "max_attempts") {
    // After a successful continue round, max_attempts means we already used the
    // budget and the latest response is still pure text.
    return "still_text";
  }
  return decision?.reason || "still_text";
}

/**
 * Optionally continue a DeepSeek pure-text mid-stop once (or maxAttempts times).
 *
 * @param {object} args
 * @param {object} args.body original responses request body
 * @param {object} args.response first upstream response
 * @param {string} args.model requested/resolved model name
 * @param {object|null} args.provider endpoint provider config
 * @param {(body: object) => Promise<object|null>} args.fetchResponse non-stream fetch
 * @param {number} [args.maxAttempts]
 * @param {string} [args.prompt]
 * @param {(event: object) => void} [args.onContinue]
 */
export async function runDeepSeekAutoContinueLoop({
  body,
  response,
  model,
  provider = null,
  fetchResponse,
  maxAttempts = DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS,
  prompt = DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT,
  onContinue = null,
} = {}) {
  let currentBody = body;
  let currentResponse = response;
  let attempts = 0;
  let lastDecision = { ok: false, reason: "not_eligible" };

  while (true) {
    const decision = shouldAttemptDeepSeekAutoContinue({
      model,
      provider,
      response: currentResponse,
      attempt: attempts,
      maxAttempts,
    });
    lastDecision = decision;

    if (!decision.ok) {
      return {
        body: currentBody,
        response: currentResponse,
        attempts,
        stopReason: resolveStopReason({
          attempts,
          response: currentResponse,
          decision,
        }),
        decision,
      };
    }

    const nextBody = appendDeepSeekAutoContinuePrompt(currentBody, currentResponse, { prompt });
    attempts += 1;

    if (typeof onContinue === "function") {
      onContinue({
        attempt: attempts,
        max_attempts: maxAttempts,
        reason: decision.reason,
        preview: String(decision.text || "").slice(0, 160),
      });
    }

    const nextResponse = await fetchResponse(nextBody);
    if (!nextResponse) {
      return {
        body: nextBody,
        response: currentResponse,
        attempts,
        stopReason: "upstream_failed",
        decision,
      };
    }

    currentBody = nextBody;
    currentResponse = nextResponse;

    if (responseHasToolCalls(currentResponse)) {
      return {
        body: currentBody,
        response: currentResponse,
        attempts,
        stopReason: "continued_with_tools",
        decision,
      };
    }
  }
}
