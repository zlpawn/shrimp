# leo-classify-eval 设计

日期：2026-11-13
状态：待用户审阅

## 1. 目标

用户提供一份已打标的数据集（或直接给 TP/FP/FN/TN、或回答几个白话问题），skill 立刻算出分类评估指标，并用用户自己的数字讲清每个指标的含义。同时支持两个模型在同一批样本上的显著性对比，以及独立的名词科普。

三个核心价值：

1. **算得对**：二分类、多分类、阈值、置信区间、模型对比，统计方法正确。
2. **找得到问题**：导出 FP/FN 错例，告诉用户该看哪些样本。
3. **讲得懂**：每个名词有含义、公式、一句话记忆法和生活例子；每次计算后结合用户数据解读。

## 2. 已确定的约束

| 项 | 决定 |
|---|---|
| skill 名称与位置 | `leo-classify-eval`，放在 `lib/skills/leo-classify-eval/`，登记到 `lib/skills/managed-catalog.json`（category `research`） |
| 语言 | Python，遵循 `lib/skills/README.md`：数据分析首选 Python，依赖统一用 `uv` 管理 |
| 依赖 | `pandas`、`openpyxl`、`scikit-learn`（带入 numpy / scipy）；开发依赖 `pytest`。由 `pyproject.toml` + `uv.lock` 锁定 |
| 虚拟环境 | 固定在 `~/.shrimp/skills/leo-classify-eval/.venv`，通过 `UV_PROJECT_ENVIRONMENT` 指定，所有 agent 复用；skill 源码目录内不产生 `.venv` |
| 独立性 | 不依赖网关、`SkillInstaller` 或任何其他 skill |
| 跨平台 | macOS 与 Windows 均可运行；路径用 `pathlib.Path`，文件读写指定 `encoding="utf-8"` |
| 输出语言 | 中文 |
| 不在范围 | 不改动桌面端 `desktop/src/app.ts` 中已有的分类评估实现；不做 HTML 可视化报告 |

## 3. 目录结构

```
lib/skills/leo-classify-eval/
├── SKILL.md                 # 触发条件、运行方式、使用流程、讲解规则
├── pyproject.toml           # 依赖声明
├── uv.lock                  # 依赖锁定
├── references/
│   ├── glossary.md          # 术语：含义、公式、一句话记忆法
│   ├── examples.md          # 生活例子：渔网、安检、垃圾邮件、疾病筛查、类别不平衡陷阱
│   └── stats.md             # 置信区间、McNemar、bootstrap 的白话说明
├── scripts/
│   ├── eval_metrics.py      # CLI 入口，只做参数解析和分发
│   └── evalkit/
│       ├── __init__.py
│       ├── loader.py        # 读文件、识别列、标签归一、正类推断、LLM 输出抽取
│       ├── metrics.py       # 二分类、多分类、阈值扫描
│       ├── stats.py         # Wilson 区间、bootstrap、McNemar
│       └── report.py        # Markdown / JSON 渲染与中文解读
└── tests/
    └── test_*.py            # 小样本 CSV / JSONL / XLSX 在测试里用 tmp_path 现场生成
```

### 运行方式

macOS / Linux：

```bash
UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv" \
  uv run --project <skill目录> python <skill目录>/scripts/eval_metrics.py <子命令> ...
```

