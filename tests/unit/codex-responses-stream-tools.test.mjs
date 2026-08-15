import assert from "node:assert/strict";
import test from "node:test";
import { ResponsesWriter } from "../../lib/codex/responses-writer.mjs";
import { normalizeCustomInput } from "../../lib/codex/responses-writer.mjs";

test("normalizeCustomInput correctly extracts input and aliases", () => {
  assert.equal(normalizeCustomInput('{"input":"ls -la"}').input, "ls -la");
  assert.equal(normalizeCustomInput('{"command":"ls -la"}').input, "ls -la");
  assert.equal(normalizeCustomInput('{"cmd":"npm test"}').input, "npm test");
  assert.equal(normalizeCustomInput('{"patch":"*** diff ***"}').input, "*** diff ***");
  assert.equal(normalizeCustomInput('ls -la').input, "ls -la");
});

test("streamFinalResponsesObject handles custom tool mappings and Zhipu reasoning format", () => {
  const zhipuResponse = {
    id: "resp_zhipu_test",
    object: "response",
    model: "GLM-5.3",
    status: "completed",
    output: [
      {
        type: "reasoning",
        id: "rs_123",
        summary: [],
        content: [
          { type: "reasoning_text", text: "I will check directory contents." }
        ]
      },
      {
        type: "function_call",
        id: "fc_call_1",
        call_id: "call_1",
        name: "exec_command",
        arguments: JSON.stringify({ command: "ls -la" })
      }
    ],
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
  };

  const toolKinds = new Map([["exec_command", "custom"]]);

  const emitted = [];
  const writer = new ResponsesWriter({
    model: "GLM-5.3",
    responseId: zhipuResponse.id,
    emit: (event, payload) => emitted.push({ event, payload }),
  });

  writer.created();
  for (const item of zhipuResponse.output) {
    if (item.type === "reasoning") {
      let reasoningText = "";
      if (Array.isArray(item.summary) && item.summary.length > 0) {
        reasoningText = item.summary.map((s) => s?.text || "").join("");
      } else if (Array.isArray(item.content) && item.content.length > 0) {
        reasoningText = item.content
          .filter((part) => part && typeof part === "object")
          .map((part) => part.text || part.reasoning_text || "")
          .join("");
      } else if (typeof item.text === "string" && item.text) {
        reasoningText = item.text;
      }
      if (reasoningText) writer.reasoningDelta(reasoningText);
    } else if (item.type === "function_call" || item.type === "custom_tool_call") {
      const name = item.name || "";
      const kind = toolKinds.get(name) || (item.type === "custom_tool_call" ? "custom" : "function");
      const callId = item.call_id || item.id || "call_1";
      const rawArgs = typeof item.arguments === "string"
        ? item.arguments
        : (typeof item.input === "string" ? item.input : JSON.stringify(item.arguments ?? item.input ?? {}));

      if (kind === "custom") {
        const normalized = normalizeCustomInput(rawArgs);
        writer.functionArgumentsDelta({
          index: 0,
          callId,
          name,
          delta: normalized.input,
          kind,
        });
        writer.finishFunction({
          index: 0,
          callId,
          name,
          argumentsText: rawArgs,
          kind,
        });
      }
    }
  }
  writer.completed(zhipuResponse.usage);

  // Assertions
  const reasoningDelta = emitted.find((e) => e.event === "response.reasoning_summary_text.delta");
  assert.ok(reasoningDelta, "Reasoning delta should be emitted");
  assert.equal(reasoningDelta.payload.delta, "I will check directory contents.");

  const customDelta = emitted.find((e) => e.event === "response.custom_tool_call_input.delta");
  assert.ok(customDelta, "custom_tool_call_input delta should be emitted");
  assert.equal(customDelta.payload.delta, "ls -la");

  const customDone = emitted.find((e) => e.event === "response.custom_tool_call_input.done");
  assert.ok(customDone, "custom_tool_call_input done should be emitted");
  assert.equal(customDone.payload.input, "ls -la");

  const itemDone = emitted.find((e) => e.event === "response.output_item.done" && e.payload.item.type === "custom_tool_call");
  assert.ok(itemDone, "Output item done should have type custom_tool_call");
  assert.equal(itemDone.payload.item.input, "ls -la");
});
