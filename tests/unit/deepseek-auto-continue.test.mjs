import test from "node:test";
import assert from "node:assert/strict";

import {
  appendDeepSeekAutoContinuePrompt,
  responseHasToolCalls,
  extractResponseText,
  hasAgentToolContext,
  looksLikeDeepSeekMidTaskStop,
  shouldAttemptDeepSeekAutoContinue,
  runDeepSeekAutoContinueLoop,
  resolveDeepSeekAutoContinueSettings,
  mergePreservedStageText,
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

function agentBody(extra = {}) {
  return {
    model: "DeepSeek-V4-Flash",
    tools: [{ type: "function", name: "shell_command" }],
    input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "go" }] }],
    ...extra,
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

test("hasAgentToolContext requires tools or tool trajectory", () => {
  assert.equal(hasAgentToolContext({ input: [] }), false);
  assert.equal(hasAgentToolContext(agentBody()), true);
  assert.equal(
    hasAgentToolContext({
      input: [{ type: "function_call", call_id: "c1", name: "shell_command", arguments: "{}" }],
    }),
    true,
  );
});

test("looksLikeDeepSeekMidTaskStop is narrow by default", () => {
  assert.equal(
    looksLikeDeepSeekMidTaskStop("Plan 3 完成（203 tests 全绿）。现在进入 Plan 4：运行时静态隔离。"),
    true,
  );
  assert.equal(
    looksLikeDeepSeekMidTaskStop("我先说明下方案：这里有两个问题，建议先改 A，然后处理 B。"),
    false,
  );
  assert.equal(
    looksLikeDeepSeekMidTaskStop("这是一段超过二十四字的普通最终答案说明，没有中途停的线索。"),
    false,
  );
});

test("shouldAttemptDeepSeekAutoContinue only for DeepSeek pure-text mid-task stops in agent context", () => {
  const provider = { name: "deepseek", base_url: "https://api.deepseek.com" };
  const body = agentBody();

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "DeepSeek-V4-Flash",
      provider,
      body,
      response: textResponse("Plan 3 完成（203 tests 全绿）。现在进入 Plan 4：运行时静态隔离。"),
      attempt: 0,
      maxAttempts: 1,
    }).ok,
    true,
  );

  // Plain chat without tools should not continue by default.
  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "DeepSeek-V4-Flash",
      provider,
      body: {
        model: "DeepSeek-V4-Flash",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }],
      },
      response: textResponse("Plan 3 完成。现在进入 Plan 4。"),
      attempt: 0,
      maxAttempts: 1,
    }).ok,
    false,
  );

  assert.equal(
    shouldAttemptDeepSeekAutoContinue({
      model: "glm-5.2",
      provider: { name: "huoshan" },
      body,
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
      body,
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
      body,
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
      body,
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
      tools: [{ type: "function", name: "shell_command" }],
      tool_choice: "none",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "执行全部 plan" }],
        },
      ],
    },
    {
      output: [
        {
          type: "reasoning",
          content: [{ type: "reasoning_text", text: "need next tool" }],
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Plan 3 完成。现在进入 Plan 4。" }],
        },
      ],
    },
  );

  assert.equal(next.input.length, 4);
  assert.equal(next.input[1].type, "reasoning");
  assert.equal(next.input[2].type, "message");
  assert.equal(next.input[2].role, "assistant");
  assert.equal(next.input[3].role, "user");
  assert.match(JSON.stringify(next.input[3]), /继续执行/);
  assert.equal(next.stream, false);
  assert.equal(next.tool_choice, "auto");
});

test("runDeepSeekAutoContinueLoop retries once and returns later tool response", async () => {
  const calls = [];
  const first = textResponse("Task 1 已提交。现在做 Task 2。");
  const second = toolResponse();

  const result = await runDeepSeekAutoContinueLoop({
    body: agentBody(),
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
  assert.match(JSON.stringify(result.response.output), /Task 1 已提交/);
  assert.match(JSON.stringify(calls[0].input), /继续执行/);
});

test("runDeepSeekAutoContinueLoop stops when second response is still pure text", async () => {
  const first = textResponse("现在进入 Plan 4");
  const second = textResponse("全部完成了。");

  const result = await runDeepSeekAutoContinueLoop({
    body: agentBody(),
    response: first,
    model: "DeepSeek-V4-Flash",
    provider: { name: "deepseek" },
    maxAttempts: 1,
    fetchResponse: async () => second,
  });

  assert.equal(result.attempts, 1);
  assert.equal(result.stopReason, "still_text");
  assert.match(extractResponseText(result.response), /现在进入 Plan 4/);
  assert.match(extractResponseText(result.response), /全部完成了/);
});

test("runDeepSeekAutoContinueLoop no-ops for non-DeepSeek or tool responses", async () => {
  let called = false;
  const tool = toolResponse();
  const result = await runDeepSeekAutoContinueLoop({
    body: agentBody({ input: [] }),
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

test("resolveDeepSeekAutoContinueSettings merges config and env", () => {
  const settings = resolveDeepSeekAutoContinueSettings({
    config: {
      tools: {
        deepseek_auto_continue: {
          enabled: true,
          max_attempts: 2,
          require_agent_context: true,

          preserve_stage_text: true,
          prompt: "请继续",
        },
      },
    },
    env: {
      DEEPSEEK_AUTO_CONTINUE_MAX_ATTEMPTS: "1",
    },
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.max_attempts, 1);
  assert.equal(settings.prompt, "请继续");
  assert.equal(settings.require_agent_context, true);

});

test("mergePreservedStageText keeps first stage summary", () => {
  const merged = mergePreservedStageText(
    textResponse("阶段总结 A"),
    toolResponse(),
  );
  assert.match(JSON.stringify(merged.output), /阶段总结 A/);
  assert.equal(responseHasToolCalls(merged), true);
});
