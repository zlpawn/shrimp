"""统计工具：Wilson 区间、多项式 bootstrap、配对差值检验、McNemar。"""
import math

import numpy as np
from scipy.stats import binomtest, chi2

Z95 = 1.959963984540054


def wilson_interval(successes: int, n: int) -> list[float] | None:
    """比例的 95% Wilson 区间；n 为 0 时返回 None。"""
    if n == 0:
        return None
    p = successes / n
    z2 = Z95 * Z95
    denom = 1 + z2 / n
    center = (p + z2 / (2 * n)) / denom
    half = Z95 * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return [round(max(0.0, center - half), 6), round(min(1.0, center + half), 6)]


def resample_counts(cells, times: int = 1000, seed: int = 42) -> np.ndarray:
    """把计数表当作样本分布做多项式重采样，等价于对原始样本有放回抽样。

    返回形状 (times, *cells.shape)。
    ponytail: 内存约 times × 单元格数 × 8 字节；模型对比的单元格数是 K³，类别数 K > 40 时改为分批抽样。
    """
    cells = np.asarray(cells, dtype=np.int64)
    n = int(cells.sum())
    if n == 0 or times <= 0:
        return np.zeros((0,) + cells.shape, dtype=np.int64)
    flat = cells.ravel()
    draws = np.random.default_rng(seed).multinomial(n, flat / n, size=times)
    return draws.reshape((times,) + cells.shape)


def percentile_ci(values) -> list[float] | None:
    """bootstrap 样本 → 95% 百分位区间；忽略 NaN，全空时返回 None。"""
    arr = np.asarray(values, dtype=float).ravel()
    arr = arr[~np.isnan(arr)]
    if arr.size == 0:
        return None
    lo, hi = np.percentile(arr, [2.5, 97.5])
    return [round(float(lo), 6), round(float(hi), 6)]


def paired_diff(diffs) -> dict:
    """配对 bootstrap 的差值（B − A）样本 → 95% 区间与双侧 p 值。"""
    arr = np.asarray(diffs, dtype=float).ravel()
    arr = arr[~np.isnan(arr)]
    if arr.size == 0:
        return {"ci": None, "p_value": None}
    p = 2 * min(float(np.mean(arr <= 0)), float(np.mean(arr >= 0)))
    return {"ci": percentile_ci(arr), "p_value": round(min(1.0, p), 6)}


def mcnemar(b: int, c: int) -> dict:
    """b = A 对 B 错的条数，c = A 错 B 对的条数。"""
    n = b + c
    if n == 0:
        return {"b": 0, "c": 0, "method": "none", "statistic": None, "p_value": 1.0}
    if n < 25:
        p = binomtest(b, n, 0.5).pvalue
        return {"b": b, "c": c, "method": "exact", "statistic": None, "p_value": round(float(p), 6)}
    stat = max(0, abs(b - c) - 1) ** 2 / n
    return {
        "b": b,
        "c": c,
        "method": "chi2_cc",
        "statistic": round(float(stat), 6),
        "p_value": round(float(chi2.sf(stat, 1)), 6),
    }
