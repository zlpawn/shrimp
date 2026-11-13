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
