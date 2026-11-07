import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LanternServer } from "../scripts/cli/lib/server.mjs";
import { executeCommand } from "../scripts/cli/lib/cli.mjs";
import { startFakeExtension } from "./fake-extension.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skillPath = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const TRAVEL_BASE = skillPath("../../leo-travel-planner/scripts/scrapers/base.mjs");
const JOB_AUTH = skillPath("../../leo-job-career/scripts/lib/auth.mjs");

async function closedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function isUp(port) {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/health`)).json()).service === "leo-lantern";
  } catch {
    return false;
  }
}

async function waitUntilDown(port, withinMs = 8000) {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!(await isUp(port))) return true;
    await pause(50);
  }
  return false;
}

/** Keeps polling a port like the real extension does, surviving the bridge coming and going. */
function pollLikeExtension(port, handle = () => ({})) {
  const seen = [];
  let running = true;
  const loop = (async () => {
    while (running) {
      try {
        const { cmd } = await (await fetch(`http://127.0.0.1:${port}/ext/poll?waitMs=100`)).json();
        if (!cmd) continue;
        seen.push(cmd);
        await fetch(`http://127.0.0.1:${port}/ext/result`, {
          method: "POST",
          body: JSON.stringify({ id: cmd.id, ok: true, result: handle(cmd) }),
        });
      } catch {
        await pause(50);
      }
    }
  })();
  return {
    seen,
    async stop() {
      running = false;
      await loop;
    },
  };
}

/** Runs code in a child so its short idle-exit setting cannot leak into other tests. */
function runNode(code, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], { env: { ...process.env, ...env } });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("exit", (code) => resolve({ code, out }));
  });
}

describe("idle exit", { concurrency: true }, () => {
  test("fires once nothing has happened for the idle window", async () => {
    let idle = 0;
    const bridge = new LanternServer({ port: 0, idleExitMs: 80, onIdle: () => idle++ });
    await bridge.start();
    await pause(200);
    await bridge.stop();
    assert.equal(idle, 1);
  });

  test("is off by default", async () => {
    const bridge = new LanternServer({ port: 0, onIdle: () => assert.fail("must not fire") });
    await bridge.start();
    await pause(50);
    await bridge.stop();
  });

  test("extension polling does not count as activity", async () => {
    let idle = 0;
    const fake = await startFakeExtension(() => ({}), { idleExitMs: 150, onIdle: () => idle++ });
    await pause(300);
    await fake.stop();
    assert.equal(idle, 1);
  });

  test("a command restarts the idle window", async () => {
    let idle = 0;
    const fake = await startFakeExtension(() => ({}), { idleExitMs: 4000, onIdle: () => idle++ });
    try {
      await pause(2500);
      await fake.bridge.dispatch("tabs.list");
      await pause(2500);
      assert.equal(idle, 0);
    } finally {
      await fake.stop();
    }
  });

  test("does not fire while a command is still running", async () => {
    let idle = 0;
    const fake = await startFakeExtension(
      async () => {
        await pause(1500);
        return {};
      },
      { idleExitMs: 800, onIdle: () => idle++ }
    );
    try {
      const running = fake.bridge.dispatch("dom.wait", { selector: ".x" });
      await pause(1100);
      assert.equal(idle, 0);
      await running;
      await pause(1100);
      assert.equal(idle, 1);
    } finally {
      await fake.stop();
    }
  });

  test("stop cancels a scheduled exit", async () => {
    let idle = 0;
    const bridge = new LanternServer({ port: 0, idleExitMs: 80, onIdle: () => idle++ });
    await bridge.start();
    await bridge.stop();
    await pause(150);
    assert.equal(idle, 0);
  });
});

test("an extension long-polling counts as online before its first heartbeat", async () => {
  const bridge = new LanternServer({ port: 0 });
  await bridge.start();
  try {
    const poll = fetch(`http://127.0.0.1:${bridge.port}/ext/poll?waitMs=300`);
    await pause(50);
    const health = await (await fetch(`http://127.0.0.1:${bridge.port}/health`)).json();
    assert.equal(health.extensionOnline, true);
    await poll;
  } finally {
    await bridge.stop();
  }
});

test("server command stays up with --idle-exit-min 0", async () => {
  const { server } = await executeCommand("server", { port: "0", "idle-exit-min": "0" });
  assert.equal(server.idleExitMs, 0);
  await server.stop();
});

test("server command defaults to a 10 minute idle exit", async () => {
  const { server } = await executeCommand("server", { port: "0" });
  assert.equal(server.idleExitMs, 600000);
  await server.stop();
});

