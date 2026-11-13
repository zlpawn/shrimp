# leo-classify-eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新建独立 skill `leo-classify-eval`：读入已打标数据（或四格计数、白话描述），即时算出分类评估指标与置信区间，支持多分类、阈值分析、两模型显著性对比和错例导出，并附带讲解用的术语表与例子。

**Architecture:** Python CLI `scripts/eval_metrics.py` 只做参数解析和分发；计算核心在 `scripts/evalkit/` 包内按职责拆成 `loader`（读数据、识别列、归一标签）、`metrics`（计数表上的各类指标）、`stats`（Wilson、多项式 bootstrap、McNemar）、`report`（Markdown 与中文解读）。所有区间都在计数表上做多项式重采样，耗时只和类别数有关、与样本量无关。讲解内容放在 `references/` 由 agent 读取。

**Tech Stack:** Python ≥ 3.10、uv、pandas、openpyxl、scikit-learn（带入 numpy / scipy）、pytest。

**Spec:** `docs/superpowers/specs/2026-11-13-leo-classify-eval-design.md`

## Global Constraints

- skill 目录：`lib/skills/leo-classify-eval/`；名称 `leo-classify-eval`；登记到 `lib/skills/managed-catalog.json`，category `research`。
- 不依赖网关、`SkillInstaller` 或其他 skill；不修改 `desktop/src/app.ts` 和 `lib/tools/classification-metrics.mjs`。
- 依赖只用 `pandas`、`openpyxl`、`scikit-learn`（开发依赖 `pytest`），由 `pyproject.toml` + `uv.lock` 锁定；禁止 `pip install`。
- 虚拟环境固定在 `~/.shrimp/skills/leo-classify-eval/.venv`，通过 `UV_PROJECT_ENVIRONMENT` 指定；skill 源码目录内不得出现 `.venv`。
- macOS 与 Windows 都能运行：路径用 `pathlib.Path`，文件读写指定 UTF-8（错例 CSV 用 `utf-8-sig` 方便 Excel 打开）。
- 输出语言为中文；输入错误统一抛 `evalkit.InputError`，CLI 以退出码 2 结束并打印 `错误：…` 到 stderr。
- bootstrap 默认 1000 次，随机种子 42。
- 本计划中所有代码已在隔离环境中跑通，共 61 个测试通过；照抄即可，不要“改进”。

## 运行约定

所有命令在仓库根目录 `/Users/pa/project/AI/local-ai-gateway` 下执行，并先设置：

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
```

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/skills/leo-classify-eval/pyproject.toml` | 依赖、pytest 配置（`pythonpath = ["scripts"]`） |
| `lib/skills/leo-classify-eval/uv.lock` | `uv lock` 生成 |
| `lib/skills/leo-classify-eval/scripts/evalkit/__init__.py` | `INVALID` 常量、`InputError` |
| `lib/skills/leo-classify-eval/scripts/evalkit/stats.py` | Wilson 区间、多项式重采样、百分位区间、配对差值、McNemar |
| `lib/skills/leo-classify-eval/scripts/evalkit/metrics.py` | 二分类、白话换算、多分类、阈值扫描、模型对比、错误类型 |
| `lib/skills/leo-classify-eval/scripts/evalkit/loader.py` | 读 CSV/JSONL/JSON/XLSX、列识别、点号路径、标签归一、正类推断、正则抽取、按 ID 合并 |
| `lib/skills/leo-classify-eval/scripts/evalkit/report.py` | Markdown 渲染与中文解读、对比结论 |
| `lib/skills/leo-classify-eval/scripts/eval_metrics.py` | CLI：`eval` / `counts` / `guided` / `compare`，错例导出 |
| `lib/skills/leo-classify-eval/references/glossary.md` | 术语：含义、公式、记忆法、误区 |
| `lib/skills/leo-classify-eval/references/examples.md` | 生活例子与可直接运行的命令 |
| `lib/skills/leo-classify-eval/references/stats.md` | 统计方法白话说明 |
| `lib/skills/leo-classify-eval/SKILL.md` | 触发描述、运行方式、使用流程、讲解规则 |
| `lib/skills/leo-classify-eval/tests/test_*.py` | 每个模块一份测试，测试数据用 `tmp_path` 现场生成 |

---

### Task 1: 脚手架与统计工具

**Files:**
- Create: `lib/skills/leo-classify-eval/pyproject.toml`
- Create: `lib/skills/leo-classify-eval/uv.lock`（命令生成）
- Create: `lib/skills/leo-classify-eval/scripts/evalkit/__init__.py`
- Create: `lib/skills/leo-classify-eval/scripts/evalkit/stats.py`
- Test: `lib/skills/leo-classify-eval/tests/test_stats.py`

**Interfaces:**
- Consumes: 无
- Produces:
  - `evalkit.INVALID: str = "__invalid__"`，`evalkit.InputError(Exception)`
  - `wilson_interval(successes: int, n: int) -> list[float] | None`（保留 6 位小数）
  - `resample_counts(cells, times: int = 1000, seed: int = 42) -> np.ndarray`，形状 `(times, *cells.shape)`
  - `percentile_ci(values) -> list[float] | None`
  - `paired_diff(diffs) -> {"ci": list|None, "p_value": float|None}`
  - `mcnemar(b: int, c: int) -> {"b", "c", "method": "none"|"exact"|"chi2_cc", "statistic", "p_value"}`

- [ ] **Step 1: Create the project files**

Create `lib/skills/leo-classify-eval/pyproject.toml`:

```toml
[project]
name = "leo-classify-eval"
version = "0.1.0"
description = "分类评估：指标计算、模型对比、错例导出与讲解"
requires-python = ">=3.10"
dependencies = [
    "pandas>=2.0",
    "openpyxl>=3.1",
    "scikit-learn>=1.3",
]

[dependency-groups]
dev = ["pytest>=8.0"]

[tool.uv]
package = false

[tool.pytest.ini_options]
pythonpath = ["scripts"]
testpaths = ["tests"]
```

Create `lib/skills/leo-classify-eval/scripts/evalkit/__init__.py`:

```python
"""leo-classify-eval 计算核心。"""

INVALID = "__invalid__"


class InputError(Exception):
    """用户输入有误。CLI 捕获后打印中文说明并以退出码 2 结束。"""
```

- [ ] **Step 2: Lock dependencies**

```bash
uv lock --project lib/skills/leo-classify-eval
```

Expected: 生成 `lib/skills/leo-classify-eval/uv.lock`；skill 目录下没有 `.venv`。

- [ ] **Step 3: Write the failing test**

Create `lib/skills/leo-classify-eval/tests/test_stats.py`:

```python
import numpy as np
import pytest
from scipy.stats import binomtest

from evalkit.stats import mcnemar, paired_diff, percentile_ci, resample_counts, wilson_interval


@pytest.mark.parametrize("k,n", [(40, 50), (0, 10), (10, 10), (3, 7), (990, 1000)])
def test_wilson_matches_scipy(k, n):
    ci = binomtest(k, n).proportion_ci(confidence_level=0.95, method="wilson")
    assert wilson_interval(k, n) == pytest.approx([ci.low, ci.high], abs=1e-6)


def test_wilson_empty_is_none():
    assert wilson_interval(0, 0) is None


def test_resample_counts_keeps_total_and_shape():
    draws = resample_counts([[5, 1], [2, 12]], times=200, seed=1)
    assert draws.shape == (200, 2, 2)
    assert set(draws.sum(axis=(1, 2)).tolist()) == {20}


def test_resample_counts_is_reproducible():
    a = resample_counts([3, 4, 5], times=50, seed=42)
    b = resample_counts([3, 4, 5], times=50, seed=42)
    assert np.array_equal(a, b)


def test_resample_counts_empty():
    assert resample_counts([0, 0], times=10).shape == (0, 2)


def test_percentile_ci_ignores_nan():
    assert percentile_ci([np.nan, np.nan]) is None
    assert percentile_ci([0.5] * 10 + [np.nan]) == [0.5, 0.5]


def test_paired_diff_identical_models():
    out = paired_diff(np.zeros(100))
    assert out == {"ci": [0.0, 0.0], "p_value": 1.0}


def test_paired_diff_clear_improvement():
    out = paired_diff(np.full(100, 0.05))
    assert out["p_value"] == 0.0
    assert out["ci"] == [0.05, 0.05]


def test_mcnemar_exact_branch():
    out = mcnemar(2, 8)
    assert out["method"] == "exact"
    assert out["p_value"] == pytest.approx(binomtest(2, 10, 0.5).pvalue, abs=1e-6)


def test_mcnemar_chi2_branch():
    out = mcnemar(10, 30)
    assert out["method"] == "chi2_cc"
    assert out["statistic"] == pytest.approx((20 - 1) ** 2 / 40)
    assert out["p_value"] < 0.01


def test_mcnemar_no_disagreement():
    assert mcnemar(0, 0)["p_value"] == 1.0
```

