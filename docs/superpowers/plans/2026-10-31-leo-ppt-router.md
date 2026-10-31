# leo-ppt-router Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建 `leo-ppt-router` Skill（引导式 PPT 需求导航 + 双层路由 + JIT 安装 + 内置兜底），接替并删除 `leo-ppt-agent`。

**Architecture:** 纯文档型 Skill：`SKILL.md` 承载导航卡片、路由矩阵与协议；`references/skills-catalog.md` 承载下游 Skill 档案；`references/fallback/` 承载兜底规范（3 份迁自 leo-ppt-agent + 1 份摘录 + 3 份新写）。用 `node:test` 静态契约测试锁定关键字符串与文件，用子 agent 场景测试验证路由行为。

**Tech Stack:** Markdown、Node.js 24 `node:test`、PptxGenJS（仅兜底骨架验证时临时安装，不进仓库依赖）、PowerShell。

**Spec:** `docs/superpowers/specs/2026-10-30-leo-ppt-router-design.md`

## Global Constraints

- Skill 目录：`lib/skills/leo-ppt-router/`；frontmatter `name: leo-ppt-router`。
- SKILL.md 体积 ≤ 15KB（`Buffer.byteLength` 计）。
- 下游 Skill 标识符（必须逐字一致）：`ppt-master`、`dashi-ppt`、`guizang-ppt-skill`、`codex-ppt`、`slidev`；兜底标识符 `built-in-fallback`。
- 安装命令逐字：
  - `npx skills add hugohe3/ppt-master -g`
  - `npx dashi-ppt-skill@latest`
  - `npx skills add https://github.com/op7418/guizang-ppt-skill --skill guizang-ppt-skill -g`
  - `npx -y skills@latest add ningzimu/codex-ppt-skill --skill codex-ppt -g`
  - `npx skills add slidevjs/slidev -g`
- 探测路径禁止硬编码个人主机路径（不得出现 `C:\Users\xtea`、`/Users/pa`）。
- 不做场景化内容整理；不集成 PPTist（仅交付提示）；不绕过 ppt-master 的 `attribution_guard.py`。
- 可编辑性标记统一用 `✅` / `🟡` / `❌`。
- 文件编码 UTF-8；仓库已有 `.gitattributes`，换行交给 git。

---

### Task 1: 契约测试骨架 + 兜底规范迁移

**Files:**
- Create: `tests/unit/leo-ppt-router-skill.test.mjs`
- Create: `lib/skills/leo-ppt-router/references/fallback/outline-architect.md`（复制）
- Create: `lib/skills/leo-ppt-router/references/fallback/bento-grid-layout.md`（复制）
- Create: `lib/skills/leo-ppt-router/references/fallback/cognitive-design-principles.md`（复制）
- Create: `lib/skills/leo-ppt-router/references/fallback/cjk-text-fit.md`（摘录）
- Modify: `package.json`（scripts 增加 `test:leo-ppt-router`）

**Interfaces:**
- Produces: 测试文件常量 `SKILL_DIR`、`read(rel)` 辅助函数，后续任务往同一文件追加 `test(...)`。

- [ ] **Step 1: 写失败测试**

```js
// tests/unit/leo-ppt-router-skill.test.mjs
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
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test tests/unit/leo-ppt-router-skill.test.mjs`
Expected: FAIL，`missing outline-architect.md`

- [ ] **Step 3: 复制三份规范**

```powershell
$src = "lib\skills\leo-ppt-agent\references\prompts"
$dst = "lib\skills\leo-ppt-router\references\fallback"
New-Item -ItemType Directory -Force $dst | Out-Null
Copy-Item "$src\outline-architect.md","$src\bento-grid-layout.md","$src\cognitive-design-principles.md" $dst
```

- [ ] **Step 4: 摘录 cjk-text-fit.md**

从 `lib/skills/leo-ppt-agent/references/prompts/svg-generator.md` 摘出以下段落，原文照搬、不改写，组成新文件：
- 第 99–126 行 `## Dynamic Font Sizing`（含 Slide Title / Card Title / CJK Adjustment / Example）
- 第 127–167 行 `## CJK Text Handling`（含 Character Width / Line Height / Font Family / Emphasis / Character Spacing / Punctuation Rules）
- 第 423–444 行 `## Text Overflow Strategy`（含 Line Capacity Estimation / Overflow Prevention / Hard Rules）

文件头加：

