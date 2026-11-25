# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
from __future__ import annotations
"""
Cross-platform Git Diff & Untracked Files Extractor for leo-code-review.
Standardized extraction for staged, unstaged, branch differences and untracked files.
Complies with Windows and macOS without external dependencies.
"""

import argparse
import subprocess
import sys
from pathlib import Path


def run_git(args: list[str], cwd: Path | None = None) -> tuple[int, str]:
    try:
        res = subprocess.run(
            ["git", *args],
            cwd=cwd or Path.cwd(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        return res.returncode, res.stdout.strip()
    except Exception as e:
        return 1, f"Git command failed: {e}"


def get_default_branch(repo_root: Path) -> str:
    # Try detecting default remote branch or common branch names
    code, out = run_git(["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], repo_root)
    if code == 0 and out:
        return out.replace("origin/", "")
    for candidate in ["main", "master", "dev", "develop"]:
        code, _ = run_git(["rev-parse", "--verify", candidate], repo_root)
        if code == 0:
            return candidate
    return "main"


def get_untracked_files(repo_root: Path) -> list[str]:
    code, out = run_git(["status", "--porcelain", "-uall"], repo_root)
    if code != 0 or not out:
        return []
    untracked = []
    for line in out.splitlines():
        if line.startswith("?? "):
            untracked.append(line[3:].strip())
    return untracked


def extract_diff(mode: str = "auto", repo_root: Path | None = None) -> dict:
    root = repo_root or Path.cwd()
    code, toplevel = run_git(["rev-parse", "--show-toplevel"], root)
    if code != 0:
        return {"error": "Not a git repository."}
    root = Path(toplevel)

    untracked_files = get_untracked_files(root)
    staged_code, staged_diff = run_git(["diff", "--cached"], root)
    unstaged_code, unstaged_diff = run_git(["diff"], root)

    diff_mode_used = "working_tree"
    combined_diff = ""

    if mode == "staged":
        combined_diff = staged_diff
        diff_mode_used = "staged_only"
    elif mode == "branch":
        base_branch = get_default_branch(root)
        _, branch_diff = run_git(["diff", f"{base_branch}...HEAD"], root)
        combined_diff = branch_diff
        diff_mode_used = f"branch_against_{base_branch}"
    else:  # auto
        if staged_diff or unstaged_diff:
            # Check combined HEAD diff
            _, head_diff = run_git(["diff", "HEAD"], root)
            combined_diff = head_diff if head_diff else f"{staged_diff}\n{unstaged_diff}".strip()
            diff_mode_used = "working_tree_changes"
        else:
            # Fallback to branch diff
            base_branch = get_default_branch(root)
            _, branch_diff = run_git(["diff", f"{base_branch}...HEAD"], root)
            if branch_diff:
                combined_diff = branch_diff
                diff_mode_used = f"clean_workspace_fallback_to_{base_branch}"
            else:
                diff_mode_used = "clean_no_diff"

    # Read untracked files (up to reasonable size limit per file, e.g. 50KB)
    untracked_contents = {}
    for rel_path in untracked_files:
        p = root / rel_path
        if p.is_file() and p.stat().st_size < 50 * 1024:
            try:
                untracked_contents[rel_path] = p.read_text(encoding="utf-8", errors="replace")
            except Exception:
                pass

    return {
        "repo_root": str(root),
        "mode_used": diff_mode_used,
        "diff": combined_diff,
        "has_diff": bool(combined_diff.strip()),
        "untracked_files": untracked_files,
        "untracked_contents": untracked_contents,
    }


def main():
    parser = argparse.ArgumentParser(description="Extract git diff and untracked files for code review.")
    parser.add_argument("--mode", choices=["auto", "staged", "branch"], default="auto", help="Diff extraction mode")
    parser.add_argument("--summary", action="store_true", help="Print summary only")
    args = parser.parse_args()

    result = extract_diff(args.mode)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)

    print(f"=== GIT REVIEW TARGET: {result['mode_used']} ===")
    print(f"Untracked files: {len(result['untracked_files'])}")
    if result["untracked_files"]:
        for f in result["untracked_files"]:
            print(f"  + [Untracked] {f}")

    if args.summary:
        line_count = len(result["diff"].splitlines())
        print(f"Diff lines: {line_count}")
        return

    print("\n=== UNTRACKED FILES CONTENT ===")
    for f, content in result["untracked_contents"].items():
        print(f"\n--- FILE: {f} ---")
        print(content)

    print("\n=== UNIFIED DIFF ===")
    print(result["diff"])


if __name__ == "__main__":
    main()
