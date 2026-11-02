---
name: leo-xhs-router
description: Use when the user requests Xiaohongshu / 小红书 / RedNote operations, including account positioning, viral topic / hotspot finding, title generation, viral post writing, product selling point scoring, HTML / AI card design, quality audit, or automated browser publishing. Intelligently routes to specialized XHS skills (space-xhs-*, xhs-writer, xhs-html, leo-lantern), provides guided installation targeting ONLY XHS skills (strictly excluding GZH/video), manages output paths with smart persistence (~/.shrimp/skills/leo-xhs-router/config.json), and delivers publish-ready posts.
---

# Leo XHS Router（小红书自媒体智能路由与调度中枢）

## 📖 核心定位

`leo-xhs-router` 是面向**小红书（RedNote）全链路内容生产与运营的智能路由器与 JIT（即时能力）调度管家**。

它融合了以下核心设计架构：
1. **去中心化非侵入路由（零维护负担）**：
   - 不修改下游开源仓库（`creator-buddy` 与 `xhs-writer-skill`）的任何一行代码；
   - 保持下游仓库的独立性，随时可进行 `git pull` 同步最新特性，永远不存在合并冲突；
   - Router 充当“主编与项目经理”，负责需求理解、场景分流与标准把控。
2. **克制精准的依赖管理（仅限小红书模块）**：
   - 严禁整仓大包大揽！当缺少技能时，**只引导用户安装小红书（XHS）相关的专精技能**，坚决排除公众号（`gzh-Skills`）、视频（`video-Skills`）等无关内容，保持运行环境绝对纯净。
3. **输出目录记忆与智能持久化（Smart Workspace Persistence）**：
   - 参考 `/leo-ppt-router` 标准，配置统一保存在 `~/.shrimp/skills/leo-xhs-router/config.json`；
   - 默认输出目录为 `~/.shrimp/skills/leo-xhs-router/output/`；
   - 一旦用户指定了工作区（例如 `D:\素材\xhs`），Router 自动持久化记住该路径，后续会话默认复用，免除重复输入。
4. **全面吸收并平替废弃 `xhs-post-creator`**：
   - 将原 `xhs-post-creator` 中最硬核的**“纯读者视角违禁词品控禁令”**（严禁出现“AI生成”、“参考重绘”、“TODO”、“01/06页码”、“草稿水印”）沉淀为统一质检门禁；
   - 统一输出标准归档结构（`YYYY-MM-DD-主题/`、`内容.md`、`图片/发布版/`）；原 `xhs-post-creator` 即可安全停用废弃。
5. **底层视觉引擎完全解耦（参考 `leo-imagine-router`）**：
   - 抽象出可插拔的视觉生成插槽，支持在 `leo-codex-imagine`（AI扩散生图/图生图）、`xhs-html`（62套纯HTML杂志排版）、Pillow 确定性图卡之间自由无缝切换。
6. **无缝联动 `leo-lantern` 闭环自动发布**：
   - 笔记制作完成并通过质检后，可直接调用 `leo-lantern` 的通用原生 CDP 文件上传和表单注入能力，一键在浏览器中完成上传、填表，并在用户确认后点击发布。

---

## 🧭 工作流总览 (Workflow Pipeline)

```mermaid
flowchart TD
    User["用户输入 / 唤起 @leo-xhs-router"] --> Detect{"是否为模糊需求 / 寻求全局建议？"}
    
    Detect -- "是 (无参数/求指引)" --> Nav["主动呈现【小红书全链路方案导航菜单】"]
    Nav --> User
    
    Detect -- "否 (有明确任务)" --> Classify["意图识别与场景分类"]
    
    Classify --> Route{"路由至专精场景"}
    Route -- "起号 / 定位" --> S1["space-xhs-positioning"]
    Route -- "找热点 / 选题" --> S2["space-xhs-hotspot"]
    Route -- "起标题 / 优化" --> S3["space-xhs-title"]
    Route -- "写正文 / 7大体裁" --> S4["space-xhs-writer"]
    Route -- "开源项目/产品爆款" --> S5["xhs-writer (卖点打分+真实素材重绘)"]
    Route -- "杂志级 HTML 排版" --> S6["xhs-html (62套模板绝不崩字)"]
    Route -- "封面制作 / 视觉图卡" --> S7["space-xhs-cover / space-xhs-image"]
    Route -- "账号体检 / 数据复盘" --> S8["space-xhs-account-audit / note-analytics"]
    Route -- "浏览器自动发布" --> S9["leo-lantern (通用CDP自动化)"]
    
    S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 --> Probe{"检测目标 XHS 技能是否已安装？"}
    Probe -- "已安装" --> Exec["交由该 Skill 执行深度生产"]
    Probe -- "未安装" --> Guide["展示【定向安装卡片】(仅限XHS模块)<br>用户确认后一键安装或使用内置爆款规范兜底"]
    
    Exec & Guide --> PostProcess["统一质检交付流水线<br>1. 纯读者视角品控 (去草稿/去AI痕迹)<br>2. 规范化落盘 YYYY-MM-DD-主题/ (记忆工作区)<br>3. 生成 审核记录.md"]
    PostProcess --> S9
```

