# Google Patents 全球专利检索与文献事实探针 (`recipes/google-patents-source.mjs`)

基于真实 Chrome 会话打开 `https://patents.google.com/`，在页面同源上下文内直接调用站点 `/xhr/query` JSON 检索接口与 `/patent/<公开号>/<语言>` 详情页 SSR HTML。完整提取公开号、标题、摘要、全部权利要求（`claims.md`）、完整说明书（`description.md`）、申请人（当前/原始）、发明人、优先权日/申请日/公开日/授权日、申请号、法律状态、事件时间线、CPC 分类、引用/被引专利、同族国家状态，并支持将专利附图原图与 PDF 全文（若站点提供）下载至 `media/<公开号>/`。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | 自动推断 | 采集模式：`search`（检索列表 + 按需深采详情）、`detail`（指定公开号或详情链接深采）。 |
| `--query` | `-q` | string | 条件必填 | `[]` | 检索关键词（可多次传入，多个词之间为 AND 关系）。 |
| `--assignee` | - | string | 否 | `""` | 申请人 / 专利权人（如 `"Google"`、`"华为技术有限公司"`）。 |
| `--inventor` | - | string | 否 | `""` | 发明人姓名。 |
| `--cpc` | - | string | 否 | `[]` | CPC 分类号（逗号分隔或多次传入，如 `G06N3/08`）。 |
| `--country` | - | string | 否 | `[]` | 国家/地区代码（逗号分隔，如 `US,CN,EP,WO,JP,KR`）。 |
| `--date-type` | - | string | 否 | `priority` | 日期过滤基准：`priority`（优先权日）、`filing`（申请日）、`publication`（公开日）。 |
| `--after` / `--before` | - | string | 否 | `""` | 起止日期（`YYYY-MM-DD` / `YYYY.MM.DD` / `YYYYMMDD`）。 |
| `--status` | - | string | 否 | `""` | 法律状态过滤：`grant`（已授权）或 `application`（申请公布）。 |
| `--type` | - | string | 否 | `""` | 专利类型过滤：`patent`（发明/实用）或 `design`（外观设计）。 |
| `--language` | - | string | 否 | `""` | 文献语言过滤（如 `ENGLISH`、`CHINESE`、`JAPANESE`）。 |
| `--sort` | - | string | 否 | `relevance` | 排序方式：`relevance`（相关度）、`new`（最新）、`old`（最早）。 |
| `--pn` | - | string | 条件必填 | `[]` | 一个或多个专利公开号（逗号分隔，如 `US12482160B2,CN113254803B`），自动切为 `detail` 模式。 |
| `--url` | `-u` | string | 否 | `""` | 专利详情链接（`/patent/US12482160B2/en`）或检索页链接（`patents.google.com/?q=...`）。 |
| `--lang` | - | string | 否 | `en` | 详情页语言后缀（如 `en`、`zh`）。 |
| `--limit` | `-n` | number | 否 | `10` | 抓取专利数量上限（超出单页时自动翻页）。 |
| `--deep` / `--no-deep` | - | flag | 否 | `true` | 是否逐条抓取详情页（摘要、全部权利要求、完整说明书、CPC、引用/被引、法律事件）。 |
| `--download-figures` / `--no-download-figures` | - | flag | 否 | `detail` 时为 `true` | 下载专利附图原图（`patentimages.storage.googleapis.com`）至 `media/<公开号>/`。 |
| `--max-figures` | - | number | 否 | `0`（不限） | 每件专利最多下载的附图张数。 |
| `--download-pdf` / `--no-download-pdf` | - | flag | 否 | `detail` 时为 `true` | 下载专利 PDF 全文（若 Google Patents 提供 PDF 直链）至 `media/<公开号>/<公开号>.pdf`。 |
| `--skip-media` / `--no-media` | - | flag | 否 | `false` | 跳过所有附图与 PDF 下载。 |
| `--delay-ms` | - | number | 否 | `1500` | 翻页与详情请求间基础节流延迟（ms），自动附加 `1.0~1.6x` 随机抖动。 |
| `--dedup-file` / `--merge` | - | string | 否 | `""` | 按公开号增量去重并合并回写到指定 JSON 档案（同时更新同名 `.md`）。 |
| `--out` / `--out-dir` | `-o` | string | 否 | `~/素材/google-patents` | 本地存储目录（自动持久化至 `~/.shrimp/skills/leo-lantern/google-patents-source-config.json`）。 |
| `--set-out` / `--get-out` | - | string/flag | 否 | - | 单独设置或查看持久化输出目录。 |

## 标准交付产物结构

每次采集生成独立会话目录：`<outputDir>/YYYY-MM-DD_HHMMSS_<mode>_<target>/`：
- `专利事实.json`：结构化机器可读专利数据（含公开号、申请号、申请人、发明人、四类日期、法律状态、事件时间线、CPC 分类、引用/被引清单、同族国家状态与本地文件相对路径）。
- `专利事实.md`：人类与 Agent 双用的可读专利检索报告（含概览表、摘要、独立权利要求 1 及本地文件/附图索引）。
- `patents/<公开号>/claims.md`：该专利的全部权利要求逐条全文。
- `patents/<公开号>/description.md`：该专利的完整说明书全文。
- `media/<公开号>/`：附图原图（`fig_01.png`...）与 PDF 全文（`<公开号>.pdf`）。

## 调用示例

```bash
# 1. 关键词 + 申请人 + 国家 + 授权状态组合检索（自动抓取前 5 条及详情）：
node <skillDir>/recipes/google-patents-source.mjs \
  --query "neural network" --assignee "Google" \
  --country US --status grant --after 2022-01-01 --limit 5

# 2. 仅快速检索列表元数据（不逐条进详情页拉说明书）：
node <skillDir>/recipes/google-patents-source.mjs \
  --query "solid state battery" --country CN,US --sort new --no-deep --limit 20

# 3. 单件或多件专利公开号深度解析（自动下载权利要求、说明书、附图与 PDF）：
node <skillDir>/recipes/google-patents-source.mjs --pn US12482160B2 --max-figures 5

# 4. 直接传入 Google Patents 详情链接或检索页链接并增量合并到总表：
node <skillDir>/recipes/google-patents-source.mjs \
  --url "https://patents.google.com/patent/CN113254803B/en" \
  --dedup-file "./ai_patents.json"
```
