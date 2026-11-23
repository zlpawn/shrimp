# 文档采集模式（`doc`）

当输入为外部或本地文档时启用：公众号/技术博客、Craft 文档、飞书/Lark 文档、网页、PDF、Word/PPT/Excel、含大量架构图或白板的资料。

## 1. 渠道读取路由（优先调用本环境真实可用工具）

优先获取**结构化正文 + 高清原始图片/附件**，必须穷举分页、游标、子块、折叠区、嵌入卡片与附件后再开始分析。

读取优先级：
`已安装专精技能或原生 MCP > 原始可下载文件/原图直链 > DOM/网络抓包提取 > 元素级截图 > 整页截图兜底`

| 来源渠道 | 当前环境首选工具 | 执行要点 |
|---|---|---|
| **公众号（`mp.weixin.qq.com`）/ 长文博客** | **`leo-article-relay`**（先读其 `SKILL.md`） | 一键突破防盗链，产出结构化 Markdown、离线 HTML 与全部高清原图；再用 `read_file` 逐张查看核心图片。 |
| **Craft 文档 / 分享空间** | **`leo-craft-api`**（或已启用 Craft MCP） | 拉取完整块级结构、跟进子文档/集合/白板元素，并以原图尺寸获取内嵌图片。 |
| **PDF / DOCX / PPTX / XLSX / EPUB / 扫描件** | **`leo-md-router`**（调度 `docling` / `markitdown`）+ **`read_file`** | 复杂版面、多栏、合并单元格表格、公式和扫描件优先用 `docling`；对核心页/图表用 `read_file` 做视觉复核，严禁只抽文字不看图。 |
| **飞书 / Lark / 需登录动态网页 / 白板** | **飞书 MCP（若已装）→ 否则 `leo-lantern`（真 Chrome CDP）或 `browser` subagent** | 读取完整正文而非摘要；展开懒加载、Tab、代码块与同步块；顺藤摸瓜进入嵌入白板/表格/Wiki，下载原图，拿不到再元素截图。 |
| **本地 Markdown / 代码片段 / 散装图片** | **原生 `read_file`** | 直接读取文本与多模态图片，并核查引用的本地附件。 |

若需要视频关键帧或字幕辅助，检查局部截图并如实标明检查范围，不伪装成全程逐帧观看。所有抓取方式与失败原因记录到 `<run-dir>/extraction/media-manifest.yaml` 与 `section-ledger.yaml`。

## 2. 提取与视觉检查

1. 将原始文本和下载的原图保存至 `<run-dir>/source/` 与 `<run-dir>/media/original/`。
2. 对所有章节划分 `load-bearing` / `supporting` / `contextual`，对所有图片划分 `load-bearing` / `supporting` / `decorative`。
3. 用 `read_file` 视觉查看每张可能承载核心信息的图片，写出 3–6 条解读，并与正文/表格交叉核验。
4. 记录所有关键指标的 8 项实验/运行条件（缺失则显式指出）。

## 3. 选择性验证（`none` | `light` | `targeted`）

- `none`：严格基于原文整理，外部主张统一标 `原文声明`。
- `light`（默认）：对关键开源实现、协议规范、公开论文做轻量一手核验；原文内部压测/生产数据保持 `原文声明`。
- `targeted`：按用户指定焦点，对照官方文档、规范或开源代码做深度比对验证。

## 4. 面向面试重构并出提案

按照 `references/core/teaching-and-interview.md` 重组为因果模型、页面设计方案、30s/2m/10m 讲述与追问防御，输出 `<run-dir>/proposal/knowledge-proposal.md` 并等待 Phase 1 审批。
