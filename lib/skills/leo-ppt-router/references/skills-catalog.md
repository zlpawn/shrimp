# 下游 PPT Skill 档案（skills-catalog）

本档案记录 `leo-ppt-router` 路由矩阵所指向的 5 个下游 PPT Skill 的能力边界、安装命令、运行依赖、WPS 可编辑性、品牌色 / 公司模板支持度、内置风格菜单与交接门禁。

`SKILL.md` 在以下两个时机按需读取本文件对应 `## <identifier>` 小节：
1. **动态过滤导航卡片 ③ 风格选项**：仅向用户展示当前目标 Skill 支持的风格（并始终保留 `Z1` 品牌色与 `Z2` 公司 PPT 模板）；
2. **生成未安装 Skill 的 JIT 安装卡片与执行交接**：提取准确安装命令、运行依赖、可编辑性说明及下游门禁注意事项。

---

## ppt-master

- **一句话**：AI 生成原生可编辑 PPTX，同时覆盖从零生成、品牌/模板工作区沉淀与已有原生 PPTX 扩页编辑。
- **来源**：`github.com/hugohe3/ppt-master`（v6.8.0，MIT）
- **安装命令**：`npx skills add hugohe3/ppt-master -g`（备选：`git clone https://github.com/hugohe3/ppt-master.git` 后取仓库内 `skills/ppt-master` 目录）
- **运行依赖**：Python 3.10–3.14 + 在其安装目录内执行 `pip install -r requirements.txt`
- **交付形态**：原生可编辑 `.pptx`（对应 ②A 可编辑 PPTX、②E 已有 PPTX 美化/改内容/套模板，以及 ③Z2 公司 PPT 模板强制路由）
- **WPS 可编辑**：✅ 原生形状、图表、表格均可在 WPS / PowerPoint 中直接编辑；部分动画与特殊形状调节手柄在 WPS 中可能有细微差异
- **品牌色 / 公司模板**：品牌色 ✅ Create Brand（支持色值、SVG/PNG logo、品牌手册沉淀为可复用品牌工作区）；公司 .pptx 模板 ✅ Edit Native PPTX 扩页填充（一次性使用：将模板作为页面库，复用首页/感谢页并以内容页为骨架复制扩页，保留母版、logo、页眉页脚，动手前先出页面映射计划待确认）或 Create Template `kind: deck`（长期常用可复用：提取品牌色/字/logo 与母版版式结构，再由 Generate PPTX 套用）
- **风格菜单**：
  - 版式设计模式：自由设计，或基于已创建的品牌 / 模板工作区出片
  - 图像配色方案（14 种）：`cool-corporate`、`dark-cinematic`、`duotone`、`earthy-dusty`、`editorial-classic`、`frost-ice`、`jewel-tone`、`macaron`、`mono-ink`、`nature-organic`、`sunset-gradient`、`tech-neon`、`vivid-launch`、`warm-earth`
- **交接注意事项**：首步必须运行自带完整性校验脚本 `attribution_guard.py`，返回非零即停，**严禁修改、删除或绕过**；其内部三路由（`Generate PPTX` / `Create Template` / `Edit Native PPTX`）由它自己判定（若用户在 router 中已选择 ③Z2 的「一次性 / 常用」模式，交接时附带模板 `.pptx` 绝对路径与所选模式即可，后续页面映射确认仍遵从其自身流程）。

## dashi-ppt

- **一句话**：内置 12 套主题的 HTML 演示文稿生成器，支持按需导出 PPTX / PDF。
- **来源**：`github.com/chuspeeism/dashi-ppt-skill`（v0.4.14）
- **安装命令**：`npx dashi-ppt-skill@latest`（国内镜像：`npx --registry=https://registry.npmmirror.com dashi-ppt-skill@latest`；默认安装到 `~/.agents/skills`）
- **运行依赖**：Node.js；导出 PPTX / PDF 需启动本机预览服务 + Playwright（Chromium）
- **交付形态**：HTML 网页演示文稿（②B 商务、科技、数据类主题），或按需导出 `.pptx`（②A 用户点名选用 dashi 的 12 套主题视觉时）
- **WPS 可编辑**：🟡 导出 PPTX 时通过 DOM 提取文字与色块生成可编辑对象，但复杂视觉特效或映射失败区域会退化为截图（官方 `editableFidelity` 约 `0.851`）
- **品牌色 / 公司模板**：品牌色 ❌ 仅提供 12 套固定主题，无自定义品牌色入口（选 ③Z1 时不路由到 dashi）；公司 .pptx 模板 ❌ 不支持
- **风格菜单**：12 套固定主题：
  - `theme01` 轻拟态风（产品介绍 / 企业汇报）
  - `theme02` 炫光紫绿风（科技发布会）
  - `theme03` 深浅代码风（技术方案）
  - `theme04` 玻璃糖果风（年轻化品牌）
  - `theme05` 色谱图表风（数据报告）
  - `theme06` 深色图谱风（战略分析）
  - `theme07` 冷白调研风（调研报告 / 白皮书）
  - `theme08` 黑金实验风（高端发布）
  - `theme09` 深蓝杂志风（品牌故事）
  - `theme10` 金色指数风（金融指数，仅用户点名或纯金融指数场景选用）
  - `theme11` 高能增长风
  - `theme12` 声波霓虹风
- **交接注意事项**：它内部强制先展示风格预览图并向用户确认主题编号及是否使用图片 / 视频素材；router 已收集的答案随交接一并传入，其余步骤遵从其门禁；**只有用户明确要求交付 PPTX 时才执行导出**，纯 HTML 需求不启动 PPTX 导出。

## guizang-ppt-skill

