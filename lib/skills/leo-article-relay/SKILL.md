---
name: leo-article-relay
description: "全能文章高保真脱机归档、知识库持久化与多端（Craft/Obsidian）高保真中继同步引擎。突破腾讯防盗链与反爬验证，全量并发下载高清原图与原生内联 CSS，生成 100% 离线脱网可读的 HTML 原文与清洗后的结构化 Markdown。新增飞书文档（Docx/Wiki）只读中继通道，支持前置依赖自动探测、父子文档交互确认、本地素材下载与 Craft 官方图床直传（策略 A）。Use when user asks to '下载公众号文章', '抓取微信文章', '微信文章转HTML', '保存公众号文章', '同步文章到Craft', '飞书同步到Craft', '飞书文档转Craft', 'lark to craft', '同步飞书文档', '同步到知识库', 'article relay', '剪藏文章', '中继同步', provides article URLs (mp.weixin.qq.com, feishu.cn, etc.), or wants to relay articles into Obsidian/Craft."
metadata:
  version: "1.3.0"
  author: "Leo"
---

# Leo Article Relay (全能文章高保真归档与知识中继引擎)

专为长文、公众号、技术博客与飞书云文档深度打造的知识摄取与多端中继 Skill。
支持 **微信公众号** 与 **飞书文档（Docx/Wiki）** 双渠道，提供 **「像素级脱网 HTML」**、**「结构化 Markdown」** 与 **「Craft 官方图床直传中继」** 多端交付。

---

## 核心设计规范（无固定写死路径原则）

1. **便携性与动态路径**：全代码与文档中**禁止硬编码系统专属绝对路径**。
2. **输出目录解析**：支持 `-o, --output <dir>` 指定任意输出目录；未显式指定时，默认使用当前工作目录下的相对路径（如 `./lark-articles`、`./wechat-articles`）或用户中枢 `~/.shrimp/skills/leo-article-relay/`。
3. **跨模块协同**：依赖的 `leo-craft-api` 客户端通过模块解析链（同级技能目录 ➔ `~/.agents/skills/` ➔ `~/.gemini/config/skills/` ➔ `~/.shrimp/skills/`）动态加载。

---

## 渠道一：飞书云文档 (Docx / Wiki) 转存 Craft 工作流

专为将飞书云文档（单个 Docx 或 Wiki 知识库树）高保真同步到 Craft 打造，严格遵循以下四大原则：

### 1. 核心架构原则
- **严格只读（100% Read-Only）**：仅调用飞书读命令（`docs +fetch`、`docs +media-download`、`wiki ... list`），绝不调用任何写命令，不产生任何版本变更或副作用。
- **外部委托解耦（Zero-Embedded）**：不内嵌 Lark SDK，所有飞书文档获取委托给本地环境的 `lark-cli` 与 `lark-doc` 技能。
- **策略 A 官方图床直传**：
  1. 飞书素材/图片下载到本地临时目录；
  2. 调用 `leo-craft-api` 的 `/upload` 二进制上传至 Craft 官方存储，拿到返回的 Craft 官方 CDN `assetUrl`；
  3. 将 Markdown 图片引用替换为 `![图片](assetUrl)`，确保脱机原生渲染且图文位置 100% 一致。
- **智能切片防截断 (Chunking)**：按 `##` / `###` 章节边界自动切割长文为 `<= 12KB` 安全切片，避免 CLI 溢出与超时。

---

### 2. Agent 交互与执行 SOP

#### Step 1: 环境依赖前置探测
在执行任何飞书文档操作前，Agent 运行检查命令：
```bash
node <skillDir>/scripts/lark-to-craft.mjs --check-env
```
- **若缺少 `lark-cli`**：暂停并提示用户：“本地未安装 lark-cli，是否需要协助安装？（支持 npm install -g @larksuite/cli）”；
- **若缺少鉴权/未登录**：暂停并提示用户：“lark-cli 用户凭证未就绪，请在终端执行 `lark-cli auth login` 完成飞书登录”。

