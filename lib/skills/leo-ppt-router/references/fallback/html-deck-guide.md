# 单文件 HTML Deck 兜底指南

## 何时使用

- **②B 浏览器高交互 Web 演示稿**（如产品发布、技术分享、动态卡片看板演示）且首选的 Web 幻灯片技能（`guizang` / `dashi` 等）均未安装、用户选择跳过安装时。
- 用户只需双击打开单个 `.html` 文件即可离线全屏放映，无需启动本地开发服务器或打包构建。

## 硬性要求

1. **单文件自包含**：全部 CSS 与 JS 内联在单个 `.html` 文件内，零构建步骤；原则上无外部依赖（若引用可选字体/图标 CDN，断网时必须有本地系统字体与原生 SVG 优雅降级）。
2. **16:9 等比画布**：每页统一使用 `<section class="slide">`，固定 **16:9** 画幅（`aspect-ratio: 16 / 9`，基准设计分辨率 `1280 × 720`，通过 CSS 变量或 `transform: scale(...)` 按浏览器视口等比居中缩放，严禁出现页面纵向滚动条导致内容被截断）。
3. **键盘与交互导航**：
   - `ArrowRight`（`→`）或 `Space`（空格）：下一页；
   - `ArrowLeft`（`←`）：上一页；
   - `Esc`：切换**总览网格模式**（Overview Grid），点击任意缩略卡片跳至对应页并退出总览；
   - **URL hash 同步**：翻页时更新 `location.hash`（如 `#1`、`#2`），刷新页面或分享链接时直接定位到对应页码。
4. **演讲者备注**：每页讲稿写在 `<aside class="notes">...</aside>` 内，默认隐藏（`display: none`），可支持按 `N` 键浮层预览讲稿。
5. **③ Z1 公司品牌色**：统一定义在 `:root { --accent: #2563eb; }`，当用户指定公司品牌色时直接替换 `--accent`，驱动标题强调条、高亮标签、图表主色与进度指示器。

### 最小单文件骨架

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>演示标题</title>
  <style>
    :root {
      --accent: #2563eb;
      --ink: #111827;
      --sub: #6b7280;
      --bg: #f8fafc;
      --card: #ffffff;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0f172a;
      color: var(--ink);
      font-family: "Inter", "PingFang SC", "Microsoft YaHei", sans-serif;
      height: 100vh;
      overflow: hidden;
      display: grid;
      place-items: center;
    }
    .deck {
      width: min(100vw, calc(100vh * 16 / 9));
      aspect-ratio: 16 / 9;
      position: relative;
    }
    section.slide {
      display: none;
      width: 100%;
      height: 100%;
      aspect-ratio: 16 / 9;
      background: var(--bg);
      padding: 4.5% 5%;
      border-radius: 8px;
      flex-direction: column;
      justify-content: space-between;
    }
    section.slide.active { display: flex; }
    aside.notes { display: none; }
    body.show-notes section.slide.active aside.notes {
      display: block;
      position: absolute;
      left: 5%; right: 5%; bottom: 3%;
      background: rgba(15, 23, 42, 0.9);
      color: #f8fafc;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
    }
    body.overview { overflow-y: auto; display: block; padding: 32px; }
    body.overview .deck {
      width: 100%;
      aspect-ratio: auto;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 24px;
    }
    body.overview section.slide {
      display: flex;
      cursor: pointer;
      outline: 2px solid transparent;
    }
    body.overview section.slide.active { outline-color: var(--accent); }
    .bento { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px; flex: 1; margin-top: 24px; }
    .card { background: var(--card); border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .col-6 { grid-column: span 6; }
    .col-4 { grid-column: span 4; }
    .col-8 { grid-column: span 8; }
    .badge { color: var(--accent); font-weight: 700; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main class="deck" id="deck">
    <section class="slide">
      <div>
        <span class="badge">KEYNOTE</span>
        <h1 style="font-size: clamp(28px, 3.6vw, 48px); margin-top: 12px;">演示标题</h1>
        <p style="color: var(--sub); margin-top: 12px;">副标题 · 汇报人 · 日期</p>
      </div>
      <aside class="notes">开场讲稿备注</aside>
    </section>

    <section class="slide">
      <h2 style="font-size: clamp(22px, 2.4vw, 34px); border-left: 5px solid var(--accent); padding-left: 14px;">核心结论先行</h2>
      <div class="bento">
        <div class="card col-8"><h3>主论据（2/3）</h3><p style="margin-top:8px;color:var(--sub);">核心业务指标与架构演进结论</p></div>
        <div class="card col-4"><h3>关键数字（1/3）</h3><p style="margin-top:8px;font-size:2rem;font-weight:700;color:var(--accent);">+38%</p></div>
      </div>
      <aside class="notes">第二页详细讲稿</aside>
    </section>
  </main>

  <script>
    const slides = [...document.querySelectorAll("section.slide")];
    let idx = 0;
    const go = (n) => {
      idx = Math.max(0, Math.min(slides.length - 1, n));
      slides.forEach((s, i) => s.classList.toggle("active", i === idx));
      history.replaceState(null, "", `#${idx + 1}`);
    };
    const fromHash = () => {
      const m = Number(location.hash.slice(1));
      go(Number.isFinite(m) && m >= 1 ? m - 1 : 0);
    };
    slides.forEach((s, i) => s.addEventListener("click", () => {
      if (document.body.classList.contains("overview")) {
        document.body.classList.remove("overview");
        go(i);
      }
    }));
    window.addEventListener("hashchange", fromHash);
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") document.body.classList.toggle("overview");
      else if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); go(idx + 1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(idx - 1); }
      else if (e.key.toLowerCase() === "n") document.body.classList.toggle("show-notes");
    });
    fromHash();
  </script>
</body>
</html>
```

## 版式

- **复用 Bento Grid 网格规则**：严格按照 `bento-grid-layout.md` 的 12 列安全区网格（`1280 × 720` 画布四周留白、卡片间距 `≥ 20px`）编排单焦点、双栏对称（`6+6`）、双栏非对称（`8+4`）、三栏（`4+4+4`）或英雄数据卡片组合，避免千篇一律的纯项目符号列表。
- **认知与中文字号**：遵循 `cognitive-design-principles.md`（每页一个核心论断、要点 ≤ 5 条）及 `cjk-text-fit.md`（标题与卡片字号随字数收敛、中文强调仅用粗体禁用斜体、不加正字距）。

## 交付说明

- **可编辑性声明（`❌`）**：交付 HTML 文件时必须明确告知用户：该产物为浏览器交互式横向幻灯片（`❌` **不可在 PowerPoint / WPS 中作为幻灯片直接打开编辑**；可通过浏览器打印另存为 PDF 归档）。
- 若用户后续需要将内容发给同事在 WPS / PowerPoint 中改字改图，应按同一份大纲改走 **②A 可编辑 PPTX**（见 `pptxgenjs-guide.md`，`✅` 原生可编辑）。