```markdown
# CJK 文字适配规则（兜底用）

> 摘自 leo-ppt-agent `svg-generator.md`。适用于兜底出片（PptxGenJS / HTML / SVG）时估算中文字宽、行数与字号，防止文字溢出。PptxGenJS 中以英寸为单位时，先按 1 in = 96 px 换算。
```

- [ ] **Step 5: package.json 增加脚本**

在 `scripts` 中 `test:leo-typesafe-ai` 之后加入：

```json
"test:leo-ppt-router": "node --test tests/unit/leo-ppt-router-skill.test.mjs",
```

- [ ] **Step 6: 运行确认通过**

Run: `npm run test:leo-ppt-router`
Expected: PASS（2 tests）

- [ ] **Step 7: Commit**

```bash
git add tests/unit/leo-ppt-router-skill.test.mjs lib/skills/leo-ppt-router/references/fallback package.json
git commit -m "feat(leo-ppt-router): migrate fallback layout references from leo-ppt-agent"
```

---

### Task 2: 新写兜底工具指南（PptxGenJS / Marp / HTML）

**Files:**
- Create: `lib/skills/leo-ppt-router/references/fallback/pptxgenjs-guide.md`
- Create: `lib/skills/leo-ppt-router/references/fallback/marp-guide.md`
- Create: `lib/skills/leo-ppt-router/references/fallback/html-deck-guide.md`
- Test: `tests/unit/leo-ppt-router-skill.test.mjs`（追加）

**Interfaces:**
- Consumes: Task 1 的 `read` / `exists`。
- Produces: 三份指南文件名，Task 4 的 SKILL.md §兜底 会引用。

- [ ] **Step 1: 追加失败测试**

```js
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:leo-ppt-router`
Expected: FAIL，`ENOENT ... pptxgenjs-guide.md`

- [ ] **Step 3: 写 pptxgenjs-guide.md**

结构：`# PptxGenJS 兜底出片指南` → `## 何时使用`（②A 可编辑 PPTX、②E 重新生成、②C 拼装整页图片）→ `## 准备`（在产物目录执行 `npm init -y && npm i pptxgenjs`，不得安装进仓库根）→ `## 代码骨架` → `## 规则`（字号下限 14pt、中文字体链 `"Microsoft YaHei", "PingFang SC", sans-serif`、每页要点 ≤ 5 条、按 `cjk-text-fit.md` 估算溢出、所有文字用 `addText` 保持可编辑，禁止把文字渲染成图片）→ `## ②C 图片拼装`（`slide.addImage({ path, x: 0, y: 0, w: "100%", h: "100%" })`）。

代码骨架（完整写入文件）：

```js
// build-deck.mjs — 由 agent 按大纲改写 deck 数组后执行：node build-deck.mjs
import pptxgen from "pptxgenjs";

const FONT = "Microsoft YaHei";
const C = { ink: "1F2937", sub: "6B7280", accent: "2563EB", bg: "FFFFFF", card: "F3F4F6" };

const deck = {
  title: "演示标题",
  slides: [
    { layout: "cover", title: "演示标题", subtitle: "副标题 · 汇报人 · 日期" },
    { layout: "agenda", title: "目录", items: ["背景", "核心成果", "下一步"] },
    { layout: "bullets", title: "核心结论先行", points: ["要点一", "要点二", "要点三"], notes: "讲稿" },
    { layout: "data", title: "关键数据", chart: { labels: ["Q1", "Q2", "Q3", "Q4"], values: [12, 19, 23, 31], name: "营收(万)" } },
    { layout: "closing", title: "谢谢", subtitle: "Q&A" },
  ],
};

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in, 16:9
pptx.title = deck.title;

const titleOf = (s, text) =>
  s.addText(text, { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 30, bold: true, color: C.ink });

const render = {
  cover(s, d) {
    s.background = { color: C.accent };
    s.addText(d.title, { x: 0.8, y: 2.4, w: 11.7, h: 1.4, fontFace: FONT, fontSize: 44, bold: true, color: "FFFFFF" });
    s.addText(d.subtitle ?? "", { x: 0.8, y: 3.9, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 20, color: "E5E7EB" });
  },
  agenda(s, d) {
    titleOf(s, d.title);
    s.addText(
      d.items.map((t, i) => ({ text: `${String(i + 1).padStart(2, "0")}  ${t}`, options: { breakLine: true } })),
      { x: 0.8, y: 1.6, w: 11.7, h: 5.2, fontFace: FONT, fontSize: 24, color: C.ink, paraSpaceAfter: 12 },
    );
  },
  bullets(s, d) {
    titleOf(s, d.title);
    s.addShape(pptx.ShapeType.roundRect, { x: 0.6, y: 1.5, w: 12.1, h: 5.4, fill: { color: C.card }, rectRadius: 0.1, line: { color: C.card } });
    s.addText(d.points.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })), {
      x: 0.9, y: 1.7, w: 11.5, h: 5.0, fontFace: FONT, fontSize: 22, color: C.ink, paraSpaceAfter: 10, valign: "top",
    });
  },
  data(s, d) {
    titleOf(s, d.title);
    s.addChart(pptx.ChartType.bar, [{ name: d.chart.name, labels: d.chart.labels, values: d.chart.values }], {
      x: 0.6, y: 1.5, w: 12.1, h: 5.4, chartColors: [C.accent], showValue: true, catAxisLabelFontFace: FONT, valAxisLabelFontFace: FONT,
    });
  },
  closing(s, d) {
    s.background = { color: C.ink };
    s.addText(d.title, { x: 0.8, y: 2.6, w: 11.7, h: 1.4, fontFace: FONT, fontSize: 48, bold: true, color: "FFFFFF", align: "center" });
    s.addText(d.subtitle ?? "", { x: 0.8, y: 4.1, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 22, color: "D1D5DB", align: "center" });
  },
};

for (const d of deck.slides) {
  const s = pptx.addSlide();
  s.background = { color: C.bg };
  render[d.layout](s, d);
  if (d.notes) s.addNotes(d.notes);
}

await pptx.writeFile({ fileName: "presentation.pptx" });
console.log("OK presentation.pptx");
```