- **一句话**：强审美驱动的单文件 HTML 横向翻页演示文稿（作者：歸藏）。
- **来源**：`github.com/op7418/guizang-ppt-skill`
- **安装命令**：`npx skills add https://github.com/op7418/guizang-ppt-skill --skill guizang-ppt-skill -g`
- **运行依赖**：浏览器即可直接打开播放（无额外运行时依赖）
- **交付形态**：单文件 HTML 横向翻页网页（②B 人文分享、行业观察演讲、发布会、强个人风格）
- **WPS 可编辑**：❌ 官方不支持导出 PPTX，仅交付单文件 HTML
- **品牌色 / 公司模板**：品牌色 🟡 通过脚本受约束生成品牌主题（不直接使用原始色值，交接与交付时须提示用户颜色可能有偏差）；公司 .pptx 模板 ❌ 不支持
- **风格菜单**：2 套核心视觉体系：
  - **A · 电子杂志 × 电子墨水**：衬线字体排版 + WebGL 流体着色器，适合人文分享、行业观察、深度阅读式发布与教学人文课件
  - **B · 瑞士国际主义**：无衬线字体 + 严谨网格与点阵系统，搭配高饱和标志色（IKB 克莱因蓝 / 柠檬黄 / 柠檬绿 / 安全橙），适合科技发布、数据洞察、学术极简表达与年度总结
- **交接注意事项**：Skill 说明中的作者来源与赞助信息仅供文档参考，**不得写入最终生成的 HTML 演示文稿产物**。

## codex-ppt

- **一句话**：基于生图模型的整页图片式高视觉表现力 PPTX 生成器。
- **来源**：`github.com/ningzimu/codex-ppt-skill`
- **安装命令**：`npx -y skills@latest add ningzimu/codex-ppt-skill --skill codex-ppt -g`
- **运行依赖**：Python 3 + 生图后端（宿主内置生图工具，或配置 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `CODEX_PPT_IMAGE_MODEL`）
- **交付形态**：整页图片封装的 `.pptx`（②C 视觉冲击优先、不需要后续改字）
- **WPS 可编辑**：❌ 每页均为整图封装，无法在 WPS / PowerPoint 中直接编辑文字或独立图形
- **品牌色 / 公司模板**：品牌色 🟡 可在提示词中指定色值（AI 生图不保证精确色值，须提示用户）；公司 .pptx 模板 🟡 仅可作为视觉风格参考图，无法保留原生母版结构（需严格套用公司模板请走 ③Z2 路由至 `ppt-master`）
- **风格菜单**：12 种预设视觉风格：
  - `党政红风格`
  - `创意杂志风`
  - `复古扁平插画风`
  - `手绘技术解释风`
  - `手绘白板风`
  - `教学课件风`
  - `数据仪表盘风`
  - `清爽专业风`
  - `温暖手工风`
  - `电子墨水杂志风`
  - `科研答辩风`
  - `麦肯锡风格`
- **交接注意事项**：自带样张审批门禁（先生成样张确认风格后再批量出全套图），交接后须遵从；若用户后续需要转成可编辑元素，可提示关注同作者规划中的 `image-to-editable-ppt-skill`（规划中，当前未接入）。

## slidev

- **一句话**：开发者向 Markdown 幻灯片官方 Skill，支持代码高亮、逐步演进动画与交互图表。
- **来源**：`github.com/slidevjs/slidev`（官方 skill）
- **安装命令**：`npx skills add slidevjs/slidev -g`
- **运行依赖**：Node.js + `pnpm`；导出 PDF / PPTX 需 `playwright-chromium`
- **交付形态**：Slidev Markdown 幻灯片（`slides.md`，对应 ②D 开发者风格，支持浏览器演示及导出 PPTX / PDF）
- **WPS 可编辑**：✅ 仅当使用 `slidev export --format pptx-editable` 导出时可在 WPS / PowerPoint 中编辑（默认 `--format pptx` 导出每页为整图截图，属于 ❌ 不可编辑）
- **品牌色 / 公司模板**：品牌色 ✅ 可通过 Slidev 主题 CSS 变量精确设置；公司 .pptx 模板 ❌ 不支持
- **风格菜单**：
  - Slidev 主题：`default`、`seriph` 等官方与社区主题
  - 技术演示特性：Shiki 代码高亮、Magic Move 跨页代码动画、Mermaid 流程图/时序图、LaTeX 数学公式、Vue 组件嵌入
- **交接注意事项**：当用户需要产物可在 WPS / PowerPoint 中编辑时，导出命令**必须指定 `slidev export --format pptx-editable`**，不得使用默认的 `--format pptx`。

---

## 非路由目标（仅供参考）

以下工具或项目**不作为独立下游 Skill 纳入路由探测**，仅用于交付后精修提示或内置兜底出片：

- **PPTist**（`https://pipipi-pikachu.github.io/PPTist/`）：Web 在线演示文稿 GUI 编辑器（AGPL-3.0，无 CLI / API），不集成到自动出片链路，仅在交付 `.pptx` 后作为"导入在线手动精修"提示提供给用户。
- **PptxGenJS**：Node.js 原生可编辑 PPTX 生成库，作为 ②A / ②C / ②E 未安装下游 Skill 且用户拒绝安装时的内置兜底工具（见 `fallback/pptxgenjs-guide.md`）。
- **Marp CLI**（`@marp-team/marp-cli`）：Markdown 幻灯片转换 CLI，作为 ②D Markdown 形态的内置兜底工具（见 `fallback/marp-guide.md`）。
- **python-pptx 模板扩页**：通过 `uv run --with python-pptx` 基于公司 3 页 `.pptx` 模板扩页填充文本的内置兜底方案（见 `fallback/template-fill-guide.md`，版式表现力明显弱于 `ppt-master`）。
