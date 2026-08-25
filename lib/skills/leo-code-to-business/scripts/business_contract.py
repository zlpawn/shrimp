#!/usr/bin/env python3
"""Shared deterministic contracts for business knowledge revisions."""

from __future__ import annotations

import hashlib
import json
import unicodedata
from typing import Any


V1_SCHEMA_VERSION = "1.0"
V2_SCHEMA_VERSION = "2.0"

V1_CANONICAL_FILES = (
    "inventory.jsonl",
    "capabilities.json",
    "actors.json",
    "use-case-families.json",
    "use-cases.jsonl",
    "business-rules.jsonl",
    "workflows.jsonl",
    "state-machines.json",
    "domain-events.jsonl",
    "entities.json",
    "glossary.json",
    "conflicts.jsonl",
    "unknowns.jsonl",
    "aliases.json",
    "relationships.jsonl",
    "investigations.jsonl",
    "evidence.jsonl",
    "coverage.json",
    "change-impact.json",
)

V2_CANONICAL_FILE_KINDS = {
    "inventory.jsonl": "jsonl",
    "discovery-observations.jsonl": "jsonl",
    "use-case-candidates.jsonl": "jsonl",
    "legacy-signal-aliases.jsonl": "jsonl",
    "capabilities.json": "json",
    "actors.json": "json",
    "use-case-families.json": "json",
    "use-cases.jsonl": "jsonl",
    "business-rules.jsonl": "jsonl",
    "workflows.jsonl": "jsonl",
    "state-machines.json": "json",
    "domain-events.jsonl": "jsonl",
    "entities.json": "json",
    "glossary.json": "json",
    "aliases.json": "json",
    "relationships.jsonl": "jsonl",
    "investigations.jsonl": "jsonl",
    "evidence.jsonl": "jsonl",
    "conflicts.jsonl": "jsonl",
    "unknowns.jsonl": "jsonl",
    "git-commits.jsonl": "jsonl",
    "git-change-facts.jsonl": "jsonl",
    "historical-claims.jsonl": "jsonl",
    "business-evolution-events.jsonl": "jsonl",
    "lineage-links.jsonl": "jsonl",
    "change-impact.json": "semantic_json",
}

V2_HASH_EXCLUDED_FILES = frozenset(
    {
        "manifest.json",
        "coverage.json",
        "omission-audit.json",
        "semantic-review.json",
        "ai-context.md",
        "site-view-model.json",
        "site/index.html",
    }
)


class ContractError(ValueError):
    """Raised when a shared revision contract is violated."""


def _normalize(value: Any, *, sort_records: bool) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, dict):
        return {
            unicodedata.normalize("NFC", str(key)): _normalize(
                item, sort_records=sort_records
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        normalized = [_normalize(item, sort_records=sort_records) for item in value]
        if sort_records and all(
            isinstance(item, dict) and isinstance(item.get("id"), str)
            for item in normalized
        ):
            normalized.sort(key=lambda item: item["id"])
        return normalized
    if isinstance(value, tuple):
        return [_normalize(item, sort_records=sort_records) for item in value]
    return value


def canonical_json_bytes(value: Any, *, sort_records: bool = False) -> bytes:
    """Serialize JSON deterministically with NFC strings and optional ID sorting."""
    normalized = _normalize(value, sort_records=sort_records)
    return json.dumps(
        normalized,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def canonical_sha256(value: Any, *, sort_records: bool = False) -> str:
    return hashlib.sha256(
        canonical_json_bytes(value, sort_records=sort_records)
    ).hexdigest()


def repository_lineage_id(
    root_commit_shas: list[str],
    file_map: dict[str, Any] | None = None,
) -> str:
    roots = sorted(set(root_commit_shas))
    if roots:
        payload: dict[str, Any] = {"git_root_commit_shas": roots}
    elif file_map is not None:
        payload = {"non_git_file_map": file_map}
    else:
        raise ContractError("repository lineage requires Git roots or a frozen file map")
    return "REPO-" + canonical_sha256(payload)[:20]


def signal_id(
    adapter_namespace: str,
    signal_kind: str,
    locator: str,
    framework_identity: str,
) -> str:
    payload = "\0".join(
        [adapter_namespace, signal_kind, locator, framework_identity]
    ).encode("utf-8")
    return "SIG-" + hashlib.sha256(payload).hexdigest()[:20]


def candidate_id(repository_lineage: str, seed_signal_id: str) -> str:
    payload = f"{repository_lineage}\0{seed_signal_id}".encode("utf-8")
    return "UCC-" + hashlib.sha256(payload).hexdigest()[:20]


def aggregate_status(current: str, history: str) -> str:
    if current == "blocked" or history == "blocked":
        return "blocked"
    if current == "partial" or history == "partial":
        return "partial"
    if current == "passed" and history in {"passed", "not_requested"}:
        return "passed"
    raise ContractError(f"invalid status combination: {current}/{history}")
