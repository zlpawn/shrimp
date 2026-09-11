import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCloudflaredArgs,
  extractQuickTunnelUrl,
  resolveCloudflaredBin,
  createCloudflaredSupervisor,
} from "../../lib/nat-traversal/process/cloudflared-supervisor.mjs";

test("buildCloudflaredArgs builds correct flags for quick and token modes", () => {
  const quickArgs = buildCloudflaredArgs({
    mode: "quick",
    localUrl: "http://127.0.0.1:8787",
  });
  assert.deepEqual(quickArgs, [
    "tunnel",
    "--url",
    "http://127.0.0.1:8787",
    "--no-autoupdate",
  ]);

  const tokenArgs = buildCloudflaredArgs({
    mode: "token",
    token: "cf-token-secret-xyz",
  });
  assert.deepEqual(tokenArgs, [
    "tunnel",
    "run",
    "--token",
    "cf-token-secret-xyz",
    "--no-autoupdate",
  ]);
});

test("extractQuickTunnelUrl parses trycloudflare.com URL from output stream", () => {
  const sampleLog = `
2026-09-11T08:00:00Z INF +--------------------------------------------------------------------------------------------+
2026-09-11T08:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-09-11T08:00:00Z INF |  https://cool-banana-test-123.trycloudflare.com                                            |
2026-09-11T08:00:00Z INF +--------------------------------------------------------------------------------------------+
  `;
  const url = extractQuickTunnelUrl(sampleLog);
  assert.equal(url, "https://cool-banana-test-123.trycloudflare.com");

  assert.equal(extractQuickTunnelUrl("no url here"), "");
  assert.equal(extractQuickTunnelUrl(""), "");
});

test("resolveCloudflaredBin prioritizes configured path and falls back across platforms", () => {
  const configured = resolveCloudflaredBin({
    configuredPath: "/custom/path/cloudflared",
    existsSync: (p) => p === "/custom/path/cloudflared",
  });
  assert.equal(configured, "/custom/path/cloudflared");

  const viaWhich = resolveCloudflaredBin({
    whichBin: () => "/usr/local/bin/cloudflared",
    existsSync: () => false,
  });
  assert.equal(viaWhich, "/usr/local/bin/cloudflared");

  const winDefault = resolveCloudflaredBin({
    platform: "win32",
    whichBin: () => "",
    existsSync: () => false,
  });
  assert.equal(winDefault, "cloudflared.exe");

  const macDefault = resolveCloudflaredBin({
    platform: "darwin",
    whichBin: () => "",
    existsSync: () => false,
  });
  assert.equal(macDefault, "cloudflared");
});

test("cloudflared supervisor lifecycle with fake runner", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cf-sup-"));
  const pidPath = path.join(tmpDir, "cloudflared.pid");
  const logPath = path.join(tmpDir, "cloudflared.log");
  const statePath = path.join(tmpDir, "cloudflared.state.json");
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  // Create a mock spawnRunner that writes fake output including trycloudflare url
  let spawnedPid = 998877;
  const supervisor = createCloudflaredSupervisor({
    binPath: "cloudflared",
    pidPath,
    logPath,
    statePath,
    spawnRunner: (bin, args) => {
      fs.appendFileSync(
        logPath,
        `Starting cloudflared...\nhttps://mock-test-quick.trycloudflare.com\n`,
        "utf8",
      );
      return {
        pid: spawnedPid,
        unref: () => {},
      };
    },
    isProcessRunning: (pid) => pid === spawnedPid,
    killProcess: (pid) => {
      if (pid === spawnedPid) {
        spawnedPid = 0;
        return true;
      }
      return false;
    },
  });

  assert.equal(supervisor.getStatus().status, "stopped");

  // Start Quick mode
  await supervisor.start({
    mode: "quick",
    localUrl: "http://127.0.0.1:8787",
  });

  const runningStatus = supervisor.getStatus();
  assert.equal(runningStatus.status, "running");
  assert.equal(runningStatus.pid, 998877);
  assert.equal(runningStatus.quickUrl, "https://mock-test-quick.trycloudflare.com");

  // Stop
  await supervisor.stop();
  assert.equal(supervisor.getStatus().status, "stopped");
  assert.equal(fs.existsSync(pidPath), false);
});
