#!/usr/bin/env python3
"""Discover repository signals through registered language adapters."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from discovery import core


def default_adapters() -> list[core.DiscoveryAdapter]:
    adapters: list[core.DiscoveryAdapter] = []
    try:
        from discovery.java_spring import JavaSpringAdapter

        adapters.append(JavaSpringAdapter())
    except ImportError:
        pass
    try:
        from discovery.node_typescript import NodeTypeScriptAdapter

        adapters.append(NodeTypeScriptAdapter())
    except ImportError:
        pass
    return adapters


def run_discovery(
    repo_root: Path,
    snapshot: dict[str, Any],
    *,
    adapters: list[core.DiscoveryAdapter] | None = None,
) -> dict[str, Any]:
    root = Path(repo_root).resolve()
    selected = list(default_adapters() if adapters is None else adapters)
    detected = core.detect_repository_languages(root, snapshot)
    context = core.DiscoveryContext(
        repo_root=root,
        snapshot=snapshot,
        repository_lineage_id=snapshot["repository_lineage_id"],
    )
    inventory: list[dict[str, Any]] = []
    observations: list[dict[str, Any]] = []
    coverage: dict[str, str] = {}
    for language in detected:
        coverage[language] = (
            "covered"
            if any(language in adapter.claimed_languages for adapter in selected)
            else "unsupported"
        )
    for adapter in selected:
        if not (set(detected) & adapter.claimed_languages):
            continue
        records, observation = core.normalize_adapter_result(
            adapter.discover(context), context, adapter=adapter
        )
        inventory.extend(records)
        observations.append(observation)

    by_id: dict[str, dict[str, Any]] = {}
    for signal in inventory:
        existing = by_id.get(signal["id"])
        if existing is None:
            by_id[signal["id"]] = signal
            continue
        if existing["source_location"] != signal["source_location"]:
            raise ValueError(f"conflicting normalized signal {signal['id']}")
        existing["discovered_by"] = sorted(
            set(existing["discovered_by"]) | set(signal["discovered_by"])
        )
    inventory = sorted(by_id.values(), key=lambda item: item["id"])
    candidates = core.seed_candidates(inventory, context.repository_lineage_id)
    unsupported = [language for language, status in coverage.items() if status == "unsupported"]
    partial_observations = [item["id"] for item in observations if item["status"] != "completed"]
    status = "partial" if unsupported or partial_observations else "passed"
    return {
        "inventory": inventory,
        "observations": sorted(observations, key=lambda item: item["id"]),
        "candidates": candidates,
        "summary": {
            "schema_version": "2.0",
            "status": status,
            "snapshot_id": snapshot["snapshot_id"],
            "repository_lineage_id": context.repository_lineage_id,
            "detected_languages": detected,
            "language_adapter_coverage": coverage,
            "signal_count": len(inventory),
            "candidate_count": len(candidates),
            "unsupported_languages": unsupported,
            "partial_observation_ids": partial_observations,
        },
    }


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in records),
        encoding="utf-8",
    )


def main(
    argv: list[str] | None = None,
    *,
    adapters: list[core.DiscoveryAdapter] | None = None,
) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--snapshot", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    result = run_discovery(args.repo, snapshot, adapters=adapters)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    _write_jsonl(args.output_dir / "inventory.jsonl", result["inventory"])
    _write_jsonl(
        args.output_dir / "discovery-observations.jsonl", result["observations"]
    )
    _write_jsonl(args.output_dir / "use-case-candidates.jsonl", result["candidates"])
    (args.output_dir / "discovery-summary.json").write_text(
        json.dumps(result["summary"], ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
