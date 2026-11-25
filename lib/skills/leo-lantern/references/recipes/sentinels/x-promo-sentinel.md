# X (Twitter) AI 羊毛与官方促销情报双轨巡检哨兵 (`recipes/sentinels/x-promo-sentinel.mjs`)

专为自动化定时巡检（Sidecar / Cron）设计的高价值情报垂直哨兵。内部聚合了经过实战检验的**双轨全量覆盖策略**与**存量档案自动去重引擎**，可在 10~20 秒内全量扫描 X 平台前沿大模型福利，并在无新情报时保持绝对静默，极大节省 Token 开销与消除上下文噪音。

## 目录分层定位

- **底层平台探针**：`recipes/x-source.mjs`（100% 纯净通用的 X 推文与媒体提取工具）
- **垂直业务哨兵**：`recipes/sentinels/x-promo-sentinel.mjs`（上层组合型业务哨兵，调用底层通用探针，内置双轨提示词、存量档案对比与静默判定）

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--archive` | `-a` | string | 否 | `/Users/user/素材/X/AI羊毛监控汇总.md` | 已有汇总档案路径，用于自动提取存量推文 ID 进行过滤去重。 |
| `--limit` | `-n` | number | 否 | `8` | 每条轨道抓取推文数量上限（双轨总计最多 2n 条）。 |
| `--out` | `-o` | string | 否 | `/Users/user/素材/X/ai-promo-latest` | 本次巡检过滤后的候选事实落盘目录。 |
| `--skip-media` | - | flag | 否 | `true` | 跳过多媒体下载以提升巡检速度（默认开启）。 |
| `--type` | `-t` | string | 否 | `latest` | 检索类型：`latest`（最新流）或 `top`（热门）。 |
| `--track1` | - | string | 否 | 内置中文双轨提示词 | 覆盖重写轨道一查询式。 |
| `--track2` | - | string | 否 | 内置全球一手提示词 | 覆盖重写轨道二查询式。 |
| `--json` | - | flag | 否 | `false` | 终端仅输出纯 JSON 格式元数据。 |

## 调用示例

```bash
# 执行标准双轨巡检（自动结合存量文档去重）：
node <skillDir>/recipes/sentinels/x-promo-sentinel.mjs --archive /Users/user/素材/X/AI羊毛监控汇总.md --limit 8
```