- [ ] **Step 4: Run test to verify it fails**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_stats.py -q
```

Expected: 首次运行会在 `~/.shrimp/skills/leo-classify-eval/.venv` 创建环境；随后 collection error `ModuleNotFoundError: No module named 'evalkit.stats'`

- [ ] **Step 5: Write the implementation**

Create `lib/skills/leo-classify-eval/scripts/evalkit/stats.py`:

```python
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
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_stats.py -q
```

Expected: `15 passed`

- [ ] **Step 7: Commit**

```bash
git add lib/skills/leo-classify-eval/pyproject.toml lib/skills/leo-classify-eval/uv.lock lib/skills/leo-classify-eval/scripts/evalkit/__init__.py lib/skills/leo-classify-eval/scripts/evalkit/stats.py lib/skills/leo-classify-eval/tests/test_stats.py
git commit -m "feat(leo-classify-eval): scaffold uv project and add statistics helpers"
```

### Task 2: 指标计算

**Files:**
- Create: `lib/skills/leo-classify-eval/scripts/evalkit/metrics.py`
- Test: `lib/skills/leo-classify-eval/tests/test_metrics.py`

**Interfaces:**
- Consumes: Task 1 的 `INVALID`、`InputError`、`wilson_interval`、`resample_counts`、`percentile_ci`、`paired_diff`、`mcnemar`
- Produces: 
  - `binary_metrics(tp, fp, fn, tn, times=1000, seed=42) -> dict`：`{"kind": "binary", "counts": {tp,fp,fn,tn}, "totals": {total, actual_positive, actual_negative, predicted_positive, predicted_negative}, "metrics": {accuracy, precision, recall, specificity, fpr, f1}}`，每个指标是 `{"value": float|None, "ci": [lo, hi]|None, "reason": "denominator_zero"|None}`
  - `guided_to_counts(total, selected, selected_wrong, missed) -> {"tp","fp","fn","tn"}`
  - `resolve_invalid(y_true, y_pred, positive, negative) -> list[str]`
  - `binary_counts(y_true, y_pred, positive) -> {"tp","fp","fn","tn"}`
  - `error_types(y_true, y_pred, positive=None) -> list[str | None]`
  - `multiclass_metrics(y_true, y_pred, classes, times=1000, seed=42) -> dict`：`{"kind": "multiclass", "labels", "matrix_labels", "confusion", "accuracy", "averages": {macro|micro|weighted: {precision, recall, f1}}, "per_class": [{label, precision, recall, f1, support}], "top_confusions": [{true, pred, count}]}`
  - `threshold_scan(y_true, scores, positive, min_recall=0.9) -> dict`：`{"available": False, "reason"}` 或 `{"available": True, "rows", "best_f1", "min_recall", "at_min_recall", "pr_auc", "roc_auc"}`
  - `compare_models(y_true, pred_a, pred_b, classes, positive=None, negative=None, times=1000, seed=42) -> dict`：`{"kind": "compare", "mode", "n", "rows": [{metric, a, b, diff, ci, p_value, test}], "mcnemar", "primary": "f1"|"macro_f1"}`

- [ ] **Step 1: Write the failing test**

Create `lib/skills/leo-classify-eval/tests/test_metrics.py`:

```python
import numpy as np
import pytest
from sklearn.metrics import precision_recall_fscore_support

from evalkit import INVALID, InputError
from evalkit.metrics import (
    binary_counts,
    binary_metrics,
    compare_models,
    error_types,
    guided_to_counts,
    multiclass_metrics,
    resolve_invalid,
    threshold_scan,
)


def test_binary_matches_node_spam_scenario():
    m = binary_metrics(40, 10, 20, 130)["metrics"]
    assert m["precision"]["value"] == 0.8
    assert m["recall"]["value"] == 0.666667
    assert m["accuracy"]["value"] == 0.85
    assert m["f1"]["value"] == 0.727273
    lo, hi = m["f1"]["ci"]
    assert lo < 0.727273 < hi


def test_binary_imbalance_precision_unavailable():
    m = binary_metrics(0, 0, 10, 990)["metrics"]
    assert m["precision"] == {"value": None, "ci": None, "reason": "denominator_zero"}
    assert m["recall"]["value"] == 0.0
    assert m["accuracy"]["value"] == 0.99


def test_binary_all_negative_f1_unavailable():
    assert binary_metrics(0, 0, 0, 5)["metrics"]["f1"]["reason"] == "denominator_zero"


@pytest.mark.parametrize("bad", [-1, 1.5, "x", float("nan")])
def test_binary_rejects_bad_counts(bad):
    with pytest.raises(InputError, match="TP"):
        binary_metrics(bad, 0, 0, 1)


def test_guided_matches_node():
    assert guided_to_counts(200, 50, 10, 20) == {"tp": 40, "fp": 10, "fn": 20, "tn": 130}


@pytest.mark.parametrize(
    "args,message",
    [((10, 12, 0, 0), "总数"), ((10, 4, 5, 0), "挑出的数量"), ((10, 4, 0, 7), "没挑出")],
)
def test_guided_rejects_contradictions(args, message):
    with pytest.raises(InputError, match=message):
        guided_to_counts(*args)


def test_resolve_invalid_always_wrong():
    out = resolve_invalid(["1", "0"], [INVALID, INVALID], "1", "0")
    assert out == ["0", "1"]
    assert binary_counts(["1", "0"], out, "1") == {"tp": 0, "fp": 1, "fn": 1, "tn": 0}


def test_error_types():
    assert error_types(["1", "0", "1"], ["1", "1", "0"], "1") == [None, "FP", "FN"]
    assert error_types(["a", "b"], ["a", "c"]) == [None, "b→c"]


def test_multiclass_matches_sklearn():
    y_true = ["a", "a", "a", "b", "b", "c", "c", "c", "c", "a"]
    y_pred = ["a", "b", "a", "b", "c", "c", "c", "a", INVALID, "a"]
    classes = ["a", "b", "c"]
    result = multiclass_metrics(y_true, y_pred, classes, times=200)
    for avg in ("macro", "micro", "weighted"):
        p, r, f, _ = precision_recall_fscore_support(
            y_true, y_pred, labels=classes, average=avg, zero_division=0
        )
        got = result["averages"][avg]
        assert got["precision"]["value"] == pytest.approx(p, abs=1e-6)
        assert got["recall"]["value"] == pytest.approx(r, abs=1e-6)
        assert got["f1"]["value"] == pytest.approx(f, abs=1e-6)
    assert result["accuracy"]["value"] == 0.6
    assert result["matrix_labels"] == ["a", "b", "c", INVALID]
    assert result["top_confusions"][0]["count"] == 1
    assert [row["support"] for row in result["per_class"]] == [4, 2, 4]


def test_threshold_scan_finds_best_and_min_recall():
    y = ["1", "1", "1", "1", "0", "0", "0", "0", "0", "0"]
    s = [0.9, 0.8, 0.7, 0.3, 0.6, 0.4, 0.2, 0.1, 0.05, 0.02]
    scan = threshold_scan(y, s, "1", min_recall=1.0)
    assert scan["available"]
    assert scan["best_f1"]["threshold"] == 0.7
    assert scan["best_f1"]["f1"] == pytest.approx(0.857143, abs=1e-6)
    assert scan["at_min_recall"]["threshold"] == 0.3
    assert scan["at_min_recall"]["recall"] == 1.0
    assert 0 < scan["pr_auc"] <= 1
    assert scan["roc_auc"] == pytest.approx(22 / 24, abs=1e-6)
    assert len(scan["rows"]) <= 10


def test_threshold_scan_needs_both_classes():
    assert threshold_scan(["1", "1"], [0.2, 0.9], "1")["available"] is False


def test_compare_identical_models_not_significant():
    y = ["1", "0"] * 20
    pred = ["1", "1", "0", "0"] * 10
    result = compare_models(y, pred, pred, ["0", "1"], "1", "0", times=200)
    for row in result["rows"]:
        assert row["diff"] == 0
        assert row["p_value"] == 1.0
    assert result["primary"] == "f1"


def test_compare_detects_better_model():
    rng = np.random.default_rng(0)
    y = [str(v) for v in rng.integers(0, 2, 400)]
    good = list(y)
    bad = [("0" if v == "1" else "1") if i % 3 == 0 else v for i, v in enumerate(y)]
    result = compare_models(y, bad, good, ["0", "1"], "1", "0", times=300)
    acc = next(row for row in result["rows"] if row["metric"] == "accuracy")
    assert acc["diff"] > 0.3
    assert acc["test"] == "mcnemar"
    assert acc["p_value"] < 0.001
    f1 = next(row for row in result["rows"] if row["metric"] == "f1")
    assert f1["ci"][0] > 0


