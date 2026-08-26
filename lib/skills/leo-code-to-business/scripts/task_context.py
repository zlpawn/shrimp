#!/usr/bin/env python3
"""Build bounded AI task packs and evidence-qualified impact results."""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from collections import deque
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_contract as contract
import render_business_site as renderer


EXPANSION_RULES = {
    "variant_of": 1,
    "uses_rule": 1,
    "writes": 1,
    "transitions": 1,
    "emits": 1,
    "consumes": 1,
    "calls_external": 1,
    "fails_to": 1,
    "compensates": 1,
    "evolved_by": 1,
}
CONFIRMED_RELATIONSHIPS = {
    "variant_of",
    "uses_rule",
    "writes",
    "transitions",
    "emits",
    "consumes",
    "calls_external",
    "fails_to",
    "compensates",
    "evolved_by",
}


def _normalize(value: Any) -> str:
    return contract.canonical_json_bytes(value).decode("utf-8").casefold()


def _node_text(node: dict[str, Any]) -> str:
    return " ".join(
        str(value)
        for key, value in node.items()
        if key not in {"created_at", "updated_at", "source_snapshot"}
    )


def retrieve_candidate_nodes(question: str, revision: dict[str, Any]) -> list[str]:
    query = question.casefold()
    query_terms = set(query.replace("/", " ").replace("-", " ").split())
    aliases = revision.get("aliases", [])
    alias_targets = {
        item.get("alias", "").casefold(): list(item.get("target_ids", []))
        for item in aliases
    }
    scored: dict[str, tuple[int, str]] = {}
    for kind in ("use_cases", "rules", "entities", "state_machines"):
        for node in revision.get(kind, []):
            node_id = node.get("id")
            if not node_id:
                continue
            text = _node_text(node)
            for alias, targets in alias_targets.items():
                if alias and alias in query and node_id in targets:
                    scored[node_id] = (0, f"exact alias {alias}")
                    break
            if node_id.casefold() in query:
                scored.setdefault(node_id, (1, "stable id"))
            elif any(word and word in query_terms for word in str(node.get("title", "")).split()):
                scored.setdefault(node_id, (2, "title term"))
            elif any(term in query for term in str(node.get("summary", "")).split() if term):
                scored.setdefault(node_id, (3, "summary term"))
    for relationship in revision.get("relationships", []):
        source = relationship.get("from_id", "")
        target = relationship.get("to_id", "")
        if source in scored and target in revision.get("nodes", {}):
            current = scored.get(target)
            if current is None or current[0] > 4:
                scored[target] = (4, f"related by {relationship.get('type')}")
    return sorted(scored, key=lambda node_id: (scored[node_id][0], node_id))[:20]


def query_terms_for(question: str) -> list[str]:
    text = question.casefold()
    return [term for term in text.split() if term] + [
        fragment
        for fragment in ("工单", "取消", "整改", "退款", "修复")
        if fragment in text
    ]


def expand_business_context(
    node_ids: list[str],
    revision: dict[str, Any],
    max_nodes: int = 80,
) -> dict[str, Any]:
    selected: set[str] = set()
    scores: dict[str, int] = {}
    queue: deque[tuple[str, int]] = deque((node_id, 0) for node_id in node_ids if node_id)
    truncated = False
    deferred: list[str] = []
    while queue:
        node_id, depth = queue.popleft()
        if len(selected) >= max_nodes and len(selected) > 0:
            truncated = True
            deferred.append(node_id)
            break
        if len(selected) >= max_nodes:
            continue
        if node_id in selected:
            continue
        selected.add(node_id)
        scores[node_id] = depth
        if depth >= max(EXPANSION_RULES.values()):
            continue
        for relationship in sorted(
            revision.get("relationships", []),
            key=lambda item: (
                item.get("type", ""),
                item.get("from_id", ""),
                item.get("to_id", ""),
                item.get("id", ""),
            ),
        ):
            if relationship.get("type") not in EXPANSION_RULES:
                continue
            if relationship.get("from_id") == node_id:
                queue.append((relationship["to_id"], depth + 1))
            elif relationship.get("to_id") == node_id:
                queue.append((relationship["from_id"], depth + 1))

    by_type: dict[str, list[str]] = {
        "primary_use_case_ids": [],
        "related_use_case_ids": [],
        "rule_ids": [],
        "state_ids": [],
        "entity_ids": [],
        "evolution_ids": [],
        "evidence_ids": [],
    }
    for node_id in sorted(selected):
        node = revision["nodes"].get(node_id)
        if node_id.startswith("UC-"):
            target = by_type["primary_use_case_ids"] if node_id in node_ids else by_type["related_use_case_ids"]
            target.append(node_id)
        elif node_id.startswith(("BR-", "RULE-")):
            by_type["rule_ids"].append(node_id)
        elif node_id.startswith("STATE-"):
            by_type["state_ids"].append(node_id)
        elif node_id.startswith("ENT-"):
            by_type["entity_ids"].append(node_id)
        elif node_id.startswith("EVOL-"):
            by_type["evolution_ids"].append(node_id)
        elif node_id.startswith("EV-"):
            by_type["evidence_ids"].append(node_id)

    warnings = []
    if truncated:
        warnings.append("context_truncated")
        warnings.append("deferred_node_ids:" + ",".join(sorted(set(deferred))))
    if revision.get("coverage", {}).get("current_coverage_status") == "partial":
        warnings.append("current_coverage_partial")
    if revision.get("coverage", {}).get("history_coverage_status") == "partial":
        warnings.append("history_coverage_partial")
    return {
        "node_ids": sorted(selected),
        "node_count": len(selected),
        **by_type,
        "unknown_ids": [
            item["id"]
            for item in revision.get("unknowns", [])
            if item["id"] in selected
            or any(relationship.get("to_id") == item["id"] for relationship in revision.get("relationships", []))
        ],
        "coverage_warnings": warnings,
    }


