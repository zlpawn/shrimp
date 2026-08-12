import test from "node:test";
import assert from "node:assert/strict";
import {
  isDeepSeekResponsesModel,
  sanitizeDeepSeekResponsesInput,
} from "../../lib/codex/deepseek-input-sanitizer.mjs";
import { sanitizeResponsesInput } from "../../lib/codex/grok-input-sanitizer.mjs";

test("isDeepSeekResponsesModel matches model name and provider hints", () => {
  assert.equal(isDeepSeekResponsesModel("DeepSeek-V4-Flash"), true);
  assert.equal(isDeepSeekResponsesModel("gpt-5.6"), false);
  assert.equal(
    isDeepSeekResponsesModel("claude-haiku-4-0", {
      model_mapping: { "claude-haiku-4-0": "deepseek-v4-flash-ga" },
    }),
    true,
  );
  assert.equal(
    isDeepSeekResponsesModel("custom-model", {
      name: "deepseek",
      base_url: "https://api.deepseek.com",
    }),
    true,
  );
});

test("sanitizeDeepSeekResponsesInput fills dangling function_call outputs", () => {
  const cleaned = sanitizeDeepSeekResponsesInput({
    model: "DeepSeek-V4-Flash",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "ls" }],
      },
      {
        type: "function_call",
        call_id: "call_9d8684004b7d49f1a89aa18e",
        name: "exec_command",
        arguments: "{\"cmd\":\"ls\"}",
      },
    ],
  });

  assert.equal(cleaned.input.some((item) => item.type === "reasoning"), true);
  assert.equal(
    cleaned.input.some(
      (item) =>
        item.type === "function_call_output"
        && item.call_id === "call_9d8684004b7d49f1a89aa18e",
    ),
    true,
  );
});

test("sanitizeDeepSeekResponsesInput keeps reasoning_text for tool turns", () => {
  const cleaned = sanitizeDeepSeekResponsesInput({
    model: "DeepSeek-V4-Flash",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "use the tool" }],
      },
      {
        type: "reasoning",
        id: "rs_1",
        summary: [{ type: "summary_text", text: "Need to call the tool." }],
      },
      {
        type: "function_call",
        call_id: "call_abc",
        name: "exec_command",
        arguments: "{\"cmd\":\"echo hi\"}",
      },
      {
        type: "function_call_output",
        call_id: "call_abc",
        output: "hi",
      },
    ],
  });

  const reasoning = cleaned.input.find((item) => item.type === "reasoning");
  const call = cleaned.input.find((item) => item.type === "function_call");
  const output = cleaned.input.find((item) => item.type === "function_call_output");

  assert.ok(reasoning);
  assert.equal(reasoning.content[0].type, "reasoning_text");
  assert.match(reasoning.content[0].text, /Need to call the tool/);
  assert.equal(call.call_id, "call_abc");
  assert.equal(output.output, "hi");

  const generic = sanitizeResponsesInput({
    model: "glm-5.2",
    input: [
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "should drop" }],
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hello" }],
      },
    ],
  });
  assert.equal(generic.input.some((item) => item.type === "reasoning"), false);
});

test("sanitizeDeepSeekResponsesInput moves outputs next to calls and drops empty assistant gap", () => {
  const cleaned = sanitizeDeepSeekResponsesInput({
    model: "DeepSeek-V4-Flash",
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "run tools" }],
      },
      {
        type: "function_call",
        call_id: "call_01_F0I2I9cmCoKJMG8cqEHq9015",
        name: "exec_command",
        arguments: "{\"cmd\":\"echo 1\"}",
      },
      {
        type: "function_call",
        call_id: "call_ab8b7e00241a4beeb56efb1d",
        name: "exec_command",
        arguments: "{\"cmd\":\"echo 2\"}",
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "" }],
      },
      {
        type: "function_call_output",
        call_id: "call_01_F0I2I9cmCoKJMG8cqEHq9015",
        output: "1",
      },
      {
        type: "function_call_output",
        call_id: "call_ab8b7e00241a4beeb56efb1d",
        output: "2",
      },
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "continue" }],
      },
    ],
  });

  const types = cleaned.input.map((item) => item.type);
  const firstCall = types.indexOf("function_call");
  assert.ok(firstCall >= 1);
  assert.equal(cleaned.input[firstCall - 1].type, "reasoning");
  assert.equal(cleaned.input[firstCall].call_id, "call_01_F0I2I9cmCoKJMG8cqEHq9015");
  assert.equal(cleaned.input[firstCall + 1].call_id, "call_ab8b7e00241a4beeb56efb1d");
  assert.equal(cleaned.input[firstCall + 2].type, "function_call_output");
  assert.equal(cleaned.input[firstCall + 2].call_id, "call_01_F0I2I9cmCoKJMG8cqEHq9015");
  assert.equal(cleaned.input[firstCall + 3].type, "function_call_output");
  assert.equal(cleaned.input[firstCall + 3].call_id, "call_ab8b7e00241a4beeb56efb1d");
  assert.equal(
    cleaned.input.some(
      (item) => item.type === "message" && item.role === "assistant",
    ),
    false,
  );
});