def test_compare_multiclass_uses_macro_f1():
    y = ["a", "b", "c"] * 10
    result = compare_models(y, y, ["a"] * 30, ["a", "b", "c"], times=100)
    assert [row["metric"] for row in result["rows"]] == ["accuracy", "macro_f1"]
    assert result["mode"] == "multiclass"
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_metrics.py -q
```

Expected: collection error `ModuleNotFoundError: No module named 'evalkit.metrics'`

- [ ] **Step 3: Write the implementation**

Create `lib/skills/leo-classify-eval/scripts/evalkit/metrics.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_metrics.py -q
```

Expected: `19 passed`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-classify-eval/scripts/evalkit/metrics.py lib/skills/leo-classify-eval/tests/test_metrics.py
git commit -m "feat(leo-classify-eval): add binary, multiclass, threshold and comparison metrics"
```

### Task 3: 数据读取与标签归一

**Files:**
- Create: `lib/skills/leo-classify-eval/scripts/evalkit/loader.py`
- Test: `lib/skills/leo-classify-eval/tests/test_loader.py`

**Interfaces:**
- Consumes: Task 1 的 `INVALID`、`InputError`
- Produces: 
  - 常量 `TRUE_CANDIDATES`、`PRED_CANDIDATES`、`SCORE_CANDIDATES`、`NESTED_B = "__b__"`
  - `Dataset`（dataclass）：`records, row_numbers, y_true, preds: dict[str, list[str]], scores, labels, positive, negative, notes`；属性 `kind`；方法 `summary() -> dict`
  - `load_records(path) -> list[dict]`
  - `get_path(record, key)`：先按完整键取，再按点号路径取
  - `resolve_key(records, explicit, candidates, role, required=True) -> str | None`
  - `build_dataset(records, true_key, pred_keys: dict[str, str], score_key=None, positive=None, pred_regex=None, threshold=0.5) -> Dataset`；没有预测列时生成 `preds["模型"]`
  - `merge_by_id(records_a, records_b, id_key) -> (merged_records, notes)`，第二个文件的记录挂在 `__b__` 键下

- [ ] **Step 1: Write the failing test**

Create `lib/skills/leo-classify-eval/tests/test_loader.py`:

```python
import json

import pandas as pd
import pytest

from evalkit import INVALID, InputError
from evalkit.loader import (
    PRED_CANDIDATES,
    TRUE_CANDIDATES,
    build_dataset,
    get_path,
    load_records,
    merge_by_id,
    resolve_key,
)


def write_csv(path, text):
    path.write_text(text, encoding="utf-8")
    return path


def test_load_csv_and_detect_chinese_columns(tmp_path):
    f = write_csv(tmp_path / "d.csv", "编号,标签,预测\n1,是,是\n2,否,是\n")
    records = load_records(f)
    assert resolve_key(records, None, TRUE_CANDIDATES, "真实标签") == "标签"
    assert resolve_key(records, None, PRED_CANDIDATES, "预测") == "预测"


def test_ambiguous_and_missing_columns(tmp_path):
    records = load_records(write_csv(tmp_path / "d.csv", "label,gold,x\n1,1,1\n"))
    with pytest.raises(InputError, match="多个列"):
        resolve_key(records, None, TRUE_CANDIDATES, "真实标签")
    with pytest.raises(InputError, match="可用列：label, gold, x"):
        resolve_key(records, None, PRED_CANDIDATES, "预测")
    with pytest.raises(InputError, match="找不到"):
        resolve_key(records, "nope", TRUE_CANDIDATES, "真实标签")


def test_load_xlsx(tmp_path):
    f = tmp_path / "d.xlsx"
    pd.DataFrame({"label": [1, 0], "pred": [1, 1], "score": [0.9, 0.6]}).to_excel(f, index=False)
    records = load_records(f)
    ds = build_dataset(records, "label", {"模型": "pred"}, score_key="score")
    assert ds.y_true == ["1", "0"]
    assert ds.scores == [0.9, 0.6]
    assert ds.positive == "1"


def test_unsupported_and_missing_file(tmp_path):
    with pytest.raises(InputError, match="不支持"):
        load_records(write_csv(tmp_path / "d.txt", "x"))
    with pytest.raises(InputError, match="找不到文件"):
        load_records(tmp_path / "none.csv")


def test_get_path_nested():
    rec = {"meta": {"gold": "Pos"}, "a.b": 1}
    assert get_path(rec, "meta.gold") == "Pos"
    assert get_path(rec, "a.b") == 1
    assert get_path(rec, "meta.none") is None


def test_boolean_normalization_and_positive():
    records = [{"y": "是", "p": "否"}, {"y": "否", "p": "否"}, {"y": "是", "p": "是"}]
    ds = build_dataset(records, "y", {"模型": "p"})
    assert ds.y_true == ["1", "0", "1"]
    assert (ds.positive, ds.negative) == ("1", "0")
    assert any("布尔值" in note for note in ds.notes)


def test_positive_must_be_given_for_text_labels():
    records = [{"y": "spam", "p": "ham"}, {"y": "ham", "p": "ham"}]
    with pytest.raises(InputError, match="--positive"):
        build_dataset(records, "y", {"模型": "p"})
    ds = build_dataset(records, "y", {"模型": "p"}, positive="Spam")
    assert (ds.positive, ds.negative) == ("spam", "ham")


def test_multiclass_has_no_positive():
    records = [{"y": "a", "p": "b"}, {"y": "b", "p": "c"}, {"y": "c", "p": "c"}]
    ds = build_dataset(records, "y", {"模型": "p"})
    assert ds.kind == "multiclass"
    assert ds.labels == ["a", "b", "c"]


def test_regex_extraction_failure_counts_as_invalid():
    records = [
        {"meta": {"gold": "positive"}, "out": "答案：positive"},
        {"meta": {"gold": "negative"}, "out": "我不确定"},
        {"meta": {"gold": "negative"}, "out": "答案: negative"},
    ]
    ds = build_dataset(records, "meta.gold", {"模型": "out"}, pred_regex=r"答案[:：]\s*(\S+)")
    assert ds.preds["模型"] == ["1", INVALID, "0"]
    assert any("1 条预测无法解析" in note and "第 2 条" in note for note in ds.notes)


def test_missing_truth_rows_are_dropped():
    records = [{"y": "1", "p": "1"}, {"y": "", "p": "0"}, {"y": "0", "p": "0"}]
    ds = build_dataset(records, "y", {"模型": "p"})
    assert ds.row_numbers == [1, 3]
    assert "1 行真实标签为空" in ds.notes[0]


def test_score_only_uses_threshold():
    records = [{"y": "1", "s": "0.7"}, {"y": "0", "s": "0.2"}, {"y": "1", "s": "0.4"}]
    ds = build_dataset(records, "y", {}, score_key="s")
    assert ds.preds["模型"] == ["1", "0", "0"]


def test_bad_score_reports_row():
    with pytest.raises(InputError, match="第 2 条的分数"):
        build_dataset([{"y": "1", "s": "0.1"}, {"y": "0", "s": "abc"}], "y", {}, score_key="s")


def test_merge_by_id(tmp_path):
    a = [{"id": "1", "y": "1"}, {"id": "2", "y": "0"}, {"id": "3", "y": "1"}]
    b = [{"id": "1", "p": "1"}, {"id": "2", "p": "1"}, {"id": "9", "p": "0"}]
    merged, notes = merge_by_id(a, b, "id")
    assert [get_path(r, "__b__.p") for r in merged] == ["1", "1"]
    assert "只在第一个文件 1 条、只在第二个文件 1 条" in notes[0]
    with pytest.raises(InputError, match="重复"):
        merge_by_id(a, b + [{"id": "1", "p": "0"}], "id")


def test_jsonl_bad_line(tmp_path):
    f = tmp_path / "d.jsonl"
    f.write_text(json.dumps({"y": 1}) + "\n{oops\n", encoding="utf-8")
    with pytest.raises(InputError, match="第 2 行"):
        load_records(f)
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_loader.py -q
```

Expected: collection error `ModuleNotFoundError: No module named 'evalkit.loader'`

- [ ] **Step 3: Write the implementation**

Create `lib/skills/leo-classify-eval/scripts/evalkit/loader.py`:

