#!/usr/bin/env python3
"""Validate, hash, publish, and benchmark canonical business knowledge revisions."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
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
FLOW_REASON_CODE_SHAPED = "code_shaped_expression"
FLOW_REASON_INFRASTRUCTURE = "infrastructure_sequence"
FLOW_REASON_FIELD_INVENTORY = "field_write_inventory"
FLOW_REASON_INTERNAL_CONSTANT = "internal_constant_without_business_meaning"
FLOW_REASON_MISSING_EVENT = "missing_actor_or_business_event"
FLOW_REASON_MISSING_EFFECT = "missing_business_effect"

_FLOW_CODE_SHAPED_PATTERNS = (
    re.compile(r"\b[a-z]+[A-Z][A-Za-z0-9]*\b"),
    re.compile(r"\b[a-z][a-z0-9]*_[a-z0-9_]+\b", re.IGNORECASE),
    re.compile(r"(?:==|!=|>=|<=|->|::)"),
    re.compile(r"\b[A-Za-z][A-Za-z0-9]*\s*\+\s*[A-Za-z][A-Za-z0-9]*\b"),
    re.compile(r"(?:GET|POST|PUT|PATCH|DELETE)\s+/[A-Za-z0-9_./{}:-]+", re.IGNORECASE),
    re.compile(r"\b[A-Za-z_][A-Za-z0-9_]*\([^)]*\)"),
)
_FLOW_INFRASTRUCTURE_PATTERN = re.compile(
    r"(?:数据库|Elasticsearch|\bES\b|Redis|Kafka|MyBatis|Feign|"
    r"\bdatabase\b|\bindex(?:ing)?\b|\bcache\b|\bqueue\b|\bHTTP\b)",
    re.IGNORECASE,
)
_FLOW_INFRASTRUCTURE_ACTION_PATTERN = re.compile(
    r"(?:写入|更新|同步|推送|调用|入队|出队|持久化|"
    r"\bwrite\b|\bupdate\b|\bsync\b|\bpush\b|\bcall\b|"
    r"\benqueue\b|\bdequeue\b|\bpersist\b)",
    re.IGNORECASE,
)
_FLOW_FIELD_WRITE_PATTERN = re.compile(
    r"^(?:写入|更新|记录|保存|组装|set\b|write\b|update\b|save\b)",
    re.IGNORECASE,
)
_FLOW_INTERNAL_CONSTANT_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])(?:[A-Z][A-Z0-9_]{2,}|[0-9]+D)(?![A-Za-z0-9])"
)
_FLOW_CONTEXT_PRECEDENCE_PATTERN = re.compile(
    r"(?=.*(?:tenant|租户))(?=.*(?:context|上下文))"
    r"(?=.*(?:覆盖|继承|override|inherit))",
    re.IGNORECASE,
)
_FLOW_BUSINESS_ACTION_PATTERN = re.compile(
    r"(?:选择|提交|审核|批准|关联|解绑|替换|检查|验收|查询|查看|使用|"
    r"重试|修复|创建|发布|取消|确认|分配|归档|处理|拒绝|拍摄|"
    r"\bselect\b|\bsubmit\b|\bapprove\b|\bassociate\b|\binspect\b|"
    r"\bview\b|\buse\b|\bretry\b|\brepair\b|\bcreate\b|\bpublish\b)",
    re.IGNORECASE,
)
_FLOW_BUSINESS_OBJECT_PATTERN = re.compile(
    r"(?:视频|工程|验收节点|工单|任务|订单|资料|组织|项目|申请|审批|客户|"
    r"现场|拍摄|证据|人员|员工|服务|结果|"
    r"\bvideo\b|\bproject\b|\border\b|\btask\b|\bclaim\b|\bapproval\b|"
    r"\bcustomer\b|\bevidence\b|\bresult\b)",
    re.IGNORECASE,
)
_FLOW_BUSINESS_EFFECT_PATTERN = re.compile(
    r"(?:可以|可供|能够|成为|归属|生效|完成|成功|失败|被拒绝|可查询|"
    r"可搜索|可使用|进入.{0,12}流程|得到|获得|避免|确保|恢复|可见|找到|"
    r"\bcan\b|\bavailable\b|\bvisible\b|\bbelongs?\b|\bcompleted?\b|"
    r"\bsucceeds?\b|\bfails?\b|\brejected?\b|\bsearchable\b|\busable\b)",
    re.IGNORECASE,
)


class ValidationError(Exception):
    """Raised when canonical business knowledge violates a release contract."""


def analyze_flow_statement(statement: str) -> dict[str, Any]:
    text = str(statement or "").strip()
    reason_codes: list[str] = []

    if any(pattern.search(text) for pattern in _FLOW_CODE_SHAPED_PATTERNS):
        reason_codes.append(FLOW_REASON_CODE_SHAPED)
    if _FLOW_CONTEXT_PRECEDENCE_PATTERN.search(text):
        reason_codes.append(FLOW_REASON_CODE_SHAPED)
    if (
        _FLOW_INFRASTRUCTURE_PATTERN.search(text)
        and _FLOW_INFRASTRUCTURE_ACTION_PATTERN.search(text)
    ):
        reason_codes.append(FLOW_REASON_INFRASTRUCTURE)

    delimiter_count = sum(text.count(delimiter) for delimiter in ("、", ",", "，"))
    if _FLOW_FIELD_WRITE_PATTERN.search(text) and delimiter_count >= 3:
        reason_codes.append(FLOW_REASON_FIELD_INVENTORY)
    if _FLOW_INTERNAL_CONSTANT_PATTERN.search(text):
        reason_codes.append(FLOW_REASON_INTERNAL_CONSTANT)

    has_business_event = bool(
        _FLOW_BUSINESS_ACTION_PATTERN.search(text)
        and _FLOW_BUSINESS_OBJECT_PATTERN.search(text)
    )
    has_business_effect = bool(_FLOW_BUSINESS_EFFECT_PATTERN.search(text))
    if reason_codes and not has_business_event:
        reason_codes.append(FLOW_REASON_MISSING_EVENT)
    if reason_codes and not has_business_effect:
        reason_codes.append(FLOW_REASON_MISSING_EFFECT)

    strong_reasons = {
        FLOW_REASON_CODE_SHAPED,
        FLOW_REASON_INFRASTRUCTURE,
        FLOW_REASON_FIELD_INVENTORY,
        FLOW_REASON_INTERNAL_CONSTANT,
    }
    missing_anchor = (
        FLOW_REASON_MISSING_EVENT in reason_codes
        or FLOW_REASON_MISSING_EFFECT in reason_codes
    )
    severity = (
        "high"
        if strong_reasons.intersection(reason_codes) and missing_anchor
        else None
    )
    return {
        "reason_codes": reason_codes,
        "has_business_event": has_business_event,
        "has_business_effect": has_business_effect,
        "severity": severity,
    }


def validate_business_flow_quality(
    use_case: dict[str, Any],
) -> list[dict[str, Any]]:
    if use_case.get("claim_status") != "confirmed":
        return []

    use_case_id = str(use_case.get("id", ""))
    diagnostics: list[dict[str, Any]] = []
    for index, step in enumerate(use_case.get("main_flow", []), 1):
        if not isinstance(step, dict):
            continue
        statement = str(step.get("statement", ""))
        analysis = analyze_flow_statement(statement)
        if analysis["severity"] != "high":
            continue
        local_id = str(step.get("local_id") or f"step-{index}")
        diagnostics.append(
            {
                "use_case_id": use_case_id,
                "flow_step_address": f"{use_case_id}#main_flow/{local_id}",
                "severity": "high",
                "reason_codes": sorted(analysis["reason_codes"]),
                "statement": statement,
            }
        )
    return diagnostics


def validate_business_flows(
    use_cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    return sorted(
        (
            diagnostic
            for use_case in use_cases
            for diagnostic in validate_business_flow_quality(use_case)
        ),
        key=lambda item: (
            item["use_case_id"],
            item["flow_step_address"],
            item["reason_codes"],
        ),
    )


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
        return repo / ".leo_business"

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
    *,
    require_verified_hash: bool = False,
    repository_snapshot: dict[str, Any] | None = None,
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
        if (
            require_verified_hash
            and record.get("source_verified") is True
            and not str(record.get("content_sha256", "")).strip()
        ):
            raise ValidationError(
                f"evidence {record['id']} source_verified requires content_sha256"
            )
        if require_verified_hash and record.get("source_verified") is True:
            _validate_evidence_against_snapshot(record, repository_snapshot or {})
        ids.add(record["id"])
        by_id[record["id"]] = record
    return ids, by_id


def _validate_evidence_against_snapshot(
    record: dict[str, Any],
    repository_snapshot: dict[str, Any],
) -> None:
    relative = str(record.get("repository_relative_path", "")).replace("\\", "/")
    relative_path = Path(relative)
    if not relative or relative_path.is_absolute() or ".." in relative_path.parts:
        raise ValidationError(
            f"evidence {record['id']} has invalid repository-relative path"
        )
    files = repository_snapshot.get("files")
    if not isinstance(files, dict):
        return
    metadata = files.get(relative)
    if not isinstance(metadata, dict):
        raise ValidationError(
            f"evidence {record['id']} path is not present in frozen snapshot: {relative}"
        )
    if record.get("source_kind") != "current_source":
        return
    evidence_hash = str(record.get("content_sha256", "")).strip()
    frozen_file_hash = str(metadata.get("sha256", "")).strip()
    if evidence_hash == frozen_file_hash:
        return

    canonical_root = repository_snapshot.get("canonical_root")
    source_path = Path(str(canonical_root)) / relative if canonical_root else None
    if source_path is not None and source_path.is_file():
        payload = source_path.read_bytes()
        if hashlib.sha256(payload).hexdigest() == frozen_file_hash:
            start_line = max(1, int(record.get("start_line") or 1))
            end_line = max(start_line, int(record.get("end_line") or start_line))
            lines = payload.splitlines(keepends=True)
            selected = b"".join(lines[start_line - 1 : end_line])
            if hashlib.sha256(selected).hexdigest() == evidence_hash:
                return
    raise ValidationError(
        f"evidence {record['id']} content hash does not match frozen snapshot"
    )


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


def semantic_change_impact_payload(change_impact: dict[str, Any]) -> dict[str, Any]:
    if change_impact.get("schema_version") in {
        contract.V2_SCHEMA_VERSION,
        contract.V3_SCHEMA_VERSION,
        contract.V31_SCHEMA_VERSION,
        contract.V32_SCHEMA_VERSION,
    }:
        payload = change_impact.get("semantic_inputs")
        if not isinstance(payload, dict):
            raise ValidationError("v2 change-impact semantic_inputs must be an object")
        return payload
    return change_impact


def canonical_revision_sha256_v2(revision_dir: Path) -> str:
    payload: dict[str, Any] = {}
    for name, kind in contract.V2_CANONICAL_FILE_KINDS.items():
        path = revision_dir / name
        if not path.is_file():
            raise ValidationError(f"v2 semantic artifact is missing: {name}")
        if kind == "jsonl":
            payload[name] = read_jsonl(path)
        elif kind == "semantic_json":
            payload[name] = semantic_change_impact_payload(read_json(path))
        else:
            payload[name] = read_json(path)
    return contract.canonical_sha256(payload, sort_records=True)


def canonical_revision_sha256_v3(revision_dir: Path) -> str:
    payload: dict[str, Any] = {}
    for name, kind in contract.V3_CANONICAL_FILE_KINDS.items():
        path = revision_dir / name
        if not path.is_file():
            raise ValidationError(f"v3 semantic artifact is missing: {name}")
        if kind == "jsonl":
            payload[name] = read_jsonl(path)
        elif kind == "semantic_json":
            payload[name] = semantic_change_impact_payload(read_json(path))
        else:
            payload[name] = read_json(path)
    return contract.canonical_sha256(payload, sort_records=True)


def canonical_revision_sha256_v31(revision_dir: Path) -> str:
    payload: dict[str, Any] = {}
    for name, kind in contract.V31_CANONICAL_FILE_KINDS.items():
        path = revision_dir / name
        if not path.is_file():
            raise ValidationError(f"v3.1 semantic artifact is missing: {name}")
        if kind == "jsonl":
            payload[name] = read_jsonl(path)
        elif kind == "semantic_json":
            payload[name] = semantic_change_impact_payload(read_json(path))
        else:
            payload[name] = read_json(path)
    return contract.canonical_sha256(payload, sort_records=True)


def canonical_revision_sha256_v32(revision_dir: Path) -> str:
    payload: dict[str, Any] = {}
    for name, kind in contract.V32_CANONICAL_FILE_KINDS.items():
        path = revision_dir / name
        if not path.is_file():
            raise ValidationError(f"v3.2 semantic artifact is missing: {name}")
        if kind == "jsonl":
            payload[name] = read_jsonl(path)
        elif kind == "semantic_json":
            payload[name] = semantic_change_impact_payload(read_json(path))
        else:
            payload[name] = read_json(path)
    return contract.canonical_sha256(payload, sort_records=True)


def revision_canonical_sha256(revision_dir: Path | str) -> str:
    root = Path(revision_dir)
    manifest = read_json(root / "manifest.json")
    if manifest.get("schema_version") == contract.V32_SCHEMA_VERSION:
        return canonical_revision_sha256_v32(root)
    if manifest.get("schema_version") == contract.V31_SCHEMA_VERSION:
        return canonical_revision_sha256_v31(root)
    if manifest.get("schema_version") == contract.V3_SCHEMA_VERSION:
        return canonical_revision_sha256_v3(root)
    if manifest.get("schema_version") == contract.V2_SCHEMA_VERSION:
        return canonical_revision_sha256_v2(root)
    return canonical_revision_sha256(root)


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


def _metric(
    numerator: int,
    denominator: int,
    unresolved_ids: Iterable[str] = (),
    excluded_ids: Iterable[str] = (),
) -> dict[str, Any]:
    return {
        "numerator": numerator,
        "denominator": denominator,
        "ratio": numerator / denominator if denominator else 1.0,
        "unresolved_ids": sorted(set(unresolved_ids)),
        "excluded_ids": sorted(set(excluded_ids)),
    }


def validate_discovery_observations(
    records: list[dict[str, Any]],
    inventory_by_id: dict[str, dict[str, Any]],
    snapshot_id: str,
) -> dict[str, Any]:
    observed_ids: set[str] = set()
    observation_ids: set[str] = set()
    partial: list[str] = []
    for observation in records:
        observation_id = observation.get("id")
        if not observation_id or observation_id in observation_ids:
            raise ValidationError(f"duplicate or missing discovery observation: {observation_id}")
        observation_ids.add(observation_id)
        if observation.get("snapshot_id") != snapshot_id:
            raise ValidationError(f"discovery observation {observation_id} snapshot mismatch")
        discovered = observation.get("discovered_signal_ids", [])
        if not isinstance(discovered, list):
            raise ValidationError(f"discovery observation {observation_id} signals must be a list")
        for signal_id in discovered:
            if signal_id not in inventory_by_id:
                raise ValidationError(f"discovery observation names unknown signal {signal_id}")
            if signal_id in observed_ids:
                raise ValidationError(f"signal {signal_id} is discovered more than once")
            observed_ids.add(signal_id)
        if observation.get("truncated") or observation.get("status") != "completed":
            partial.append(observation_id)
    for inventory_id, signal in inventory_by_id.items():
        if inventory_id not in observed_ids:
            raise ValidationError(f"inventory signal lacks observation: {inventory_id}")
        for observation_id in signal.get("discovered_by", []):
            if observation_id not in observation_ids:
                raise ValidationError(f"inventory {inventory_id} names unknown observation {observation_id}")
    return {
        "observation_count": len(records),
        "discovered_signal_ids": sorted(observed_ids),
        "partial_observation_ids": sorted(partial),
    }


def validate_candidates(
    records: list[dict[str, Any]],
    inventory_by_id: dict[str, dict[str, Any]],
    node_ids: set[str],
    investigations: dict[str, set[str]],
) -> dict[str, Any]:
    candidate_ids = {item.get("id") for item in records}
    accounted_signals: set[str] = set()
    unresolved: list[str] = []
    for candidate in records:
        candidate_id = candidate.get("id")
        required = {
            "id", "seed_signal_id", "semantic_key", "title",
            "candidate_basis_signal_ids", "candidate_status",
            "structural_importance", "business_priority", "resolution_reason",
            "investigation_ids", "snapshot_id",
        }
        missing = sorted(required - set(candidate))
        if missing:
            raise ValidationError(f"candidate {candidate_id} missing fields: {', '.join(missing)}")
        status = candidate["candidate_status"]
        if status not in {"confirmed", "variant", "supporting_behavior", "duplicate", "excluded", "unresolved"}:
            raise ValidationError(f"candidate {candidate_id} invalid status {status}")
        basis = candidate["candidate_basis_signal_ids"]
        if not isinstance(basis, list):
            raise ValidationError(f"candidate {candidate_id} requires basis signals")
        if not basis:
            raise ValidationError(
                f"candidate {candidate_id} has no remaining basis signals"
            )
        for signal_id in basis:
            if signal_id not in inventory_by_id:
                raise ValidationError(f"candidate {candidate_id} names unknown signal {signal_id}")
            accounted_signals.add(signal_id)
        target = None
        if status == "confirmed":
            target = candidate.get("resolved_use_case_id")
            if not target or target not in node_ids:
                raise ValidationError(f"candidate {candidate_id} has invalid confirmed target")
        elif status == "variant":
            target = candidate.get("resolved_family_id")
            if not target or target not in node_ids:
                raise ValidationError(f"candidate {candidate_id} has invalid variant family")
            if not candidate.get("resolved_use_case_id") and not candidate.get("variant_of_candidate_id"):
                raise ValidationError(f"candidate {candidate_id} requires variant target")
        elif status == "supporting_behavior":
            supports = candidate.get("supports_candidate_id")
            if supports and supports not in candidate_ids:
                raise ValidationError(f"candidate {candidate_id} supports unknown candidate {supports}")
            target = candidate.get("resolved_use_case_id") or supports
            if not target or (candidate.get("resolved_use_case_id") and target not in node_ids):
                raise ValidationError(f"candidate {candidate_id} requires supporting target")
        elif status == "duplicate":
            target = candidate.get("duplicate_of_candidate_id")
            if not target or target not in candidate_ids or target == candidate_id:
                raise ValidationError(f"candidate {candidate_id} has invalid duplicate target")
        elif status == "excluded":
            if not candidate.get("resolution_reason"):
                raise ValidationError(f"candidate {candidate_id} excluded without reason")
        elif status == "unresolved":
            if not candidate.get("investigation_ids"):
                raise ValidationError(f"candidate {candidate_id} unresolved without investigation")
            if candidate.get("structural_importance") in {"critical", "high"}:
                unresolved.append(candidate_id)
    for signal_id, signal in inventory_by_id.items():
        if signal_id in accounted_signals:
            continue
        if not signal.get("non_candidate_status"):
            raise ValidationError(f"unaccounted inventory signal {signal_id}")
        if not signal.get("non_candidate_reason"):
            raise ValidationError(f"non-candidate signal {signal_id} lacks reason")
        if not signal.get("non_candidate_evidence_ids"):
            raise ValidationError(f"non-candidate signal {signal_id} lacks evidence")
    return {
        "count": len(records),
        "accounted_signal_ids": sorted(accounted_signals),
        "unresolved_ids": sorted(set(unresolved)),
        "excluded_ids": sorted(
            item["id"] for item in records if item.get("candidate_status") == "excluded"
        ),
    }


def _require_nonempty_fields(
    record: dict[str, Any],
    fields: Iterable[str],
    label: str,
) -> None:
    require_fields(record, fields, label)
    empty = [field for field in fields if record.get(field) in (None, "", [])]
    if empty:
        raise ValidationError(f"{label} requires non-empty fields: {', '.join(empty)}")


def validate_v3_candidates(candidates: list[dict[str, Any]]) -> None:
    for candidate in candidates:
        if (
            candidate.get("structural_importance") in {"critical", "high"}
            and candidate.get("candidate_status") in {"supporting_behavior", "excluded"}
        ):
            comparison = candidate.get("semantic_comparison")
            required = {
                "compared_goal",
                "compared_trigger",
                "compared_outcome",
                "conclusion",
                "evidence_ids",
            }
            if not isinstance(comparison, dict) or not required.issubset(comparison):
                raise ValidationError(
                    f"candidate {candidate.get('id')} requires semantic comparison"
                )
            if not comparison.get("evidence_ids"):
                raise ValidationError(
                    f"candidate {candidate.get('id')} semantic comparison requires evidence"
                )


def validate_module_dossiers(
    records: list[dict[str, Any]],
    inventory_by_id: dict[str, dict[str, Any]],
    evidence_ids: set[str],
    snapshot_id: str,
) -> dict[str, Any]:
    required = [
        "id", "title", "business_purpose", "module_paths", "entry_signal_ids",
        "job_signal_ids", "consumer_signal_ids", "data_store_signal_ids",
        "configuration_signal_ids", "external_integration_signal_ids", "key_entities",
        "control_flow_summary", "business_rules", "state_fields", "calculations",
        "failure_paths", "repair_paths", "evidence_ids", "coverage_status",
        "unknown_ids", "snapshot_id",
    ]
    ids: set[str] = set()
    unresolved: list[str] = []
    covered_signals: set[str] = set()
    for record in records:
        _require_nonempty_fields(
            record,
            ["id", "title", "business_purpose", "module_paths", "control_flow_summary", "evidence_ids"],
            "module dossier",
        )
        require_fields(record, required, "module dossier")
        if record["id"] in ids:
            raise ValidationError(f"duplicate module dossier {record['id']}")
        ids.add(record["id"])
        if record["snapshot_id"] != snapshot_id:
            raise ValidationError(f"module dossier {record['id']} snapshot mismatch")
        for field in (
            "entry_signal_ids", "job_signal_ids", "consumer_signal_ids",
            "data_store_signal_ids", "configuration_signal_ids",
            "external_integration_signal_ids",
        ):
            for signal_id in record[field]:
                if signal_id not in inventory_by_id:
                    raise ValidationError(
                        f"module dossier {record['id']} names unknown signal {signal_id}"
                    )
                covered_signals.add(signal_id)
        for evidence_id in record["evidence_ids"]:
            if evidence_id not in evidence_ids:
                raise ValidationError(
                    f"module dossier {record['id']} names unknown evidence {evidence_id}"
                )
        if record["coverage_status"] != "complete":
            unresolved.append(record["id"])
    important = {
        signal_id
        for signal_id, signal in inventory_by_id.items()
        if signal.get("structural_importance") in {"critical", "high"}
        and signal.get("classification") != "technical_support"
    }
    missing = sorted(important - covered_signals)
    unresolved.extend(missing)
    return {
        "ids": ids,
        "metric": _metric(len(important - set(missing)), len(important), unresolved),
    }


def validate_end_to_end_flows(
    records: list[dict[str, Any]],
    module_ids: set[str],
    use_case_ids: set[str],
    evidence_ids: set[str],
    snapshot_id: str,
) -> dict[str, Any]:
    required = [
        "id", "title", "business_goal", "actor_ids", "trigger_ids", "stages",
        "terminal_outcomes", "failure_outcomes", "repair_paths", "module_dossier_ids",
        "use_case_ids", "rule_ids", "state_machine_ids", "calculation_model_ids",
        "evidence_ids", "coverage_status", "unknown_ids", "snapshot_id",
    ]
    stage_required = [
        "stage_id", "input", "preconditions", "business_decisions", "processing",
        "data_changes", "state_changes", "external_effects", "success_output",
        "rejections", "failures", "recovery", "idempotency_or_concurrency",
        "observability", "evidence_ids",
    ]
    ids: set[str] = set()
    unresolved: list[str] = []
    covered_use_cases: set[str] = set()
    for record in records:
        require_fields(record, required, "end-to-end flow")
        _require_nonempty_fields(
            record,
            ["id", "title", "business_goal", "stages", "terminal_outcomes", "module_dossier_ids", "use_case_ids", "evidence_ids"],
            "end-to-end flow",
        )
        if record["id"] in ids:
            raise ValidationError(f"duplicate end-to-end flow {record['id']}")
        ids.add(record["id"])
        if record["snapshot_id"] != snapshot_id:
            raise ValidationError(f"end-to-end flow {record['id']} snapshot mismatch")
        for module_id in record["module_dossier_ids"]:
            if module_id not in module_ids:
                raise ValidationError(f"end-to-end flow names unknown module {module_id}")
        for use_case_id in record["use_case_ids"]:
            if use_case_id not in use_case_ids:
                raise ValidationError(f"end-to-end flow names unknown use case {use_case_id}")
            covered_use_cases.add(use_case_id)
        for evidence_id in record["evidence_ids"]:
            if evidence_id not in evidence_ids:
                raise ValidationError(f"end-to-end flow names unknown evidence {evidence_id}")
        for stage in record["stages"]:
            require_fields(stage, stage_required, f"flow stage {record['id']}")
            if any(stage.get(field) in (None, "") for field in stage_required):
                empty = [field for field in stage_required if stage.get(field) in (None, "")]
                raise ValidationError(
                    f"flow stage {record['id']} requires non-empty {', '.join(empty)}"
                )
            if not stage.get("evidence_ids"):
                raise ValidationError(f"flow stage {record['id']} requires evidence_ids")
        if record["coverage_status"] != "complete":
            unresolved.append(record["id"])
    missing = sorted(use_case_ids - covered_use_cases)
    unresolved.extend(missing)
    return {
        "ids": ids,
        "calculation_model_ids": {
            value for record in records for value in record["calculation_model_ids"]
        },
        "metric": _metric(len(use_case_ids - set(missing)), len(use_case_ids), unresolved),
    }


def validate_scenario_narratives(
    use_cases: list[dict[str, Any]],
    evidence_ids: set[str],
    history_event_ids: set[str],
    unknown_ids: set[str],
    required_use_case_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Validate independently readable narratives for important confirmed use cases."""
    required = [
        "business_context", "starting_state", "stages", "branch_matrix",
        "failure_recovery_matrix", "variants", "worked_examples",
        "history_event_ids", "open_question_ids",
    ]
    stage_required = ["stage_id", "title", "business_purpose", "steps"]
    step_required = [
        "step_id", "actor_or_event", "business_action", "business_result",
        "inputs", "decision_basis", "data_changes", "state_changes",
        "external_effects", "evidence_ids",
    ]
    matrix_requirements = {
        "branch_matrix": [
            "condition", "decision_basis", "route", "business_result", "evidence_ids",
        ],
        "failure_recovery_matrix": [
            "failure_point", "business_impact", "stopped_state", "automatic_recovery",
            "manual_repair", "degradation", "evidence_ids",
        ],
        "variants": ["name", "difference", "evidence_ids"],
        "worked_examples": ["title", "given", "when", "then", "evidence_ids"],
    }
    unresolved: list[str] = []
    complete = 0
    confirmed = [
        item for item in use_cases
        if item.get("claim_status") == "confirmed"
        and item.get("lifecycle_status") in {"active", "conditional"}
        and (
            required_use_case_ids is None
            or item.get("id") in required_use_case_ids
        )
    ]
    for use_case in confirmed:
        use_case_id = str(use_case.get("id", ""))
        narrative = use_case.get("scenario_narrative")
        if not isinstance(narrative, dict):
            unresolved.append(f"{use_case_id}#scenario_narrative")
            continue
        require_fields(narrative, required, f"scenario narrative {use_case_id}")
        for field in ("business_context", "starting_state", "stages"):
            if narrative.get(field) in (None, "", []):
                raise ValidationError(
                    f"scenario narrative {use_case_id} requires non-empty {field}"
                )
        for field in ("branch_matrix", "failure_recovery_matrix", "worked_examples"):
            if not narrative.get(field):
                raise ValidationError(
                    f"scenario narrative {use_case_id} requires non-empty {field}"
                )
        step_count = 0
        effect_annotation_count = 0
        seen_stage_ids: set[str] = set()
        for stage in narrative["stages"]:
            require_fields(stage, stage_required, f"scenario stage {use_case_id}")
            if any(stage.get(field) in (None, "", []) for field in stage_required):
                raise ValidationError(
                    f"scenario stage {use_case_id} requires complete stage fields"
                )
            if stage["stage_id"] in seen_stage_ids:
                raise ValidationError(
                    f"scenario narrative {use_case_id} has duplicate stage {stage['stage_id']}"
                )
            seen_stage_ids.add(stage["stage_id"])
            for step in stage["steps"]:
                require_fields(step, step_required, f"scenario step {use_case_id}")
                if any(step.get(field) in (None, "") for field in step_required):
                    raise ValidationError(
                        f"scenario step {use_case_id} requires complete step fields"
                    )
                if not step.get("evidence_ids"):
                    raise ValidationError(
                        f"scenario step {use_case_id} requires evidence_ids"
                    )
                for evidence_id in step["evidence_ids"]:
                    if evidence_id not in evidence_ids:
                        raise ValidationError(
                            f"scenario step {use_case_id} names unknown evidence {evidence_id}"
                        )
                if any(
                    step.get(field)
                    for field in ("data_changes", "state_changes", "external_effects")
                ):
                    effect_annotation_count += 1
                step_count += 1
        if step_count < 3:
            raise ValidationError(
                f"scenario narrative {use_case_id} requires at least 3 atomic steps"
            )
        if effect_annotation_count == 0:
            raise ValidationError(
                f"scenario narrative {use_case_id} requires state, data, or external effect annotations"
            )
        for field, item_required in matrix_requirements.items():
            for item in narrative.get(field, []):
                if not isinstance(item, dict):
                    raise ValidationError(
                        f"scenario narrative {use_case_id} {field} requires object items"
                    )
                require_fields(
                    item,
                    item_required,
                    f"scenario narrative {use_case_id} {field}",
                )
                if any(item.get(name) in (None, "", []) for name in item_required):
                    raise ValidationError(
                        f"scenario narrative {use_case_id} {field} requires complete item fields"
                    )
                for evidence_id in item["evidence_ids"]:
                    if evidence_id not in evidence_ids:
                        raise ValidationError(
                            f"scenario narrative {use_case_id} names unknown evidence {evidence_id}"
                        )
        for event_id in narrative["history_event_ids"]:
            if event_id not in history_event_ids:
                raise ValidationError(
                    f"scenario narrative {use_case_id} names unknown history event {event_id}"
                )
        for unknown_id in narrative["open_question_ids"]:
            if unknown_id not in unknown_ids:
                raise ValidationError(
                    f"scenario narrative {use_case_id} names unknown open question {unknown_id}"
                )
        complete += 1
    return {
        "complete": complete,
        "required": len(confirmed),
        "unresolved_ids": unresolved,
        "metric": _metric(complete, len(confirmed), unresolved),
    }


