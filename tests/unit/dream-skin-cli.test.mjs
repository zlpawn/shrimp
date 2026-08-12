import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { parseArgs, runCli } from "../../lib/dream-skin/index.mjs";

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const validThemeJson = JSON.stringify({
  schemaVersion: 1,
  id: "aurora-night",
  name: "Aurora Night",
  stylePreset: "midnight-aurora",
  image: "background.png",
  appearance: "auto",
  art: { focusX: 0.5, focusY: 0.5, safeArea: "auto", taskMode: "ambient" },
  colors: {
    background: "#111318", panel: "#181b22", panelAlt: "#20242d",
    accent: "#8298a3", accentAlt: "#a8c0ca", secondary: "#6f8791",
    highlight: "#bfd4dc", text: "#edf2f4", muted: "#a4afb5",
    line: "rgba(130, 152, 163, 0.28)",
  },
});

test("parseArgs rejects inject/launch/cleanup/remove commands", () => {
  for (const cmd of ["inject", "launch", "cleanup", "remove"]) {
    const args = parseArgs(["--", cmd]);
    assert.ok(args.errors.length > 0, `should reject ${cmd}`);
  }
});

test("parseArgs rejects --app and --port options", () => {
  const args = parseArgs(["--", "validate", "--theme", "x.json", "--app", "/Applications/Codex.app"]);
  assert.ok(args.errors.some((e) => e.includes("--app")));
  const args2 = parseArgs(["--", "validate", "--port", "19222"]);
  assert.ok(args2.errors.some((e) => e.includes("--port")));
});

test("parseArgs requires --output for build-script", () => {
  const args = parseArgs(["--", "build-script", "--theme", "x.json", "--image", "bg.png"]);
  assert.ok(args.errors.some((e) => e.includes("--output")));
});

test("parseArgs accepts offline commands", () => {
  const args = parseArgs(["--", "validate", "--theme", "t.json", "--image", "bg.png"]);
  assert.equal(args.command, "validate");
  assert.equal(args.theme, "t.json");
  assert.equal(args.image, "bg.png");
  assert.equal(args.errors.length, 0);
});

function makeTemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-cli-"));
  const themePath = path.join(dir, "theme.json");
  const imagePath = path.join(dir, "background.png");
  const outputPath = path.join(dir, "script.js");
  fs.writeFileSync(themePath, validThemeJson);
  fs.writeFileSync(imagePath, PNG_BYTES);
  return { dir, themePath, imagePath, outputPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test("runCli validate parses theme and writes nothing", async () => {
  const t = makeTemp();
  try {
    const code = await runCli(parseArgs(["--", "validate", "--theme", t.themePath, "--image", t.imagePath]));
    assert.equal(code, 0);
    const files = fs.readdirSync(t.dir);
    assert.deepEqual(files.sort(), ["background.png", "theme.json"]);
  } finally {
    t.cleanup();
  }
});

test("runCli validate-engines returns four summaries", async () => {
  const logs = [];
  const origLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    const code = await runCli(parseArgs(["--", "validate-engines"]));
    assert.equal(code, 0);
    const engines = logs.filter((l) => l.includes("[dream-skin] engine")).length;
    assert.equal(engines, 4);
  } finally {
    console.log = origLog;
  }
});

test("runCli build-script writes parseable JavaScript", async () => {
  const t = makeTemp();
  try {
    const code = await runCli(parseArgs(["--", "build-script", "--theme", t.themePath, "--image", t.imagePath, "--output", t.outputPath]));
    assert.equal(code, 0);
    const script = fs.readFileSync(t.outputPath, "utf8");
    assert.doesNotThrow(() => new vm.Script(script));
  } finally {
    t.cleanup();
  }
});

test("runCli build-script refuses to overwrite theme input", async () => {
  const t = makeTemp();
  try {
    const code = await runCli(parseArgs(["--", "build-script", "--theme", t.themePath, "--image", t.imagePath, "--output", t.themePath]));
    assert.equal(code, 1);
  } finally {
    t.cleanup();
  }
});

test("index.mjs imports only offline modules", () => {
  const source = fs.readFileSync("lib/dream-skin/index.mjs", "utf8");
  // Should not import the executable runtime modules by path
  assert.doesNotMatch(source, /from "\.\/runtime\/launcher\.mjs"/);
  assert.doesNotMatch(source, /from "\.\/runtime\/cdp-client\.mjs"/);
  assert.match(source, /runtime\/injector\.mjs/);
  assert.match(source, /runtime\/engine-assets\.mjs/);
});