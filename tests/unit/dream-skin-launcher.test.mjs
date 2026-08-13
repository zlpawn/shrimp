import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEBUG_PORT,
  resolveCodexAppCandidates,
  resolveWindowsAppCandidates,
  buildWindowsLaunchArgs,
  buildWindowsPackagedActivation,
  buildWindowsStandaloneCommand,
  buildWindowsProcessQuery,
  buildWindowsQuitCommand,
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
  const launcher = createCodexLauncher({ platform: "linux" });
  await assert.rejects(launcher.launchWithDebugPort(), /only supports macOS and Windows/);
});

test("createCodexLauncher.launchWithDebugPort succeeds on darwin when not running", async () => {
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

test("createCodexLauncher.launchWithDebugPort refuses to quit a running app", async () => {
  const calls = [];
  const exists = async (p) => p === "/Applications/Codex.app";
  const spawnSync = async (executable, args) => {
    calls.push({ kind: "spawnSync", executable, args });
    return { stdout: "Codex" };
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
    listTargets: async () => { throw new Error("no debug endpoint"); },
    waitForDebugEndpoint: async () => {},
  });
  await assert.rejects(
    launcher.launchWithDebugPort(),
    /请先退出 Codex/,
  );
  // pgrep was called once, but never osascript quit or open
  const kinds = calls.map((c) => `${c.kind}:${c.executable}`);
  assert.deepEqual(kinds, ["spawnSync:pgrep"]);
});


// --- Windows builders ---

test("resolveWindowsAppCandidates includes MS Store and standalone paths", () => {
  const candidates = resolveWindowsAppCandidates({
    localAppData: "C:\\Users\\me\\AppData\\Local",
    programFiles: "C:\\Program Files",
  });
  assert.ok(candidates.some((p) => p.includes("WindowsApps\\OpenAI.Codex_*\\app")));
  assert.ok(candidates.some((p) => p.includes("WindowsApps\\OpenAI.CodexBeta_*\\app")));
  assert.ok(candidates.some((p) => p.includes("WindowsApps\\OpenAI.ChatGPT-Desktop_*\\app")));
  assert.ok(candidates.some((p) => p.includes("OpenAI\\Codex\\bin")));
  assert.ok(candidates.some((p) => p.includes("OpenAI\\Codex")));
});

test("buildWindowsLaunchArgs builds debug flags and appends extras", () => {
  const args = buildWindowsLaunchArgs({ debugPort: 19222, extraArgs: ["--no-sandbox"] });
  assert.deepEqual(args, [
    "--remote-debugging-port=19222",
    "--remote-allow-origins=http://127.0.0.1:19222",
    "--no-sandbox",
  ]);
});

test("buildWindowsPackagedActivation builds PowerShell activation metadata", () => {
  const cmd = buildWindowsPackagedActivation({
    appUserModelId: "OpenAI.Codex_abc!App",
    debugPort: 19222,
  });
  assert.equal(cmd.type, "packaged");
  assert.equal(cmd.appUserModelId, "OpenAI.Codex_abc!App");
  assert.equal(cmd.executable, "powershell.exe");
  assert.ok(cmd.arguments.includes("--remote-debugging-port=19222"));
});

test("buildWindowsStandaloneCommand builds direct exe command", () => {
  const cmd = buildWindowsStandaloneCommand({
    appPath: "C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\Codex.exe",
    debugPort: 19222,
  });
  assert.equal(cmd.type, "standalone");
  assert.equal(cmd.executable, "C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\Codex.exe");
  assert.ok(cmd.args.includes("--remote-debugging-port=19222"));
});

test("buildWindowsProcessQuery uses tasklist filter", () => {
  const cmd = buildWindowsProcessQuery({ appName: "Codex" });
  assert.equal(cmd.executable, "tasklist");
  assert.deepEqual(cmd.args, ["/FI", "IMAGENAME eq Codex.exe", "/NH"]);
});

test("buildWindowsQuitCommand uses taskkill force", () => {
  const cmd = buildWindowsQuitCommand({ appName: "Codex" });
  assert.equal(cmd.executable, "taskkill");
  assert.deepEqual(cmd.args, ["/IM", "Codex.exe", "/F"]);
});

// --- CDP probe + Windows launcher ---

test("createCodexLauncher.launchWithDebugPort reuses existing debug endpoint", async () => {
  const launcher = createCodexLauncher({
    platform: "darwin",
    listTargets: async () => [{ type: "page", title: "Codex" }],
  });
  const result = await launcher.launchWithDebugPort({ debugPort: 19222 });
  assert.equal(result.kind, "existing");
  assert.equal(result.child, null);
  assert.equal(result.appPath, "running");
});

test("createCodexLauncher.launchWithDebugPort falls back to launch when probe fails", async () => {
  const spies = makeSpies();
  const launcher = createCodexLauncher({
    platform: "darwin",
    homeDir: "/Users/me",
    exists: spies.exists,
    spawn: spies.spawn,
    spawnSync: spies.spawnSync,
    listTargets: async () => { throw new Error("not reachable"); },
    waitForDebugEndpoint: async () => {},
  });
  const result = await launcher.launchWithDebugPort();
  assert.equal(result.kind, "macos");
  assert.equal(spies.calls.spawn[0].executable, "open");
});

test("createCodexLauncher.launchWithDebugPort supports windows standalone", async () => {
  const calls = [];
  const launcher = createCodexLauncher({
    platform: "win32",
    localAppData: "C:\\Users\\me\\AppData\\Local",
    programFiles: "C:\\Program Files",
    exists: async (p) => {
      if (p === "C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\Codex.exe") return "C:\\Users\\me\\AppData\\Local\\OpenAI\\Codex\\bin\\Codex.exe";
      return false;
    },
    spawn: async (executable, args) => { calls.push({ executable, args }); return { pid: 999, on() {} }; },
    spawnSync: async () => ({ stdout: "" }),
    listTargets: async () => { throw new Error("not reachable"); },
    waitForDebugEndpoint: async () => {},
  });
  const result = await launcher.launchWithDebugPort({ debugPort: 19222 });
  assert.equal(result.kind, "windows-standalone");
  assert.ok(calls.some((c) => c.executable.includes("Codex.exe")));
});

test("createCodexLauncher.launchWithDebugPort uses packaged activation for WindowsApps", async () => {
  const activated = [];
  const launcher = createCodexLauncher({
    platform: "win32",
    localAppData: "C:\\Users\\me\\AppData\\Local",
    programFiles: "C:\\Program Files",
    exists: async (p) => {
      if (p.includes("WindowsApps\\OpenAI.Codex_*\\app")) {
        return "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0.0.0_neutral__abc123\\app";
      }
      return false;
    },
    spawn: async () => ({ pid: 1, on() {} }),
    spawnSync: async () => ({ stdout: "" }),
    listTargets: async () => { throw new Error("not reachable"); },
    waitForDebugEndpoint: async () => {},
    activatePackagedApp: async (id, args) => { activated.push({ id, args }); return 4242; },
  });
  const result = await launcher.launchWithDebugPort({ debugPort: 19222 });
  assert.equal(result.kind, "packaged");
  assert.equal(result.pid, 4242);
  assert.ok(activated.length === 1);
  assert.ok(activated[0].id.includes("!App"));
  assert.ok(activated[0].args.includes("--remote-debugging-port=19222"));
});

test("createCodexLauncher.launchWithDebugPort rejects unsupported platform", async () => {
  const launcher = createCodexLauncher({ platform: "linux" });
  await assert.rejects(launcher.launchWithDebugPort(), /only supports macOS and Windows/);
});


test("DEFAULT_DEBUG_PORT is 19222", () => {
  assert.equal(DEFAULT_DEBUG_PORT, 19222);
});