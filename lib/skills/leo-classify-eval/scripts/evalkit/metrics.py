"""指标计算：二分类、多分类、阈值扫描、模型对比。

所有区间都基于计数表做多项式 bootstrap，样本量再大也只和类别数有关。
"""
import math

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score

from . import INVALID, InputError
from .stats import mcnemar, paired_diff, percentile_ci, resample_counts, wilson_interval


def _num(value) -> float | None:
    if value is None:
        return None
    value = float(value)
    return None if math.isnan(value) else round(value, 6)


def _metric(value, ci=None, reason=None) -> dict:
    return {"value": _num(value), "ci": ci, "reason": reason}


def _ratio(num: int, den: int) -> dict:
    if den == 0:
        return _metric(None, reason="denominator_zero")
    return _metric(num / den, wilson_interval(num, den))


def _plain(num: int, den: int) -> float | None:
    return None if den == 0 else round(num / den, 6)


def _safe_div(num, den) -> np.ndarray:
    num = np.asarray(num, dtype=float)
    den = np.asarray(den, dtype=float)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(den == 0, np.nan, num / den)


def _check_count(name: str, value) -> int:
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise InputError(f"{name} 必须是非负整数，收到：{value}") from None
    if not math.isfinite(number) or number < 0 or number != int(number):
        raise InputError(f"{name} 必须是非负整数，收到：{value}")
    return int(number)


# ---------- 二分类 ----------

def binary_metrics(tp, fp, fn, tn, times: int = 1000, seed: int = 42) -> dict:
    tp, fp, fn, tn = (
        _check_count(name, value) for name, value in (("TP", tp), ("FP", fp), ("FN", fn), ("TN", tn))
    )
    total = tp + fp + fn + tn
    f1_den = 2 * tp + fp + fn
    if f1_den == 0:
        f1 = _metric(None, reason="denominator_zero")
    else:
        draws = resample_counts([tp, fp, fn, tn], times, seed)
        boot = _safe_div(2 * draws[:, 0], 2 * draws[:, 0] + draws[:, 1] + draws[:, 2])
        f1 = _metric(2 * tp / f1_den, percentile_ci(boot))
    return {
        "kind": "binary",
        "counts": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
        "totals": {
            "total": total,
            "actual_positive": tp + fn,
            "actual_negative": fp + tn,
            "predicted_positive": tp + fp,
            "predicted_negative": fn + tn,
        },
        "metrics": {
            "accuracy": _ratio(tp + tn, total),
            "precision": _ratio(tp, tp + fp),
            "recall": _ratio(tp, tp + fn),
            "specificity": _ratio(tn, tn + fp),
            "fpr": _ratio(fp, fp + tn),
            "f1": f1,
        },
    }


def guided_to_counts(total, selected, selected_wrong, missed) -> dict:
    """白话问题 → 四格数：总共多少条、挑出多少、挑出里错几条、没挑出里漏掉几条真正例。"""
    total = _check_count("总数", total)
    selected = _check_count("挑出数", selected)
    selected_wrong = _check_count("挑错数", selected_wrong)
    missed = _check_count("漏掉数", missed)
    if selected > total:
        raise InputError("挑出的数量不能超过总数")
    if selected_wrong > selected:
        raise InputError("挑错的数量不能超过挑出的数量")
    if missed > total - selected:
        raise InputError("漏掉的数量不能超过没挑出的数量")
    return {
        "tp": selected - selected_wrong,
        "fp": selected_wrong,
        "fn": missed,
        "tn": total - selected - missed,
    }


def resolve_invalid(y_true, y_pred, positive: str, negative: str) -> list[str]:
    """二分类里无法解析的预测一律算错：真实为正 → 记成负（FN），真实为负 → 记成正（FP）。"""
    return [
        (negative if t == positive else positive) if p == INVALID else p
        for t, p in zip(y_true, y_pred)
    ]


def binary_counts(y_true, y_pred, positive: str) -> dict:
    t = np.asarray(y_true, dtype=object) == positive
    p = np.asarray(y_pred, dtype=object) == positive
    return {
        "tp": int(np.sum(t & p)),
        "fp": int(np.sum(~t & p)),
        "fn": int(np.sum(t & ~p)),
        "tn": int(np.sum(~t & ~p)),
    }


def error_types(y_true, y_pred, positive: str | None = None) -> list[str | None]:
    """每行的错误类型：二分类 FP / FN，多分类「真实→预测」，预测正确为 None。"""
    out = []
    for t, p in zip(y_true, y_pred):
        if t == p:
            out.append(None)
        elif positive is None:
            out.append(f"{t}→{p}")
        else:
            out.append("FN" if t == positive else "FP")
    return out


