"""Language-neutral discovery contracts and deterministic normalization."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

import business_contract as contract


LANGUAGE_EXTENSIONS = {
    ".java": "java",
    ".kt": "kotlin",
    ".js": "javascript",
    ".cjs": "javascript",
    ".mjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".cs": "csharp",
}


@dataclass(frozen=True)
class DiscoveryContext:
    repo_root: Path
    snapshot: dict[str, Any]
    repository_lineage_id: str


@dataclass(frozen=True)
class RawFinding:
    signal_class: str
    kind: str
    locator: str
    name: str
    source_location: dict[str, Any]
    framework_identity: str
    structural_importance: str = "normal"
    classification: str = "unresolved"
    non_candidate_status: str | None = None
    non_candidate_reason: str | None = None
    non_candidate_evidence_ids: tuple[str, ...] = ()


@dataclass(frozen=True)
class RejectedFinding:
    locator: str
    reason: str


@dataclass
class AdapterResult:
    findings: list[RawFinding]
    rejected: list[RejectedFinding]
    unsupported_constructs: list[str]
    truncated: bool
    diagnostics: list[str] = field(default_factory=list)


class DiscoveryAdapter(Protocol):
    adapter_id: str
    adapter_version: str
    claimed_languages: set[str]
    claimed_frameworks: set[str]
    supported_signal_kinds: set[str]

    def discover(self, context: DiscoveryContext) -> AdapterResult: ...


def detect_repository_languages(repo_root: Path, snapshot: dict[str, Any] | None = None) -> dict[str, int]:
    counts: dict[str, int] = {}
    paths = snapshot.get("files", {}) if snapshot else None
    candidates = (
        [Path(path) for path in paths]
        if paths is not None
        else [path.relative_to(repo_root) for path in repo_root.rglob("*") if path.is_file()]
    )
    for path in candidates:
        language = LANGUAGE_EXTENSIONS.get(path.suffix.lower())
        if language:
            counts[language] = counts.get(language, 0) + 1
    return dict(sorted(counts.items()))


def _observation_id(adapter: DiscoveryAdapter, snapshot_id: str) -> str:
    payload = f"{adapter.adapter_id}\0{adapter.adapter_version}\0{snapshot_id}".encode("utf-8")
    return "OBS-" + hashlib.sha256(payload).hexdigest()[:20]


def _normalize_location(context: DiscoveryContext, finding: RawFinding) -> dict[str, Any]:
    location = dict(finding.source_location)
    raw_path = Path(str(location.get("path", "")))
    if raw_path.is_absolute():
        try:
            raw_path = raw_path.resolve().relative_to(context.repo_root.resolve())
        except ValueError as exc:
            raise ValueError(f"finding path escapes repository: {raw_path}") from exc
    location["path"] = raw_path.as_posix()
    return location


def normalize_adapter_result(
    result: AdapterResult,
    context: DiscoveryContext,
    *,
    adapter: DiscoveryAdapter,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    observation_id = _observation_id(adapter, context.snapshot["snapshot_id"])
    inventory: list[dict[str, Any]] = []
    locators_by_id: dict[str, str] = {}
    for finding in result.findings:
        location = _normalize_location(context, finding)
        locator = finding.locator.replace("\\", "/")
        signal = contract.signal_id(
            adapter.adapter_id,
            finding.kind,
            locator,
            finding.framework_identity.strip(),
        )
        previous = locators_by_id.get(signal)
        if previous is not None and previous != locator:
            raise ValueError(f"conflicting locators for signal {signal}: {previous} / {locator}")
        if previous is not None:
            continue
        locators_by_id[signal] = locator
        record: dict[str, Any] = {
            "id": signal,
            "signal_class": finding.signal_class,
            "kind": finding.kind,
            "name": finding.name,
            "source_location": location,
            "discovered_by": [observation_id],
            "structural_importance": finding.structural_importance,
            "classification": finding.classification,
            "resolution_status": "excluded" if finding.non_candidate_status else "unresolved",
            "mapped_node_ids": [],
            "resolution_reason": finding.non_candidate_reason or "Requires semantic investigation.",
            "snapshot_id": context.snapshot["snapshot_id"],
            "id_scheme": "v2",
        }
        if finding.non_candidate_status:
            record.update(
                {
                    "non_candidate_status": finding.non_candidate_status,
                    "non_candidate_reason": finding.non_candidate_reason or "",
                    "non_candidate_evidence_ids": list(finding.non_candidate_evidence_ids),
                }
            )
        inventory.append(record)

    inventory.sort(key=lambda item: item["id"])
    observation = {
        "id": observation_id,
        "adapter_id": adapter.adapter_id,
        "adapter_version": adapter.adapter_version,
        "snapshot_id": context.snapshot["snapshot_id"],
        "detected_languages": sorted(adapter.claimed_languages),
        "claimed_scopes": sorted(
            {str(item["source_location"]["path"]).split("/", 1)[0] for item in inventory}
        ),
        "inspected_file_count": sum(
            count
            for language, count in detect_repository_languages(
                context.repo_root, context.snapshot
            ).items()
            if language in adapter.claimed_languages
        ),
        "supported_signal_kinds": sorted(adapter.supported_signal_kinds),
        "discovered_signal_ids": [item["id"] for item in inventory],
        "rejected_findings": [
            {"locator": item.locator.replace("\\", "/"), "reason": item.reason}
            for item in result.rejected
        ],
        "unsupported_constructs": sorted(result.unsupported_constructs),
        "truncated": result.truncated,
        "status": "partial" if result.truncated or result.unsupported_constructs else "completed",
        "diagnostics": list(result.diagnostics),
    }
    return inventory, observation


def seed_candidates(inventory: list[dict[str, Any]], repository_lineage: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for signal in inventory:
        if signal.get("non_candidate_status"):
            continue
        if signal.get("classification") == "infrastructure":
            continue
        seed_signal = signal["id"]
        candidates.append(
            {
                "id": contract.candidate_id(repository_lineage, seed_signal),
                "seed_signal_id": seed_signal,
                "semantic_key": "",
                "title": signal.get("name") or seed_signal,
                "candidate_basis_signal_ids": [seed_signal],
                "candidate_status": "unresolved",
                "resolved_use_case_id": None,
                "resolved_family_id": None,
                "duplicate_of_candidate_id": None,
                "variant_of_candidate_id": None,
                "supports_candidate_id": None,
                "structural_importance": signal.get("structural_importance", "normal"),
                "business_priority": "unknown",
                "resolution_reason": "Awaiting business-semantic investigation.",
                "investigation_ids": [],
                "snapshot_id": signal["snapshot_id"],
            }
        )
    return sorted(candidates, key=lambda item: item["id"])
