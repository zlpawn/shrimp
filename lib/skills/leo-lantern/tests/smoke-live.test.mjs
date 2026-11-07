import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LanternServer } from "../scripts/cli/lib/server.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/smoke-live.mjs");

function runSmoke(...args) {
  return new Promise((resolve) => {
    const child = spawn("node", [SCRIPT, ...args]);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("exit", (code) => resolve({ code, out }));
  });
}

async function closedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("smoke-live fails without false success when no bridge is running", async () => {
  const { code, out } = await runSmoke("--port", String(await closedPort()));
  assert.notEqual(code, 0);
  assert.doesNotMatch(out, /✅/);
});

test("smoke-live fails when the bridge has no extension connected", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    const { code, out } = await runSmoke("--port", String(bridge.port));
    assert.notEqual(code, 0);
    assert.doesNotMatch(out, /✅/);
  } finally {
    await bridge.stop();
  }
});

test("smoke-live runs doctor, state, find, and click against a connected extension", async () => {
  const fake = await startFakeExtension((cmd) => {
    if (cmd.type === "dom.state") {
      return { url: "https://x.test", generation: "g1", elements: [{ ref: 1, tag: "button", text: "保存" }] };
    }
    if (cmd.type === "dom.find") return { matches_n: 1 };
    return { clicked: true };
  });
  try {
    const { code, out } = await runSmoke("--port", String(fake.port), "--text", "保存", "--click");
    assert.equal(code, 0, out);
    assert.match(out, /extension version: 9\.9\.9/);
    assert.deepEqual(fake.commands.map((c) => c.type), ["dom.state", "dom.find", "dom.click"]);
    assert.deepEqual(fake.commands[1].params.target, { kind: "semantic", text: "保存", match: "contains" });
    assert.equal(fake.commands[2].params.text, "保存");
  } finally {
    await fake.stop();
  }
});
