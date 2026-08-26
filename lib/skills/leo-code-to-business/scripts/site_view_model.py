#!/usr/bin/env python3
"""Build the deterministic view model consumed by the HTML renderer."""

from __future__ import annotations

import unicodedata
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_contract as contract
import business_knowledge_guard as guard


VIEW_SCHEMA_VERSION = "2.0"
FIXED_VIEW_IDS = (
    "overview",
    "capability_tree",
    "use_case_catalog",
    "use_case_details",
    "workflow_views",
    "state_views",
    "rule_catalog",
    "effect_catalog",
    "actor_permission_views",
    "evolution_views",
    "gap_views",
    "coverage_dashboard",
)
USE_CASE_SECTION_IDS = (
    "summary",
    "trigger_preconditions",
    "main_flow",
    "rules_decisions",
    "effects",
    "success",
    "rejection_failure",
    "recovery",
    "permissions",
    "variants",
    "gaps",
    "evolution",
    "evidence",
)
FIXED_NAVIGATION_LABELS = {
    "overview": "首页",
    "capability_tree": "业务能力",
    "use_case_catalog": "用例目录",
    "workflow_views": "业务流程",
    "state_views": "生命周期与状态",
    "rule_catalog": "业务规则",
    "effect_catalog": "数据与外部影响",
    "actor_permission_views": "角色与权限",
    "evolution_views": "业务演进",
    "gap_views": "未知与冲突",
    "coverage_dashboard": "覆盖率与证据",
}
IMPORTANCE_RANK = {"critical": 0, "high": 1, "normal": 2, "low": 3, None: 4}
PRIORITY_RANK = {"critical": 0, "high": 1, "normal": 2, "low": 3, "unknown": 4, None: 5}
CLAIM_RANK = {
    "confirmed": 0,
    "inferred": 1,
    "document_claim": 2,
    "historical": 3,
    "conflicted": 4,
    "unknown": 5,
    None: 6,
}


def normalize_sort_text(value: Any) -> str:
    return unicodedata.normalize("NFC", str(value or "")).casefold()


def _rank(value: Any, ranks: dict[Any, int]) -> int:
    return ranks.get(value, ranks[None])


def base_sort_key(item: dict[str, Any], *prefixes: tuple[Any, ...]) -> tuple[Any, ...]:
    return (
        *prefixes,
        normalize_sort_text(item.get("title")),
        str(item.get("id", "")),
    )


def use_case_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    return base_sort_key(
        item,
        _rank(item.get("business_priority"), PRIORITY_RANK),
        _rank(item.get("structural_importance"), IMPORTANCE_RANK),
        normalize_sort_text(item.get("capability_sort_key")),
        normalize_sort_text(item.get("family_sort_key")),
        _rank(item.get("lifecycle_stage"), CLAIM_RANK),
    )


def id_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    return base_sort_key(item)


def evidence_sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
    return (
        str(item.get("repository_relative_path", "")),
        int(item.get("start_line") or 0),
        normalize_sort_text(item.get("symbol")),
        str(item.get("id", "")),
    )


def _related(revision: dict[str, Any], node_id: str, relationship_type: str) -> list[dict[str, Any]]:
    result = []
    for relationship in revision["relationships_from"].get(node_id, []):
        if relationship["type"] != relationship_type:
            continue
        target = revision["nodes"].get(relationship["to_id"])
        if target:
            result.append(target)
    for relationship in revision["relationships_to"].get(node_id, []):
        if relationship["type"] != relationship_type:
            continue
        source = revision["nodes"].get(relationship["from_id"])
        if source:
            result.append(source)
    return sorted(result, key=id_sort_key)


def _values(use_case: dict[str, Any], field: str) -> list[dict[str, Any]]:
    values = use_case.get(field, [])
    if not isinstance(values, list):
        return []
    return [dict(value) if isinstance(value, dict) else {"statement": value} for value in values]


def _section(section_id: str, title: str, items: Any, *, empty_state: str = "not_investigated") -> dict[str, Any]:
    values = items if isinstance(items, list) else []
    return {
        "id": section_id,
        "title": title,
        "items": values,
        "empty_state": empty_state if not values else None,
    }


def _empty(state: str, reason: str = "") -> dict[str, Any]:
    return {"state": state, "reason": reason}


def _load_jsonl(root: Path, name: str) -> list[dict[str, Any]]:
    path = root / name
    return guard.read_jsonl(path) if path.exists() else []


def _load_json(root: Path, name: str) -> Any:
    return guard.read_json(root / name)


