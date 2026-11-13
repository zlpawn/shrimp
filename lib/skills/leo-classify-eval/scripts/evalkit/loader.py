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