def build_task_context_pack(question: str, revision: dict[str, Any]) -> dict[str, Any]:
    primary = set(retrieve_candidate_nodes(question, revision))
    # Retrieval includes entities and other dimensions even before relationships are migrated.
    for node_id, node in revision.get("nodes", {}).items():
        text = _node_text(node).casefold()
        if node_id in primary or any(term in text for term in query_terms_for(question)):
            primary.add(node_id)
    primary = sorted(primary)
    context = expand_business_context(primary, revision)
    # Text retrieval can find important entities that lack a v1-style relationship.
    for entity in revision.get("entities", []):
        entity_id = entity.get("id")
        if entity_id and entity_id in primary:
            context["entity_ids"].append(entity_id)
            if entity_id not in context["node_ids"]:
                context["node_ids"].append(entity_id)
                context["node_count"] += 1
    # Always include primary evidence and high-importance unknowns.
    evidence_ids = set(context["evidence_ids"])
    unknown_ids = set(context["unknown_ids"])
    for relationship in revision.get("relationships", []):
        if relationship.get("from_id") in primary and relationship.get("type") == "evidenced_by":
            evidence_ids.add(relationship["to_id"])
    for unknown in revision.get("unknowns", []):
        if unknown.get("importance") in {"critical", "high"}:
            unknown_ids.add(unknown["id"])
    for entity_id in list(context["entity_ids"]):
        for relationship in revision.get("relationships", []):
            if relationship.get("from_id") == entity_id or relationship.get("to_id") == entity_id:
                other = relationship.get("to_id") if relationship.get("from_id") == entity_id else relationship.get("from_id")
                if other and other not in context["node_ids"]:
                    context["node_ids"].append(other)
                    context["node_count"] += 1
                    if other.startswith("EVOL-"):
                        context["evolution_ids"].append(other)
                    elif other.startswith("ENT-"):
                        context["entity_ids"].append(other)
                    elif other.startswith("EV-"):
                        context["evidence_ids"].append(other)
    context["evidence_ids"] = sorted(evidence_ids)
    context["unknown_ids"] = sorted(unknown_ids)
    lineage_path = revision["root"] / "lineage-links.jsonl"
    if lineage_path.exists():
        lineage_links = [json.loads(line) for line in lineage_path.read_text(encoding="utf-8").splitlines() if line]
        selected = set(context["node_ids"])
        evolution_ids = set(context["evolution_ids"])
        for link in lineage_links:
            if link.get("from_id") in selected and link.get("to_id", "").startswith("EVOL-"):
                evolution_ids.add(link["to_id"])
                selected.add(link["to_id"])
        context["node_ids"] = sorted(selected)
        context["node_count"] = len(selected)
        context["evolution_ids"] = sorted(evolution_ids)
    if context["unknown_ids"] and "unknowns_present" not in context["coverage_warnings"]:
        context["coverage_warnings"].append("unknowns_present")
    return {
        **context,
        "question": question,
        "retrieval_reasons": {
            node_id: f"ranked retrieval for {node_id}" for node_id in primary
        },
    }


def analyze_business_impact(
    changed_semantic_ids: list[str],
    revision: dict[str, Any],
) -> list[dict[str, Any]]:
    impacts = []
    changed = set(changed_semantic_ids)
    for relationship in revision.get("relationships", []):
        if relationship.get("from_id") not in changed and relationship.get("to_id") not in changed:
            continue
        if relationship.get("type") not in CONFIRMED_RELATIONSHIPS:
            continue
        impact_level = "confirmed" if relationship.get("claim_status") == "confirmed" else "probable"
        evidence_ids = []
        for endpoint in (relationship.get("from_id"), relationship.get("to_id")):
            evidence_ids.extend(
                relation["to_id"]
                for relation in revision.get("relationships", [])
                if relation.get("from_id") == endpoint
                and relation.get("type") == "evidenced_by"
            )
        impacts.append(
            {
                "changed_semantic_id": relationship.get("from_id"),
                "affected_node_id": relationship.get("to_id"),
                "relationship": relationship.get("type"),
                "impact": impact_level,
                "distance": 1,
                "evidence_ids": sorted(set(evidence_ids)),
            }
        )
    return sorted(impacts, key=lambda item: (item["changed_semantic_id"], item["affected_node_id"]))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    build = subparsers.add_parser("build")
    build.add_argument("--revision", type=Path, required=True)
    build.add_argument("--question", required=True)
    build.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    revision = renderer.load_canonical_revision(args.revision)
    pack = build_task_context_pack(args.question, revision)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    partial = args.output.with_name(f".{args.output.name}.{uuid.uuid4().hex}.partial")
    partial.write_text(
        json.dumps(pack, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(partial, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