Windows PowerShell：

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$HOME\.shrimp\skills\leo-classify-eval\.venv"
uv run --project <skill目录> python <skill目录>\scripts\eval_metrics.py <子命令> ...
```

首次运行由 `uv run` 自动创建环境并安装依赖，无单独 setup 步骤。`<skill目录>` 由 agent 按 SKILL.md 所在位置确定。

## 4. CLI 子命令

| 子命令 | 用途 | 关键参数 |
|---|---|---|
| `eval <文件>` | 评测已打标数据 | `--true` `--pred` `--score` `--positive` `--true-field` `--pred-field` `--pred-regex` `--min-recall` `--errors-out` `--bootstrap` `--json` |
| `counts` | 直接输入四格数 | `--tp` `--fp` `--fn` `--tn` `--json` |
| `guided` | 白话问题换算 | `--total` `--selected` `--selected-wrong` `--missed` `--json` |
| `compare <文件> [文件2]` | 两个模型对比 | 单文件：`--pred-a` `--pred-b`；双文件：`--id` 按样本对齐；其余同 `eval` |

参数说明：

- `--true` / `--pred` / `--score`：列名，不给则自动识别。
- `--positive`：二分类正类取值。
- `--true-field` / `--pred-field`：JSONL 中按点号路径取字段，如 `output.label`。
- `--pred-regex`：从文本中抽取预测，取第一个捕获组，如 `答案[:：]\s*(\S+)`。
- `--min-recall`：阈值扫描约束，默认 `0.9`。
- `--errors-out`：错例导出路径（CSV）。
- `--bootstrap`：重采样次数，默认 `1000`，随机种子固定为 `42`。
- `--json`：输出机器可读 JSON，替代 Markdown。

`guided` 的换算规则与现有 `lib/tools/classification-metrics.mjs` 的 `confusionFromGuidedInput` 一致：TP = 挑出 − 挑错，FP = 挑错，FN = 漏掉，TN = 未挑出 − 漏掉；并做同样的合法性校验（挑出 ≤ 总数、挑错 ≤ 挑出、漏掉 ≤ 未挑出）。

## 5. 输入识别

1. **文件格式**：按扩展名识别 `.csv` / `.jsonl` / `.json`（数组）/ `.xlsx`。
2. **列名识别**（大小写不敏感）：
   - 真实标签：`label` `y_true` `gold` `truth` `actual` `ground_truth` `标签` `真实值`
   - 预测：`pred` `prediction` `y_pred` `predict` `预测` `预测值`
   - 分数：`score` `prob` `probability` `confidence` `置信度`
   - 某一类命中 0 个或多于 1 个候选列时退出（码 2），并列出全部列名，由 agent 询问用户。
3. **标签归一**：去首尾空格、转小写；`1/true/yes/y/是/positive/pos` 归为 `1`，`0/false/no/n/否/negative/neg` 归为 `0`。仅在全部标签都落入这两组时才做布尔归一，否则保留原值。
4. **二分类 / 多分类判定**：真实标签与预测标签并集的取值个数，等于 2 为二分类，大于 2 为多分类。
5. **正类推断**（二分类）：给了 `--positive` 就用；归一后是 `0/1` 时默认 `1`；否则退出并列出两个取值，请用户指定。输出第一行固定写明"正类 = X"。
6. **只有分数没有预测**：以 `0.5` 为阈值生成预测，并自动输出阈值扫描。
7. **LLM 输出抽取（D 类）**：用 `--true-field` / `--pred-field` / `--pred-regex` 取值。抽取失败的行预测记为 `__invalid__`，计为预测错误；报告失败条数并给出最多 3 条示例。
8. **缺失真实标签**：整行剔除，报告剔除条数。

## 6. 输出

默认输出 Markdown 到终端；`--json` 时输出同样内容的 JSON。

### 二分类

- 四格表（TP / FP / FN / TN）与各合计。
- 指标表：准确率、精准率、召回率、特异度、FPR、F1，每项带 95% 置信区间。分母为 0 的指标显示 `N/A` 并说明原因。
- 中文解读：逐项白话解释（移植自 `buildMetricsNarrative`），偏向判断（精准与召回差 ≥ 0.15 时提示偏向），类别不平衡提醒（正例占比 ≤ 10%、准确率 ≥ 90%、召回率 < 50%）。

### 多分类

- 每类：精准率、召回率、F1、支持数。
- macro / micro / weighted 平均，各带 bootstrap 95% 区间。
- N×N 混淆矩阵；混淆最多的前 5 对"真实 → 预测"。
- 中文解读：最好和最差的类别、主要混淆方向。

### 阈值（有分数列时）

- 按分数分位点（10 个点）列出各阈值的精准率、召回率、F1。
- F1 最优阈值。
- 满足 `召回率 ≥ --min-recall` 时精准率最高的阈值；无法满足则明确说明。
- PR-AUC（average precision）与 ROC-AUC。

### 模型对比

- 每项指标一行：A、B、差值（B − A）、差值 95% 区间、p 值。
- McNemar 不一致计数：A 对 B 错的条数、A 错 B 对的条数。
- 一句白话结论，例如"B 比 A 高 3.1 个点，但统计上还分不出高低，建议增加样本"。
- 双文件模式下，`--id` 只出现在一侧的样本不参与对比，报告条数。

### 错例导出

- 保留原始所有列，新增 `error_type` 列：二分类为 `FP` / `FN`，多分类为 `真实→预测`。
- 终端只打印统计与最多 5 条示例，不打印整份数据。

## 7. 统计方法

| 场景 | 方法 |
|---|---|
| 准确率、精准率、召回率、特异度、FPR | Wilson 区间（95%） |
| F1、macro / micro / weighted 平均 | 百分位 bootstrap（默认 1000 次，种子 42） |
| 对比：准确率 | McNemar：不一致数 b + c < 25 用精确二项检验，否则用带连续性校正的卡方检验 |
| 对比：精准率、召回率、F1 | 配对 bootstrap（同一组重采样下标同时作用于 A、B），给出差值区间；p 值 = 2 × min(差值 ≤ 0 的比例, 差值 ≥ 0 的比例)，上限 1 |
| 样本量提醒 | 正例数 < 30 时提示"区间较宽，结论谨慎" |

## 8. 讲解与科普

SKILL.md 规定两种讲解时机：

1. **用户问概念**（如"召回率是什么""TP 和 FN 怎么区分"）：agent 读 `references/glossary.md` 与 `references/examples.md`，选一个最贴近用户场景的例子讲，必要时用 `counts` 现场算一个小例子。
2. **每次计算后**：结合用户自己的数字逐项解释，基于脚本输出的中文解读展开。

`glossary.md` 覆盖：TP、FP、FN、TN、准确率、精准率、召回率、特异度、FPR、F1、混淆矩阵、macro / micro / weighted、阈值、PR 曲线、PR-AUC、ROC-AUC、置信区间、p 值、McNemar。每个词含"含义 / 公式 / 一句话记忆法 / 常见误区"。

`examples.md` 至少包含：渔网捞鱼、机场安检、垃圾邮件（40/10/20/130）、疾病筛查（18/30/2/150）、类别不平衡陷阱（0/0/10/990）。后三个沿用现有 `METRIC_SCENARIOS` 的数字。

`stats.md` 用白话说明：为什么同样 80% 召回率在 50 条和 5000 条样本上可信度不同、McNemar 只看不一致样本的原因、bootstrap 的直观含义。

## 9. 错误处理

- 输入错误（文件不存在、格式不支持、列识别失败、正类无法推断、计数非法、guided 输入矛盾）：退出码 2，中文报错，指明列名 / 字段 / 行号。
- 依赖或环境问题由 `uv` 自身报错，SKILL.md 给出排查提示（检查 `uv --version`、删除 `.venv` 后重跑）。

## 10. 测试

`tests/` 下用 pytest，运行：`uv run --project <skill目录> pytest <skill目录>/tests`（同样设置 `UV_PROJECT_ENVIRONMENT`）。

| 覆盖点 | 断言 |
|---|---|
| 与现有 Node 实现对拍 | 垃圾邮件场景：精准率 0.8、召回率 0.666667、准确率 0.85；不平衡场景精准率为 N/A |
| guided 换算 | 与 `confusionFromGuidedInput` 结果一致；三类矛盾输入均报错 |
| 列名识别 | 中英文列名命中；歧义与缺失时退出码 2 |
| 标签归一与正类推断 | `是/否`、`true/false`、`1/0` 归一；非布尔二值且未指定正类时报错 |
| 多分类 | macro / micro / weighted 与 sklearn 直接计算一致 |
| 阈值扫描 | F1 最优阈值与最低召回约束阈值正确；约束无法满足时有明确提示 |
| 统计 | Wilson 区间与 scipy `binomtest(...).proportion_ci(method="wilson")` 一致；McNemar 精确 / 卡方分支各一例 |
| LLM 抽取 | 抽取失败行计为错误并计数 |
| 文件格式 | CSV / JSONL / XLSX 各一份现场生成的小样本能跑通 |
