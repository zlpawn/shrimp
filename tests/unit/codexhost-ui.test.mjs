import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("command apps page mounts the independent CodexHost managed-runtime card", async () => {
  const commandApps = await readFile(path.join(ROOT, "desktop/src/modules/command-apps.ts"), "utf8");
  const codexhost = await readFile(path.join(ROOT, "desktop/src/modules/codexhost-runtime.ts"), "utf8");
  assert.match(commandApps, /renderCodexhostRuntime\(\)/);
  assert.match(commandApps, /loadCodexhostRuntime\(\)/);
  assert.match(codexhost, /CodexHost/);
  assert.match(codexhost, /增强模式/);
  assert.match(codexhost, /普通模式/);
  assert.match(codexhost, /Shrimp 网关/);
  assert.match(codexhost, /Codex 模型配置/);
});

test("CodexHost interruption actions require an explicit confirmation dialog", async () => {
  const source = await readFile(path.join(ROOT, "desktop/src/modules/codexhost-runtime.ts"), "utf8");
  assert.match(source, /confirmInterrupt: true/);
  assert.match(source, /window\.confirm\(/);
  assert.match(source, /当前 Codex Desktop 将被关闭/);
  assert.match(source, /未完成任务可能被中断/);
  assert.match(source, /codexhost\/stop/);
  assert.match(source, /codexhost\/open-official/);
  assert.doesNotMatch(source, /codexhost\/stop[^\n]*\{\s*\}/);
});

test("CodexHost card uses managed-runtime APIs without joining generic CLI discovery", async () => {
  const source = await readFile(path.join(ROOT, "desktop/src/modules/codexhost-runtime.ts"), "utf8");
  assert.match(source, /\/v1\/cli-tools\/codexhost\/status/);
  assert.match(source, /\/v1\/cli-tools\/codexhost\/start/);
  assert.doesNotMatch(source, /\/v1\/cli\/discover/);
});

test("CodexHost install entry reuses the existing CLI install terminal mechanism", async () => {
  const source = await readFile(path.join(ROOT, "desktop/src/modules/codexhost-runtime.ts"), "utf8");
  const app = await readFile(path.join(ROOT, "desktop/src/app.ts"), "utf8");
  assert.match(source, /"npm install -g @codexhost\/cli"/);
  assert.match(source, /"npm uninstall -g @codexhost\/cli"/);
  assert.match(source, /prefillCliInstallCommand\?\.\(command, "codexhost"\)/);
  assert.match(app, /window\.prefillCliInstallCommand = prefillCliInstallCommand/);
  assert.match(app, /\/v1\/cli\/install/);
  assert.match(source, /data-codexhost-action="update"/);
  assert.match(source, /data-codexhost-action="uninstall"/);
});