---

## 💡 方案导航（交互式需求引导卡片）

**触发条件**：
- 用户调用 `/leo-xhs-router` 未提供明确要求；
- 用户只说“我想做小红书”、“帮我做篇笔记”、“小红书怎么起号”等泛意图。

**导航卡片模板**：
```markdown
📕 **Leo XHS Router · 小红书创作全链路导航中心**

请告诉我您的需求，或直接回复对应序号进入专精流程：

① 🚀 **起号与人设定位**：赛道选择、博主定位金句、人设三件套、前20篇选题库、冷启动避坑
② 🔥 **热点发现与爆款对标**：同行高互动笔记监控、近期热点趋势提取、爆款选题角度拆解
③ 🎯 **爆款标题工坊**：15 种爆款标题公式批量生成、网感评分、合规与 A/B 测试建议
④ ✍️ **深度单篇图文创作**：
   - **A. 产品 / 开源项目 / 技能分享**：科学卖点打分（稀缺×实用×感知）+ 真实素材图生图 + 去AI味
   - **B. 通用干货 / 行业洞察**：7 种笔记体裁结构化撰写 + 痛点黄金前三句 + 14项发布体检
⑤ 🎨 **3:4 视觉图卡与排版**：
   - **A. HTML 杂志排版**：62 套预设模板、单文件 HTML 转图、排版绝对不乱码
   - **B. AI 扩散生图**：调用生图引擎（默认 leo-codex-imagine）出具素人感科技/生活配图
   - **C. 确定性封面**：大字报反差封面、安全边距排版
⑥ 🏥 **账号体检与数据复盘**：主页八维诊断、已发笔记六层漏斗归因（曝光/CTR/互动卡点定位）
⑦ 🚀 **浏览器自动化发布**：调用 leo-lantern 自动上传卡片、填好草稿并在确认后一键发布

💡 *您也可以直接输入素材、粘贴文章或指定路径，例如：「帮我把 D:\素材\xhs\... 优化并发布」*
```

---

## 🗂️ 场景路由矩阵 (Routing Table)

| 场景分类 | 细分特征 / 触发词 | 目标 Skill 标识符 | 所属源码仓库 | WPS/交付形式 |
| :--- | :--- | :--- | :--- | :--- |
| **起号定位** | 起号、定位、赛道、人设、冷启动 | `space-xhs-positioning` | `creator-buddy` | 定位方案报告 + 20篇大纲 |
| **热点挖掘** | 热点、爆款选题、对标分析、同行笔记 | `space-xhs-hotspot` | `creator-buddy` | 选题清单 + 爆款共性拆解 |
| **标题生成** | 起标题、爆款标题、改标题、标题评分 | `space-xhs-title` | `creator-buddy` | 5~15个候选标题 + 推荐标题 |
| **产品/项目单篇** | 开源项目、工具推广、卖点打分、截图图生图 | `xhs-writer` | `xhs-writer-skill` | 卖点打分表 + 卡片文案 + 配图建议 |
| **通用正文撰写** | 写正文、干货笔记、教程、避坑、生活分享 | `space-xhs-writer` | `creator-buddy` | 7大体裁标准文案 + 标签策略 |
| **HTML 杂志排版** | HTML排版、高颜值卡片、3:4代码转图 | `xhs-html` | `creator-buddy` | 3:4 单文件 HTML + 截图渲染 |
| **封面/AI图卡** | 做封面、小红书配图、科技感组图 | `space-xhs-cover` / `space-xhs-image` | `creator-buddy` | 1080x1440 高清卡片 |
| **账号诊断** | 账号体检、卡点诊断、主页装修 | `space-xhs-account-audit` | `creator-buddy` | 八维打分雷达图 + 诊断报告 |
| **数据复盘** | 笔记复盘、曝光低、互动差、六层漏斗 | `space-xhs-note-analytics` | `creator-buddy` | 漏斗归因分析 + 针对性修改方案 |
| **自动发布** | 自动发布、上传小红书、填草稿 | `leo-lantern` | `lib/skills/leo-lantern` | CDP 自动化页面注入与一键发布 |
| **通用兜底** | 目标子技能未安装且用户选直接出 | `built-in-fallback` | 内置爆款规范 | 直接输出标准 `内容.md` 与排版方案 |

---

## 📦 缺失技能精准引导安装（克制安装，仅限 XHS 模块）

当探测到目标专精技能未安装时，**严格遵循“仅安装小红书模块”的原则，绝不引入公众号（`gzh-Skills`）和视频（`video-Skills`）**：

