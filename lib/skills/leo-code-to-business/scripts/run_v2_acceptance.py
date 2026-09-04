#!/usr/bin/env python3
"""Run mandatory real-Git and extended business-knowledge acceptance checks."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import git_business_history
import repository_snapshot
import discover_repository_signals
import render_business_site


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def _clone_bundle(bundle: Path, destination: Path) -> None:
    subprocess.run(
        ["git", "clone", "--quiet", str(bundle), str(destination)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical_result(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def extended_java_snapshot_fingerprint(snapshot: dict[str, Any]) -> str:
    payload = {
        "schema_version": snapshot.get("schema_version"),
        "git": snapshot.get("git", {}),
        "working_tree_dirty": snapshot.get("working_tree_dirty", False),
        "files": {
            path: {
                "sha256": metadata.get("sha256"),
                "size": metadata.get("size"),
            }
            for path, metadata in sorted(snapshot.get("files", {}).items())
        },
        "exclusions": snapshot.get("exclusions", []),
        "diagnostics": snapshot.get("diagnostics", []),
    }
    digest = hashlib.sha256(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return f"SNAP-{digest[:16]}"


def run_real_git_fixture(skill_dir: Path, output_dir: Path) -> dict[str, Any]:
    bundle = Path(skill_dir) / "tests" / "fixtures" / "real-git-history.bundle"
    if not bundle.is_file():
        raise FileNotFoundError(f"mandatory Git fixture is missing: {bundle}")
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        repo = Path(temp) / "fixture"
        _clone_bundle(bundle, repo)
        snapshot = repository_snapshot.capture_snapshot(repo)
        discovery = discover_repository_signals.run_discovery(repo, snapshot)
        commits = git_business_history.index_commits(repo)
        claims = [git_business_history.extract_historical_claim(commit) for commit in commits]
        facts = [
            fact
            for commit in commits
            for fact in git_business_history.extract_change_facts(repo, commit)
        ]
        events = git_business_history.group_evolution_events(commits, facts, claims, [])
        git_business_history._write_jsonl(output / "git-commits.jsonl", commits)
        git_business_history._write_jsonl(output / "historical-claims.jsonl", claims)
        git_business_history._write_jsonl(output / "git-change-facts.jsonl", facts)
        git_business_history._write_jsonl(output / "business-evolution-events.jsonl", events)
        canonical_fixture = Path(skill_dir) / "tests" / "fixtures" / "sample-revision-v2"
        canonical_copy = Path(temp) / "canonical-revision"
        shutil.copytree(canonical_fixture, canonical_copy)
        projections = render_business_site.write_projections(canonical_copy)
        validation = projections["validation"]
        if validation["status"] != "passed":
            return {
                "status": "failed",
                "errors": ["canonical Guard/projection fixture did not pass"],
            }
        fact_types = sorted({fact["fact_type"] for fact in facts})
        claim_verification = {
            claim["id"]: claim["verification_status"] for claim in claims
        }
        event_effectiveness = {
            event["id"]: event["current_effectiveness"] for event in events
        }
        return {
            "status": "passed",
            "commit_count": len(commits),
            "commits": [
                {
                    "sha": commit["sha"],
                    "parents": commit["parents"],
                    "subject": commit["subject"],
                }
                for commit in commits
            ],
            "fact_types": fact_types,
            "business_event_ids": [event["id"] for event in events],
            "reverted_event_ids": [
                event["id"] for event in events if event["current_effectiveness"] == "reverted"
            ],
            "claim_verification": claim_verification,
            "event_effectiveness": event_effectiveness,
            "repository_lineage_id": snapshot["repository_lineage_id"],
            "discovery_status": discovery["summary"]["status"],
            "language_adapter_coverage": discovery["summary"]["language_adapter_coverage"],
            "signal_count": discovery["summary"]["signal_count"],
            "canonical_revision_sha256": validation["canonical_revision_sha256"],
            "projection_sha256": {
                "ai": projections["ai"]["sha256"],
                "html": projections["html"]["sha256"],
            },
            "artifact_sha256": {
                path.name: _sha256(path)
                for path in sorted(output.glob("*.jsonl"))
            },
        }


def extended_java_surface_checks(
    inventory: list[dict[str, Any]],
    *,
    has_history_sample: bool,
) -> dict[str, bool]:
    names = [str(item.get("name", "")).casefold() for item in inventory]
    symbols = [
        str(item.get("source_location", {}).get("symbol", "")).casefold()
        for item in inventory
    ]
    paths = [str(item.get("source_location", {}).get("path", "")) for item in inventory]
    searchable = [f"{name} {symbol}" for name, symbol in zip(names, symbols)]
    calculators = {
        symbol.rsplit(".", 1)[0]
        for item, symbol in zip(inventory, symbols)
        if item.get("kind") == "calculation"
        and symbol.endswith("scorecalculator.calculate")
    }
    return {
        "work_order_creation": any("/construction/site/work-order/add" in value for value in searchable),
        "video_binding_family": any("/app/video/relate" in value for value in searchable),
        "reverse_writer": any("relink" in value or "backdoor" in path.casefold() for value, path in zip(searchable, paths)),
        "repair_path": any(item.get("kind") == "repair_entry" for item in inventory),
        "video_concat_entry": any("/3d/app/device/upload/video" in value for value in searchable),
        "video_concat_callback": any("/linjing/video/concat/callback" in value for value in searchable),
        "video_concat_process": any("contactvideobyfolder" in value for value in searchable),
        "video_concat_retry": any("retrycontactvideobyfolder" in value for value in searchable),
        "video_binding_uploaded_3d": any("uploaded3dvideorelate" in value for value in searchable),
        "linjing_scoring_orchestrator": any("triggercalculatescore" in value for value in searchable),
        "linjing_scoring_calculators": {
            "speechscorecalculator",
            "toolscorecalculator",
            "customerscorecalculator",
            "durationscorecalculator",
        }.issubset(calculators),
        "linjing_score_recalculation": any("recalculatetotalscore" in value for value in searchable),
        "stratified_history_sample": has_history_sample,
    }


def run_extended_java(repo_path: Path, commit_sha: str, output_dir: Path) -> dict[str, Any]:
    repo = Path(repo_path)
    output = Path(output_dir)
    if not repo.is_dir():
        return {
            "status": "unavailable",
            "diagnostic": "extended_java_repository_unavailable",
            "reason": f"extended Java repository unavailable: {repo}",
            "exit_code": 2,
        }
    result = subprocess.run(
        ["git", "-C", str(repo), "cat-file", "-e", f"{commit_sha}^{{commit}}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        return {
            "status": "unavailable",
            "diagnostic": "extended_java_commit_unavailable",
            "reason": f"extended Java commit unavailable: {commit_sha}",
            "exit_code": 2,
        }
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temp:
        detached = Path(temp) / "repo"
        subprocess.run(
            ["git", "clone", "--quiet", "--no-checkout", str(repo), str(detached)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        subprocess.run(
            ["git", "-C", str(detached), "checkout", "--quiet", "--detach", commit_sha],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        snapshot = repository_snapshot.capture_snapshot(detached)
        discovery = discover_repository_signals.run_discovery(detached, snapshot)
        inventory = discovery["inventory"]
        commits = git_business_history.index_commits(detached)
        sample_commits = [
            commit for commit in commits if commit["initial_classification"] == "deep_analysis_candidate"
        ][:12]
        checks = extended_java_surface_checks(
            inventory,
            has_history_sample=bool(sample_commits),
        )
        errors = [name for name, passed in checks.items() if not passed]
        result = {
            "status": "passed" if not errors else "failed",
            "exit_code": 0 if not errors else 1,
            "commit": commit_sha,
            "snapshot_id": extended_java_snapshot_fingerprint(snapshot),
            "language_adapter_coverage": discovery["summary"]["language_adapter_coverage"],
            "signal_count": len(inventory),
            "checks": checks,
            "history_sample_commit_ids": [commit["id"] for commit in sample_commits],
            "errors": errors,
        }
        (output / "extended-java-result.json").write_text(
            _canonical_result(result), encoding="utf-8"
        )
        return result


def compare_cross_model_runs(run_a: Path, run_b: Path) -> dict[str, Any]:
    left = _read_jsonl(Path(run_a) / "inventory.jsonl")
    right = _read_jsonl(Path(run_b) / "inventory.jsonl")
    left_ids = {item["id"] for item in left if item.get("structural_importance") in {"critical", "high"}}
    right_ids = {item["id"] for item in right if item.get("structural_importance") in {"critical", "high"}}
    errors = []
    missing = sorted(left_ids - right_ids)
    if missing:
        errors.append("missing critical/high candidate IDs: " + ", ".join(missing))
    inventory_difference = sorted({item["id"] for item in left} ^ {item["id"] for item in right})
    if inventory_difference:
        errors.append("inventory IDs differ: " + ", ".join(inventory_difference))
    return {
        "status": "failed" if errors else "passed",
        "errors": errors,
        "critical_high_union": sorted(left_ids | right_ids),
        "normal_low_adjudication": sorted(
            {item["id"] for item in left} ^ {item["id"] for item in right}
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    real_git = subparsers.add_parser("real-git-fixture")
    real_git.add_argument("--output", type=Path, required=True)
    extended = subparsers.add_parser("extended-java")
    extended.add_argument("--repo", type=Path, required=True)
    extended.add_argument("--commit", required=True)
    extended.add_argument("--output", type=Path, required=True)
    compare = subparsers.add_parser("compare-model-runs")
    compare.add_argument("--run-a", type=Path, required=True)
    compare.add_argument("--run-b", type=Path, required=True)
    args = parser.parse_args(argv)
    skill_dir = Path(__file__).parents[1]
    if args.command == "real-git-fixture":
        result_file = args.output
        artifact_dir = result_file.with_suffix(result_file.suffix + ".artifacts")
        result = run_real_git_fixture(skill_dir, artifact_dir)
    elif args.command == "extended-java":
        result_file = args.output
        artifact_dir = result_file.with_suffix(result_file.suffix + ".artifacts")
        result = run_extended_java(args.repo, args.commit, artifact_dir)
    else:
        result_file = None
        result = compare_cross_model_runs(args.run_a, args.run_b)
    rendered = _canonical_result(result)
    if result_file is not None:
        result_file.parent.mkdir(parents=True, exist_ok=True)
        result_file.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return int(result.get("exit_code", 0))


if __name__ == "__main__":
    raise SystemExit(main())