- [ ] **Step 4: 写 marp-guide.md**

结构：`# Marp 兜底出片指南` → `## 何时使用`（②D 且 slidev 未安装、或用户要极简纯文字快速出片）→ `## 最小模板`（frontmatter：`marp: true`、`theme: default`、`paginate: true`、`size: 16:9`；`---` 分页；`<!-- 讲稿 -->` 写备注）→ `## 导出`：
- 图片式 PPTX（❌ 不可编辑）：`npx @marp-team/marp-cli@latest deck.md --pptx`
- 可编辑 PPTX（🟡 实验功能，需 PATH 中有 LibreOffice，复杂 CSS 需手修）：`npx @marp-team/marp-cli@latest deck.md --pptx --pptx-editable`
- HTML：`npx @marp-team/marp-cli@latest deck.md --html`
- PDF：`npx @marp-team/marp-cli@latest deck.md --pdf`
→ `## 规则`（每页一个观点、要点 ≤ 5 条、中文用 `section { font-family: "Microsoft YaHei", sans-serif; }` 的 `<style>` 块）。

- [ ] **Step 5: 写 html-deck-guide.md**

结构：`# 单文件 HTML Deck 兜底指南` → `## 何时使用`（②B 且 guizang/dashi 均未安装）→ `## 硬性要求`：单文件（CSS/JS 内联，无外部依赖或仅可选 CDN 且有降级）；每页 `<section class="slide">` 固定 16:9（`aspect-ratio: 16 / 9`，按视口等比缩放）；键盘 `ArrowRight`/`ArrowLeft`（→/←）、空格翻页；`Esc` 总览网格；URL hash 记录页码；讲稿写在 `<aside class="notes">` 默认隐藏 → `## 版式`（复用 `bento-grid-layout.md` 的网格规则）→ `## 交付说明`（❌ 不可在 WPS 编辑，如需 PPTX 应改走 ②A）。

- [ ] **Step 6: 运行确认通过**

Run: `npm run test:leo-ppt-router`
Expected: PASS（5 tests）

- [ ] **Step 7: 实跑 PptxGenJS 骨架（临时目录，验证后删除）**

```powershell
$tmp = Join-Path $env:TEMP "leo-ppt-router-skeleton"; New-Item -ItemType Directory -Force $tmp | Out-Null; Set-Location $tmp
npm init -y | Out-Null; npm i pptxgenjs | Out-Null
$g = Get-Content "D:\agent-transfer\lib\skills\leo-ppt-router\references\fallback\pptxgenjs-guide.md" -Raw -Encoding UTF8
[regex]::Match($g, '```js\r?\n([\s\S]*?)```').Groups[1].Value | Set-Content build-deck.mjs -Encoding UTF8
node build-deck.mjs
Expand-Archive presentation.pptx x -Force; Select-String x\ppt\slides\slide3.xml -Pattern '要点一' -Quiet
```

