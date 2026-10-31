#!/usr/bin/env python3
"""Locate leo-video-router downstream projects and remember user-chosen directories.

Usage:
  registry.py locate <project>
  registry.py register <project> <dir> [--source user|install]
  registry.py list
Exit codes: 0 ok, 1 not found, 2 directory is not that project, 3 registry.json is corrupt.
"""
import argparse, json, os, re, sys, tempfile
from datetime import date
from pathlib import Path

# skill: directory name after `npx skills add -g` (= SKILL.md frontmatter name); None = source-only project.
# entries: candidate entry files, relative to a project directory, checked in order.
PROJECTS = {
    "MoneyPrinterTurbo": {"skill": "moneyprinterturbo-video", "entries": ["SKILL.md", "docs/skill/SKILL.md"]},
    "OpenMontage": {"skill": None, "entries": ["AGENT_GUIDE.md"], "header": "# OpenMontage"},
    "hypit": {"skill": "hypit", "entries": ["SKILL.md", "skills/hypit/SKILL.md"]},
    "lemo-opuscar": {"skill": "lemo-opuscar", "entries": ["SKILL.md", "plugin/skills/lemo-opuscar/SKILL.md"]},
    "xilo-opus-video": {"skill": "xilo-opus-video", "entries": ["SKILL.md", "skills/xilo-opus-video/SKILL.md"]},
    "dashi-animationstyle": {"skill": "dashi-animationstyle", "entries": ["SKILL.md"]},
    "huashu-art-motion": {"skill": "huashu-art-motion", "entries": ["SKILL.md"]},
    "video-shotcraft": {"skill": "video-shotcraft", "entries": ["SKILL.md"]},
}
SKILL_DIRS = [".agents/skills", ".claude/skills", ".codex/skills", ".gemini/config/skills"]
WORKSPACE_DIRS = ["lib/skills", ".agents/skills"]


class RegistryError(Exception):
    """registry.json exists but cannot be read; never overwrite it."""


def data_dir(home: Path) -> Path:
    return Path(os.environ.get("LEO_VIDEO_ROUTER_HOME") or home / ".shrimp/skills/leo-video-router")


def registry_file(home: Path) -> Path:
    return data_dir(home) / "registry.json"


def load(home: Path) -> dict:
    f = registry_file(home)
    if not f.exists():
        return {"version": 1, "projects": {}}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
    except ValueError as e:  # includes UnicodeDecodeError
        raise RegistryError(f"{f} is corrupt ({e}); fix or delete it") from e
    projects = data.get("projects") if isinstance(data, dict) else None
    if not isinstance(projects, dict) or not all(
            isinstance(r, dict) and isinstance(r.get("path"), str) for r in projects.values()):
        raise RegistryError(f"{f} is corrupt (unexpected structure); fix or delete it")
    return data


def save(home: Path, data: dict) -> None:
    f = registry_file(home)
    f.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=f.parent, prefix=".registry-", suffix=".tmp")
    try:  # atomic: a crash mid-write never leaves a truncated registry.json
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        os.replace(tmp, f)
    except BaseException:
        os.unlink(tmp)
        raise


def is_entry(name: str, f: Path) -> bool:
    """The file exists and belongs to this project (not just any SKILL.md)."""
    if not f.is_file():
        return False
    text = f.read_text(encoding="utf-8", errors="ignore")
    p = PROJECTS[name]
    if not p["skill"]:
        return text.startswith(p["header"])
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return False  # no frontmatter
    for line in lines[1:]:  # only the leading frontmatter block counts
        if line.strip() == "---":
            return False
        if re.fullmatch(rf"name:\s*{re.escape(p['skill'])}\s*", line):
            return True
    return False


def entry_in(name: str, path: Path):
    for rel in PROJECTS[name]["entries"]:
        if is_entry(name, path / rel):
            return path / rel
    return None


def candidates(name: str, home: Path, cwd: Path):
    skill = PROJECTS[name]["skill"]
    if skill:
        for d in SKILL_DIRS:
            yield "skills-dir", home / d / skill
    yield "default-dir", home / ".shrimp/skills" / name
    for d in WORKSPACE_DIRS:
        yield "workspace", cwd / d / (skill or name)


def hit(name: str, path: Path, entry: Path, via: str) -> dict:
    return {"name": name, "path": str(path), "entry": str(entry), "entry_dir": str(entry.parent), "via": via}


def locate(name: str, home: Path, cwd: Path):
    if name not in PROJECTS:
        raise KeyError(name)
    data = load(home)
    rec = data["projects"].get(name)
    if rec:
        entry = entry_in(name, Path(rec["path"]))
        if entry:
            return hit(name, Path(rec["path"]), entry, "registry")
        del data["projects"][name]  # stale: directory moved or deleted
        save(home, data)
    for via, path in candidates(name, home, cwd):
        entry = entry_in(name, path)
        if entry:
            return hit(name, path, entry, via)
    return None


def register(name: str, path, source: str, home: Path) -> dict:
    if name not in PROJECTS:
        raise KeyError(name)
    path = Path(path).expanduser().resolve()
    if not entry_in(name, path):
        raise ValueError(f"{path} is not {name}: none of {PROJECTS[name]['entries']} belongs to it")
    data = load(home)
    data["projects"][name] = {"path": str(path), "source": source, "added": date.today().isoformat()}
    save(home, data)
    return data["projects"][name]


def out(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False))


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="leo-video-router project registry")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("locate").add_argument("name", choices=sorted(PROJECTS))
    r = sub.add_parser("register")
    r.add_argument("name", choices=sorted(PROJECTS))
    r.add_argument("path")
    r.add_argument("--source", choices=["user", "install"], default="user")
    sub.add_parser("list")
    a = p.parse_args(argv)
    home, cwd = Path.home(), Path.cwd()
    try:
        if a.cmd == "locate":
            found = locate(a.name, home, cwd)
            out(found or {"name": a.name, "found": False})
            return 0 if found else 1
        if a.cmd == "register":
            try:
                out(register(a.name, a.path, a.source, home))
            except ValueError as e:
                out({"error": str(e)})
                return 2
            return 0
        print(json.dumps(load(home), ensure_ascii=False, indent=2))
        return 0
    except RegistryError as e:
        out({"error": str(e)})
        return 3


if __name__ == "__main__":
    sys.exit(main())
