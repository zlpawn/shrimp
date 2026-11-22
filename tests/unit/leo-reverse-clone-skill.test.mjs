import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-reverse-clone");

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

test("SKILL.md, engines-catalog.md and managed-catalog.json follow leo-reverse-clone contract", () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const catalog = fs.readFileSync(
    path.join(SKILL_DIR, "references", "engines-catalog.md"),
    "utf8"
  );
  const managed = JSON.parse(
    fs.readFileSync(path.join(ROOT, "lib", "skills", "managed-catalog.json"), "utf8")
  );

  assert.match(skill, /^---\r?\nname: leo-reverse-clone\r?\ndescription: .+/);
  assert.ok(skill.includes("references/engines-catalog.md"));
  assert.match(skill, /~\/素材\/reverse-clone/);
  assert.match(skill, /mcp_bridge\.py/);
  assert.match(skill, /严禁运行 `rea setup` 或 `craft-anything-cli setup`/);
  assert.match(skill, /未经用户明确同意/);
  assert.match(skill, /--confirm-delete/);

  assert.ok(catalog.includes("## rea（`rea-agents`）"));
  assert.ok(catalog.includes("## craft-anything（`craft-anything-cli`）"));

  const entry = managed.skills.find((s) => s.id === "leo-reverse-clone");
  assert.ok(entry, "managed-catalog.json should register leo-reverse-clone");
  assert.equal(entry.name, "leo-reverse-clone");
  assert.equal(entry.managed, true);
});