Expected: 输出 `OK presentation.pptx`，最后一行 `True`（文字以 `<a:t>` 原生文本存在 = 可编辑）。若失败，修正骨架后重跑 Step 6–7。之后 `Remove-Item $tmp -Recurse -Force`。

- [ ] **Step 8: Commit**

```bash
git add lib/skills/leo-ppt-router/references/fallback tests/unit/leo-ppt-router-skill.test.mjs
git commit -m "feat(leo-ppt-router): add PptxGenJS, Marp and HTML fallback guides"
```

---

### Task 3: 下游 Skill 档案 skills-catalog.md

**Files:**
- Create: `lib/skills/leo-ppt-router/references/skills-catalog.md`
- Test: `tests/unit/leo-ppt-router-skill.test.mjs`（追加）

**Interfaces:**
- Produces: 每个下游 Skill 一个 `## <identifier>` 二级标题，SKILL.md 的风格过滤与安装卡片引用这些小节。

- [ ] **Step 1: 追加失败测试**

```js
const DOWNSTREAM = {
  "ppt-master": "npx skills add hugohe3/ppt-master -g",
  "dashi-ppt": "npx dashi-ppt-skill@latest",
  "guizang-ppt-skill": "npx skills add https://github.com/op7418/guizang-ppt-skill --skill guizang-ppt-skill -g",
  "codex-ppt": "npx -y skills@latest add ningzimu/codex-ppt-skill --skill codex-ppt -g",
  "slidev": "npx skills add slidevjs/slidev -g",
};

test("skills catalog has a section, install command and editability for each downstream skill", () => {
  const c = read("references/skills-catalog.md");
  for (const [id, cmd] of Object.entries(DOWNSTREAM)) {
    const section = c.split(/^## /m).find((s) => s.startsWith(`${id}\n`) || s.startsWith(`${id} `));
    assert.ok(section, `missing section ## ${id}`);
    assert.ok(section.includes(cmd), `${id} install command mismatch`);
    assert.match(section, /WPS 可编辑/, `${id} missing editability line`);
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:leo-ppt-router`
Expected: FAIL，`ENOENT ... skills-catalog.md`

- [ ] **Step 3: 写 skills-catalog.md**

每个小节固定字段（逐项照填，数据全部来自 spec §6 与以下事实）：

```markdown
## <identifier>

- **一句话**：
- **来源**：
- **安装命令**：`...`
- **运行依赖**：
- **交付形态**：
- **WPS 可编辑**：✅ / 🟡 / ❌ + 原因
- **风格菜单**：
- **交接注意事项**：
```

各小节内容：
- `ppt-master`：AI 生成原生可编辑 PPTX（v6.8.0，MIT，github.com/hugohe3/ppt-master）；运行依赖 Python 3.10–3.14 + 安装目录内 `pip install -r requirements.txt`；风格菜单：自由设计或品牌/模板工作区；图像配色 14 种（cool-corporate、dark-cinematic、duotone、earthy-dusty、editorial-classic、frost-ice、jewel-tone、macaron、mono-ink、nature-organic、sunset-gradient、tech-neon、vivid-launch、warm-earth）；WPS ✅ 原生形状/图表/表格，动画与形状调节手柄在 WPS 中可能有差异；交接：首步运行 `attribution_guard.py`，非零即停，不得绕过；其内部三路由（Generate PPTX / Create Template / Edit Native PPTX）由它自己判定。
- `dashi-ppt`：12 主题 HTML 演示，可导出 PPTX/PDF（v0.4.14，github.com/chuspeeism/dashi-ppt-skill）；安装附国内镜像 `npx --registry=https://registry.npmmirror.com dashi-ppt-skill@latest`；运行依赖 Node.js，导出 PPTX 需本机预览服务 + Playwright；风格菜单 theme01 轻拟态风（产品介绍/企业汇报）、theme02 炫光紫绿风（科技发布会）、theme03 深浅代码风（技术方案）、theme04 玻璃糖果风（年轻化品牌）、theme05 色谱图表风（数据报告）、theme06 深色图谱风（战略分析）、theme07 冷白调研风（调研报告/白皮书）、theme08 黑金实验风（高端发布）、theme09 深蓝杂志风（品牌故事）、theme10 金色指数风（金融指数，仅用户点名）、theme11 高能增长风、theme12 声波霓虹风；WPS 🟡 DOM 提取文字可编辑，映射失败区域退化为截图（官方 editableFidelity 0.851）；交接：它强制展示风格图并确认风格与是否用图片/视频，router 已收集答案随交接传入，其余遵从其门禁；只有明确要 PPTX 才导出。
- `guizang-ppt-skill`：单文件 HTML 横向翻页（作者歸藏，github.com/op7418/guizang-ppt-skill）；运行依赖：浏览器；风格菜单：A 电子杂志 × 电子墨水（衬线 + WebGL 流体，人文/行业观察/发布）、B 瑞士国际主义（无衬线 + 网格点阵，IKB/柠檬黄/柠檬绿/安全橙，科技/数据/年度总结）；WPS ❌ 官方不支持导出 PPTX；交接：来源与赞助信息不得写入产物。
- `codex-ppt`：整页图片式 PPTX（github.com/ningzimu/codex-ppt-skill）；运行依赖 Python 3 + 生图后端（宿主内置生图工具，或 `OPENAI_API_KEY`/`OPENAI_BASE_URL`/`CODEX_PPT_IMAGE_MODEL`）；风格菜单 12 种：党政红风格、创意杂志风、复古扁平插画风、手绘技术解释风、手绘白板风、教学课件风、数据仪表盘风、清爽专业风、温暖手工风、电子墨水杂志风、科研答辩风、麦肯锡风格；WPS ❌ 每页整图；交接：有样张审批门禁；需可编辑时提示作者的 image-to-editable-ppt-skill（规划中，未接入）。
- `slidev`：开发者 Markdown 幻灯片官方 skill（github.com/slidevjs/slidev）；运行依赖 Node.js + pnpm，导出需 playwright-chromium；风格菜单：Slidev 主题（default、seriph 等）+ 代码高亮/Magic Move/Mermaid/LaTeX；WPS ✅ 仅当用 `slidev export --format pptx-editable` 导出（默认 `--format pptx` 为图片 ❌）；交接：需 WPS 编辑时必须指定 `pptx-editable`。

