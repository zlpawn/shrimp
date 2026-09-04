#!/usr/bin/env python3
"""Render AI and offline HTML projections from canonical business knowledge."""

from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_contract as contract
import site_view_model


SCRIPT_DIR = Path(__file__).resolve().parent
GUARD_PATH = SCRIPT_DIR / "business_knowledge_guard.py"
GUARD_SPEC = importlib.util.spec_from_file_location(
    "leo_code_to_business_guard",
    GUARD_PATH,
)
guard = importlib.util.module_from_spec(GUARD_SPEC)
assert GUARD_SPEC.loader
GUARD_SPEC.loader.exec_module(guard)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def write_text_atomic(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.partial")
    partial.write_text(value, encoding="utf-8")
    os.replace(partial, path)


def load_optional_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return guard.read_json(path)


def load_optional_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    return guard.read_jsonl(path)


def load_canonical_revision(revision_dir: Path | str) -> dict[str, Any]:
    root = Path(revision_dir)
    manifest = guard.read_json(root / "manifest.json")
    revision = {
        "root": root,
        "manifest": manifest,
        "inventory": load_optional_jsonl(root / "inventory.jsonl"),
        "capabilities": load_optional_json(root / "capabilities.json", []),
        "actors": load_optional_json(root / "actors.json", []),
        "families": load_optional_json(root / "use-case-families.json", []),
        "use_cases": load_optional_jsonl(root / "use-cases.jsonl"),
        "rules": load_optional_jsonl(root / "business-rules.jsonl"),
        "workflows": load_optional_jsonl(root / "workflows.jsonl"),
        "state_machines": load_optional_json(root / "state-machines.json", []),
        "events": load_optional_jsonl(root / "domain-events.jsonl"),
        "entities": load_optional_json(root / "entities.json", []),
        "glossary": load_optional_json(root / "glossary.json", []),
        "aliases": load_optional_json(root / "aliases.json", []),
        "relationships": load_optional_jsonl(root / "relationships.jsonl"),
        "investigations": load_optional_jsonl(root / "investigations.jsonl"),
        "evidence": load_optional_jsonl(root / "evidence.jsonl"),
        "conflicts": load_optional_jsonl(root / "conflicts.jsonl"),
        "unknowns": load_optional_jsonl(root / "unknowns.jsonl"),
        "coverage": load_optional_json(root / "coverage.json", {}),
        "change_impact": load_optional_json(root / "change-impact.json", {}),
        "module_dossiers": load_optional_jsonl(root / "module-dossiers.jsonl"),
        "end_to_end_flows": load_optional_jsonl(root / "end-to-end-flows.jsonl"),
        "calculation_models": load_optional_jsonl(root / "calculation-models.jsonl"),
        "code_knowledge_matrix": load_optional_jsonl(root / "code-knowledge-matrix.jsonl"),
        "engineering_views": load_optional_jsonl(root / "engineering-views.jsonl"),
        "project_progress": load_optional_json(root / "project-progress.json", {}),
    }
    nodes: dict[str, dict[str, Any]] = {}
    for collection in [
        "capabilities",
        "actors",
        "families",
        "use_cases",
        "rules",
        "workflows",
        "state_machines",
        "events",
        "entities",
        "glossary",
        "conflicts",
        "unknowns",
    ]:
        for node in revision[collection]:
            if isinstance(node, dict) and node.get("id"):
                nodes[node["id"]] = node
    revision["nodes"] = nodes
    revision["evidence_by_id"] = {
        item["id"]: item for item in revision["evidence"] if item.get("id")
    }
    revision["relationships_from"] = {}
    revision["relationships_to"] = {}
    for relationship in revision["relationships"]:
        revision["relationships_from"].setdefault(
            relationship["from_id"], []
        ).append(relationship)
        revision["relationships_to"].setdefault(
            relationship["to_id"], []
        ).append(relationship)
    return revision


def refresh_canonical_hashes(revision_dir: Path | str) -> str:
    root = Path(revision_dir)
    canonical_hash = guard.revision_canonical_sha256(root)
    manifest = guard.read_json(root / "manifest.json")
    manifest["canonical_revision_sha256"] = canonical_hash
    projections = manifest.setdefault("projection_hashes", {})
    for name in ["ai", "html"]:
        projections.setdefault(name, {})
        projections[name]["canonical_sha256"] = canonical_hash
    guard.write_json_atomic(root / "manifest.json", manifest)

    review_path = root / "semantic-review.json"
    if review_path.exists():
        review = guard.read_json(review_path)
        review["canonical_revision_sha256"] = canonical_hash
        guard.write_json_atomic(review_path, review)
    return canonical_hash


def related_nodes(
    revision: dict[str, Any],
    node_id: str,
    relationship_type: str | None = None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for relationship in revision["relationships_from"].get(node_id, []):
        if relationship_type and relationship["type"] != relationship_type:
            continue
        target = revision["nodes"].get(relationship["to_id"])
        if target:
            result.append(target)
    for relationship in revision["relationships_to"].get(node_id, []):
        if relationship_type and relationship["type"] != relationship_type:
            continue
        source = revision["nodes"].get(relationship["from_id"])
        if source:
            result.append(source)
    seen: set[str] = set()
    unique: list[dict[str, Any]] = []
    for node in result:
        if node["id"] not in seen:
            seen.add(node["id"])
            unique.append(node)
    return unique


def statement_texts(values: Any, limit: int = 4) -> list[str]:
    if not isinstance(values, list):
        return []
    result: list[str] = []
    for value in values:
        if isinstance(value, dict):
            statement = value.get("statement") or value.get("summary") or value.get("title")
        else:
            statement = str(value)
        if statement and statement not in result:
            result.append(str(statement))
        if len(result) >= limit:
            break
    return result


def format_compact_items(values: list[str], fallback: str = "尚未确认") -> str:
    return "；".join(values) if values else fallback


def use_case_rules(revision: dict[str, Any], use_case_id: str) -> list[dict[str, Any]]:
    return related_nodes(revision, use_case_id, "uses_rule")


def compact_values(values: Any, limit: int = 3) -> str:
    if isinstance(values, list):
        rendered = []
        for value in values:
            text = item_text(value) if isinstance(value, dict) else str(value)
            if text and text not in rendered:
                rendered.append(text)
            if len(rendered) >= limit:
                break
        return format_compact_items(rendered)
    if isinstance(values, dict):
        return item_text(values) or "尚未确认"
    return str(values) if values not in (None, "") else "尚未确认"


def scenario_stage_lines(narrative: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    number = 0
    for stage in narrative.get("stages", []):
        title = stage.get("title") or stage.get("stage_id") or "未命名阶段"
        purpose = stage.get("business_purpose") or ""
        lines.append(f"- **{title}**：{purpose}")
        for step in stage.get("steps", []):
            number += 1
            actor = step.get("actor_or_event") or "业务事件"
            action = step.get("business_action") or "尚未确认"
            result = step.get("business_result") or "尚未确认"
            lines.append(f"  {number}. {actor}：{action} → {result}")
    return lines


def engineering_context_lines(engineering_view: dict[str, Any] | None) -> list[str]:
    if not engineering_view:
        return ["- 研发下钻尚未完成；不能仅凭业务摘要定位改动。"]
    lines = [f"- 实现概览：{engineering_view.get('implementation_summary', '尚未确认')}"]
    for mapping in engineering_view.get("step_mappings", []):
        units = "、".join(
            f"{unit.get('name', '')}（{unit.get('locator', '')}）"
            for unit in mapping.get("implementation_units", [])
        ) or "尚未定位"
        lines.append(f"- `{mapping.get('step_id', '')}`：{units}")
    for guide in engineering_view.get("change_guides", [])[:3]:
        lines.append(
            f"- 改动指南：{guide.get('change_goal', '')}；验证："
            + "、".join(str(item) for item in guide.get("verification_targets", []))
        )
    return lines


def scenario_matrix_lines(
    items: Any,
    fields: list[tuple[str, str]],
    *,
    limit: int = 3,
    fallback: str,
) -> list[str]:
    if not isinstance(items, list) or not items:
        return [f"- {fallback}"]
    lines = []
    for item in items[:limit]:
        parts = [
            f"{label}：{compact_values(item.get(field))}"
            for label, field in fields
            if item.get(field) not in (None, "", [])
        ]
        lines.append(f"- {'；'.join(parts)}")
    return lines


def scenario_effect_lines(narrative: dict[str, Any], limit: int = 5) -> list[str]:
    effects: list[str] = []
    for stage in narrative.get("stages", []):
        for step in stage.get("steps", []):
            for label, field in (
                ("数据", "data_changes"),
                ("状态", "state_changes"),
                ("外部", "external_effects"),
            ):
                for value in step.get(field, []):
                    text = f"{label}：{value}"
                    if text not in effects:
                        effects.append(text)
                    if len(effects) >= limit:
                        return [f"- {item}" for item in effects]
    return [f"- {item}" for item in effects] or ["- 尚未完成状态、数据和外部影响整理。"]


def history_event_line(item: dict[str, Any]) -> str:
    before = item.get("before_summary") or "上一版本行为尚未确认"
    after = item.get("after_summary") or item.get("summary") or item.get("title") or "当前行为尚未确认"
    reason_status = item.get("reason_status", "unknown")
    reason = item.get("reason_statement") or "修改原因未确认"
    return f"- 上一版本：{before}；当前版本：{after}；原因状态：{reason_status}；{reason}"


def render_ai_context(revision: dict[str, Any]) -> str:
    manifest = revision["manifest"]
    canonical_hash = manifest["canonical_revision_sha256"]
    snapshot = manifest.get("repository_snapshot", {})
    project_progress = revision.get("project_progress", {})
    project_status = project_progress.get(
        "project_completion_status",
        manifest.get("project_completion_status", "legacy_unknown"),
    )
    project_modules = project_progress.get("modules", [])
    project_modules_by_id = {
        item.get("id"): item for item in project_modules if item.get("id")
    }
    completed_modules = [
        item.get("title", item.get("id"))
        for item in project_modules
        if item.get("status") == "complete"
    ]
    next_modules = [
        project_modules_by_id[module_id]
        for module_id in project_progress.get("next_module_ids", [])
        if module_id in project_modules_by_id
    ]
    next_module_lines = [
        f"- **{item.get('title', item.get('id'))}**（{item.get('priority', 'normal')} / {item.get('status')}）：{item.get('next_action', '下一步尚未记录')}"
        for item in next_modules
    ]
    capabilities = "\n".join(
        f"- **{item['title']}**：{item['summary']}（下探 ID：`{item['id']}`）"
        for item in revision["capabilities"]
    ) or "- 当前尚未整理出已确认的业务能力。"
    actor_lines = []
    for actor in revision["actors"]:
        use_case_titles = [
            node["title"]
            for node in related_nodes(revision, actor["id"], "participates_in")
            if node.get("title")
        ]
        scope = f"；参与场景：{'、'.join(use_case_titles)}" if use_case_titles else ""
        actor_lines.append(f"- **{actor['title']}**：{actor['summary']}{scope}")
    actors = "\n".join(actor_lines) or "- 当前尚未整理出已确认的参与者。"
    use_case_blocks = []
    deep_scenario_count = 0
    engineering_by_use_case = {
        item.get("use_case_id"): item
        for item in revision.get("engineering_views", [])
        if item.get("use_case_id")
    }
    for use_case in revision["use_cases"]:
        actor_names = [
            actor["title"]
            for actor in related_nodes(revision, use_case["id"], "participates_in")
        ]
        rules = use_case_rules(revision, use_case["id"])
        unknowns = unknowns_for_use_case(revision, use_case["id"])
        narrative = use_case.get("scenario_narrative")
        narrative = narrative if isinstance(narrative, dict) else None
        if narrative:
            deep_scenario_count += 1
        initiation = [
            *statement_texts(use_case.get("triggers"), 2),
            *statement_texts(use_case.get("preconditions"), 1),
        ]
        history_by_id = {
            item["id"]: item
            for item in load_optional_jsonl(revision["root"] / "business-evolution-events.jsonl")
            if item.get("id")
        }
        base_lines = [
            f"### {use_case['title']}",
            "",
            f"- 场景深度：{'已达到场景可读标准' if narrative else '仅有摘要，不能视为已完整理解'}",
            f"- 参与者：{format_compact_items(actor_names)}",
            f"- 业务目标：{use_case.get('goal', {}).get('statement') or '尚未确认'}",
            f"- 发起条件：{format_compact_items(initiation)}",
            f"- 关键规则：{format_compact_items([item.get('statement', item.get('summary', '')) for item in rules][:3])}",
            f"- 完成结果：{format_compact_items(statement_texts(use_case.get('success_outcomes'), 2))}",
        ]
        if narrative:
            history_events = [
                history_by_id[event_id]
                for event_id in narrative.get("history_event_ids", [])
                if event_id in history_by_id
            ]
            question_by_id = {
                item.get("id"): item for item in unknowns if item.get("id")
            }
            questions = [
                question_by_id[unknown_id]
                for unknown_id in narrative.get("open_question_ids", [])
                if unknown_id in question_by_id
            ]
            lines = [
                *base_lines,
                f"- 业务背景：{narrative.get('business_context', use_case.get('summary', ''))}",
                f"- 开始状态：{compact_values(narrative.get('starting_state'))}",
                "",
                "#### 当前行为：分阶段执行",
                "",
                *scenario_stage_lines(narrative),
                "",
                "#### 分支与判断",
                "",
                *scenario_matrix_lines(
                    narrative.get("branch_matrix"),
                    [("条件", "condition"), ("判断依据", "decision_basis"), ("路线", "route"), ("结果", "business_result")],
                    fallback="关键分支尚未闭合。",
                ),
                "",
                "#### 状态、数据与外部影响",
                "",
                *scenario_effect_lines(narrative),
                "",
                "#### 失败、恢复与降级",
                "",
                *scenario_matrix_lines(
                    narrative.get("failure_recovery_matrix"),
                    [("失败点", "failure_point"), ("影响", "business_impact"), ("停留状态", "stopped_state"), ("自动恢复", "automatic_recovery"), ("人工修复", "manual_repair"), ("降级", "degradation")],
                    fallback="失败与恢复尚未闭合。",
                ),
                "",
                "#### 业务实例",
                "",
                *scenario_matrix_lines(
                    narrative.get("worked_examples"),
                    [("示例", "title"), ("已知", "given"), ("发生", "when"), ("结果", "then")],
                    limit=2,
                    fallback="尚未提供基于已验证规则的实例。",
                ),
                "",
                *(
                    [
                        "#### 研发实现与改动入口",
                        "",
                        *engineering_context_lines(engineering_by_use_case.get(use_case["id"])),
                        "",
                    ]
                    if engineering_by_use_case.get(use_case["id"])
                    else []
                ),
                "#### 历史兼容与未确认项",
                "",
                *([history_event_line(item) for item in history_events] or ["- 当前场景没有已验证的前后行为变化。"]),
                *(
                    [f"- 未确认：{item.get('question', item.get('summary', ''))}" for item in questions]
                    or ["- 当前没有与该场景直接关联的未确认问题。"]
                ),
                f"- 开发下探：检索 `{use_case['id']}`，再读取场景引用的规则、流程、计算模型、历史事件和当前源码证据。",
                "",
            ]
        else:
            failure_recovery = [
                *statement_texts(use_case.get("rejection_conditions"), 1),
                *statement_texts(use_case.get("failure_paths"), 1),
                *statement_texts(use_case.get("compensation_paths"), 1),
            ]
            lines = [
                *base_lines,
                f"- 核心流程摘要：{format_compact_items(statement_texts(use_case.get('main_flow'), 4))}",
                f"- 异常与恢复摘要：{format_compact_items(failure_recovery)}",
                f"- 待确认：{format_compact_items([item.get('question', item.get('summary', '')) for item in unknowns][:2], '当前没有关联的高优先级未知项')}",
                f"- 开发下探：检索 `{use_case['id']}`；该场景需要先补齐 `scenario_narrative`，再用于影响分析。",
                "",
            ]
        use_case_blocks.append("\n".join(lines))
    use_cases = "\n".join(use_case_blocks) or "当前尚未整理出已确认的业务场景。"
    cross_rules = "\n".join(
        f"- **{item['title']}**：{item.get('statement', item.get('summary', ''))}"
        for item in revision["rules"][:12]
    ) or "- 当前尚未整理出跨场景关键规则。"
    state_lines = "\n".join(
        f"- **{item['title']}**：{item.get('summary', '')}"
        for item in revision["state_machines"][:8]
    ) or "- 当前尚未整理出独立生命周期。"
    unknown_lines = "\n".join(
        f"- **{item['title']}**：{item.get('question', item.get('summary', ''))}"
        f" 原因：{item.get('reason', '尚未记录')}"
        for item in revision["unknowns"][:12]
    ) or "- 当前已整理范围内没有记录未知项。"
    conflict_lines = "\n".join(
        f"- **{item['title']}**：{item.get('business_question', item.get('summary', ''))}"
        for item in revision["conflicts"][:8]
    ) or "- 当前已整理范围内未发现冲突。"
    aliases = "\n".join(
        f"- `{item.get('alias')}` -> {', '.join(item.get('target_ids', []))}"
        for item in revision["aliases"][:30]
    ) or "- 当前没有别名映射。"
    scope_status = manifest.get("aggregate_status", manifest.get("coverage_status", "partial"))
    status_text = (
        "当前整理范围已通过校验。"
        if scope_status == "passed"
        else "当前整理范围已发布，但仍有业务知识等待继续归纳。"
    )
    lines = [
        "# 项目业务导览",
        "",
        "## 项目业务定位",
        "",
        "这份知识用于让产品、研发和 AI 从参与者、业务目标、流程、规则、结果、异常与恢复理解当前系统。",
        "业务叙事是共同主线；代码、接口、字段和文件路径通过逐步骤研发下钻解释当前实现、改动位置与验证范围。",
        "",
        "## 当前已整理范围",
        "",
        f"- Revision checkpoint：`{manifest.get('aggregate_status', manifest.get('coverage_status', 'partial'))}`",
        f"- Whole-project status：`{project_status}`",
        f"- 已完成模块：{format_compact_items(completed_modules, '尚无模块达到完成标准')}",
        *(
            ["- **项目仍未完成，不能把本修订描述为全仓业务知识库已完成。**"]
            if project_status in {"in_progress", "blocked"}
            else []
        ),
        "",
        "### 下一步模块队列",
        "",
        *(next_module_lines or ["- 当前没有待执行模块。"]),
        "",
        f"当前发现并建立映射 {len(revision['use_cases'])} 个业务场景，其中 {deep_scenario_count} 个已达到独立场景可读标准；另有 {len(revision['capabilities'])} 项业务能力。",
        "发现、分类或建立代码映射不等于已经理解完整业务；只有场景深度通过才可用于闭卷复述和需求影响分析。",
        "这不代表系统完整业务全貌。范围外问题不得仅凭名称或关键词推断为已确认行为。",
        f"{status_text}",
        "",
        "## 参与者与业务目标",
        "",
        actors,
        "",
        "## 业务能力地图",
        "",
        capabilities,
        "",
        "## 已确认业务场景",
        "",
        use_cases,
        "## 跨场景关键规则与生命周期",
        "",
        "### 关键规则",
        "",
        cross_rules,
        "",
        "### 生命周期",
        "",
        state_lines,
        "",
        "## 重要待确认事项",
        "",
        unknown_lines,
        "",
        "### 冲突",
        "",
        conflict_lines,
        "",
        "## 新需求开发工作法",
        "",
        "**先分析业务影响，再进入代码实现。**",
        "",
        "收到新需求时按以下顺序工作：",
        "",
        "1. 用业务语言重述需求及预期结果。",
        "2. 判断当前知识对需求是完整覆盖、部分覆盖还是未覆盖。",
        "3. 识别受影响的能力、用例、参与者、规则、状态、数据、外部系统、异常与恢复路径。",
        "4. 明确必须保持的当前业务行为和边界条件。",
        "5. 对未知项或未覆盖范围先调查当前源码，不把相似关键词当作确认事实。",
        "6. 再检索实现入口、关系、实体和直接源码证据，制定或执行代码修改。",
        "7. 从正常流程、边界条件、失败恢复、幂等、权限和外部影响生成测试与验收清单。",
        "8. 开发完成后判断是否需要更新业务知识。",
        "",
        "## 检索与核验指南",
        "",
        "先用业务名称、别名或稳定 ID 定位场景，再按任务需要读取：",
        "",
        "- `use-cases.jsonl`：参与者目标、流程摘要，以及核心场景的 `scenario_narrative`。",
        "- `end-to-end-flows.jsonl`、`calculation-models.jsonl`：跨模块链路与评分/计算细节。",
        "- `use-case-families.json`：渠道、生命周期变体、解绑重绑和修复路径。",
        "- `business-rules.jsonl`：业务条件、判断和影响。",
        "- `state-machines.json`：生命周期状态与转换。",
        "- `entities.json`：业务记录和字段含义。",
        "- `unknowns.jsonl`、`conflicts.jsonl`：知识边界和矛盾。",
        "- `project-progress.json`：全仓模块完成状态、当前模块和后续队列；只要状态不是 `complete` 就必须继续。",
        "- `relationships.jsonl`：业务节点之间及其与证据的权威关系。",
        "- `evidence.jsonl`、`investigations.jsonl`：当前源码证明和已执行的调查。",
        "- 对具体新需求可运行 `scripts/task_context.py` 获取有界检索包；该包用于定位，结论仍需回到 canonical 记录和当前源码核验。",
        "",
        "### 别名与稳定 ID",
        "",
        aliases,
        "",
        "## 修订信息",
        "",
        f"- Canonical revision：`{canonical_hash}`",
        f"- Snapshot：`{snapshot.get('snapshot_id', 'unknown')}`",
        f"- Repository：`{snapshot.get('canonical_root', 'unknown')}`",
        f"- Coverage status：`{manifest.get('coverage_status', 'partial')}`",
        f"- Project completion status：`{project_status}`",
        f"- Scenario readiness：`{deep_scenario_count}/{len(revision['use_cases'])}`",
        f"- Unknowns：`{len(revision['unknowns'])}`",
        f"- Conflicts：`{len(revision['conflicts'])}`",
        "",
    ]
    return "\n".join(lines)


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def render_values(items: Any) -> str:
    if not isinstance(items, list) or not items:
        return '<p class="empty">未发现已确认内容，请查看未知项。</p>'
    rendered = []
    for item in items:
        statement = item.get("statement", "") if isinstance(item, dict) else str(item)
        status = item.get("claim_status", "") if isinstance(item, dict) else ""
        confidence = item.get("confidence", "") if isinstance(item, dict) else ""
        meta = " ".join(value for value in [status, confidence] if value)
        rendered.append(
            f"<li><span>{esc(statement)}</span>"
            f"{f'<small>{esc(meta)}</small>' if meta else ''}</li>"
        )
    return f"<ul class=\"fact-list\">{''.join(rendered)}</ul>"


def evidence_for_node(revision: dict[str, Any], node_id: str) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for relationship in revision["relationships_from"].get(node_id, []):
        if relationship["type"] == "evidenced_by":
            evidence = revision["evidence_by_id"].get(relationship["to_id"])
            if evidence:
                result.append(evidence)
    return result


def unknowns_for_use_case(
    revision: dict[str, Any],
    use_case_id: str,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    prefix = f"{use_case_id}#"
    for source, relationships in revision["relationships_from"].items():
        if source == use_case_id or source.startswith(prefix):
            for relationship in relationships:
                if relationship["type"] == "has_unknown":
                    unknown = revision["nodes"].get(relationship["to_id"])
                    if unknown:
                        result.append(unknown)
    seen: set[str] = set()
    return [
        node
        for node in result
        if not (node["id"] in seen or seen.add(node["id"]))
    ]


def render_use_case(revision: dict[str, Any], use_case: dict[str, Any]) -> str:
    actors = related_nodes(revision, use_case["id"], "participates_in")
    families = related_nodes(revision, use_case["id"], "variant_of")
    rules = related_nodes(revision, use_case["id"], "uses_rule")
    unknowns = unknowns_for_use_case(revision, use_case["id"])
    evidence = evidence_for_node(revision, use_case["id"])
    actor_text = "、".join(item["title"] for item in actors) or "角色尚未确认"
    family_text = "、".join(item["title"] for item in families) or "未形成用例族"
    rule_list = "".join(
        f"<li><strong>{esc(item['title'])}</strong><span>{esc(item.get('statement', item['summary']))}</span></li>"
        for item in rules
    ) or '<li class="empty">未发现已确认规则</li>'
    unknown_list = "".join(
        f"<li><strong>{esc(item['title'])}</strong><span>{esc(item.get('question', item['summary']))}</span>"
        f"<small>{esc(item.get('reason', ''))}</small></li>"
        for item in unknowns
    ) or '<li class="empty">当前用例没有记录未知项</li>'
    evidence_list = "".join(
        "<li>"
        f"<code>{esc(item['repository_relative_path'])}:{item['start_line']}</code>"
        f"<span>{esc(item['symbol'])}</span>"
        f"<small>{esc(item['observation'])}</small>"
        "</li>"
        for item in evidence
    ) or '<li class="empty">没有直接证据</li>'
    goal = use_case.get("goal", {}).get("statement", "")
    return f"""
    <article class="use-case" id="use-case-{esc(use_case['id'])}" data-view="use-cases">
      <header>
        <div>
          <span class="eyebrow">业务用例</span>
          <h2>{esc(use_case['title'])}</h2>
          <p>{esc(use_case['summary'])}</p>
        </div>
        <div class="status"><span>{esc(use_case['claim_status'])}</span><span>{esc(use_case['confidence'])}</span></div>
      </header>
      <section>
        <h3>业务目标</h3>
        <p>{esc(goal)}</p>
        <dl class="facts">
          <div><dt>参与角色</dt><dd>{esc(actor_text)}</dd></div>
          <div><dt>用例族</dt><dd>{esc(family_text)}</dd></div>
        </dl>
      </section>
      <section><h3>触发与前置条件</h3>{render_values(use_case.get('triggers'))}{render_values(use_case.get('preconditions'))}</section>
      <section><h3>主业务流程</h3>{render_values(use_case.get('main_flow'))}</section>
      <section><h3>规则与决策</h3><ul class="detail-list">{rule_list}</ul>{render_values(use_case.get('decision_points'))}</section>
      <section class="three-column">
        <div><h3>状态变化</h3>{render_values(use_case.get('state_changes'))}</div>
        <div><h3>数据变化</h3>{render_values(use_case.get('data_changes'))}</div>
        <div><h3>外部影响</h3>{render_values(use_case.get('external_effects'))}</div>
      </section>
      <section><h3>成功结果</h3>{render_values(use_case.get('success_outcomes'))}</section>
      <section class="three-column">
        <div><h3>拒绝条件</h3>{render_values(use_case.get('rejection_conditions'))}</div>
        <div><h3>失败路径</h3>{render_values(use_case.get('failure_paths'))}</div>
        <div><h3>补偿与修复</h3>{render_values(use_case.get('compensation_paths'))}</div>
      </section>
      <section><h3>权限与可观测性</h3>{render_values(use_case.get('permissions'))}{render_values(use_case.get('observability'))}</section>
      <section><h3>未知项</h3><ul class="detail-list warning">{unknown_list}</ul></section>
      <details>
        <summary>技术证据</summary>
        <ul class="detail-list evidence">{evidence_list}</ul>
      </details>
    </article>
    """


def search_records(revision: dict[str, Any]) -> list[dict[str, Any]]:
    aliases_by_target: dict[str, list[str]] = {}
    for alias in revision["aliases"]:
        for target in alias.get("target_ids", []):
            aliases_by_target.setdefault(target, []).append(alias.get("alias", ""))
    records: list[dict[str, Any]] = []
    groups = [
        ("capability", revision["capabilities"]),
        ("use-case", revision["use_cases"]),
        ("rule", revision["rules"]),
        ("state", revision["state_machines"]),
        ("event", revision["events"]),
        ("entity", revision["entities"]),
        ("term", revision["glossary"]),
        ("unknown", revision["unknowns"]),
        ("conflict", revision["conflicts"]),
    ]
    for kind, nodes in groups:
        for node in nodes:
            records.append(
                {
                    "id": node["id"],
                    "kind": kind,
                    "title": node["title"],
                    "summary": node["summary"],
                    "aliases": aliases_by_target.get(node["id"], []),
                    "route": (
                        f"#use-case/{node['id']}"
                        if kind == "use-case"
                        else f"#{kind}/{node['id']}"
                    ),
                    "status": node["claim_status"],
                    "confidence": node["confidence"],
                }
            )
    return records


def embedded_json(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return (
        payload.replace("&", "\\u0026")
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def section_by_id(detail: dict[str, Any], section_id: str) -> dict[str, Any]:
    for section in detail.get("sections", []):
        if section.get("id") == section_id:
            return section
    return {"id": section_id, "items": [], "empty_state": "not_investigated"}


def section_items(detail: dict[str, Any], *section_ids: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for section_id in section_ids:
        for item in section_by_id(detail, section_id).get("items", []):
            items.append(dict(item) if isinstance(item, dict) else {"statement": str(item)})
    return items


def item_text(item: dict[str, Any]) -> str:
    return str(
        item.get("statement")
        or item.get("question")
        or item.get("summary")
        or item.get("observation")
        or item.get("title")
        or ""
    )


def render_statement_list(
    items: list[dict[str, Any]],
    *,
    ordered: bool = False,
    empty_state: str = "not_investigated",
    empty_text: str = "当前尚未整理出明确内容。",
) -> str:
    if not items:
        return f'<p class="empty" data-empty-state="{esc(empty_state)}">{esc(empty_text)}</p>'
    tag = "ol" if ordered else "ul"
    class_name = "flow-list" if ordered else "business-list"
    rendered = []
    for item in items:
        if not isinstance(item, dict):
            item = {"statement": str(item)}
        source = ""
        if item.get("repository_relative_path"):
            source = (
                f"{item.get('repository_relative_path', '')}:"
                f"{item.get('start_line', '')} {item.get('symbol', '')}"
            ).strip()
        supporting = item.get("reason", "") or source
        rendered.append(
            f"<li><span>{esc(item_text(item))}</span>"
            f"{f'<small>{esc(supporting)}</small>' if supporting else ''}</li>"
        )
    return f'<{tag} class="{class_name}">{"".join(rendered)}</{tag}>'


def first_item_text(detail: dict[str, Any], section_id: str, fallback: str) -> str:
    items = section_items(detail, section_id)
    return item_text(items[0]) if items and item_text(items[0]) else fallback


def use_case_title_map(views: dict[str, Any]) -> dict[str, str]:
    return {
        item["id"]: item["title"]
        for item in views.get("use_case_catalog", [])
        if item.get("id")
    }


def format_ratio(metric: dict[str, Any]) -> str:
    ratio = metric.get("ratio")
    percentage = f"{ratio * 100:.0f}%" if isinstance(ratio, (int, float)) else "未计算"
    numerator = metric.get("numerator")
    denominator = metric.get("denominator")
    if numerator is None or denominator is None:
        return percentage
    return f"{percentage}（{numerator}/{denominator}）"


COVERAGE_LABELS = {
    "scenario_readiness_coverage": "已达到场景可读标准",
    "engineering_readiness_coverage": "核心场景已达到研发下钻标准",
    "end_to_end_flow_coverage": "已完成端到端追踪",
    "calculation_model_coverage": "已建立计算与评分模型",
    "module_dossier_coverage": "已完成业务模块档案",
    "project_module_completion_coverage": "全仓业务模块已完成沉淀",
    "code_knowledge_coverage": "重要代码已建立知识映射",
    "capability_business_coverage": "业务能力已关联核心场景",
    "business_flow_semantic_quality": "流程摘要符合业务表达",
    "required_investigation_coverage": "规定调查动作已完成",
    "family_closure_coverage": "场景族与变体已闭合",
    "candidate_conservation": "发现结果已保留或处置",
    "business_entry_mapping": "业务入口已建立映射",
    "trigger_entry_conservation": "触发入口已保留",
    "language_adapter_coverage": "已识别语言具备发现适配器",
    "before_after_evidence_coverage": "历史前后行为已验证",
    "commit_index_coverage": "请求范围提交已索引",
    "discovered_signals": "已发现代码信号",
    "important_signals": "重要信号（仍需解释）",
    "deep_confirmed_domains": "已形成深度业务域",
    "indexed_commits": "已索引 Git 提交",
    "verified_core_history_events": "已验证核心历史变化",
}
COVERAGE_ORDER = tuple(COVERAGE_LABELS)


def coverage_display_items(metrics: dict[str, Any]) -> list[tuple[str, str, str]]:
    names = [name for name in COVERAGE_ORDER if name in metrics]
    names.extend(sorted(name for name in metrics if name not in COVERAGE_LABELS))
    result = []
    for name in names:
        value = metrics[name]
        if isinstance(value, dict):
            display = format_ratio(value)
        elif isinstance(value, (int, float)):
            display = str(value)
        else:
            continue
        result.append((name, COVERAGE_LABELS.get(name, name.replace("_", " ")), display))
    return result


def render_project_progress(progress: dict[str, Any]) -> str:
    if not progress:
        return ""
    modules = {
        item.get("id"): item
        for item in progress.get("modules", [])
        if item.get("id")
    }
    next_items = [
        modules[module_id]
        for module_id in progress.get("next_module_ids", [])
        if module_id in modules
    ]
    completed = sum(
        1 for item in modules.values() if item.get("status") == "complete"
    )
    queue_html = "".join(
        '<li class="question-item">'
        f'<strong>{esc(item.get("title", item.get("id", "")))}</strong>'
        f'<span>{esc(item.get("next_action", "下一步尚未记录"))}</span>'
        f'<small>{esc(item.get("priority", "normal"))} / {esc(item.get("status", "pending"))}</small></li>'
        for item in next_items
    ) or '<li class="empty" data-empty-state="confirmed_empty">当前没有待执行模块。</li>'
    status = progress.get("project_completion_status", "unknown")
    warning = (
        '<p class="coverage-note"><strong>全项目尚未完成。</strong> 当前修订只是检查点，必须继续下面的模块队列。</p>'
        if status in {"in_progress", "blocked"}
        else '<p class="coverage-note">全仓模块已达到完成或有证据排除标准。</p>'
    )
    return (
        '<section class="project-progress">'
        f'<h3>全仓业务沉淀进度：{esc(status)}</h3>'
        f'<p>已完成 {completed}/{len(modules)} 个模块。</p>{warning}'
        f'<ul class="question-list">{queue_html}</ul></section>'
    )


def render_text_values(values: Any, empty_text: str = "当前未记录。") -> str:
    if not isinstance(values, list) or not values:
        return f'<p class="empty">{esc(empty_text)}</p>'
    return "<ul class=\"business-list\">" + "".join(
        f"<li><span>{esc(item_text(value) if isinstance(value, dict) else value)}</span></li>"
        for value in values
    ) + "</ul>"


def render_v3_flow(flow: dict[str, Any]) -> str:
    stages = []
    for index, stage in enumerate(flow.get("stages", []), start=1):
        stages.append(
            '<article class="flow-stage">'
            f'<header><span>{index}</span><h3>{esc(stage.get("stage_id", f"阶段 {index}"))}</h3></header>'
            '<dl class="stage-facts">'
            f'<div><dt>输入</dt><dd>{esc(stage.get("input", ""))}</dd></div>'
            f'<div><dt>处理</dt><dd>{esc(stage.get("processing", ""))}</dd></div>'
            f'<div><dt>成功输出</dt><dd>{esc(stage.get("success_output", ""))}</dd></div>'
            f'<div><dt>并发 / 幂等</dt><dd>{esc(stage.get("idempotency_or_concurrency", ""))}</dd></div>'
            f'<div><dt>可观测性</dt><dd>{esc(stage.get("observability", ""))}</dd></div>'
            '</dl>'
            '<div class="stage-grid">'
            f'<section><h4>前置条件</h4>{render_text_values(stage.get("preconditions"))}</section>'
            f'<section><h4>业务决策</h4>{render_text_values(stage.get("business_decisions"))}</section>'
            f'<section><h4>数据变化</h4>{render_text_values(stage.get("data_changes"))}</section>'
            f'<section><h4>状态变化</h4>{render_text_values(stage.get("state_changes"))}</section>'
            f'<section><h4>外部影响</h4>{render_text_values(stage.get("external_effects"))}</section>'
            f'<section><h4>拒绝与失败</h4>{render_text_values([*stage.get("rejections", []), *stage.get("failures", [])])}</section>'
            f'<section><h4>恢复</h4><p>{esc(stage.get("recovery", ""))}</p></section>'
            '</div></article>'
        )
    return (
        f'<article class="deep-record" id="flow-{esc(flow.get("id", ""))}">'
        f'<header><span class="section-kicker">{esc(flow.get("id", ""))}</span>'
        f'<h2>{esc(flow.get("title", ""))}</h2><p>{esc(flow.get("business_goal", ""))}</p></header>'
        f'<div class="flow-stages">{"".join(stages)}</div>'
        '<div class="detail-grid">'
        f'<section class="detail-section outcome"><h3>终态结果</h3>{render_text_values(flow.get("terminal_outcomes"))}</section>'
        f'<section class="detail-section exception"><h3>失败与修复</h3>{render_text_values([*flow.get("failure_outcomes", []), *flow.get("repair_paths", [])])}</section>'
        '</div></article>'
    )


def render_v3_module(module: dict[str, Any]) -> str:
    return (
        f'<article class="deep-record" id="module-{esc(module.get("id", ""))}">'
        f'<header><span class="section-kicker">{esc(module.get("id", ""))}</span>'
        f'<h2>{esc(module.get("title", ""))}</h2><p>{esc(module.get("business_purpose", ""))}</p></header>'
        f'<section class="detail-section"><h3>控制与数据流</h3><p>{esc(module.get("control_flow_summary", ""))}</p></section>'
        '<div class="stage-grid">'
        f'<section><h4>关键实体</h4>{render_text_values(module.get("key_entities"))}</section>'
        f'<section><h4>业务规则</h4>{render_text_values(module.get("business_rules"))}</section>'
        f'<section><h4>状态字段</h4>{render_text_values(module.get("state_fields"))}</section>'
        f'<section><h4>计算</h4>{render_text_values(module.get("calculations"))}</section>'
        f'<section><h4>失败路径</h4>{render_text_values(module.get("failure_paths"))}</section>'
        f'<section><h4>修复路径</h4>{render_text_values(module.get("repair_paths"))}</section>'
        '</div>'
        f'<details class="implementation-evidence"><summary>模块源码范围</summary>{render_text_values(module.get("module_paths"))}</details>'
        '</article>'
    )


def view_section(page: dict[str, Any], section_id: str) -> list[dict[str, Any]]:
    for section in page.get("sections", []):
        if section.get("id") == section_id:
            return section.get("items", [])
    return []


def render_atomic_stages(stages: list[dict[str, Any]]) -> str:
    if not stages:
        return '<p class="empty" data-empty-state="not_investigated">该场景尚未达到分阶段深度说明标准。</p>'
    rendered = []
    step_number = 0
    for stage_number, stage in enumerate(stages, start=1):
        steps = []
        for step in stage.get("steps", []):
            step_number += 1
            details = []
            for label, field in [
                ("输入", "inputs"),
                ("判断依据", "decision_basis"),
                ("数据变化", "data_changes"),
                ("状态变化", "state_changes"),
                ("外部影响", "external_effects"),
            ]:
                values = step.get(field, [])
                if values:
                    details.append(
                        f'<div><dt>{label}</dt><dd>{esc("；".join(str(value) for value in values))}</dd></div>'
                    )
            engineering = step.get("engineering_mapping")
            engineering_html = ""
            if isinstance(engineering, dict):
                unit_items = "".join(
                    '<li><strong>' + esc(unit.get("name", "")) + '</strong>'
                    f'<span>{esc(unit.get("kind", ""))} · {esc(unit.get("role", ""))}</span>'
                    f'<small>{esc(unit.get("locator", ""))}</small></li>'
                    for unit in engineering.get("implementation_units", [])
                )
                engineering_facts = "".join(
                    f'<div><dt>{label}</dt><dd>{esc("；".join(str(value) for value in engineering.get(field, [])))}</dd></div>'
                    for label, field in [
                        ("读取", "reads"),
                        ("写入", "writes"),
                        ("状态", "state_behavior"),
                        ("外部交互", "external_interactions"),
                        ("配置", "configuration"),
                        ("运行保障", "runtime_controls"),
                    ]
                    if engineering.get(field)
                )
                engineering_html = (
                    '<details class="step-engineering"><summary>研发实现</summary>'
                    f'<ul class="implementation-units">{unit_items}</ul>'
                    f'<dl class="engineering-facts">{engineering_facts}</dl></details>'
                )
            steps.append(
                '<li class="atomic-step">'
                f'<span class="step-index">{step_number}</span><div class="atomic-step__body">'
                f'<small>{esc(step.get("actor_or_event", "业务事件"))}</small>'
                f'<h4>{esc(step.get("business_action", ""))}</h4>'
                f'<p><strong>本步结果：</strong>{esc(step.get("business_result", ""))}</p>'
                f'<dl class="atomic-facts">{"".join(details)}</dl>'
                f'{engineering_html}'
                '</div></li>'
            )
        rendered.append(
            '<article class="narrative-stage">'
            f'<header><span>阶段 {stage_number}</span><div><h3>{esc(stage.get("title", stage.get("stage_id", "")))}</h3>'
            f'<p>{esc(stage.get("business_purpose", ""))}</p></div></header>'
            f'<ol class="atomic-steps">{"".join(steps)}</ol></article>'
        )
    return "".join(rendered)


def render_engineering_drilldown(items: list[dict[str, Any]]) -> str:
    if not items:
        return '<p class="empty" data-empty-state="not_investigated">尚未完成研发实现下钻。</p>'
    view = items[0]
    topics = "".join(
        '<article class="engineering-topic">'
        f'<header><span>{esc(topic.get("status", ""))}</span><h4>{esc(topic.get("kind", ""))}</h4></header>'
        f'<p>{esc(topic.get("summary", ""))}</p>'
        f'{render_text_values(topic.get("details"), "没有更多细节。")}</article>'
        for topic in view.get("engineering_topics", [])
    )
    return (
        f'<p class="engineering-summary">{esc(view.get("implementation_summary", ""))}</p>'
        f'<div class="engineering-topic-grid">{topics}</div>'
    )


def render_matrix(items: list[dict[str, Any]], fields: list[tuple[str, str]], empty_text: str) -> str:
    if not items:
        return f'<p class="empty" data-empty-state="not_investigated">{esc(empty_text)}</p>'
    cards = []
    for item in items:
        facts = "".join(
            f'<div><dt>{esc(label)}</dt><dd>{esc("；".join(str(value) for value in item.get(field, [])) if isinstance(item.get(field), list) else item_text(item.get(field, {})) if isinstance(item.get(field), dict) else item.get(field, ""))}</dd></div>'
            for label, field in fields
            if item.get(field) not in (None, "", [])
        )
        cards.append(f'<article class="matrix-card"><dl>{facts}</dl></article>')
    return f'<div class="matrix-grid">{"".join(cards)}</div>'


def render_scenario_effects(items: list[dict[str, Any]]) -> str:
    effects: dict[str, list[str]] = {
        "数据变化": [],
        "状态变化": [],
        "外部影响": [],
    }
    for item in items:
        for label, field in (
            ("数据变化", "data_changes"),
            ("状态变化", "state_changes"),
            ("外部影响", "external_effects"),
        ):
            values = item.get(field, []) if isinstance(item, dict) else []
            if not isinstance(values, list):
                values = [values]
            for value in values:
                text = item_text(value) if isinstance(value, dict) else str(value)
                if text and text not in effects[label]:
                    effects[label].append(text)
    if not any(effects.values()):
        return '<p class="empty" data-empty-state="not_investigated">状态、数据与外部影响尚未完成整理。</p>'
    return '<div class="stage-grid">' + "".join(
        f'<section><h4>{esc(label)}</h4>{render_text_values(values, "当前没有记录。")}</section>'
        for label, values in effects.items()
    ) + '</div>'


def render_scenario_page(page: dict[str, Any]) -> str:
    context_items = view_section(page, "context_and_start")
    context = context_items[0] if context_items else {}
    starting = context.get("starting_state", [])
    depth_status = page.get("depth_status", "summary_only")
    depth_label = "已达到深度场景标准" if depth_status == "deep" else "仅有摘要，仍需深化"
    engineering_sections = ""
    engineering_items = view_section(page, "engineering_drilldown")
    if engineering_items:
        engineering_sections = (
            '<section class="scenario-chapter engineering-chapter"><h3>研发实现导航</h3>'
            '<p class="chapter-intro">业务流程仍是主线；这里解释代码如何实现各步骤，以及数据、状态、配置、外部依赖和运行保障。</p>'
            f'{render_engineering_drilldown(engineering_items)}</section>'
            '<section class="scenario-chapter engineering-chapter"><h3>改动影响与验证</h3>'
            f'{render_matrix(view_section(page, "change_guides"), [("改动目标", "change_goal"), ("影响步骤", "affected_step_ids"), ("实现位置", "implementation_units"), ("数据与状态", "data_and_state_impacts"), ("下游风险", "downstream_risks"), ("验证目标", "verification_targets")], "尚未形成研发改动指南。")}</section>'
        )
    return (
        f'<article class="scenario-reading" id="scenario-{esc(page.get("id", ""))}">'
        '<header class="scenario-reading__header"><div>'
        f'<span class="depth-badge {esc(depth_status)}">{esc(depth_label)}</span>'
        f'<h2>{esc(page.get("title", ""))}</h2><p>{esc(page.get("summary", ""))}</p>'
        f'<p class="scenario-goal"><strong>业务目标：</strong>{esc(page.get("goal", ""))}</p></div>'
        '<a href="#core_scenarios">返回场景索引</a></header>'
        '<section class="scenario-chapter"><h3>业务背景与开始状态</h3>'
        f'<p>{esc(context.get("business_context", page.get("summary", "")))}</p>{render_text_values(starting, "开始状态尚未完成整理。")}</section>'
        '<section class="scenario-chapter"><h3>分阶段完整流程</h3>'
        f'{render_atomic_stages(view_section(page, "staged_flow"))}</section>'
        '<section class="scenario-chapter"><h3>分支与判断</h3>'
        f'{render_matrix(view_section(page, "branches"), [("条件", "condition"), ("判断依据", "decision_basis"), ("进入路线", "route"), ("业务结果", "business_result")], "关键分支尚未完成整理。")}</section>'
        '<section class="scenario-chapter"><h3>状态、数据与外部影响</h3>'
        f'{render_scenario_effects(view_section(page, "state_data_effects"))}</section>'
        '<section class="scenario-chapter"><h3>失败、恢复与降级</h3>'
        f'{render_matrix(view_section(page, "failure_and_recovery"), [("失败点", "failure_point"), ("业务影响", "business_impact"), ("停留状态", "stopped_state"), ("自动恢复", "automatic_recovery"), ("人工修复", "manual_repair"), ("降级", "degradation")], "失败与恢复尚未闭合。")}</section>'
        '<section class="scenario-chapter"><h3>业务变体</h3>'
        f'{render_matrix(view_section(page, "variants"), [("变体", "name"), ("与主流程差异", "difference")], "当前场景没有适用变体。")}</section>'
        '<section class="scenario-chapter"><h3>业务实例</h3>'
        f'{render_matrix(view_section(page, "worked_examples"), [("示例", "title"), ("已知条件", "given"), ("发生动作", "when"), ("预期结果", "then")], "尚未提供基于真实规则的业务实例。")}</section>'
        f'{engineering_sections}'
        '<section class="scenario-chapter"><h3>当前与历史变化</h3>'
        f'{render_statement_list(view_section(page, "evolution"), empty_text="当前场景尚无已验证的行为演进。")}</section>'
        '<section class="scenario-chapter questions"><h3>未确认问题</h3>'
        f'{render_statement_list(view_section(page, "open_questions"), empty_state="confirmed_empty", empty_text="当前场景没有已记录的未确认问题。")}</section>'
        '<details class="implementation-evidence"><summary>实现证据</summary>'
        '<p>源码路径和技术标识只用于核验与开发下探。</p>'
        f'{render_statement_list(view_section(page, "implementation_evidence"), empty_text="当前没有可展示的直接证据。")}</details>'
        '</article>'
    )


def render_html_site(model: dict[str, Any]) -> str:
    views = model["views"]
    overview = views["overview"]
    canonical_hash = model["canonical_revision_sha256"]
    snapshot = overview["snapshot"]
    is_v3 = "end_to_end_flows" in views
    overview_id = "business_map" if is_v3 else "overview"
    navigation = "".join(
        f'<a href="#{item["id"]}">{esc(item["label"])}</a>'
        for item in model["navigation"]
    ) if is_v3 else "".join(
        f'<a href="#{target}">{label}</a>'
        for target, label in [
            ("overview", "业务全景"),
            ("business_scenarios", "业务场景"),
            ("key_rules", "关键规则"),
            ("open_questions", "待确认事项"),
            ("analysis_notes", "分析说明"),
        ]
    )
    empty_states = "".join(
        f'<div data-empty-state="{esc(item["state"])}"><strong>{esc(item["state"])}</strong><span>{esc(item["reason"])}</span></div>'
        for item in model["empty_states"]
    )
    capability_html = "".join(
        '<article class="capability-card">'
        f'<span class="card-label">业务能力</span><h3>{esc(item["title"])}</h3>'
        f'<p>{esc(item.get("summary", ""))}</p></article>'
        for item in views["capability_tree"]
    ) or '<p class="empty" data-empty-state="not_investigated">业务能力尚未完成整理。</p>'
    coverage = views["coverage_dashboard"]
    metrics = coverage.get("metrics", coverage)
    coverage_html = "".join(
        f'<div class="coverage-metric {"readiness" if name == "scenario_readiness_coverage" else ""}">'
        f'<dt>{esc(label)}</dt><dd>{esc(display)}</dd></div>'
        for name, label, display in coverage_display_items(metrics)
    )
    coverage_html = coverage_html or (
        '<div class="coverage-metric"><dt>待调查</dt><dd>尚未生成可展示的覆盖指标</dd></div>'
    )
    rules_html = "".join(
        '<li class="rule-item">'
        f'<strong>{esc(item["title"])}</strong>'
        f'<span>{esc(item.get("statement", item.get("summary", "")))}</span></li>'
        for item in views["rule_catalog"]
    ) or '<li class="empty" data-empty-state="not_investigated">关键规则尚未完成整理。</li>'
    unknown_html = "".join(
        '<li class="question-item">'
        f'<strong>{esc(item["title"])}</strong>'
        f'<span>{esc(item.get("question", item.get("summary", "")))}</span>'
        f'<small>{esc(item.get("reason", ""))}</small></li>'
        for item in views["gap_views"]["unknowns"]
    )
    conflict_html = "".join(
        '<li class="question-item conflict">'
        f'<strong>{esc(item["title"])}</strong>'
        f'<span>{esc(item.get("business_question", item.get("summary", "")))}</span></li>'
        for item in views["gap_views"]["conflicts"]
    ) or '<li class="empty" data-empty-state="confirmed_empty">当前已整理范围内未发现相互冲突的业务结论。</li>'
    title_map = use_case_title_map(views)
    actor_html = "".join(
        '<li><strong>'
        f'{esc(item["actor"]["title"])}</strong><span>{esc(item["actor"].get("summary", ""))}</span>'
        f'<small>{esc("、".join(title_map.get(use_case_id, use_case_id) for use_case_id in item.get("use_case_ids", [])) or "相关场景尚待确认")}</small></li>'
        for item in views["actor_permission_views"]
    ) or '<li class="empty" data-empty-state="not_investigated">参与者尚未完成整理。</li>'
    v3_flow_html = "".join(render_v3_flow(item) for item in views.get("end_to_end_flows", []))
    v3_module_html = "".join(render_v3_module(item) for item in views.get("module_dossiers", []))
    calculation_html = "".join(
        '<article class="deep-record">'
        f'<span class="section-kicker">{esc(item.get("id", ""))}</span><h3>{esc(item.get("title", ""))}</h3>'
        f'<p>{esc(item.get("business_purpose", ""))}</p>'
        f'<dl class="stage-facts"><div><dt>算法</dt><dd>{esc(item.get("formula_or_algorithm", ""))}</dd></div>'
        f'<div><dt>缺失值</dt><dd>{esc(item.get("missing_value_policy", ""))}</dd></div>'
        f'<div><dt>取整</dt><dd>{esc(item.get("rounding", ""))}</dd></div>'
        f'<div><dt>上下限</dt><dd>{esc(item.get("caps_and_floors", ""))}</dd></div></dl></article>'
        for item in views.get("calculation_models", [])
    ) or '<p class="empty" data-empty-state="confirmed_empty">当前业务范围未发现独立计算或评分模型。</p>'
    effect_items = [
        value
        for record in views.get("effect_catalog", [])
        for value in record.get("effects", [])
    ]
    evolution_items = views.get("evolution_views", {}).get("events", [])
    v3_sections = ""
    scenario_reading_html = "".join(
        render_scenario_page(page)
        for page in views.get("scenario_reading_pages", [])
    )
    topic_groups = (
        '<details><summary>规则与计算</summary><ul class="rule-list">'
        f'{rules_html}</ul><div class="deep-list">{calculation_html}</div></details>'
        '<details><summary>端到端流程</summary>'
        f'{v3_flow_html}</details><details><summary>模块与代码定位</summary>{v3_module_html}</details>'
        '<details><summary>业务演进时间线</summary>'
        f'{render_statement_list(evolution_items, empty_text="当前范围尚无已验证的业务演进事件。")}</details>'
        '<details><summary>证据、未知与覆盖治理</summary>'
        f'{render_project_progress(views.get("project_progress", {}))}'
        '<p class="coverage-note">已发现、已分类、已保留或已建立代码映射，只说明材料没有丢失；它们不等于业务已经被完整理解。优先查看“已达到场景可读标准”和“已完成端到端追踪”。</p>'
        f'<dl class="coverage">{coverage_html}</dl><ul class="question-list">{unknown_html}{conflict_html}</ul></details>'
    ) if is_v3 else ""
    v3_after_scenarios = (
        '<section class="band knowledge-topics" id="knowledge_topics"><header><div>'
        '<span class="section-kicker">按问题下探</span><h2>专题查询</h2>'
        '<p>当你需要横向查规则、计算、模块、历史或覆盖范围时再进入这里；它们不打断单个业务场景的主阅读线。</p>'
        f'</div></header>{topic_groups}</section>'
    ) if is_v3 else ""

    scenario_cards: list[str] = []
    business_chains: list[str] = []
    use_case_details: list[str] = []
    for detail in views["use_case_details"]:
        summary_items = section_items(detail, "summary")
        summary = summary_items[0] if summary_items else {}
        actors = summary.get("actors", [])
        actor_text = "、".join(actors) if actors else "参与者尚待确认"
        goal = summary.get("goal") or "业务目标尚待确认"
        outcome = first_item_text(detail, "success", "业务结果尚待确认")
        initiation = section_items(detail, "trigger_preconditions")
        flow = section_items(detail, "main_flow")
        rules = section_items(detail, "rules_decisions")
        results = section_items(detail, "effects", "success")
        exceptions = section_items(detail, "rejection_failure", "recovery")
        questions = section_items(detail, "permissions", "variants", "gaps")
        evolution = section_items(detail, "evolution")
        evidence = section_items(detail, "evidence")

        detail_anchor = (
            f"scenario-{detail['id']}" if is_v3 else f"use-case-{detail['id']}"
        )
        scenario_cards.append(
            '<article class="scenario-card">'
            f'<div class="scenario-card__top"><span>业务场景</span><strong>{esc(actor_text)}</strong></div>'
            f'<h3>{esc(detail["title"])}</h3><p>{esc(summary.get("statement", ""))}</p>'
            '<dl class="scenario-facts">'
            f'<div><dt>业务目标</dt><dd>{esc(goal)}</dd></div>'
            f'<div><dt>完成结果</dt><dd>{esc(outcome)}</dd></div></dl>'
            f'<a class="detail-link" href="#{esc(detail_anchor)}">查看场景详情 <span aria-hidden="true">→</span></a>'
            '</article>'
        )
        business_chains.append(
            '<li class="chain-item">'
            f'<span class="chain-node"><small>参与者</small>{esc(actor_text)}</span>'
            '<span class="chain-arrow" aria-hidden="true">→</span>'
            f'<span class="chain-node action"><small>业务动作</small>{esc(detail["title"])}</span>'
            '<span class="chain-arrow" aria-hidden="true">→</span>'
            f'<span class="chain-node"><small>业务结果</small>{esc(outcome)}</span></li>'
        )
        use_case_details.append(
            f'<article class="use-case" id="use-case-{esc(detail["id"])}">'
            '<header class="use-case__header"><div><span class="section-kicker">业务用例详情</span>'
            f'<h2>{esc(detail["title"])}</h2><p>{esc(summary.get("statement", ""))}</p></div>'
            '<a href="#business_scenarios">返回场景列表</a></header>'
            '<section class="use-case__intro">'
            f'<div><span>参与者</span><strong>{esc(actor_text)}</strong></div>'
            f'<div><span>业务目标</span><strong>{esc(goal)}</strong></div></section>'
            '<section class="detail-section"><h3>参与者与发起条件</h3>'
            f'{render_statement_list(initiation, empty_state=section_by_id(detail, "trigger_preconditions").get("empty_state") or "not_investigated")}</section>'
            '<section class="detail-section"><h3>业务流程</h3>'
            f'{render_statement_list(flow, ordered=True, empty_state=section_by_id(detail, "main_flow").get("empty_state") or "not_investigated")}</section>'
            '<section class="detail-grid"><div class="detail-section"><h3>关键规则</h3>'
            f'{render_statement_list(rules, empty_state=section_by_id(detail, "rules_decisions").get("empty_state") or "not_investigated")}</div>'
            '<div class="detail-section outcome"><h3>业务结果</h3>'
            f'{render_statement_list(results)}</div></section>'
            '<section class="detail-section exception"><h3>异常与恢复</h3>'
            f'{render_statement_list(exceptions)}</section>'
            '<section class="detail-section questions"><h3>待确认事项</h3>'
            f'{render_statement_list(questions, empty_text="当前场景没有已记录的待确认事项。")}</section>'
            + (
                '<section class="detail-section"><h3>业务变化</h3>'
                f'{render_statement_list(evolution)}</section>'
                if evolution
                else ""
            )
            +
            '<details class="implementation-evidence"><summary>实现依据</summary>'
            '<p>以下内容用于从业务结论下探到当前源码，不作为默认业务阅读层。</p>'
            f'{render_statement_list(evidence, empty_state=section_by_id(detail, "evidence").get("empty_state") or "not_investigated", empty_text="当前没有可展示的直接源码证据。")}</details>'
            '</article>'
        )

    noscript_cases = "".join(
        f'<li><a href="#{"scenario-" if is_v3 else "use-case-"}{esc(item["id"])}">{esc(item["title"])}</a></li>'
        for item in views["use_case_catalog"]
    )
    data = {
        "canonical_revision_sha256": canonical_hash,
        "snapshot": snapshot,
        "records": [
            {
                "id": item["id"],
                "kind": "use-case",
                "title": item["title"],
                "summary": item.get("summary", ""),
                "aliases": [],
                "route": f"#{'scenario-' if is_v3 else 'use-case-'}{item['id']}",
            }
            for item in views["use_case_catalog"]
        ],
    }
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>项目业务知识地图</title>
<style>
:root {{ --ink:#18211c; --muted:#667168; --paper:#f3f5f1; --panel:#fff; --forest:#234d37; --leaf:#4f765d; --clay:#b7653b; --line:#d9dfd8; --soft:#e9efe9; --warning:#8a6117; --shadow:0 18px 50px rgba(35,77,55,.08); }}
* {{ box-sizing:border-box; }}
html {{ scroll-behavior:smooth; }}
body {{ margin:0; background:var(--paper); color:var(--ink); font:15px/1.65 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }}
button,input {{ font:inherit; }}
.shell {{ min-height:100vh; }}
aside {{ position:sticky; top:0; z-index:20; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:14px max(24px,calc((100vw - 1240px)/2)); border-bottom:1px solid var(--line); background:rgba(243,245,241,.96); backdrop-filter:blur(14px); }}
.brand {{ display:flex; align-items:baseline; gap:10px; white-space:nowrap; }}
.brand strong {{ font-size:17px; }}
.brand small,.empty {{ color:var(--muted); }}
nav {{ display:flex; flex-wrap:wrap; justify-content:flex-end; gap:4px; }}
nav a {{ color:var(--muted); text-decoration:none; padding:7px 10px; border-radius:999px; }}
nav a:hover,nav a.active {{ color:var(--forest); background:var(--soft); }}
a:focus-visible,input:focus-visible,summary:focus-visible {{ outline:3px solid rgba(183,101,59,.3); outline-offset:3px; }}
main {{ min-width:0; }}
.topbar {{ position:relative; max-width:1240px; margin:0 auto; padding:22px 28px 0; }}
.search {{ width:100%; border:1px solid var(--line); background:var(--panel); padding:12px 16px; border-radius:12px; box-shadow:0 6px 20px rgba(24,33,28,.04); }}
.content {{ max-width:1240px; margin:0 auto; padding:28px 28px 84px; }}
.overview {{ position:relative; overflow:hidden; padding:58px clamp(24px,5vw,68px); border-radius:28px; background:var(--forest); color:#fff; box-shadow:var(--shadow); }}
.overview::after {{ content:""; position:absolute; width:360px; height:360px; right:-150px; bottom:-210px; border:70px solid rgba(255,255,255,.06); border-radius:50%; }}
.section-kicker,.card-label {{ display:block; margin-bottom:10px; color:var(--clay); font-size:12px; font-weight:800; letter-spacing:.12em; }}
.overview .section-kicker {{ color:#dca583; }}
h1 {{ max-width:820px; margin:0 0 18px; font-size:clamp(38px,6vw,72px); line-height:1.02; letter-spacing:-.045em; }}
h2 {{ margin:0; font-size:clamp(27px,3vw,38px); line-height:1.15; letter-spacing:-.025em; }}
h3 {{ margin:0; font-size:19px; line-height:1.3; }}
.overview__lead {{ max-width:760px; margin:0; color:#dfe9e2; font-size:18px; }}
.scope-note {{ position:relative; z-index:1; display:inline-flex; margin:30px 0 0; padding:10px 14px; border:1px solid rgba(255,255,255,.18); border-radius:999px; color:#f4f8f5; background:rgba(255,255,255,.08); }}
.band {{ padding:64px 0; border-bottom:1px solid var(--line); }}
.band > header {{ display:flex; justify-content:space-between; align-items:end; gap:24px; margin-bottom:26px; }}
.band > header p {{ max-width:680px; margin:8px 0 0; color:var(--muted); }}
.count {{ flex:none; color:var(--leaf); font-size:13px; font-weight:700; }}
.capability-grid,.scenario-grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }}
.capability-card,.scenario-card {{ padding:24px; border:1px solid var(--line); border-radius:18px; background:var(--panel); box-shadow:0 8px 28px rgba(24,33,28,.035); }}
.capability-card p,.scenario-card p {{ margin:10px 0 0; color:var(--muted); }}
.scenario-card {{ display:flex; flex-direction:column; min-height:300px; }}
.scenario-card__top {{ display:flex; justify-content:space-between; gap:16px; margin-bottom:28px; color:var(--leaf); font-size:12px; }}
.scenario-card__top strong {{ color:var(--ink); }}
.scenario-facts {{ display:grid; gap:10px; margin:22px 0; }}
.scenario-facts div {{ padding-left:12px; border-left:2px solid var(--soft); }}
.scenario-facts dt {{ color:var(--muted); font-size:12px; }}
.scenario-facts dd {{ margin:2px 0 0; }}
.detail-link {{ margin-top:auto; color:var(--clay); font-weight:800; text-decoration:none; }}
.actor-strip {{ list-style:none; display:flex; flex-wrap:wrap; gap:10px; padding:0; margin:22px 0 0; }}
.actor-strip li {{ display:grid; gap:2px; min-width:220px; padding:14px 16px; border-radius:14px; background:var(--soft); }}
.actor-strip span,.actor-strip small {{ color:var(--muted); }}
.business-chain {{ list-style:none; display:grid; gap:14px; padding:0; margin:28px 0 0; }}
.chain-item {{ display:grid; grid-template-columns:minmax(150px,1fr) auto minmax(180px,1.25fr) auto minmax(180px,1.25fr); align-items:stretch; gap:12px; }}
.chain-node {{ display:flex; flex-direction:column; justify-content:center; min-height:82px; padding:14px 16px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }}
.chain-node.action {{ color:#fff; border-color:var(--forest); background:var(--forest); }}
.chain-node small {{ color:var(--muted); }}
.chain-node.action small {{ color:#c9dbcf; }}
.chain-arrow {{ align-self:center; color:var(--clay); font-size:22px; }}
.use-case {{ scroll-margin-top:82px; margin:34px 0; padding:clamp(24px,4vw,46px); border:1px solid var(--line); border-radius:24px; background:var(--panel); box-shadow:var(--shadow); }}
.use-case__header {{ display:flex; justify-content:space-between; gap:24px; align-items:start; padding-bottom:24px; border-bottom:1px solid var(--line); }}
.use-case__header p {{ max-width:760px; margin:12px 0 0; color:var(--muted); }}
.use-case__header a {{ flex:none; color:var(--leaf); text-decoration:none; }}
.use-case__intro {{ display:grid; grid-template-columns:1fr 2fr; gap:14px; margin:26px 0; }}
.use-case__intro div {{ display:grid; gap:4px; padding:18px; border-radius:14px; background:var(--soft); }}
.use-case__intro span {{ color:var(--muted); font-size:12px; }}
.detail-section {{ margin:30px 0; }}
.detail-section h3 {{ margin-bottom:14px; color:var(--forest); }}
.detail-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:24px; }}
.business-list,.flow-list {{ margin:0; padding:0; }}
.business-list {{ list-style:none; display:grid; gap:8px; }}
.business-list li {{ display:grid; gap:4px; padding:12px 0; border-bottom:1px solid #edf0ed; }}
.business-list small {{ color:var(--muted); }}
.flow-list {{ list-style:none; display:grid; counter-reset:flow; gap:12px; }}
.flow-list li {{ counter-increment:flow; display:grid; grid-template-columns:42px 1fr; gap:14px; align-items:start; }}
.flow-list li::before {{ content:counter(flow); display:grid; place-items:center; width:34px; height:34px; border-radius:50%; color:#fff; background:var(--forest); font-weight:800; }}
.outcome {{ padding:20px; border-radius:16px; background:#eef5ef; }}
.exception {{ padding:20px; border-left:4px solid var(--warning); background:#faf7ef; }}
.questions {{ padding:20px; border-radius:16px; background:#f7f2ec; }}
.implementation-evidence,.analysis details {{ margin-top:30px; padding:18px 20px; border:1px solid var(--line); border-radius:14px; background:#f8faf8; }}
.step-engineering {{ margin-top:16px; padding:14px 16px; border:1px solid #d9e5dc; border-radius:12px; background:#f5f9f6; }}
.step-engineering summary {{ cursor:pointer; color:var(--leaf); font-weight:700; }}
.implementation-units {{ display:grid; gap:10px; margin:14px 0; padding:0; list-style:none; }}
.implementation-units li {{ display:grid; gap:3px; padding:10px 12px; border-left:3px solid var(--soft); background:#fff; }}
.implementation-units span,.implementation-units small {{ color:var(--muted); }}
.engineering-facts {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }}
.engineering-facts div,.engineering-topic {{ padding:14px; border:1px solid var(--line); border-radius:12px; background:#fff; }}
.engineering-facts dt {{ color:var(--muted); font-size:12px; }}
.engineering-facts dd {{ margin:4px 0 0; }}
.engineering-chapter {{ padding-top:26px; border-top:1px solid var(--line); }}
.chapter-intro,.engineering-summary {{ color:var(--muted); }}
.engineering-topic-grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }}
.engineering-topic header {{ display:flex; justify-content:space-between; gap:12px; }}
.engineering-topic header span {{ color:var(--leaf); font-size:12px; }}
summary {{ cursor:pointer; color:var(--forest); font-weight:800; }}
.implementation-evidence > p,.analysis details > p {{ color:var(--muted); }}
.rule-list,.question-list {{ list-style:none; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; padding:0; }}
.rule-item,.question-item {{ display:grid; gap:6px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }}
.rule-item span,.question-item span,.question-item small {{ color:var(--muted); }}
.coverage {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }}
.coverage div {{ padding:12px; border:1px solid var(--line); background:var(--panel); }}
.coverage .readiness {{ border-color:rgba(183,101,59,.55); background:#fff8f2; }}
.coverage dt {{ color:var(--muted); font-size:12px; }}
.coverage dd {{ margin:4px 0 0; font-weight:700; }}
.coverage-note {{ margin:0 0 16px; padding:12px 14px; border-left:3px solid var(--clay); color:var(--muted); background:#fff8f2; }}
.empty-states {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:18px; }}
.empty-states div {{ display:grid; gap:4px; padding:12px; border-radius:10px; background:var(--soft); }}
.empty-states span {{ color:var(--muted); }}
.analysis-meta {{ display:grid; gap:8px; margin:18px 0; }}
.analysis-meta p {{ margin:0; }}
.analysis-meta code {{ overflow-wrap:anywhere; }}
.deep-list,.flow-stages {{ display:grid; gap:18px; }}
.scenario-reading {{ scroll-margin-top:82px; margin:34px 0 54px; padding:clamp(24px,4vw,48px); border:1px solid var(--line); border-radius:24px; background:var(--panel); box-shadow:var(--shadow); }}
.scenario-reading__header {{ display:flex; justify-content:space-between; gap:24px; padding-bottom:24px; border-bottom:1px solid var(--line); }}
.scenario-reading__header p {{ max-width:820px; color:var(--muted); }}
.scenario-reading__header a {{ flex:none; color:var(--leaf); text-decoration:none; }}
.depth-badge {{ display:inline-flex; margin-bottom:12px; padding:6px 10px; border-radius:999px; font-size:12px; font-weight:800; }}
.depth-badge.deep {{ color:#23523a; background:#e4f1e7; }}
.depth-badge.summary_only {{ color:#8a6117; background:#faf0d7; }}
.scenario-chapter {{ margin:36px 0; }}
.scenario-chapter > h3 {{ margin-bottom:16px; color:var(--forest); font-size:22px; }}
.narrative-stage {{ margin:18px 0; padding:22px; border:1px solid var(--line); border-radius:18px; background:#f8faf8; }}
.narrative-stage > header {{ display:flex; gap:16px; align-items:start; }}
.narrative-stage > header > span {{ flex:none; padding:5px 9px; border-radius:999px; color:#fff; background:var(--forest); font-size:12px; font-weight:800; }}
.narrative-stage > header p {{ margin:5px 0 0; color:var(--muted); }}
.atomic-steps {{ list-style:none; display:grid; gap:12px; margin:20px 0 0; padding:0; }}
.atomic-step {{ display:grid; grid-template-columns:38px 1fr; gap:14px; padding:16px; border-radius:14px; background:#fff; }}
.step-index {{ display:grid; place-items:center; width:32px; height:32px; border-radius:50%; color:#fff; background:var(--clay); font-weight:800; }}
.atomic-step__body small {{ color:var(--leaf); font-weight:800; }}
.atomic-step__body h4 {{ margin:4px 0 8px; font-size:17px; }}
.atomic-step__body p {{ margin:0 0 10px; }}
.atomic-facts,.matrix-card dl {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin:0; }}
.atomic-facts div,.matrix-card dl div {{ padding:10px; border-radius:10px; background:var(--soft); }}
.atomic-facts dt,.matrix-card dt {{ color:var(--muted); font-size:12px; }}
.atomic-facts dd,.matrix-card dd {{ margin:3px 0 0; }}
.matrix-grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }}
.matrix-card {{ padding:16px; border:1px solid var(--line); border-radius:14px; background:#fff; }}
.knowledge-topics > details {{ margin:12px 0; padding:18px 20px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }}
.deep-record {{ margin:22px 0; padding:28px; border:1px solid var(--line); border-radius:20px; background:var(--panel); box-shadow:var(--shadow); }}
.deep-record > header p {{ max-width:820px; color:var(--muted); }}
.flow-stage {{ padding:22px; border:1px solid var(--line); border-radius:16px; background:#f8faf8; }}
.flow-stage > header {{ display:flex; gap:12px; align-items:center; margin-bottom:16px; }}
.flow-stage > header span {{ display:grid; place-items:center; width:32px; height:32px; border-radius:50%; color:#fff; background:var(--forest); font-weight:800; }}
.stage-facts {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }}
.stage-facts div {{ padding:12px; border-radius:12px; background:var(--soft); }}
.stage-facts dt {{ color:var(--muted); font-size:12px; }}
.stage-facts dd {{ margin:4px 0 0; }}
.stage-grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; margin-top:18px; }}
.stage-grid section {{ padding:16px; border:1px solid var(--line); border-radius:12px; background:var(--panel); }}
.stage-grid h4 {{ margin:0 0 10px; color:var(--forest); }}
.search-results {{ display:none; position:absolute; z-index:30; top:72px; left:28px; right:28px; max-height:60vh; overflow:auto; border:1px solid var(--line); border-radius:12px; background:#fff; box-shadow:0 18px 42px rgba(23,33,27,.16); }}
.search-results.visible {{ display:block; }}
.search-results a {{ display:grid; gap:2px; color:var(--ink); text-decoration:none; padding:11px 14px; border-bottom:1px solid #e8ece9; }}
.search-results a:hover {{ background:#f1f5f1; }}
@media (prefers-reduced-motion:reduce) {{ html {{ scroll-behavior:auto; }} }}
@media (max-width:820px) {{
  aside {{ position:static; display:grid; padding:16px; }}
  nav {{ justify-content:flex-start; }}
  .topbar {{ padding:18px 16px 0; }}
  .content {{ padding:26px 16px 56px; }}
  .overview {{ padding:38px 24px; border-radius:20px; }}
  .capability-grid,.scenario-grid,.detail-grid,.use-case__intro,.rule-list,.question-list,.coverage,.empty-states,.stage-facts,.stage-grid,.matrix-grid,.atomic-facts,.matrix-card dl,.engineering-facts,.engineering-topic-grid {{ grid-template-columns:1fr; }}
  .chain-item {{ grid-template-columns:1fr; }}
  .chain-arrow {{ transform:rotate(90deg); justify-self:center; }}
  .use-case__header {{ display:grid; }}
  .band {{ padding:48px 0; }}
}}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand"><strong>项目业务知识</strong><small>业务结论可追溯</small></div>
  <nav>
{navigation}
  </nav>
</aside>
<main>
  <div class="topbar">
    <input class="search" id="search" type="search" placeholder="搜索业务场景、目标、规则或实现线索" aria-label="搜索业务知识">
    <div class="search-results" id="search-results"></div>
  </div>
  <div class="content">
    <section class="overview" id="{overview_id}">
      <span class="section-kicker">业务全景</span>
      <h1>从业务目标出发，理解这个系统如何运转</h1>
      <p class="overview__lead">这里围绕参与者、业务问题、流程、规则、结果与异常恢复组织知识。需要核验时，可以从具体业务用例继续下探到当前源码依据。</p>
      <p class="scope-note">当前已整理 {len(views['use_case_catalog'])} 个业务场景；其他业务能力将在后续分析中持续补充，本页面不代表系统完整业务全貌。</p>
    </section>
    <section class="band" id="business_capabilities"><header><div><span class="section-kicker">业务地图</span><h2>能力、参与者与推荐主线</h2><p>先判断系统解决什么问题、由谁参与，再选择一条核心场景从头读到尾。</p></div><span class="count">{len(views['capability_tree'])} 项能力</span></header><div class="capability-grid">{capability_html}</div><ul class="actor-strip">{actor_html}</ul></section>
    {v3_sections}
    <section class="band" id="business_chains"><header><div><span class="section-kicker">业务链</span><h2>参与者如何获得业务结果</h2><p>每条链只保留参与者、业务动作与结果，具体规则和异常在场景详情中展开。</p></div></header><ol class="business-chain">{"".join(business_chains)}</ol></section>
    <section class="band" id="core_scenarios"><header><div><span class="section-kicker">主要阅读区</span><h2>核心业务场景</h2><p>每个场景在一个页面内连续讲清业务背景、完整流程、分支、状态数据、失败恢复、实例、历史和证据。</p></div><span class="count">当前已整理 {len(views['use_case_catalog'])} 个</span></header><div class="scenario-grid">{"".join(scenario_cards)}</div>{scenario_reading_html if is_v3 else "".join(use_case_details)}</section>
    {v3_after_scenarios if is_v3 else f'<section class="band" id="key_rules"><header><div><span class="section-kicker">跨场景约束</span><h2>关键规则</h2><p>这些规则会影响产品行为和后续需求设计，修改前应确认受影响的业务场景。</p></div><span class="count">{len(views["rule_catalog"])} 条</span></header><ul class="rule-list">{rules_html}</ul></section><section class="band" id="open_questions"><header><div><span class="section-kicker">产品决策边界</span><h2>待确认事项</h2><p>以下问题尚不能由当前源码证据完整回答。涉及这些范围的新需求，应先完成针对性调查。</p></div><span class="count">{len(views["gap_views"]["unknowns"]) + len(views["gap_views"]["conflicts"])} 项</span></header><ul class="question-list">{unknown_html}{conflict_html}</ul></section><section class="band analysis" id="analysis_notes"><header><div><span class="section-kicker">可信度与范围</span><h2>分析说明</h2><p>业务阅读不需要先理解这些信息；核验知识来源、覆盖范围或生成一致性时再展开。</p></div></header><details><summary>查看分析范围与证据说明</summary><div class="analysis-meta"><p>Snapshot: <code>{esc(snapshot.get("snapshot_id", "unknown"))}</code></p><p>Canonical revision: <code>{esc(canonical_hash)}</code></p><p>Repository: <code>{esc(snapshot.get("canonical_root", "unknown"))}</code></p></div><dl class="coverage">{coverage_html}</dl><div class="empty-states">{empty_states}</div></details></section>'}
    <noscript>
      <section class="band">
        <h2>业务场景索引</h2>
        <ul>{noscript_cases}</ul>
        <p>当前页面的业务内容、场景详情和分析说明不依赖脚本；脚本仅用于本地搜索和定位增强。</p>
      </section>
    </noscript>
  </div>
</main>
</div>
<script id="business-knowledge-data" type="application/json">{embedded_json(data)}</script>
<script>
(function () {{
  var data = JSON.parse(document.getElementById("business-knowledge-data").textContent);
  var input = document.getElementById("search");
  var results = document.getElementById("search-results");
  function normalize(value) {{ return String(value || "").toLowerCase(); }}
  function show(query) {{
    var needle = normalize(query).trim();
    if (!needle) {{ results.className = "search-results"; results.innerHTML = ""; return; }}
    var matches = data.records.filter(function (item) {{
      return normalize([item.title, item.summary, item.kind, item.aliases.join(" ")].join(" ")).indexOf(needle) !== -1;
    }}).slice(0, 30);
    results.innerHTML = matches.map(function (item) {{
      return '<a href="' + item.route + '"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.summary) + '</span></a>';
    }}).join("") || '<a href="#open_questions"><strong>没有直接结果</strong><span>查看待确认事项，或针对该问题继续调查。</span></a>';
    results.className = "search-results visible";
  }}
  function escapeHtml(value) {{
    return String(value).replace(/[&<>"']/g, function (char) {{
      return {{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[char];
    }});
  }}
  input.addEventListener("input", function () {{ show(input.value); }});
  results.addEventListener("click", function () {{ results.className = "search-results"; }});
  function route() {{
    var hash = decodeURIComponent(location.hash || "");
    if (hash.indexOf("#use-case/") === 0) {{
      var id = hash.slice("#use-case/".length);
      var target = document.getElementById("use-case-" + id);
      if (target) target.scrollIntoView({{block:"start"}});
    }}
  }}
  window.addEventListener("hashchange", route);
  route();
}})();
</script>
</body>
</html>
"""


def write_projections(revision_dir: Path | str) -> dict[str, Any]:
    root = Path(revision_dir)
    canonical_hash = refresh_canonical_hashes(root)
    revision = load_canonical_revision(root)
    model = site_view_model.build_site_view_model(revision)
    ai_context = render_ai_context(revision)
    html_site = render_html_site(model)
    # The builder already sorts unordered canonical collections. Preserve ordered UI contracts such
    # as navigation, scenario chapters, stages, and atomic steps when serializing the projection.
    view_model_text = contract.canonical_json_bytes(model, sort_records=False).decode("utf-8") + "\n"
    ai_path = root / "ai-context.md"
    html_path = root / "site" / "index.html"
    view_model_path = root / "site-view-model.json"
    write_text_atomic(ai_path, ai_context)
    write_text_atomic(html_path, html_site)
    write_text_atomic(view_model_path, view_model_text)

    manifest = guard.read_json(root / "manifest.json")
    manifest["projection_hashes"] = {
        "ai": {
            "canonical_sha256": canonical_hash,
            "sha256": sha256_text(ai_context),
            "path": "ai-context.md",
        },
        "html": {
            "canonical_sha256": canonical_hash,
            "sha256": sha256_text(html_site),
            "path": "site/index.html",
        },
        "view_model": {
            "canonical_sha256": canonical_hash,
            "sha256": sha256_text(view_model_text),
            "path": "site-view-model.json",
        },
    }
    guard.write_json_atomic(root / "manifest.json", manifest)
    validation = guard.validate_revision(root)
    return {
        "ai": manifest["projection_hashes"]["ai"],
        "html": manifest["projection_hashes"]["html"],
        "validation": validation,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    render = subparsers.add_parser("render")
    render.add_argument("--revision", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = write_projections(args.revision)
    except guard.ValidationError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
