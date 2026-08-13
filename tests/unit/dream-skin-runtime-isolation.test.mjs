import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = process.cwd();

function walkFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
      out.push(...walkFiles(full, exts));
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

test("no product source outside runtime/ imports dream-skin launcher or CDP", () => {
  const exts = [".mjs", ".js", ".ts"];
  const files = walkFiles(path.join(ROOT, "lib"), exts)
    .filter((f) => !f.includes(`${path.sep}runtime${path.sep}`));
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /runtime\/launcher\.mjs/, `${file} must not import launcher`);
    assert.doesNotMatch(src, /runtime\/cdp-client\.mjs/, `${file} must not import CDP client`);
    assert.doesNotMatch(src, /from "ws"/, `${file} must not import ws for Dream Skin`);
  }
});

test("server.js keeps runtime imports lazy and only opens apply route", () => {
  const src = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  // Static import list must not include runtime modules
  const staticMatches = src.match(/^import .*dream-skin\/runtime/gm) || [];
  assert.equal(staticMatches.length, 0);
  // The lazy factory dynamically imports the applier
  assert.match(src, /await import\("\.\/lib\/dream-skin\/runtime\/applier\.mjs"\)/);
  // Only the theme apply route is exposed; launch/inject/runtime stay 404 in routes.mjs
  assert.doesNotMatch(src, /\/v1\/dream-skin\/(?:launch|inject|runtime|community|packages)/);
});

test("package.json has no inject/launch/cleanup dream-skin script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const scripts = Object.values(pkg.scripts || {});
  for (const script of scripts) {
    if (typeof script !== "string") continue;
    assert.doesNotMatch(script, /dream-skin.*(?:inject|launch|cleanup|remove)/i);
  }
});

test("desktop panel has no runtime action copy or route", () => {
  const files = walkFiles(path.join(ROOT, "desktop", "src"), [".ts", ".html", ".css"])
    .concat([path.join(ROOT, "desktop", "index.html")]);
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, /\/v1\/dream-skin\/(?:apply|launch|inject|runtime|community|packages)/, file);
  }
});

test("application service exposes applyTheme only through injected applier", () => {
  const src = fs.readFileSync(path.join(ROOT, "lib", "dream-skin", "application", "service.mjs"), "utf8");
  // applyTheme must be the gateway to runtime injection and require the injected applier
  assert.match(src, /async function applyTheme\(/);
  assert.match(src, /if \(!applier\)/);
  assert.match(src, /applier\.applyTheme\(/);
  // The service itself must not spawn processes or open sockets
  assert.doesNotMatch(src, /child_process/);
  assert.doesNotMatch(src, /new WebSocket/);
});

test("runtime module imports have no top-level side effects", () => {
  // Import each runtime module in a child process; it must exit 0 without
  // spawning processes, opening sockets, or connecting WebSockets.
  for (const mod of ["engine-assets.mjs", "injector.mjs", "cdp-client.mjs", "launcher.mjs"]) {
    const code = `import("file:///${ROOT.replace(/\\/g, "/")}/lib/dream-skin/runtime/${mod}").then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
      encoding: "utf8",
      timeout: 15000,
    });
    assert.equal(result.status, 0, `importing ${mod} should have no side effects: ${result.stderr}`);
  }
});