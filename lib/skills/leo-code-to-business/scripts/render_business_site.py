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


def render_html_site(revision: dict[str, Any]) -> str:
    manifest = revision["manifest"]
    canonical_hash = manifest["canonical_revision_sha256"]
    snapshot = manifest.get("repository_snapshot", {})
    use_case_html = "".join(
        render_use_case(revision, use_case) for use_case in revision["use_cases"]
    )
    capability_items = "".join(
        f"<li><strong>{esc(item['title'])}</strong><span>{esc(item['summary'])}</span></li>"
        for item in revision["capabilities"]
    )
    coverage_items = "".join(
        f"<div><dt>{esc(key.replace('_', ' '))}</dt><dd>{esc(value)}</dd></div>"
        for key, value in revision["coverage"].items()
        if isinstance(value, (int, float, str))
    )
    unknown_items = "".join(
        f"<li><strong>{esc(item['title'])}</strong><span>{esc(item.get('question', item['summary']))}</span><small>{esc(item.get('reason', ''))}</small></li>"
        for item in revision["unknowns"]
    )
    rules_items = "".join(
        f"<li><strong>{esc(item['title'])}</strong><span>{esc(item.get('statement', item['summary']))}</span></li>"
        for item in revision["rules"]
    )
    noscript_cases = "".join(
        f"<li><a href=\"#use-case-{esc(item['id'])}\">{esc(item['title'])}</a> - {esc(item['summary'])}</li>"
        for item in revision["use_cases"]
    )
    data = {
        "canonical_revision_sha256": canonical_hash,
        "snapshot": snapshot,
        "records": search_records(revision),
        "aliases": revision["aliases"],
    }
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>业务知识库</title>
<style>
:root {{ --ink:#17211b; --muted:#5d6b63; --line:#d7ddd8; --paper:#f7f8f5; --panel:#fff; --green:#17633b; --blue:#245c8a; --amber:#8b5a08; --red:#9b2c2c; }}
* {{ box-sizing:border-box; }}
html {{ scroll-behavior:smooth; }}
body {{ margin:0; background:var(--paper); color:var(--ink); font:15px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; letter-spacing:0; }}
button,input {{ font:inherit; }}
.shell {{ display:grid; grid-template-columns:240px minmax(0,1fr); min-height:100vh; }}
aside {{ position:sticky; top:0; height:100vh; padding:24px 18px; border-right:1px solid var(--line); background:#eef1ed; }}
.brand {{ margin-bottom:24px; }}
.brand strong {{ display:block; font-size:20px; }}
.brand small,.meta,.empty {{ color:var(--muted); }}
nav {{ display:grid; gap:4px; }}
nav a {{ color:var(--ink); text-decoration:none; padding:8px 10px; border-left:3px solid transparent; }}
nav a:hover,nav a.active {{ background:#fff; border-left-color:var(--green); }}
main {{ min-width:0; }}
.topbar {{ position:sticky; top:0; z-index:10; display:flex; gap:12px; align-items:center; padding:14px 28px; border-bottom:1px solid var(--line); background:rgba(247,248,245,.96); }}
.search {{ flex:1; min-width:0; border:1px solid #aeb8b1; background:#fff; padding:10px 12px; border-radius:4px; }}
.content {{ max-width:1180px; margin:0 auto; padding:34px 28px 72px; }}
.overview {{ display:grid; grid-template-columns:2fr 1fr; gap:28px; align-items:start; border-bottom:1px solid var(--line); padding-bottom:30px; }}
h1 {{ margin:0 0 10px; font-size:34px; line-height:1.15; }}
h2 {{ margin:0; font-size:25px; }}
h3 {{ margin:0 0 10px; font-size:15px; color:var(--green); }}
.overview p,.use-case header p {{ color:var(--muted); max-width:74ch; }}
.snapshot {{ border-left:4px solid var(--blue); padding-left:16px; }}
.snapshot code {{ overflow-wrap:anywhere; }}
.band {{ padding:28px 0; border-bottom:1px solid var(--line); }}
.band > header {{ display:flex; justify-content:space-between; align-items:end; gap:16px; margin-bottom:18px; }}
.detail-list,.fact-list {{ list-style:none; padding:0; margin:0; display:grid; gap:8px; }}
.detail-list li,.fact-list li {{ display:grid; gap:2px; padding:9px 0; border-bottom:1px solid #e8ece9; }}
.detail-list span,.fact-list span {{ color:#33423a; }}
small {{ color:var(--muted); }}
.use-case {{ padding:34px 0; border-bottom:2px solid var(--line); }}
.use-case > header {{ display:flex; justify-content:space-between; gap:24px; align-items:start; margin-bottom:24px; }}
.eyebrow {{ color:var(--green); font-size:12px; text-transform:uppercase; }}
.status {{ display:flex; gap:6px; white-space:nowrap; }}
.status span {{ border:1px solid var(--line); padding:3px 7px; font-size:12px; }}
.use-case section {{ margin:22px 0; }}
.facts {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }}
.facts div {{ border-left:3px solid var(--green); padding-left:12px; }}
.facts dt {{ color:var(--muted); font-size:12px; }}
.facts dd {{ margin:2px 0 0; }}
.three-column {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; }}
.warning li {{ border-left:3px solid var(--amber); padding-left:10px; }}
.evidence code {{ color:var(--blue); overflow-wrap:anywhere; }}
details {{ margin-top:24px; border-top:1px solid var(--line); padding-top:14px; }}
summary {{ cursor:pointer; font-weight:600; }}
.coverage {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }}
.coverage div {{ padding:12px; border:1px solid var(--line); background:var(--panel); }}
.coverage dt {{ color:var(--muted); font-size:12px; }}
.coverage dd {{ margin:4px 0 0; font-weight:700; }}
.search-results {{ display:none; position:absolute; top:58px; left:28px; right:28px; max-height:60vh; overflow:auto; border:1px solid var(--line); background:#fff; box-shadow:0 12px 28px rgba(23,33,27,.14); }}
.search-results.visible {{ display:block; }}
.search-results a {{ display:grid; gap:2px; color:var(--ink); text-decoration:none; padding:11px 14px; border-bottom:1px solid #e8ece9; }}
.search-results a:hover {{ background:#f1f5f1; }}
@media (max-width:820px) {{
  .shell {{ grid-template-columns:1fr; }}
  aside {{ position:static; height:auto; border-right:0; border-bottom:1px solid var(--line); }}
  nav {{ grid-template-columns:repeat(2,minmax(0,1fr)); }}
  .topbar {{ top:0; padding:12px 16px; }}
  .content {{ padding:26px 16px 56px; }}
  .overview,.three-column,.facts,.coverage {{ grid-template-columns:1fr; }}
  .use-case > header {{ display:grid; }}
  h1 {{ font-size:29px; }}
}}
</style>
</head>
<body>
<div class="shell">
<aside>
  <div class="brand"><strong>业务知识库</strong><small>代码证据驱动</small></div>
  <nav>
    <a href="#overview">概览</a>
    <a href="#capabilities">业务能力</a>
    <a href="#use-cases">业务用例</a>
    <a href="#rules">业务规则</a>
    <a href="#states">状态</a>
    <a href="#events">事件</a>
    <a href="#glossary">术语</a>
    <a href="#unknowns">未知与冲突</a>
    <a href="#coverage">覆盖率</a>
    <a href="#evidence">证据</a>
  </nav>
</aside>
<main>
  <div class="topbar">
    <input class="search" id="search" type="search" placeholder="搜索业务名称、目标、规则、代码符号或未知问题" aria-label="搜索业务知识">
    <span class="meta">{esc(manifest.get('coverage_status', 'partial'))}</span>
    <div class="search-results" id="search-results"></div>
  </div>
  <div class="content">
    <section class="overview" id="overview">
      <div>
        <span class="eyebrow">Current business behavior</span>
        <h1>从代码还原的业务知识</h1>
        <p>围绕角色、目标、流程、规则、状态、影响、异常、补偿和未知项组织。技术实现只作为可展开证据。</p>
      </div>
      <div class="snapshot">
        <strong>知识快照</strong>
        <p>Snapshot: <code>{esc(snapshot.get('snapshot_id', 'unknown'))}</code></p>
        <p>Canonical: <code>{esc(canonical_hash)}</code></p>
        <p>Repository: <code>{esc(snapshot.get('canonical_root', 'unknown'))}</code></p>
      </div>
    </section>
    <section class="band" id="capabilities"><header><h2>业务能力</h2><span>{len(revision['capabilities'])}</span></header><ul class="detail-list">{capability_items}</ul></section>
    <section class="band" id="use-cases"><header><h2>业务用例</h2><span>{len(revision['use_cases'])}</span></header>{use_case_html}</section>
    <section class="band" id="rules"><header><h2>业务规则</h2><span>{len(revision['rules'])}</span></header><ul class="detail-list">{rules_items}</ul></section>
    <section class="band" id="states"><header><h2>状态</h2><span>{len(revision['state_machines'])}</span></header><p class="empty">状态机按业务对象展示；当前样例未定义独立状态机。</p></section>
    <section class="band" id="events"><header><h2>事件</h2><span>{len(revision['events'])}</span></header><p class="empty">业务事件会显示生产者、消费者和失败影响。</p></section>
    <section class="band" id="glossary"><header><h2>术语</h2><span>{len(revision['glossary'])}</span></header><ul class="detail-list">{''.join(f"<li><strong>{esc(x['title'])}</strong><span>{esc(x['summary'])}</span></li>" for x in revision['glossary'])}</ul></section>
    <section class="band" id="unknowns"><header><h2>未知与冲突</h2><span>{len(revision['unknowns']) + len(revision['conflicts'])}</span></header><ul class="detail-list warning">{unknown_items}</ul></section>
    <section class="band" id="coverage"><header><h2>覆盖率</h2></header><dl class="coverage">{coverage_items}</dl></section>
    <section class="band" id="evidence"><header><h2>证据</h2><span>{len(revision['evidence'])}</span></header><p>证据已嵌入各业务用例，可展开查看当前源码位置、符号和观察结论。</p></section>
    <noscript>
      <section class="band">
        <h2>无脚本业务用例索引</h2>
        <ul>{noscript_cases}</ul>
        <h2>无脚本覆盖率</h2>
        <dl class="coverage">{coverage_items}</dl>
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
      return '<a href="' + item.route + '"><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.summary) + '</span><small>' + escapeHtml(item.kind + " · " + item.status + " · " + item.confidence) + '</small></a>';
    }}).join("") || '<a href="#unknowns"><strong>没有直接结果</strong><span>查看未知项或触发针对性重新分析。</span></a>';
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
    ai_context = render_ai_context(revision)
    html_site = render_html_site(revision)
    ai_path = root / "ai-context.md"
    html_path = root / "site" / "index.html"
    write_text_atomic(ai_path, ai_context)
    write_text_atomic(html_path, html_site)

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
