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
    canonical_hash = guard.canonical_revision_sha256(root)
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


def render_ai_context(revision: dict[str, Any]) -> str:
    manifest = revision["manifest"]
    canonical_hash = manifest["canonical_revision_sha256"]
    snapshot = manifest.get("repository_snapshot", {})
    capabilities = "\n".join(
        f"- `{item['id']}`: {item['title']} - {item['summary']}"
        for item in revision["capabilities"]
    ) or "- No confirmed capabilities."
    aliases = "\n".join(
        f"- `{item.get('alias')}` -> {', '.join(item.get('target_ids', []))}"
        for item in revision["aliases"][:30]
    ) or "- No aliases."
    unknown_count = len(revision["unknowns"])
    conflict_count = len(revision["conflicts"])
    lines = [
        "# Business Knowledge AI Context",
        "",
        f"- Canonical revision: `{canonical_hash}`",
        f"- Snapshot: `{snapshot.get('snapshot_id', 'unknown')}`",
        f"- Repository: `{snapshot.get('canonical_root', 'unknown')}`",
        f"- Status: `{manifest.get('coverage_status', 'partial')}`",
        f"- Unknowns: `{unknown_count}`",
        f"- Conflicts: `{conflict_count}`",
        "",
        "## Capabilities",
        "",
        capabilities,
        "",
        "## File Routing",
        "",
        "- `use-cases.jsonl`: actors pursuing goals, flows, decisions, effects, failures, and outcomes.",
        "- `use-case-families.json`: alternate channels, lifecycle variants, unbind/rebind, and repair paths.",
        "- `business-rules.jsonl`: business conditions, decisions, and effects.",
        "- `state-machines.json`: lifecycle states and transitions.",
        "- `entities.json`: business meaning of records and fields.",
        "- `unknowns.jsonl` and `conflicts.jsonl`: limits, unresolved questions, and contradictions.",
        "- `relationships.jsonl`: authoritative links between all knowledge and evidence.",
        "- `evidence.jsonl` and `investigations.jsonl`: current-source proof and completed search work.",
        "",
        "## Alias Resolution",
        "",
        aliases,
        "",
        "## Answer Policy",
        "",
        "Lead with business purpose, actor, trigger, goal, flow, rules, outcome, failures, variants,",
        "unknowns, and evidence. Technical symbols support the explanation; they are not the hierarchy.",
        "Treat current source as authoritative for current behavior. Keep inference, documents, history,",
        "conflicts, and unknowns visibly separate. Trigger targeted investigation before answering when",
        "the snapshot is stale or required dimensions are missing.",
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


def render_html_site(model: dict[str, Any]) -> str:
    views = model["views"]
    overview = views["overview"]
    canonical_hash = model["canonical_revision_sha256"]
    snapshot = overview["snapshot"]
    navigation = "".join(
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
        f'<div><dt>{esc(name.replace("_", " "))}</dt><dd>{esc(format_ratio(value))}</dd></div>'
        for name, value in sorted(metrics.items())
        if isinstance(value, dict)
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

        scenario_cards.append(
            '<article class="scenario-card">'
            f'<div class="scenario-card__top"><span>业务场景</span><strong>{esc(actor_text)}</strong></div>'
            f'<h3>{esc(detail["title"])}</h3><p>{esc(summary.get("statement", ""))}</p>'
            '<dl class="scenario-facts">'
            f'<div><dt>业务目标</dt><dd>{esc(goal)}</dd></div>'
            f'<div><dt>完成结果</dt><dd>{esc(outcome)}</dd></div></dl>'
            f'<a class="detail-link" href="#use-case-{esc(detail["id"])}">查看场景详情 <span aria-hidden="true">→</span></a>'
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
        f'<li><a href="#use-case-{esc(item["id"])}">{esc(item["title"])}</a></li>'
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
                "route": f"#use-case-{item['id']}",
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
summary {{ cursor:pointer; color:var(--forest); font-weight:800; }}
.implementation-evidence > p,.analysis details > p {{ color:var(--muted); }}
.rule-list,.question-list {{ list-style:none; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; padding:0; }}
.rule-item,.question-item {{ display:grid; gap:6px; padding:18px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }}
.rule-item span,.question-item span,.question-item small {{ color:var(--muted); }}
.coverage {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }}
.coverage div {{ padding:12px; border:1px solid var(--line); background:var(--panel); }}
.coverage dt {{ color:var(--muted); font-size:12px; }}
.coverage dd {{ margin:4px 0 0; font-weight:700; }}
.empty-states {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; margin-top:18px; }}
.empty-states div {{ display:grid; gap:4px; padding:12px; border-radius:10px; background:var(--soft); }}
.empty-states span {{ color:var(--muted); }}
.analysis-meta {{ display:grid; gap:8px; margin:18px 0; }}
.analysis-meta p {{ margin:0; }}
.analysis-meta code {{ overflow-wrap:anywhere; }}
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
  .capability-grid,.scenario-grid,.detail-grid,.use-case__intro,.rule-list,.question-list,.coverage,.empty-states {{ grid-template-columns:1fr; }}
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
    <section class="overview" id="overview">
      <span class="section-kicker">业务全景</span>
      <h1>从业务目标出发，理解这个系统如何运转</h1>
      <p class="overview__lead">这里围绕参与者、业务问题、流程、规则、结果与异常恢复组织知识。需要核验时，可以从具体业务用例继续下探到当前源码依据。</p>
      <p class="scope-note">当前已整理 {len(views['use_case_catalog'])} 个业务场景；其他业务能力将在后续分析中持续补充，本页面不代表系统完整业务全貌。</p>
    </section>
    <section class="band" id="business_capabilities"><header><div><span class="section-kicker">系统解决什么问题</span><h2>当前已整理的业务能力</h2><p>这些能力来自当前已完成语义收敛的业务场景，不等同于项目的完整能力清单。</p></div><span class="count">{len(views['capability_tree'])} 项能力</span></header><div class="capability-grid">{capability_html}</div><ul class="actor-strip">{actor_html}</ul></section>
    <section class="band" id="business_chains"><header><div><span class="section-kicker">业务链</span><h2>参与者如何获得业务结果</h2><p>每条链只保留参与者、业务动作与结果，具体规则和异常在场景详情中展开。</p></div></header><ol class="business-chain">{"".join(business_chains)}</ol></section>
    <section class="band" id="business_scenarios"><header><div><span class="section-kicker">逐层下探</span><h2>业务场景</h2><p>先阅读业务目标与结果，再进入详情查看流程、规则、异常恢复和实现依据。</p></div><span class="count">当前已整理 {len(views['use_case_catalog'])} 个</span></header><div class="scenario-grid">{"".join(scenario_cards)}</div>{"".join(use_case_details)}</section>
    <section class="band" id="key_rules"><header><div><span class="section-kicker">跨场景约束</span><h2>关键规则</h2><p>这些规则会影响产品行为和后续需求设计，修改前应确认受影响的业务场景。</p></div><span class="count">{len(views['rule_catalog'])} 条</span></header><ul class="rule-list">{rules_html}</ul></section>
    <section class="band" id="open_questions"><header><div><span class="section-kicker">产品决策边界</span><h2>待确认事项</h2><p>以下问题尚不能由当前源码证据完整回答。涉及这些范围的新需求，应先完成针对性调查。</p></div><span class="count">{len(views['gap_views']['unknowns']) + len(views['gap_views']['conflicts'])} 项</span></header><ul class="question-list">{unknown_html}{conflict_html}</ul></section>
    <section class="band analysis" id="analysis_notes"><header><div><span class="section-kicker">可信度与范围</span><h2>分析说明</h2><p>业务阅读不需要先理解这些信息；核验知识来源、覆盖范围或生成一致性时再展开。</p></div></header><details><summary>查看分析范围与证据说明</summary><div class="analysis-meta"><p>Snapshot: <code>{esc(snapshot.get('snapshot_id', 'unknown'))}</code></p><p>Canonical revision: <code>{esc(canonical_hash)}</code></p><p>Repository: <code>{esc(snapshot.get('canonical_root', 'unknown'))}</code></p><p>当前整理状态：{esc('已通过当前范围校验' if overview.get('aggregate_status') == 'passed' else '当前范围已发布，仍有业务知识待继续整理')}</p></div><dl class="coverage">{coverage_html}</dl><div class="empty-states">{empty_states}</div></details></section>
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
    view_model_text = contract.canonical_json_bytes(model, sort_records=True).decode("utf-8") + "\n"
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
