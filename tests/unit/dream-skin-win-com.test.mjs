import assert from "node:assert/strict";
import test from "node:test";

import { activatePackagedApp } from "../../lib/dream-skin/runtime/win-com.mjs";

test("activatePackagedApp builds hidden COM PowerShell activation", async () => {
  const captured = [];
  const fakeExecFile = (exe, args, opts, cb) => {
    captured.push({ exe, args, opts });
    cb(null, "4242", "");
  };
  const pid = await activatePackagedApp("OpenAI.Codex_abc!App", "--remote-debugging-port=19222", {
    execFile: fakeExecFile,
  });
  assert.equal(pid, 4242);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].exe, "powershell.exe");
  assert.ok(captured[0].args.includes("-WindowStyle"));
  assert.ok(captured[0].args.includes("Hidden"));
  assert.equal(captured[0].opts.windowsHide, true);
  const script = captured[0].args.join(" ");
  assert.match(script, /IApplicationActivationManager/);
  assert.match(script, /45BA127D-10A8-46EA-8AB7-56EA9078943C/);
  assert.doesNotMatch(script, /2B9B7D98-1AB6-4652-8D5F-6F5FE36F8DB9/);
  assert.match(script, /\[PreserveSig\]/);
  assert.match(script, /ActivateApplication/);
  assert.match(script, /OpenAI\.Codex_abc!App/);
  assert.match(script, /--remote-debugging-port=19222/);
  assert.match(script, /\$activatedPid/);
  assert.doesNotMatch(script, /shell:AppsFolder/);
  assert.doesNotMatch(script, /\$pid\s*=/);
});

test("activatePackagedApp rejects invalid PowerShell output", async () => {
  const fakeExecFile = (exe, args, opts, cb) => cb(null, "not-a-pid", "");
  await assert.rejects(
    activatePackagedApp("OpenAI.Codex_abc!App", "--remote-debugging-port=19222", { execFile: fakeExecFile }),
    /unexpected PowerShell output/,
  );
});

test("activatePackagedApp propagates PowerShell errors", async () => {
  const fakeExecFile = (exe, args, opts, cb) => cb(new Error("boom"), "", "stderr");
  await assert.rejects(
    activatePackagedApp("OpenAI.Codex_abc!App", "--remote-debugging-port=19222", { execFile: fakeExecFile }),
    /PowerShell activation failed/,
  );
});
