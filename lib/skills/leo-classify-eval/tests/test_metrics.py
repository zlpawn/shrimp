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
