import test from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, executeCommand } from "../../lib/browser-bridge/cli.mjs";
import { BridgeServer } from "../../lib/browser-bridge/server.mjs";

test("CLI: parseCliArgs parses commands, flags, and positionals", () => {
  const parsed1 = parseCliArgs(["click", "--text", "Sign In", "--tabId", "42"]);
  assert.equal(parsed1.command, "click");
  assert.equal(parsed1.params.text, "Sign In");
  assert.equal(parsed1.params.tabId, "42");

  const parsed2 = parseCliArgs(["goto", "https://google.com"]);
  assert.equal(parsed2.command, "goto");
  assert.deepEqual(parsed2.positional, ["https://google.com"]);

  const parsed3 = parseCliArgs(["help"]);
  assert.equal(parsed3.command, "help");
});

test("CLI: executeCommand help and health check", async () => {
  const helpResult = await executeCommand("help");
  assert.ok(helpResult.help.includes("Usage: bcli"));

  const bridge = new BridgeServer({ port: 19532 });
  await bridge.start();

  try {
    const healthResult = await executeCommand("health", {}, [], { port: 19532 });
    assert.equal(healthResult.ok, true);
    assert.equal(healthResult.bridge, true);
  } finally {
    await bridge.stop();
  }
});
