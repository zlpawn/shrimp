import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { executeCommand } from "../scripts/cli/lib/cli.mjs";
import { wrapEvalScript as cliWrap } from "../scripts/cli/lib/protocol.mjs";
import {
  evalShouldFallback,
  pressKeyEventInit,
  wrapEvalScript as extensionWrap,
} from "../../../../extensions/leo-cookie-txt-locally/page-drive.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function sentBy(command, params, positional = []) {
  const fake = await startFakeExtension();
  try {
    await executeCommand(command, params, positional, { port: fake.port });
    return fake.commands.at(-1);
  } finally {
    await fake.stop();
  }
}

test("find --text sends a semantic target", async () => {
  const cmd = await sentBy("find", { text: "保存" });
  assert.deepEqual(cmd.params.target, { kind: "semantic", text: "保存", match: "contains" });
});

test("find --sel sends a CSS target", async () => {
  const cmd = await sentBy("find", { sel: "button.primary" });
  assert.deepEqual(cmd.params.target, { kind: "css", selector: "button.primary" });
});

test("find without any target fails before reaching the extension", async () => {
  await assert.rejects(executeCommand("find", {}, [], { port: 1 }), /target is required/);
});

test("upload --files splits a comma list into absolute paths", async () => {
  const cmd = await sentBy("upload", { files: "a.png, /tmp/b.png" });
  assert.deepEqual(cmd.params.files, [path.resolve("a.png"), "/tmp/b.png"]);
});

test("upload keeps commas inside a positional path", async () => {
  const cmd = await sentBy("upload", {}, ["/tmp/a,b.png"]);
  assert.deepEqual(cmd.params.files, ["/tmp/a,b.png"]);
});

for (const [name, wrap] of [["CLI", cliWrap], ["extension", extensionWrap]]) {
  test(`${name} eval: await without return yields the expression value`, async () => {
    assert.equal(await (0, eval)(wrap("await Promise.resolve(42)")), 42);
  });

  test(`${name} eval: await statements yield the last expression`, async () => {
    assert.equal(await (0, eval)(wrap("const v = await Promise.resolve(42); v + 1;")), 43);
  });

  test(`${name} eval: await statements without a final expression still run`, async () => {
    const script = "globalThis.__ranAwaitBlock = await Promise.resolve(7); if (true) { void 0 }";
    await (0, eval)(wrap(script));
    assert.equal(globalThis.__ranAwaitBlock, 7);
    delete globalThis.__ranAwaitBlock;
  });

  test(`${name} eval: real syntax errors still surface`, async () => {
    await assert.rejects(async () => (0, eval)(wrap("await (")), SyntaxError);
  });
}

test("eval falls back to script injection unless CDP timed out", () => {
  assert.equal(evalShouldFallback(new Error("Debugger is not attached")), true);
  assert.equal(evalShouldFallback({ code: "command_timeout", message: "CDP evaluate timeout" }), false);
});

test("press events carry the legacy fields components check", () => {
  assert.deepEqual(pressKeyEventInit("Enter"), { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
  assert.deepEqual(pressKeyEventInit("Escape"), { key: "Escape", code: "Escape", keyCode: 27, which: 27 });
  assert.deepEqual(pressKeyEventInit("a"), { key: "a", code: "KeyA", keyCode: 65, which: 65 });
  assert.deepEqual(pressKeyEventInit("MediaPlayPause"), { key: "MediaPlayPause" });
});

test("bridge forwards the caller's timeout to the extension", async () => {
  const fake = await startFakeExtension();
  try {
    await fake.bridge.dispatch("dom.wait", { selector: ".x", timeoutMs: 60000 }, 62000);
    assert.equal(fake.commands.at(-1).timeoutMs, 62000);
  } finally {
    await fake.stop();
  }
});

test("wait without an explicit timeout gets the 30s wait budget plus allowance", async () => {
  const fake = await startFakeExtension();
  try {
    await executeCommand("wait", { sel: ".x" }, [], { port: fake.port });
    assert.equal(fake.commands.at(-1).timeoutMs, 32000);
  } finally {
    await fake.stop();
  }
});

test("server command prints the address, not the server object", async () => {
  const child = spawn("node", [path.join(SKILL_DIR, "scripts/cli/index.mjs"), "server", "--port", "0"]);
  let out = "";
  child.stdout.on("data", (chunk) => (out += chunk));
  await new Promise((resolve) => setTimeout(resolve, 600));
  child.kill();
  assert.match(out, /listening on http:\/\/127\.0\.0\.1:\d+/);
  assert.doesNotMatch(out, /pendingCommands/);
});
