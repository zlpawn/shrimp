import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import test from "node:test";

import {
  buildLaunchSpec,
  buildInstallPlan,
  detectFooocusInstallations,
  discoverGenerationPlan,
  extractOfficialWindowsDownload,
  findAvailablePort,
  parseCliArgs,
} from "../../lib/skills/leo-fooocus-imagine/scripts/leo_fooocus_imagine.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("skill package exposes the extensible Fooocus lifecycle contract", () => {
  const skillDir = path.join(ROOT, "lib", "skills", "leo-fooocus-imagine");
  const skill = fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
  assert.match(skill, /^---\s*[\s\S]*name:\s*leo-fooocus-imagine/m);
  assert.match(skill, /ensure-running/i);
  assert.match(skill, /capabilit/i);
  assert.match(skill, /用户明确.*关闭|explicit.*stop/i);
  assert.ok(fs.existsSync(path.join(skillDir, "references", "extension-guide.md")));
  assert.ok(fs.existsSync(path.join(skillDir, "scripts", "fooocus_gradio_client.py")));
});

test("skill is registered in the managed media catalog", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "skills", "managed-catalog.json"), "utf8"));
  const entry = catalog.skills.find((item) => item.name === "leo-fooocus-imagine");
  assert.ok(entry);
  assert.equal(entry.category, "media");
  assert.equal(entry.managed, true);
  assert.equal(entry.promoted, true);
});

test("CLI parses generation and lifecycle commands without coupling to a Fooocus version", () => {
  const parsed = parseCliArgs([
    "generate",
    "--prompt",
    "a blue crane",
    "--mode",
    "inpaint",
    "--input",
    "source.png",
    "--mask",
    "mask.png",
    "--aspect-ratio",
    "1:1",
    "--json",
  ]);
  assert.equal(parsed.command, "generate");
  assert.equal(parsed.options.prompt, "a blue crane");
  assert.equal(parsed.options.mode, "inpaint");
  assert.equal(parsed.options.input, "source.png");
  assert.equal(parsed.options.mask, "mask.png");
  assert.equal(parsed.options.aspectRatio, "1:1");
  assert.equal(parsed.options.json, true);
});

test("managed installation state remains a discovery candidate across restarts", async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fooocus-state-"));
  const previousStateDir = process.env.LEO_FOOOCUS_STATE_DIR;
  process.env.LEO_FOOOCUS_STATE_DIR = temp;
  const managedRoot = path.join(temp, "custom-install");
  fs.mkdirSync(path.join(temp), { recursive: true });
  fs.writeFileSync(path.join(temp, "state.json"), JSON.stringify({
    installation: { root: managedRoot, appRoot: path.join(managedRoot, "Fooocus") },
  }));
  try {
    const { defaultCandidateRoots } = await import(`../../lib/skills/leo-fooocus-imagine/scripts/leo_fooocus_imagine.mjs?state=${Date.now()}`);
    assert.ok(defaultCandidateRoots({ platform: process.platform }).includes(managedRoot));
  } finally {
    if (previousStateDir === undefined) delete process.env.LEO_FOOOCUS_STATE_DIR;
    else process.env.LEO_FOOOCUS_STATE_DIR = previousStateDir;
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("installation discovery reuses a portable Fooocus installation", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fooocus-skill-"));
  const appRoot = path.join(temp, "Fooocus");
  const pythonRoot = path.join(temp, "python_embeded");
  fs.mkdirSync(appRoot, { recursive: true });
  fs.mkdirSync(pythonRoot, { recursive: true });
  fs.writeFileSync(path.join(appRoot, "launch.py"), "# test");
  fs.writeFileSync(path.join(appRoot, "fooocus_version.py"), "version = '2.5.5'\n");
  fs.writeFileSync(path.join(pythonRoot, process.platform === "win32" ? "python.exe" : "python"), "");

  const found = detectFooocusInstallations({ candidates: [temp], platform: process.platform });
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, "portable");
  assert.equal(found[0].appRoot, appRoot);
});

