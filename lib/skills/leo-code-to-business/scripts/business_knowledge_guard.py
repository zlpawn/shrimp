#!/usr/bin/env python3
"""Validate, hash, publish, and benchmark canonical business knowledge revisions."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import uuid
from pathlib import Path
from typing import Any, Iterable


SCHEMA_VERSION = "1.0"
CLAIM_STATUSES = {
    "confirmed",
    "inferred",
    "document_claim",
    "historical",
    "conflicted",
    "unknown",
}
LIFECYCLE_STATUSES = {"active", "conditional", "stale", "invalidated", "expired"}
CONFIDENCE_LEVELS = {"E3", "E2", "E1", "E0"}
CLASSIFICATIONS = {
    "business",
    "technical_support",
    "operations",
    "compensation_or_retry",
    "external_integration",
    "infrastructure",
    "unresolved",
}
REQUIRED_INVESTIGATIONS = {
    "vocabulary_expansion",
    "entry_search",
    "forward_trace",
    "backward_trace",
    "alternate_entry_search",
    "rule_search",
    "contradiction_search",
    "source_verification",
}
FORBIDDEN_FOREIGN_FIELDS = {
    "actor_ids",
    "rule_ids",
    "evidence_ids",
    "capability_id",
    "capability_ids",
    "related_use_case_ids",
    "use_case_ids",
    "family_id",
}
NODE_FILES = {
    "capabilities.json": "array",
    "actors.json": "array",
    "use-case-families.json": "array",
    "use-cases.jsonl": "jsonl",
    "business-rules.jsonl": "jsonl",
    "workflows.jsonl": "jsonl",
    "state-machines.json": "array",
    "domain-events.jsonl": "jsonl",
    "entities.json": "array",
    "glossary.json": "array",
    "conflicts.jsonl": "jsonl",
    "unknowns.jsonl": "jsonl",
}
CANONICAL_FILES = [
    "inventory.jsonl",
    *NODE_FILES.keys(),
    "aliases.json",
    "relationships.jsonl",
    "investigations.jsonl",
    "evidence.jsonl",
    "coverage.json",
    "change-impact.json",
]


class ValidationError(Exception):
    """Raised when canonical business knowledge violates a release contract."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot read valid JSON from {path}: {exc}") from exc


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError as exc:
        raise ValidationError(f"cannot read {path}: {exc}") from exc
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"invalid JSONL {path}:{line_number}: {exc}") from exc
        if not isinstance(value, dict):
            raise ValidationError(f"{path}:{line_number} must be an object")
        records.append(value)
    return records


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex}.partial")
    partial.write_text(
        json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(partial, path)


def require_fields(record: dict[str, Any], fields: Iterable[str], label: str) -> None:
    missing = [field for field in fields if field not in record]
    if missing:
        raise ValidationError(f"{label} missing fields: {', '.join(missing)}")


def load_node_records(revision_dir: Path) -> dict[str, list[dict[str, Any]]]:
    loaded: dict[str, list[dict[str, Any]]] = {}
    for name, kind in NODE_FILES.items():
        path = revision_dir / name
        if not path.exists():
            raise ValidationError(f"missing canonical artifact: {name}")
        value = read_jsonl(path) if kind == "jsonl" else read_json(path)
        if not isinstance(value, list):
            raise ValidationError(f"{name} must contain an array")
        loaded[name] = value
    return loaded


def validate_common_node(node: dict[str, Any], source_file: str) -> None:
    require_fields(
        node,
        [
            "id",
            "title",
            "summary",
            "claim_status",
            "lifecycle_status",
            "confidence",
            "source_snapshot",
            "semantic_revision",
            "created_at",
            "updated_at",
        ],
        f"{source_file} node",
    )
    if node["claim_status"] not in CLAIM_STATUSES:
        raise ValidationError(f"{node['id']} invalid claim_status")
    if node["lifecycle_status"] not in LIFECYCLE_STATUSES:
        raise ValidationError(f"{node['id']} invalid lifecycle_status")
    if node["confidence"] not in CONFIDENCE_LEVELS:
        raise ValidationError(f"{node['id']} invalid confidence")
    forbidden = sorted(FORBIDDEN_FOREIGN_FIELDS & set(node))
    if forbidden:
        raise ValidationError(
            f"{node['id']} duplicates relationship fields: {', '.join(forbidden)}"
        )


def embedded_addresses(node: dict[str, Any]) -> set[str]:
    addresses: set[str] = set()
    node_id = str(node.get("id", ""))
    for key, value in node.items():
        if key in {
            "id",
            "title",
            "summary",
            "claim_status",
            "lifecycle_status",
            "confidence",
            "source_snapshot",
            "semantic_revision",
            "created_at",
            "updated_at",
        }:
            continue
        if isinstance(value, list):
            addresses.add(f"{node_id}#{key}")
            for item in value:
                if isinstance(item, dict) and item.get("local_id"):
                    addresses.add(f"{node_id}#{key}/{item['local_id']}")
        elif isinstance(value, dict):
            addresses.add(f"{node_id}#{key}")
            if value.get("local_id"):
                addresses.add(f"{node_id}#{key}/{value['local_id']}")
    for dimension in [
        "preconditions",
        "decision_points",
        "state_changes",
        "data_changes",
        "external_effects",
        "rejection_conditions",
        "failure_paths",
        "compensation_paths",
        "permissions",
        "observability",
    ]:
        addresses.add(f"{node_id}#{dimension}")
    return addresses


def validate_inventory(records: list[dict[str, Any]]) -> dict[str, Any]:
    if not records:
        raise ValidationError("inventory must contain at least one entry")
    ids: set[str] = set()
    business = 0
    mapped_business = 0
    for record in records:
        require_fields(
            record,
            [
                "id",
                "kind",
                "name",
                "classification",
                "source_location",
                "resolution_status",
                "mapped_node_ids",
            ],
            "inventory item",
        )
        if record["id"] in ids:
            raise ValidationError(f"duplicate inventory id: {record['id']}")
        ids.add(record["id"])
        if record["classification"] not in CLASSIFICATIONS:
            raise ValidationError(
                f"inventory {record['id']} requires exactly one valid classification"
            )
        if not isinstance(record["mapped_node_ids"], list):
            raise ValidationError(f"inventory {record['id']} mapped_node_ids must be a list")
        if record["classification"] == "business":
            business += 1
            if record["mapped_node_ids"]:
                mapped_business += 1
    return {
        "ids": ids,
        "count": len(records),
        "business": business,
        "mapped_business": mapped_business,
    }


def validate_evidence(
    records: list[dict[str, Any]],
    snapshot_id: str,
) -> tuple[set[str], dict[str, dict[str, Any]]]:
    ids: set[str] = set()
    by_id: dict[str, dict[str, Any]] = {}
    for record in records:
        require_fields(
            record,
            [
                "id",
                "source_kind",
                "repository_relative_path",
                "symbol",
                "start_line",
                "end_line",
                "content_sha256",
                "snapshot_id",
                "observation",
                "provider",
                "source_verified",
            ],
            "evidence",
        )
        if record["id"] in ids:
            raise ValidationError(f"duplicate evidence id: {record['id']}")
        if record["snapshot_id"] != snapshot_id:
            raise ValidationError(f"evidence {record['id']} snapshot mismatch")
        ids.add(record["id"])
        by_id[record["id"]] = record
    return ids, by_id


def validate_investigations(
    records: list[dict[str, Any]],
    snapshot_id: str,
) -> dict[str, set[str]]:
    by_subject: dict[str, set[str]] = {}
    for record in records:
        require_fields(
            record,
            [
                "id",
                "question_or_node_id",
                "investigation_kind",
                "provider",
                "provider_version",
                "queries",
                "scope",
                "files_and_symbols_inspected",
                "candidate_results",
                "accepted_results",
                "rejected_results_and_reason",
                "truncated",
                "source_verified",
                "repository_snapshot",
                "status",
                "completed_at",
            ],
            "investigation",
        )
        if not isinstance(record["queries"], list) or not record["queries"]:
            raise ValidationError(f"investigation {record['id']} requires queries")
        inspected = record["files_and_symbols_inspected"]
        if not isinstance(inspected, list) or not inspected:
            raise ValidationError(
                f"investigation {record['id']} requires inspected files or symbols"
            )
        if record["repository_snapshot"] != snapshot_id:
            raise ValidationError(f"investigation {record['id']} snapshot mismatch")
        if record["truncated"] and record["status"] == "completed":
            raise ValidationError(
                f"investigation {record['id']} is truncated and cannot be completed"
            )
        by_subject.setdefault(record["question_or_node_id"], set()).add(
            record["investigation_kind"]
        )
    return by_subject


def relationship_index(
    relationships: list[dict[str, Any]],
    known_ids: set[str],
    allowed_addresses: set[str],
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    index: dict[tuple[str, str], list[dict[str, Any]]] = {}
    relation_ids = {item.get("id") for item in relationships if item.get("id")}
    valid_targets = known_ids | allowed_addresses | relation_ids
    for record in relationships:
        require_fields(
            record,
            [
                "id",
                "from_id",
                "type",
                "to_id",
                "claim_status",
                "lifecycle_status",
            ],
            "relationship",
        )
        if record["from_id"] not in valid_targets:
            raise ValidationError(
                f"relationship {record['id']} has missing source {record['from_id']}"
            )
        if record["to_id"] not in valid_targets:
            raise ValidationError(
                f"relationship {record['id']} has missing target {record['to_id']}"
            )
        index.setdefault((record["from_id"], record["type"]), []).append(record)
    return index


def has_verified_evidence(
    source_id: str,
    relationships: dict[tuple[str, str], list[dict[str, Any]]],
    evidence_by_id: dict[str, dict[str, Any]],
) -> bool:
    links = relationships.get((source_id, "evidenced_by"), [])
    return any(
        evidence_by_id.get(link["to_id"], {}).get("source_verified") is True
        for link in links
    )


def validate_unknowns(records: list[dict[str, Any]]) -> None:
    for record in records:
        if record.get("claim_status") != "unknown":
            raise ValidationError(f"unknown {record.get('id')} must have unknown status")
        require_fields(
            record,
            [
                "question",
                "importance",
                "reason",
                "search_status",
                "searched_evidence",
            ],
            f"unknown {record.get('id')}",
        )
        if (
            record["search_status"] != "completed"
            or not isinstance(record["searched_evidence"], list)
            or not record["searched_evidence"]
        ):
            raise ValidationError(
                f"unknown {record['id']} requires a completed search envelope"
            )


def validate_use_cases(
    use_cases: list[dict[str, Any]],
    relationship_map: dict[tuple[str, str], list[dict[str, Any]]],
    investigations: dict[str, set[str]],
    evidence_by_id: dict[str, dict[str, Any]],
) -> None:
    dimensions = [
        "preconditions",
        "decision_points",
        "state_changes",
        "data_changes",
        "external_effects",
        "rejection_conditions",
        "failure_paths",
        "compensation_paths",
        "permissions",
        "observability",
    ]
    for use_case in use_cases:
        if use_case["claim_status"] != "confirmed":
            continue
        require_fields(
            use_case,
            ["goal", "triggers", "main_flow", "success_outcomes"],
            f"confirmed use case {use_case['id']}",
        )
        if not isinstance(use_case["goal"], dict) or not use_case["goal"].get("statement"):
            raise ValidationError(f"confirmed use case {use_case['id']} requires goal")
        for field in ["triggers", "main_flow", "success_outcomes"]:
            if not isinstance(use_case[field], list) or not use_case[field]:
                raise ValidationError(
                    f"confirmed use case {use_case['id']} requires {field}"
                )
        if not relationship_map.get((use_case["id"], "participates_in")) and not any(
            key[1] == "participates_in"
            and any(item["to_id"] == use_case["id"] for item in values)
            for key, values in relationship_map.items()
        ):
            raise ValidationError(
                f"confirmed use case {use_case['id']} requires an actor relationship"
            )
        if not has_verified_evidence(use_case["id"], relationship_map, evidence_by_id):
            raise ValidationError(
                f"confirmed use case {use_case['id']} requires verified evidence"
            )
        missing_investigations = REQUIRED_INVESTIGATIONS - investigations.get(
            use_case["id"], set()
        )
        if missing_investigations:
            raise ValidationError(
                f"confirmed use case {use_case['id']} missing investigations: "
                + ", ".join(sorted(missing_investigations))
            )
        for dimension in dimensions:
            value = use_case.get(dimension)
            if isinstance(value, list) and value:
                continue
            address = f"{use_case['id']}#{dimension}"
            if not relationship_map.get((address, "has_unknown")):
                raise ValidationError(
                    f"confirmed use case {use_case['id']} missing {dimension} "
                    "without searched unknown"
                )


def validate_rules(
    rules: list[dict[str, Any]],
    relationship_map: dict[tuple[str, str], list[dict[str, Any]]],
    evidence_by_id: dict[str, dict[str, Any]],
) -> None:
    for rule in rules:
        require_fields(
            rule,
            ["statement", "applies_when", "decision", "business_effect", "exceptions"],
            f"business rule {rule['id']}",
        )
        if rule["claim_status"] == "confirmed" and rule["confidence"] == "E3":
            if not has_verified_evidence(rule["id"], relationship_map, evidence_by_id):
                raise ValidationError(
                    f"confirmed rule {rule['id']} requires verified current-source evidence"
                )


def calculate_coverage(
    inventory: dict[str, Any],
    use_cases: list[dict[str, Any]],
    investigations: dict[str, set[str]],
) -> dict[str, Any]:
    confirmed = [item for item in use_cases if item.get("claim_status") == "confirmed"]
    completed_signals = sum(
        len(REQUIRED_INVESTIGATIONS & investigations.get(item["id"], set()))
        for item in confirmed
    )
    required_signals = len(confirmed) * len(REQUIRED_INVESTIGATIONS)
    return {
        "entry_classification": inventory["count"] / inventory["count"],
        "business_entry_mapping": (
            inventory["mapped_business"] / inventory["business"]
            if inventory["business"]
            else 1.0
        ),
        "required_investigations": (
            completed_signals / required_signals if required_signals else 1.0
        ),
        "raw_counts": {
            "inventory": inventory["count"],
            "business_entries": inventory["business"],
            "mapped_business_entries": inventory["mapped_business"],
            "confirmed_use_cases": len(confirmed),
            "completed_investigation_signals": completed_signals,
            "required_investigation_signals": required_signals,
        },
    }


def canonical_revision_sha256(revision_dir: Path) -> str:
    payload: dict[str, Any] = {}
    for name in CANONICAL_FILES:
        path = revision_dir / name
        if not path.exists():
            continue
        payload[name] = (
            read_jsonl(path) if path.suffix == ".jsonl" else read_json(path)
        )
    return canonical_sha256(payload)


def validate_semantic_review(
    review: dict[str, Any],
    canonical_hash: str,
) -> None:
    require_fields(
        review,
        [
            "review_protocol_version",
            "reviewer_mode",
            "canonical_revision_sha256",
            "scores",
            "total_score",
            "reviewed_at",
        ],
        "semantic review",
    )
    if review["canonical_revision_sha256"] != canonical_hash:
        raise ValidationError("semantic review canonical hash does not match revision")
    scores = review["scores"]
    required = {
        "business_framing",
        "main_flow",
        "rules_and_decisions",
        "effects",
        "failure_and_recovery",
        "variants",
        "evidence",
        "unknown_discipline",
    }
    if not isinstance(scores, dict) or set(scores) != required:
        raise ValidationError("semantic review scores are incomplete")
    if any(value not in {0, 1, 2} for value in scores.values()):
        raise ValidationError("semantic review score must be 0, 1, or 2")
    if sum(scores.values()) != review["total_score"]:
        raise ValidationError("semantic review total is inconsistent")


def validate_projections(manifest: dict[str, Any], canonical_hash: str) -> None:
    if manifest.get("canonical_revision_sha256") != canonical_hash:
        raise ValidationError("manifest canonical revision hash mismatch")
    projections = manifest.get("projection_hashes", {})
    for name in ["ai", "html"]:
        record = projections.get(name)
        if not isinstance(record, dict):
            raise ValidationError(f"projection {name} is missing")
        if record.get("canonical_sha256") != canonical_hash:
            raise ValidationError(f"projection {name} canonical hash mismatch")


def validate_projection_files(
    revision_dir: Path,
    manifest: dict[str, Any],
) -> None:
    for name, record in manifest.get("projection_hashes", {}).items():
        relative_path = record.get("path") if isinstance(record, dict) else None
        expected_sha256 = record.get("sha256") if isinstance(record, dict) else None
        if not relative_path:
            continue
        projection_path = revision_dir / relative_path
        if not projection_path.is_file():
            raise ValidationError(f"projection {name} file is missing: {relative_path}")
        actual = hashlib.sha256(projection_path.read_bytes()).hexdigest()
        if expected_sha256 != actual:
            raise ValidationError(f"projection {name} file hash mismatch")


def validate_revision(revision_dir: Path | str) -> dict[str, Any]:
    root = Path(revision_dir)
    manifest = read_json(root / "manifest.json")
    snapshot = manifest.get("repository_snapshot", {})
    snapshot_id = snapshot.get("snapshot_id")
    if not snapshot_id:
        raise ValidationError("manifest repository snapshot is missing snapshot_id")

    inventory_records = read_jsonl(root / "inventory.jsonl")
    inventory = validate_inventory(inventory_records)
    nodes_by_file = load_node_records(root)
    all_nodes = [node for values in nodes_by_file.values() for node in values]
    node_ids: set[str] = set()
    addresses: set[str] = set()
    for source_file, nodes in nodes_by_file.items():
        for node in nodes:
            validate_common_node(node, source_file)
            if node["id"] in node_ids:
                raise ValidationError(f"duplicate node id: {node['id']}")
            node_ids.add(node["id"])
            addresses |= embedded_addresses(node)
    validate_unknowns(nodes_by_file["unknowns.jsonl"])

    evidence = read_jsonl(root / "evidence.jsonl")
    evidence_ids, evidence_by_id = validate_evidence(evidence, snapshot_id)
    investigations = validate_investigations(
        read_jsonl(root / "investigations.jsonl"),
        snapshot_id,
    )
    relationships = read_jsonl(root / "relationships.jsonl")
    known_ids = node_ids | evidence_ids | inventory["ids"]
    relationship_map = relationship_index(relationships, known_ids, addresses)

    validate_use_cases(
        nodes_by_file["use-cases.jsonl"],
        relationship_map,
        investigations,
        evidence_by_id,
    )
    validate_rules(
        nodes_by_file["business-rules.jsonl"],
        relationship_map,
        evidence_by_id,
    )
    coverage = calculate_coverage(
        inventory,
        nodes_by_file["use-cases.jsonl"],
        investigations,
    )
    canonical_hash = manifest.get("canonical_revision_sha256")
    if not canonical_hash:
        raise ValidationError("manifest canonical revision hash is missing")
    calculated_hash = canonical_revision_sha256(root)
    if canonical_hash != calculated_hash:
        raise ValidationError("manifest canonical revision hash does not match artifacts")
    validate_projections(manifest, canonical_hash)
    validate_projection_files(root, manifest)
    validate_semantic_review(read_json(root / "semantic-review.json"), canonical_hash)

    pass_metrics = [
        coverage["entry_classification"],
        coverage["business_entry_mapping"],
        coverage["required_investigations"],
    ]
    status = "passed" if all(value == 1.0 for value in pass_metrics) else "partial"
    if manifest.get("coverage_status") == "blocked":
        status = "blocked"
    return {
        "status": status,
        "errors": [],
        "coverage": coverage,
        "canonical_revision_sha256": canonical_hash,
        "calculated_canonical_sha256": calculated_hash,
        "node_count": len(node_ids),
        "relationship_count": len(relationships),
        "evidence_count": len(evidence),
    }


def publish_revision(
    run_dir: Path | str,
    workspace_root: Path | str,
) -> dict[str, Any]:
    staging = Path(run_dir)
    workspace = Path(workspace_root)
    validation = validate_revision(staging)
    if validation["status"] == "blocked":
        raise ValidationError("blocked revision cannot be published")
    revision_hash = validation["canonical_revision_sha256"]
    revision_id = f"REV-{revision_hash[:16]}"
    revisions = workspace / "revisions"
    target = revisions / revision_id
    revisions.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise ValidationError(f"revision already exists: {revision_id}")
    temporary = revisions / f".{revision_id}.{uuid.uuid4().hex}.partial"
    shutil.copytree(staging, temporary)
    os.replace(temporary, target)
    current = {
        "schema_version": SCHEMA_VERSION,
        "revision_id": revision_id,
        "status": validation["status"],
        "snapshot_sha256": read_json(target / "manifest.json")["repository_snapshot"].get(
            "snapshot_sha256"
        ),
        "canonical_revision_sha256": revision_hash,
        "ai_path": f"revisions/{revision_id}/ai-context.md",
        "html_path": f"revisions/{revision_id}/site/index.html",
    }
    write_json_atomic(workspace / "current.json", current)
    return current


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    validate = subparsers.add_parser("validate-model")
    validate.add_argument("--revision", required=True)
    publish = subparsers.add_parser("publish")
    publish.add_argument("--run-dir", required=True)
    publish.add_argument("--workspace", required=True)
    audit = subparsers.add_parser("audit")
    audit.add_argument("--revision", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command in {"validate-model", "audit"}:
            result = validate_revision(args.revision)
        else:
            result = publish_revision(args.run_dir, args.workspace)
    except ValidationError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
