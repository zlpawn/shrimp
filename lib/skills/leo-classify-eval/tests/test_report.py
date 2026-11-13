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
