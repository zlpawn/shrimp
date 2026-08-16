import test from "node:test";
import assert from "node:assert/strict";

import { createCliDispatchers } from "../../lib/session-kanban/infra/cli-dispatchers.mjs";

test("dispatchers build official CLI resume commands without a shell", async () => {
  const calls = [];
  const runners = new Map([["claude", async args => { calls.push(["claude", args]); return { stdout: "done" }; }]]);
  const dispatchers = createCliDispatchers({ runners });

  const claude = dispatchers.find(item => item.client === "claude");
  const result = await claude.dispatch({
    id: "s1",
    dispatchTarget: "s1",
    workspacePath: "D:/repo",
  }, "Please continue");

  assert.deepEqual(calls[0], ["claude", ["--resume", "s1", "--print", "Please continue"]]);
  assert.equal(result.command, "claude --resume s1 --print <message>");
  assert.equal(result.exitCode, 0);
});

test("dispatchers inherit the workspace as cwd", async () => {
  const calls = [];
  const runners = new Map([["antigravity", async (args, options) => { calls.push({ args, options }); return { stdout: "" }; }]]);
  const dispatchers = createCliDispatchers({ runners });
  const agy = dispatchers.find(item => item.client === "antigravity");
  await agy.dispatch({ dispatchTarget: "conv1", workspacePath: "D:/work" }, "Next step");

  assert.deepEqual(calls[0].args, ["--conversation", "conv1", "--print", "Next step"]);
  assert.equal(calls[0].options.cwd, "D:/work");
});

test("codex uses official resume command", async () => {
  const calls = [];
  const runners = new Map([["codex", async args => { calls.push(args); return { stdout: "" }; }]]);
  const dispatchers = createCliDispatchers({ runners });
  const codex = dispatchers.find(item => item.client === "codex");
  await codex.dispatch({ dispatchTarget: "thread1", workspacePath: "D:/repo" }, "Continue");

  assert.deepEqual(calls[0], ["exec", "resume", "thread1", "Continue"]);
});

test("command failure throws error", async () => {
  const runners = new Map([["claude", async () => {
    const error = new Error("auth failed");
    error.stderr = "auth failed";
    throw error;
  }]]);
  const dispatchers = createCliDispatchers({ runners });
  const claude = dispatchers.find(item => item.client === "claude");
  await assert.rejects(() => claude.dispatch({ dispatchTarget: "s1" }, "Hi"), /auth failed/);
});
