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
  discoverAdvancedCapabilities,
  discoverGenerationPlan,
  discoverModelInventory,
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
  assert.ok(fs.existsSync(path.join(skillDir, "scripts", "fooocus_model_manager.mjs")));
  assert.match(skill, /calling model makes the creative decision/i);
  assert.match(skill, /every model download requires explicit confirmation/i);
  assert.match(skill, /inspect-model/i);
  assert.match(skill, /download-model/i);
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

test("CLI preserves repeated LoRA and ControlNet specifications", () => {
  const parsed = parseCliArgs([
    "generate",
    "--prompt", "portrait",
    "--lora", "detail.safetensors|0.7",
    "--lora", "lighting.safetensors|0.4",
    "--control", "C:\\images\\pose.png|PyraCanny|0.65|0.8",
    "--control", "C:\\images\\face.png|FaceSwap|0.9|0.75",
  ]);
  assert.deepEqual(parsed.options.lora, ["detail.safetensors|0.7", "lighting.safetensors|0.4"]);
  assert.deepEqual(parsed.options.control, [
    "C:\\images\\pose.png|PyraCanny|0.65|0.8",
    "C:\\images\\face.png|FaceSwap|0.9|0.75",
  ]);
});

test("advanced capabilities are reported only when their live components exist", () => {
  const config = {
    components: [
      { id: 10, type: "checkboxgroup", props: { label: "Content Type" } },
      { id: 11, type: "image", props: { label: "Image" } },
      { id: 12, type: "checkbox", props: { label: "Apply Styles" } },
      { id: 13, type: "textbox", props: { elem_id: "positive_prompt" } },
      { id: 14, type: "checkboxgroup", props: { label: "Selected Styles" } },
      { id: 20, type: "dropdown", props: { label: "LoRA 1" } },
      { id: 21, type: "slider", props: { label: "Weight" } },
      { id: 30, type: "radio", props: { label: "Type", choices: [["ImagePrompt", "ImagePrompt"], ["PyraCanny", "PyraCanny"], ["CPDS", "CPDS"], ["FaceSwap", "FaceSwap"]] } },
      { id: 40, type: "checkbox", props: { label: "Enhance" } },
      { id: 41, type: "image", props: { label: "Use with Enhance, skips image generation" } },
    ],
    dependencies: [
      { trigger: "click", inputs: [10, 11, 12], outputs: [13, 14] },
    ],
  };
  assert.deepEqual(discoverAdvancedCapabilities(config), ["lora", "controlnet", "describe", "enhance"]);
  assert.deepEqual(discoverAdvancedCapabilities({ components: [], dependencies: [] }), []);
});

test("model inventory exposes live checkpoint, refiner, and LoRA choices", () => {
  const inventory = discoverModelInventory({
    components: [
      { id: 1, type: "dropdown", props: { label: "Base Model (SDXL only)", choices: [["base-a.safetensors", "base-a.safetensors"]] } },
      { id: 2, type: "dropdown", props: { label: "Refiner (SDXL or SD 1.5)", choices: ["None", "refiner-a.safetensors"] } },
      { id: 5, type: "dropdown", props: { label: "Refiner swap method", choices: ["joint", "separate", "vae"] } },
      { id: 3, type: "dropdown", props: { label: "LoRA 1", choices: [["None", "None"], ["detail.safetensors", "detail.safetensors"]] } },
      { id: 4, type: "dropdown", props: { label: "LoRA 2", choices: [["None", "None"], ["detail.safetensors", "detail.safetensors"]] } },
    ],
  });
  assert.deepEqual(inventory, {
    checkpoints: ["base-a.safetensors"],
    refiners: ["refiner-a.safetensors"],
    loras: ["detail.safetensors"],
  });
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
