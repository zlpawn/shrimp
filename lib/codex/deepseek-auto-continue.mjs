/**
 * DeepSeek auto-continue (safe / scheme B):
 *
 * Codex multi-step turns sometimes end early when DeepSeek returns a pure-text
 * stage summary without any tool call. Other models keep going; DeepSeek tends
 * to stop and wait for the user to say "continue".
 *
 * This module optionally rewrites that early stop into one internal continue
 * round:
 *   previous assistant output (+ reasoning) + synthetic user "continue" prompt
 *
 * Safety rules (scheme B):
 * - DeepSeek-only
 * - default only in agent/tool context (tools present or tool trajectory in input)
 * - no broad length-based fallback
 * - capped attempts (default 1)
 * - optional preserve of first-round stage text on the final response
 */

import { isDeepSeekResponsesModel } from "./deepseek-input-sanitizer.mjs";

export const DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS = 1;
export const DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT =
  "继续执行未完成的任务，不要只做阶段性总结。如果还有下一步，请直接调用工具继续。";

export const DEFAULT_DEEPSEEK_AUTO_CONTINUE_SETTINGS = Object.freeze({
  enabled: true,
  max_attempts: DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS,
  require_agent_context: true,
  preserve_stage_text: true,
  prompt: DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT,
});

// Intentionally narrow: bare words like "然后/继续/todo/next" caused false positives.
const CONTINUE_HINTS = [
  /现在进入/,
  /接下来(?:进入|做|执行|开始|处理|检查|查看|运行)/,
  /下一步(?:是|：|:|做|执行|开始)?/,
  /继续(?:执行|做|处理|检查|完成|推进)/,
  /先看(?:一下|下|代码|文件|目录|实现)?/,
  /先做/,
  /现在做/,
  /开始做/,
  /Task\s*\d+/i,
  /Plan\s*\d+/i,
  /let me (?:check|look|run|read|open|inspect|continue|start|do|implement|fix)/i,
  /i(?:'| a)m going to (?:check|look|run|read|open|inspect|continue|start|do|implement|fix)/i,
  /now (?:enter|start|do|look|check|run|read|implement|fix)/i,
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

function clampAttempts(value, fallback = DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  if (raw <= 0) return 0;
  return Math.min(3, Math.trunc(raw));
}

function isTruthyEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function isFalsyEnv(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["0", "false", "no", "off"].includes(normalized);
}

/**
 * Resolve effective settings from gateway config + env.
 * Env wins for emergency override:
 * - DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS
 * - DEEPSEEK_AUTO_CONTINUE_PROMPT
 * - DEEPSEEK_AUTO_CONTINUE_ENABLED
 * - DEEPSEEK_AUTO_CONTINUE_REQUIRE_AGENT_CONTEXT
 * - DEEPSEEK_AUTO_CONTINUE_PRESERVE_STAGE_TEXT
 */
export function resolveDeepSeekAutoContinueSettings({
  config = null,
  env = process.env,
} = {}) {
  const fromTools = (
    config?.tools?.deepseek_auto_continue
    && typeof config.tools.deepseek_auto_continue === "object"
  )
    ? config.tools.deepseek_auto_continue
    : {};

  let enabled = fromTools.enabled !== false;
  let maxAttempts = clampAttempts(
    fromTools.max_attempts ?? DEFAULT_DEEPSEEK_AUTO_CONTINUE_SETTINGS.max_attempts,
  );
  let requireAgentContext = fromTools.require_agent_context !== false;

  let preserveStageText = fromTools.preserve_stage_text !== false;
  let prompt = String(fromTools.prompt || "").trim() || DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT;

  if (env.DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS != null && String(env.DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS).trim() !== "") {
    maxAttempts = clampAttempts(env.DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS, maxAttempts);
  }
  if (env.DEEPSEEK_AUTO_CONTINUE_PROMPT != null && String(env.DEEPSEEK_AUTO_CONTINUE_PROMPT).trim()) {
    prompt = String(env.DEEPSEEK_AUTO_CONTINUE_PROMPT).trim();
  }
  if (env.DEEPSEEK_AUTO_CONTINUE_ENABLED != null && String(env.DEEPSEEK_AUTO_CONTINUE_ENABLED).trim() !== "") {
    if (isTruthyEnv(env.DEEPSEEK_AUTO_CONTINUE_ENABLED)) enabled = true;
    if (isFalsyEnv(env.DEEPSEEK_AUTO_CONTINUE_ENABLED)) enabled = false;
  }
  if (env.DEEPSEEK_AUTO_CONTINUE_REQUIRE_AGENT_CONTEXT != null && String(env.DEEPSEEK_AUTO_CONTINUE_REQUIRE_AGENT_CONTEXT).trim() !== "") {
    if (isTruthyEnv(env.DEEPSEEK_AUTO_CONTINUE_REQUIRE_AGENT_CONTEXT)) requireAgentContext = true;
    if (isFalsyEnv(env.DEEPSEEK_AUTO_CONTINUE_REQUIRE_AGENT_CONTEXT)) requireAgentContext = false;
  }

  if (env.DEEPSEEK_AUTO_CONTINUE_PRESERVE_STAGE_TEXT != null && String(env.DEEPSEEK_AUTO_CONTINUE_PRESERVE_STAGE_TEXT).trim() !== "") {
    if (isTruthyEnv(env.DEEPSEEK_AUTO_CONTINUE_PRESERVE_STAGE_TEXT)) preserveStageText = true;
    if (isFalsyEnv(env.DEEPSEEK_AUTO_CONTINUE_PRESERVE_STAGE_TEXT)) preserveStageText = false;
  }

  if (maxAttempts <= 0) enabled = false;

  return {
    enabled,
    max_attempts: enabled ? maxAttempts : 0,
    require_agent_context: requireAgentContext,
    preserve_stage_text: preserveStageText,
    prompt,
  };
}

/** @deprecated prefer resolveDeepSeekAutoContinueSettings */
export function deepSeekAutoContinueMaxAttempts(env = process.env) {
  return resolveDeepSeekAutoContinueSettings({ env }).max_attempts;
}

/** @deprecated prefer resolveDeepSeekAutoContinueSettings */
export function deepSeekAutoContinuePrompt(env = process.env) {
  return resolveDeepSeekAutoContinueSettings({ env }).prompt;
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

/**
 * True when this request looks like an agent/tool turn rather than plain chat.
 */
export function hasAgentToolContext(body) {
  if (!body || typeof body !== "object") return false;

  if (Array.isArray(body.tools) && body.tools.length > 0) return true;

  const toolishTypes = new Set([
    "function_call",
    "function_call_output",
    "custom_tool_call",
    "custom_tool_call_output",
    "tool_result",
    "tool_use",
  ]);

  const input = Array.isArray(body.input) ? body.input : [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (toolishTypes.has(item.type)) return true;
    if (item.role === "tool") return true;
    if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) return true;
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;
    if (msg.role === "tool") return true;
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part && toolishTypes.has(part.type)) return true;
      }
    }
  }

  return false;
}