文件末尾加 `## 非路由目标（仅供参考）`：PPTist（Web GUI、AGPL-3.0，仅作交付后"手动精修"提示）、PptxGenJS 与 Marp CLI（内置兜底工具，见 `fallback/`）。

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:leo-ppt-router`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-ppt-router/references/skills-catalog.md tests/unit/leo-ppt-router-skill.test.mjs
git commit -m "feat(leo-ppt-router): add downstream PPT skills catalog"
```

---

### Task 4: SKILL.md 主体

**Files:**
- Create: `lib/skills/leo-ppt-router/SKILL.md`
- Test: `tests/unit/leo-ppt-router-skill.test.mjs`（追加）

**Interfaces:**
- Consumes: Task 2/3 文件名（`references/skills-catalog.md`、`references/fallback/*.md`）与 `DOWNSTREAM` 常量。

- [ ] **Step 1: 追加失败测试**

```js
test("SKILL.md frontmatter, size and references", () => {
  const s = read("SKILL.md");
  assert.match(s, /^---\r?\nname: leo-ppt-router\r?\ndescription: .+/);
  assert.ok(Buffer.byteLength(s, "utf8") <= 15 * 1024, "SKILL.md exceeds 15KB");
  for (const ref of ["references/skills-catalog.md", "references/fallback/outline-architect.md",
    "references/fallback/pptxgenjs-guide.md", "references/fallback/marp-guide.md", "references/fallback/html-deck-guide.md",
    "references/fallback/bento-grid-layout.md", "references/fallback/cjk-text-fit.md"]) {
    assert.ok(s.includes(ref), `SKILL.md must reference ${ref}`);
    assert.ok(exists(ref), `${ref} referenced but missing`);
  }
});

test("SKILL.md navigation card covers the four dimensions and skip/delegate rules", () => {
  const s = read("SKILL.md");
  for (const dim of ["① 用途场景", "② 交付形态", "③ 风格", "④ 素材"]) assert.ok(s.includes(dim), `missing ${dim}`);
  assert.match(s, /要在 WPS \/ PowerPoint 里继续修改/);
  assert.match(s, /1B 2A 3推荐 4B/);
  assert.match(s, /不再询问/);
  assert.match(s, /你定/);
});

test("SKILL.md routing matrix, conflict rule, install protocol and delivery", () => {
  const s = read("SKILL.md");
  for (const [id, cmd] of Object.entries(DOWNSTREAM)) {
    assert.ok(s.includes(`\`${id}\``), `matrix missing ${id}`);
    assert.ok(s.includes(cmd), `install command for ${id} missing`);
  }
  assert.ok(s.includes("`built-in-fallback`"));
  assert.match(s, /冲突提醒/);
  assert.match(s, /~\/\.agents\/skills\/<skill-name>/);
  assert.match(s, /~\/\.gemini\/config\/skills\/<skill-name>/);
  assert.match(s, /attribution_guard/);
  assert.match(s, /PPTist/);
  assert.match(s, /规划中/);
  assert.doesNotMatch(s, /C:\\Users\\xtea|\/Users\/pa\//);
  assert.doesNotMatch(s, /leo-ppt-agent/);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:leo-ppt-router`
Expected: FAIL，`ENOENT ... SKILL.md`

- [ ] **Step 3: 写 SKILL.md**

frontmatter：

```markdown
---
name: leo-ppt-router
description: Use when the user wants to make a PPT, slide deck, presentation, 幻灯片, 演示文稿, 汇报/述职/发布会/课件 slides, or to beautify/convert an existing PPTX. Guides unclear requests with a numbered menu (scene, delivery form incl. WPS/PowerPoint editability, style, materials), routes to the best installed PPT skill (ppt-master, dashi-ppt, guizang-ppt-skill, codex-ppt, slidev), offers user-confirmed installation of missing skills, and falls back to built-in PptxGenJS / Marp / single-file HTML generation.
---
```

正文章节（按 leo-imagine-router 的版式与语气，内容逐字取自 spec 对应章节）：
1. `# Leo PPT Router（PPT 需求引导与技能路由中心）` + `## 📖 核心定位`（spec §1，含非目标中的"不做场景化内容整理""PPTist 仅提示"两条）
2. `## 🧭 工作流概览`：spec §3 mermaid 图原样
3. `## 💡 方案导航（需求引导）`：spec §4 触发条件、规则、卡片模板原样；③ 写明"按 ①② 结果，从 `references/skills-catalog.md` 对应小节的风格菜单中过滤列出"
4. `## 🗂️ 路由矩阵`：spec §5 主矩阵 + 冲突提醒 + 场景默认推荐表原样
5. `## ⚡ Step 2：运行期探测`：spec §7 四条探测路径
6. `## 📦 Step 4：缺失技能安装`：安装卡片模板（下方代码块）+ spec §7 同意后流程 + 安装失败处理；安装命令表列出 Global Constraints 中 5 条命令
7. `## 🤝 Step 3：交接给下游 Skill`：携带已选四维度；遵守下游自身门禁；ppt-master 的 `attribution_guard.py` 非零即停不得绕过；下游细节读 `references/skills-catalog.md`
8. `## 🛡️ Step 5：内置兜底`：spec §8 内容（大纲先确认）+ 形态→工具表，链接到 `references/fallback/` 下 7 份文件
9. `## 📤 Step 6：交付规范`：spec §9 五条
10. `## 🚀 规划中`：spec §10 表格原样（场景化内容整理、独立 Marp Skill、image-to-editable-ppt-skill）

安装卡片模板：

```text
💡 **方案推荐**：您的需求最适合 **【<Skill 名>】**（<一句话特性>）。

当前环境尚未安装该技能：
* **开源地址**：<GitHub URL>
* **安装命令**：`<命令>`
* **运行依赖**：<依赖>
* **WPS 可编辑**：<✅/🟡/❌ + 说明>

**是否需要我帮您安装？**
* 回复 **"安装"**：我将完成安装与依赖准备，并直接继续制作；
* 回复 **"直接出"**：我将用内置兜底方案立即制作（<兜底工具> · <可编辑性>）。
```

- [ ] **Step 4: 运行确认通过**

Run: `npm run test:leo-ppt-router`
Expected: PASS（10 tests）。若体积超 15KB，把场景默认推荐表移入 `skills-catalog.md` 末尾并在 SKILL.md 中改为引用。

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-ppt-router/SKILL.md tests/unit/leo-ppt-router-skill.test.mjs
git commit -m "feat(leo-ppt-router): add guided navigation and routing SKILL.md"
```

---

### Task 5: README + managed-catalog 条目

**Files:**
- Create: `lib/skills/leo-ppt-router/README.md`
- Modify: `lib/skills/managed-catalog.json`（在 `leo-ppt-agent` 条目之前插入 `leo-ppt-router` 条目；`leo-ppt-agent` 条目留到 Task 8 删除）
- Test: `tests/unit/leo-ppt-router-skill.test.mjs`（追加）

- [ ] **Step 1: 追加失败测试**

```js
test("README documents scenes and installation", () => {
  const r = read("README.md");
  assert.match(r, /^# leo-ppt-router/m);
  for (const id of Object.keys(DOWNSTREAM)) assert.ok(r.includes(id));
  assert.match(r, /\$HOME\\\.agents\\skills/);
  assert.match(r, /\.gemini/);
});

test("leo-ppt-router is registered as the featured creative PPT skill", () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "skills", "managed-catalog.json"), "utf8"));
  const entry = catalog.skills.find((i) => i.name === "leo-ppt-router");
  assert.ok(entry, "catalog entry missing");
  assert.equal(entry.id, "leo-ppt-router");
  assert.equal(entry.category, "creative");
  assert.equal(entry.categoryLabel, "创意与演示");
  assert.equal(entry.icon, "📊");
  assert.equal(entry.featured, true);
  assert.equal(entry.promoted, true);
  assert.equal(entry.managed, true);
  assert.equal(entry.requiresDaemon, false);
  assert.ok(entry.tags.includes("ppt"));
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:leo-ppt-router`
Expected: FAIL，`ENOENT ... README.md`

- [ ] **Step 3: 写 README.md**

照 `lib/skills/leo-imagine-router/README.md` 版式：标题 `# leo-ppt-router (PPT 需求引导与技能路由中心)`、`## 🌟 核心特性`（引导式四维度导航、双层路由、WPS 可编辑性标注与冲突提醒、JIT 安装、内置兜底）、`## 🚀 支持的路由矩阵`（交付形态 / 场景 / 目标 Skill / WPS 可编辑 四列，取 spec §5）、`## 💻 安装`（复制到 `~/.agents/skills` 与 `~/.gemini/config/skills`，给 bash 与 PowerShell 两版：`Copy-Item -Path "lib\skills\leo-ppt-router" -Destination "$HOME\.agents\skills\" -Recurse -Force`、`Copy-Item -Path "lib\skills\leo-ppt-router" -Destination "$HOME\.gemini\config\skills\" -Recurse -Force`）、`## 📄 许可协议` MIT。

