#!/usr/bin/env python3
"""Capture and compare immutable repository evidence snapshots."""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import hashlib
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import business_contract as contract


SCHEMA_VERSION = "1.0"
DEFAULT_EXCLUSIONS = [
    ".git/**",
    "_leo_business/**",
]


class SnapshotError(Exception):
    """Raised when a repository snapshot cannot be captured safely."""


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def canonical_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_git(repo_root: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(
        ["git", "-C", str(repo_root), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise SnapshotError(f"git {' '.join(args)} failed: {message}")
    return result.stdout.decode("utf-8", errors="surrogateescape").strip()


def is_git_repository(repo_root: Path) -> bool:
    return run_git(
        repo_root,
        "rev-parse",
        "--is-inside-work-tree",
        check=False,
    ) == "true"


def git_metadata(repo_root: Path) -> dict[str, Any]:
    if not is_git_repository(repo_root):
        return {
            "is_repository": False,
            "branch": None,
            "head_sha": None,
            "base_sha": None,
            "root_commit_shas": [],
            "is_detached": False,
            "status_porcelain": [],
        }

    head = run_git(repo_root, "rev-parse", "HEAD")
    root_commit_shas = sorted(
        line
        for line in run_git(
            repo_root,
            "rev-list",
            "--max-parents=0",
            "--all",
        ).splitlines()
        if line
    )
    branch = run_git(repo_root, "symbolic-ref", "--short", "-q", "HEAD", check=False)
    upstream = run_git(
        repo_root,
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
        check=False,
    )
    base_sha = head
    if upstream:
        candidate = run_git(repo_root, "merge-base", "HEAD", upstream, check=False)
        if candidate:
            base_sha = candidate

    raw_status = subprocess.run(
        ["git", "-C", str(repo_root), "status", "--porcelain=v1", "-z", "--untracked-files=all"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if raw_status.returncode != 0:
        message = raw_status.stderr.decode("utf-8", errors="replace").strip()
        raise SnapshotError(f"git status failed: {message}")
    entries = [
        item.decode("utf-8", errors="surrogateescape")
        for item in raw_status.stdout.split(b"\0")
        if item
    ]
    return {
        "is_repository": True,
        "branch": branch or None,
        "head_sha": head,
        "base_sha": base_sha,
        "root_commit_shas": root_commit_shas,
        "is_detached": not bool(branch),
        "status_porcelain": entries,
    }


def normalized_exclusions(exclusions: list[str] | None) -> list[str]:
    result: list[str] = []
    for pattern in [*DEFAULT_EXCLUSIONS, *(exclusions or [])]:
        cleaned = str(pattern).strip().replace("\\", "/")
        if cleaned and cleaned not in result:
            result.append(cleaned)
    return result


def is_excluded(relative_path: str, exclusions: list[str]) -> bool:
    path = relative_path.replace("\\", "/")
    for pattern in exclusions:
        plain = pattern[:-3] if pattern.endswith("/**") else pattern
        if path == plain or path.startswith(f"{plain}/"):
            return True
        if fnmatch.fnmatchcase(path, pattern):
            return True
    return False


def iter_repository_files(
    repo_root: Path,
    exclusions: list[str],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, str]]]:
    files: dict[str, dict[str, Any]] = {}
    diagnostics: list[dict[str, str]] = []
    root_resolved = repo_root.resolve()

    for directory, dirnames, filenames in os.walk(repo_root, topdown=True, followlinks=False):
        current = Path(directory)
        retained_dirs: list[str] = []
        for name in sorted(dirnames):
            candidate = current / name
            relative = candidate.relative_to(repo_root).as_posix()
            if is_excluded(relative, exclusions):
                continue
            if candidate.is_symlink():
                diagnostics.append({"path": relative, "reason": "symlink_directory_skipped"})
                continue
            retained_dirs.append(name)
        dirnames[:] = retained_dirs

        for name in sorted(filenames):
            candidate = current / name
            relative = candidate.relative_to(repo_root).as_posix()
            if is_excluded(relative, exclusions):
                continue
            try:
                if candidate.is_symlink():
                    target = candidate.resolve(strict=False)
                    try:
                        target.relative_to(root_resolved)
                    except ValueError:
                        diagnostics.append(
                            {"path": relative, "reason": "escaping_symlink_skipped"}
                        )
                        continue
                    diagnostics.append({"path": relative, "reason": "symlink_file_skipped"})
                    continue
                if not candidate.is_file():
                    continue
                stat = candidate.stat()
                files[relative] = {
                    "sha256": sha256_file(candidate),
                    "size": stat.st_size,
                    "mtime_ns": stat.st_mtime_ns,
                }
            except OSError as exc:
                diagnostics.append(
                    {"path": relative, "reason": f"unreadable:{exc.__class__.__name__}"}
                )
    return dict(sorted(files.items())), diagnostics


def semantic_snapshot_payload(snapshot: dict[str, Any]) -> dict[str, Any]:
    files = {
        path: {
            "sha256": metadata["sha256"],
            "size": metadata["size"],
        }
        for path, metadata in sorted(snapshot["files"].items())
    }
    return {
        "schema_version": snapshot["schema_version"],
        "canonical_root": snapshot["canonical_root"],
        "git": snapshot["git"],
        "working_tree_dirty": snapshot["working_tree_dirty"],
        "files": files,
        "exclusions": snapshot["exclusions"],
        "diagnostics": snapshot["diagnostics"],
    }


def capture_snapshot(
    repo_root: Path | str,
    exclusions: list[str] | None = None,
) -> dict[str, Any]:
    root = Path(repo_root).expanduser().resolve()
    if not root.is_dir():
        raise SnapshotError(f"repository root is not a directory: {root}")

    exclusion_patterns = normalized_exclusions(exclusions)
    git = git_metadata(root)
    files, diagnostics = iter_repository_files(root, exclusion_patterns)
    lineage_file_map = {
        path: {"sha256": metadata["sha256"], "size": metadata["size"]}
        for path, metadata in files.items()
    }
    lineage_id = contract.repository_lineage_id(
        git["root_commit_shas"],
        lineage_file_map,
    )
    snapshot: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "snapshot_id": "",
        "captured_at": now_utc(),
        "repository_root": str(Path(repo_root).expanduser()),
        "canonical_root": str(root),
        "git": git,
        "repository_lineage_id": lineage_id,
        "working_tree_dirty": bool(git["status_porcelain"]),
        "files": files,
        "exclusions": exclusion_patterns,
        "diagnostics": diagnostics,
        "snapshot_sha256": "",
    }
    digest = sha256_bytes(canonical_json(semantic_snapshot_payload(snapshot)))
    snapshot["snapshot_sha256"] = digest
    snapshot["snapshot_id"] = f"SNAP-{digest[:16]}"
    return snapshot


def load_snapshot(path: Path | str) -> dict[str, Any]:
    try:
        value = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SnapshotError(f"cannot read snapshot {path}: {exc}") from exc
    if not isinstance(value, dict) or value.get("schema_version") != SCHEMA_VERSION:
        raise SnapshotError(f"invalid snapshot: {path}")
    return value


def compare_snapshot(
    before: dict[str, Any],
    after: dict[str, Any],
) -> dict[str, Any]:
    before_files = before.get("files", {})
    after_files = after.get("files", {})
    before_paths = set(before_files)
    after_paths = set(after_files)
    added = sorted(after_paths - before_paths)
    deleted = sorted(before_paths - after_paths)
    modified = sorted(
        path
        for path in before_paths & after_paths
        if before_files[path].get("sha256") != after_files[path].get("sha256")
        or before_files[path].get("size") != after_files[path].get("size")
    )
    deleted_by_content: dict[tuple[str | None, int | None], list[str]] = {}
    added_by_content: dict[tuple[str | None, int | None], list[str]] = {}
    for path in deleted:
        metadata = before_files[path]
        key = (metadata.get("sha256"), metadata.get("size"))
        deleted_by_content.setdefault(key, []).append(path)
    for path in added:
        metadata = after_files[path]
        key = (metadata.get("sha256"), metadata.get("size"))
        added_by_content.setdefault(key, []).append(path)

    renamed: list[dict[str, str]] = []
    renamed_from: set[str] = set()
    renamed_to: set[str] = set()
    for key in sorted(deleted_by_content, key=str):
        old_paths = sorted(deleted_by_content[key])
        new_paths = sorted(added_by_content.get(key, []))
        if len(old_paths) != 1 or len(new_paths) != 1:
            continue
        renamed.append({"from": old_paths[0], "to": new_paths[0]})
        renamed_from.add(old_paths[0])
        renamed_to.add(new_paths[0])

    added = [path for path in added if path not in renamed_to]
    deleted = [path for path in deleted if path not in renamed_from]
    changed_paths = sorted(
        {
            *added,
            *modified,
            *deleted,
            *(item["from"] for item in renamed),
            *(item["to"] for item in renamed),
        }
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "before_snapshot": before.get("snapshot_id"),
        "after_snapshot": after.get("snapshot_id"),
        "repository_changed": before.get("snapshot_sha256")
        != after.get("snapshot_sha256"),
        "git_head_changed": before.get("git", {}).get("head_sha")
        != after.get("git", {}).get("head_sha"),
        "repository_lineage_changed": before.get("repository_lineage_id")
        != after.get("repository_lineage_id"),
        "working_tree_dirty": after.get("working_tree_dirty", False),
        "added": added,
        "modified": modified,
        "deleted": deleted,
        "renamed": renamed,
        "changed_paths": changed_paths,
        "changed_count": len(added) + len(modified) + len(deleted) + len(renamed),
    }


def write_json_atomic(path: Path | str, value: dict[str, Any]) -> None:
    target = Path(path).expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(f".{target.name}.{uuid.uuid4().hex}.partial")
    partial.write_text(
        json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(partial, target)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    capture = subparsers.add_parser("capture", help="capture a repository snapshot")
    capture.add_argument("--repo", required=True)
    capture.add_argument("--output", required=True)
    capture.add_argument("--exclude", action="append", default=[])

    compare = subparsers.add_parser("compare", help="compare a prior snapshot")
    compare.add_argument("--before", required=True)
    compare.add_argument("--repo", required=True)
    compare.add_argument("--output", required=True)
    compare.add_argument("--exclude", action="append", default=[])
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "capture":
            result = capture_snapshot(args.repo, args.exclude)
        else:
            before = load_snapshot(args.before)
            current_exclusions = args.exclude or before.get("exclusions", [])
            after = capture_snapshot(args.repo, current_exclusions)
            result = compare_snapshot(before, after)
            result["current_snapshot"] = after
        write_json_atomic(args.output, result)
    except SnapshotError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