### 引导卡片规范模板
```text
💡 **方案推荐**：当前需求最适合使用专精技能 **【<Skill 名>】**（<一句话特性>）。

当前环境尚未安装该小红书技能：
* **开源地址**：<GitHub URL>
* **定向安装方式（仅安装 XHS 模块，不引入无关平台）**：
  - 本地快速同步（如已配置源码目录）：
    node lib/skills/leo-xhs-router/scripts/cli.mjs install --skill <Skill 名>
  - 在线精准安装：
    <精准命令>

**是否需要我帮您安装？**
* 回复 **"安装"**：我将帮您把该小红书技能精准安装到用户环境并直接继续；
* 回复 **"安装全部XHS套件"**：一键安装全部 10 个小红书技能；
* 回复 **"直接出"**：使用 Router 内置的小红书通用方法论立即出稿。
```

---

## 📁 产物目录与智能工作区记忆 (Smart Persistence)

所有生成产物统一由 Router 的目录管理器调度（见 `scripts/config.mjs`）：

### 1. 三级级联决策
1. **用户本次显式指定**（如“输出到 `D:\素材\xhs`”）：
   - 本次直接落盘到该路径；
   - **自动写入** `~/.shrimp/skills/leo-xhs-router/config.json` 的 `workspace_dir`；
   - 提示用户已记住该目录，后续自动复用。
2. **已记录的历史目录**：
   - 读取 `config.json` 中的 `workspace_dir`，无需重复询问。
3. **默认兜底目录**：
   - 若未配置过，默认落在 `~/.shrimp/skills/leo-xhs-router/output/`。

### 2. 标准单帖目录结构（继承 xhs-post-creator 优点）
每个笔记建立独立的日期主题文件夹：
```text
<workspace_dir>/
└── YYYY-MM-DD-帖子主题/
    ├── 内容.md                  # 包含推荐标题、封面文案、可复制正文、话题标签
    ├── 审核记录.md              # 纯读者视角品控与体检报告
    └── 图片/
        └── 发布版/
            ├── 01-封面.png
            ├── 02-卡片1.png
            └── ...
```

---

## 🛡️ 纯读者视角品控门禁 (Quality Gate)

在产物交付给用户或调用 `leo-lantern` 发布前，**强制执行品控扫描（调用 `scripts/quality_guard.mjs`）**：

1. **违禁词严苛过滤**：
   - 创作者内部痕迹：`参考原文`、`参考重绘`、`制作说明`、`源文链接`；
   - 破坏真实感的AI标签：`AI生成`、`AI绘图`、`提示词`、`prompt`、`AIGC`；
   - 未完工标记：`待提供`、`待替换`、`待确认`、`TODO`、`XXX`；
   - 卡片角落生硬页码：`01/06`、`1/6`、`page 2`、`第 X 张`；
   - 草稿水印：`DEBUG`、`DRAFT`、`草稿`、`测试`。
2. **结构完整性**：
   - 必须包含《推荐标题》、《正文可复制版》、《话题标签（3~8个）》；
   - 图片放置在 `图片/发布版/`，以数字序号命名（01-封面.png, 02-卡片1.png）。
3. **自动生成 `审核记录.md`** 作为验收留底。

---

## 🚀 自动化发布联动 (`leo-lantern`)

当用户确认文案与配图无误并发出发布指令后：
1. Router 自动调用 `leo-lantern` 启动本地浏览器控制；
2. 导航至小红书创作者图文发布后台：`https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=image`；
3. 原生注入 `图片/发布版/` 下的所有图片（避开操作系统原生文件选择弹窗）；
4. 自动填入推荐标题，并将正文与 `#话题标签` 填入富文本编辑器；
5. 截取发布预览图提供给用户；
6. 获得用户最终确认后，触发点击“发布”按钮并验证跳转结果。

---

## 🛡️ 内置兜底方法论 (`built-in-fallback`)

当用户环境中未安装任何下游专精子技能且选择“直接出”时，Router 不会中断，而是自动启用内置方法论：
- **卖点提取**：执行 `稀缺性 × 实用性 × 可感知度` 过滤（见 `references/viral-methodology.md`）；
- **拟人化文案**：执行 `humanizer-zh` 口语化去 AI 味改写；
- **爆款标题**：按 5 大核心爆发力公式出 5 个候选标题；
- **视觉建议**：输出每张 3:4 卡片的具体排版大纲与配色建议。

---

## 🛠️ 管理与调试 CLI

在终端中可直接使用内置 CLI 管理配置与技能：
```bash
# 查看当前配置、工作区与小红书技能安装状态
node lib/skills/leo-xhs-router/scripts/cli.mjs status

# 配置默认工作区（免重复输入）
node lib/skills/leo-xhs-router/scripts/cli.mjs config --workspace "D:\素材\xhs"

# 从本地源码仓（D:\Java Project\AI-ZMT）一键安装小红书技能
node lib/skills/leo-xhs-router/scripts/cli.mjs install --all

# 初始化新帖子标准目录
node lib/skills/leo-xhs-router/scripts/cli.mjs init-post "GLM-5.2开源模型解析"

# 体检帖子目录中的违禁词与完整性
node lib/skills/leo-xhs-router/scripts/cli.mjs audit "D:\素材\xhs\2026-06-17-GLM-5.2开源模型解析"
```
