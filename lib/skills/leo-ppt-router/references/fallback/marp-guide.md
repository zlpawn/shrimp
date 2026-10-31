# Marp 兜底出片指南

## 何时使用

- **②D Markdown / 代码驱动演讲稿**且 `slidev` 未安装、用户选择跳过安装时。
- 用户明确要求**极简纯文字快速出片**，希望源码本身就是易读易改的单个 Markdown（`deck.md`），无需维护前端工程目录。

## 最小模板

先按 `outline-architect.md` 规划好页面结构，再写入 `deck.md`。Frontmatter 固定开启 `marp: true`、`theme: default`、`paginate: true`、`size: 16:9`，使用 `---` 分页，使用 HTML 注释 `<!-- 讲稿 -->` 写入演讲者备注：

````markdown
---
marp: true
theme: default
paginate: true
size: 16:9
---

<style>
:root {
  --brand-accent: #2563eb;
}
section {
  font-family: "Microsoft YaHei", "PingFang SC", sans-serif;
  color: #1f2937;
  padding: 56px 72px;
}
h1, h2 {
  color: var(--brand-accent);
}
strong {
  color: var(--brand-accent);
}
</style>

<!-- _paginate: false -->

# 演示标题

副标题 · 汇报人 · 日期

<!-- 开场问候与核心背景说明 -->

---

## 核心结论先行

- **要点一**：一句话说清关键动作与量化结果
- **要点二**：支撑论据或对比基线
- **要点三**：风险边界与下一步动作

<!-- 本页展开讲解的详细讲稿 -->

---

## 关键代码 / 架构示意

```ts
export async function runPipeline(input: string) {
  return { ok: true, summary: input.trim() };
}
```

- 保持代码块 **≤ 12 行**，只保留说明观点的关键片段

<!-- 解释代码重点即可，不要逐行念代码 -->

---

# 谢谢 · Q&A
````

## 导出

在 `deck.md` 所在目录通过 `npx` 直接调用 `marp-cli` 导出所需格式（无需污染项目依赖）：

- **图片式 PPTX**（`❌` 不可编辑，每页实为渲染图片，仅适合固定排版放映）：
  ```bash
  npx @marp-team/marp-cli@latest deck.md --pptx
  ```
- **可编辑 PPTX**（`🟡` 实验功能，需系统 `PATH` 中已安装 **LibreOffice** `soffice`，导出后复杂 CSS / 渐变 / 自定义网格可能走样，需在 PowerPoint / WPS 中手修；若用户强依赖高保真原生可编辑 PPTX `✅`，应改走 `pptxgenjs-guide.md`）：
  ```bash
  npx @marp-team/marp-cli@latest deck.md --pptx --pptx-editable
  ```
- **HTML**（`❌` 不可在 WPS 作为幻灯片编辑，适合浏览器直接全屏演示）：
  ```bash
  npx @marp-team/marp-cli@latest deck.md --html
  ```
- **PDF**（`❌` 不可编辑，适合跨设备分发归档）：
  ```bash
  npx @marp-team/marp-cli@latest deck.md --pdf
  ```

## 规则

1. **一页一观点**：遵循 `cognitive-design-principles.md`，每页只传达一个核心论断，列表要点 **≤ 5 条**。
2. **中文字体与排版**：必须在文档顶部内置 `<style>` 块声明 `section { font-family: "Microsoft YaHei", sans-serif; }`（可并列 `"PingFang SC"` 兼顾 macOS），中文强调使用粗体 `**...**`，禁用斜体。
3. **③ Z1 公司品牌色**：当用户提供公司品牌色时，将其写入 `<style>` 块中的 `--brand-accent`（或直接作用于 `h1, h2` 标题色、引用边框色与 `strong` 强调色），切勿整页大面积高饱和铺底影响可读性。
4. **防溢出**：单页文字与代码块总高度需留白充足（参考 `cjk-text-fit.md`），代码块超过 12 行或列表超过 5 条时必须拆分为两页。