def validate_engineering_views(
    records: list[dict[str, Any]],
    use_cases: list[dict[str, Any]],
    required_use_case_ids: set[str],
    evidence_ids: set[str],
    unknown_ids: set[str],
) -> dict[str, Any]:
    """Validate technology-neutral engineering drill-down for core scenarios."""
    use_case_by_id = {str(item.get("id")): item for item in use_cases if item.get("id")}
    required_record_fields = [
        "id", "use_case_id", "implementation_summary", "step_mappings",
        "engineering_topics", "change_guides", "evidence_ids",
    ]
    required_step_fields = [
        "step_id", "implementation_units", "reads", "writes", "state_behavior",
        "external_interactions", "configuration", "runtime_controls", "evidence_ids",
    ]
    required_unit_fields = ["kind", "name", "locator", "role", "evidence_ids"]
    required_topic_fields = [
        "topic_id", "kind", "status", "summary", "details", "evidence_ids", "unknown_ids",
    ]
    required_guide_fields = [
        "guide_id", "change_goal", "affected_step_ids", "implementation_units",
        "data_and_state_impacts", "downstream_risks", "verification_targets", "evidence_ids",
    ]
    records_by_use_case: dict[str, dict[str, Any]] = {}
    unresolved: list[str] = []
    for record in records:
        require_fields(record, required_record_fields, "engineering view")
        use_case_id = str(record.get("use_case_id", ""))
        if use_case_id not in use_case_by_id:
            raise ValidationError(f"engineering view names unknown use case {use_case_id}")
        if use_case_id in records_by_use_case:
            raise ValidationError(f"duplicate engineering view for {use_case_id}")
        records_by_use_case[use_case_id] = record
        if not str(record.get("implementation_summary", "")).strip():
            raise ValidationError(f"engineering view {use_case_id} requires implementation_summary")
        scenario_steps = {
            str(step.get("step_id"))
            for stage in use_case_by_id[use_case_id].get("scenario_narrative", {}).get("stages", [])
            for step in stage.get("steps", [])
            if step.get("step_id")
        }
        mapped_steps: set[str] = set()
        for mapping in record.get("step_mappings", []):
            require_fields(mapping, required_step_fields, f"engineering step mapping {use_case_id}")
            step_id = str(mapping.get("step_id", ""))
            if step_id not in scenario_steps:
                raise ValidationError(
                    f"engineering view {use_case_id} maps unknown scenario step {step_id}"
                )
            if step_id in mapped_steps:
                raise ValidationError(
                    f"engineering view {use_case_id} duplicates step mapping {step_id}"
                )
            mapped_steps.add(step_id)
            units = mapping.get("implementation_units")
            if not isinstance(units, list) or not units:
                raise ValidationError(
                    f"engineering step mapping {use_case_id}/{step_id} requires implementation_units"
                )
            for unit in units:
                require_fields(unit, required_unit_fields, f"implementation unit {use_case_id}/{step_id}")
                if any(unit.get(field) in (None, "", []) for field in required_unit_fields):
                    raise ValidationError(
                        f"implementation unit {use_case_id}/{step_id} requires complete fields"
                    )
                for evidence_id in unit["evidence_ids"]:
                    if evidence_id not in evidence_ids:
                        raise ValidationError(
                            f"implementation unit {use_case_id}/{step_id} names unknown evidence {evidence_id}"
                        )
            for evidence_id in mapping.get("evidence_ids", []):
                if evidence_id not in evidence_ids:
                    raise ValidationError(
                        f"engineering step mapping {use_case_id}/{step_id} names unknown evidence {evidence_id}"
                    )
        missing_steps = sorted(scenario_steps - mapped_steps)
        if missing_steps:
            unresolved.extend(f"{use_case_id}#engineering/{step_id}" for step_id in missing_steps)
        topic_kinds: set[str] = set()
        for topic in record.get("engineering_topics", []):
            require_fields(topic, required_topic_fields, f"engineering topic {use_case_id}")
            status = topic.get("status")
            if status not in {"confirmed", "not_applicable", "source_unknown"}:
                raise ValidationError(f"engineering topic {use_case_id} has invalid status")
            topic_kinds.add(str(topic.get("kind", "")))
            if status == "confirmed" and not topic.get("evidence_ids"):
                raise ValidationError(
                    f"confirmed engineering topic {use_case_id} requires evidence_ids"
                )
            if status == "source_unknown" and not topic.get("unknown_ids"):
                raise ValidationError(
                    f"source_unknown engineering topic {use_case_id} requires unknown_ids"
                )
            for evidence_id in topic.get("evidence_ids", []):
                if evidence_id not in evidence_ids:
                    raise ValidationError(
                        f"engineering topic {use_case_id} names unknown evidence {evidence_id}"
                    )
            for unknown_id in topic.get("unknown_ids", []):
                if unknown_id not in unknown_ids:
                    raise ValidationError(
                        f"engineering topic {use_case_id} names unknown unknown {unknown_id}"
                    )
        for required_kind in {"data_lifecycle", "state_lifecycle", "runtime_safety", "external_contracts", "configuration"}:
            if required_kind not in topic_kinds:
                unresolved.append(f"{use_case_id}#engineering-topic/{required_kind}")
        guides = record.get("change_guides")
        if not isinstance(guides, list) or not guides:
            unresolved.append(f"{use_case_id}#change_guides")
        for guide in guides or []:
            require_fields(guide, required_guide_fields, f"change guide {use_case_id}")
            if any(guide.get(field) in (None, "", []) for field in required_guide_fields):
                raise ValidationError(f"change guide {use_case_id} requires complete fields")
            unknown_steps = set(guide["affected_step_ids"]) - scenario_steps
            if unknown_steps:
                raise ValidationError(
                    f"change guide {use_case_id} names unknown steps: {', '.join(sorted(unknown_steps))}"
                )
            for evidence_id in guide["evidence_ids"]:
                if evidence_id not in evidence_ids:
                    raise ValidationError(
                        f"change guide {use_case_id} names unknown evidence {evidence_id}"
                    )
        for evidence_id in record.get("evidence_ids", []):
            if evidence_id not in evidence_ids:
                raise ValidationError(f"engineering view {use_case_id} names unknown evidence {evidence_id}")
    for use_case_id in sorted(required_use_case_ids - set(records_by_use_case)):
        unresolved.append(f"{use_case_id}#engineering_view")
    complete = sum(
        1
        for use_case_id in required_use_case_ids
        if not any(item.startswith(f"{use_case_id}#") for item in unresolved)
    )
    return {
        "complete": complete,
        "required": len(required_use_case_ids),
        "unresolved_ids": sorted(set(unresolved)),
        "metric": _metric(complete, len(required_use_case_ids), unresolved),
    }


