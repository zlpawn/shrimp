import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-novel-router");

const {
  readConfig,
  saveConfig,
  readSecrets,
  saveSecrets,
  resolveWeReadApiKey,
  maskSecret,
  resolveBookDestination,
} = await import(path.join(SKILL_DIR, "scripts", "config.mjs"));

const {
  matchPlatform,
  probeAll,
} = await import(path.join(SKILL_DIR, "scripts", "probe.mjs"));

const {
  parseBookInput,
  decodeChapterChunks,
  xhtmlToParagraphs,
  resolveOffsetWithAnchor,
  formatExportMarkdown,
} = await import(path.join(SKILL_DIR, "scripts", "weread.mjs"));

test("SKILL.md and platforms-catalog.md cover routing, WeRead adapter, and book-centric export", () => {
  const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  const catalog = fs.readFileSync(
    path.join(SKILL_DIR, "references", "platforms-catalog.md"),
    "utf8"
  );

  assert.match(skill, /^---\r?\nname: leo-novel-router\r?\ndescription: .+/);
  assert.ok(skill.includes("references/platforms-catalog.md"));
  assert.match(skill, /~\/素材\/novel/);
  assert.match(skill, /scripts\/weread\.mjs/);
  assert.match(skill, /update-highlight/);
  assert.match(skill, /remove-highlight/);

  assert.ok(catalog.includes("## weread（微信读书）"));
  assert.match(catalog, /weread\.qq\.com/);
  assert.match(catalog, /外部官方平台 Skill/);
  assert.match(skill, /npx skills add Tencent\/WeChatReading -g/);
  assert.match(skill, /weread-skills/);
  assert.match(skill, /secrets\.json/);
  assert.match(catalog, /npx skills add Tencent\/WeChatReading -g/);
});