def build_site_view_model(revision: dict[str, Any]) -> dict[str, Any]:
    root = revision["root"]
    manifest = revision["manifest"]
    use_cases = sorted(revision["use_cases"], key=use_case_sort_key)
    details = []
    for use_case in use_cases:
        rules = _related(revision, use_case["id"], "uses_rule")
        actors = _related(revision, use_case["id"], "participates_in")
        evidence = sorted(
            (
                revision["evidence_by_id"][item["to_id"]]
            for item in revision["relationships_from"].get(use_case["id"], [])
            if item["type"] == "evidenced_by" and item["to_id"] in revision["evidence_by_id"]
            ),
            key=evidence_sort_key,
        )
        unknown_ids = {
            item["to_id"]
            for source, relationships in revision["relationships_from"].items()
            if source == use_case["id"] or source.startswith(f"{use_case['id']}#")
            for item in relationships
            if item["type"] == "has_unknown"
        }
        all_unknowns = sorted(
            (revision["nodes"][unknown_id] for unknown_id in unknown_ids if unknown_id in revision["nodes"]),
            key=id_sort_key,
        )
        sections = [
            _section("summary", "概要", [{
                "statement": use_case.get("summary", ""),
                "goal": use_case.get("goal", {}).get("statement", ""),
                "actors": [item["title"] for item in actors],
                "status": use_case.get("claim_status"),
                "confidence": use_case.get("confidence"),
                "goal_label": "业务目标",
                "technical_evidence_label": "技术证据",
            }]),
            _section("trigger_preconditions", "触发与前置条件", [*_values(use_case, "triggers"), *_values(use_case, "preconditions")]),
            _section("main_flow", "主业务流程", _values(use_case, "main_flow")),
            _section("rules_decisions", "规则与决策", [dict(item, statement=item.get("statement", item.get("summary", ""))) for item in rules] + _values(use_case, "decision_points")),
            _section("effects", "状态、数据与外部影响", [*_values(use_case, "state_changes"), *_values(use_case, "data_changes"), *_values(use_case, "external_effects")]),
            _section("success", "成功结果", _values(use_case, "success_outcomes")),
            _section("rejection_failure", "拒绝与失败", [*_values(use_case, "rejection_conditions"), *_values(use_case, "failure_paths")]),
            _section("recovery", "重试、补偿与修复", _values(use_case, "compensation_paths")),
            _section("permissions", "角色与权限", _values(use_case, "permissions"), empty_state="searched_not_found"),
            _section("variants", "变体与相关用例", []),
            _section("gaps", "未知与冲突", all_unknowns),
            _section("evolution", "业务演进", sorted(_load_jsonl(root, "business-evolution-events.jsonl"), key=id_sort_key)),
            _section("evidence", "当前源码证据", evidence),
        ]
        details.append({"id": use_case["id"], "title": use_case["title"], "sections": sections})

    commits = _load_jsonl(root, "git-commits.jsonl")
    events = _load_jsonl(root, "business-evolution-events.jsonl")
    return {
        "view_schema_version": VIEW_SCHEMA_VERSION,
        "canonical_revision_sha256": manifest.get("canonical_revision_sha256"),
        "navigation": [{"id": key, "label": label} for key, label in FIXED_NAVIGATION_LABELS.items()],
        "empty_states": [
            _empty("confirmed_empty", "调查确认当前范围没有适用行为。"),
            _empty("searched_not_found", "已完成要求搜索，但未发现证据。"),
            _empty("not_investigated", "尚未完成调查，不能解释为不存在。"),
            _empty("not_applicable", "该维度不适用于当前用例。"),
        ],
        "views": {
            "overview": {
                "title": "从代码还原的业务知识",
                "snapshot": manifest.get("repository_snapshot", {}),
                "current_coverage_status": manifest.get("current_coverage_status"),
                "history_coverage_status": manifest.get("history_coverage_status"),
                "aggregate_status": manifest.get("aggregate_status", manifest.get("coverage_status")),
            },
            "capability_tree": sorted(revision["capabilities"], key=id_sort_key),
            "use_case_catalog": [
                {"id": item["id"], "title": item["title"], "summary": item.get("summary", "")}
                for item in use_cases
            ],
            "use_case_details": details,
            "workflow_views": sorted(revision["workflows"], key=id_sort_key),
            "state_views": sorted(revision["state_machines"], key=id_sort_key),
            "rule_catalog": sorted(revision["rules"], key=id_sort_key),
            "effect_catalog": [
                {"use_case_id": item["id"], "effects": _values(item, "external_effects")}
                for item in use_cases
            ],
            "actor_permission_views": [
                {
                    "actor": item,
                    "use_case_ids": [
                        relation["to_id"] for relation in revision["relationships_from"].get(item["id"], [])
                        if relation["type"] == "participates_in"
                    ],
                    "permission_state": "searched_not_found",
                }
                for item in sorted(revision["actors"], key=id_sort_key)
            ],
            "evolution_views": {
                "events": sorted(events, key=lambda item: (item.get("introduced_at", ""), item.get("id", ""))),
                "commit_count": len(commits),
                "latest_important": events[0] if events else None,
            },
            "gap_views": {
                "unknowns": sorted(revision["unknowns"], key=id_sort_key),
                "conflicts": sorted(revision["conflicts"], key=id_sort_key),
            },
            "coverage_dashboard": revision["coverage"],
        },
    }


def write_site_view_model(revision_dir: Path) -> dict[str, Any]:
    import render_business_site as renderer

    revision = renderer.load_canonical_revision(revision_dir)
    model = build_site_view_model(revision)
    payload = contract.canonical_json_bytes(model, sort_records=True).decode("utf-8") + "\n"
    guard.write_json_atomic(Path(revision_dir) / "site-view-model.json", __import__("json").loads(payload))
    return model
