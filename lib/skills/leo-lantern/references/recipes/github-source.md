# GitHub 开发者情报、开源项目技术事实与趋势雷达探针 (`recipes/github-source.mjs`)

基于用户真实 Chrome 会话与网页 DOM 解析，严格遵循 **100% 事实保真（Ground Truth）** 原则。复用 Chrome 真实已登录用户会话（如 zlpawn），彻底规避 GitHub API 匿名 60 次/小时频控与封锁。完整提取开源项目全名、所有者、核心描述、官网主页、Star/Fork/Watcher/Issue 核心指标、**技术栈语言构成（百分比）**、**开源授权协议（License）**、标签（Topics）、最新 Release 版本与日期，并将原生 `README.md` 与社交预览卡片图（`og:image`）下载至本地，为下游技术调研（research agent）、技术笔记（leo-video-router/Craft 同步）与小红书开源工具推荐（leo-xhs-router）沉淀一手高保真事实。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | `repo` / `trending` | 采集模式：`repo`（单仓库深度解析）、`trending`（趋势热门榜）、`search`（站内关键词检索）。提供 URL 或简写名默认 `repo`，无参数默认 `trending`。 |
| `--url` | `-u` | string | 条件必填 | `""` | 目标仓库链接（如 `https://github.com/torvalds/linux`）。 |
| `--repo` | `-r` | string | 条件必填 | `""` | 简写仓库名（如 `torvalds/linux`, `zlpawn/shrimp`）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 检索关键词（`mode` 为 `search` 时使用，如 `"agentic ai"`, `"claude mcp"`）。 |
| `--language` | `-l` | string | 否 | `""` | 编程语言过滤（用于 `trending` 与 `search`，如 `python`, `typescript`, `rust`, `go`）。 |
| `--since` | - | string | 否 | `daily` | 时间跨度（用于 `trending`，可选 `daily`, `weekly`, `monthly`）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取仓库数量上限。 |
| `--out`, `--out-dir` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/github-source-config.json`（默认 `D:\素材\GitHub`）供后续复用。 |
| `--no-deep` | - | flag | 否 | `false` | 浅层提取模式：仅提取列表指标与摘要，不逐个深入抓取完整 `README.md`。 |
| `--skip-media`, `--no-media` | - | flag | 否 | `false` | 极速轻量模式：跳过社交预览卡片下载，仅保存文字事实与 `README.md`。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |

## 多媒体与原生文档机制

- **原生 `README.md` 全量落盘**：单仓模式直接保存至会话根目录，多仓/趋势模式归档至 `repos/<owner_repo>/README.md`，杜绝大模型过度概括导致的信息失真。
- **技术栈语言精确构成**：提取各语言占比（如 `TypeScript 98.6% · MDX 1.1%`）。
- **真实会话防风控**：完全依托真实浏览器会话，无惧 GitHub 匿名 API Rate Limit。

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-HHmmss_<slug>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据（含仓库名称、描述、指标、协议、语言构成、README 索引）。
- `📄 帖子事实.md`：图文并茂的人类与 Agent 双用开源技术雷达档案。
- `📄 README.md` 或 `📁 repos/<owner_repo>/README.md`：原始项目文档全量存证。
- `📁 media/`：社交预览图（`cover.png`）资产库。

## 调用示例

```bash
# 1. 深度解析单篇开源项目并下载原生 README 与卡片图（默认模式）：
node <skillDir>/recipes/github-source.mjs --url "https://github.com/zlpawn/shrimp"

# 2. 抓取今日全语言 GitHub Trending 热门榜前 5 名项目及完整文档：
node <skillDir>/recipes/github-source.mjs --mode trending --limit 5

# 3. 抓取本周 Python 分类下最热 Trending 项目：
node <skillDir>/recipes/github-source.mjs --mode trending --language python --since weekly --limit 3

# 4. 关键词搜索前沿 Agent 开源项目并沉淀技术事实：
node <skillDir>/recipes/github-source.mjs --mode search --query "agentic ai" --limit 3

# 5. 指定并记忆输出工作区目录：
node <skillDir>/recipes/github-source.mjs --out "D:\素材\GitHub"
```