```python
"""读取数据、识别列、归一标签、推断正类、按 ID 对齐两个文件。"""
import json
import math
import re
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from . import INVALID, InputError

TRUE_CANDIDATES = ("label", "y_true", "gold", "truth", "actual", "ground_truth", "标签", "真实值")
PRED_CANDIDATES = ("pred", "prediction", "y_pred", "predict", "预测", "预测值")
SCORE_CANDIDATES = ("score", "prob", "probability", "confidence", "置信度")
TRUE_WORDS = {"1", "1.0", "true", "yes", "y", "是", "positive", "pos"}
FALSE_WORDS = {"0", "0.0", "false", "no", "n", "否", "negative", "neg"}
NESTED_B = "__b__"


@dataclass
class Dataset:
    records: list[dict]
    row_numbers: list[int]
    y_true: list[str]
    preds: dict[str, list[str]]
    scores: list[float] | None
    labels: list[str]
    positive: str | None
    negative: str | None
    notes: list[str] = field(default_factory=list)

    @property
    def kind(self) -> str:
        return "binary" if self.positive is not None else "multiclass"

    def summary(self) -> dict:
        return {
            "rows": len(self.y_true),
            "kind": self.kind,
            "labels": self.labels,
            "positive": self.positive,
            "negative": self.negative,
            "notes": self.notes,
        }


def load_records(path) -> list[dict]:
    path = Path(path)
    if not path.is_file():
        raise InputError(f"找不到文件：{path}")
    suffix = path.suffix.lower()
    if suffix == ".csv":
        records = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig").to_dict("records")
    elif suffix == ".xlsx":
        records = pd.read_excel(path, dtype=str).fillna("").to_dict("records")
    elif suffix == ".jsonl":
        records = []
        with path.open(encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                if not line.strip():
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise InputError(f"第 {lineno} 行不是合法 JSON：{exc.msg}") from None
                if not isinstance(item, dict):
                    raise InputError(f"第 {lineno} 行必须是 JSON 对象")
                records.append(item)
    elif suffix == ".json":
        try:
            records = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise InputError(f"不是合法 JSON：{exc.msg}") from None
        if not isinstance(records, list) or not all(isinstance(x, dict) for x in records):
            raise InputError(".json 文件必须是对象数组")
    else:
        raise InputError(f"不支持的文件格式：{suffix or '无扩展名'}（支持 .csv / .jsonl / .json / .xlsx）")
    if not records:
        raise InputError(f"文件里没有数据：{path}")
    return records


def columns_of(records: list[dict]) -> list[str]:
    return list(dict.fromkeys(str(key) for rec in records for key in rec))


def get_path(record: dict, key: str):
    """先按完整列名取值，取不到再按点号路径逐层取（如 meta.label）。"""
    if key in record:
        return record[key]
    value = record
    for part in key.split("."):
        if not isinstance(value, dict) or part not in value:
            return None
        value = value[part]
    return value


def resolve_key(records, explicit, candidates, role: str, required: bool = True) -> str | None:
    columns = columns_of(records)
    if explicit:
        if not any(get_path(rec, explicit) is not None for rec in records):
            raise InputError(f"指定的{role}字段「{explicit}」在数据里找不到。可用列：{', '.join(columns)}")
        return explicit
    matches = [c for c in columns if c.strip().lower() in candidates]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise InputError(f"有多个列像是{role}：{', '.join(matches)}，请用参数指定其中一个。")
    if required:
        raise InputError(f"找不到{role}列，请用参数指定。可用列：{', '.join(columns)}")
    return None


def clean(value) -> str | None:
    """单元格 → 去空格、转小写的文本；空值返回 None。"""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    text = str(value).strip().lower()
    return text or None


def _extract(raw, pattern: re.Pattern | None) -> str | None:
    if pattern is None:
        return clean(raw)
    match = pattern.search("" if raw is None else str(raw))
    if not match:
        return None
    return clean(match.group(1) if match.groups() else match.group(0))


def _to_score(value, row: int) -> float:
    try:
        score = float(str(value).strip())
    except (TypeError, ValueError):
        raise InputError(f"第 {row} 条的分数「{value}」不是数字") from None
    if math.isnan(score):
        raise InputError(f"第 {row} 条的分数为空")
    return score


def _infer_positive(labels: list[str], explicit: str | None) -> tuple[str | None, str | None]:
    if explicit is not None:
        others = [label for label in labels if label != explicit]
        if explicit not in labels and len(labels) != 1:
            raise InputError(f"--positive「{explicit}」不在标签里：{', '.join(labels)}")
        if len(others) > 1:
            raise InputError(f"--positive 只用于二分类，当前数据有 {len(labels)} 个类别")
        return explicit, (others[0] if others else "__other__")
    if len(labels) > 2:
        return None, None
    if set(labels) <= {"0", "1"}:
        return "1", "0"
    raise InputError(f"无法判断哪个是正类，请用 --positive 指定：{' / '.join(labels)}")


def build_dataset(
    records: list[dict],
    true_key: str,
    pred_keys: dict[str, str],
    score_key: str | None = None,
    positive: str | None = None,
    pred_regex: str | None = None,
    threshold: float = 0.5,
) -> Dataset:
    try:
        pattern = re.compile(pred_regex) if pred_regex else None
    except re.error as exc:
        raise InputError(f"--pred-regex 不是合法正则：{exc}") from None

    kept, rows, truths = [], [], []
    preds = {name: [] for name in pred_keys}
    raws = {name: [] for name in pred_keys}
    scores = [] if score_key else None
    for i, rec in enumerate(records, 1):
        truth = clean(get_path(rec, true_key))
        if truth is None:
            continue
        kept.append(rec)
        rows.append(i)
        truths.append(truth)
        for name, key in pred_keys.items():
            raw = get_path(rec, key)
            raws[name].append(raw)
            preds[name].append(_extract(raw, pattern))
        if score_key:
            scores.append(_to_score(get_path(rec, score_key), i))
    if not truths:
        raise InputError("没有可用的数据行（真实标签全部为空）")

    notes = []
    dropped = len(records) - len(kept)
    if dropped:
        notes.append(f"有 {dropped} 行真实标签为空，已剔除。")

    seen = set(truths) | {p for values in preds.values() for p in values if p is not None}
    positive = clean(positive)
    if seen <= TRUE_WORDS | FALSE_WORDS:
        to_bool = lambda v: None if v is None else ("1" if v in TRUE_WORDS else "0")  # noqa: E731
        truths = [to_bool(v) for v in truths]
        preds = {name: [to_bool(v) for v in values] for name, values in preds.items()}
        if positive is not None:
            positive = to_bool(positive) if positive in TRUE_WORDS | FALSE_WORDS else positive
        if not seen <= {"0", "1"}:
            notes.append("标签已按布尔值归一：是/true/yes 等记为 1，否/false/no 等记为 0。")

    for name, values in preds.items():
        bad = [i for i, v in enumerate(values) if v is None]
        if bad:
            examples = "；".join(f"第 {rows[i]} 条「{str(raws[name][i])[:40]}」" for i in bad[:3])
            notes.append(f"{name} 有 {len(bad)} 条预测无法解析，按预测错误计入。示例：{examples}")
            preds[name] = [INVALID if v is None else v for v in values]

    labels = sorted(set(truths) | {p for values in preds.values() for p in values if p != INVALID})
    positive, negative = _infer_positive(labels, positive)
    if positive is not None:
        labels = sorted({positive, negative})

    if not pred_keys:
        if positive is None:
            raise InputError("只有分数列时只支持二分类")
        preds = {"模型": [positive if s >= threshold else negative for s in scores]}
        notes.append(f"没有预测列，按分数 ≥ {threshold} 判为正类。")
    if scores is not None and positive is None:
        notes.append("分数列只在二分类时用于阈值分析，本次忽略。")

    return Dataset(kept, rows, truths, preds, scores, labels, positive, negative, notes)


def merge_by_id(records_a: list[dict], records_b: list[dict], id_key: str) -> tuple[list[dict], list[str]]:
    """把第二个文件按 ID 挂到第一个文件的记录上（键名 __b__），返回合并结果和说明。"""
    def key_of(rec):
        value = get_path(rec, id_key)
        return None if value is None else str(value).strip()

    index = {}
    for rec in records_b:
        key = key_of(rec)
        if key is None:
            continue
        if key in index:
            raise InputError(f"第二个文件里 ID「{key}」重复")
        index[key] = rec
    merged, matched = [], set()
    for rec in records_a:
        key = key_of(rec)
        if key in index:
            merged.append({**rec, NESTED_B: index[key]})
            matched.add(key)
    if not merged:
        raise InputError(f"两个文件按「{id_key}」对齐后没有共同样本")
    only_a, only_b = len(records_a) - len(merged), len(index) - len(matched)
    notes = []
    if only_a or only_b:
        notes.append(
            f"按「{id_key}」对齐：{len(merged)} 条两边都有；只在第一个文件 {only_a} 条、只在第二个文件 {only_b} 条，未参与对比。"
        )
    return merged, notes
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_loader.py -q
```

