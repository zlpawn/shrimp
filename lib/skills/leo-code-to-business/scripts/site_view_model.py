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
V3_NAVIGATION_LABELS = {
    "business_map": "业务地图",
    "core_scenarios": "核心业务场景",
    "knowledge_topics": "专题查询",
}
SCENARIO_READING_SECTION_IDS = (
    "context_and_start",
    "staged_flow",
    "branches",
    "state_data_effects",
    "failure_and_recovery",
    "variants",
    "worked_examples",
    "engineering_drilldown",
    "change_guides",
    "evolution",
    "open_questions",
    "implementation_evidence",
)
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
    schema_version = manifest.get("schema_version")
    is_v3 = schema_version in contract.DEEP_SCHEMA_VERSIONS
    has_engineering_views = schema_version in {
        contract.V31_SCHEMA_VERSION,
        contract.V32_SCHEMA_VERSION,
    }
    views = {
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
        }
    if is_v3:
        engineering_by_use_case = {
            item.get("use_case_id"): item
            for item in revision.get("engineering_views", [])
            if item.get("use_case_id")
        } if has_engineering_views else {}
        flows_by_use_case: dict[str, list[dict[str, Any]]] = {}
        for flow in revision["end_to_end_flows"]:
            for use_case_id in flow.get("use_case_ids", []):
                flows_by_use_case.setdefault(use_case_id, []).append(flow)
        events_by_id = {item["id"]: item for item in events if item.get("id")}
        unknowns_by_id = {
            item["id"]: item for item in revision["unknowns"] if item.get("id")
        }
        evidence_by_id = revision["evidence_by_id"]
        scenario_pages = []
        map_scenarios = []
        for use_case in use_cases:
            narrative = use_case.get("scenario_narrative")
            depth_status = "deep" if isinstance(narrative, dict) else "summary_only"
            narrative = narrative if isinstance(narrative, dict) else {}
            referenced_evidence_ids = {
                evidence_id
                for stage in narrative.get("stages", [])
                for step in stage.get("steps", [])
                for evidence_id in step.get("evidence_ids", [])
            }
            for field in (
                "branch_matrix", "failure_recovery_matrix", "variants", "worked_examples"
            ):
                referenced_evidence_ids.update(
                    evidence_id
                    for item in narrative.get(field, [])
                    for evidence_id in item.get("evidence_ids", [])
                )
            scenario_evidence = sorted(
                (
                    evidence_by_id[evidence_id]
                    for evidence_id in referenced_evidence_ids
                    if evidence_id in evidence_by_id
                ),
                key=evidence_sort_key,
            )
            scenario_events = [
                events_by_id[event_id]
                for event_id in narrative.get("history_event_ids", [])
                if event_id in events_by_id
            ]
            scenario_unknowns = [
                unknowns_by_id[unknown_id]
                for unknown_id in narrative.get("open_question_ids", [])
                if unknown_id in unknowns_by_id
            ]
            engineering_view = engineering_by_use_case.get(use_case["id"], {})
            step_mappings = {
                item.get("step_id"): item
                for item in engineering_view.get("step_mappings", [])
                if item.get("step_id")
            }
            staged_flow = []
            for stage in narrative.get("stages", []):
                projected_stage = dict(stage)
                projected_stage["steps"] = [
                    {
                        **step,
                        "engineering_mapping": step_mappings.get(step.get("step_id")),
                    }
                    for step in stage.get("steps", [])
                ]
                staged_flow.append(projected_stage)
            sections = [
                _section("context_and_start", "业务背景与开始状态", [{
                    "business_context": narrative.get("business_context", use_case.get("summary", "")),
                    "starting_state": narrative.get("starting_state", []),
                    "depth_status": depth_status,
                }]),
                _section("staged_flow", "分阶段完整流程", staged_flow),
                _section("branches", "分支与判断", narrative.get("branch_matrix", [])),
                _section("state_data_effects", "状态、数据与外部影响", [
                    *[item for stage in narrative.get("stages", []) for item in stage.get("steps", [])],
                    *flows_by_use_case.get(use_case["id"], []),
                ]),
                _section("failure_and_recovery", "失败、恢复与降级", narrative.get("failure_recovery_matrix", [])),
                _section("variants", "业务变体", narrative.get("variants", []), empty_state="not_applicable"),
                _section("worked_examples", "业务实例", narrative.get("worked_examples", [])),
            ]
            if has_engineering_views:
                sections.extend([
                    _section(
                        "engineering_drilldown",
                        "研发实现导航",
                        [engineering_view] if engineering_view else [],
                        empty_state="not_investigated",
                    ),
                    _section(
                        "change_guides",
                        "改动影响与验证",
                        engineering_view.get("change_guides", []),
                        empty_state="not_investigated",
                    ),
                ])
            sections.extend([
                _section("evolution", "当前与历史变化", scenario_events),
                _section("open_questions", "未确认问题", scenario_unknowns, empty_state="confirmed_empty"),
                _section("implementation_evidence", "实现证据", scenario_evidence),
            ])
            scenario_pages.append({
                "id": use_case["id"],
                "title": use_case["title"],
                "summary": use_case.get("summary", ""),
                "goal": use_case.get("goal", {}).get("statement", ""),
                "depth_status": depth_status,
                "sections": sections,
            })
            map_scenarios.append({
                "id": use_case["id"],
                "title": use_case["title"],
                "summary": use_case.get("summary", ""),
                "goal": use_case.get("goal", {}).get("statement", ""),
                "depth_status": depth_status,
                "start": narrative.get("starting_state", ["开始状态尚未完成深度整理"])[0],
                "end": _values(use_case, "success_outcomes")[0].get("statement", "") if _values(use_case, "success_outcomes") else "终态尚未确认",
            })
        coverage_dashboard = dict(revision["coverage"])
        coverage_metrics = dict(coverage_dashboard.get("metrics", {}))
        deep_count = sum(
            1 for page in scenario_pages if page.get("depth_status") == "deep"
        )
        coverage_metrics["scenario_readiness_coverage"] = {
            "numerator": deep_count,
            "denominator": len(scenario_pages),
            "ratio": deep_count / len(scenario_pages) if scenario_pages else 1.0,
            "unresolved_ids": [
                f"{page['id']}#scenario_narrative"
                for page in scenario_pages
                if page.get("depth_status") != "deep"
            ],
            "excluded_ids": [],
        }
        coverage_dashboard["metrics"] = coverage_metrics
        views["coverage_dashboard"] = coverage_dashboard
        views.update({
            "business_map": {
                "capabilities": sorted(revision["capabilities"], key=id_sort_key),
                "actors": sorted(revision["actors"], key=id_sort_key),
                "recommended_scenarios": map_scenarios,
            },
            "scenario_reading_pages": scenario_pages,
            "knowledge_topics": {
                "rules": sorted(revision["rules"], key=id_sort_key),
                "calculations": sorted(revision["calculation_models"], key=id_sort_key),
                "flows": sorted(revision["end_to_end_flows"], key=id_sort_key),
                "modules": sorted(revision["module_dossiers"], key=id_sort_key),
                "evolution": sorted(events, key=lambda item: (item.get("introduced_at", ""), item.get("id", ""))),
                "coverage": coverage_dashboard,
                "project_progress": revision.get("project_progress", {}),
            },
            "module_dossiers": sorted(revision["module_dossiers"], key=id_sort_key),
            "end_to_end_flows": sorted(revision["end_to_end_flows"], key=id_sort_key),
            "calculation_models": sorted(revision["calculation_models"], key=id_sort_key),
            "code_knowledge_matrix": sorted(revision["code_knowledge_matrix"], key=lambda item: item.get("signal_id", "")),
        })
        if has_engineering_views:
            views["engineering_views"] = sorted(
                revision.get("engineering_views", []),
                key=lambda item: item.get("use_case_id", ""),
            )
        if schema_version == contract.V32_SCHEMA_VERSION:
            views["project_progress"] = revision.get("project_progress", {})
    return {
        "view_schema_version": VIEW_SCHEMA_VERSION,
        "canonical_revision_sha256": manifest.get("canonical_revision_sha256"),
        "navigation": [
            {"id": key, "label": label}
            for key, label in (V3_NAVIGATION_LABELS if is_v3 else FIXED_NAVIGATION_LABELS).items()
        ],
        "empty_states": [
            _empty("confirmed_empty", "调查确认当前范围没有适用行为。"),
            _empty("searched_not_found", "已完成要求搜索，但未发现证据。"),
            _empty("not_investigated", "尚未完成调查，不能解释为不存在。"),
            _empty("not_applicable", "该维度不适用于当前用例。"),
        ],
        "views": views,
    }


def write_site_view_model(revision_dir: Path) -> dict[str, Any]:
    import render_business_site as renderer

    revision = renderer.load_canonical_revision(revision_dir)
    model = build_site_view_model(revision)
    # Preserve navigation and reading order; build_site_view_model sorts unordered source records.
    payload = contract.canonical_json_bytes(model, sort_records=False).decode("utf-8") + "\n"
    guard.write_json_atomic(Path(revision_dir) / "site-view-model.json", __import__("json").loads(payload))
    return model
