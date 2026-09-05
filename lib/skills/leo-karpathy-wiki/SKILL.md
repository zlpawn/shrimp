---
name: leo-karpathy-wiki
description: "将多源知识（技术长文、网页抓取、Craft 笔记、PDF、音视频转写字幕）按照 Andrej Karpathy 'Stop retrieving, Start compiling' 的 LLM Wiki 范式，编译沉淀为具备双向链接 [[...]] 的自包含 Obsidian 本地知识库。用于构建原子知识卡片、主题索引地图与离线可用的第二大脑。"
---

# Leo Karpathy LLM Wiki 编译知识沉淀规范

本 Skill 旨在将散落于网关、网页、笔记工具（Craft）、长视频与文档中的零散信息，按照 **Andrej Karpathy** 倡导的 **"Stop retrieving. Start compiling."**（不要反复即时检索，而要将知识持续编译沉淀）的核心理念，转化为高质量、网状互联、离线自包含的 **Obsidian 本地知识库（Vault）**。

---

## 一、 核心哲学与三层分层架构

知识库必须满足**完全脱离网关或云端也能独立离线使用**的要求。目录结构划分为严格的三层：

```
My-Obsidian-Vault/
├── 00-Meta/                          # [Layer 3] 索引与审计层
│   ├── index.md                      # 全局知识大纲与主题地图 (MOC - Map of Content)
│   └── log.md                        # 编译与演进日志 (Append-only 审计流水)
├── raw/                              # [Layer 1] 原始材料不可变沉淀层 (脱网离线底本)
│   ├── assets/                       # 原始配图与多媒体 (本地相对路径，防盗链)
│   └── YYYY-MM-DD-来源标题.md        # 原始清洗后的 Markdown / HTML 原文
└── wiki/                             # [Layer 2] LLM 编译沉淀层 (原子概念卡片)
    ├── [[原子概念A]].md               # 高密度核心概念卡片 (带双向链接)
    └── [[原子概念B]].md
```

### 1. Layer 1：`raw/` 原始材料沉淀层（离线自包含底本）
* **定位**：不可篡改的事实原典（Source of Truth）。
* **规则**：
  - 无论源于网页抓取、本地 PDF 抽取、Craft 导入还是 Whisper 视频字幕，均以纯 Markdown 格式永久归档至 `raw/`；
  - 关联的所有图片和多媒体附件必须存入 `raw/assets/`，文章内的图片引用必须使用相对路径 `assets/xxx.png`；
  - **彻底脱离网关依赖**：用户单靠 Obsidian 打开整个目录，任何外链图片和原文均可离线查阅。

### 2. Layer 2：`wiki/` 概念编译层（原子双链知识网）
* **定位**：由 LLM 编译、重构、提炼出的原子概念节点。
* **规则**：
  - **一概念一卡片（Atomic Concept）**：拒绝把整篇文章原样当成 Wiki。必须拆解为核心理论、系统架构、算法原理或决策模型；
  - **第一性原理与密集双链**：正文中频繁使用 Obsidian 标准双向链接语法 `[[概念名称]]`，主动织入现有知识网；
  - **防孤岛原则**：每个新建的 Wiki 页面，必须至少与现有库中 2 个以上的概念产生引用链接；
  - **冲突与争议显式标注**：若新内容与既有 Wiki 概念存在冲突，严禁直接粗暴覆盖，必须单列 `### 争议与不同流派观点` 并标注各自出处。

### 3. Layer 3：`00-Meta/` 索引与日志层（全局导航与审计）
* `00-Meta/index.md`：全局动态主题导航（MOC），按领域分类聚合所有 `[[概念]]` 入口；
* `00-Meta/log.md`：追溯日志，单行记录每次摄入的事件（如 `2026-09-05: 摄入 Craft 笔记《谬误》 -> 编译生成 [[滑坡谬误]]、[[稻草人谬误]]，更新 [[论证偏差]]`）。

---

## 二、 编译提示词（LLM Compiler Prompt）

当网关或 Agent 执行编译时，必须使用如下系统提示词：

```markdown
You are an elite Knowledge Compiler and Research Librarian operating under the Andrej Karpathy LLM Wiki paradigm: "Stop retrieving. Start compiling."

Your goal is to process incoming raw material (articles, video transcripts, notes, papers) and COMPILE it into high-density, interconnected Obsidian markdown pages.

### Output Requirements:
1. Extract 2-5 load-bearing atomic concepts from the raw input.
2. For each concept, generate a structured markdown document:
   - YAML Frontmatter:
     ---
     title: "Exact Concept Name"
     source: "raw/<original_file.md>"
     tags: [domain, type]
     compiled_at: "YYYY-MM-DD"
     ---
   - Section 1: Core Definition & First Principles (核心定义与本质)
   - Section 2: Mechanics & Architecture (运行机理与推导链路)
   - Section 3: Trade-offs, Failure Modes & Edge Cases (权衡与边界)
   - Section 4: Cross-Connections (关联概念): list [[Related Concept 1]], [[Related Concept 2]]
3. Ensure all links use the Obsidian format `[[Target Page]]`.
4. Provide an updated entry for `index.md` and a 1-line log for `log.md`.
```

---

## 三、 标准 Frontmatter 与 Dataview 规范

每个 `wiki/*.md` 页面必须包含标准 YAML 元数据，方便 Obsidian Dataview 插件进行动态聚合统计：

```yaml
---
title: "滑坡谬误"
aliases: ["Slippery Slope Fallacy", "滑坡效应"]
category: "认知与逻辑"
tags: [逻辑学, 批判性思维, 决策模型]
source: "raw/2026-09-05-谬误.md"
compiled_by: "gateway-karpathy-compiler"
compiled_at: "2026-09-05"
status: "compiled"
---
```

---

## 四、 增量编译工作流（Incremental Compilation Flow）

```mermaid
sequenceDiagram
    participant User as 用户 / 网关
    participant Raw as raw/ 原始资产
    participant Model as 选定 LLM 模型 (GLM/Grok)
    participant Wiki as wiki/ 原子双链
    participant Meta as 00-Meta/ 索引与日志

    User->>Raw: 1. 原始文件与图片沉淀到 raw/ 与 raw/assets/
    User->>Model: 2. 注入 Karpathy 提示词 + 原始材料 + 当前 index.md 现有概念列表
    Model-->>User: 3. 输出提炼出的原子概念、正文、[[双向链接]] 与索引增量
    User->>Wiki: 4. 写入/更新 wiki/[[概念]].md
    User->>Meta: 5. 追加 00-Meta/index.md 与 00-Meta/log.md
```

1. **材料预存**：先把输入材料（网页、Craft 笔记、PDF 或视频字幕）转存至 `raw/` 目录，确保媒体文件相对路径化；
2. **上下文装配**：读取当前 Vault 已有的 `00-Meta/index.md`，把现有的所有概念列表作为上下文传给模型，告知模型“库里已有这些概念，请尽量在正文中用 `[[...]]` 引用它们”；
3. **概念抽取与写入**：调用模型生成原子概念卡片，写入 `wiki/`；
4. **确定性注册**：代码自动在 `00-Meta/index.md` 对应分类下追加新概念链接，并在 `00-Meta/log.md` 记下一笔更新记录。
