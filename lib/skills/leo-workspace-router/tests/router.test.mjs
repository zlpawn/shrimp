import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const SKILL_DIR = path.resolve(import.meta.dirname, "..");

const {
  ensureConfig,
  loadConfig,
  saveConfig,
  setHost,
  getHost,
  getMaskedHosts,
  removeHost,
  getBinDir,
  getEngineDataDir
} = await import(path.join(SKILL_DIR, "scripts", "config.mjs"));

const { runProbe } = await import(path.join(SKILL_DIR, "scripts", "probe.mjs"));
const { DEFAULT_IGNORES } = await import(path.join(SKILL_DIR, "scripts", "engines", "mutagen.mjs"));

test("SKILL.md satisfies specification and lightweight constraints", () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(skill, /^---\r?\nname: leo-workspace-router\r?\ndescription: .+/);
  assert.ok(skill.includes("mutagen"));
  assert.ok(skill.includes("scripts/router.mjs"));
  assert.ok(skill.includes("SSH_ASKPASS"));
  assert.ok(skill.includes("config.json"));

  // Verify lightweight constraint: under 150 lines
  const lineCount = skill.split(/\r?\n/).length;
  assert.ok(lineCount <= 150, `SKILL.md is too bloated: ${lineCount} lines (expected <= 150)`);
});

test("Configurable binDir and isolated engine dataDir", () => {
  const binDir = getBinDir();
  assert.ok(binDir.endsWith(".local/bin") || binDir.includes("bin"));
  assert.ok(fs.existsSync(binDir));

  const mutagenData = getEngineDataDir("mutagen");
  const cloudflareData = getEngineDataDir("cloudflare");

  assert.ok(mutagenData.endsWith(path.join("data", "mutagen")));
  assert.ok(cloudflareData.endsWith(path.join("data", "cloudflare")));
  assert.ok(fs.existsSync(mutagenData));
  assert.ok(fs.existsSync(cloudflareData));
});

test("References catalog and ignore presets exist and are structured", () => {
  const catalog = fs.readFileSync(path.join(SKILL_DIR, "references", "engines-catalog.md"), "utf8");
  const ignores = fs.readFileSync(path.join(SKILL_DIR, "references", "ignore-presets.md"), "utf8");
  const mutagenRef = fs.readFileSync(path.join(SKILL_DIR, "references", "engines", "mutagen.md"), "utf8");

  assert.ok(catalog.includes("mutagen"));
  assert.ok(catalog.includes("rsync"));
  assert.ok(ignores.includes("node_modules"));
  assert.ok(ignores.includes(".git"));
  assert.ok(mutagenRef.includes("mutagen sync create"));
  assert.ok(mutagenRef.includes("SSH_ASKPASS"));
});

test("Default ignore presets contain critical directories", () => {
  assert.ok(DEFAULT_IGNORES.includes(".git"));
  assert.ok(DEFAULT_IGNORES.includes("node_modules"));
  assert.ok(DEFAULT_IGNORES.includes("__pycache__"));
  assert.ok(DEFAULT_IGNORES.includes(".DS_Store"));
});

test("Host config management with password masking and isolation", () => {
  const testAlias = "unit-test-mac-" + Date.now();
  const rawPassword = "super_secret_test_password";

  // 1. Add host
  const added = setHost(testAlias, {
    host: "192.168.1.100",
    port: 6007,
    username: "pa",
    password: rawPassword,
    description: "Unit test machine"
  });

  assert.equal(added.alias, testAlias);
  assert.equal(added.password, "******", "Password must be masked in returned host");

  // 2. Internal lookup returns actual password for SSH_ASKPASS
  const internal = getHost(testAlias);
  assert.equal(internal.password, rawPassword);

  // 3. Masked lookup masks password
  const maskedList = getMaskedHosts();
  assert.equal(maskedList.hosts[testAlias].password, "******");

  // 4. Remove host
  const removed = removeHost(testAlias);
  assert.equal(removed, true);
  assert.equal(getHost(testAlias), null);
});

test("Probe returns structured report with isolated engine data dirs", async () => {
  const report = await runProbe();
  assert.ok(report.platform);
  assert.ok(report.arch);
  assert.equal(report.activeEngine, "mutagen");
  assert.ok(report.binDir);
  assert.ok(report.engines.mutagen);
  assert.ok(report.engines.cloudflare);
  assert.ok(report.engines.mutagen.dataDir.includes("mutagen"));
  assert.ok(report.engines.cloudflare.dataDir.includes("cloudflare"));
});
