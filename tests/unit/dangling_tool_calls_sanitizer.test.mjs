import test from 'node:test';
import assert from 'node:assert/strict';

function shouldSanitizeDanglingToolCalls(provider, body) {
  if (!provider) return false;

  if (provider.capabilities?.sanitize_dangling_tool_calls === true) return true;
  if (provider.sanitize_dangling_tool_calls === true) return true;

  // Case-insensitive check on requested model name (e.g. DeepSeek-V4-Flash, deepseek-chat)
  const modelName = String(body?.model || "").toLowerCase();
  if (modelName.includes("deepseek")) {
    return true;
  }

  return false;
}

function sanitizeDanglingToolCallsOpenAIChat(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;

  const existingToolOutputIds = new Set();
  for (const msg of messages) {
    if (msg && typeof msg === "object") {
      if (msg.role === "tool" && msg.tool_call_id) {
        existingToolOutputIds.add(msg.tool_call_id);
      }
    }
  }

  const newMessages = [];
  for (const msg of messages) {
    newMessages.push(msg);

    if (msg && typeof msg === "object" && msg.role === "assistant") {
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          const callId = toolCall?.id;
          if (callId && !existingToolOutputIds.has(callId)) {
            newMessages.push({
              role: "tool",
              tool_call_id: callId,
              content: "[System Note: Tool call execution was interrupted or cancelled.]",
            });
            existingToolOutputIds.add(callId);
          }
        }
      }
    }
  }

  return newMessages;
}

function sanitizeDanglingToolCallsResponsesInput(input) {
  if (!Array.isArray(input) || input.length === 0) return input;

  const existingToolOutputIds = new Set();
  for (const item of input) {
    if (item && typeof item === "object") {
      if (item.type === "function_call_output" || item.type === "custom_tool_call_output") {
        const callId = item.call_id || item.id;
        if (callId) existingToolOutputIds.add(callId);
      }
    }
  }

  const newInput = [];
  for (const item of input) {
    newInput.push(item);

    if (item && typeof item === "object") {
      if (item.type === "function_call" || item.type === "custom_tool_call") {
        const callId = item.call_id || item.id;
        if (callId && !existingToolOutputIds.has(callId)) {
          const outputType = item.type === "custom_tool_call" ? "custom_tool_call_output" : "function_call_output";
          newInput.push({
            type: outputType,
            call_id: callId,
            output: "[System Note: Tool call execution was interrupted or cancelled.]",
          });
          existingToolOutputIds.add(callId);
        }
      }
    }
  }

  return newInput;
}

function sanitizeDanglingToolCallsPayload(provider, body) {
  if (!body || typeof body !== "object" || !shouldSanitizeDanglingToolCalls(provider, body)) {
    return body;
  }

  const sanitizedBody = { ...body };

  if (Array.isArray(sanitizedBody.messages)) {
    sanitizedBody.messages = sanitizeDanglingToolCallsOpenAIChat(sanitizedBody.messages);
  }

  if (Array.isArray(sanitizedBody.input)) {
    sanitizedBody.input = sanitizeDanglingToolCallsResponsesInput(sanitizedBody.input);
  }

  return sanitizedBody;
}

test('Sanitizes dangling tool_calls for model name containing deepseek (case-insensitive)', () => {
  const provider = { name: 'ait_provider', base_url: 'https://openapi-ait.ke.com' };
  const body = {
    model: 'DeepSeek-V4-Flash',
    messages: [
      { role: 'user', content: 'hello' },
      {
        role: 'assistant',
        tool_calls: [{ id: 'call_bdc5ca8762774f7e90f1ffd9', function: { name: 'run_command' } }],
      },
    ],
  };

  const result = sanitizeDanglingToolCallsPayload(provider, body);
  assert.equal(result.messages.length, 3);
  assert.equal(result.messages[2].role, 'tool');
  assert.equal(result.messages[2].tool_call_id, 'call_bdc5ca8762774f7e90f1ffd9');
  assert.match(result.messages[2].content, /interrupted or cancelled/);
});

test('Does not sanitize if model name does not contain deepseek and capability is not set', () => {
  const provider = { name: 'deepseek_provider_ignored', base_url: 'https://api.deepseek.com' };
  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'assistant', tool_calls: [{ id: 'call_123' }] },
    ],
  };

  const result = sanitizeDanglingToolCallsPayload(provider, body);
  assert.equal(result.messages.length, 1);
});

test('Sanitizes if capability is set explicitly regardless of model name', () => {
  const provider = { capabilities: { sanitize_dangling_tool_calls: true } };
  const body = {
    model: 'claude-haiku-4-0',
    input: [
      { type: 'function_call', call_id: 'call_abc', name: 'search' },
    ],
  };

  const result = sanitizeDanglingToolCallsPayload(provider, body);
  assert.equal(result.input.length, 2);
  assert.equal(result.input[1].type, 'function_call_output');
  assert.equal(result.input[1].call_id, 'call_abc');
});