Expected: `14 passed`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-classify-eval/scripts/evalkit/loader.py lib/skills/leo-classify-eval/tests/test_loader.py
git commit -m "feat(leo-classify-eval): load labeled datasets and normalize labels"
```

### Task 4: 报告渲染与中文解读

**Files:**
- Create: `lib/skills/leo-classify-eval/scripts/evalkit/report.py`
- Test: `lib/skills/leo-classify-eval/tests/test_report.py`

**Interfaces:**
- Consumes: Task 2 的 `binary_metrics`、`multiclass_metrics` 返回结构；`threshold_scan`、`compare_models` 返回结构
- Produces: 
  - `binary_narrative(result) -> list[str]`、`render_binary(result) -> str`
  - `multiclass_narrative(result) -> list[str]`、`render_multiclass(result) -> str`
  - `render_thresholds(scan) -> str`
  - `verdict(row) -> str`、`render_compare(result) -> str`

- [ ] **Step 1: Write the failing test**

Create `lib/skills/leo-classify-eval/tests/test_report.py`:

```python
from evalkit.metrics import binary_metrics, multiclass_metrics
from evalkit.report import binary_narrative, render_binary, render_multiclass, verdict


def test_spam_narrative():
    lines = binary_narrative(binary_metrics(40, 10, 20, 130, times=50))
    assert lines[0] == "一共 200 条样本：实际正例 60，实际负例 140。"
    assert "精准率 80.0%" in lines[3]
    assert "召回率 66.7%" in lines[4]
    assert "比较接近" in lines[-1]


def test_imbalance_narrative_warns():
    lines = binary_narrative(binary_metrics(0, 0, 10, 990, times=50))
    assert "精准率无法计算" in lines[3]
    assert any("准确率容易虚高" in line for line in lines)
    assert any("正例只有 10 个" in line for line in lines)


def test_render_binary_has_tables():
    text = render_binary(binary_metrics(40, 10, 20, 130, times=50))
    assert "| 实际为正 | TP 40 | FN 20 | 60 |" in text
    assert "| 精准率 Precision | 80.0% |" in text


def test_render_multiclass_has_matrix():
    result = multiclass_metrics(["a", "b", "a"], ["a", "a", "a"], ["a", "b"], times=50)
    text = render_multiclass(result)
    assert "| 真实 \\ 预测 | a | b |" in text
    assert "真实「b」被判成「a」" in text
    assert "- 真实「b」→ 判成「a」：1 条" in text


def test_verdict_wording():
    base = {"metric": "f1", "a": 0.7, "b": 0.731}
    assert verdict({**base, "diff": 0.031, "p_value": 0.2}) == (
        "F1：B 比 A 高 3.1 个点，但统计上还分不出高低（p = 0.2000），建议增加样本。"
    )
    assert "显著" in verdict({**base, "diff": 0.031, "p_value": 0.01})
    assert verdict({**base, "diff": 0.0, "p_value": 1.0}).startswith("F1：A 和 B 一样")
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_report.py -q
```

Expected: collection error `ModuleNotFoundError: No module named 'evalkit.report'`

- [ ] **Step 3: Write the implementation**

Create `lib/skills/leo-classify-eval/scripts/evalkit/report.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_report.py -q
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-classify-eval/scripts/evalkit/report.py lib/skills/leo-classify-eval/tests/test_report.py
git commit -m "feat(leo-classify-eval): render markdown reports with Chinese narrative"
```

### Task 5: 命令行入口

**Files:**
- Create: `lib/skills/leo-classify-eval/scripts/eval_metrics.py`
- Test: `lib/skills/leo-classify-eval/tests/test_cli.py`

**Interfaces:**
- Consumes: Task 2、3、4 的全部公开函数与 `Dataset`
- Produces: 
  - `main(argv: list[str] | None = None) -> int`：返回 0 或 2
  - 子命令 `eval`、`counts`、`guided`、`compare`；参数见 spec 第 4 节

- [ ] **Step 1: Write the failing test**

Create `lib/skills/leo-classify-eval/tests/test_cli.py`:

```python
import csv
import json

from eval_metrics import main


def run(capsys, *argv):
    code = main(list(argv))
    out = capsys.readouterr()
    return code, out.out, out.err


def test_eval_binary_csv_with_score(tmp_path, capsys):
    f = tmp_path / "d.csv"
    f.write_text(
        "编号,标签,预测,置信度\n"
        "1,是,是,0.9\n2,是,否,0.4\n3,否,是,0.7\n4,否,否,0.1\n5,是,是,0.8\n6,否,否,0.3\n",
        encoding="utf-8",
    )
    errors = tmp_path / "out" / "errors.csv"
    code, out, _ = run(capsys, "eval", str(f), "--bootstrap", "100", "--errors-out", str(errors))
    assert code == 0
    assert "正类 = 1（负类 = 0）" in out
    assert "| 实际为正 | TP 2 | FN 1 | 3 |" in out
    assert "### 阈值分析" in out
    assert "共 2 条，已导出" in out
    with errors.open(encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert [(r["编号"], r["error_type"]) for r in rows] == [("2", "FN"), ("3", "FP")]


def test_eval_json_multiclass(tmp_path, capsys):
    f = tmp_path / "d.jsonl"
    lines = [{"label": "a", "pred": "a"}, {"label": "b", "pred": "c"}, {"label": "c", "pred": "c"}]
    f.write_text("\n".join(json.dumps(x) for x in lines), encoding="utf-8")
    code, out, _ = run(capsys, "eval", str(f), "--json", "--bootstrap", "50")
    assert code == 0
    data = json.loads(out)
    assert data["dataset"]["kind"] == "multiclass"
    assert data["result"]["accuracy"]["value"] == 0.666667


def test_eval_llm_jsonl(tmp_path, capsys):
    f = tmp_path / "llm.jsonl"
    lines = [
        {"meta": {"gold": "positive"}, "output": "答案：positive"},
        {"meta": {"gold": "negative"}, "output": "不知道"},
        {"meta": {"gold": "negative"}, "output": "答案：negative"},
    ]
    f.write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines), encoding="utf-8")
    code, out, _ = run(
        capsys, "eval", str(f), "--true-field", "meta.gold", "--pred-field", "output",
        "--pred-regex", r"答案[:：]\s*(\S+)", "--bootstrap", "50",
    )
    assert code == 0
    assert "1 条预测无法解析" in out
    assert "| 实际为负 | FP 1 | TN 1 | 2 |" in out


def test_eval_bad_column_exits_2(tmp_path, capsys):
    f = tmp_path / "d.csv"
    f.write_text("a,b\n1,0\n", encoding="utf-8")
    code, out, err = run(capsys, "eval", str(f))
    assert code == 2
    assert out == ""
    assert err.startswith("错误：找不到真实标签列")


def test_counts_and_guided(capsys):
    code, out, _ = run(capsys, "counts", "--tp", "40", "--fp", "10", "--fn", "20", "--tn", "130", "--bootstrap", "50")
    assert code == 0 and "80.0%" in out
    code, out, _ = run(
        capsys, "guided", "--total", "200", "--selected", "50", "--selected-wrong", "10", "--missed", "20", "--json"
    )
    assert json.loads(out)["counts"] == {"tp": 40, "fp": 10, "fn": 20, "tn": 130}
    code, _, err = run(capsys, "guided", "--total", "10", "--selected", "12", "--selected-wrong", "0", "--missed", "0")
    assert code == 2 and "总数" in err


def test_compare_single_file(tmp_path, capsys):
    f = tmp_path / "d.csv"
    rows = ["label,a,b"] + ["1,1,1", "0,1,0", "1,0,1", "0,0,0"] * 5
    f.write_text("\n".join(rows), encoding="utf-8")
    code, out, _ = run(capsys, "compare", str(f), "--pred-a", "a", "--pred-b", "b", "--bootstrap", "100")
    assert code == 0
    assert "### 模型对比（共 20 条样本" in out
    assert "F1：B 比 A 高" in out