def important_scenario_use_case_ids(
    use_cases: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
) -> set[str]:
    """Resolve critical/high scenario IDs without making priority mandatory on legacy nodes."""
    active_confirmed_ids = {
        str(item.get("id"))
        for item in use_cases
        if item.get("claim_status") == "confirmed"
        and item.get("lifecycle_status") in {"active", "conditional"}
        and item.get("id")
    }
    important = {
        str(item["id"])
        for item in use_cases
        if item.get("id") in active_confirmed_ids
        and (
            item.get("business_priority") in {"critical", "high"}
            or item.get("structural_importance") in {"critical", "high"}
        )
    }
    important.update(
        str(candidate.get("resolved_use_case_id"))
        for candidate in candidates
        if candidate.get("candidate_status") in {"confirmed", "variant"}
        and candidate.get("resolved_use_case_id") in active_confirmed_ids
        and (
            candidate.get("business_priority") in {"critical", "high"}
            or candidate.get("structural_importance") in {"critical", "high"}
        )
    )
    return important or active_confirmed_ids


def validate_project_progress(
    progress: dict[str, Any],
    *,
    manifest_status: str,
    inventory_by_id: dict[str, dict[str, Any]],
    candidate_ids: set[str],
    module_dossier_ids: set[str],
    flow_ids: set[str],
    use_case_ids: set[str],
    engineering_view_ids: set[str],
    gap_ids: set[str],
    required_queue_candidate_ids: set[str],
    omission_findings: list[dict[str, Any]],
) -> dict[str, Any]:
    """Validate the repository-wide queue separately from revision publication."""
    require_fields(
        progress,
        [
            "schema_version", "project_completion_status", "active_module_id",
            "next_module_ids", "modules",
        ],
        "project progress",
    )
    if progress.get("schema_version") != contract.V32_SCHEMA_VERSION:
        raise ValidationError("project progress schema version must be 3.2")
    project_status = progress.get("project_completion_status")
    if project_status not in {"complete", "in_progress", "blocked"}:
        raise ValidationError("project progress has invalid completion status")
    if manifest_status != project_status:
        raise ValidationError(
            "manifest project completion status does not match project progress"
        )
    modules = progress.get("modules")
    if not isinstance(modules, list) or not modules:
        raise ValidationError("project progress requires a repository-wide module queue")
    required_fields = [
        "id", "title", "priority", "status", "signal_ids", "candidate_ids",
        "module_dossier_id", "flow_ids", "use_case_ids", "engineering_view_ids",
        "history_status", "gap_ids", "next_action",
    ]
    module_by_id: dict[str, dict[str, Any]] = {}
    unfinished_states = {"pending", "in_progress", "blocked"}
    unfinished_ids: list[str] = []
    complete_count = 0
    for module in modules:
        require_fields(module, required_fields, "project progress module")
        module_id = str(module.get("id", ""))
        if not module_id:
            raise ValidationError("project progress module requires id")
        if module_id in module_by_id:
            raise ValidationError(f"duplicate project progress module {module_id}")
        module_by_id[module_id] = module
        status = module.get("status")
        if status not in unfinished_states | {"complete", "excluded"}:
            raise ValidationError(f"project progress module {module_id} has invalid status")
        if status in unfinished_states:
            unfinished_ids.append(module_id)
            if not str(module.get("next_action") or "").strip():
                raise ValidationError(
                    f"unfinished project module {module_id} requires next_action"
                )
        elif module.get("next_action") not in {None, ""}:
            raise ValidationError(
                f"finished project module {module_id} must not retain next_action"
            )
        for field, known_ids, label in (
            ("signal_ids", set(inventory_by_id), "signal"),
            ("candidate_ids", candidate_ids, "candidate"),
            ("flow_ids", flow_ids, "flow"),
            ("use_case_ids", use_case_ids, "use case"),
            ("engineering_view_ids", engineering_view_ids, "engineering view"),
            ("gap_ids", gap_ids, "gap"),
        ):
            values = module.get(field)
            if not isinstance(values, list):
                raise ValidationError(f"project module {module_id} {field} must be a list")
            unknown = sorted(set(values) - known_ids)
            if unknown:
                raise ValidationError(
                    f"project module {module_id} names unknown {label}: "
                    + ", ".join(unknown)
                )
        dossier_id = module.get("module_dossier_id")
        if dossier_id is not None and dossier_id not in module_dossier_ids:
            raise ValidationError(
                f"project module {module_id} names unknown module dossier {dossier_id}"
            )
        if status == "complete":
            complete_count += 1
            if not dossier_id:
                raise ValidationError(
                    f"complete project module {module_id} requires module dossier"
                )
            if not module.get("flow_ids") or not module.get("use_case_ids"):
                raise ValidationError(
                    f"complete project module {module_id} requires flows and use cases"
                )
            if not module.get("engineering_view_ids"):
                raise ValidationError(
                    f"complete project module {module_id} requires engineering views"
                )

    next_ids = progress.get("next_module_ids")
    if not isinstance(next_ids, list) or len(next_ids) != len(set(next_ids)):
        raise ValidationError("project progress next_module_ids must be a unique list")
    unknown_next = sorted(set(next_ids) - set(module_by_id))
    if unknown_next:
        raise ValidationError(
            "project progress names unknown next module: " + ", ".join(unknown_next)
        )
    finished_next = [
        module_id for module_id in next_ids
        if module_by_id[module_id].get("status") not in unfinished_states
    ]
    if finished_next:
        raise ValidationError(
            "project progress next queue contains finished module: "
            + ", ".join(finished_next)
        )
    active_id = progress.get("active_module_id")
    if active_id is not None and active_id not in module_by_id:
        raise ValidationError("project progress active module is unknown")

    represented_signals = {
        signal_id
        for module in modules
        if module.get("status") in unfinished_states
        for signal_id in module.get("signal_ids", [])
    }
    represented_candidates = {
        candidate_id
        for module in modules
        if module.get("status") in unfinished_states
        for candidate_id in module.get("candidate_ids", [])
    }
    represented_gaps = {
        gap_id
        for module in modules
        if module.get("status") in unfinished_states
        for gap_id in module.get("gap_ids", [])
    }
    detached_candidates = sorted(
        required_queue_candidate_ids - represented_candidates
    )
    if detached_candidates:
        raise ValidationError(
            "important unresolved candidate is not represented in the project queue: "
            + ", ".join(detached_candidates)
        )
    detached_omissions: list[str] = []
    for finding in omission_findings:
        if (
            finding.get("resolution_status") == "unresolved"
            and finding.get("severity") in {"critical", "high"}
            and not (
                set(finding.get("signal_ids", [])) & represented_signals
                or set(finding.get("candidate_ids", [])) & represented_candidates
                or str(finding.get("id", "")) in represented_gaps
            )
        ):
            detached_omissions.append(str(finding.get("id", "")))
    if detached_omissions:
        raise ValidationError(
            "critical/high unresolved omission is not represented in the project queue: "
            + ", ".join(sorted(detached_omissions))
        )

    if project_status == "complete":
        if unfinished_ids or next_ids or active_id is not None:
            raise ValidationError(
                "complete project cannot retain unfinished, active, or queued modules"
            )
    elif project_status == "in_progress":
        if not unfinished_ids or not next_ids:
            raise ValidationError(
                "in-progress project requires unfinished work and a non-empty next queue"
            )
        if active_id != next_ids[0]:
            raise ValidationError(
                "in-progress project active module must equal the first next module"
            )
        if module_by_id[active_id].get("status") not in {"pending", "in_progress"}:
            raise ValidationError(
                "in-progress project active module must be pending or in_progress"
            )
    else:
        if not unfinished_ids:
            raise ValidationError("blocked project requires at least one blocked module")
        if not any(module.get("status") == "blocked" for module in modules):
            raise ValidationError("blocked project requires a blocked module")

    return {
        "project_completion_status": project_status,
        "next_module_ids": list(next_ids),
        "active_module_id": active_id,
        "metric": _metric(
            complete_count,
            len([item for item in modules if item.get("status") != "excluded"]),
            unfinished_ids,
            [item["id"] for item in modules if item.get("status") == "excluded"],
        ),
    }