#### Step 2: 父子文档结构探测与范围确认
运行探测命令：
```bash
node <skillDir>/scripts/lark-to-craft.mjs "<urlOrToken>" --inspect
```
- **如果是普通单文档（`isParent: false`）**：直接进入 Step 3 开始同步；
- **如果是包含子文档的父文档/Wiki 节点（`isParent: true`）**：
  Agent 向用户展示文档目录清单并询问：
  > 📋 **检测到这是一个包含子文档的父文档/知识库节点（共 N 篇）：**
  > - 📄 **[父]** 架构总览
  >   - ├── 📄 **[子-1]** 核心网关设计规范
  >   - └── 📁 **[子-2]** 部署指南
  >
  > **请问希望如何同步到 Craft？**
  > 1. 仅同步当前父文档
  > 2. 全部同步（包含所有子文档）
  > 3. 指定同步部分文档（提供编号或标题）

#### Step 3: 执行中继同步
根据用户确认的文档 URL/Token，执行同步：
```bash
# 同步单文档到 Craft
node <skillDir>/scripts/lark-to-craft.mjs "<urlOrToken>"

# 指定输出缓存目录与 Craft 目标文件夹
node <skillDir>/scripts/lark-to-craft.mjs "<urlOrToken>" -o ./my-lark-articles --folder <craftFolderId>

# 仅下载素材与清洗排版，不实际写入 Craft（试跑模式）
node <skillDir>/scripts/lark-to-craft.mjs "<urlOrToken>" --dry-run
```

---

### 3. 飞书富文本到 Craft 的映射规则

| 飞书格式 | Craft 表现 | 备注 |
| :--- | :--- | :--- |
| **标题 / 段落 / 加粗 / 行内代码 / 引用** | 标准 Markdown 1:1 还原 | 100% 原生呈现 |
| **代码块** | 标准 Markdown 代码围栏 | 自动将 `"""` 规避转换为 `'''`，杜绝 CLI 截断 |
| **高亮块 (`<callout>`)** | 原生 `<callout>` 标签 | Craft 原生支持，样式完美映射 |
| **折叠块 (Toggle)** | `+ Toggle title` | 保持层级折叠 |
| **图片与多媒体素材** | 原生 Image Block | 经 `leo-craft-api` 转存为 Craft 官方图床链接渲染 |
| **飞书画板 (Whiteboard)** | 原生高清单图 Block | 自动拉取缩略原图转存，一目了然 |
| **多维表格 (Bitable) / Sheet** | GFM 静态表格 | 提取结构，并附带飞书原表直达超链接 |

---

## 渠道二：微信公众号文章归档与中继

脚本位于：`<skillDir>/scripts/wechat-dl.mjs`

### 核心交付物（专有目录 `YYYY-MM-DD-文章标题-公众号名`）
1. **🌐 `article.html`**：100% 像素级离线原版 HTML（全量内联 20+ 个微信 CSS，脱网无损排版）。
2. **📄 `index.md`**：结构化 Markdown（含 Frontmatter、GFM 表格、代码高亮）。
3. **🖼️ `images/`**：本地全量高清原图库（突破微信防盗链并发下载）。

### 常用命令
```bash
# 抓取单篇或多篇
node <skillDir>/scripts/wechat-dl.mjs "<url1>" ["<url2>"] -o ./wechat-articles

# 从清单批量抓取
node <skillDir>/scripts/wechat-dl.mjs -f links.txt -o ./wechat-articles

# 准备 Craft 切片并上传（配合 craft_write MCP）
node <skillDir>/scripts/prepare-craft-chunks.mjs "<articleDir>"
```

---

## 知识库目录配置命令

```bash
# 查看当前配置的知识库路径
node <skillDir>/scripts/wechat-dl.mjs --get-vault

# 手动设置/修改知识库路径
node <skillDir>/scripts/wechat-dl.mjs --set-vault "~/Documents/Obsidian Vault/Articles"
```
