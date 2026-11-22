import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const SKILL_DIR = path.resolve(import.meta.dirname, "..");

const {
  readConfig,
  saveConfig,
  initProjectWorkspace,
  archiveSourceFile,
  deleteOriginalAfterArchive,
} = await import(path.join(SKILL_DIR, "scripts", "config.mjs"));

const { compareVersions, probeAll, probeSkillLocations } = await import(
  path.join(SKILL_DIR, "scripts", "probe.mjs")
);

const { buildInstallPlan, runInstall, selectCraftAssetName } = await import(
  path.join(SKILL_DIR, "scripts", "install.mjs")
);

const {
  parseScutilProxyOutput,
  parseWindowsRegProxyOutput,
  resolveProxyInfo,
  buildProxyEnv,
} = await import(path.join(SKILL_DIR, "scripts", "proxy.mjs"));

test("standalone skill contract and proxy/config/install tests pass independently of gateway repo", async () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.match(skill, /^---\r?\nname: leo-reverse-clone\r?\ndescription: .+/);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leo-rc-standalone-"));
  const prevEnv = process.env.LEO_REVERSE_CLONE_CONFIG_PATH;
  process.env.LEO_REVERSE_CLONE_CONFIG_PATH = path.join(tmpRoot, "config.json");

  try {
    assert.equal(readConfig().output_dir, "~/素材/reverse-clone");
    saveConfig({ default_mode: "clean_room" });
    const ws = initProjectWorkspace({
      category: "apk",
      targetName: "StandaloneDemo",
      engine: "rea",
      explicitOutputDir: path.join(tmpRoot, "out"),
    });
    assert.ok(fs.existsSync(ws.specPath));

    const srcFile = path.join(tmpRoot, "a.apk");
    fs.writeFileSync(srcFile, "apk");
    const arch = archiveSourceFile({ srcPath: srcFile, destDir: ws.projectDir, policy: "move" });
    assert.equal(arch.deletedOriginal, false);
    assert.equal(
      deleteOriginalAfterArchive({ srcPath: srcFile, archivedPath: arch.archivedPath, confirmDelete: true }).deletedOriginal,
      true
    );

    assert.equal(compareVersions("0.6.0", "0.6.1"), -1);
    assert.equal(selectCraftAssetName("0.6.1", "darwin", "arm64").filename, "craft-anything-cli-0.6.1-macos-universal.zip");
    const plan = await runInstall({ engine: "all", scope: "skill", confirm: false, homeDir: tmpRoot });
    assert.equal(plan.dryRun, true);
    assert.equal(probeSkillLocations("craft-anything", tmpRoot, tmpRoot).installed, false);

    assert.equal(
      parseScutilProxyOutput("HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 7897\n"),
      "http://127.0.0.1:7897"
    );
    assert.equal(
      parseWindowsRegProxyOutput("ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ 127.0.0.1:7890\n"),
      "http://127.0.0.1:7890"
    );
    const pEnv = buildProxyEnv({}, resolveProxyInfo({ cliProxy: "127.0.0.1:7897" }));
    assert.equal(pEnv.HTTPS_PROXY, "http://127.0.0.1:7897");
    assert.ok(pEnv.NO_PROXY.includes("127.0.0.1"));

    const report = await probeAll({ checkUpdates: false, cwd: tmpRoot, homeDir: tmpRoot });
    assert.ok("rea" in report.engines && "craft-anything" in report.engines);
  } finally {
    if (prevEnv === undefined) delete process.env.LEO_REVERSE_CLONE_CONFIG_PATH;
    else process.env.LEO_REVERSE_CLONE_CONFIG_PATH = prevEnv;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
