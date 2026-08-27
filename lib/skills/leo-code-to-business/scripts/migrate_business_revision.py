#!/usr/bin/env python3
"""Migrate immutable v1 business revisions into partial v2 staging runs."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_contract as contract
import business_knowledge_guard as guard
import render_business_site as renderer


class MigrationError(RuntimeError):
    """Raised when migration cannot preserve a complete revision."""


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return guard.read_jsonl(path)


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in records),
        encoding="utf-8",
    )


def detect_revision_schema(revision_dir: Path) -> str:
    root = Path(revision_dir)
    manifest_path = root / "manifest.json"
    if not manifest_path.is_file():
        raise MigrationError("manifest is missing")
    try:
        manifest = guard.read_json(manifest_path)
    except guard.ValidationError as exc:
        raise MigrationError(f"not a complete v1 revision: {exc}") from exc
    version = manifest.get("schema_version")
    if version == contract.V2_SCHEMA_VERSION:
        return contract.V2_SCHEMA_VERSION
    if version == contract.V1_SCHEMA_VERSION:
        return contract.V1_SCHEMA_VERSION
    if version is None:
        required_v1 = [
            "manifest.json",
            "ai-context.md",
            "site/index.html",
            "semantic-review.json",
            *contract.V1_CANONICAL_FILES,
        ]
        missing = [name for name in required_v1 if not (root / name).is_file()]
        if missing:
            raise MigrationError(
                "not a complete v1 revision: missing " + ", ".join(missing)
            )
        return contract.V1_SCHEMA_VERSION
    raise MigrationError(f"unsupported revision schema: {version}")


def build_legacy_signal_aliases(
    legacy_inventory: list[dict[str, Any]],
    current_v2_inventory: list[dict[str, Any]],
) -> list[dict[str, str]]:
    def key(record: dict[str, Any]) -> tuple[str, str]:
        location = record.get("source_location", {})
        return (
            str(location.get("path", "")),
            str(location.get("symbol", "")),
            str(record.get("kind", "")),
        )

    current_by_key = {key(record): record for record in current_v2_inventory if record.get("id_scheme") == "v2"}
    aliases = []
    for legacy in legacy_inventory:
        current = current_by_key.get(key(legacy))
        if current:
            aliases.append(
                {
                    "legacy_inventory_id": legacy["id"],
                    "v2_signal_id": current["id"],
                    "match_basis": "canonical_locator_and_kind",
                }
            )
    return sorted(aliases, key=lambda item: (item["legacy_inventory_id"], item["v2_signal_id"]))


def migrate_v1_to_v2(source_revision: Path, target_run: Path) -> Path:
    source = Path(source_revision)
    target = Path(target_run)
    if detect_revision_schema(source) != contract.V1_SCHEMA_VERSION:
        raise MigrationError("source revision is not schema version 1.0")
    if target.exists():
        raise MigrationError(f"target run already exists: {target}")
    target.mkdir(parents=True)
    shutil.copytree(source, target, dirs_exist_ok=True)
    source_manifest = guard.read_json(source / "manifest.json")
    source_hash = source_manifest.get("canonical_revision_sha256")

    inventory = _read_jsonl(target / "inventory.jsonl")
    for record in inventory:
        record["id_scheme"] = "legacy_v1"
        record["migrated_from_revision"] = source_hash
    _write_jsonl(target / "inventory.jsonl", inventory)

    observation = {
        "id": "OBS-legacy-v1-import",
        "adapter_id": "legacy-v1",
        "adapter_version": "1.0",
        "snapshot_id": source_manifest.get("repository_snapshot", {}).get("snapshot_id", "unknown"),
        "detected_languages": [],
        "claimed_scopes": ["legacy-inventory"],
        "inspected_file_count": 0,
        "supported_signal_kinds": ["legacy_inventory"],
        "discovered_signal_ids": [record["id"] for record in inventory],
        "rejected_findings": [],
        "unsupported_constructs": [],
        "truncated": False,
        "status": "partial",
        "diagnostics": ["imported legacy inventory; current v2 discovery required"],
    }
    _write_jsonl(target / "discovery-observations.jsonl", [observation])
    investigations = _read_jsonl(target / "investigations.jsonl")
    migration_candidate = {
        "id": "UCC-legacy-v1-discovery",
        "seed_signal_id": inventory[0]["id"] if inventory else "",
        "semantic_key": "legacy-v1-discovery",
        "title": "Legacy inventory migration review",
        "candidate_basis_signal_ids": [record["id"] for record in inventory],
        "candidate_status": "unresolved",
        "structural_importance": "low",
        "business_priority": "unknown",
        "resolution_reason": "v2 discovery required",
        "investigation_ids": [record["id"] for record in investigations],
        "snapshot_id": observation["snapshot_id"],
        "migrated_from_revision": source_hash,
    }
    _write_jsonl(target / "use-case-candidates.jsonl", [migration_candidate])
    families = guard.read_json(target / "use-case-families.json")
    for family in families:
        family.setdefault(
            "closure_matrix",
            {
                "create": {
                    "web": {
                        "status": "unresolved",
                        "reason": "v2 family closure discovery required",
                    }
                }
            },
        )
    guard.write_json_atomic(target / "use-case-families.json", families)
    _write_jsonl(target / "legacy-signal-aliases.jsonl", [])
    _write_jsonl(target / "git-commits.jsonl", [])
    _write_jsonl(target / "git-change-facts.jsonl", [])
    _write_jsonl(target / "historical-claims.jsonl", [])
    _write_jsonl(target / "business-evolution-events.jsonl", [])
    _write_jsonl(target / "lineage-links.jsonl", [])
    guard.write_json_atomic(
        target / "change-impact.json",
        {"schema_version": "2.0", "semantic_inputs": {}, "validation_results": {}},
    )
    guard.write_json_atomic(
        target / "coverage.json",
        {
            "schema_version": "2.0",
            "current_coverage_status": "partial",
            "history_coverage_status": "not_requested",
            "aggregate_status": "partial",
            "metrics": {},
            "migration_gaps": ["v2 discovery required"],
        },
    )
    guard.write_json_atomic(
        target / "omission-audit.json",
        {
            "schema_version": "2.0",
            "canonical_revision_sha256": None,
            "reviewer_mode": "independent",
            "findings": [],
            "status": "partial",
        },
    )
    (target / "ai-context.md").write_text("Migration staging projection\n", encoding="utf-8")
    (target / "site-view-model.json").write_text("{}\n", encoding="utf-8")
    (target / "site").mkdir(exist_ok=True)
    (target / "site" / "index.html").write_text(
        "<!doctype html><html><body>Migration staging</body></html>\n",
        encoding="utf-8",
    )

    manifest = source_manifest
    manifest.update(
        {
            "schema_version": contract.V2_SCHEMA_VERSION,
            "run_id": f"RUN-migrated-{(source_hash or 'unknown')[:12]}",
            "status": "partial",
            "repository_lineage_id": source_manifest.get("repository_lineage_id", "REPO-unknown"),
            "current_coverage_status": "partial",
            "history_coverage_status": "not_requested",
            "aggregate_status": "partial",
            "coverage_status": "partial",
            "canonical_revision_sha256": None,
            "projection_hashes": {},
            "migrated_from_revision": source_hash,
        }
    )
    guard.write_json_atomic(target / "manifest.json", manifest)
    renderer.write_projections(target)
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target-run", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        target = migrate_v1_to_v2(args.source, args.target_run)
    except (MigrationError, guard.ValidationError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(str(target))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
