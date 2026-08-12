import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDeepSeekAutoContinuePrompt,
  responseHasToolCalls,
  extractResponseText,
  shouldAttemptDeepSeekAutoContinue,
  runDeepSeekAutoContinueLoop,
} from "../../lib/codex/deepseek-auto-continue.mjs";

function textResponse(text, extras = {}) {
  return {
    id: "resp_test",
    object: "response",
    status: "completed",
    output_text: text,
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text }],
      },
    ],
    ...extras,
  };
}

function toolResponse() {
  return {
    id: "resp_tool",
    object: "response",
    status: "completed",
    output_text: "",
    output: [
      {
        type: "function_call",
        call_id: "call_1",
        name: "shell_command",
        arguments: "{\"command\":\"ls\"}",
      },
    ],
  };
}

test("responseHasToolCalls detects function_call and custom_tool_call", () => {
  assert.equal(responseHasToolCalls(toolResponse()), true);
  assert.equal(responseHasToolCalls(textResponse("hello")), false);
  assert.equal(
    responseHasToolCalls({
      output: [{ type: "custom_tool_call", call_id: "c1", name: "web_search", input: "q" }],
    }),
    true,
  );
});

test("extractResponseText prefers output_text and falls back to message content", () => {
  assert.equal(extractResponseText(textResponse("Plan 3 完成")), "Plan 3 完成");
  assert.equal(
    extractResponseText({
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "下一步" }],
        },
      ],
    }),
    "下一步",
  );
});

test("shouldAttemptDeepSeekAutoContinue only for DeepSeek pure-text mid-task stops", () => {
  const provider = { name: "deepseek", base_url: "https://api.deepseek.com" };

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "DeepSeek-V4-Flash",
      provider,
      response: textResponse("Plan 3 完成（203 tests 全绿）。现在进入 Plan 4：运行时静态隔离。"),
      attempt: 0,
      maxAttempts: 1,
    }).ok,
    true,
  );

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "glm-5.2",
      provider: { name: "huoshan" },
      response: textResponse("现在进入 Plan 4"),
      attempt: 0,
      maxAttempts: 1,
    }).ok,
    false,
  );

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "DeepSeek-V4-Flash",
      provider,
      response: toolResponse(),
      attempt: 0,
      maxAttempts: 1,
    }).ok,
    false,
  );

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "DeepSeek-V4-Flash",
      provider,
      response: textResponse("全部完成。最终结果如下。"),
      attempt: 0,
      maxAttempts: 1,
    }).ok,
    false,
  );

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "DeepSeek-V4-Flash",
      provider,
      response: textResponse("现在进入 Plan 4"),
      attempt: 1,
      maxAttempts: 1,
    }).ok,
    false,
  );
});

test("appendDeepSeekAutoContinuePrompt appends assistant output and continue user message", () => {
  const next = appendDeepSeekAutoContinuePrompt(
    {
      model: "DeepSeek-V4-Flash",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "执行全部 plan" }],
        },
      ],
    },
    textResponse("Plan 3 完成。现在进入 Plan 4。"),
  );

  assert.equal(next.input.length, 3);
  assert.equal(next.input[1].type, "message");
  assert.equal(next.input[1].role, "assistant");
  assert.equal(next.input[2].role, "user");
  assert.match(JSON.stringify(next.input[2]), /继续执行/);
  assert.equal(next.stream, false);
});

test("runDeepSeekAutoContinueLoop retries once and returns later tool response", async () => {
  const calls = [];
  const first = textResponse("Task 1 已提交。现在做 Task 2。");
  const second = toolResponse();

  const result = await runDeepSeekAutoContinueLoop({
    body: {
      model: "DeepSeek-V4-Flash",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }],
    },
    response: first,
    model: "DeepSeek-V4-Flash",
    provider: { name: "deepseek", base_url: "https://api.deepseek.com" },
    maxAttempts: 1,
    fetchResponse: async (body) => {
      calls.push(body);
      return second;
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.stopReason, "continued_with_tools");
  assert.equal(result.response, second);
  assert.match(JSON.stringify(calls[0].input), /继续执行/);
});

test("runDeepSeekAutoContinueLoop stops when second response is still pure text", async () => {
  const first = textResponse("现在进入 Plan 4");
  const second = textResponse("全部完成了。");

  const result = await runDeepSeekAutoContinueLoop({
    body: {
      model: "DeepSeek-V4-Flash",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }],
    },
    response: first,
    model: "DeepSeek-V4-Flash",
    provider: { name: "deepseek" },
    maxAttempts: 1,
    fetchResponse: async () => second,
  });

  assert.equal(result.attempts, 1);
  assert.equal(result.stopReason, "still_text");
  assert.equal(result.response, second);
});

test("runDeepSeekAutoContinueLoop no-ops for non-DeepSeek or tool responses", async () => {
  let called = false;
  const tool = toolResponse();
  const result = await runDeepSeekAutoContinueLoop({
    body: { model: "DeepSeek-V4-Flash", input: [] },
    response: tool,
    model: "DeepSeek-V4-Flash",
    provider: { name: "deepseek" },
    maxAttempts: 1,
    fetchResponse: async () => {
      called = true;
      return tool;
    },
  });

  assert.equal(called, false);
  assert.equal(result.attempts, 0);
  assert.equal(result.stopReason, "has_tool_calls");
  assert.equal(result.response, tool);
});

