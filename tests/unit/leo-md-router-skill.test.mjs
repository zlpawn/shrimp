import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-md-router");

const {
  readConfig,
  saveConfig,
  resolveMarkdownDestination,
  archiveSourceFile,
  deleteOriginalAfterArchive,
} = await import(path.join(SKILL_DIR, "scripts", "config.mjs"));

const { compareVersions, probeAll } = await import(
  path.join(SKILL_DIR, "scripts", "probe.mjs")
);

test("SKILL.md and engines-catalog.md cover capability-based routing and universal delete confirmation", () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const catalog = fs.readFileSync(
    path.join(SKILL_DIR, "references", "engines-catalog.md"),
    "utf8"
  );

  assert.match(skill, /^---\r?\nname: leo-md-router\r?\ndescription: .+/);
  assert.ok(skill.includes("references/engines-catalog.md"));
  assert.match(skill, /能力画像/);
  assert.match(skill, /非硬编码/);
  assert.match(skill, /~\/素材\/md/);
  assert.match(skill, /uv tool install docling/);
  assert.match(skill, /uv tool upgrade/);
  assert.match(skill, /--confirm-delete/);

  for (const engine of ["docling", "markitdown"]) {
    assert.ok(catalog.includes(`## ${engine}`), `catalog missing ## ${engine}`);
  }
  assert.match(catalog, /uv tool install "markitdown\[all\]"/);
});

test("config.mjs defaults to ~/素材/md and never deletes original source without confirmDelete", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leo-md-router-test-"));
  const prevEnv = process.env.LEO_MD_ROUTER_CONFIG_PATH;
  process.env.LEO_MD_ROUTER_CONFIG_PATH = path.join(tmpRoot, "config.json");

  try {
    const initial = readConfig();
    assert.equal(initial.output_dir, "~/素材/md");
    assert.equal(initial.source_policy, "copy");

    const updated = saveConfig({ source_policy: "move" });
    assert.equal(updated.source_policy, "move");

    const dest = resolveMarkdownDestination({
      category: "论文",
      topic: "attention",
      engine: "docling",
      explicitOutputDir: path.join(tmpRoot, "out"),
    });
    assert.ok(dest.docDir.endsWith(path.join("论文", dest.dateFolder, "attention")));
    assert.match(dest.filename, /^attention_docling_\d{8}_\d{6}\.md$/);

    // Even in a plain temp directory (not git), move without confirmDelete NEVER deletes original
    const srcFile = path.join(tmpRoot, "sample.pdf");
    fs.writeFileSync(srcFile, "pdf-bytes");

    const copyRes = archiveSourceFile({
      srcPath: srcFile,
      destDir: dest.docDir,
      policy: "copy",
    });
    assert.equal(copyRes.deletedOriginal, false);
    assert.equal(copyRes.requiresConfirmation, false);
    assert.ok(fs.existsSync(srcFile));
    assert.ok(fs.existsSync(copyRes.archivedPath));

    const awaitingRes = archiveSourceFile({
      srcPath: srcFile,
      destDir: dest.docDir,
      policy: "move",
    });
    assert.equal(awaitingRes.action, "copied_awaiting_delete_confirmation");
    assert.equal(awaitingRes.deletedOriginal, false);
    assert.equal(awaitingRes.requiresConfirmation, true);
    assert.equal(awaitingRes.reason, "always_confirm_before_delete");
    assert.ok(fs.existsSync(srcFile));
    assert.ok(fs.existsSync(awaitingRes.archivedPath));

    // deleteOriginalAfterArchive also refuses without confirmDelete: true
    const blockedDelete = deleteOriginalAfterArchive({
      srcPath: srcFile,
      archivedPath: awaitingRes.archivedPath,
      confirmDelete: false,
    });
    assert.equal(blockedDelete.deletedOriginal, false);
    assert.equal(blockedDelete.requiresConfirmation, true);
    assert.ok(fs.existsSync(srcFile));

    // Only deletes after explicit user confirmation (confirmDelete: true)
    const confirmedDelete = deleteOriginalAfterArchive({
      srcPath: srcFile,
      archivedPath: awaitingRes.archivedPath,
      confirmDelete: true,
    });
    assert.equal(confirmedDelete.deletedOriginal, true);
    assert.equal(confirmedDelete.requiresConfirmation, false);
    assert.ok(!fs.existsSync(srcFile));
    assert.ok(fs.existsSync(awaitingRes.archivedPath));
  } finally {
    if (prevEnv === undefined) {
      delete process.env.LEO_MD_ROUTER_CONFIG_PATH;
    } else {
      process.env.LEO_MD_ROUTER_CONFIG_PATH = prevEnv;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("probe.mjs compares versions and reports docling and markitdown states", async () => {
  assert.equal(compareVersions("2.80.0", "2.81.0"), -1);
  assert.equal(compareVersions("2.81.0", "2.81.0"), 0);
  assert.equal(compareVersions("2.82.0", "2.81.0"), 1);

  const report = await probeAll({ checkUpdates: false });
  assert.ok("docling" in report.engines);
  assert.ok("markitdown" in report.engines);
  assert.equal(report.engines.docling.commands.installCli, "uv tool install docling");
  assert.equal(report.engines.markitdown.commands.installCli, 'uv tool install "markitdown[all]"');
});