test("config.mjs manages secrets.json independently from config.json and resolves WEREAD_API_KEY", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leo-novel-secrets-test-"));
  const prevSec = process.env.LEO_NOVEL_ROUTER_SECRETS_PATH;
  const prevEnvKey = process.env.WEREAD_API_KEY;
  process.env.LEO_NOVEL_ROUTER_SECRETS_PATH = path.join(tmpRoot, "secrets.json");
  delete process.env.WEREAD_API_KEY;

  try {
    assert.deepEqual(readSecrets(), {});
    assert.deepEqual(resolveWeReadApiKey(), { apiKey: null, source: null });

    saveSecrets({ weread_api_key: "wrk-demoKey123456789" });
    assert.equal(readSecrets().weread_api_key, "wrk-demoKey123456789");
    assert.deepEqual(resolveWeReadApiKey(), { apiKey: "wrk-demoKey123456789", source: "secrets" });
    assert.equal(maskSecret("wrk-demoKey123456789"), "wrk-de***789");

    process.env.WEREAD_API_KEY = "wrk-envOverride999";
    assert.deepEqual(resolveWeReadApiKey(), { apiKey: "wrk-envOverride999", source: "env" });
  } finally {
    if (prevSec === undefined) delete process.env.LEO_NOVEL_ROUTER_SECRETS_PATH;
    else process.env.LEO_NOVEL_ROUTER_SECRETS_PATH = prevSec;
    if (prevEnvKey === undefined) delete process.env.WEREAD_API_KEY;
    else process.env.WEREAD_API_KEY = prevEnvKey;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("config.mjs defaults to ~/素材/novel and resolves book-centric paths", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leo-novel-router-test-"));
  const prevEnv = process.env.LEO_NOVEL_ROUTER_CONFIG_PATH;
  process.env.LEO_NOVEL_ROUTER_CONFIG_PATH = path.join(tmpRoot, "config.json");

  try {
    const initial = readConfig();
    assert.equal(initial.output_dir, "~/素材/novel");
    assert.equal(initial.folder_structure, "book");
    assert.equal(initial.default_platform, "weread");

    const updated = saveConfig({ default_highlight_style: 2, default_highlight_color: 3 });
    assert.equal(updated.default_highlight_style, 2);
    assert.equal(updated.default_highlight_color, 3);

    const outDir = path.join(tmpRoot, "novel");
    const notesDest = resolveBookDestination({
      bookTitle: "叔本华的辩论艺术",
      kind: "notes",
      explicitOutputDir: outDir,
    });
    assert.equal(notesDest.bookDir, path.join(outDir, "叔本华的辩论艺术"));
    assert.match(notesDest.filename, /^叔本华的辩论艺术_划线笔记_\d{8}_\d{6}\.md$/);

    const chapDest = resolveBookDestination({
      bookTitle: "叔本华的辩论艺术",
      kind: "chapter",
      chapterIdx: 10,
      chapterTitle: "辩论三十八计",
      explicitOutputDir: outDir,
    });
    assert.equal(chapDest.targetDir, path.join(outDir, "叔本华的辩论艺术", "chapters"));
    assert.equal(chapDest.filename, "010_辩论三十八计.md");
  } finally {
    if (prevEnv === undefined) {
      delete process.env.LEO_NOVEL_ROUTER_CONFIG_PATH;
    } else {
      process.env.LEO_NOVEL_ROUTER_CONFIG_PATH = prevEnv;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("probe.mjs matches WeRead URLs and reports platform status", async () => {
  const matched = matchPlatform("https://weread.qq.com/web/reader/b63327207183c09db6382cf");
  assert.equal(matched?.id, "weread");
  assert.equal(matchPlatform("https://dedao.cn/ebook/123")?.id, "dedao");

  const report = await probeAll({ checkBridge: false });
  assert.equal(report.router, "leo-novel-router");
  assert.ok("weread" in report.platforms);
  assert.equal(report.platforms.weread.officialInstallCmd, "npx skills add Tencent/WeChatReading -g");
  assert.equal(report.platforms.weread.officialSkillRepo, "Tencent/WeChatReading");
  assert.ok("credentials" in report);
  assert.ok("dedao" in report.platforms);
});

test("weread helpers parse book URLs, decode XHTML chunks, calibrate offsets, and format Markdown", () => {
  const parsed = parseBookInput("https://weread.qq.com/web/reader/b63327207183c09db6382cf");
  assert.equal(parsed.readerHash, "b63327207183c09db6382cf");
  assert.equal(parseBookInput("b63327207183c09db6382cf").url, parsed.url);

  const sampleHtml =
    '<?xml version="1.0" encoding="utf-8"?><html><body><p class="content3"><span class="kt_105">第27计</span> Provocation <span class="bold">火上浇油</span></p><p class="content">&nbsp;</p><p class="content">如果对手感到恼怒。</p></body></html>';
  const b64 = Buffer.from(sampleHtml, "utf-8").toString("base64");
  const e0 = "0".repeat(32) + "P" + b64;
  const decoded = decodeChapterChunks({ e0 });
  assert.equal(decoded, sampleHtml);

  const paragraphs = xhtmlToParagraphs(decoded);
  assert.deepEqual(paragraphs, ["第27计 Provocation 火上浇油", "如果对手感到恼怒。"]);

  const off = resolveOffsetWithAnchor({
    xhtml: sampleHtml,
    targetText: "第27计 Provocation 火上浇油",
    anchorText: "火上浇油",
    anchorKeywordStart: 15574,
  });
  assert.ok(off);
  assert.equal(off.end - off.start, '第27计</span> Provocation <span class="bold">火上浇油'.length);
  assert.equal(off.end, 15578);

  const md = formatExportMarkdown({
    bookInfo: { title: "叔本华的辩论艺术", author: "叔本华", bookId: "25411741" },
    chapters: [{ chapterUid: 10, chapterIdx: 10, title: "辩论三十八计" }],
    bookmarks: [
      {
        bookmarkId: "25411741_10_15522-15578",
        chapterUid: 10,
        range: "15522-15578",
        style: 0,
        colorStyle: 5,
        markText: "第27计 Provocation ausbauen 火上浇油",
        createTime: 1795361200,
      },
    ],
    reviews: [],
  });
  assert.match(md, /title: "叔本华的辩论艺术"/);
  assert.match(md, /## 辩论三十八计/);
  assert.match(md, /> 第27计 Provocation ausbauen 火上浇油/);
  assert.match(md, /直线（橙）/);
});
