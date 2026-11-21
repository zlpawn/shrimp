# 中国专利公布公告（CNIPA）检索与文献事实探针 (`recipes/cnipa-source.mjs`)

基于真实 Chrome 会话执行，在页面上下文内直接调用 `http://epub.cnipa.gov.cn/` 的检索、分页与详情接口（天然通过瑞数 WAF 动态校验与 `__RequestVerificationToken` 校验）。支持首页快捷检索、高级多字段组合检索、单专利详情（含法律状态/事务数据）、事务专项查询，并支持通过 `http://egaz.cnipa.gov.cn/showPage` 与 `/imgs/` **无验证码抓取说明书每页高清 PNG**。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--mode` | `-m` | string | 否 | 自动推断 | 采集模式：`search`（首页全字段检索）、`advanced`（高级组合检索）、`detail`（单专利详情与事务）、`sw`（事务/法律状态查询）。 |
| `--query` | `-q` | string | 条件必填 | `""` | 首页全字段快捷检索关键词（`search` 模式使用）。 |
| `--title` | `-t` | string | 否 | `""` | 发明/设计名称（`catalogInfo.Ti`）。 |
| `--abs` | - | string | 否 | `""` | 摘要/简要说明（`catalogInfo.Abs`）。 |
| `--applicant` | - | string | 否 | `""` | 申请（专利权）人（`catalogInfo.E71_73`）。 |
| `--inventor` | - | string | 否 | `""` | 发明（设计）人（`catalogInfo.E72`）。 |
| `--an` | - | string | 条件必填 | `""` | 申请号（支持 `detail`、`advanced`、`sw` 模式）。 |
| `--pn` | - | string | 条件必填 | `""` | 公布（公告）号，如 `CN123115842A`。 |
| `--url` | `-u` | string | 否 | `""` | 专利详情链接（`http://epub.cnipa.gov.cn/patent/CN...`）。 |
| `--ipc` | - | string | 否 | `""` | 分类号（`catalogInfo.E51`）。 |
| `--address` / `--agency` / `--agent` | - | string | 否 | `""` | 地址、专利代理机构、专利代理师。 |
| `--ad-begin` / `--ad-end` | - | string | 否 | `""` | 申请日起止日期（`YYYY.MM.DD` 或 `YYYY-MM-DD`）。 |
| `--pd-begin` / `--pd-end` | - | string | 否 | `""` | 公布（公告）日起止日期。 |
| `--ggr-begin` / `--ggr-end` | - | string | 否 | `""` | 专利文献出版日起止日期。 |
| `--types` | - | string | 否 | 全部四种 | 专利类型过滤：`fmgb,fmsq,xxsq,wgsq`（发明公布/发明授权/实用新型/外观设计）。 |
| `--pubtype` | - | string | 否 | `""` | 结果页类型切换：`1`发明公布/`2`发明公布更正/`3`发明授权/`6`实用新型/`9`外观设计等。 |
| `--sort` | - | string | 否 | `ggr_desc` | 排序方式：`ggr_desc`、`ggr_asc`、`sqr_desc`、`sqr_asc`。 |
| `--limit` | `-n` | number | 否 | `10` | 单次/每切片抓取条目上限。 |
| `--total-limit` | - | number | 否 | `0`（不限） | 时间切片模式下的总条目上限。 |
| `--page-size` | - | number | 否 | `10` | 分页单页条数（`3` 或 `10`）。 |
| `--delay-ms` | - | number | 否 | `3000` | 翻页/详情/切片间基础节流延迟（ms），自动附加 `1.0~1.6x` 随机抖动。 |
| `--slice-days` | - | number | 否 | `0`（关闭） | 按天数将起止日期切分批次抓取（如 `--slice-days 30`）。 |
| `--slice-month` | - | flag | 否 | `false` | 按自然月将起止日期切分批次抓取。 |
| `--dedup-file` / `--merge` | - | string | 否 | `""` | 增量去重并合并回写到指定 JSON 文件（或目录内 `专利事实.json`）。 |
| `--deep` / `--no-deep` | - | flag | 否 | `detail` 时为 true | 是否逐条请求 `/Sw/SwDetail` 提取完整事务状态与文献句柄（`data-ifs`/`data-pdf`）。 |
| `--with-thumb` | - | flag | 否 | `false`（`detail`/`--download-pages` 时自动开启） | 下载列表首图缩略图至 `media/`。 |
| `--download-pages` / `--no-download-pages` | - | flag | 否 | `detail` 时为 true | 无验证码下载说明书全文每页高清 PNG（含扉页/权利要求/说明书/附图）到 `media/pages/`。 |
| `--max-pages` | - | number | 否 | `0`（不限） | 每条专利最多下载的说明书页数。 |
| `--skip-media` | - | flag | 否 | `false` | 跳过所有媒体文件下载。 |
| `--sw-pubdate` / `--sw-info` / `--sw-type` | - | string | 否 | `""` | 事务查询日期、法律状态信息、法律状态类型（`sw` 模式）。 |
| `--out` / `--out-dir` | `-o` | string | 否 | `~/素材/patents` | 本地存储目录（自动持久化至 `~/.shrimp/skills/leo-lantern/cnipa-source-config.json`）。 |
| `--set-out` / `--get-out` | - | string/flag | 否 | - | 单独设置或查看持久化输出目录。 |

## 抗风控与输出机制

- **请求节流与最小请求原则**：翻页/详情/切片间默认带 `3000~4800ms` 随机抖动；单页满足 `--limit` 时不发多余 `PageQuery`；默认跳过缩略图请求（需时加 `--with-thumb`）。
- **400 熔断保底落盘**：一旦分页、切片或详情遭遇 `400/403/429/202` 拦截，立即熔断停止后续请求并将已抓数据安全落盘，同时在 JSON 中标记 `circuit_broken: true`。
- **时间切片与增量去重**：配合 `--slice-days` / `--slice-month` 与 `--dedup-file`，可将大跨度检索拆为多批并在多次执行间自动按 `pn`（公开号）去重累积。

## 标准交付产物结构

每次采集生成独立会话目录：`<outputDir>/YYYY-MM-DD_HHMMSS_<mode>_<target>/`：
- `专利事实.json`：结构化机器可读专利数据（含著录项目、完整摘要、IPC、代理机构、事务记录、文献版本句柄、熔断与去重统计）。
- `专利事实.md`：人类与 Agent 双用的可读专利检索报告。
- `media/`：开启 `--with-thumb` 时的首图缩略图，以及（开启 `--download-pages` 时）`media/pages/<公布号>/page_001.png...` 说明书全页图。

## 调用示例

```bash
# 1. 关键词快捷检索（前 10 条）：
node <skillDir>/recipes/cnipa-source.mjs --query "人工智能" --limit 10

# 2. 按自然月切片分批抓取并增量去重合并：
node <skillDir>/recipes/cnipa-source.mjs \
  --mode advanced --applicant "华为技术有限公司" \
  --pd-begin 2026-09-01 --pd-end 2026-11-15 --slice-month --limit 10 \
  --delay-ms 3500 --dedup-file "./huawei_patents.json"

# 3. 查询单件专利详情、事务数据并无验证码下载说明书每页 PNG：
node <skillDir>/recipes/cnipa-source.mjs --mode detail --pn CN123115842A --download-pages

# 4. 事务（法律状态）专项查询：
node <skillDir>/recipes/cnipa-source.mjs --mode sw --an 2024115380488 --deep
```
