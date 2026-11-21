# LINUX DO 前沿快讯与社区硬核技术事实探针 (`recipes/linuxdo-source.mjs`)

基于用户真实 Chrome 登录态，无缝突破 LINUX DO 的 Cloudflare 5秒盾与论坛信任等级权限拦截。深度结合 Discourse 原生客户端数据流与 DOM 探针，提取 **100% 原始楼主 Markdown（含代码块、公式与表格）**、精确互动指标（阅读/点赞/回复）以及社区高赞解决方案楼层，并将贴内插图完整下载到本地。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--channel` | `-c` | string | 否 | `news` | 抓取板块：`news`（前沿快讯）、`hot`（热门话题）、`top`（全站精华/高赞）、`latest`（最新发布）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 站内搜索检索词（提供时自动走站内搜索流）。 |
| `--limit` | `-n` | number | 否 | `5` | 抓取帖子数量上限。 |
| `--out` | `-o` | string | 否 | 记忆路径 | 本地存储目录。**无硬编码路径**，指定后自动持久化到 `~/.shrimp/skills/leo-lantern/linuxdo-source-config.json` 供后续复用。 |
| `--set-out` | - | string | 否 | - | 单独持久化设置默认输出目录并退出。 |
| `--get-out` | - | flag | 否 | - | 查看当前配置的持久化输出目录。 |
| `--skip-media` | - | flag | 否 | `false` | 跳过插图下载，仅抓取纯事实文本与指标。 |

## 标准交付产物结构

每次采集自动生成独立会话目录：`<outputDir>/YYYY-MM-DD-<channel_or_query>/`：
- `📋 帖子事实.json`：100% 原始机器可读数据，直接投喂给下游 Router（`leo-xhs-router` / `leo-video-router`）。
- `📄 帖子事实.md`：图文并茂、结构规整的人类与 Agent 双用存证档案（包含楼主原文与高赞解答）。
- `📁 media/`：本地全量原图资产库。

## 调用示例

```bash
# 1. 抓取前沿快讯板块（默认模式，最适合科技/自媒体前沿资讯）：
node <skillDir>/recipes/linuxdo-source.mjs --channel news --limit 5

# 2. 抓取全站高赞精华帖（最适合挖掘高价值开源神器与避坑干货）：
node <skillDir>/recipes/linuxdo-source.mjs --channel top --limit 5

# 3. 站内关键词搜索：
node <skillDir>/recipes/linuxdo-source.mjs --query "Claude Code" --limit 5

# 4. 指定并记忆输出工作区目录：
node <skillDir>/recipes/linuxdo-source.mjs --out "D:\素材\linuxdo"
```