export function looksLikeDeepSeekMidTaskStop(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (DONE_HINTS.some((re) => re.test(value))) return false;
  if (CONTINUE_HINTS.some((re) => re.test(value))) return true;
  return false;
}

/**
 * Dry-run helper for mini-tool / diagnostics.
 */
export function evaluateDeepSeekAutoContinueCandidate({
  model,
  provider = null,
  response = null,
  body = null,
  settings = null,
  attempt = 0,
} = {}) {
  const resolved = settings && typeof settings === "object"
    ? {
      ...DEFAULT_DEEPSEEK_AUTO_CONTINUE_SETTINGS,
      ...settings,
      max_attempts: clampAttempts(
        settings.max_attempts ?? DEFAULT_DEEPSEEK_AUTO_CONTINUE_SETTINGS.max_attempts,
      ),
    }
    : { ...DEFAULT_DEEPSEEK_AUTO_CONTINUE_SETTINGS };

  return shouldAttemptDeepSeekAutoContinue({
    model,
    provider,
    response,
    body,
    attempt,
    maxAttempts: resolved.enabled === false ? 0 : resolved.max_attempts,
    requireAgentContext: resolved.require_agent_context !== false,

  });
}

export function shouldAttemptDeepSeekAutoContinue({
  model,
  provider = null,
  response = null,
  body = null,
  attempt = 0,
  maxAttempts = DEFAULT_DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS,
  requireAgentContext = true,
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
  if (requireAgentContext && !hasAgentToolContext(body)) {
    return { ok: false, reason: "no_agent_context" };
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

function stripOutputIndex(item) {
  if (!item || typeof item !== "object") return item;
  const { output_index, ...rest } = item;
  return rest;
}

/**
 * Prefer full assistant-facing output items (reasoning + messages) so the
 * continue round keeps DeepSeek thinking/tool context.
 */
export function assistantItemsFromResponse(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const items = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "reasoning") {
      items.push(stripOutputIndex(item));
      continue;
    }
    if (item.type === "message" && (item.role === "assistant" || !item.role)) {
      items.push(stripOutputIndex(item));
    }
  }
  if (items.length > 0) return items;

  const text = extractResponseText(response);
  if (!text) return [];
  return [{
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  }];
}

function resolveContinueToolChoice(body) {
  const current = body?.tool_choice;
  // Give the model another chance to call tools. Keep specific tool choices,
  // but never continue with "none", and demote "required" to "auto" to avoid
  // hard-failing when tools are optional.
  if (!current || current === "none" || current === "required") return "auto";
  return current;
}

export function appendDeepSeekAutoContinuePrompt(
  body,
  response,
  {
    prompt = DEFAULT_DEEPSEEK_AUTO_CONTINUE_PROMPT,
  } = {},
) {
  const input = normalizeInput(body);
  for (const item of assistantItemsFromResponse(response)) {
    input.push(item);
  }
  input.push({
    type: "message",
    role: "user",
    content: [{ type: "input_text", text: prompt }],
  });

  return {
    ...body,
    input,
    stream: false,
    tool_choice: resolveContinueToolChoice(body),
  };
}

export function mergePreservedStageText(firstResponse, nextResponse) {
  if (!nextResponse || typeof nextResponse !== "object") return nextResponse;
  const stageText = extractResponseText(firstResponse);
  if (!stageText) return nextResponse;

  const nextText = extractResponseText(nextResponse);
  if (nextText && (nextText === stageText || nextText.includes(stageText))) {
    return nextResponse;
  }

  const stageMessage = {
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: stageText }],
  };

  const output = Array.isArray(nextResponse.output) ? [...nextResponse.output] : [];
  const mergedOutput = [stageMessage, ...output];
  const mergedText = nextText ? `${stageText}\n\n${nextText}` : stageText;

  return {
    ...nextResponse,
    output: mergedOutput,
    output_text: mergedText,
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
 * @param {boolean} [args.requireAgentContext]
 * @param {boolean} [args.preserveStageText]
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
  requireAgentContext = true,
  preserveStageText = true,
  onContinue = null,
} = {}) {
  let currentBody = body;
  let currentResponse = response;
  const firstResponse = response;
  let attempts = 0;
  let lastDecision = { ok: false, reason: "not_eligible" };

  while (true) {
    const decision = shouldAttemptDeepSeekAutoContinue({
      model,
      provider,
      response: currentResponse,
      body: currentBody,
      attempt: attempts,
      maxAttempts,
      requireAgentContext,
    });
    lastDecision = decision;

    if (!decision.ok) {
      let finalResponse = currentResponse;
      if (
        preserveStageText
        && attempts > 0
        && firstResponse
        && finalResponse
        && finalResponse !== firstResponse
      ) {
        finalResponse = mergePreservedStageText(firstResponse, finalResponse);
      }
      return {
        body: currentBody,
        response: finalResponse,
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
        require_agent_context: requireAgentContext,

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
      const finalResponse = preserveStageText
        ? mergePreservedStageText(firstResponse, currentResponse)
        : currentResponse;
      return {
        body: currentBody,
        response: finalResponse,
        attempts,
        stopReason: "continued_with_tools",
        decision,
      };
    }
  }
}
