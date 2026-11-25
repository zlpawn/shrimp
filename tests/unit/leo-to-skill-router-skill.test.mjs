import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-to-skill-router");

const {
  getConfigPath,
  getDefaultConfig,
  readConfig,
  saveConfig,
  resolveOutputDir,
  resolveArtifactsDir,
} = await import(path.join(SKILL_DIR, "scripts", "config.mjs"));

const {
  classifyInput,
  findSkill,
  getStandardSkillRoots,
  probeAll,
  probeBookToSkill,
  probeLessonToSkill,
  probeVoiceStudio,
} = await import(path.join(SKILL_DIR, "scripts", "probe.mjs"));

test("SKILL.md and references adhere to router architecture standards", () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const decisionTables = fs.readFileSync(
    path.join(SKILL_DIR, "references", "decision-tables.md"),
    "utf8"
  );
  const enginesCatalog = fs.readFileSync(
    path.join(SKILL_DIR, "references", "engines-catalog.md"),
    "utf8"
  );
  const outputSpec = fs.readFileSync(
    path.join(SKILL_DIR, "references", "unified-output-spec.md"),
    "utf8"
  );

  // Frontmatter
  assert.match(skill, /^---\r?\nname: leo-to-skill-router\r?\ndescription: .+/);

  // Core references linked
  assert.ok(skill.includes("references/decision-tables.md"));
  assert.ok(skill.includes("references/engines-catalog.md"));
  assert.ok(skill.includes("references/unified-output-spec.md"));
  assert.ok(skill.includes("references/artifacts-spec.md"));

  // Key paths and scripts
  assert.match(skill, /~\/素材\/to-skill/);
  assert.match(skill, /scripts\/probe\.mjs/);
  assert.match(skill, /npx skills add virgiliojr94\/book-to-skill/);
  assert.match(skill, /cheatsheet\.md/);

  // Decision table covers core formats
  assert.ok(decisionTables.includes("PDF 文件"));
  assert.ok(decisionTables.includes("Markdown / 文本"));
  assert.ok(decisionTables.includes("网络视频 URL"));
  assert.ok(decisionTables.includes("Fusion Pipeline"));

  // Engines catalog covers sub-engines and VoiceStudio
  assert.ok(enginesCatalog.includes("book-to-skill"));
  assert.ok(enginesCatalog.includes("leo-lesson-to-skill"));
  assert.ok(enginesCatalog.includes("voicestudio"));

  // Decision tables reference VoiceStudio
  assert.ok(decisionTables.includes("VoiceStudio"));

  // Output spec covers cheatsheet and on-demand architecture
  assert.ok(outputSpec.includes("cheatsheet.md"));
  assert.ok(outputSpec.includes("on-demand/"));
  assert.ok(outputSpec.includes("<4,000 tokens"));
});

test("config.mjs correctly manages configurations and supports path resolution", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leo-to-skill-router-test-"));
  const prevConfigPath = process.env.LEO_TO_SKILL_ROUTER_CONFIG_PATH;
  const testConfigFile = path.join(tmpRoot, "config.json");
  process.env.LEO_TO_SKILL_ROUTER_CONFIG_PATH = testConfigFile;

  try {
    const defaults = getDefaultConfig();
    assert.ok(defaults.output_skills_dir.endsWith(path.join("lib", "skills")));
    assert.ok(defaults.artifacts_dir.includes("to-skill"));

    const initial = readConfig();
    assert.equal(initial.auto_clean_media, false);

    saveConfig({
      output_skills_dir: "/tmp/custom-skills",
      artifacts_dir: "/tmp/custom-artifacts",
      auto_clean_media: true,
    });

    const updated = readConfig();
    assert.equal(updated.output_skills_dir, "/tmp/custom-skills");
    assert.equal(updated.artifacts_dir, "/tmp/custom-artifacts");
    assert.equal(updated.auto_clean_media, true);

    const resolvedOutput = resolveOutputDir();
    assert.equal(resolvedOutput, path.resolve("/tmp/custom-skills"));

    const resolvedArtifacts = resolveArtifactsDir(null, "my-book-slug", "2026-11-24");
    assert.equal(resolvedArtifacts, path.resolve("/tmp/custom-artifacts", "2026-11-24-my-book-slug"));
  } finally {
    if (prevConfigPath) {
      process.env.LEO_TO_SKILL_ROUTER_CONFIG_PATH = prevConfigPath;
    } else {
      delete process.env.LEO_TO_SKILL_ROUTER_CONFIG_PATH;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("probe.mjs correctly classifies various input modalities", () => {
  assert.equal(classifyInput("https://www.bilibili.com/video/BV1xx411c7mD").mode, "lesson");
  assert.equal(classifyInput("https://www.youtube.com/watch?v=dQw4w9WgXcQ").mode, "lesson");
  assert.equal(classifyInput("/path/to/lecture.mp4").mode, "lesson");
  assert.equal(classifyInput("/path/to/recording.wav").mode, "lesson");

  assert.equal(classifyInput("/path/to/book.pdf").mode, "book");
  assert.equal(classifyInput("/path/to/manual.epub").mode, "book");
  assert.equal(classifyInput("/path/to/doc.docx").mode, "book");
  assert.equal(classifyInput("/path/to/spec.md").mode, "book");

  assert.equal(classifyInput("").mode, "ambiguous");
  assert.equal(classifyInput("not-a-valid-extension-or-url").mode, "ambiguous");
});

test("probe.mjs probeAll returns valid system diagnostic information", () => {
  const result = probeAll();

  assert.ok("uv" in result);
  assert.ok("pythonVenv" in result);
  assert.ok("engines" in result);
  assert.ok("asr" in result);
  assert.equal(result.asr.defaultBackend, "voicestudio");
  assert.ok(typeof result.asr.voiceStudio.serviceOnline === "boolean");
  assert.ok("tools" in result);
  assert.ok("paths" in result);

  assert.ok(typeof result.engines.bookToSkill.installed === "boolean");
  assert.ok(typeof result.engines.lessonToSkill.installed === "boolean");

  const vsDirect = probeVoiceStudio();
  assert.equal(typeof vsDirect.serviceOnline, "boolean");
  assert.equal(vsDirect.recommendedForAsr, true);
});

test("findSkill dynamically resolves cross-agent paths and supports explicit overrides", () => {
  const roots = getStandardSkillRoots();
  assert.ok(Array.isArray(roots));
  assert.ok(roots.length >= 8);

  // Lesson-to-skill should be found in workspace roots
  const lesson = findSkill("leo-lesson-to-skill");
  assert.equal(lesson.installed, true);
  assert.equal(lesson.source, "auto_discovery");

  // Non-existent skill should be reported as not_found
  const nonexistent = findSkill("definitely-nonexistent-skill-xyz");
  assert.equal(nonexistent.installed, false);
  assert.equal(nonexistent.source, "not_found");

  // Explicit path override test
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "explicit-skill-test-"));
  try {
    const fakeSkillFile = path.join(tmpRoot, "SKILL.md");
    fs.writeFileSync(fakeSkillFile, "---\nname: fake-skill\n---\n");
    const explicit = findSkill("fake-skill", fakeSkillFile);
    assert.equal(explicit.installed, true);
    assert.equal(explicit.source, "explicit_config");
    assert.equal(explicit.skillFile, fakeSkillFile);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