test("config.mjs defaults to ~/素材/reverse-clone, initializes workspace, and guards source deletion", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leo-reverse-clone-cfg-"));
  const prevEnv = process.env.LEO_REVERSE_CLONE_CONFIG_PATH;
  process.env.LEO_REVERSE_CLONE_CONFIG_PATH = path.join(tmpRoot, "config.json");

  try {
    const initial = readConfig();
    assert.equal(initial.output_dir, "~/素材/reverse-clone");
    assert.equal(initial.default_mode, "deep");
    assert.equal(initial.source_policy, "copy");

    const saved = saveConfig({ default_mode: "clean_room" });
    assert.equal(saved.default_mode, "clean_room");

    const ws = initProjectWorkspace({
      category: "apk",
      targetName: "DemoApp",
      engine: "rea",
      targetRef: "/abs/DemoApp.apk",
      stack: "Flutter",
      explicitOutputDir: path.join(tmpRoot, "out"),
    });
    assert.ok(fs.existsSync(ws.sourceDir));
    assert.ok(fs.existsSync(ws.evidenceDir));
    assert.ok(fs.existsSync(ws.appDir));
    assert.ok(fs.existsSync(ws.verifyDir));
    assert.ok(fs.existsSync(ws.specPath));
    assert.ok(fs.existsSync(ws.metaPath));

    const meta = JSON.parse(fs.readFileSync(ws.metaPath, "utf8"));
    assert.equal(meta.target, "/abs/DemoApp.apk");
    assert.equal(meta.target_stack, "Flutter");

    const srcFile = path.join(tmpRoot, "DemoApp.apk");
    fs.writeFileSync(srcFile, "apk-bytes");

    const awaiting = archiveSourceFile({
      srcPath: srcFile,
      destDir: ws.projectDir,
      policy: "move",
    });
    assert.equal(awaiting.deletedOriginal, false);
    assert.equal(awaiting.requiresConfirmation, true);
    assert.ok(fs.existsSync(srcFile));
    assert.ok(fs.existsSync(awaiting.archivedPath));

    const blocked = deleteOriginalAfterArchive({
      srcPath: srcFile,
      archivedPath: awaiting.archivedPath,
      confirmDelete: false,
    });
    assert.equal(blocked.deletedOriginal, false);
    assert.ok(fs.existsSync(srcFile));

    const confirmed = deleteOriginalAfterArchive({
      srcPath: srcFile,
      archivedPath: awaiting.archivedPath,
      confirmDelete: true,
    });
    assert.equal(confirmed.deletedOriginal, true);
    assert.ok(!fs.existsSync(srcFile));
    assert.ok(fs.existsSync(awaiting.archivedPath));
  } finally {
    if (prevEnv === undefined) {
      delete process.env.LEO_REVERSE_CLONE_CONFIG_PATH;
    } else {
      process.env.LEO_REVERSE_CLONE_CONFIG_PATH = prevEnv;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("probe.mjs and install.mjs support dry-run gating, platform asset selection, and local skill install", async () => {
  assert.equal(compareVersions("6.9.0", "6.10.1"), -1);
  assert.equal(compareVersions("0.6.1", "0.6.1"), 0);
  assert.equal(compareVersions("1.0.0", "0.6.1"), 1);

  assert.equal(
    selectCraftAssetName("v0.6.1", "darwin", "arm64").filename,
    "craft-anything-cli-0.6.1-macos-universal.zip"
  );
  assert.equal(
    selectCraftAssetName("0.6.1", "win32", "x64").filename,
    "craft-anything-0.6.1-windows-x64-portable.zip"
  );
  assert.equal(
    selectCraftAssetName("0.6.1", "linux", "x64").filename,
    "craft-anything-0.6.1-linux-x86_64.tar.gz"
  );

  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "leo-reverse-clone-home-"));
  const fakeReaRepo = path.join(tmpHome, "fake-rea");
  const fakeCraftRepo = path.join(tmpHome, "fake-craft");
  try {
    fs.mkdirSync(path.join(fakeReaRepo, ".agents", "skills", "reverse-engineer-anything", "references"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(fakeReaRepo, ".agents", "skills", "reverse-engineer-anything", "SKILL.md"),
      "---\nname: reverse-engineer-anything\n---\n# REA\n"
    );
    fs.writeFileSync(
      path.join(fakeReaRepo, ".agents", "skills", "reverse-engineer-anything", "references", "ref.md"),
      "ref"
    );

    fs.mkdirSync(path.join(fakeCraftRepo, "crates", "setup", "src"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeCraftRepo, "crates", "setup", "src", "skill.md"),
      "---\nname: craft-anything\n---\n# Craft\n"
    );

    // Dry-run must not write anything
    const dryPlan = await runInstall({
      engine: "all",
      scope: "skill",
      confirm: false,
      homeDir: tmpHome,
      fromLocal: fakeReaRepo,
    });
    assert.equal(dryPlan.dryRun, true);
    assert.equal(probeSkillLocations("reverse-engineer-anything", tmpHome, tmpHome).installed, false);

    const plan = buildInstallPlan({ engine: "craft-anything", scope: "all", homeDir: tmpHome });
    assert.equal(plan.actions.length, 2);

    // Confirmed skill-only install from local repo
    fs.mkdirSync(path.join(tmpHome, ".gemini", "config"), { recursive: true });
    const reaRes = await runInstall({
      engine: "rea",
      scope: "skill",
      confirm: true,
      homeDir: tmpHome,
      fromLocal: fakeReaRepo,
    });
    assert.equal(reaRes.dryRun, false);
    assert.equal(probeSkillLocations("reverse-engineer-anything", tmpHome, tmpHome).installed, true);
    assert.ok(
      fs.existsSync(
        path.join(tmpHome, ".agents", "skills", "reverse-engineer-anything", "references", "ref.md")
      )
    );

    const craftRes = await runInstall({
      engine: "craft-anything",
      scope: "skill",
      confirm: true,
      homeDir: tmpHome,
      fromLocal: fakeCraftRepo,
    });
    assert.equal(craftRes.dryRun, false);
    assert.equal(probeSkillLocations("craft-anything", tmpHome, tmpHome).installed, true);

    const probe = await probeAll({ checkUpdates: false, cwd: tmpHome, homeDir: tmpHome });
    assert.equal(probe.engines.rea.skill.installed, true);
    assert.equal(probe.engines["craft-anything"].skill.installed, true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("proxy.mjs parses macOS/Windows system proxies, honors priority, and protects loopback NO_PROXY", () => {
  const macSample = `
<dictionary> {
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
}
`;
  assert.equal(parseScutilProxyOutput(macSample), "http://127.0.0.1:7897");

  const winSample = `
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
`;
  assert.equal(parseWindowsRegProxyOutput(winSample), "http://127.0.0.1:7890");

  // Priority: cli > config > env > system
  const sysDet = () => "http://127.0.0.1:9999";
  assert.deepEqual(
    resolveProxyInfo({ cliProxy: "127.0.0.1:8080", configProxy: "127.0.0.1:8081", env: { HTTPS_PROXY: "http://127.0.0.1:8082" }, systemProxyDetector: sysDet }),
    { url: "http://127.0.0.1:8080", source: "cli" },
  );
  assert.deepEqual(
    resolveProxyInfo({ configProxy: "127.0.0.1:8081", env: { HTTPS_PROXY: "http://127.0.0.1:8082" }, systemProxyDetector: sysDet }),
    { url: "http://127.0.0.1:8081", source: "config" },
  );
  assert.deepEqual(
    resolveProxyInfo({ env: { https_proxy: "http://127.0.0.1:8082" }, systemProxyDetector: sysDet }),
    { url: "http://127.0.0.1:8082", source: "env" },
  );
  assert.deepEqual(
    resolveProxyInfo({ env: {}, systemProxyDetector: sysDet }),
    { url: "http://127.0.0.1:9999", source: "system" },
  );
  assert.deepEqual(
    resolveProxyInfo({ noProxy: true, env: { HTTPS_PROXY: "http://127.0.0.1:8082" }, systemProxyDetector: sysDet }),
    { url: "", source: "disabled" },
  );

  // buildProxyEnv injects proxy and always guards loopback hosts in NO_PROXY
  const childEnv = buildProxyEnv({ PATH: "/usr/bin", NO_PROXY: "example.local" }, { url: "http://127.0.0.1:7897", source: "system" });
  assert.equal(childEnv.HTTPS_PROXY, "http://127.0.0.1:7897");
  assert.equal(childEnv.http_proxy, "http://127.0.0.1:7897");
  assert.ok(childEnv.NO_PROXY.includes("127.0.0.1"));
  assert.ok(childEnv.NO_PROXY.includes("localhost"));
  assert.ok(childEnv.NO_PROXY.includes("::1"));
  assert.ok(childEnv.NO_PROXY.includes("example.local"));
});
