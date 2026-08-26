#!/usr/bin/env python3
"""Index Git history and separate historical claims from observed changes."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
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
    """Task 11 adds invariant-based facts; claims alone never produce facts."""
    return []


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    index = subparsers.add_parser("index")
    index.add_argument("--repo", type=Path, required=True)
    index.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        commits = index_commits(args.repo)
        summary = write_history_index(args.output_dir, commits)
    except (GitHistoryError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