# ---------- 多分类 ----------

def _matrix_labels(classes: list[str], *preds) -> list[str]:
    has_invalid = any(INVALID in pred for pred in preds)
    return list(classes) + ([INVALID] if has_invalid else [])


def _encode(labels: list[str], *seqs) -> list[np.ndarray]:
    index = {label: i for i, label in enumerate(labels)}
    return [np.fromiter((index[v] for v in seq), dtype=np.int64, count=len(seq)) for seq in seqs]


def _averages(cm: np.ndarray, n_classes: int) -> dict:
    """cm 形状 (..., K, K)，行=真实、列=预测；前 n_classes 个是真实类别，其余列是 __invalid__。

    零除按 0 处理，与 sklearn 的 zero_division=0 一致。
    """
    diag = np.diagonal(cm, axis1=-2, axis2=-1)[..., :n_classes]
    pred_tot = cm.sum(axis=-2)[..., :n_classes]
    true_tot = cm.sum(axis=-1)[..., :n_classes]
    prec = np.nan_to_num(_safe_div(diag, pred_tot))
    rec = np.nan_to_num(_safe_div(diag, true_tot))
    f1 = np.nan_to_num(_safe_div(2 * prec * rec, prec + rec))
    weights = _safe_div(true_tot, true_tot.sum(axis=-1, keepdims=True))
    micro_p = np.nan_to_num(_safe_div(diag.sum(-1), pred_tot.sum(-1)))
    micro_r = np.nan_to_num(_safe_div(diag.sum(-1), true_tot.sum(-1)))
    micro_f1 = np.nan_to_num(_safe_div(2 * micro_p * micro_r, micro_p + micro_r))
    return {
        "macro": {"precision": prec.mean(-1), "recall": rec.mean(-1), "f1": f1.mean(-1)},
        "micro": {"precision": micro_p, "recall": micro_r, "f1": micro_f1},
        "weighted": {
            "precision": (prec * weights).sum(-1),
            "recall": (rec * weights).sum(-1),
            "f1": (f1 * weights).sum(-1),
        },
    }


def multiclass_metrics(y_true, y_pred, classes: list[str], times: int = 1000, seed: int = 42) -> dict:
    labels = _matrix_labels(classes, y_pred)
    k, n_classes = len(labels), len(classes)
    t_idx, p_idx = _encode(labels, y_true, y_pred)
    cm = np.bincount(t_idx * k + p_idx, minlength=k * k).reshape(k, k)
    total = int(cm.sum())
    correct = int(np.trace(cm))

    point = _averages(cm, n_classes)
    boot = _averages(resample_counts(cm, times, seed), n_classes)
    averages = {
        avg: {m: _metric(point[avg][m], percentile_ci(boot[avg][m])) for m in ("precision", "recall", "f1")}
        for avg in ("macro", "micro", "weighted")
    }

    per_class = []
    for i, label in enumerate(classes):
        tp = int(cm[i, i])
        predicted = int(cm[:, i].sum())
        support = int(cm[i, :].sum())
        precision = _plain(tp, predicted)
        recall = _plain(tp, support)
        f1 = _plain(2 * tp, predicted + support)
        per_class.append(
            {"label": label, "precision": precision, "recall": recall, "f1": f1, "support": support}
        )

    pairs = [
        {"true": labels[i], "pred": labels[j], "count": int(cm[i, j])}
        for i in range(n_classes)
        for j in range(k)
        if i != j and cm[i, j] > 0
    ]
    pairs.sort(key=lambda item: -item["count"])

    return {
        "kind": "multiclass",
        "labels": list(classes),
        "matrix_labels": labels,
        "confusion": cm.tolist(),
        "accuracy": _ratio(correct, total),
        "averages": averages,
        "per_class": per_class,
        "top_confusions": pairs[:5],
    }


# ---------- 阈值 ----------

