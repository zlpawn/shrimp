import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../..");
const SKILL_DIR = path.join(ROOT, "lib", "skills", "leo-ppt-router");
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(SKILL_DIR, rel));

test("fallback references migrated from leo-ppt-agent", () => {
  for (const f of ["outline-architect.md", "bento-grid-layout.md", "cognitive-design-principles.md"]) {
    assert.ok(exists(`references/fallback/${f}`), `missing ${f}`);
    assert.ok(read(`references/fallback/${f}`).length > 1000, `${f} looks truncated`);
  }
});

test("cjk-text-fit extracts the CJK width and font sizing rules", () => {
  const cjk = read("references/fallback/cjk-text-fit.md");
  assert.match(cjk, /1\.8/);
  assert.match(cjk, /font_size \* 1\.1/);
  assert.match(cjk, /1\.7/);            // CJK line height factor
  assert.match(cjk, /italic/i);         // 禁用斜体规则
  assert.match(cjk, /44 - \(25\.2-15\)\*0\.5/); // 字号收缩示例
});

test("pptxgenjs guide ships a runnable editable-PPTX skeleton", () => {
  const g = read("references/fallback/pptxgenjs-guide.md");
  const code = g.match(/```js\r?\n([\s\S]*?)```/)?.[1] ?? "";
  assert.ok(code.length > 0, "guide must contain a ```js skeleton");
  for (const api of ['from "pptxgenjs"', "LAYOUT_WIDE", "addSlide", "addText", "addChart", "addNotes", "writeFile"]) {
    assert.ok(code.includes(api), `skeleton missing ${api}`);
  }
  for (const layout of ["cover", "agenda", "bullets", "data", "closing"]) {
    assert.ok(code.includes(layout), `skeleton missing layout ${layout}`);
  }
  assert.match(g, /npm i pptxgenjs/);
});

test("marp guide documents image and editable pptx export", () => {
  const g = read("references/fallback/marp-guide.md");
  assert.match(g, /marp: true/);
  assert.match(g, /npx @marp-team\/marp-cli@latest deck\.md --pptx/);
  assert.match(g, /--pptx-editable/);
  assert.match(g, /LibreOffice/);
});

test("html deck guide defines a single-file horizontal deck", () => {
  const g = read("references/fallback/html-deck-guide.md");
  assert.match(g, /单文件/);
  assert.match(g, /ArrowRight|←|→/);
  assert.match(g, /16:9/);
});

test("template fill guide ships a runnable python-pptx 3-page corporate template skeleton", () => {
  const g = read("references/fallback/template-fill-guide.md");
  const py = g.match(/```python\r?\n([\s\S]*?)```/)?.[1] ?? "";
  assert.ok(py.length > 0, "guide must contain a ```python skeleton");
  for (const sym of ["python-pptx", "duplicate_slide", "move_slide", "set_text", "inspect", "build"]) {
    assert.ok(py.includes(sym), `skeleton missing ${sym}`);
  }
  assert.match(g, /uv run/);
  assert.match(g, /弱于 ppt-master/);
});

const DOWNSTREAM = {
  "ppt-master": "npx skills add hugohe3/ppt-master -g",
  "dashi-ppt": "npx dashi-ppt-skill@latest",
  "guizang-ppt-skill": "npx skills add https://github.com/op7418/guizang-ppt-skill --skill guizang-ppt-skill -g",
  "codex-ppt": "npx -y skills@latest add ningzimu/codex-ppt-skill --skill codex-ppt -g",
  "slidev": "npx skills add slidevjs/slidev -g",
};

test("skills catalog has a section, install command, editability and brand support for each downstream skill", () => {
  const c = read("references/skills-catalog.md");
  for (const [id, cmd] of Object.entries(DOWNSTREAM)) {
    const section = c.split(/^## /m).find((s) => s.startsWith(`${id}\n`) || s.startsWith(`${id}\r\n`) || s.startsWith(`${id} `));
    assert.ok(section, `missing section ## ${id}`);
    assert.ok(section.includes(cmd), `${id} install command mismatch`);
    assert.match(section, /WPS 可编辑/, `${id} missing editability line`);
    assert.match(section, /品牌色 \/ 公司模板/, `${id} missing brand/template support line`);
    assert.match(section, /运行依赖/, `${id} missing dependency line`);
  }
});

test("skills catalog lists style menus used for dynamic filtering", () => {
  const c = read("references/skills-catalog.md");
  for (const theme of ["theme01", "theme12"]) assert.ok(c.includes(theme));
  for (const style of ["麦肯锡风格", "党政红风格", "科研答辩风", "教学课件风"]) assert.ok(c.includes(style));
  assert.match(c, /电子杂志/);
  assert.match(c, /瑞士/);
  assert.match(c, /attribution_guard/);
  assert.match(c, /pptx-editable/);
});

test("SKILL.md frontmatter, size and references", () => {
  const s = read("SKILL.md");
  assert.match(s, /^---\r?\nname: leo-ppt-router\r?\ndescription: .+/);
  assert.ok(Buffer.byteLength(s, "utf8") <= 15 * 1024, "SKILL.md exceeds 15KB");
  for (const ref of [
    "references/skills-catalog.md",
    "references/fallback/outline-architect.md",
    "references/fallback/bento-grid-layout.md",
    "references/fallback/cognitive-design-principles.md",
    "references/fallback/cjk-text-fit.md",
    "references/fallback/pptxgenjs-guide.md",
    "references/fallback/marp-guide.md",
    "references/fallback/html-deck-guide.md",
    "references/fallback/template-fill-guide.md",
  ]) {
    assert.ok(s.includes(ref), `SKILL.md must reference ${ref}`);
    assert.ok(exists(ref), `${ref} referenced but missing`);
  }
});

test("SKILL.md navigation card covers the four dimensions, Z1/Z2 brand options and skip/delegate rules", () => {
  const s = read("SKILL.md");
  for (const dim of ["① 用途场景", "② 交付形态", "③ 风格", "④ 素材"]) assert.ok(s.includes(dim), `missing ${dim}`);
  assert.match(s, /要在 WPS \/ PowerPoint 里继续修改/);
  assert.match(s, /Z1.*公司品牌色/);
  assert.match(s, /Z2.*公司 PPT 模板/);
  assert.match(s, /1B 2A 3推荐 4B/);
  assert.match(s, /不再询问/);
  assert.match(s, /你定/);
});

test("SKILL.md routing matrix, brand priority rules, conflict rule, install protocol and delivery", () => {
  const s = read("SKILL.md");
  for (const [id, cmd] of Object.entries(DOWNSTREAM)) {
    assert.ok(s.includes(`\`${id}\``), `matrix missing ${id}`);
    assert.ok(s.includes(cmd), `install command for ${id} missing`);
  }
  assert.ok(s.includes("`built-in-fallback`"));
  assert.match(s, /冲突提醒/);
  assert.match(s, /一次性.*常用/);
  assert.match(s, /Edit Native PPTX/);
  assert.match(s, /不直接使用原色值|偏差/);
  assert.match(s, /~\/\.agents\/skills\/<skill-name>/);
  assert.match(s, /~\/\.gemini\/config\/skills\/<skill-name>/);
  assert.match(s, /attribution_guard/);
  assert.match(s, /PPTist/);
  assert.match(s, /规划中/);
  assert.doesNotMatch(s, /C:\\Users\\xtea|\/Users\/pa\//);
  assert.doesNotMatch(s, /leo-ppt-agent/);
});
