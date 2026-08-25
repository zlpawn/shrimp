#!/usr/bin/env python3
"""Validate, hash, publish, and benchmark canonical business knowledge revisions."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_contract as contract


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
CANONICAL_FILES = list(contract.V1_CANONICAL_FILES)
IMPACT_BIDIRECTIONAL_RELATIONSHIPS = {
    "contains",
    "participates_in",
    "variant_of",
    "uses_rule",
    "writes",
    "transitions",
    "emits",
    "consumes",
    "calls_external",
    "fails_to",
    "compensates",
    "has_unknown",
    "conflicts_with",
}
IMPACT_DEPENDENCY_RELATIONSHIPS = {"reads", "evidenced_by"}
QUERY_INTENTS = (
    {
        "keywords": ("还有", "哪些", "入口", "方式", "渠道", "变体", "variant", "alternate"),
        "dimensions": ("variants", "backward_trace"),
        "investigations": (
            "alternate_entry_search",
            "backward_trace",
            "source_verification",
        ),
    },
    {
        "keywords": ("规则", "条件", "判断", "决定", "rule", "condition", "decision"),
        "dimensions": ("rules_and_decisions",),
        "investigations": ("rule_search", "source_verification"),
    },
    {
        "keywords": ("失败", "异常", "重试", "补偿", "修复", "failure", "retry", "compensation"),
        "dimensions": ("failure_and_recovery",),
        "investigations": (
            "forward_trace",
            "backward_trace",
            "contradiction_search",
            "source_verification",
        ),
    },
    {
        "keywords": ("状态", "生命周期", "流转", "state", "lifecycle", "transition"),
        "dimensions": ("state_changes",),
        "investigations": (
            "forward_trace",
            "backward_trace",
            "source_verification",
        ),
    },
    {
        "keywords": ("权限", "角色", "租户", "谁能", "permission", "role", "tenant"),
        "dimensions": ("permissions",),
        "investigations": (
            "rule_search",
            "contradiction_search",
            "source_verification",
        ),
    },
)


class ValidationError(Exception):
    """Raised when canonical business knowledge violates a release contract."""


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _is_detached_worktree(repository_root: Path) -> bool:
    repository_check = subprocess.run(
        ["git", "-C", str(repository_root), "rev-parse", "--is-inside-work-tree"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
        text=True,
    )
    if repository_check.returncode != 0:
        return False
    branch_check = subprocess.run(
        ["git", "-C", str(repository_root), "symbolic-ref", "-q", "HEAD"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return branch_check.returncode != 0


def resolve_workspace_root(
    repository_root: Path | str,
    output_root: Path | str | None = None,
    repository_role: str = "primary",
) -> Path:
    repo = Path(repository_root).expanduser().resolve()
    if not repo.is_dir():
        raise ValidationError(f"repository root is not a directory: {repo}")
    if repository_role not in {"primary", "reference", "acceptance"}:
        raise ValidationError(f"unsupported repository role: {repository_role}")

    detached = _is_detached_worktree(repo)
    writable = os.access(repo, os.W_OK)
    external_required = (
        repository_role in {"reference", "acceptance"} or detached or not writable
    )

    if output_root is None:
        if external_required:
            reasons = []
            if repository_role != "primary":
                reasons.append(f"{repository_role} repository")
            if detached:
                reasons.append("detached worktree")
            if not writable:
                reasons.append("read-only repository")
            raise ValidationError(
                "explicit external --workspace is required for " + ", ".join(reasons)
            )
        return repo / "_leo_business"

    raw_output = Path(output_root).expanduser()
    if not raw_output.is_absolute():
        raise ValidationError("explicit workspace must be an absolute path")
    workspace = raw_output.resolve()
    if external_required and _is_within(workspace, repo):
        raise ValidationError(
            "workspace must be outside a reference, acceptance, detached, "
            "or read-only repository"
        )
    return workspace


def changed_paths(change_set: dict[str, Any]) -> set[str]:
    paths: set[str] = set(change_set.get("changed_paths", []))
    for key in ("added", "modified", "deleted"):
        paths.update(str(path) for path in change_set.get(key, []))
    for rename in change_set.get("renamed", []):
        if not isinstance(rename, dict):
            continue
        if rename.get("from"):
            paths.add(str(rename["from"]))
        if rename.get("to"):
            paths.add(str(rename["to"]))
    return paths


def compute_direct_impacts(
    change_set: dict[str, Any],
    evidence_index: dict[str, Any],
) -> set[str]:
    impacted = {
        str(node_id)
        for node_id in change_set.get("forced_node_ids", [])
        if node_id
    }
    for path in changed_paths(change_set):
        records = evidence_index.get(path, [])
        if isinstance(records, (str, dict)):
            records = [records]
        for record in records:
            if isinstance(record, str):
                impacted.add(record)
            elif isinstance(record, dict) and record.get("id"):
                impacted.add(str(record["id"]))
    return impacted


def propagate_impacts(
    node_ids: set[str],
    relationships: list[dict[str, Any]],
) -> set[str]:
    adjacency: dict[str, set[str]] = {}
    for relationship in relationships:
        source = relationship.get("from_id")
        target = relationship.get("to_id")
        relation_type = relationship.get("type")
        if not source or not target:
            continue
        if relation_type in IMPACT_BIDIRECTIONAL_RELATIONSHIPS:
            adjacency.setdefault(str(source), set()).add(str(target))
            adjacency.setdefault(str(target), set()).add(str(source))
        elif relation_type in IMPACT_DEPENDENCY_RELATIONSHIPS:
            adjacency.setdefault(str(target), set()).add(str(source))

    impacted = {str(node_id) for node_id in node_ids}
    pending = list(impacted)
    while pending:
        current = pending.pop()
        for dependent in adjacency.get(current, set()):
            if dependent in impacted:
                continue
            impacted.add(dependent)
            pending.append(dependent)
    return impacted


def _invalidate_claim(record: dict[str, Any], invalidated: bool = False) -> None:
    if "previous_claim_status" not in record and record.get("claim_status"):
        record["previous_claim_status"] = record["claim_status"]
    record["lifecycle_status"] = "invalidated" if invalidated else "stale"
    if record.get("confidence") in CONFIDENCE_LEVELS:
        record["confidence"] = "E0"


def _invalidate_embedded_claims(
    node: dict[str, Any],
    impacted_ids: set[str],
) -> None:
    node_id = str(node.get("id", ""))
    for field, value in node.items():
        address = f"{node_id}#{field}"
        if address not in impacted_ids and node_id not in impacted_ids:
            continue
        if isinstance(value, dict):
            _invalidate_claim(value)
        elif isinstance(value, list):
            for item in value:
                if not isinstance(item, dict):
                    continue
                local_id = item.get("local_id")
                local_address = f"{address}/{local_id}" if local_id else address
                if (
                    node_id in impacted_ids
                    or address in impacted_ids
                    or local_address in impacted_ids
                ):
                    _invalidate_claim(item)


def invalidate_stale_claims(
    revision: dict[str, Any],
    impacted_ids: set[str],
) -> dict[str, Any]:
    updated = copy.deepcopy(revision)
    impacted = {str(node_id) for node_id in impacted_ids}
    deleted_evidence = {
        str(node_id) for node_id in updated.get("deleted_evidence_ids", set())
    }

    for collection_name, records in updated.items():
        if collection_name in {
            "relationships",
            "investigations",
            "provider_observations",
        }:
            continue
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, dict) or not record.get("id"):
                continue
            record_id = str(record["id"])
            if record_id in impacted:
                _invalidate_claim(record, invalidated=record_id in deleted_evidence)
                _invalidate_embedded_claims(record, impacted)

    for relationship in updated.get("relationships", []):
        if not isinstance(relationship, dict):
            continue
        relation_id = str(relationship.get("id", ""))
        source = str(relationship.get("from_id", ""))
        target = str(relationship.get("to_id", ""))
        if target in deleted_evidence or source in deleted_evidence:
            _invalidate_claim(relationship, invalidated=True)
        elif relation_id in impacted:
            _invalidate_claim(relationship)
    return updated


def _query_candidates(question: str, revision: dict[str, Any]) -> list[str]:
    normalized = question.casefold()
    nodes = revision.get("nodes", {})
    if isinstance(nodes, list):
        nodes = {
            item.get("id"): item
            for item in nodes
            if isinstance(item, dict) and item.get("id")
        }
    aliases_by_target: dict[str, list[str]] = {}
    for alias in revision.get("aliases", []):
        if not isinstance(alias, dict):
            continue
        for target_id in alias.get("target_ids", []):
            aliases_by_target.setdefault(str(target_id), []).append(
                str(alias.get("alias", ""))
            )
    candidates: list[str] = []
    for node_id, node in nodes.items():
        if not isinstance(node, dict):
            continue
        searchable = " ".join(
            [
                str(node.get("title", "")),
                str(node.get("summary", "")),
                *aliases_by_target.get(str(node_id), []),
            ]
        ).casefold()
        terms = {
            term
            for term in searchable.replace("/", " ").replace("-", " ").split()
            if len(term) >= 2
        }
        compact = "".join(character for character in searchable if not character.isspace())
        terms.update(
            compact[index : index + 2]
            for index in range(max(0, len(compact) - 1))
            if any("\u4e00" <= character <= "\u9fff" for character in compact[index : index + 2])
        )
        if searchable and (
            searchable in normalized
            or normalized in searchable
            or any(term in normalized for term in terms)
        ):
            candidates.append(str(node_id))
    return sorted(candidates)


def build_query_gap(
    question: str,
    revision: dict[str, Any],
) -> dict[str, Any]:
    normalized = question.casefold()
    candidate_ids = _query_candidates(question, revision)
    missing_dimensions: list[str] = []
    required_investigations: list[str] = []
    for intent in QUERY_INTENTS:
        if not any(keyword.casefold() in normalized for keyword in intent["keywords"]):
            continue
        for dimension in intent["dimensions"]:
            if dimension not in missing_dimensions:
                missing_dimensions.append(dimension)
        for investigation in intent["investigations"]:
            if investigation not in required_investigations:
                required_investigations.append(investigation)

    if not candidate_ids:
        missing_dimensions.insert(0, "subject_resolution")
        for investigation in (
            "vocabulary_expansion",
            "entry_search",
            "source_verification",
        ):
            if investigation not in required_investigations:
                required_investigations.append(investigation)
    elif not required_investigations:
        missing_dimensions.append("current_source_answer")
        required_investigations.extend(
            ["forward_trace", "backward_trace", "source_verification"]
        )

    return {
        "question": question,
        "candidate_node_ids": candidate_ids,
        "missing_dimensions": missing_dimensions,
        "required_investigations": required_investigations,
        "status": "reanalyze_before_answer",
    }


def provider_readiness(
    observations: list[dict[str, Any]],
    canonical_root: str | None = None,
    repository_snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    usable: list[str] = []
    refresh_required: list[str] = []
    ignored: dict[str, list[str]] = {}
    source_verification_required = False

    for observation in observations:
        provider = str(observation.get("provider", "unknown-provider"))
        if not observation.get("available"):
            ignored[provider] = ["unavailable"]
            continue

        reasons: list[str] = []
        observed_root = observation.get("canonical_root")
        if canonical_root and observed_root != canonical_root:
            reasons.append("canonical_root_mismatch")
        if observation.get("status") != "ready":
            reasons.append("provider_not_ready")
        if observation.get("refresh_requested") is not True:
            reasons.append("refresh_not_requested_for_run")
        if observation.get("refresh_result") != "ready":
            reasons.append("refresh_not_ready")

        snapshot = repository_snapshot or {}
        git = snapshot.get("git", {})
        expected_branch = git.get("branch")
        expected_head = git.get("head_sha")
        expected_base = git.get("base_sha")
        if expected_branch and observation.get("indexed_branch") != expected_branch:
            reasons.append("indexed_branch_mismatch")
        if expected_head and observation.get("indexed_head_sha") != expected_head:
            reasons.append("indexed_head_mismatch")
        if expected_base and observation.get("indexed_base_sha") != expected_base:
            reasons.append("indexed_base_mismatch")

        source_verification_required = (
            source_verification_required
            or observation.get("source_verification_required", True)
        )
        if reasons:
            ignored[provider] = reasons
            refresh_required.append(provider)
            continue
        usable.append(provider)

    return {
        "portable_baseline_allowed": True,
        "usable_providers": sorted(set(usable)),
        "refresh_required": sorted(set(refresh_required)),
        "ignored_providers": ignored,
        "source_verification_required": source_verification_required,
        "blocking_errors": [],
    }


def review_is_stale(
    reviewed_snapshot: dict[str, Any],
    current_snapshot: dict[str, Any],
) -> bool:
    if reviewed_snapshot.get("canonical_root") != current_snapshot.get(
        "canonical_root"
    ):
        return True
    reviewed_hash = reviewed_snapshot.get("snapshot_sha256")
    current_hash = current_snapshot.get("snapshot_sha256")
    if reviewed_hash or current_hash:
        return reviewed_hash != current_hash
    return canonical_sha256(reviewed_snapshot) != canonical_sha256(current_snapshot)


def canonical_bytes(value: Any) -> bytes:
    return contract.canonical_json_bytes(value)


def canonical_sha256(value: Any) -> str:
    return contract.canonical_sha256(value)


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


def _text_values(value: Any) -> list[str]:
    if isinstance(value, dict):
        return [
            text
            for nested in value.values()
            for text in _text_values(nested)
        ]
    if isinstance(value, list):
        return [text for nested in value for text in _text_values(nested)]
    if value is None:
        return []
    return [str(value)]


def _normalized_text(value: Any) -> str:
    return " ".join(_text_values(value)).casefold()


def _matches_any(haystack: str, alternatives: list[str]) -> bool:
    return any(str(alternative).casefold() in haystack for alternative in alternatives)


def _load_benchmark_bundle(revision_dir: Path) -> dict[str, Any]:
    nodes_by_file = load_node_records(revision_dir)
    return {
        "manifest": read_json(revision_dir / "manifest.json"),
        "nodes_by_file": nodes_by_file,
        "nodes": [
            node
            for records in nodes_by_file.values()
            for node in records
        ],
        "relationships": read_jsonl(revision_dir / "relationships.jsonl"),
        "evidence": read_jsonl(revision_dir / "evidence.jsonl"),
        "investigations": read_jsonl(revision_dir / "investigations.jsonl"),
        "review": read_json(revision_dir / "semantic-review.json"),
    }


def _require_concept_groups(
    label: str,
    haystack: str,
    groups: list[dict[str, Any]],
) -> None:
    missing = [
        str(group.get("id", "unnamed"))
        for group in groups
        if not _matches_any(haystack, list(group.get("any_of", [])))
    ]
    if missing:
        raise ValidationError(
            f"benchmark missing {label}: {', '.join(missing)}"
        )


def _validate_benchmark_evidence(
    evidence: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
) -> None:
    missing: list[str] = []
    for requirement in requirements:
        path_contains = str(requirement.get("path_contains", "")).casefold()
        symbol_contains = str(requirement.get("symbol_contains", "")).casefold()
        found = any(
            item.get("source_verified") is True
            and path_contains
            in str(item.get("repository_relative_path", "")).casefold()
            and symbol_contains in str(item.get("symbol", "")).casefold()
            for item in evidence
        )
        if not found:
            missing.append(str(requirement.get("id", symbol_contains or path_contains)))
    if missing:
        raise ValidationError(
            "benchmark missing current-source evidence: " + ", ".join(missing)
        )


def _validate_business_framing(
    bundle: dict[str, Any],
    expectation: dict[str, Any],
) -> None:
    use_cases = bundle["nodes_by_file"]["use-cases.jsonl"]
    confirmed = [
        item
        for item in use_cases
        if item.get("claim_status") == "confirmed"
        and item.get("lifecycle_status") == "active"
    ]
    minimum = int(expectation.get("minimum_confirmed_use_cases", 1))
    if len(confirmed) < minimum:
        raise ValidationError(
            f"benchmark requires at least {minimum} confirmed business use cases"
        )

    relationships = bundle["relationships"]
    actor_targets = {
        item.get("to_id")
        for item in relationships
        if item.get("type") == "participates_in"
    }
    actor_sources = {
        item.get("from_id")
        for item in relationships
        if item.get("type") == "participates_in"
    }
    for use_case in confirmed:
        use_case_id = use_case.get("id")
        goal = use_case.get("goal", {})
        outcomes = use_case.get("success_outcomes", [])
        if not isinstance(goal, dict) or not goal.get("statement"):
            raise ValidationError(
                f"benchmark use case {use_case_id} lacks a business goal"
            )
        if not isinstance(outcomes, list) or not outcomes:
            raise ValidationError(
                f"benchmark use case {use_case_id} lacks a business outcome"
            )
        if use_case_id not in actor_targets and use_case_id not in actor_sources:
            raise ValidationError(
                f"benchmark use case {use_case_id} lacks an actor"
            )


def _validate_family_members(
    nodes: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
) -> None:
    allowed_statuses = {"confirmed", "inferred", "unknown"}
    searchable = [
        node
        for node in nodes
        if node.get("claim_status") in allowed_statuses
        and node.get("lifecycle_status") in {"active", "conditional"}
    ]
    missing: list[str] = []
    for requirement in requirements:
        alternatives = list(requirement.get("any_of", []))
        if not any(
            _matches_any(_normalized_text(node), alternatives)
            for node in searchable
        ):
            missing.append(str(requirement.get("id", "unnamed")))
    if missing:
        raise ValidationError(
            "benchmark missing use-case-family members: " + ", ".join(missing)
        )


def _validate_prohibited_claims(
    nodes_by_file: dict[str, list[dict[str, Any]]],
    prohibited: dict[str, Any],
    scenario: str,
) -> None:
    confirmed_nodes = [
        node
        for filename, records in nodes_by_file.items()
        if filename != "unknowns.jsonl"
        for node in records
        if node.get("claim_status") == "confirmed"
        and node.get("lifecycle_status") == "active"
    ]
    confirmed_text = _normalized_text(confirmed_nodes)
    violations: list[str] = []
    for group in prohibited.get(scenario, []):
        if _matches_any(confirmed_text, list(group.get("any_of", []))):
            violations.append(str(group.get("id", "unnamed")))
    if violations:
        raise ValidationError(
            "benchmark contains prohibited confirmed claims: "
            + ", ".join(violations)
        )


def validate_benchmark_review(
    review: dict[str, Any],
    semantic_rubric: dict[str, Any],
) -> None:
    minimum_total = int(semantic_rubric.get("minimum_total_score", 13))
    required_minimums = semantic_rubric.get("required_score_minimums", {})
    if review.get("total_score", 0) < minimum_total:
        raise ValidationError(
            f"benchmark semantic review total below {minimum_total}"
        )
    for dimension, minimum in required_minimums.items():
        if review.get("scores", {}).get(dimension, 0) < minimum:
            raise ValidationError(
                f"benchmark semantic review {dimension} below {minimum}"
            )
    if semantic_rubric.get("reviewer_mode") and review.get(
        "reviewer_mode"
    ) != semantic_rubric["reviewer_mode"]:
        raise ValidationError(
            "benchmark requires semantic reviewer mode "
            + str(semantic_rubric["reviewer_mode"])
        )


def benchmark_revision(
    revision_dir: Path | str,
    expectations_dir: Path | str,
    scenario: str,
) -> dict[str, Any]:
    root = Path(revision_dir)
    expected_root = Path(expectations_dir)
    expectation_path = expected_root / f"utopia-{scenario}.json"
    if not expectation_path.is_file():
        raise ValidationError(f"unknown benchmark scenario: {scenario}")

    validation = validate_revision(root)
    bundle = _load_benchmark_bundle(root)
    expectation = read_json(expectation_path)
    semantic_rubric = read_json(expected_root / "semantic-rubric.json")
    prohibited = read_json(expected_root / "prohibited-claims.json")

    business_nodes = [
        node
        for filename, records in bundle["nodes_by_file"].items()
        if filename != "unknowns.jsonl"
        for node in records
        if node.get("claim_status") in {"confirmed", "inferred"}
        and node.get("lifecycle_status") in {"active", "conditional"}
    ]
    business_text = _normalized_text(business_nodes)
    unknown_text = _normalized_text(
        bundle["nodes_by_file"]["unknowns.jsonl"]
    )
    _validate_business_framing(bundle, expectation)
    _require_concept_groups(
        "business concepts",
        business_text,
        expectation.get("required_business_concepts", []),
    )
    _require_concept_groups(
        "searched unknowns",
        unknown_text,
        expectation.get("required_unknowns", []),
    )
    _validate_benchmark_evidence(
        bundle["evidence"],
        expectation.get("required_evidence", []),
    )
    _validate_family_members(
        [
            *bundle["nodes_by_file"]["use-cases.jsonl"],
            *bundle["nodes_by_file"]["use-case-families.json"],
        ],
        expectation.get("required_family_members", []),
    )
    _validate_prohibited_claims(
        bundle["nodes_by_file"],
        prohibited,
        scenario,
    )

    review = bundle["review"]
    validate_benchmark_review(review, semantic_rubric)

    return {
        "status": "passed",
        "scenario": scenario,
        "canonical_revision_sha256": validation[
            "canonical_revision_sha256"
        ],
        "confirmed_use_cases": len(
            [
                node
                for node in bundle["nodes_by_file"]["use-cases.jsonl"]
                if node.get("claim_status") == "confirmed"
            ]
        ),
        "evidence_count": len(bundle["evidence"]),
        "semantic_review_total": review["total_score"],
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
    required_projections = [
        staging / "ai-context.md",
        staging / "site" / "index.html",
    ]
    missing_projections = [
        path.relative_to(staging).as_posix()
        for path in required_projections
        if not path.is_file()
    ]
    if missing_projections:
        raise ValidationError(
            "publication requires generated projections: "
            + ", ".join(missing_projections)
        )
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
    publish.add_argument("--repo")
    publish.add_argument("--workspace")
    publish.add_argument(
        "--repository-role",
        default="primary",
        choices=["primary", "reference", "acceptance"],
    )
    audit = subparsers.add_parser("audit")
    audit.add_argument("--revision", required=True)
    benchmark = subparsers.add_parser("benchmark")
    benchmark.add_argument("--revision", required=True)
    benchmark.add_argument("--expectations", required=True)
    benchmark.add_argument(
        "--scenario",
        required=True,
        choices=["work-order", "video-binding"],
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command in {"validate-model", "audit"}:
            result = validate_revision(args.revision)
        elif args.command == "benchmark":
            result = benchmark_revision(
                args.revision,
                args.expectations,
                args.scenario,
            )
        else:
            if args.repo:
                workspace = resolve_workspace_root(
                    args.repo,
                    args.workspace,
                    args.repository_role,
                )
            elif args.workspace:
                raw_workspace = Path(args.workspace).expanduser()
                if not raw_workspace.is_absolute():
                    raise ValidationError("explicit workspace must be an absolute path")
                workspace = raw_workspace.resolve()
            else:
                raise ValidationError("publish requires --repo or --workspace")
            result = publish_revision(args.run_dir, workspace)
    except ValidationError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