def validate_calculation_models(
    records: list[dict[str, Any]],
    inventory_by_id: dict[str, dict[str, Any]],
    evidence_ids: set[str],
    snapshot_id: str,
) -> dict[str, Any]:
    required = [
        "id", "title", "business_purpose", "inputs", "source_data", "applicability",
        "filters", "missing_value_policy", "formula_or_algorithm", "weights",
        "thresholds", "rounding", "caps_and_floors", "version_source", "output",
        "recalculation_triggers", "examples_or_tests", "evidence_ids",
        "history_event_ids", "unknown_ids", "snapshot_id",
    ]
    ids: set[str] = set()
    for record in records:
        require_fields(record, required, "calculation model")
        _require_nonempty_fields(
            record,
            ["id", "title", "business_purpose", "inputs", "source_data", "applicability", "missing_value_policy", "formula_or_algorithm", "rounding", "caps_and_floors", "version_source", "output", "evidence_ids"],
            "calculation model",
        )
        if record["id"] in ids:
            raise ValidationError(f"duplicate calculation model {record['id']}")
        ids.add(record["id"])
        if record["snapshot_id"] != snapshot_id:
            raise ValidationError(f"calculation model {record['id']} snapshot mismatch")
        for evidence_id in record["evidence_ids"]:
            if evidence_id not in evidence_ids:
                raise ValidationError(f"calculation model names unknown evidence {evidence_id}")
    detected = {
        signal_id
        for signal_id, signal in inventory_by_id.items()
        if any(
            token in f"{signal.get('kind', '')} {signal.get('name', '')}".casefold()
            for token in ("score", "scoring", "calculate", "calculation", "formula", "weight", "threshold", "算分", "评分")
        )
    }
    if detected and not records:
        raise ValidationError(
            "calculation model missing for detected signals: " + ", ".join(sorted(detected))
        )
    return {
        "ids": ids,
        "detected_signal_ids": detected,
        "metric": _metric(len(detected), len(detected)),
    }