- [ ] **Step 4: 插入 catalog 条目**

在 `"id": "leo-ppt-agent"` 条目的 `{` 之前插入：

```json
    {
      "id": "leo-ppt-router",
      "name": "leo-ppt-router",
      "title": "Leo PPT 需求引导与路由",
      "summary": "引导式确认场景、交付形态（含 WPS 可编辑性）、风格与素材，智能路由到 ppt-master、dashi-ppt、guizang、codex-ppt、Slidev 等专精 PPT 技能，缺失时引导安装，并内置 PptxGenJS / Marp / HTML 兜底出片。",
      "category": "creative",
      "categoryLabel": "创意与演示",
      "icon": "📊",
      "featured": true,
      "tags": ["ppt", "slides", "presentation", "router", "pptx", "wps", "幻灯片", "演示文稿"],
      "requiresDaemon": false,
      "promoted": true,
      "managed": true
    },
```

并把顶层 `updatedAt` 改为执行当天的 ISO 时间。

- [ ] **Step 5: 运行确认通过 + 不破坏既有 catalog 测试**

Run: `npm run test:leo-ppt-router; node --test tests/unit/leo-fooocus-imagine-skill.test.mjs tests/unit/wendao-cli.test.mjs`
Expected: 全部 PASS（12 tests + 既有测试）

