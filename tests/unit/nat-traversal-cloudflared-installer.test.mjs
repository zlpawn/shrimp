import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNpmBin,
  installCloudflared,
} from "../../lib/nat-traversal/process/cloudflared-installer.mjs";

test("resolveNpmBin checks node executable dir before fallback", () => {
  const bin = resolveNpmBin();
  assert.ok(bin.includes("npm"));

  const customNodeDir = resolveNpmBin({
    platform: "win32",
    existsSync: (p) => p.endsWith("npm.cmd"),
  });
  assert.ok(customNodeDir.endsWith("npm.cmd"));
});

test("installCloudflared executes installer with runner and handles success and error", async () => {
  // 1. Success case
  let capturedCmd = "";
  let capturedArgs = [];
  const fakeRunnerSuccess = (cmd, args, { done }) => {
    capturedCmd = cmd;
    capturedArgs = args;
    setTimeout(() => {
      done({
        ok: true,
        message: "cloudflared installed successfully",
        binPath: "/usr/local/bin/cloudflared",
        output: "added 1 package in 2s",
      });
    }, 5);
  };

  const res1 = await installCloudflared({
    packageManager: "npm",
    spawnRunner: fakeRunnerSuccess,
    whichBin: () => "/usr/local/bin/cloudflared",
  });
  assert.equal(res1.ok, true);
  assert.equal(res1.binPath, "/usr/local/bin/cloudflared");
  assert.ok(capturedCmd.includes("npm"));
  assert.deepEqual(capturedArgs, ["install", "-g", "cloudflared"]);

  // 2. Failure case
  const fakeRunnerFail = (cmd, args, { done }) => {
    setTimeout(() => {
      done({
        ok: false,
        error: "EACCES: permission denied",
        binPath: "",
        output: "npm ERR! code EACCES",
      });
    }, 5);
  };

  const res2 = await installCloudflared({
    packageManager: "npm",
    spawnRunner: fakeRunnerFail,
  });
  assert.equal(res2.ok, false);
  assert.match(res2.error, /EACCES/);
});
