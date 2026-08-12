import { sanitizeResponsesInput } from "./grok-input-sanitizer.mjs";

const INTERRUPTED_TOOL_OUTPUT =
  "[System Note: Tool call execution was interrupted or cancelled.]";
const PLACEHOLDER_REASONING_TEXT =
  "Continued from previous tool-call reasoning.";

/**
 * DeepSeek Responses is stricter than generic third-party adapters:
 * 1) every function_call must have a matching function_call_output
 * 2) thinking/tool turns require reasoning_text to be passed back
 * 3) no non-tool items may appear between a function_call and its output
 *
 * Generic sanitizeResponsesInput drops reasoning items and preserves original
 * interleaving, which is fine for most providers but breaks DeepSeek multi-turn
 * tool use. Keep that generic behavior and only apply this DeepSeek-specific
 * pass on DeepSeek routes.
 */
export function isDeepSeekResponsesModel(model, provider = null) {
  const modelName = String(model || "").toLowerCase();
  if (modelName.includes("deepseek")) return true;

  if (provider?.model_mapping && typeof provider.model_mapping === "object") {
    const mapped = String(provider.model_mapping[model] || "").toLowerCase();
    if (mapped.includes("deepseek")) return true;
  }

  const providerName = String(provider?.name || provider?.id || "").toLowerCase();
  if (providerName.includes("deepseek")) return true;

  const baseUrl = String(provider?.base_url || "").toLowerCase();
  if (baseUrl.includes("deepseek")) return true;

  if (Array.isArray(provider?.models)) {
    for (const entry of provider.models) {
      if (String(entry || "").toLowerCase().includes("deepseek")) return true;
    }
  }

  return false;
}

export function sanitizeDeepSeekResponsesInput(source) {
  if (!source || typeof source !== "object") return source;

  const originalInput = Array.isArray(source.input) ? source.input : null;
  const reasoningQueue = originalInput
    ? originalInput
      .filter((item) => item && item.type === "reasoning")
      .map((item) => normalizeReasoningItem(item))
      .filter(Boolean)
    : [];

  const cleaned = sanitizeResponsesInput(source);
  if (!Array.isArray(cleaned.input)) return cleaned;

  return {
    ...cleaned,
    input: reorderToolCallsWithOutputs(cleaned.input, reasoningQueue),
  };
}

/**
 * Rebuild the input so each tool-call group looks like:
 *   [reasoning] + function_call(+s) + matching function_call_output(+s)
 * without messages or other items between a call and its output.
 */
function reorderToolCallsWithOutputs(input, reasoningQueue) {
  if (!Array.isArray(input) || input.length === 0) return input;

  const outputsByCallId = new Map();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    if (item.type !== "function_call_output" && item.type !== "custom_tool_call_output") {
      continue;
    }
    const callId = item.call_id || item.id;
    if (!callId || outputsByCallId.has(callId)) continue;
    outputsByCallId.set(callId, item);
  }

  const reasoning = [...reasoningQueue];
  const emittedCalls = new Set();
  const result = [];
  let index = 0;

  while (index < input.length) {
    const item = input[index];

    if (!item || typeof item !== "object") {
      result.push(item);
      index += 1;
      continue;
    }

    if (isEmptyAssistantMessage(item)) {
      index += 1;
      continue;
    }

    if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
      // Outputs are re-emitted with their call group.
      index += 1;
      continue;
    }

    if (
      (item.type === "function_call" || item.type === "custom_tool_call")
      && !emittedCalls.has(item.call_id || item.id)
    ) {
      const batch = [];
      while (index < input.length) {
        const current = input[index];
        if (!current || typeof current !== "object") break;

        if (isEmptyAssistantMessage(current)) {
          index += 1;
          continue;
        }

        if (
          (current.type === "function_call" || current.type === "custom_tool_call")
          && !emittedCalls.has(current.call_id || current.id)
        ) {
          batch.push(current);
          index += 1;
          continue;
        }

        // Skip outputs that belong to the batch we are currently building so
        // they do not split parallel tool calls.
        if (
          (current.type === "function_call_output" || current.type === "custom_tool_call_output")
          && batch.some((call) => (call.call_id || call.id) === (current.call_id || current.id))
        ) {
          index += 1;
          continue;
        }

        break;
      }

      result.push(reasoning.shift() || placeholderReasoningItem());

      for (const call of batch) {
        const callId = call.call_id || call.id;
        result.push(call);
        if (callId) emittedCalls.add(callId);
      }

      for (const call of batch) {
        const callId = call.call_id || call.id;
        if (!callId) continue;
        const existing = outputsByCallId.get(callId);
        result.push({
          type: call.type === "custom_tool_call"
            ? "custom_tool_call_output"
            : "function_call_output",
          call_id: callId,
          output: existing
            ? (typeof existing.output === "string"
              ? existing.output
              : JSON.stringify(existing.output ?? ""))
            : INTERRUPTED_TOOL_OUTPUT,
        });
      }

      continue;
    }

    // Already-emitted function_call (should be rare) — skip.
    if (item.type === "function_call" || item.type === "custom_tool_call") {
      index += 1;
      continue;
    }

    result.push(item);
    index += 1;
  }

  return result;
}

function isEmptyAssistantMessage(item) {
  if (!item || typeof item !== "object") return false;
  const isAssistant = item.role === "assistant" || (
    item.type === "message" && item.role === "assistant"
  );
  if (!isAssistant) return false;

  const content = item.content;
  if (content == null) return true;
  if (typeof content === "string") return content.trim().length === 0;
  if (!Array.isArray(content)) return false;
  if (content.length === 0) return true;
  return content.every((part) => {
    if (!part || typeof part !== "object") return true;
    if (
      part.type === "output_text"
      || part.type === "text"
      || part.type === "input_text"
    ) {
      return !String(part.text || "").trim();
    }
    return false;
  });
}

function normalizeReasoningItem(item) {
  if (!item || typeof item !== "object") return null;

  let text = "";
  if (Array.isArray(item.content)) {
    text = item.content
      .filter((part) => part && typeof part === "object")
      .map((part) => {
        if (
          part.type === "reasoning_text"
          || part.type === "summary_text"
          || part.type === "text"
          || part.type === "output_text"
        ) {
          return part.text || "";
        }
        return typeof part.text === "string" ? part.text : "";
      })
      .join("");
  }

  if (!String(text).trim() && Array.isArray(item.summary)) {
    text = item.summary
      .map((part) => (part && typeof part === "object" ? (part.text || "") : ""))
      .join("");
  }

  if (!String(text).trim() && typeof item.text === "string") {
    text = item.text;
  }

  if (!String(text).trim()) {
    text = PLACEHOLDER_REASONING_TEXT;
  }

  const normalized = {
    type: "reasoning",
    content: [{ type: "reasoning_text", text: String(text) }],
  };
  if (item.id) normalized.id = item.id;
  if (item.status) normalized.status = item.status;
  return normalized;
}

function placeholderReasoningItem() {
  return {
    type: "reasoning",
    content: [{ type: "reasoning_text", text: PLACEHOLDER_REASONING_TEXT }],
  };
}