def threshold_scan(y_true, scores, positive: str, min_recall: float = 0.9) -> dict:
    y = (np.asarray(y_true, dtype=object) == positive).astype(int)
    s = np.asarray(scores, dtype=float)
    if y.all() or not y.any():
        return {"available": False, "reason": "需要同时有正例和负例才能做阈值分析"}

    rows = []
    for th in np.unique(np.quantile(s, np.linspace(0.05, 0.95, 10))):
        pred = s >= th
        tp = int(np.sum(pred & (y == 1)))
        fp = int(np.sum(pred & (y == 0)))
        fn = int(np.sum(~pred & (y == 1)))
        rows.append({
            "threshold": round(float(th), 6),
            "precision": _plain(tp, tp + fp),
            "recall": _plain(tp, tp + fn),
            "f1": _plain(2 * tp, 2 * tp + fp + fn),
        })

    precision, recall, thresholds = precision_recall_curve(y, s)
    p, r = precision[:-1], recall[:-1]
    f1 = np.nan_to_num(_safe_div(2 * p * r, p + r))

    def point(i: int) -> dict:
        return {
            "threshold": _num(thresholds[i]),
            "precision": _num(p[i]),
            "recall": _num(r[i]),
            "f1": _num(f1[i]),
        }

    best = int(np.argmax(f1))
    ok = np.flatnonzero(r >= min_recall)
    at_min_recall = None
    if ok.size:
        # 精准率相同时取更高的阈值（thresholds 递增，从后往前找第一个最大值）
        rev = ok[::-1]
        at_min_recall = point(int(rev[np.argmax(p[rev])]))

    return {
        "available": True,
        "rows": rows,
        "best_f1": point(best),
        "min_recall": min_recall,
        "at_min_recall": at_min_recall,
        "pr_auc": _num(average_precision_score(y, s)),
        "roc_auc": _num(roc_auc_score(y, s)),
    }


# ---------- 模型对比 ----------

def _model_stats(cm: np.ndarray, n_classes: int, pos_index: int | None) -> dict:
    """cm 形状 (..., K, K) → 各指标数组；二分类给 accuracy/precision/recall/f1，多分类给 accuracy/macro_f1。"""
    total = cm.sum(axis=(-2, -1))
    out = {"accuracy": _safe_div(np.trace(cm, axis1=-2, axis2=-1), total)}
    if pos_index is None:
        out["macro_f1"] = _averages(cm, n_classes)["macro"]["f1"]
        return out
    i = pos_index
    tp = cm[..., i, i]
    fp = cm[..., :, i].sum(-1) - tp
    fn = cm[..., i, :].sum(-1) - tp
    out["precision"] = _safe_div(tp, tp + fp)
    out["recall"] = _safe_div(tp, tp + fn)
    out["f1"] = _safe_div(2 * tp, 2 * tp + fp + fn)
    return out


def compare_models(
    y_true,
    pred_a,
    pred_b,
    classes: list[str],
    positive: str | None = None,
    negative: str | None = None,
    times: int = 1000,
    seed: int = 42,
) -> dict:
    if positive is not None:
        pred_a = resolve_invalid(y_true, pred_a, positive, negative)
        pred_b = resolve_invalid(y_true, pred_b, positive, negative)
    labels = _matrix_labels(classes, pred_a, pred_b)
    k, n_classes = len(labels), len(classes)
    t, a, b = _encode(labels, y_true, pred_a, pred_b)
    cube = np.bincount((t * k + a) * k + b, minlength=k ** 3).reshape(k, k, k)
    pos_index = labels.index(positive) if positive is not None else None

    point_a = _model_stats(cube.sum(axis=-1), n_classes, pos_index)
    point_b = _model_stats(cube.sum(axis=-2), n_classes, pos_index)
    draws = resample_counts(cube, times, seed)
    boot_a = _model_stats(draws.sum(axis=-1), n_classes, pos_index)
    boot_b = _model_stats(draws.sum(axis=-2), n_classes, pos_index)

    correct_a, correct_b = a == t, b == t
    test = mcnemar(int(np.sum(correct_a & ~correct_b)), int(np.sum(~correct_a & correct_b)))

    rows = []
    for name in point_a:
        va, vb = _num(point_a[name]), _num(point_b[name])
        diff = None if va is None or vb is None else round(vb - va, 6)
        boot = paired_diff(boot_b[name] - boot_a[name])
        row = {"metric": name, "a": va, "b": vb, "diff": diff, "ci": boot["ci"], "p_value": boot["p_value"], "test": "bootstrap"}
        if name == "accuracy":
            row["p_value"], row["test"] = test["p_value"], "mcnemar"
        rows.append(row)

    return {
        "kind": "compare",
        "mode": "binary" if positive is not None else "multiclass",
        "n": int(cube.sum()),
        "rows": rows,
        "mcnemar": test,
        "primary": "f1" if positive is not None else "macro_f1",
    }
