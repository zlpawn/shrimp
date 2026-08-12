import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEBUG_PORT,
  resolveCodexAppCandidates,
  buildMacOSOpenCommand,
  buildMacOSQuitCommand,
  buildMacOSProcessQuery,
  createCodexLauncher,
} from "../../lib/dream-skin/runtime/launcher.mjs";
import { DreamSkinError } from "../../lib/dream-skin/domain/errors.mjs";

// --- Pure command tests ---

test("resolveCodexAppCandidates has deterministic order", () => {
  const candidates = resolveCodexAppCandidates("/Users/me");
  assert.deepEqual(candidates, [
    "/Users/me/Applications/ChatGPT.app",
    "/Users/me/Applications/Codex.app",
    "/Applications/ChatGPT.app",
    "/Applications/Codex.app",
  ]);
});

test("buildMacOSOpenCommand builds exact args", () => {
  const cmd = buildMacOSOpenCommand({ appPath: "/Applications/Codex.app", debugPort: 19222 });
  assert.equal(cmd.executable, "open");
  assert.deepEqual(cmd.args, [
    "-W",
    "-a",
    "/Applications/Codex.app",
    "--args",
    "--remote-debugging-port=19222",
    "--remote-allow-origins=http://127.0.0.1:19222",
  ]);
});

test("buildMacOSOpenCommand appends extra args as distinct elements", () => {
  const cmd = buildMacOSOpenCommand({
    appPath: "/Applications/Codex.app",
    debugPort: 1234,
    extraArgs: ["--no-sandbox", "--lang=en"],
  });
  assert.equal(cmd.args[cmd.args.length - 2], "--no-sandbox");
  assert.equal(cmd.args[cmd.args.length - 1], "--lang=en");
});

test("buildMacOSOpenCommand validates port range", () => {
  assert.throws(() => buildMacOSOpenCommand({ appPath: "x", debugPort: 0 }), DreamSkinError);
  assert.throws(() => buildMacOSOpenCommand({ appPath: "x", debugPort: 70000 }), DreamSkinError);
});

test("buildMacOSQuitCommand uses osascript with app name", () => {
  const cmd = buildMacOSQuitCommand("/Applications/ChatGPT.app");
  assert.equal(cmd.executable, "osascript");
  assert.equal(cmd.args[0], "-e");
  assert.equal(cmd.args[1], `tell application "ChatGPT" to quit`);
});

test("buildMacOSProcessQuery uses pgrep with app name", () => {
  const cmd = buildMacOSProcessQuery("/Applications/Codex.app");
  assert.equal(cmd.executable, "pgrep");
  assert.deepEqual(cmd.args, ["-fl", "Codex"]);
});

// --- Fake-process launcher tests ---

function makeSpies() {
  const spawned = [];
  const calls = { spawn: [], spawnSync: [], exists: [] };
  return {
    spawned,
    calls,
    spawn: async (executable, args, opts) => {
      calls.spawn.push({ executable, args, opts });
      const child = { pid: 4242, on() {} };
      spawned.push(child);
      return child;
    },
    spawnSync: async (executable, args) => {
      calls.spawnSync.push({ executable, args });
      return { stdout: "" };
    },
    exists: async (path) => {
      calls.exists.push(path);
      return path === "/Applications/Codex.app";
    },
  };
}

test("createCodexLauncher.resolveCodexAppPath uses configured path when it exists", async () => {
  const spies = makeSpies();
  const launcher = createCodexLauncher({
    platform: "darwin",
    homeDir: "/Users/me",
    exists: async (p) => p === "/custom/Codex.app",
    spawn: spies.spawn,
    spawnSync: spies.spawnSync,
    sleep: async () => {},
    waitForDebugEndpoint: async () => {},
  });
  const p = await launcher.resolveCodexAppPath("/custom/Codex.app");
  assert.equal(p, "/custom/Codex.app");
});

test("createCodexLauncher.resolveCodexAppPath rejects missing configured path", async () => {
  const launcher = createCodexLauncher({
    platform: "darwin",
    exists: async () => false,
    spawn: async () => {},
    spawnSync: async () => ({ stdout: "" }),
    sleep: async () => {},
    waitForDebugEndpoint: async () => {},
  });
  await assert.rejects(launcher.resolveCodexAppPath("/nope.app"), /does not exist/);
});

test("createCodexLauncher.launchWithDebugPort rejects unsupported platform", async () => {
  const launcher = createCodexLauncher({ platform: "win32" });
  await assert.rejects(launcher.launchWithDebugPort(), /only supports macOS/);
});

test("createCodexLauncher.launchWithDebugPort succeeds on darwin", async () => {
  const spies = makeSpies();
  const launcher = createCodexLauncher({
    platform: "darwin",
    homeDir: "/Users/me",
    exists: spies.exists,
    spawn: spies.spawn,
    spawnSync: spies.spawnSync,
    sleep: async () => {},
    waitForDebugEndpoint: async (port, opts) => {
      assert.equal(port, 19222);
      assert.equal(opts.maxWaitMs, 20000);
    },
  });
  const result = await launcher.launchWithDebugPort();
  assert.equal(result.appPath, "/Applications/Codex.app");
  assert.equal(result.debugPort, 19222);
  assert.ok(result.child.pid);
  // The spawn command must use open with --remote-debugging-port
  assert.equal(spies.calls.spawn[0].executable, "open");
  assert.ok(spies.calls.spawn[0].args.includes("--remote-debugging-port=19222"));
});

test("createCodexLauncher.launchWithDebugPort quits running app first", async () => {
  const calls = [];
  const exists = async (p) => p === "/Applications/Codex.app";
  const spawnSync = async (executable, args) => {
    calls.push({ kind: "spawnSync", executable, args });
    // First query says running, second says stopped
    return { stdout: calls.filter((c) => c.kind === "spawnSync").length === 1 ? "Codex" : "" };
  };
  const spawn = async (executable, args) => {
    calls.push({ kind: "spawn", executable, args });
    return { pid: 1, on() {} };
  };
  const launcher = createCodexLauncher({
    platform: "darwin",
    homeDir: "/Users/me",
    exists,
    spawn,
    spawnSync,
    sleep: async () => {},
    waitForDebugEndpoint: async () => {},
  });
  await launcher.launchWithDebugPort();
  // Sequence: pgrep (running) -> osascript quit -> pgrep (stopped) -> open
  const kinds = calls.map((c) => `${c.kind}:${c.executable}`);
  assert.deepEqual(kinds, [
    "spawnSync:pgrep",
    "spawn:osascript",
    "spawnSync:pgrep",
    "spawn:open",
  ]);
});

test("DEFAULT_DEBUG_PORT is 19222", () => {
  assert.equal(DEFAULT_DEBUG_PORT, 19222);
});