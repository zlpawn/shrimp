import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { SkillInstaller } from "../../lib/session-sync/skill-installer.mjs";

test("Skill library lists managed and discovered skills with categories", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-library-"));
  try {
    const root = path.join(tmpHome, ".agents", "skills");
    fs.mkdirSync(root, { recursive: true });

    // discovered local skill
    const localDir = path.join(root, "browser-cookies-local");
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, "SKILL.md"),
      `---
name: browser-cookies-local
description: Auto-export Netscape cookies from Chrome for yt-dlp via CDP.
---

# Browser Cookies Local
`,
      "utf-8",
    );

    SkillInstaller.ensureManagedSkills(tmpHome);

    const snapshot = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
      query: "cookie",
      scope: "all",
    });

    assert.ok(snapshot.stats.total >= 3);
    assert.equal(snapshot.skills.some((s) => s.name === "browser-cookies-local"), true);
    const local = snapshot.skills.find((s) => s.name === "browser-cookies-local");
    assert.equal(local.category, "browser");
    assert.equal(local.managed, false);
    assert.equal(local.installed, true);

    const all = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
    });
    const grok = all.allSkills.find((s) => s.name === "leo-grok-imagine");
    assert.ok(grok);
    assert.equal(grok.installed, true);
    assert.equal(grok.mounted, true); // compatibility alias
    assert.equal(all.stats.installed >= 3, true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("Skill library scope filters installed, managed, and missing skills", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-scope-"));
  try {
    // Do not ensure managed skills so session-sync / leo-grok-imagine stay missing.
    const root = path.join(tmpHome, ".agents", "skills");
    fs.mkdirSync(root, { recursive: true });
    const localDir = path.join(root, "browser-cookies-local");
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, "SKILL.md"),
      `---
name: browser-cookies-local
description: local cookie skill
---
`,
      "utf-8",
    );

    const installed = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
      scope: "installed",
    });
    assert.ok(installed.skills.every((s) => s.installed));
    assert.equal(installed.skills.some((s) => s.name === "browser-cookies-local"), true);

    // legacy alias still works
    const mountedAlias = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
      scope: "mounted",
    });
    assert.ok(mountedAlias.skills.every((s) => s.installed));

    const managed = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
      scope: "managed",
    });
    assert.ok(managed.skills.every((s) => s.managed));

    const missing = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
      scope: "missing",
    });
    assert.ok(missing.skills.every((s) => !s.installed));
    assert.equal(missing.skills.some((s) => s.name === "session-sync"), true);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("Promote local skill writes project managed source like leo-grok-imagine", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-promote-"));
  const projectSkillRoot = SkillInstaller.MANAGED_SKILLS_ROOT;
  const promotedDir = path.join(projectSkillRoot, "browser-cookies-local");
  const catalogFile = SkillInstaller.MANAGED_CATALOG_FILE;
  const hadCatalog = fs.existsSync(catalogFile);
  const previousCatalog = hadCatalog ? fs.readFileSync(catalogFile, "utf-8") : null;
  const hadPromotedDir = fs.existsSync(promotedDir);

  try {
    const root = path.join(tmpHome, ".agents", "skills");
    fs.mkdirSync(root, { recursive: true });
    const localDir = path.join(root, "browser-cookies-local");
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, "SKILL.md"),
      `---
name: browser-cookies-local
description: Auto-export Netscape cookies from Chrome for yt-dlp via CDP.
---

# Browser Cookies Local
`,
      "utf-8",
    );
    fs.mkdirSync(path.join(localDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(localDir, "scripts", "export_cookies.py"), "print('ok')\n", "utf-8");

    const result = SkillInstaller.promoteLocalSkillToManaged("browser-cookies-local", {
      homeDir: tmpHome,
    });

    assert.equal(result.skill.name, "browser-cookies-local");
    assert.equal(result.skill.managed, true);
    assert.equal(fs.existsSync(path.join(promotedDir, "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(promotedDir, "scripts", "export_cookies.py")), true);
    assert.equal(fs.existsSync(catalogFile), true);

    const snapshot = SkillInstaller.buildLibrarySnapshot({
      homeDir: tmpHome,
      scope: "managed",
    });
    const managed = snapshot.skills.find((s) => s.name === "browser-cookies-local");
    assert.ok(managed);
    assert.equal(managed.managed, true);
    assert.equal(managed.canPromote, false);
    assert.equal(managed.installed, true);
  } finally {
    if (fs.existsSync(promotedDir) && !hadPromotedDir) {
      fs.rmSync(promotedDir, { recursive: true, force: true });
    }
    if (hadCatalog) {
      fs.writeFileSync(catalogFile, previousCatalog, "utf-8");
    } else if (fs.existsSync(catalogFile)) {
      fs.rmSync(catalogFile, { force: true });
    }
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});


test("Skill library scans antigravity-only and claude roots with dedup", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-multiscan-"));
  const catalogFile = SkillInstaller.MANAGED_CATALOG_FILE;
  const hadCatalog = fs.existsSync(catalogFile);
  const previousCatalog = hadCatalog ? fs.readFileSync(catalogFile, "utf-8") : null;
  try {
    // central: only leo-grok-imagine ensured (managed). Put a local skill in antigravity dir only.
    const agRoot = SkillInstaller.getAntigravitySkillsRoot(tmpHome);
    const agDir = path.join(agRoot, "multiscan-ag-only-skill");
    fs.mkdirSync(agDir, { recursive: true });
    fs.writeFileSync(
      path.join(agDir, "SKILL.md"),
      `---
name: multiscan-ag-only-skill
description: Parse technical videos into dense Karpathy-style wiki notes.
---

# Video to Karpathy Wiki
`,
      "utf-8",
    );

    // claude root has a different local skill
    const claudeRoot = path.join(tmpHome, ".claude", "skills");
    const claudeDir = path.join(claudeRoot, "claude-only-skill");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "SKILL.md"),
      `---
name: claude-only-skill
description: A skill only present under ~/.claude/skills.
---
`,
      "utf-8",
    );

    SkillInstaller.ensureManagedSkills(tmpHome);

    const snapshot = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome });

    const ag = snapshot.allSkills.find((s) => s.name === "multiscan-ag-only-skill");
    assert.ok(ag, "antigravity-only skill should be listed");
    assert.equal(ag.installed, true);
    assert.equal(ag.presentIn.central, false);
    assert.equal(ag.presentIn.antigravity, true);
    assert.equal(ag.presentIn.claude, false);

    const cl = snapshot.allSkills.find((s) => s.name === "claude-only-skill");
    assert.ok(cl, "claude-only skill should be listed");
    assert.equal(cl.installed, true);
    assert.equal(cl.presentIn.claude, true);
    assert.equal(cl.presentIn.central, false);

    // No duplicate entries: each name appears exactly once.
    const names = snapshot.allSkills.map((s) => s.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, []);

    // Promote an antigravity-only skill into managed source.
    const promoted = SkillInstaller.promoteLocalSkillToManaged("multiscan-ag-only-skill", { homeDir: tmpHome });
    assert.equal(promoted.skill.managed, true);
    assert.ok(fs.existsSync(path.join(SkillInstaller.MANAGED_SKILLS_ROOT, "multiscan-ag-only-skill", "SKILL.md")));
  } finally {
    // clean promoted artifact so we don't leak into the real project tree
    const promotedDir = path.join(SkillInstaller.MANAGED_SKILLS_ROOT, "multiscan-ag-only-skill");
    if (fs.existsSync(promotedDir)) fs.rmSync(promotedDir, { recursive: true, force: true });
    if (hadCatalog) fs.writeFileSync(catalogFile, previousCatalog, "utf-8");
    else if (fs.existsSync(catalogFile)) fs.rmSync(catalogFile, { force: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("Leo coding standards is a searchable managed development skill", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "leo-coding-library-"));
  try {
    SkillInstaller.ensureManagedSkills(tmpHome);

    const snapshot = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome });
    const skill = snapshot.allSkills.find((item) => item.name === "leo-coding-standards");
    assert.ok(skill);
    assert.equal(skill.managed, true);
    assert.equal(skill.installed, true);
    assert.equal(skill.category, "development");
    assert.equal(skill.categoryLabel, "开发工程");
    assert.equal(skill.title, "Leo Java 编码规范");

    const development = snapshot.categories.find((item) => item.id === "development");
    assert.ok(development);
    assert.equal(development.label, "开发工程");
    assert.equal(development.count >= 1, true);

    for (const query of ["java", "coding standards", "代码规范"]) {
      const result = SkillInstaller.buildLibrarySnapshot({
        homeDir: tmpHome,
        query,
      });
      assert.equal(
        result.skills.some((item) => item.name === "leo-coding-standards"),
        true,
        `query should find leo-coding-standards: ${query}`,
      );
    }

    const installedDir = path.join(tmpHome, ".agents", "skills", "leo-coding-standards");
    for (const relativePath of [
      "agents/openai.yaml",
      "references/java-api-rules.md",
      "references/engineering-principles.md",
      "references/review-checklist.md",
    ]) {
      assert.equal(fs.existsSync(path.join(installedDir, relativePath)), true, relativePath);
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("Leo code to business is a managed business-knowledge skill", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "leo-code-business-"));
  try {
    SkillInstaller.ensureManagedSkills(tmpHome);
    const snapshot = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome });
    const skill = snapshot.allSkills.find((item) => item.name === "leo-code-to-business");

    assert.ok(skill);
    assert.equal(skill.managed, true);
    assert.equal(skill.installed, true);
    assert.equal(skill.category, "research");

    for (const query of ["业务知识", "代码转业务", "business knowledge"]) {
      const result = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome, query });
      assert.equal(
        result.skills.some((item) => item.name === "leo-code-to-business"),
        true,
        query,
      );
    }

    const installed = path.join(
      tmpHome,
      ".agents",
      "skills",
      "leo-code-to-business",
    );
    for (const relativePath of [
      "SKILL.md",
      "agents/openai.yaml",
      "references/business-knowledge-model.md",
      "references/business-discovery.md",
      "references/evidence-and-confidence.md",
      "references/coverage-and-completion.md",
      "references/repository-investigation.md",
      "references/incremental-update.md",
      "references/html-projection.md",
      "references/optional-code-tools.md",
      "references/output-workspace.md",
      "references/acceptance-scenarios.md",
      "scripts/discover_repository_signals.py",
      "scripts/discovery/core.py",
      "scripts/discovery/java_spring.py",
      "scripts/discovery/node_typescript.py",
      "scripts/git_business_history.py",
      "scripts/migrate_business_revision.py",
      "scripts/task_context.py",
      "scripts/site_view_model.py",
      "scripts/run_v2_acceptance.py",
      "schemas/use-case-candidate.schema.json",
      "schemas/business-evolution-event.schema.json",
    ]) {
      assert.equal(fs.existsSync(path.join(installed, relativePath)), true, relativePath);
    }

    const installedSkillText = fs.readFileSync(path.join(installed, "SKILL.md"), "utf-8").toLowerCase();
    for (const required of [
      "discover_repository_signals.py",
      "use-case-candidates.jsonl",
      "candidate conservation",
      "independent omission audit",
      "site-view-model.json",
      "historical-claims.jsonl",
      "commit message",
      "current_coverage_status",
      "history_coverage_status",
      "task context",
    ]) {
      assert.equal(installedSkillText.includes(required), true, required);
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("Skill library infers uncataloged Java review skills as development", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "java-review-category-"));
  try {
    const skillDir = path.join(tmpHome, ".agents", "skills", "java-review-local");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      `---
name: java-review-local
description: Use when reviewing Java code for coding standards and maintainability.
---

# Java Review Local
`,
      "utf-8",
    );

    const snapshot = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome });
    const skill = snapshot.allSkills.find((item) => item.name === "java-review-local");
    assert.ok(skill);
    assert.equal(skill.managed, false);
    assert.equal(skill.category, "development");
    assert.equal(skill.categoryLabel, "开发工程");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("SkillInstaller.resolveCustomSkillDir resolves stripped slug, raw slug, and override paths", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-resolve-custom-"));
  try {
    // 1. Default when neither directory exists -> ~/.workbuddy/skills (stripped)
    const defaultDir = SkillInstaller.resolveCustomSkillDir("work-buddy", tmpHome);
    assert.equal(defaultDir, path.join(tmpHome, ".workbuddy", "skills"));

    // 2. When raw slug exists (~/.work-buddy/skills) but stripped does not
    const rawDir = path.join(tmpHome, ".work-buddy", "skills");
    fs.mkdirSync(rawDir, { recursive: true });
    assert.equal(SkillInstaller.resolveCustomSkillDir("work-buddy", tmpHome), rawDir);

    // 3. When stripped slug exists (~/.workbuddy/skills), it takes precedence
    const strippedDir = path.join(tmpHome, ".workbuddy", "skills");
    fs.mkdirSync(strippedDir, { recursive: true });
    assert.equal(SkillInstaller.resolveCustomSkillDir("work-buddy", tmpHome), strippedDir);

    // 4. When customPaths override is provided, it takes highest priority
    const customOverride = SkillInstaller.resolveCustomSkillDir("work-buddy", tmpHome, {
      "work-buddy": "~/my-custom-skills/work-buddy",
    });
    assert.equal(customOverride, path.join(tmpHome, "my-custom-skills", "work-buddy"));

    const absoluteOverride = SkillInstaller.resolveCustomSkillDir("work-buddy", tmpHome, {
      "work-buddy": "/var/skills/work-buddy",
    });
    assert.equal(absoluteOverride, path.resolve("/var/skills/work-buddy"));
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("SkillInstaller.getDiscoveryRoots includes custom clients when directory exists and skips when missing", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-roots-custom-"));
  try {
    // 1. When custom client directory does not exist on disk: skip
    const rootsBefore = SkillInstaller.getDiscoveryRoots(tmpHome, ["work-buddy"]);
    assert.equal(rootsBefore.some((r) => r.id === "work-buddy"), false);
    assert.equal(rootsBefore.length, 3); // central, antigravity, claude

    // 2. When custom client directory exists: include
    const customSkillsDir = path.join(tmpHome, ".workbuddy", "skills");
    fs.mkdirSync(customSkillsDir, { recursive: true });

    const rootsAfter = SkillInstaller.getDiscoveryRoots(tmpHome, ["work-buddy"]);
    const customRoot = rootsAfter.find((r) => r.id === "work-buddy");
    assert.ok(customRoot);
    assert.equal(customRoot.id, "work-buddy");
    assert.equal(customRoot.client, "work-buddy");
    assert.equal(customRoot.dir, customSkillsDir);
    assert.equal(customRoot.isCustom, true);
    assert.equal(rootsAfter.length, 4);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("SkillInstaller.buildPresentIn reports presence correctly in custom client root", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-present-custom-"));
  try {
    const customSkillsDir = path.join(tmpHome, ".workbuddy", "skills");
    fs.mkdirSync(customSkillsDir, { recursive: true });

    // Not present initially
    const presentBefore = SkillInstaller.buildPresentIn(tmpHome, "custom-test-skill", ["work-buddy"]);
    assert.equal(presentBefore["work-buddy"], false);
    assert.equal(presentBefore.central, false);

    // Create skill in custom root
    const skillDir = path.join(customSkillsDir, "custom-test-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: custom-test-skill\n---\n# Test", "utf-8");

    const presentAfter = SkillInstaller.buildPresentIn(tmpHome, "custom-test-skill", ["work-buddy"]);
    assert.equal(presentAfter["work-buddy"], true);
    assert.equal(presentAfter.central, false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("SkillInstaller.linkSkillToClient links central skill to custom client root and unlinks cleanly", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-link-custom-"));
  try {
    // Setup central skill
    const centralSkillDir = SkillInstaller.getCentralSkillDir("session-sync", tmpHome);
    fs.mkdirSync(centralSkillDir, { recursive: true });
    fs.writeFileSync(path.join(centralSkillDir, "SKILL.md"), "---\nname: session-sync\n---\n# Sync", "utf-8");

    const customSkillsDir = path.join(tmpHome, ".workbuddy", "skills");
    const targetSkillDir = path.join(customSkillsDir, "session-sync");

    // Link to custom client
    const linkResult = SkillInstaller.linkSkillToClient("session-sync", "work-buddy", true, tmpHome, ["work-buddy"]);
    assert.equal(linkResult.linked, true);
    assert.equal(linkResult.client, "work-buddy");
    assert.equal(fs.existsSync(path.join(targetSkillDir, "SKILL.md")), true);

    const presentLinked = SkillInstaller.buildPresentIn(tmpHome, "session-sync", ["work-buddy"]);
    assert.equal(presentLinked["work-buddy"], true);

    // Unlink from custom client
    const unlinkResult = SkillInstaller.linkSkillToClient("session-sync", "work-buddy", false, tmpHome, ["work-buddy"]);
    assert.equal(unlinkResult.linked, false);
    assert.equal(unlinkResult.client, "work-buddy");
    assert.equal(fs.existsSync(targetSkillDir), false);

    const presentUnlinked = SkillInstaller.buildPresentIn(tmpHome, "session-sync", ["work-buddy"]);
    assert.equal(presentUnlinked["work-buddy"], false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("SkillInstaller.loadSkillsConfig and saveSkillsConfig handle custom client path overrides", () => {
  const tmpConfig = path.join(os.tmpdir(), `skills-config-${Date.now()}.json`);
  try {
    // When file does not exist -> default config
    const initial = SkillInstaller.loadSkillsConfig(tmpConfig);
    assert.deepEqual(initial, { version: 1, clientPaths: {} });

    // Save custom paths
    const toSave = {
      version: 1,
      clientPaths: {
        "work-buddy": "~/.workbuddy/skills",
        "custom-agent": "/opt/agent/skills",
      },
    };
    SkillInstaller.saveSkillsConfig(tmpConfig, toSave);

    const loaded = SkillInstaller.loadSkillsConfig(tmpConfig);
    assert.deepEqual(loaded, toSave);
  } finally {
    if (fs.existsSync(tmpConfig)) fs.rmSync(tmpConfig, { force: true });
  }
});

test("SkillInstaller.consolidateAndDispatch dispatches and unlinks custom client targets", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "skill-consolidate-custom-"));
  try {
    // Setup central skills
    const centralRoot = SkillInstaller.getCentralSkillsRoot(tmpHome);
    const skillDir = path.join(centralRoot, "sample-skill");
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: sample-skill\n---\n# Sample", "utf-8");

    const customSkillsDir = path.join(tmpHome, ".workbuddy", "skills");
    const targetSkillDir = path.join(customSkillsDir, "sample-skill");

    // Consolidate and dispatch to work-buddy
    const dispatchResult = SkillInstaller.consolidateAndDispatch({
      homeDir: tmpHome,
      targets: { "work-buddy": true },
      customClients: ["work-buddy"],
    });

    assert.ok(dispatchResult.linked >= 1);
    assert.equal(fs.existsSync(path.join(targetSkillDir, "SKILL.md")), true);

    // Consolidate and undispatch from work-buddy
    const undispatchResult = SkillInstaller.consolidateAndDispatch({
      homeDir: tmpHome,
      targets: { "work-buddy": false },
      customClients: ["work-buddy"],
    });

    assert.ok(undispatchResult.unlinked >= 1);
    assert.equal(fs.existsSync(targetSkillDir), false);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