- [ ] **Step 6: Commit**

```bash
git add lib/skills/leo-ppt-router/README.md lib/skills/managed-catalog.json tests/unit/leo-ppt-router-skill.test.mjs
git commit -m "feat(leo-ppt-router): add README and register in managed catalog"
```

---

### Task 6: 子 agent 行为场景验证

**Files:**
- Create: `C:\Users\xtea\.gemini\antigravity\brain\48769b88-75ad-40e8-b610-a8b5500feb60\scratch\leo-ppt-router-scenarios.md`（结果记录，不进仓库）

- [ ] **Step 1: 逐个场景派发子 agent**

对 spec §12 的 8 个场景，每个派发一个全新子 agent，提示词：

```text
你是一个加载了下列 Skill 的 agent。只阅读 D:\agent-transfer\lib\skills\leo-ppt-router\SKILL.md 及其引用的 references 文件，不要执行任何安装或生成命令。
假设当前环境 5 个下游 Skill（ppt-master、dashi-ppt、guizang-ppt-skill、codex-ppt、slidev）均未安装。
用户说："<场景输入>"
请输出：1) 你回复用户的完整第一条消息；2) 你选择的路由目标标识符（或"先提问"）；3) 依据 SKILL.md 的哪一节。
```

场景 7 的输入为两轮："帮我做一份季度汇报 PPT，要能在 WPS 改，商务简约风，素材如下：……" → 期望安装卡片；再给"直接出" → 期望先出大纲确认，工具为 PptxGenJS。