test("install plan is idempotent when a compatible installation already exists", () => {
  const existing = {
    kind: "portable",
    root: "D:\\Fooocus",
    appRoot: "D:\\Fooocus\\Fooocus",
    python: "D:\\Fooocus\\python_embeded\\python.exe",
  };
  const plan = buildInstallPlan({ existing: [existing], platform: "win32" });
  assert.equal(plan.action, "reuse");
  assert.equal(plan.installation.root, existing.root);
});

test("install plan selects the official portable distribution for a new Windows machine", () => {
  const plan = buildInstallPlan({ existing: [], platform: "win32", installRoot: "D:\\Apps\\Fooocus" });
  assert.equal(plan.action, "install");
  assert.equal(plan.channel, "official-portable");
  assert.match(plan.sourceUrl, /github\.com\/lllyasviel\/Fooocus\/releases\/download/i);
  assert.equal(plan.installRoot, "D:\\Apps\\Fooocus");
});

test("official Windows download can evolve without changing the CLI", () => {
  const markdown = "[download](https://github.com/lllyasviel/Fooocus/releases/download/v9.8.7/Fooocus_win64_9-8-7.7z)";
  assert.equal(
    extractOfficialWindowsDownload(markdown),
    "https://github.com/lllyasviel/Fooocus/releases/download/v9.8.7/Fooocus_win64_9-8-7.7z",
  );
});

test("background startup avoids a port owned by another process", async () => {
  const blocker = net.createServer();
  await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
  const occupied = blocker.address().port;
  try {
    const selected = await findAvailablePort(occupied, "127.0.0.1", 10);
    assert.notEqual(selected, occupied);
    assert.ok(selected > occupied);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
});

test("launch spec starts hidden, binds loopback, and bypasses proxy only in the child", () => {
  const install = {
    kind: "portable",
    root: "D:\\Fooocus",
    appRoot: "D:\\Fooocus\\Fooocus",
    python: "D:\\Fooocus\\python_embeded\\python.exe",
  };
  const parentEnv = { ALL_PROXY: "socks5h://127.0.0.1:7897", KEEP_ME: "yes" };
  const spec = buildLaunchSpec(install, { port: 7865, env: parentEnv, platform: "win32" });
  assert.equal(spec.command, install.python);
  assert.ok(spec.args.includes("--disable-in-browser"));
  assert.ok(spec.args.includes("--listen"));
  assert.ok(spec.args.includes("127.0.0.1"));
  assert.equal(spec.windowsHide, true);
  assert.equal(spec.detached, true);
  assert.equal(spec.env.ALL_PROXY, undefined);
  assert.match(spec.env.NO_PROXY, /127\.0\.0\.1/);
  assert.equal(parentEnv.ALL_PROXY, "socks5h://127.0.0.1:7897");
});

test("generation chain discovery follows component semantics instead of fixed fn indexes", () => {
  const config = {
    components: [
      { id: 1, type: "state", props: {} },
      { id: 10, type: "textbox", props: { label: "Prompt", value: "" } },
      { id: 11, type: "textbox", props: { label: "Negative Prompt", value: "" } },
      { id: 12, type: "dropdown", props: { label: "Base Model", value: "model.safetensors" } },
      { id: 20, type: "html", props: {} },
      { id: 21, type: "image", props: { label: "Preview" } },
      { id: 22, type: "gallery", props: { label: "Gallery" } },
    ],
    dependencies: [
      { inputs: [], outputs: [] },
      { inputs: [1], outputs: [20, 21, 22] },
      { inputs: [10, 11, 12], outputs: [1] },
    ],
  };
  const plan = discoverGenerationPlan(config);
  assert.equal(plan.prepareFn, 2);
  assert.equal(plan.generateFn, 1);
  assert.equal(plan.semanticInputs.prompt, 10);
  assert.equal(plan.semanticInputs.negativePrompt, 11);
  assert.equal(plan.semanticInputs.baseModel, 12);
});
