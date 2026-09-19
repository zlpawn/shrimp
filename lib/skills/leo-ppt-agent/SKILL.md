---
name: leo-ppt-agent
description: 基于多智能体流水线（调研员、策划师、设计师、质检员）与便当网格（Bento Grid）生成高品质、结构严密、可编辑的 PPT 幻灯片（SVG 1280x720 + 全屏 HTML 演示 + PPTX 导出）。当用户需要制作专业演示文稿、汇报幻灯片、生成 PPT、演讲课件、做产品介绍或分享技术架构时使用。
---

# Leo PPT Agent 智能体幻灯片制作技能

## 概述

`leo-ppt-agent` 是一个运行在网关上的工业级多智能体 PPT 制作系统。彻底告别市面上粗暴硬套模板的“AI PPT 玩具”，复刻专业 PPT 团队的专家级生产流水线：**需求调研 → 资料搜集 → 金字塔大纲 → 策划草稿 → 便当网格（Bento Grid）设计 → 双模型排版质检 → 终稿 PPTX 导出**。

全流程代码 100% 跨平台兼容 **Windows 与 macOS**，采用现代化极速工具链 **`uv`** 与 **Python** 进行高质量渲染与打包。

---

## 核心交付产物

每个运行批次（`openspec/changes/<run_id>/`）最终将自动产出：
1. **`output/presentation.pptx`**：标准 16:9 高清可编辑 PowerPoint 文档，支持 Office 2016+、WPS、Keynote 原生打开与二次修改；
2. **`output/index.html`**：交互式全屏幻灯片播放网页，支持键盘 `←` `→` 键翻页、演讲者模式、网格视图；
3. **`output/slide-{nn}.svg`**：各页 1280×720 矢量图源文件；
4. **`output/speaker-notes.md`**：自动提炼的演讲者逐页讲稿与预估演讲时长。

---

## 4 个 Subagent 专职分工

整个工作流由主 Agent 担任**总指挥（Lead Orchestrator）**，通过当前宿主环境的子任务机制依次调派 4 位虚拟专家：

| 子智能体 (Subagent) | 角色 | 专职工作内容 |
| :--- | :--- | :--- |
| **`research-core`** | 调研员 | 联网深度检索行业事实、竞品数据、用户受众特征与核心论据 |
| **`content-core`** | 策划师 | 严格按**金字塔原理**（结论先行、以上统下、归类分组、逻辑递进）编排每页 JSON 大纲 |
| **`slide-core`** | 设计师 | 应用 17 款预设风格与 **Bento Grid（便当网格）**，按 CJK 1.8x 防溢出公式绘制 SVG 页面 |
| **`review-core`** | 质检员 | 审查排版平衡、信息密度与对比度，提供微调建议并打分（<7分打回重修，最多2轮） |

---

## 7 阶段标准作业流程 (SOP)

### Phase 1: 初始化与风格选择
1. 解析用户参数：
   * `--style`：从 17 种内置风格中选择（默认 `business`）；
   * `--pages`：幻灯片目标页数范围（默认 `10-15`）；
   * `--brand-colors`：（可选）品牌主色覆盖 YAML。
2. 创建运行目录：`openspec/changes/ppt-<topic-slug>/`。
3. **风格选择速查**：
   * **商务学术类**：`business`（商务蓝橙）、`minimal`（极简白）、`notion`（Notion风）、`scientific`（学术严谨）；
   * **科技暗色类**：`tech`（深色科技蓝）、`blueprint`（工程蓝图）、`intuition-machine`（未来科技）；
   * **设计创意类**：`creative`（活泼多元）、`bold-editorial`（杂志大字报）、`vector-illustration`（扁平插画）。

### Phase 2: 需求调研 (🔴 Hard Stop 必须交互确认)
1. 派发 `research-core` 进行前置行业与背景调研，输出 `research-context.md`。
2. **强制交互**：向用户提出关键确认（受众对象是谁？演讲核心目标？核心主张？语气偏好？）。
3. 得到用户答复后，沉淀为 `requirements.md`。

### Phase 3: 素材并行检索
1. 根据需求拆解各章节核心要点。
2. 并行多路深入检索数据论据、案例事实，汇总为 `materials.md`。

### Phase 4: 大纲策划 (🔴 Hard Stop 必须交互确认)
1. 派发 `content-core` 运用金字塔原理构建每页内容结构，输出 `outline.json` 与便利贴预览 `outline-preview.md`。
2. **强制交互**：向用户展示数字便利贴大纲（标题、核心要点、版式类型）。
3. 用户审批通过后，方可进入视觉设计阶段。

### Phase 5: 策划草稿 (Wireframe)
1. 派发 `content-core` 输出低复杂度、无杂质的黑白版面结构占位草稿 `drafts/slide-{nn}.svg`。
2. 锁定每张卡片的信息槽位与排版层级。

### Phase 6: 视觉设计 + 审查修复回环
1. 派发 `slide-core` 载入所选风格的 Design Tokens（颜色、圆角、阴影、图表色序列），按 Bento Grid 规则生成正式版 `slides/slide-{nn}.svg`。
2. 严格执行 **CJK 1.8x 中文宽度折算** 与 **动态字号收缩公式**，杜绝文字溢出。
3. 派发 `review-core` 进行质量审查，输出打分与排版修正建议。
4. 若总分 < 7.0 分，由设计师根据建议进行局部修复（最多 2 轮）。

### Phase 7: 交付与全自动打包 (Delivery)
1. 将通过质检的最终 SVG 汇聚至 `output/`。
2. 渲染全屏演示网页 `output/index.html` 与演讲备忘录 `output/speaker-notes.md`。
3. **执行跨平台 PPTX 自动打包**：
   ```bash
   uv run scripts/export_pptx.py --input-dir "openspec/changes/<run_id>/output" --output "openspec/changes/<run_id>/output/presentation.pptx" --title "<Presentation Title>"
   ```
4. **跨平台调起浏览器预览**：
   ```bash
   python scripts/preview.py "openspec/changes/<run_id>/output/index.html"
   ```
5. 向用户输出交付报告：幻灯片总数、风格配色、各页质检评分及 `.pptx` 本地绝对路径。

---

## 脚本运行与依赖管理（uv 规范）

所有 Python 脚本均内嵌标准 PEP 723 元数据，**跨平台免配环境，自动装载依赖**：

```bash
# 1. 一键导出 PPTX 幻灯片（自动装载 python-pptx 与 resvg-py）
uv run scripts/export_pptx.py --input-dir <svg_dir> --output <target_pptx_path>

# 2. 跨平台打开演示页面（自动适配 Windows / macOS 默认浏览器）
python scripts/preview.py <path_to_index.html>
```

---

## 样式与提示词资产清单

* **大纲架构师**：`references/prompts/outline-architect.md`
* **便当网格规范**：`references/prompts/bento-grid-layout.md`
* **SVG 绘制器（含图片卡片规范）**：`references/prompts/svg-generator.md`
* **认知心理学原则**：`references/prompts/cognitive-design-principles.md`
* **17 套风格预设**：`references/styles/*.yaml`（详细配置见 `references/index.json`）
* **演示网页模板**：`references/assets/preview-template.html`
