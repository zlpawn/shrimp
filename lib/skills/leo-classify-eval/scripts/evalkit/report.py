"""把计算结果渲染成 Markdown，并生成中文解读。"""

METRIC_NAMES = {
    "accuracy": "准确率 Accuracy",
    "precision": "精准率 Precision",
    "recall": "召回率 Recall",
    "specificity": "特异度 Specificity",
    "fpr": "误报率 FPR",
    "f1": "F1",
    "macro_f1": "宏平均 F1",
}
AVERAGE_NAMES = {"macro": "macro（各类平均）", "micro": "micro（按样本汇总）", "weighted": "weighted（按样本数加权）"}
REASONS = {"denominator_zero": "分母为 0，无法计算"}


def pct(value, digits: int = 1) -> str:
    return "N/A" if value is None else f"{value * 100:.{digits}f}%"


def ci_text(ci) -> str:
    return "—" if not ci else f"[{pct(ci[0])}, {pct(ci[1])}]"


def points(diff) -> str:
    return "N/A" if diff is None else f"{diff * 100:+.1f} 个点"


def p_text(p) -> str:
    return "—" if p is None else f"{p:.4f}"


# ---------- 二分类 ----------

def binary_narrative(result: dict) -> list[str]:
    c, t, m = result["counts"], result["totals"], result["metrics"]
    p, r, a = m["precision"]["value"], m["recall"]["value"], m["accuracy"]["value"]
    lines = [
        f"一共 {t['total']} 条样本：实际正例 {t['actual_positive']}，实际负例 {t['actual_negative']}。",
        f"模型报出 {t['predicted_positive']} 个正例：其中 {c['tp']} 个是真的（TP），{c['fp']} 个是误报（FP）。",
        f"真实正例里抓回 {c['tp']} 个，漏掉 {c['fn']} 个（FN）。",
        "精准率无法计算：模型没有预测出任何正例。" if p is None
        else f"精准率 {pct(p)}：模型报出来的正例里，{pct(p)} 是真的。",
        "召回率无法计算：数据里没有真实正例。" if r is None
        else f"召回率 {pct(r)}：真实正例里，{pct(r)} 被找了回来。",
    ]
    if a is not None:
        lines.append(f"准确率 {pct(a)}：所有判断里，对了 {pct(a)}。")

    total, pos = t["total"], t["actual_positive"]
    if total and pos and pos / total <= 0.1 and a is not None and a >= 0.9 and (r is None or r < 0.5):
        lines.append("注意：正例很少时准确率容易虚高，即使漏掉大量正例，准确率也可能很好看。")
    elif p is not None and r is not None:
        if p - r >= 0.15:
            lines.append("当前更偏“报得准，但抓得不全”：误报少，漏报多。")
        elif r - p >= 0.15:
            lines.append("当前更偏“抓得全，但水分大”：漏报少，误报多。")
        else:
            lines.append("精准率和召回率比较接近，没有明显偏向。")
    if 0 < pos < 30:
        lines.append(f"正例只有 {pos} 个，置信区间较宽，结论要谨慎。")
    return lines


def render_binary(result: dict) -> str:
    c, t, m = result["counts"], result["totals"], result["metrics"]
    out = [
        "### 四格表",
        "",
        "| | 预测为正 | 预测为负 | 合计 |",
        "|---|---|---|---|",
        f"| 实际为正 | TP {c['tp']} | FN {c['fn']} | {t['actual_positive']} |",
        f"| 实际为负 | FP {c['fp']} | TN {c['tn']} | {t['actual_negative']} |",
        f"| 合计 | {t['predicted_positive']} | {t['predicted_negative']} | {t['total']} |",
        "",
        "### 指标",
        "",
        "| 指标 | 数值 | 95% 区间 | 说明 |",
        "|---|---|---|---|",
    ]
    for key, metric in m.items():
        note = REASONS.get(metric["reason"], "") if metric["reason"] else ""
        out.append(f"| {METRIC_NAMES[key]} | {pct(metric['value'])} | {ci_text(metric['ci'])} | {note} |")
    out += ["", "### 解读", ""] + [f"- {line}" for line in binary_narrative(result)]
    return "\n".join(out)


# ---------- 多分类 ----------

def multiclass_narrative(result: dict) -> list[str]:
    lines = [f"整体准确率 {pct(result['accuracy']['value'])}。"]
    rated = [row for row in result["per_class"] if row["support"] > 0 and row["f1"] is not None]
    if rated:
        best = max(rated, key=lambda row: row["f1"])
        worst = min(rated, key=lambda row: row["f1"])
        lines.append(f"表现最好的是「{best['label']}」（F1 {pct(best['f1'])}），最差的是「{worst['label']}」（F1 {pct(worst['f1'])}）。")
    if result["top_confusions"]:
        top = result["top_confusions"][0]
        lines.append(f"最常见的错误：真实「{top['true']}」被判成「{top['pred']}」，共 {top['count']} 条。")
    macro = result["averages"]["macro"]["f1"]["value"]
    weighted = result["averages"]["weighted"]["f1"]["value"]
    if macro is not None and weighted is not None and weighted - macro >= 0.05:
        lines.append("weighted F1 明显高于 macro F1：大类别表现好、小类别拖后腿。")
    small = [row["label"] for row in result["per_class"] if 0 < row["support"] < 30]
    if small:
        lines.append(f"这些类别样本少于 30 条，指标波动大：{'、'.join(small)}。")
    return lines


