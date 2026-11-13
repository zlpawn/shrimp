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