def validate_code_knowledge_matrix(
    records: list[dict[str, Any]],
    inventory_by_id: dict[str, dict[str, Any]],
    module_ids: set[str],
    flow_ids: set[str],
    calculation_ids: set[str],
    *,
    use_case_ids: set[str],
    rule_ids: set[str],
    investigation_ids: set[str],
    evidence_ids: set[str],
    calculation_signal_ids: set[str],
) -> dict[str, Any]:
    required = [
        "signal_id", "module_dossier_ids", "flow_ids", "use_case_ids", "rule_ids",
        "calculation_model_ids", "disposition", "resolution_reason",
        "investigation_ids", "evidence_ids",
    ]
    by_signal: dict[str, dict[str, Any]] = {}
    for record in records:
        require_fields(record, required, "code-knowledge matrix row")
        signal_id = record["signal_id"]
        if signal_id in by_signal:
            raise ValidationError(f"duplicate code-knowledge matrix signal {signal_id}")
        if signal_id not in inventory_by_id:
            raise ValidationError(f"code-knowledge matrix names unknown signal {signal_id}")
        if len(str(record.get("resolution_reason", "")).strip()) < 24:
            raise ValidationError(f"code-knowledge matrix {signal_id} reason is too generic")
        if record["disposition"] == "covered" and not (
            record["module_dossier_ids"] and (record["flow_ids"] or record["use_case_ids"])
        ):
            raise ValidationError(f"code-knowledge matrix {signal_id} lacks business mapping")
        if any(value not in module_ids for value in record["module_dossier_ids"]):
            raise ValidationError(f"code-knowledge matrix {signal_id} names unknown module")
        if any(value not in flow_ids for value in record["flow_ids"]):
            raise ValidationError(f"code-knowledge matrix {signal_id} names unknown flow")
        if any(value not in calculation_ids for value in record["calculation_model_ids"]):
            raise ValidationError(f"code-knowledge matrix {signal_id} names unknown calculation")
        if any(value not in use_case_ids for value in record["use_case_ids"]):
            raise ValidationError(f"code-knowledge matrix {signal_id} names unknown use case")
        if any(value not in rule_ids for value in record["rule_ids"]):
            raise ValidationError(f"code-knowledge matrix {signal_id} names unknown rule")
        if any(value not in investigation_ids for value in record["investigation_ids"]):
            raise ValidationError(
                f"code-knowledge matrix {signal_id} names unknown investigation"
            )
        if any(value not in evidence_ids for value in record["evidence_ids"]):
            raise ValidationError(f"code-knowledge matrix {signal_id} names unknown evidence")
        if signal_id in calculation_signal_ids and not record["calculation_model_ids"]:
            raise ValidationError(
                f"calculation signal lacks explicit model mapping: {signal_id}"
            )
        by_signal[signal_id] = record
    reasons: dict[str, list[str]] = {}
    for signal_id, record in by_signal.items():
        if inventory_by_id[signal_id].get("structural_importance") not in {
            "critical",
            "high",
        }:
            continue
        normalized = re.sub(
            r"[^0-9a-z\u4e00-\u9fff]+",
            "",
            str(record.get("resolution_reason", "")).casefold(),
        )
        reasons.setdefault(normalized, []).append(signal_id)
    repeated = [signal_ids for signal_ids in reasons.values() if len(signal_ids) >= 3]
    if repeated:
        raise ValidationError(
            "code-knowledge matrix reuses a generic resolution reason for important signals: "
            + ", ".join(sorted(repeated[0]))
        )
    important = {
        signal_id
        for signal_id, signal in inventory_by_id.items()
        if signal.get("structural_importance") in {"critical", "high"}
    }
    missing = sorted(important - set(by_signal))
    if missing:
        raise ValidationError(
            "code-knowledge matrix missing signal: " + ", ".join(missing)
        )
    return {"metric": _metric(len(important), len(important))}