const CHILD_ENV = { LEO_LANTERN_IDLE_EXIT_MIN: "0.02" };
const cliUrl = new URL("../scripts/cli/lib/cli.mjs", import.meta.url).href;

describe("start on demand", { concurrency: true }, () => {
  test("a command starts the bridge, runs, and the bridge later exits by itself", async () => {
    const port = await closedPort();
    const extension = pollLikeExtension(port, () => [{ id: 1 }]);
    try {
      const { code, out } = await runNode(
        `import { executeCommand } from ${JSON.stringify(cliUrl)};
         console.log(JSON.stringify(await executeCommand("tabs", {}, [], { port: ${port} })));`,
        CHILD_ENV
      );
      assert.equal(code, 0, out);
      assert.deepEqual(JSON.parse(out).result, [{ id: 1 }]);
      assert.equal(extension.seen[0].type, "tabs.list");
      assert.equal(await waitUntilDown(port), true, "bridge should exit after going idle");
    } finally {
      await extension.stop();
    }
  });

  test("health does not start a bridge", async () => {
    const port = await closedPort();
    await assert.rejects(executeCommand("health", {}, [], { port }), /Could not connect/);
    assert.equal(await isUp(port), false);
  });

  test("start waits for the extension and reports it online", async () => {
    const port = await closedPort();
    const extension = pollLikeExtension(port);
    try {
      const { code, out } = await runNode(
        `import { executeCommand } from ${JSON.stringify(cliUrl)};
         console.log(JSON.stringify(await executeCommand("start", { port: "${port}" })));`,
        CHILD_ENV
      );
      assert.equal(code, 0, out);
      const health = JSON.parse(out);
      assert.equal(health.extensionOnline, true);
      assert.equal(health.started, true);
      assert.equal(await waitUntilDown(port), true);
    } finally {
      await extension.stop();
    }
  });

  test("start reuses a bridge that is already running", async () => {
    const fake = await startFakeExtension();
    try {
      const health = await executeCommand("start", {}, [], { port: fake.port });
      assert.equal(health.extensionOnline, true);
      assert.equal(health.started, false);
    } finally {
      await fake.stop();
    }
  });

  test("start fails when another service holds the port", async () => {
    const other = http.createServer((req, res) => res.end("{}"));
    await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
    try {
      const began = Date.now();
      await assert.rejects(
        executeCommand("start", {}, [], { port: other.address().port, startTimeoutMs: 20000 }),
        /Could not start/
      );
      assert.ok(Date.now() - began < 10000, "should not wait out the timeout once the bridge cannot listen");
    } finally {
      other.closeAllConnections();
      await new Promise((resolve) => other.close(resolve));
    }
  });

  test("start gives up when the port accepts connections but never answers", async () => {
    const silent = net.createServer((socket) => socket.resume());
    await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
    try {
      await assert.rejects(
        executeCommand("start", {}, [], { port: silent.address().port, startTimeoutMs: 20000 }),
        /Could not start/
      );
    } finally {
      await new Promise((resolve) => silent.close(resolve));
    }
  });

  test("leo-travel-planner starts the bridge when it is down", { skip: !fs.existsSync(TRAVEL_BASE) }, async () => {
    const port = await closedPort();
    const extension = pollLikeExtension(port);
    try {
      const { code, out } = await runNode(
        `import { checkBridgeHealth } from ${JSON.stringify(new URL(`file://${TRAVEL_BASE}`).href)};
         console.log((await checkBridgeHealth()).extensionOnline);`,
        { ...CHILD_ENV, LEO_LANTERN_PORT: String(port) }
      );
      assert.equal(code, 0, out);
      assert.match(out, /true/);
      assert.equal(await waitUntilDown(port), true);
    } finally {
      await extension.stop();
    }
  });

  test("leo-job-career starts the bridge when it is down", { skip: !fs.existsSync(JOB_AUTH) }, async () => {
    const port = await closedPort();
    const extension = pollLikeExtension(port, () => ({ cookies: [] }));
    try {
      const { code, out } = await runNode(
        `import { importFromBridge } from ${JSON.stringify(new URL(`file://${JOB_AUTH}`).href)};
         console.log((await importFromBridge({ port: ${port}, paths: {} })).error);`,
        CHILD_ENV
      );
      assert.equal(code, 0, out);
      assert.match(out, /No cookies returned/);
      assert.equal(extension.seen[0].type, "cookies.export");
      assert.equal(await waitUntilDown(port), true);
    } finally {
      await extension.stop();
    }
  });
});
