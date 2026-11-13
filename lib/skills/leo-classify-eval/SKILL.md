---
name: leo-classify-eval
description: 分类模型评估与指标讲解。用户给出已打标的数据集（CSV / JSONL / XLSX / 大模型评测输出）、TP/FP/FN/TN 计数或白话描述时，立即计算准确率、精准率、召回率、F1、特异度及 95% 置信区间；支持多分类（macro / micro / weighted、混淆矩阵）、按分数选阈值（PR-AUC、ROC-AUC）、两个模型的显著性对比（McNemar、配对 bootstrap）和错例导出；并用生活化例子讲清每个名词。当用户提到召回率、精准率、准确率、F1、TP、FP、FN、TN、混淆矩阵、评估分类效果、对比两个模型、选阈值，或问这些概念是什么意思时触发。
---

# leo-classify-eval 分类评估

两件事：**算**（用户的数据 → 指标、区间、对比、错例）和**讲**（每个名词的含义、公式、例子）。每次算完都要讲，用用户自己的数字讲。

## 运行方式

所有计算都通过 `scripts/eval_metrics.py`。Python 环境固定在 `~/.shrimp/skills/leo-classify-eval/.venv`，各 agent 共用；第一次运行时 `uv` 会自动创建环境并安装依赖（约 100MB，需联网），之后秒开。

`<skill目录>` 是本文件所在目录。

macOS / Linux：

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project "<skill目录>" python "<skill目录>/scripts/eval_metrics.py" <子命令> ...
```

Windows PowerShell：

```powershell
$env:UV_PROJECT_ENVIRONMENT = "$HOME\.shrimp\skills\leo-classify-eval\.venv"
uv run --project "<skill目录>" python "<skill目录>\scripts\eval_metrics.py" <子命令> ...
```

数据文件路径按用户当前目录写即可，`--project` 不会改变工作目录。

## 选哪个子命令

| 用户给的是 | 子命令 | 示例 |
|---|---|---|
| 打好标的数据文件 | `eval` | `eval data.csv` |
| 四个计数 | `counts` | `counts --tp 40 --fp 10 --fn 20 --tn 130` |
| 白话描述（"200 条里挑出 50 条，错了 10 条，还漏了 20 条"） | `guided` | `guided --total 200 --selected 50 --selected-wrong 10 --missed 20` |
| 两个模型的结果 | `compare` | `compare data.csv --pred-a model_a --pred-b model_b` |
| 只问概念 | 不跑脚本 | 读 [references/glossary.md](references/glossary.md) 和 [references/examples.md](references/examples.md) |

## eval：评测数据文件

```bash
eval <文件> [--true 列] [--pred 列] [--score 列] [--positive 值]
            [--true-field a.b] [--pred-field a.b] [--pred-regex 正则]
            [--min-recall 0.9] [--errors-out 错例.csv] [--bootstrap 1000] [--json]
```

- **列名自动识别**：真实标签认 `label / y_true / gold / truth / actual / ground_truth / 标签 / 真实值`；预测认 `pred / prediction / y_pred / predict / 预测 / 预测值`；分数认 `score / prob / probability / confidence / 置信度`。识别失败时脚本会列出全部列名，**问用户选哪一列**，再用 `--true` / `--pred` / `--score` 重跑。
- **正类**：标签是 0/1、是/否、true/false 时自动以 1（是）为正类；其他二分类标签（如 spam/ham）脚本会报错，**问用户哪个是要找的那一类**，再加 `--positive`。
- **只有分数没有预测**：按分数 ≥ 0.5 判正，并自动给出阈值分析。
- **有分数**（二分类）：输出阈值表、F1 最高的阈值、满足 `--min-recall` 时精准率最高的阈值、PR-AUC 和 ROC-AUC。
- **大模型评测输出**（JSONL）：用 `--true-field meta.label` 这样的点号路径取嵌套字段；预测是一段文字时用 `--pred-regex '答案[:：]\s*(\S+)'` 抽取。抽不出来的行按预测错误计入，报告里会给条数和示例，要提醒用户检查。
- **错例**：用户想知道"错在哪"时加 `--errors-out`，导出所有 FP / FN（多分类为"真实→预测"）的原始行，提示用户打开看。

## compare：对比两个模型

- 同一个文件里有两列预测：`compare data.csv --pred-a 列A --pred-b 列B`
- 两个文件（各自一份预测）：`compare a.csv b.csv --id 样本ID列`，按 ID 对齐，只在一侧出现的样本不参与对比。
- 必须是**同一批样本**上的结果，否则对比没有意义；用户给的两份数据样本不同时要指出来。
- 二分类比较准确率、精准率、召回率、F1；多分类比较准确率和宏平均 F1。准确率用 McNemar，其余用配对 bootstrap。

## 讲解规则

1. **用户问概念**：读 `references/glossary.md`，挑 `references/examples.md` 里最贴近用户场景的一个例子；先一句话记忆，再公式，再误区。必要时用 `counts` 把例子现场算一遍。
2. **每次计算后**：把脚本"解读"部分展开讲，用用户自己的数字，例如"你的模型报了 121 个正例，其中 36 个是误报"。不要只贴表格。
3. **报告里有区间时**：顺带说明区间宽窄意味着什么；问到原理时读 [references/stats.md](references/stats.md)。
4. **对比结论**：p ≥ 0.05 时明确说"还分不出高低"，不要说"B 更好"。
5. 讲不清的时候换一个例子，而不是重复术语。

## 隐私

- 脚本只打印统计结果和最多 5 条错例示例，不要把用户的整份数据贴进对话。
- 错例文件写在用户指定的位置，不要上传到任何地方。

## 输出给程序用

加 `--json` 输出结构化结果（`dataset` / `result` / `thresholds` / `errors`），方便其他 agent 或脚本继续处理。

## 故障排查

| 现象 | 处理 |
|---|---|
| `uv: command not found` | 让用户安装 uv：macOS `brew install uv`；Windows `winget install astral-sh.uv` |
| 依赖安装失败或环境损坏 | 删除 `~/.shrimp/skills/leo-classify-eval/.venv` 后重跑 |
| 退出码 2，"错误：……" | 输入问题，按提示问用户或补参数 |
| 中文乱码（Windows） | 脚本已强制 UTF-8 输出；仍乱码时在 PowerShell 先执行 `chcp 65001` |

## 自测

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project "<skill目录>" pytest "<skill目录>/tests" -q
```