def validate_capability_destinations(
    capabilities: list[dict[str, Any]],
    confirmed_use_case_ids: set[str],
    relationships: list[dict[str, Any]],
) -> dict[str, Any]:
    confirmed_capabilities = {
        item["id"]
        for item in capabilities
        if item.get("claim_status") == "confirmed"
        and item.get("lifecycle_status") in {"active", "conditional"}
    }
    covered = {
        relationship["from_id"]
        for relationship in relationships
        if relationship.get("type") == "contains"
        and relationship.get("from_id") in confirmed_capabilities
        and relationship.get("to_id") in confirmed_use_case_ids
        and relationship.get("claim_status") == "confirmed"
    }
    missing = sorted(confirmed_capabilities - covered)
    if missing:
        raise ValidationError(
            "confirmed capability has no confirmed use case: " + ", ".join(missing)
        )
    return {"metric": _metric(len(covered), len(confirmed_capabilities))}


def validate_git_commit_index(
    commits: list[dict[str, Any]],
    repository_snapshot: dict[str, Any],
) -> None:
    git = repository_snapshot.get("git", {})
    canonical_root = repository_snapshot.get("canonical_root")
    if not git.get("is_repository") or not canonical_root:
        return
    repo = Path(str(canonical_root))
    probe = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "--is-inside-work-tree"],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
        text=True,
    )
    if probe.returncode != 0 or probe.stdout.strip() != "true":
        return
    record_format = "%H%x1f%P%x1f%aI%x1f%cI%x1f%an <%ae>%x1f%s"
    for commit in commits:
        sha = str(commit.get("sha", ""))
        result = subprocess.run(
            ["git", "-C", str(repo), "show", "-s", f"--format={record_format}", sha],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            text=True,
        )
        if result.returncode != 0:
            raise ValidationError(f"Git commit is not present in repository: {sha}")
        fields = result.stdout.rstrip("\n").split("\x1f")
        actual = {
            "sha": fields[0],
            "parents": fields[1].split() if fields[1] else [],
            "author_time": fields[2],
            "commit_time": fields[3],
            "author_identity": fields[4],
            "subject": fields[5],
        }
        for field, expected in actual.items():
            if commit.get(field) != expected:
                raise ValidationError(
                    f"Git commit metadata mismatch for {sha}: {field}"
                )


def validate_family_closure(
    families: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    investigation_records: list[dict[str, Any]],
) -> dict[str, Any]:
    known_investigation_ids = {
        investigation["id"] for investigation in investigation_records if investigation.get("id")
    }
    allowed = {"confirmed", "variant", "not_applicable", "searched_not_found", "unresolved"}
    unresolved: list[str] = []
    total = 0
    complete = 0
    for family in families:
        family_id = family.get("id")
        matrix = family.get("closure_matrix")
        if not isinstance(matrix, dict):
            raise ValidationError(f"missing family closure matrix {family_id}")
        for action, channels in sorted(matrix.items()):
            if not isinstance(channels, dict):
                raise ValidationError(f"missing family closure disposition {family_id}:{action}")
            for channel, cell in sorted(channels.items()):
                total += 1
                if not cell:
                    raise ValidationError(
                        f"missing family closure disposition {family_id}:{action}:{channel}"
                    )
                if not isinstance(cell, dict) or cell.get("status") not in allowed:
                    raise ValidationError(
                        f"missing family closure disposition {family_id}:{action}:{channel}"
                    )
                if not cell.get("reason"):
                    raise ValidationError(
                        f"family closure cell requires reason {family_id}:{action}:{channel}"
                    )
                if cell.get("status") in {"confirmed", "variant"}:
                    complete += 1
                elif cell.get("status") == "unresolved":
                    unresolved.append(f"{family_id}:{action}:{channel}")
        for investigation_id in family.get("reverse_writer_investigation_ids", []):
            if investigation_id not in known_investigation_ids:
                raise ValidationError(
                    f"family {family_id} names unknown reverse-writer investigation {investigation_id}"
                )
    return {
        "total": total,
        "complete": complete,
        "unresolved_ids": sorted(set(unresolved)),
    }


