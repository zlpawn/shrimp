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