def test_compare_two_files(tmp_path, capsys):
    a = tmp_path / "a.csv"
    b = tmp_path / "b.csv"
    a.write_text("id,label,pred\n1,1,1\n2,0,1\n3,1,0\n4,0,0\n", encoding="utf-8")
    b.write_text("id,pred\n1,1\n2,0\n3,1\n9,0\n", encoding="utf-8")
    errors = tmp_path / "e.csv"
    code, out, _ = run(
        capsys, "compare", str(a), str(b), "--id", "id", "--bootstrap", "50", "--errors-out", str(errors)
    )
    assert code == 0
    assert "只在第一个文件 1 条、只在第二个文件 1 条" in out
    with errors.open(encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    assert [(r["id"], r["error_a"], r["error_b"]) for r in rows] == [("2", "FP", ""), ("3", "FN", "")]


def test_compare_two_files_needs_id(tmp_path, capsys):
    a = tmp_path / "a.csv"
    a.write_text("label,pred\n1,1\n", encoding="utf-8")
    code, _, err = run(capsys, "compare", str(a), str(a))
    assert code == 2 and "--id" in err
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_cli.py -q
```

Expected: collection error `ModuleNotFoundError: No module named 'eval_metrics'`

- [ ] **Step 3: Write the implementation**

Create `lib/skills/leo-classify-eval/scripts/eval_metrics.py`:

```python
"""leo-classify-eval 命令行入口：eval / counts / guided / compare。"""
import argparse
import json
import sys
from pathlib import Path

import pandas as pd

from evalkit import InputError, loader, metrics, report
from evalkit.loader import NESTED_B, PRED_CANDIDATES, SCORE_CANDIDATES, TRUE_CANDIDATES


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eval_metrics", description="分类评估：计算指标、对比模型、导出错例")
    sub = parser.add_subparsers(dest="command", required=True)

    def add_data_args(p):
        p.add_argument("--true", help="真实标签列名")
        p.add_argument("--true-field", help="JSONL 中真实标签的点号路径，如 meta.label")
        p.add_argument("--positive", help="二分类的正类取值")
        p.add_argument("--pred-regex", help="从预测文本中抽取标签的正则，取第一个捕获组")
        p.add_argument("--errors-out", help="错例导出 CSV 路径")

    def add_output_args(p):
        p.add_argument("--bootstrap", type=int, default=1000, help="bootstrap 次数，默认 1000")
        p.add_argument("--json", action="store_true", help="输出 JSON")

    p_eval = sub.add_parser("eval", help="评测打好标的数据")
    p_eval.add_argument("file")
    add_data_args(p_eval)
    p_eval.add_argument("--pred", help="预测列名")
    p_eval.add_argument("--pred-field", help="JSONL 中预测的点号路径")
    p_eval.add_argument("--score", help="分数 / 概率列名")
    p_eval.add_argument("--min-recall", type=float, default=0.9, help="阈值分析的最低召回率，默认 0.9")
    add_output_args(p_eval)

    p_counts = sub.add_parser("counts", help="直接输入 TP/FP/FN/TN")
    for name in ("tp", "fp", "fn", "tn"):
        p_counts.add_argument(f"--{name}", required=True)
    add_output_args(p_counts)

    p_guided = sub.add_parser("guided", help="用白话问题换算四格数")
    p_guided.add_argument("--total", required=True, help="总共多少条")
    p_guided.add_argument("--selected", required=True, help="模型挑出多少条")
    p_guided.add_argument("--selected-wrong", required=True, help="挑出的里面有几条其实不是")
    p_guided.add_argument("--missed", required=True, help="没挑出的里面漏了几条真正例")
    add_output_args(p_guided)

    p_cmp = sub.add_parser("compare", help="对比两个模型")
    p_cmp.add_argument("file")
    p_cmp.add_argument("file_b", nargs="?", help="第二个模型的结果文件（需配合 --id）")
    add_data_args(p_cmp)
    p_cmp.add_argument("--pred-a", help="模型 A 的预测列 / 点号路径")
    p_cmp.add_argument("--pred-b", help="模型 B 的预测列 / 点号路径")
    p_cmp.add_argument("--id", help="双文件模式下用于对齐样本的 ID 列")
    add_output_args(p_cmp)
    return parser


def _dump(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def _header(source: str, ds: loader.Dataset) -> list[str]:
    lines = [f"数据：{source}，参与计算 {len(ds.y_true)} 条"]
    if ds.positive is not None:
        lines.append(f"类型：二分类，正类 = {ds.positive}（负类 = {ds.negative}）")
    else:
        lines.append(f"类型：多分类，共 {len(ds.labels)} 个类别")
    return lines + ds.notes


def _export_errors(path: str, ds: loader.Dataset, columns: dict[str, list]) -> dict:
    """columns: 列名 → 每行的错误类型（None 表示正确）。至少一列有错的行被导出。"""
    picked = [i for i in range(len(ds.records)) if any(values[i] for values in columns.values())]
    rows = []
    for i in picked:
        row = {k: v for k, v in ds.records[i].items() if k != NESTED_B}
        row.update({name: values[i] or "" for name, values in columns.items()})
        rows.append(row)
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(rows).to_csv(out, index=False, encoding="utf-8-sig")
    examples = [
        {"row": ds.row_numbers[i], "true": ds.y_true[i], **{name: values[i] for name, values in columns.items()}}
        for i in picked[:5]
    ]
    return {"count": len(picked), "path": str(out), "examples": examples}


def _render_errors(info: dict) -> str:
    lines = ["### 错例", "", f"共 {info['count']} 条，已导出到 {info['path']}。"]
    for ex in info["examples"]:
        detail = "，".join(f"{k} = {v}" for k, v in ex.items() if k not in ("row", "true") and v)
        lines.append(f"- 第 {ex['row']} 条：真实 {ex['true']}，{detail}")
    return "\n".join(lines)


def cmd_eval(args) -> str:
    records = loader.load_records(args.file)
    true_key = loader.resolve_key(records, args.true_field or args.true, TRUE_CANDIDATES, "真实标签")
    score_key = loader.resolve_key(records, args.score, SCORE_CANDIDATES, "分数", required=False)
    pred_key = loader.resolve_key(
        records, args.pred_field or args.pred, PRED_CANDIDATES, "预测", required=score_key is None
    )
    ds = loader.build_dataset(
        records,
        true_key,
        {"模型": pred_key} if pred_key else {},
        score_key=score_key,
        positive=args.positive,
        pred_regex=args.pred_regex,
    )
    pred = ds.preds["模型"]
    if ds.positive is not None:
        pred = metrics.resolve_invalid(ds.y_true, pred, ds.positive, ds.negative)
        result = metrics.binary_metrics(**metrics.binary_counts(ds.y_true, pred, ds.positive), times=args.bootstrap)
        body = report.render_binary(result)
    else:
        result = metrics.multiclass_metrics(ds.y_true, pred, ds.labels, times=args.bootstrap)
        body = report.render_multiclass(result)

    scan = None
    if ds.scores is not None and ds.positive is not None:
        scan = metrics.threshold_scan(ds.y_true, ds.scores, ds.positive, args.min_recall)

    errors = None
    if args.errors_out:
        errors = _export_errors(args.errors_out, ds, {"error_type": metrics.error_types(ds.y_true, pred, ds.positive)})

    if args.json:
        return _dump({"dataset": ds.summary(), "result": result, "thresholds": scan, "errors": errors})
    parts = ["\n".join(_header(args.file, ds)), body]
    if scan:
        parts.append(report.render_thresholds(scan))
    if errors:
        parts.append(_render_errors(errors))
    return "\n\n".join(parts)


def cmd_counts(args) -> str:
    result = metrics.binary_metrics(args.tp, args.fp, args.fn, args.tn, times=args.bootstrap)
    return _dump({"result": result}) if args.json else report.render_binary(result)


def cmd_guided(args) -> str:
    counts = metrics.guided_to_counts(args.total, args.selected, args.selected_wrong, args.missed)
    result = metrics.binary_metrics(**counts, times=args.bootstrap)
    if args.json:
        return _dump({"counts": counts, "result": result})
    mapping = (
        f"换算：TP = 挑出且挑对 {counts['tp']}，FP = 挑错 {counts['fp']}，"
        f"FN = 漏掉 {counts['fn']}，TN = 其余 {counts['tn']}"
    )
    return mapping + "\n\n" + report.render_binary(result)


def cmd_compare(args) -> str:
    records = loader.load_records(args.file)
    true_key = loader.resolve_key(records, args.true_field or args.true, TRUE_CANDIDATES, "真实标签")
    notes = []
    if args.file_b:
        if not args.id:
            raise InputError("双文件对比需要用 --id 指定对齐样本的 ID 列")
        records_b = loader.load_records(args.file_b)
        key_a = loader.resolve_key(records, args.pred_a, PRED_CANDIDATES, "模型 A 预测")
        key_b = loader.resolve_key(records_b, args.pred_b, PRED_CANDIDATES, "模型 B 预测")
        records, notes = loader.merge_by_id(records, records_b, args.id)
        key_b = f"{NESTED_B}.{key_b}"
        source = f"{args.file} + {args.file_b}"
    else:
        if not (args.pred_a and args.pred_b):
            raise InputError("单文件对比需要用 --pred-a 和 --pred-b 指定两个模型的预测列")
        key_a = loader.resolve_key(records, args.pred_a, (), "模型 A 预测")
        key_b = loader.resolve_key(records, args.pred_b, (), "模型 B 预测")
        source = args.file

    ds = loader.build_dataset(
        records, true_key, {"模型 A": key_a, "模型 B": key_b},
        positive=args.positive, pred_regex=args.pred_regex,
    )
    ds.notes = notes + ds.notes
    pred_a, pred_b = ds.preds["模型 A"], ds.preds["模型 B"]
    result = metrics.compare_models(
        ds.y_true, pred_a, pred_b, ds.labels, ds.positive, ds.negative, times=args.bootstrap
    )

    errors = None
    if args.errors_out:
        if ds.positive is not None:
            pred_a = metrics.resolve_invalid(ds.y_true, pred_a, ds.positive, ds.negative)
            pred_b = metrics.resolve_invalid(ds.y_true, pred_b, ds.positive, ds.negative)
        errors = _export_errors(args.errors_out, ds, {
            "error_a": metrics.error_types(ds.y_true, pred_a, ds.positive),
            "error_b": metrics.error_types(ds.y_true, pred_b, ds.positive),
        })

    if args.json:
        return _dump({"dataset": ds.summary(), "result": result, "errors": errors})
    parts = ["\n".join(_header(source, ds)), report.render_compare(result)]
    if errors:
        parts.append(_render_errors(errors))
    return "\n\n".join(parts)


HANDLERS = {"eval": cmd_eval, "counts": cmd_counts, "guided": cmd_guided, "compare": cmd_compare}


def main(argv=None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = build_parser().parse_args(argv)
    try:
        output = HANDLERS[args.command](args)
    except InputError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2
    print(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests/test_cli.py -q
```

Expected: `8 passed`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-classify-eval/scripts/eval_metrics.py lib/skills/leo-classify-eval/tests/test_cli.py
git commit -m "feat(leo-classify-eval): add eval, counts, guided and compare CLI"
```

### Task 6: 讲解资料

**Files:**
- Create: `lib/skills/leo-classify-eval/references/glossary.md`
- Create: `lib/skills/leo-classify-eval/references/examples.md`
- Create: `lib/skills/leo-classify-eval/references/stats.md`

**Interfaces:**
- Consumes: Task 5 的 CLI（examples.md 中的命令）
- Produces: SKILL.md 引用的三份讲义

- [ ] **Step 1: Create `lib/skills/leo-classify-eval/references/glossary.md`**

````markdown
# 术语表

讲解时先说"一句话记忆"，再给公式，最后点出常见误区。例子见 [examples.md](examples.md)。

## 四格：TP / FP / FN / TN

先定好"正类"（要找的那一类，比如垃圾邮件、病人、欺诈交易），再看模型判断和真实情况：

| | 模型说"是" | 模型说"不是" |
|---|---|---|
| 真的是 | **TP** 真正例：抓对了 | **FN** 假负例：漏掉了 |
| 真的不是 | **FP** 假正例：误报了 | **TN** 真负例：放对了 |

- **记法**：第二个字母是模型的判断（P = 判为正，N = 判为负）；第一个字母说这个判断对不对（T = 对，F = 错）。
- **误区**：FN 不是"判错的负例"，而是"被错判成负的正例"，也就是漏网之鱼。

## 准确率 Accuracy

- **一句话**：所有判断里，对了多少。
- **公式**：(TP + TN) / (TP + FP + FN + TN)
- **误区**：正例很少时会虚高。1000 封邮件里只有 10 封垃圾邮件，模型全判"正常"，准确率也有 99%，可一封垃圾邮件都没拦住。

## 精准率 Precision（查准率）

- **一句话**：模型说"是"的那些里，有多少真的是。
- **公式**：TP / (TP + FP)
- **关心它的场景**：误报代价高。比如把正常邮件扔进垃圾箱、把好人标成欺诈。
- **误区**：模型一个正例都不报时，分母为 0，精准率无法计算，不是 100%。

## 召回率 Recall（查全率、灵敏度）

- **一句话**：真正的"是"里，模型找回来多少。
- **公式**：TP / (TP + FN)
- **关心它的场景**：漏报代价高。比如漏诊病人、放过危险品。
- **误区**：把所有样本都判成正例，召回率就是 100%，但精准率会很低。召回率必须和精准率一起看。

## 特异度 Specificity

- **一句话**：真正的"不是"里，模型正确放过多少。
- **公式**：TN / (TN + FP)
- 它是"负类的召回率"。

## 误报率 FPR（假阳性率）

- **一句话**：真正的"不是"里，被模型错报成"是"的比例。
- **公式**：FP / (FP + TN) = 1 − 特异度
- ROC 曲线的横轴就是它。

## F1

- **一句话**：精准率和召回率的折中分，两者都高它才高。
- **公式**：2 × 精准率 × 召回率 / (精准率 + 召回率) = 2TP / (2TP + FP + FN)
- **为什么用调和平均**：精准率 100%、召回率 1% 时，普通平均是 50.5%，F1 只有约 2%。只要有一个短板，F1 就会被拉低。

## 混淆矩阵

- **一句话**：把"真实是什么、模型判成什么"的所有组合计数排成一张表。行是真实，列是预测，对角线是判对的。
- 二分类时就是上面的四格表；多分类时是 N×N 表，看对角线以外最大的格子，就知道模型最常把谁认成谁。

## 多分类的三种平均

每个类别都能单独算精准率、召回率、F1，汇总成一个数有三种做法：

| 方式 | 怎么算 | 适合 |
|---|---|---|
| **macro** | 每个类别的指标直接平均，大类小类一视同仁 | 关心小类别也要做好 |
| **micro** | 把所有类别的 TP/FP/FN 加起来再算 | 关心整体每条样本；单标签分类时 micro F1 ≈ 准确率 |
| **weighted** | 按每个类别的样本数加权平均 | 反映真实分布下的整体表现 |

- **误区**：weighted 明显高于 macro，说明大类别表现好、小类别拖后腿，不能只报 weighted。

## 阈值

- **一句话**：模型先给一个分数（比如"有 73% 可能是垃圾邮件"），分数 ≥ 阈值就判为正。
- 阈值调高 → 判正更谨慎 → 精准率升、召回率降；调低则相反。
- 默认 0.5 不一定最好，应按业务更怕误报还是更怕漏报来定。

## PR 曲线与 PR-AUC

- **PR 曲线**：把阈值从高到低扫一遍，每个阈值得到一对（召回率, 精准率），连成的线。
- **PR-AUC**（average precision）：曲线下的面积，0 到 1，越大越好。随机乱猜时约等于正例占比。
- 正例很少时，PR-AUC 比 ROC-AUC 更能看出好坏。

## ROC-AUC

- **一句话**：随机挑一个正例和一个负例，模型给正例打分更高的概率。
- 0.5 = 乱猜，1.0 = 完美排序。
- **误区**：它只看排序，不看阈值；正例极少时可能显得过于乐观。

## 置信区间

- **一句话**：因为样本有限，指标的真实值大概落在哪个范围。95% 区间的意思是：用同样的方法反复抽样估计，大约 95% 的区间会盖住真实值。
- 样本越少，区间越宽。详见 [stats.md](stats.md)。

## p 值

- **一句话**：假如两个模型其实一样好，仅凭运气看到这么大（或更大）差距的概率。
- p < 0.05 通常认为差异"统计上显著"。
- **误区**：p 值不代表差距有多大，也不代表"B 更好的概率"。差距大小看差值和区间。

## McNemar 检验

- **一句话**：比较两个模型在同一批样本上的准确率，只看两者意见不一致的样本：A 对 B 错的有多少，A 错 B 对的有多少。
- 两者都对或都错的样本对"谁更好"没有信息，所以不计入。
````

- [ ] **Step 2: Create `lib/skills/leo-classify-eval/references/examples.md`**

````markdown
# 讲解用例子

选一个最贴近用户场景的例子。讲完概念后，可以用 `counts` 子命令把例子里的数字现场算一遍。

## 1. 渔网捞鱼（入门首选）

池塘里有 100 条鱼，还有很多水草和石头。你撒一网，捞上来 50 样东西，其中 40 条是鱼，10 个是水草和石头。

- 正类 = 鱼。TP = 40（捞到的鱼），FP = 10（捞到的杂物），FN = 60（还留在塘里的鱼）。
- **精准率** = 40 / 50 = 80%：网里的东西，八成是鱼。
- **召回率** = 40 / 100 = 40%：塘里的鱼，只捞上来四成。
- 换一张更大的网：鱼捞得更多（召回率升），杂物也更多（精准率降）。这就是两者的此消彼长。

## 2. 机场安检

正类 = 携带违禁品的旅客。

- **FN**：危险品被放行，代价极高。所以安检宁可多查，也要把召回率拉满。
- **FP**：普通旅客被拦下开包检查，代价是耽误时间。
- 结论：安检门的阈值设得很低，召回率高、精准率低，靠人工复查兜底。

## 3. 垃圾邮件拦截

共 200 封邮件，TP 40，FP 10，FN 20，TN 130。

- 精准率 80%：被扔进垃圾箱的邮件里，八成真是垃圾邮件，两成是被误伤的正常邮件。
- 召回率 66.7%：垃圾邮件里，三分之二被拦住，三分之一漏进了收件箱。
- 准确率 85%。
- 取舍：误伤一封老板的邮件，往往比漏掉一封广告更糟，所以垃圾邮件过滤通常更看重精准率。

命令：`counts --tp 40 --fp 10 --fn 20 --tn 130`

## 4. 疾病筛查

共 200 人，TP 18，FP 30，FN 2，TN 150。

- 召回率 90%：20 个病人里查出了 18 个，只漏了 2 个。
- 精准率 37.5%：被判阳性的 48 人里，只有 18 人真的有病。
- 这是合理的：筛查怕漏诊，阳性的人再做精确复查即可。

命令：`counts --tp 18 --fp 30 --fn 2 --tn 150`

## 5. 类别不平衡陷阱

共 1000 笔交易，其中 10 笔是欺诈。模型偷懒，全部判为"正常"：TP 0，FP 0，FN 10，TN 990。

- 准确率 99%，看起来很好。
- 召回率 0%：一笔欺诈都没抓到。
- 精准率无法计算：模型从没报过欺诈，分母为 0。
- 结论：正例稀少时，准确率几乎没有参考价值，要看召回率、精准率和 PR-AUC。

命令：`counts --tp 0 --fp 0 --fn 10 --tn 990`

## 6. 多分类：客服意图识别

意图有"退款""物流""投诉"三类。

- 每类都能单独算精准率和召回率，例如"投诉"的召回率 = 真投诉里被认出来的比例。
- 如果"物流"样本占九成且表现很好，"投诉"样本少且常被认成"退款"：weighted F1 会很好看，macro F1 会明显低，混淆矩阵里"投诉 → 退款"那一格会很大。
- 改进方向：给"投诉"补数据，或专门优化它和"退款"的区分。

## 7. 模型对比：两个版本谁更好

同一批 500 条样本，旧模型 A 的 F1 是 78%，新模型 B 是 80%。

- 差 2 个点看似进步，但 500 条样本上的运气波动可能就有这么大。
- 用 `compare` 子命令：如果差值的 95% 区间是 [−1.0, +5.0] 个点，包含 0，说明还不能断定 B 更好。
- McNemar 只看分歧样本：假如 A 对 B 错 12 条、A 错 B 对 22 条，B 净多做对 10 条，但 p ≈ 0.12，仍不够显著；要么继续加样本，要么接受"差不多"。
````

- [ ] **Step 3: Create `lib/skills/leo-classify-eval/references/stats.md`**

````markdown
# 统计方法白话版

## 为什么要置信区间

同样是召回率 80%：

- 50 个正例里抓回 40 个：95% 区间约 [67%, 89%]，真实水平可能只有六成多。
- 5000 个正例里抓回 4000 个：95% 区间约 [79%, 81%]，基本就是 80%。

样本越少，单个数字越不可靠。报指标时带上区间，读者才知道这个数能信几分。

## 本 skill 用的方法

| 场景 | 方法 | 白话解释 |
|---|---|---|
| 准确率、精准率、召回率、特异度、误报率 | Wilson 区间 | 比例专用的区间公式，样本少或比例接近 0%、100% 时也不会算出负数或超过 100% |
| F1、macro / micro / weighted 平均 | bootstrap | 见下文 |
| 两个模型的准确率差异 | McNemar 检验 | 见下文 |
| 两个模型的精准率、召回率、F1 差异 | 配对 bootstrap | 见下文 |

## bootstrap：重新抽样看波动

F1 这类指标没有简单的区间公式，就用"模拟重来很多次"的办法：

1. 从原始样本里有放回地随机抽同样多条，组成一份"新数据"。
2. 在新数据上重新算 F1。
3. 重复 1000 次，得到 1000 个 F1。
4. 去掉最低和最高的各 2.5%，剩下的范围就是 95% 区间。

随机种子固定为 42，同样的数据每次运行结果完全一样。

## 配对 bootstrap：两个模型一起重抽

对比模型时，每次重抽都对 A 和 B 用同一批样本，算出"B − A"的差值，重复 1000 次：

- 差值的 95% 区间不包含 0 → 差异比较可信。
- p 值 = 2 × min(差值 ≤ 0 的比例, 差值 ≥ 0 的比例)。

"同一批样本"很重要：有的样本本来就难，两个模型都会错。配对后这部分难度相互抵消，比各算各的更灵敏。

## McNemar：只看意见不一致的样本

两个模型在同一批样本上的结果分四种：都对、都错、A 对 B 错（记 b）、A 错 B 对（记 c）。

- 都对或都错的样本说明不了谁更好，所以忽略。
- 如果两个模型一样好，b 和 c 应该差不多。b 和 c 差得越多，p 值越小。
- b + c < 25 时用精确二项检验，否则用带连续性校正的卡方检验：(|b − c| − 1)² / (b + c)。

## 样本量提醒

- 正例少于 30 个时，报告会提示"区间较宽，结论谨慎"。
- 想把区间缩窄一半，大约需要 4 倍的样本。
````

- [ ] **Step 4: Verify the numbers quoted in the docs**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval python lib/skills/leo-classify-eval/scripts/eval_metrics.py counts --tp 18 --fp 30 --fn 2 --tn 150 | grep -E "精准率 Precision|召回率 Recall"
cd lib/skills/leo-classify-eval/scripts && uv run --project .. python -c "from evalkit.stats import wilson_interval, mcnemar; print(wilson_interval(40, 50), wilson_interval(4000, 5000), mcnemar(12, 22)['p_value'])"; cd -
```

Expected:

```
| 精准率 Precision | 37.5% | ...
| 召回率 Recall | 90.0% | ...
[0.669629, 0.887562] [0.788684, 0.810855] 0.122713
```

与 examples.md（疾病筛查 37.5% / 90%、McNemar p ≈ 0.12）和 stats.md（[67%, 89%]、[79%, 81%]）一致。

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-classify-eval/references
git commit -m "docs(leo-classify-eval): add glossary, examples and statistics primer"
```

### Task 7: SKILL.md、登记与整体验证

**Files:**
- Create: `lib/skills/leo-classify-eval/SKILL.md`
- Modify: `lib/skills/managed-catalog.json`（末尾追加一项）

**Interfaces:**
- Consumes: Task 5 的 CLI、Task 6 的讲义
- Produces: 可被 agent 发现和触发的 skill

- [ ] **Step 1: Create `lib/skills/leo-classify-eval/SKILL.md`**

````markdown
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
````

- [ ] **Step 2: Register in the managed catalog**

在 `lib/skills/managed-catalog.json` 末尾，把最后一项的结尾

```json
      "managed": true
    }
  ]
}
```

替换为

```json
      "managed": true
    },
    {
      "id": "leo-classify-eval",
      "name": "leo-classify-eval",
      "title": "Leo 分类评估实验室",
      "summary": "导入已打标数据集（CSV / JSONL / XLSX / 大模型评测输出）即时计算 TP/FP/FN/TN、准确率、精准率、召回率、F1 及置信区间，支持多分类、阈值选择、两模型显著性对比与错例导出，并用生活化例子讲清每个指标。",
      "category": "research",
      "categoryLabel": "研究与知识",
      "icon": "🎯",
      "featured": true,
      "tags": [
        "classification",
        "metrics",
        "precision",
        "recall",
        "f1",
        "confusion-matrix",
        "model-eval",
        "召回率",
        "精准率",
        "混淆矩阵"
      ],
      "requiresDaemon": false,
      "promoted": true,
      "managed": true
    }
  ]
}
```

（旧结尾只出现一次：只有最后一项后面紧跟 `  ]`。）

- [ ] **Step 3: Validate the catalog and skill discovery**

Run:

```bash
node -e 'const c=require("./lib/skills/managed-catalog.json"); const s=c.skills.find(x=>x.id==="leo-classify-eval"); console.log(s.category, s.title)'
node --test tests/unit/skills-library.test.mjs
```

Expected: 第一行输出 `research Leo 分类评估实验室`；`skills-library` 测试全部通过。

- [ ] **Step 4: Run the full skill test suite**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
uv run --project lib/skills/leo-classify-eval pytest lib/skills/leo-classify-eval/tests -q
```

Expected: `61 passed`

- [ ] **Step 5: Smoke test from another working directory**

Run:

```bash
export UV_PROJECT_ENVIRONMENT="$HOME/.shrimp/skills/leo-classify-eval/.venv"
SKILL_DIR="$PWD/lib/skills/leo-classify-eval"
cd "$(mktemp -d)"
printf 'label,pred,score\n1,1,0.9\n1,0,0.4\n0,1,0.7\n0,0,0.1\n1,1,0.8\n0,0,0.3\n' > demo.csv
uv run --project "$SKILL_DIR" python "$SKILL_DIR/scripts/eval_metrics.py" eval demo.csv --errors-out errors.csv
ls -a "$SKILL_DIR" | grep -c venv; cd -
```

Expected: 输出含 `正类 = 1（负类 = 0）`、`### 阈值分析`、`共 2 条，已导出到 errors.csv`；最后一行为 `0`（skill 目录内没有 venv）。

- [ ] **Step 6: Commit**

```bash
git add lib/skills/leo-classify-eval/SKILL.md lib/skills/managed-catalog.json
git commit -m "feat(leo-classify-eval): add SKILL.md and register managed skill"
```