def render_multiclass(result: dict) -> str:
    out = [
        "### 各类别",
        "",
        "| 类别 | 精准率 | 召回率 | F1 | 样本数 |",
        "|---|---|---|---|---|",
    ]
    for row in result["per_class"]:
        out.append(f"| {row['label']} | {pct(row['precision'])} | {pct(row['recall'])} | {pct(row['f1'])} | {row['support']} |")
    acc = result["accuracy"]
    out += [
        "",
        f"准确率：{pct(acc['value'])}，95% 区间 {ci_text(acc['ci'])}",
        "",
        "### 平均指标",
        "",
        "| 平均方式 | 精准率 | 召回率 | F1 | F1 95% 区间 |",
        "|---|---|---|---|---|",
    ]
    for key, avg in result["averages"].items():
        out.append(
            f"| {AVERAGE_NAMES[key]} | {pct(avg['precision']['value'])} | {pct(avg['recall']['value'])} "
            f"| {pct(avg['f1']['value'])} | {ci_text(avg['f1']['ci'])} |"
        )
    labels = result["matrix_labels"]
    out += [
        "",
        "### 混淆矩阵（行 = 真实，列 = 预测）",
        "",
        "| 真实 \\ 预测 | " + " | ".join(labels) + " |",
        "|---" * (len(labels) + 1) + "|",
    ]
    for label, row in zip(result["labels"], result["confusion"]):
        out.append(f"| {label} | " + " | ".join(str(v) for v in row) + " |")
    if result["top_confusions"]:
        out += ["", "### 最容易混淆", ""]
        out += [f"- 真实「{p['true']}」→ 判成「{p['pred']}」：{p['count']} 条" for p in result["top_confusions"]]
    out += ["", "### 解读", ""] + [f"- {line}" for line in multiclass_narrative(result)]
    return "\n".join(out)


# ---------- 阈值 ----------

def render_thresholds(scan: dict) -> str:
    if not scan["available"]:
        return f"### 阈值分析\n\n{scan['reason']}"
    out = [
        "### 阈值分析",
        "",
        f"PR-AUC {scan['pr_auc']:.4f}，ROC-AUC {scan['roc_auc']:.4f}",
        "",
        "| 阈值 | 精准率 | 召回率 | F1 |",
        "|---|---|---|---|",
    ]
    for row in scan["rows"]:
        out.append(f"| {row['threshold']:.4f} | {pct(row['precision'])} | {pct(row['recall'])} | {pct(row['f1'])} |")
    best = scan["best_f1"]
    out += [
        "",
        f"- F1 最高的阈值：{best['threshold']:.4f}（精准率 {pct(best['precision'])}，召回率 {pct(best['recall'])}，F1 {pct(best['f1'])}）",
    ]
    need = pct(scan["min_recall"], 0)
    hit = scan["at_min_recall"]
    if hit:
        out.append(
            f"- 召回率 ≥ {need} 时精准率最高的阈值：{hit['threshold']:.4f}"
            f"（精准率 {pct(hit['precision'])}，召回率 {pct(hit['recall'])}）"
        )
    else:
        out.append(f"- 任何阈值都达不到召回率 ≥ {need}。")
    return "\n".join(out)


# ---------- 模型对比 ----------

def verdict(row: dict) -> str:
    name = METRIC_NAMES[row["metric"]]
    diff, p = row["diff"], row["p_value"]
    if diff is None:
        return f"{name}：有模型无法计算，没法比较。"
    if diff == 0:
        head = f"{name}：A 和 B 一样"
    else:
        head = f"{name}：B 比 A {'高' if diff > 0 else '低'} {abs(diff) * 100:.1f} 个点"
    if p is not None and p < 0.05:
        return f"{head}，差异在统计上显著（p = {p:.4f}）。"
    return f"{head}，但统计上还分不出高低（p = {p_text(p)}），建议增加样本。"


def render_compare(result: dict) -> str:
    out = [
        f"### 模型对比（共 {result['n']} 条样本，差值 = B − A）",
        "",
        "| 指标 | 模型 A | 模型 B | 差值 | 差值 95% 区间 | p 值 | 检验 |",
        "|---|---|---|---|---|---|---|",
    ]
    for row in result["rows"]:
        ci = "—" if not row["ci"] else f"[{points(row['ci'][0])}, {points(row['ci'][1])}]"
        out.append(
            f"| {METRIC_NAMES[row['metric']]} | {pct(row['a'])} | {pct(row['b'])} | {points(row['diff'])} "
            f"| {ci} | {p_text(row['p_value'])} | {row['test']} |"
        )
    test = result["mcnemar"]
    out += [
        "",
        f"McNemar：A 对 B 错 {test['b']} 条，A 错 B 对 {test['c']} 条（方法 {test['method']}）。",
        "",
        "### 结论",
        "",
    ]
    primary = next(row for row in result["rows"] if row["metric"] == result["primary"])
    out.append(f"- {verdict(primary)}")
    out += [f"- {verdict(row)}" for row in result["rows"] if row is not primary]
    return "\n".join(out)
