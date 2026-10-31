# PptxGenJS 兜底出片指南

## 何时使用

- **②A 可编辑 PPTX**（`✅` 原生可编辑）：首选的专业 PPTX 技能（如 `ppt-master`、`minimax-pptx` 等）未安装且用户选择跳过安装时，使用 `PptxGenJS` 直接生成文字、形状、原生图表均可在 PowerPoint / WPS / Keynote 中二次编辑的 `.pptx`。
- **②E 重新生成**（`✅` 原生可编辑）：对已有大纲或旧稿提取结构后重新生成干净的 `.pptx`。
- **②C 拼装整页图片**（`❌` 画面内文字不可在 PPT 中直接编辑）：先调用生图技能逐页生成 16:9 视觉海报，再用 `PptxGenJS` 铺满每页拼装成单个 `.pptx`。
- **③ Z1 公司品牌色注入**：当用户指定公司品牌主色（如 `#E60012`）时，将骨架中的 `C.accent` 替换为**无 `#` 前缀**的 6 位十六进制色值（如 `"E60012"`）。

## 准备

在**独立的产物输出目录**（或临时工作目录）中初始化并安装依赖，**严禁安装进当前项目/仓库根目录**：

```bash
npm init -y && npm i pptxgenjs
```

生成前应先按 `outline-architect.md` 完成金字塔大纲规划，并参考 `cognitive-design-principles.md` 控制单页信息负载。

## 代码骨架

将以下骨架保存为产物目录下的 `build-deck.mjs`，由 agent 按确认后的大纲改写 `deck` 数据（以及按需微调配色 `C`）后执行 `node build-deck.mjs`：

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

如需双栏对比、三卡片并列等更丰富版式，可按 `bento-grid-layout.md` 的网格比例将 `13.33 × 7.5 in` 画布拆分为多个 `roundRect` + `addText` 卡片函数扩展进 `render`。

## 规则

1. **字号下限**：正文字号不得低于 **14pt**（推荐正文 18–22pt、页标题 28–32pt、封面标题 40–48pt）。
2. **中文字体**：设计规范遵循中文字体链 `"Microsoft YaHei", "PingFang SC", sans-serif`；PptxGenJS 的 `fontFace` 仅接受单个字体名，Windows 默认填 `"Microsoft YaHei"`，macOS 环境可切换为 `"PingFang SC"`，且中文强调一律使用 `bold: true`，禁用斜体。
3. **信息密度**：每页要点 **≤ 5 条**，标题采用“核心结论先行”句式而非空泛名词。
4. **防溢出估算**：按 `cjk-text-fit.md` 估算中文字宽与行数（按 `1 in = 96 px` 将英寸宽度换算为像素后套用 `card_width / (font_size * 1.1)`），超出容器容量时主动精简文案或拆页。
5. **保持原生可编辑（`✅`）**：②A / ②E 场景下所有文字必须通过 `addText` 写入，图表优先通过 `addChart` 写入，**禁止把文字渲染成图片塞入幻灯片**。
6. **色值格式**：PptxGenJS 所有颜色参数均为**不带 `#`** 的 6 位十六进制字符串（如 `"2563EB"`）。

## ②C 图片拼装

当走 **②C 视觉海报路线**（已由生图技能生成一组 16:9 整页图片，如 `slides/01.png`、`slides/02.png`）时，用 `addImage` 将每张图片 100% 铺满幻灯片，并可附带演讲备注：

```js
for (const imgPath of imagePaths) {
  const slide = pptx.addSlide();
  slide.addImage({ path: imgPath, x: 0, y: 0, w: "100%", h: "100%" });
}
```

> 交付 ②C 拼装产物时，必须向用户标明该 PPTX 为整页图片封装（`❌` 画面内文字不可在 PowerPoint / WPS 中直接修改，修改需重新生图或叠加文本框）。