- [ ] **Step 2: 对照期望判定**

按 spec §12 表格逐条判 PASS/FAIL，记录到 scratch 文件。任何 FAIL：定位 SKILL.md 中导致误判的措辞，修改后重跑该场景，并重跑 `npm run test:leo-ppt-router`。

- [ ] **Step 3: Commit（仅当有修改）**

```bash
git add lib/skills/leo-ppt-router/SKILL.md
git commit -m "fix(leo-ppt-router): tighten routing wording from scenario tests"
```

---

### Task 7: 安装到本机技能目录 + 真实探测

**Files:**
- 无仓库改动

- [ ] **Step 1: 复制安装**

```powershell
Copy-Item -Path "D:\agent-transfer\lib\skills\leo-ppt-router" -Destination "$HOME\.agents\skills\" -Recurse -Force
Copy-Item -Path "D:\agent-transfer\lib\skills\leo-ppt-router" -Destination "$HOME\.gemini\config\skills\" -Recurse -Force
Test-Path "$HOME\.agents\skills\leo-ppt-router\SKILL.md"; Test-Path "$HOME\.gemini\config\skills\leo-ppt-router\SKILL.md"
```

Expected: `True` `True`

- [ ] **Step 2: 真实探测**

```powershell
foreach ($n in 'ppt-master','dashi-ppt','guizang-ppt-skill','codex-ppt','slidev') {
  $hit = @("$HOME\.agents\skills\$n","$HOME\.gemini\config\skills\$n","D:\agent-transfer\lib\skills\$n","D:\agent-transfer\.agents\skills\$n") | Where-Object { Test-Path "$_\SKILL.md" }
  "$n => " + ($(if ($hit) { "INSTALLED $hit" } else { "MISSING" }))
}
```

Expected: 5 行均为 `MISSING`（与 2026-10-30 扫描一致），即真实使用时会触发安装卡片。

---

### Task 8: 删除 leo-ppt-agent

**Files:**
- Delete: `lib/skills/leo-ppt-agent/`
- Modify: `lib/skills/managed-catalog.json`（删除 `leo-ppt-agent` 条目）
- Delete（仓库外）: `~/.agents/skills/leo-ppt-agent`
- Test: `tests/unit/leo-ppt-router-skill.test.mjs`（追加）

- [ ] **Step 1: 追加失败测试**

```js
test("leo-ppt-agent is fully retired", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "lib", "skills", "leo-ppt-agent")), "leo-ppt-agent dir still exists");
  const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "lib", "skills", "managed-catalog.json"), "utf8"));
  assert.ok(!catalog.skills.some((i) => i.name === "leo-ppt-agent"), "catalog still lists leo-ppt-agent");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm run test:leo-ppt-router`
Expected: FAIL，`leo-ppt-agent dir still exists`

- [ ] **Step 3: 删除前复查引用**

Run: `git grep -l "leo-ppt-agent" -- . ':!docs/superpowers' ':!lib/skills/leo-ppt-agent' ':!lib/skills/leo-ppt-router' ':!tests/unit/leo-ppt-router-skill.test.mjs'`
Expected: 仅 `lib/skills/managed-catalog.json`。若出现其他文件，停止并向用户报告。

- [ ] **Step 4: 删除**

```powershell
git rm -r -q lib/skills/leo-ppt-agent
Remove-Item "$HOME\.agents\skills\leo-ppt-agent" -Recurse -Force
```

再从 `managed-catalog.json` 删除 `"id": "leo-ppt-agent"` 整个对象（含其前后逗号保持 JSON 合法），`updatedAt` 更新为当前 ISO 时间。

- [ ] **Step 5: 运行确认通过**

Run: `npm run test:leo-ppt-router; node --test tests/unit/leo-fooocus-imagine-skill.test.mjs tests/unit/wendao-cli.test.mjs; Test-Path "$HOME\.agents\skills\leo-ppt-agent"`
Expected: 全部 PASS；最后输出 `False`

- [ ] **Step 6: Commit**

```bash
git add -A lib/skills/leo-ppt-agent lib/skills/managed-catalog.json tests/unit/leo-ppt-router-skill.test.mjs
git commit -m "chore(skills): retire leo-ppt-agent in favor of leo-ppt-router"
```