def validate_omission_audit(
    audit: dict[str, Any],
    inventory_by_id: dict[str, dict[str, Any]],
    candidate_by_id: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if audit.get("reviewer_mode") != "independent":
        raise ValidationError("omission audit reviewer mode must be independent")
    findings = audit.get("findings", [])
    unresolved: list[str] = []
    critical: list[str] = []
    for finding in findings:
        finding_id = finding.get("id")
        for signal_id in finding.get("signal_ids", []):
            if signal_id not in inventory_by_id:
                raise ValidationError(f"omission finding {finding_id} names unknown signal {signal_id}")
        for candidate_id in finding.get("candidate_ids", []):
            if candidate_id not in candidate_by_id:
                raise ValidationError(f"omission finding {finding_id} names unknown candidate {candidate_id}")
        if finding.get("resolution_status") == "unresolved":
            unresolved.append(finding_id)
            if finding.get("severity") in {"critical", "high"}:
                critical.append(finding_id)
    return {
        "finding_count": len(findings),
        "unresolved_ids": sorted(set(unresolved)),
        "critical_unresolved_ids": sorted(set(critical)),
    }


def calculate_v2_coverage(
    inventory_summary: dict[str, Any],
    candidate_summary: dict[str, Any],
    family_summary: dict[str, Any],
    investigation_summary: dict[str, Any],
    omission_summary: dict[str, Any],
    flow_summary: dict[str, Any],
    history_summary: dict[str, Any],
) -> dict[str, Any]:
    metrics = {
        "candidate_conservation": _metric(
            len(candidate_summary["accounted_signal_ids"]),
            inventory_summary["signal_count"],
            omission_summary["unresolved_ids"] + candidate_summary["unresolved_ids"],
            candidate_summary["excluded_ids"],
        ),
        "family_closure_coverage": _metric(
            family_summary["complete"],
            family_summary["total"],
            family_summary["unresolved_ids"],
        ),
        "required_investigation_coverage": _metric(
            investigation_summary["complete"],
            investigation_summary["required"],
            investigation_summary["unresolved_ids"],
        ),
        "business_flow_semantic_quality": _metric(
            flow_summary["complete"],
            flow_summary["required"],
            flow_summary["unresolved_ids"],
        ),
    }
    for name, value in history_summary.get("metrics", {}).items():
        metrics[name] = value
    return metrics


def validate_revision_v2(
    root: Path,
    *,
    schema_version: str = contract.V2_SCHEMA_VERSION,
    deep_validation: bool = False,
) -> dict[str, Any]:
    manifest = read_json(root / "manifest.json")
    snapshot = manifest.get("repository_snapshot", {})
    snapshot_id = snapshot.get("snapshot_id")
    if not snapshot_id:
        raise ValidationError("manifest repository snapshot is missing snapshot_id")
    if manifest.get("schema_version") != schema_version:
        raise ValidationError(f"revision is not schema version {schema_version}")

    inventory_records = read_jsonl(root / "inventory.jsonl")
    inventory = validate_inventory(inventory_records)
    inventory_by_id = {item["id"]: item for item in inventory_records}
    if not inventory_by_id:
        raise ValidationError("v2 inventory must contain at least one signal")
    validate_discovery_observations(
        read_jsonl(root / "discovery-observations.jsonl"),
        inventory_by_id,
        snapshot_id,
    )

    nodes_by_file = load_node_records(root)
    node_ids: set[str] = set()
    for nodes in nodes_by_file.values():
        for node in nodes:
            validate_common_node(node, "v2 node")
            if node["id"] in node_ids:
                raise ValidationError(f"duplicate node id: {node['id']}")
            node_ids.add(node["id"])
    evidence = read_jsonl(root / "evidence.jsonl")
    evidence_ids, _ = validate_evidence(
        evidence,
        snapshot_id,
        require_verified_hash=deep_validation,
        repository_snapshot=snapshot,
    )
    investigations = validate_investigations(
        read_jsonl(root / "investigations.jsonl"), snapshot_id
    )
    investigation_records = read_jsonl(root / "investigations.jsonl")
    candidates = read_jsonl(root / "use-case-candidates.jsonl")
    migration_gaps: list[str] = []
    legacy_inventory = [item for item in inventory_records if item.get("id_scheme") == "legacy_v1"]
    if legacy_inventory:
        migration_gaps.append("v2 discovery required")
    candidate_summary = validate_candidates(
        candidates, inventory_by_id, node_ids, investigations
    )
    if deep_validation:
        validate_v3_candidates(candidates)
    family_summary = validate_family_closure(
        nodes_by_file["use-case-families.json"], candidates, investigation_records
    )
    candidate_by_id = {item["id"]: item for item in candidates}
    omission_summary = validate_omission_audit(
        read_json(root / "omission-audit.json"), inventory_by_id, candidate_by_id
    )
    confirmed_use_cases = [
        use_case
        for use_case in nodes_by_file["use-cases.jsonl"]
        if use_case.get("claim_status") == "confirmed"
    ]
    relationships = read_jsonl(root / "relationships.jsonl")
    flow_diagnostics = validate_business_flows(confirmed_use_cases)
    affected_flow_use_cases = {
        diagnostic["use_case_id"] for diagnostic in flow_diagnostics
    }
    flow_summary = {
        "complete": len(confirmed_use_cases) - len(affected_flow_use_cases),
        "required": len(confirmed_use_cases),
        "unresolved_ids": [
            diagnostic["flow_step_address"]
            for diagnostic in flow_diagnostics
        ],
    }

    investigation_required = len(REQUIRED_INVESTIGATIONS) * len(confirmed_use_cases)
    investigation_complete = sum(
        len(REQUIRED_INVESTIGATIONS & investigations.get(use_case["id"], set()))
        for use_case in confirmed_use_cases
    )
    investigation_unresolved = [
        f"{use_case['id']}:{kind}"
        for use_case in confirmed_use_cases
        for kind in sorted(
            REQUIRED_INVESTIGATIONS - investigations.get(use_case["id"], set())
        )
    ]
    deep_metrics: dict[str, Any] = {}
    deep_unresolved: list[str] = []
    engineering_validation = schema_version in {
        contract.V31_SCHEMA_VERSION,
        contract.V32_SCHEMA_VERSION,
    }
    project_validation = schema_version == contract.V32_SCHEMA_VERSION
    project_summary: dict[str, Any] | None = None
    if deep_validation:
        important_scenario_ids = important_scenario_use_case_ids(
            confirmed_use_cases,
            candidates,
        )
        narrative_summary = validate_scenario_narratives(
            confirmed_use_cases,
            evidence_ids,
            {
                item["id"]
                for item in read_jsonl(root / "business-evolution-events.jsonl")
            },
            {item["id"] for item in nodes_by_file["unknowns.jsonl"]},
            important_scenario_ids,
        )
        calculation_summary = validate_calculation_models(
            read_jsonl(root / "calculation-models.jsonl"),
            inventory_by_id,
            evidence_ids,
            snapshot_id,
        )
        module_summary = validate_module_dossiers(
            read_jsonl(root / "module-dossiers.jsonl"),
            inventory_by_id,
            evidence_ids,
            snapshot_id,
        )
        flow_summary_v3 = validate_end_to_end_flows(
            read_jsonl(root / "end-to-end-flows.jsonl"),
            module_summary["ids"],
            {item["id"] for item in confirmed_use_cases},
            evidence_ids,
            snapshot_id,
        )
        unknown_calculations = sorted(
            flow_summary_v3["calculation_model_ids"] - calculation_summary["ids"]
        )
        if unknown_calculations:
            raise ValidationError(
                "end-to-end flow names unknown calculation model: "
                + ", ".join(unknown_calculations)
            )
        matrix_summary = validate_code_knowledge_matrix(
            read_jsonl(root / "code-knowledge-matrix.jsonl"),
            inventory_by_id,
            module_summary["ids"],
            flow_summary_v3["ids"],
            calculation_summary["ids"],
            use_case_ids={item["id"] for item in nodes_by_file["use-cases.jsonl"]},
            rule_ids={item["id"] for item in nodes_by_file["business-rules.jsonl"]},
            investigation_ids={item["id"] for item in investigation_records},
            evidence_ids=evidence_ids,
            calculation_signal_ids=calculation_summary["detected_signal_ids"],
        )
        capability_summary = validate_capability_destinations(
            nodes_by_file["capabilities.json"],
            {item["id"] for item in confirmed_use_cases},
            relationships,
        )
        deep_metrics = {
            "scenario_readiness_coverage": narrative_summary["metric"],
            "module_dossier_coverage": module_summary["metric"],
            "end_to_end_flow_coverage": flow_summary_v3["metric"],
            "calculation_model_coverage": calculation_summary["metric"],
            "code_knowledge_coverage": matrix_summary["metric"],
            "capability_business_coverage": capability_summary["metric"],
        }
        if engineering_validation:
            engineering_records = read_jsonl(root / "engineering-views.jsonl")
            engineering_summary = validate_engineering_views(
                engineering_records,
                confirmed_use_cases,
                important_scenario_ids,
                evidence_ids,
                {item["id"] for item in nodes_by_file["unknowns.jsonl"]},
            )
            deep_metrics["engineering_readiness_coverage"] = engineering_summary["metric"]
        if project_validation:
            omission_audit = read_json(root / "omission-audit.json")
            project_summary = validate_project_progress(
                read_json(root / "project-progress.json"),
                manifest_status=str(manifest.get("project_completion_status", "")),
                inventory_by_id=inventory_by_id,
                candidate_ids=set(candidate_by_id),
                module_dossier_ids=module_summary["ids"],
                flow_ids=flow_summary_v3["ids"],
                use_case_ids={item["id"] for item in nodes_by_file["use-cases.jsonl"]},
                engineering_view_ids={
                    str(item.get("id")) for item in engineering_records if item.get("id")
                },
                gap_ids={
                    *{item["id"] for item in nodes_by_file["unknowns.jsonl"]},
                    *{item["id"] for item in nodes_by_file["conflicts.jsonl"]},
                    *{
                        str(item.get("id"))
                        for item in omission_audit.get("findings", [])
                        if item.get("id")
                    },
                },
                required_queue_candidate_ids=set(
                    candidate_summary["unresolved_ids"]
                ),
                omission_findings=omission_audit.get("findings", []),
            )
            deep_metrics["project_module_completion_coverage"] = project_summary["metric"]
        deep_unresolved = [
            unresolved_id
            for metric in deep_metrics.values()
            for unresolved_id in metric["unresolved_ids"]
        ]
        commits = read_jsonl(root / "git-commits.jsonl")
        validate_git_commit_index(commits, snapshot)
        history_analysis = manifest.get("history_analysis", {})
        if history_analysis.get("requested_scope") == "all_reachable":
            reachable = history_analysis.get("reachable_commit_count")
            indexed = len(commits)
            declared_indexed = history_analysis.get("indexed_commit_count")
            if reachable != indexed or declared_indexed != indexed:
                raise ValidationError(
                    f"all reachable Git commits must be indexed: reachable={reachable}, indexed={indexed}"
                )
    metrics = calculate_v2_coverage(
        {"signal_count": len(inventory_by_id)},
        candidate_summary,
        family_summary,
        {
            "complete": investigation_complete,
            "required": investigation_required,
            "unresolved_ids": investigation_unresolved,
        },
        omission_summary,
        flow_summary,
        {"metrics": {}},
    )
    metrics.update(deep_metrics)
    current_unresolved = (
        candidate_summary["unresolved_ids"]
        + omission_summary["critical_unresolved_ids"]
        + family_summary["unresolved_ids"]
        + flow_summary["unresolved_ids"]
        + investigation_unresolved
        + deep_unresolved
    )
    if project_summary is not None and project_summary["project_completion_status"] != "complete":
        current_unresolved += [
            f"project:{project_summary['project_completion_status']}",
            *project_summary["next_module_ids"],
        ]
    current_status = "passed" if not current_unresolved else "partial"
    history_status = manifest.get("history_coverage_status", "not_requested")
    aggregate = contract.aggregate_status(current_status, history_status)
    if manifest.get("current_coverage_status") != current_status:
        raise ValidationError("manifest current coverage status does not match artifacts")
    if manifest.get("history_coverage_status") != history_status:
        raise ValidationError("manifest history coverage status does not match artifacts")
    if manifest.get("aggregate_status") != aggregate:
        raise ValidationError("manifest aggregate status does not match artifacts")
    coverage = {
        "schema_version": schema_version,
        "current_coverage_status": current_status,
        "history_coverage_status": history_status,
        "aggregate_status": aggregate,
        "metrics": metrics,
    }
    if migration_gaps:
        coverage["migration_gaps"] = migration_gaps
    canonical_hash = manifest.get("canonical_revision_sha256")
    if not canonical_hash:
        raise ValidationError("manifest canonical revision hash is missing")
    calculated_hash = (
        canonical_revision_sha256_v32(root)
        if project_validation
        else canonical_revision_sha256_v31(root)
        if engineering_validation
        else canonical_revision_sha256_v3(root)
        if deep_validation
        else canonical_revision_sha256_v2(root)
    )
    if canonical_hash != calculated_hash:
        raise ValidationError("manifest canonical revision hash does not match artifacts")
    validate_projections(manifest, canonical_hash)
    validate_projection_files(root, manifest)
    validate_semantic_review(read_json(root / "semantic-review.json"), canonical_hash)
    result = {
        "status": aggregate,
        "errors": [],
        "coverage": coverage,
        "business_flow_diagnostics": flow_diagnostics,
        "canonical_revision_sha256": canonical_hash,
        "calculated_canonical_sha256": calculated_hash,
        "node_count": len(node_ids),
        "relationship_count": len(relationships),
        "evidence_count": len(evidence),
    }
    if project_summary is not None:
        result.update(
            {
                "project_completion_status": project_summary[
                    "project_completion_status"
                ],
                "active_module_id": project_summary["active_module_id"],
                "next_module_ids": project_summary["next_module_ids"],
            }
        )
    return result


def validate_revision_v1(root: Path) -> dict[str, Any]:
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


def validate_revision(revision_dir: Path | str) -> dict[str, Any]:
    root = Path(revision_dir)
    manifest = read_json(root / "manifest.json")
    if manifest.get("schema_version") == contract.V32_SCHEMA_VERSION:
        return validate_revision_v2(
            root,
            schema_version=contract.V32_SCHEMA_VERSION,
            deep_validation=True,
        )
    if manifest.get("schema_version") == contract.V31_SCHEMA_VERSION:
        return validate_revision_v2(
            root,
            schema_version=contract.V31_SCHEMA_VERSION,
            deep_validation=True,
        )
    if manifest.get("schema_version") == contract.V3_SCHEMA_VERSION:
        return validate_revision_v2(
            root,
            schema_version=contract.V3_SCHEMA_VERSION,
            deep_validation=True,
        )
    if manifest.get("schema_version") == contract.V2_SCHEMA_VERSION:
        return validate_revision_v2(root)
    return validate_revision_v1(root)


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


def _validate_technical_fact_placements(
    nodes_by_file: dict[str, list[dict[str, Any]]],
    evidence: list[dict[str, Any]],
    requirements: list[dict[str, Any]],
) -> None:
    use_cases = nodes_by_file.get("use-cases.jsonl", [])
    location_text = {
        "business_rules": _normalized_text(
            nodes_by_file.get("business-rules.jsonl", [])
        ),
        "evidence": _normalized_text(evidence),
    }
    for field in (
        "decision_points",
        "rejection_conditions",
        "permissions",
        "data_changes",
        "state_changes",
        "external_effects",
        "observability",
    ):
        location_text[field] = _normalized_text(
            [use_case.get(field, []) for use_case in use_cases]
        )

    missing: list[str] = []
    for requirement in requirements:
        alternatives = list(requirement.get("any_of", []))
        allowed_locations = list(requirement.get("allowed_locations", []))
        if not allowed_locations or not any(
            _matches_any(location_text.get(location, ""), alternatives)
            for location in allowed_locations
        ):
            missing.append(str(requirement.get("id", "unnamed")))
    if missing:
        raise ValidationError(
            "benchmark missing technical fact placements: "
            + ", ".join(missing)
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


def _validate_calculation_concepts(
    calculation_models: list[dict[str, Any]],
    expectation: dict[str, Any],
) -> None:
    _require_concept_groups(
        "calculation concepts",
        _normalized_text(calculation_models),
        expectation.get("required_calculation_concepts", []),
    )


def _validate_benchmark_scenario_depth(
    use_cases: list[dict[str, Any]],
    requirements: dict[str, Any],
) -> None:
    if not requirements:
        return
    by_id = {str(item.get("id")): item for item in use_cases if item.get("id")}
    target_requirements = requirements.get("use_cases")
    if isinstance(target_requirements, list):
        failures: list[str] = []
        for target in target_requirements:
            use_case_id = str(target.get("id", ""))
            use_case = by_id.get(use_case_id)
            if not use_case or use_case.get("claim_status") != "confirmed":
                failures.append(f"{use_case_id or 'unnamed'}(missing_confirmed_use_case)")
                continue
            try:
                _validate_benchmark_scenario_depth([use_case], target)
            except ValidationError as error:
                detail = str(error).removeprefix("benchmark scenario depth failed: ")
                failures.append(detail)
        if failures:
            raise ValidationError("benchmark scenario depth failed: " + ", ".join(failures))
        return
    failures: list[str] = []
    minimum_stages = int(requirements.get("minimum_stages", 1))
    minimum_steps = int(requirements.get("minimum_atomic_steps", 1))
    for use_case in use_cases:
        if use_case.get("claim_status") != "confirmed":
            continue
        narrative = use_case.get("scenario_narrative")
        use_case_id = str(use_case.get("id", "unnamed"))
        if not isinstance(narrative, dict):
            failures.append(use_case_id)
            continue
        stages = narrative.get("stages", [])
        step_count = sum(len(stage.get("steps", [])) for stage in stages)
        missing = []
        if len(stages) < minimum_stages:
            missing.append(f"stages<{minimum_stages}")
        if step_count < minimum_steps:
            missing.append(f"steps<{minimum_steps}")
        if requirements.get("require_branch_matrix") and not narrative.get("branch_matrix"):
            missing.append("branch_matrix")
        if requirements.get("require_failure_recovery") and not narrative.get("failure_recovery_matrix"):
            missing.append("failure_recovery_matrix")
        if requirements.get("require_worked_examples") and not narrative.get("worked_examples"):
            missing.append("worked_examples")
        if missing:
            failures.append(f"{use_case_id}({','.join(missing)})")
    if failures:
        raise ValidationError("benchmark scenario depth failed: " + ", ".join(failures))


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
    _validate_benchmark_scenario_depth(
        bundle["nodes_by_file"]["use-cases.jsonl"],
        expectation.get("scenario_depth_requirements", {}),
    )
    _require_concept_groups(
        "business concepts",
        business_text,
        expectation.get("required_business_concepts", []),
    )
    business_flow_text = _normalized_text([
        {
            "main_flow": use_case.get("main_flow", []),
            "scenario_narrative": use_case.get("scenario_narrative", {}),
        }
        for use_case in bundle["nodes_by_file"]["use-cases.jsonl"]
        if use_case.get("claim_status") == "confirmed"
    ])
    _require_concept_groups(
        "business flow concepts",
        business_flow_text,
        expectation.get("required_business_flow_concepts", []),
    )
    _validate_technical_fact_placements(
        bundle["nodes_by_file"],
        bundle["evidence"],
        expectation.get("technical_fact_placements", []),
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
    _validate_calculation_concepts(
        read_jsonl(root / "calculation-models.jsonl")
        if (root / "calculation-models.jsonl").is_file()
        else [],
        expectation,
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
        "schema_version": read_json(target / "manifest.json").get(
            "schema_version", contract.V1_SCHEMA_VERSION
        ),
        "revision_id": revision_id,
        "status": validation["status"],
        "snapshot_sha256": read_json(target / "manifest.json")["repository_snapshot"].get(
            "snapshot_sha256"
        ),
        "canonical_revision_sha256": revision_hash,
        "ai_path": f"revisions/{revision_id}/ai-context.md",
        "html_path": f"revisions/{revision_id}/site/index.html",
    }
    if current["schema_version"] in {
        contract.V2_SCHEMA_VERSION,
        contract.V3_SCHEMA_VERSION,
        contract.V31_SCHEMA_VERSION,
        contract.V32_SCHEMA_VERSION,
    }:
        current.update(
            {
                "current_coverage_status": validation["coverage"][
                    "current_coverage_status"
                ],
                "history_coverage_status": validation["coverage"][
                    "history_coverage_status"
                ],
                "aggregate_status": validation["coverage"]["aggregate_status"],
                "coverage_status": validation["coverage"]["aggregate_status"],
            }
        )
        if current["schema_version"] == contract.V32_SCHEMA_VERSION:
            current.update(
                {
                    "project_completion_status": validation[
                        "project_completion_status"
                    ],
                    "active_module_id": validation["active_module_id"],
                    "next_module_ids": validation["next_module_ids"],
                }
            )
    else:
        current["coverage_status"] = validation["status"]
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
        choices=[
            "work-order",
            "video-binding",
            "video-concat",
            "linjing-scoring",
        ],
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
