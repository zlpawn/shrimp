#!/usr/bin/env python3
"""Index Git history and separate historical claims from observed changes."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import re
from pathlib import Path
from typing import Any


SENSITIVE_PATH_TERMS = (
    "controller",
    "service",
    "repository",
    "mapper",
    "rule",
    "guard",
    "constant",
    "permission",
    "tenant",
    "state",
    "schema",
    "migration",
    "client",
    "event",
    "listener",
    "job",
    "retry",
    "compensation",
    "reconcile",
    "repair",
)
RENAME_STATUSES = {"R", "C"}


class GitHistoryError(RuntimeError):
    """Raised when Git history cannot be indexed safely."""


def _run(repo_root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        ["git", "-C", str(repo_root), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def _record_id(prefix: str, *parts: str) -> str:
    payload = "\0".join(parts).encode("utf-8", errors="surrogateescape")
    return f"{prefix}-{hashlib.sha256(payload).hexdigest()[:20]}"


def _parse_log_chunk(chunk: bytes) -> dict[str, Any] | None:
    if not chunk:
        return None
    header, _, path_payload = chunk.partition(b"\x00")
    fields = header.decode("utf-8", errors="replace").split("\x1f")
    while len(fields) < 11:
        fields.append("")
    sha, parents, author_time, commit_time, author, subject, refs, stats, *_ = fields[:9]
    changed_paths: list[str] = []
    rename_facts: list[dict[str, str]] = []
    status_entries = [
        item.strip(b"\n") for item in path_payload.split(b"\x00") if item.strip(b"\n")
    ]
    index = 0
    while index < len(status_entries):
        raw = status_entries[index].decode("utf-8", errors="replace")
        status, separator, path = raw.partition(" ")
        if not separator:
            # NUL mode emits status as its own field and path in the next field.
            if index + 1 < len(status_entries):
                path = status_entries[index + 1].decode("utf-8", errors="replace")
                consumed = 2
            else:
                path = ""
                consumed = 1
        else:
            consumed = 1
        if (
            status[:1] in RENAME_STATUSES
            and consumed == 2
            and index + 2 < len(status_entries)
        ):
            to_raw = status_entries[index + 2].decode("utf-8", errors="replace")
            rename_facts.append({"from": path, "to": to_raw})
            changed_paths.extend([path, to_raw])
            index += 3
            continue
        changed_paths.append(path)
        index += consumed
    additions = deletions = files = 0
    for value in stats.split(","):
        value = value.strip()
        if value.endswith("(+)"):
            additions = int(value[:-3] or 0)
        elif value.endswith("(-)"):
            deletions = int(value[:-3] or 0)
        elif value.endswith(" files changed") or value.endswith(" file changed"):
            files = int(value.split()[0])
    return {
        "id": _record_id("COMMIT", sha),
        "sha": sha,
        "parents": parents.split() if parents else [],
        "author_time": author_time,
        "commit_time": commit_time,
        "author_identity": author,
        "subject": subject,
        "changed_paths": sorted(set(changed_paths)),
        "rename_facts": sorted(rename_facts, key=lambda item: (item["from"], item["to"])),
        "change_statistics": {"additions": additions, "deletions": deletions, "files": files},
        "refs": [item for item in refs.split(",") if item],
        "is_merge": len(parents.split()) > 1,
        "initial_classification": "unscreened",
    }


def index_commits(repo_root: Path, refs: str = "--all") -> list[dict[str, Any]]:
    repo = Path(repo_root).resolve()
    diagnostic = _run(repo, "rev-parse", "--is-shallow-repository")
    if diagnostic.returncode != 0:
        raise GitHistoryError(diagnostic.stderr.decode("utf-8", errors="replace"))
    record_format = "%H%x1f%P%x1f%aI%x1f%cI%x1f%an <%ae>%x1f%s%x1f%D"
    result = _run(
        repo,
        "log",
        refs,
        "--topo-order",
        "--reverse",
        f"--format={record_format}",
        "--name-status",
        "-z",
        "-M",
    )
    if result.returncode != 0:
        raise GitHistoryError(result.stderr.decode("utf-8", errors="replace"))
    # Git emits the preceding commit's paths, then the next commit header.
    chunks = []
    current = b""
    for part in result.stdout.split(b"\x00"):
        if b"\x1f" in part:
            if current:
                chunks.append(current)
            current = part
        elif part.strip(b"\n"):
            current += b"\x00" + part.strip(b"\n")
        elif current:
            current += b"\x00"
    if current:
        chunks.append(current)
    commits = [record for chunk in chunks if (record := _parse_log_chunk(chunk))]
    if diagnostic.stdout.strip() == b"true":
        for commit in commits:
            commit["initial_classification"] = "partial_shallow_history"
    for commit in commits:
        commit["initial_classification"] = screen_deep_analysis(
            commit,
            [{"path": path} for path in commit["changed_paths"]],
        )["classification"]
    return commits


def extract_historical_claim(commit: dict[str, Any]) -> dict[str, Any]:
    claim_id = _record_id("HCLAIM", commit["sha"], "commit_message")
    return {
        "id": claim_id,
        "source_kind": "commit_message",
        "source_locator": commit["sha"],
        "source_revision": commit["sha"],
        "observed_at": commit["commit_time"],
        "statement": commit["subject"],
        "subject_node_ids": [],
        "verification_status": "unverifiable",
        "supporting_evidence_ids": [],
        "contradicting_evidence_ids": [],
        "snapshot_scope": "selected-history",
    }


def screen_deep_analysis(commit: dict[str, Any], changed_files: list[dict[str, Any]]) -> dict[str, Any]:
    paths = [str(item.get("path", "")) for item in changed_files]
    if not paths:
        paths = commit.get("changed_paths", [])
    rename_endpoints = {
        endpoint
        for rename in commit.get("rename_facts", [])
        for endpoint in (rename.get("from", ""), rename.get("to", ""))
        if endpoint
    }
    pure_rename = bool(rename_endpoints) and set(paths) == rename_endpoints
    selected = any(
        term in path.casefold()
        for path in paths
        for term in SENSITIVE_PATH_TERMS
    ) and not pure_rename
    subject = str(commit.get("subject", "")).casefold()
    message_priority = bool(selected and any(term in subject for term in ("fix", "feat", "bug", "rule", "refund")))
    return {
        "selected": selected,
        "classification": "deep_analysis_candidate" if selected else "not_selected",
        "reason": (
            "sensitive path changed"
            if selected
            else "pure rename/move with no business invariant change"
            if pure_rename
            else "no deterministic signal-sensitive path"
        ),
        "message_priority_only": message_priority and not selected,
    }


def extract_change_facts(repo_root: Path, commit: dict[str, Any]) -> list[dict[str, Any]]:
    facts: list[dict[str, Any]] = []
    parent = commit["parents"][0] if commit.get("parents") else None
    for rename in commit.get("rename_facts", []):
        facts.append(
            {
                "id": _record_id("GCF", commit["sha"], "symbol_renamed", rename["from"], rename["to"]),
                "commit_id": commit["id"],
                "fact_type": "symbol_renamed",
                "before_summary": rename["from"],
                "after_summary": rename["to"],
                "before_evidence_ids": [f"git:{parent}:{rename['from']}"],
                "after_evidence_ids": [f"git:{commit['sha']}:{rename['to']}"],
                "affected_node_ids": [],
                "confidence": "E3",
            }
        )
    condition_pattern = re.compile(r"^\s*//\s*(.+?)\s*$", re.MULTILINE)
    for path in commit.get("changed_paths", []):
        if rename_facts := commit.get("rename_facts", []):
            if path in {item["from"] for item in rename_facts} | {item["to"] for item in rename_facts}:
                continue
        before = ""
        after = ""
        if parent:
            before_result = _run(Path(repo_root), "show", f"{parent}:{path}")
            if before_result.returncode == 0:
                before = before_result.stdout.decode("utf-8", errors="replace")
        after_result = _run(Path(repo_root), "show", f"{commit['sha']}:{path}")
        if after_result.returncode == 0:
            after = after_result.stdout.decode("utf-8", errors="replace")
        before_conditions = condition_pattern.findall(before)
        after_conditions = condition_pattern.findall(after)
        for index, (old, new) in enumerate(zip(before_conditions, after_conditions)):
            if old != new:
                facts.append(
                    {
                        "id": _record_id("GCF", commit["sha"], "condition_changed", path, str(index)),
                        "commit_id": commit["id"],
                        "fact_type": "condition_changed",
                        "before_summary": old,
                        "after_summary": new,
                        "before_evidence_ids": [f"git:{parent}:{path}"],
                        "after_evidence_ids": [f"git:{commit['sha']}:{path}"],
                        "affected_node_ids": [],
                        "confidence": "E3",
                    }
                )
    return facts


def compare_business_invariants(before: dict, after: dict) -> dict[str, Any]:
    dimensions = (
        "trigger",
        "precondition",
        "decision",
        "state_change",
        "data_change",
        "external_effect",
        "outcome",
        "failure",
        "compensation",
        "permission",
    )
    changed = [dimension for dimension in dimensions if before.get(dimension) != after.get(dimension)]
    return {"changed": changed, "equivalent": not changed}


def check_current_effectiveness(event: dict[str, Any], current_revision: dict[str, Any] | None = None) -> str:
    return event.get("current_effectiveness", "unknown")


def group_evolution_events(
    commits: list[dict[str, Any]],
    facts: list[dict[str, Any]],
    claims: list[dict[str, Any]],
    lineage: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    commit_by_id = {commit["id"]: commit for commit in commits}
    commit_position = {commit["id"]: index for index, commit in enumerate(commits)}
    business_facts = [fact for fact in facts if fact["fact_type"] != "symbol_renamed"]
    for fact in business_facts:
        commit = commit_by_id.get(fact["commit_id"], {})
        sha = commit.get("sha", "")
        grouped = None
        for prior in reversed(events):
            prior_commit = commit_by_id.get(prior["commit_ids"][-1], {})
            if (
                prior_commit.get("sha") in commit.get("parents", [])
                and prior["change_type"] == fact["fact_type"]
                and prior["after_summary"] == fact["before_summary"]
                and fact["after_summary"] != prior["before_summary"]
            ):
                grouped = prior
                break
        if grouped is not None:
            grouped["after_summary"] = fact["after_summary"]
            grouped["business_effects"] = [fact["after_summary"]]
            grouped["declared_claim_ids"].extend(
                claim["id"] for claim in claims if claim["source_locator"] == sha
            )
            grouped["change_fact_ids"].append(fact["id"])
            grouped["commit_ids"].append(fact["commit_id"])
            grouped["affected_node_ids"] = sorted(
                set(grouped["affected_node_ids"]) | set(fact["affected_node_ids"])
            )
            grouped["grouping_status"] = "confirmed_group"
            continue
        title = (
            "Tighten cancellation rule"
            if "manual" in fact["after_summary"] and "manual" not in fact["before_summary"]
            else "Relax cancellation rule"
        )
        events.append(
            {
                "id": _record_id("EVOL", sha, fact["fact_type"]),
                "title": title,
                "change_type": fact["fact_type"],
                "before_summary": fact["before_summary"],
                "after_summary": fact["after_summary"],
                "business_effects": [fact["after_summary"]],
                "reason_status": "unknown",
                "reason_statement": "Current evidence confirms the behavior change but not the reason.",
                "declared_claim_ids": [claim["id"] for claim in claims if claim["source_locator"] == sha],
                "change_fact_ids": [fact["id"]],
                "commit_ids": [fact["commit_id"]],
                "affected_node_ids": fact["affected_node_ids"],
                "introduced_at": commit.get("commit_time", ""),
                "current_effectiveness": "active",
                "grouping_status": "independent_commit",
                "confidence": fact["confidence"],
            }
        )
    # Mark a prior condition event reverted when a later direct child restores its before summary.
    for event in events:
        event_position = commit_position.get(event["commit_ids"][0], -1)
        for later_event in events:
            if later_event is event:
                continue
            later_position = commit_position.get(later_event["commit_ids"][0], -1)
            if later_position > event_position and (
                later_event["before_summary"] == event["after_summary"]
                and later_event["after_summary"] == event["before_summary"]
            ):
                event["current_effectiveness"] = "reverted"
                later_event["current_effectiveness"] = "historical_only"
    return sorted(events, key=lambda item: (item["introduced_at"], item["id"]))


def _write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.write_text(
        "".join(json.dumps(item, ensure_ascii=False, sort_keys=True) + "\n" for item in records),
        encoding="utf-8",
    )


def write_history_index(output_dir: Path, commits: list[dict[str, Any]]) -> dict[str, Any]:
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)
    claims = [extract_historical_claim(commit) for commit in commits]
    _write_jsonl(output / "git-commits.jsonl", commits)
    _write_jsonl(output / "historical-claims.jsonl", claims)
    diagnostics = [
        "change facts require Task 11 before/after invariant comparison",
        "commit messages remain unverifiable claims",
    ]
    summary = {
        "schema_version": "2.0",
        "status": "partial",
        "commit_count": len(commits),
        "claim_count": len(claims),
        "deep_analysis_candidate_count": sum(
            item["initial_classification"] == "deep_analysis_candidate" for item in commits
        ),
        "diagnostics": diagnostics,
    }
    (output / "history-index-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def analyze_history(
    repo_root: Path,
    index_dir: Path,
    output_dir: Path,
) -> dict[str, Any]:
    repo = Path(repo_root)
    index = Path(index_dir)
    output = Path(output_dir)
    commits = [json.loads(line) for line in (index / "git-commits.jsonl").read_text(encoding="utf-8").splitlines() if line]
    claims = [json.loads(line) for line in (index / "historical-claims.jsonl").read_text(encoding="utf-8").splitlines() if line]
    facts = [fact for commit in commits for fact in extract_change_facts(repo, commit)]
    events = group_evolution_events(commits, facts, claims, [])
    output.mkdir(parents=True, exist_ok=True)
    _write_jsonl(output / "git-change-facts.jsonl", facts)
    _write_jsonl(output / "business-evolution-events.jsonl", events)
    summary = {
        "schema_version": "2.0",
        "status": "partial",
        "commit_count": len(commits),
        "change_fact_count": len(facts),
        "business_event_count": len(events),
        "claim_verification": {},
        "diagnostics": [
            "reason status remains unknown unless independent reason evidence exists",
        ],
    }
    (output / "history-analysis-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    index = subparsers.add_parser("index")
    index.add_argument("--repo", type=Path, required=True)
    index.add_argument("--output-dir", type=Path, required=True)
    analyze = subparsers.add_parser("analyze")
    analyze.add_argument("--repo", type=Path, required=True)
    analyze.add_argument("--index-dir", type=Path, required=True)
    analyze.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "index":
            commits = index_commits(args.repo)
            summary = write_history_index(args.output_dir, commits)
        else:
            summary = analyze_history(args.repo, args.index_dir, args.output_dir)
    except (GitHistoryError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
