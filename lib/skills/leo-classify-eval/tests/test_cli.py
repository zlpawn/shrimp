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
