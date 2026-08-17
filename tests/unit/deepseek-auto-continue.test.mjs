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
  accumulateUsage,
} from "../../lib/codex/deepseek-auto-continue.mjs";
import {
  sanitizeDeepSeekResponsesInput,
} from "../../lib/codex/deepseek-input-sanitizer.mjs";

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

function toolResponse(extras = {}) {
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
    ...extras,
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

test("looksLikeDeepSeekMidTaskStop handles tail windows and expanded hints without false positives", () => {
  assert.equal(
    looksLikeDeepSeekMidTaskStop("Plan 3 完成（203 tests 全绿）。现在进入 Plan 4：运行时静态隔离。"),
    true,
  );
  assert.equal(
    looksLikeDeepSeekMidTaskStop("模块 A 的重构已经完成，所有用例通过。\n\n接下来我将创建测试用例并运行。"),
    true,
  );
  assert.equal(
    looksLikeDeepSeekMidTaskStop("Plan 1 已经完成。下面开始执行代码修改："),
    true,
  );
  assert.equal(
    looksLikeDeepSeekMidTaskStop("Step 1 done. I will now proceed to implement the database migration."),
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
  assert.equal(
    looksLikeDeepSeekMidTaskStop("所有修改已经全部完成。最终结果如上，无需继续。"),
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
  assert.match(JSON.stringify(next.input[3]), /请立即直接调用工具/);
  assert.equal(next.stream, false);
  assert.equal(next.tool_choice, "auto");
});

test("runDeepSeekAutoContinueLoop retries once, aggregates usage, and returns later tool response", async () => {
  const calls = [];
  const first = textResponse("Task 1 已提交。现在做 Task 2。", {
    usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
  });
  const second = toolResponse({
    usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 },
  });

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
  assert.match(JSON.stringify(calls[0].input), /请立即直接调用工具/);
  assert.equal(result.response.usage.input_tokens, 220);
  assert.equal(result.response.usage.output_tokens, 70);
  assert.equal(result.response.usage.total_tokens, 290);
});

test("runDeepSeekAutoContinueLoop avoids text pollution loop when second response is still pure text", async () => {
  const first = textResponse("现在进入 Plan 4", {
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
  });
  const second = textResponse("好的，我明白了。接下来做 Plan 4。", {
    usage: { input_tokens: 110, output_tokens: 25, total_tokens: 135 },
  });

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
  // Kept first response cleanly without repetitive garbage pollution
  assert.equal(extractResponseText(result.response), "现在进入 Plan 4");
  assert.equal(result.response.usage.total_tokens, 255);
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

test("mergePreservedStageText keeps first stage summary and respects reasoning position", () => {
  const merged = mergePreservedStageText(
    textResponse("阶段总结 A"),
    {
      ...toolResponse(),
      output: [
        { type: "reasoning", content: [{ type: "reasoning_text", text: "thinking..." }] },
        { type: "function_call", call_id: "c1", name: "edit", arguments: "{}" },
      ],
    },
  );
  assert.equal(merged.output[0].type, "reasoning");
  assert.equal(merged.output[1].type, "message");
  assert.equal(merged.output[2].type, "function_call");
  assert.match(JSON.stringify(merged.output), /阶段总结 A/);
  assert.equal(responseHasToolCalls(merged), true);
});

test("accumulateUsage correctly sums token counts across rounds", () => {
  const u1 = { input_tokens: 100, output_tokens: 50, total_tokens: 150 };
  const u2 = { input_tokens: 80, output_tokens: 40, total_tokens: 120 };
  const acc = accumulateUsage(u1, u2);
  assert.equal(acc.input_tokens, 180);
  assert.equal(acc.output_tokens, 90);
  assert.equal(acc.total_tokens, 270);
});

test("sanitizeDeepSeekResponsesInput proactively injects agent execution rules when tools are present", () => {
  const source = {
    model: "deepseek-chat",
    tools: [{ type: "function", name: "shell_command" }],
    input: [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "run task" }],
      },
    ],
  };

  const sanitized = sanitizeDeepSeekResponsesInput(source);
  assert.equal(sanitized.input[0].role, "system");
  assert.match(JSON.stringify(sanitized.input[0].content), /Agent Execution Rules for DeepSeek/);
});
