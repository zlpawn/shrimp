# 配套供数指引（SkillHub 投研技能 ↔ leo-tdx 命令映射）

当已安装以下通达信 SkillHub 下游技能时，按本表将技能中的抽象数据需求映射到 `leo-tdx` 实体命令，避免重复查询 `schema`。

## 1. 下游技能与核心供数映射

| 下游技能（ID） | 需要的数据维度 | 推荐 `leo-tdx` 调用方式 |
|---|---|---|
| 通用前置 | 证券代码确认 | `leo-tdx lookup <名称>`（港股加 `--market HK`） |
| **个股深度分析** (`tdx-stock-analysis`) | 行情/估值快照、概况、三表、一致预期、新闻公告、同业排名、资金、股东 | `quotes`、`deep "..." --type A`、`api`（利润/负债/现金流/股东）、`notice`、`report`、`news` |
| **财报速读** (`tdx-financial-quick-read`) | 多期财务三表（8–12 期）、同业对标、估值快照 | `api TdxShareCW.ph_agf10_cw_lyb/zcfzb/xjllb`、`api TdxShareCW.ph_agf10_hypm`、`quotes` |
| **公司质地打分** (`tdx-gszddf`) | 主营构成、三表、行业地位、股东与分红回购、PE/PB 历史分位 | `deep`、`api`（`jyfx`、`gdyj`、`fhrz`、`gzfx`）、`quotes` |
| **估值导航员** (`tdx-valuation-navigator`) | 当前估值、3 年 PE/PB/PS/PCF 历史、行业排名、财报与研报预期 | `quotes`、`api TdxShareCW.ph_agf10_gzfx --code <C> --extra-one 3Y --extra-two PE`、`screener`、`report` |
| **龙虎榜掘金** (`tdx-dragon-tiger-miner`) | 个股/全市场龙虎榜、席位活跃度、机构席位追踪、个股行情 | `api TdxSharePCCW.tdxsj_lhbd_lhbzl --branch 0..3`、`api TdxSharePCCW.tdxf10_gg_jyds --fixed-tag jglhb`、`quotes` |
| **业绩预告博弈** (`tdx-yjygby`) | 业绩预告/快报/预警、发布前股价走势、估值分位、一致预期与研报 | `notice`、`api TdxSharePCCW.tdxf9_ag_cwsj_yjyj`、`kline`、`api ...gzfx`、`report`、`deep` |

## 2. 高频 `leo-tdx api`（F10 结构化接口）速查

> `code` 仅传纯数字（如 `600519`、`000001`、`00700`）。

- **利润表 / 资产负债表 / 现金流量表**（`--fixed-tag 00101` 报告期，`00102` 单季度）：
  - `leo-tdx api TdxShareCW.ph_agf10_cw_lyb --fixed-tag 00101 --code 600519`
  - `leo-tdx api TdxShareCW.ph_agf10_cw_zcfzb --code 600519`
  - `leo-tdx api TdxShareCW.ph_agf10_cw_xjllb --fixed-tag 00101 --code 600519`
- **3 年历史估值**（`--extra-two` 可选 `PE` / `PB` / `PS` / `PCF`）：
  - `leo-tdx api TdxShareCW.ph_agf10_gzfx --code 600519 --extra-one 3Y --extra-two PE`
- **主力资金流向 / 涨跌停分析 / 龙虎明细 / 大宗交易**：
  - `leo-tdx api TdxSharePCCW.tdxf10_gg_jyds --fixed-tag zjlx --code 600519`
  - `leo-tdx api TdxSharePCCW.tdxf10_gg_jyds --fixed-tag jglhb --code 600519 --extra 20261120`
- **龙虎榜总览**（`--branch`: `0`=个股上榜, `1`=席位活跃度, `2`=股票活跃度, `3`=机构追踪）：
  - `leo-tdx api TdxSharePCCW.tdxsj_lhbd_lhbzl --branch 0 --code 000001`
  - `leo-tdx api TdxSharePCCW.tdxsj_lhbd_lhbzl --branch 1`
- **股东与机构持仓**（`--fixed-tag`: `ltgd` 十大流通, `kggd` 控股, `jgcg` 机构汇总, `gdrs` 股东人数）：
  - `leo-tdx api TdxSharePCCW.tdxf10_gg_gdyj --fixed-tag ltgd --code 600519 --page 1`
- **行业排名 / 主营构成 / 分红融资 / 业绩预警**：
  - `leo-tdx api TdxShareCW.ph_agf10_hypm --query-key 00105 --code 600519`（`00102` 财务排名，`00105` 估值排名）
  - `leo-tdx api TdxShareCW.ph_agf10_jyfx --fixed-tag 00202 --code 600519`
  - `leo-tdx api TdxSharePCCW.tdxf10_gg_fhrz --fixed-tag pxmz --code 600519`
  - `leo-tdx api TdxSharePCCW.tdxf9_ag_cwsj_yjyj --code 600519`
- **一致预期降级**：`CWServ.tdxf10_gg_ybpj --fixed-tag yzyq` 若返回 503/不可用，改用 `leo-tdx deep "查询 600519 盈利预测与一致预期" --type A` 或 `leo-tdx report 600519 --name 贵州茅台`。

## 3. 通达信字段单位防错规范

- `Amount`（成交额）、`ZSZ`（总市值）：单位为**元**，需除以 `1e8` 换算为**亿元**。
- `Volume` / `Inside` / `Outside`：单位为**手**（1 手 = 100 股）。
- `ZGB` / `LTGB`：单位为**万股**，除以 `1e4` 换算为**亿股**。
- `zjlx`（主力资金流向）：最新日期通常为**上一交易日（T+1）**，不得表述为“今日实时净流入”。
