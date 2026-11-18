#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Workspace and project archive manager for leo-obs-studio.

Follows the 3-tier cascade resolution pattern used by leo-video-router:
1. User explicitly specified directory (--workspace) -> persisted to config.json
2. Historical workspace_dir stored in ~/.shrimp/skills/leo-obs-studio/config.json
3. Fallback to ~/.shrimp/skills/leo-obs-studio/output/

Standard recording project layout:
<workspace_dir>/
└── YYYY-MM-DD-录屏主题/
    ├── 录制记录.md
    ├── 原始录屏/
    ├── 截图/
    └── 成片/
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


class ConfigError(Exception):
    """config.json is corrupt or unreadable; never overwrite it."""


def absolute_path(raw_path: str) -> Path:
    return Path(raw_path.strip()).expanduser().resolve()


def get_skill_data_dir() -> Path:
    env_home = os.environ.get("LEO_OBS_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path.home() / ".shrimp" / "skills" / "leo-obs-studio"


def get_config_path() -> Path:
    env_cfg = os.environ.get("LEO_OBS_CONFIG_PATH")
    if env_cfg:
        return Path(env_cfg).expanduser().resolve()
    return get_skill_data_dir() / "config.json"


def get_default_output_dir() -> Path:
    return get_skill_data_dir() / "output"


def read_config() -> dict[str, Any]:
    """Read config.json; return defaults if absent, raise ConfigError if corrupt."""
    cfg_path = get_config_path()
    defaults: dict[str, Any] = {
        "workspace_dir": "",
        "active_project": "",
        "auto_launch": True,
        "updated_at": None,
    }
    if not cfg_path.exists():
        return defaults
    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as exc:
        raise ConfigError(f"{cfg_path} is corrupt or unreadable ({exc}); fix or delete it") from exc
    if not isinstance(data, dict):
        raise ConfigError(f"{cfg_path} is corrupt (expected JSON object); fix or delete it")
    return {**defaults, **data}


def write_config(config: dict[str, Any]) -> dict[str, Any]:
    """Atomically persist config.json with restrictive permissions on POSIX."""
    cfg_path = get_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **config,
        "updated_at": datetime.datetime.now().astimezone().isoformat(),
    }
    tmp_file = cfg_path.parent / f".config-{os.getpid()}.tmp"
    try:
        tmp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        if os.name == "posix":
            os.chmod(tmp_file, 0o600)
        tmp_file.replace(cfg_path)
    finally:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except OSError:
                pass
    return payload


def update_config(partial: dict[str, Any]) -> dict[str, Any]:
    current = read_config()
    current.update(partial)
    return write_config(current)


def redact_config(cfg: dict[str, Any]) -> dict[str, Any]:
    return {k: ("***" if k == "password" and v else v) for k, v in cfg.items()}


def resolve_workspace_dir(user_specified_dir: str | None = None, persist: bool = True) -> dict[str, Any]:
    """3-tier cascade resolution for workspace_dir."""
    if user_specified_dir and str(user_specified_dir).strip():
        resolved = absolute_path(str(user_specified_dir))
        if persist:
            update_config({"workspace_dir": str(resolved)})
        return {
            "dir": str(resolved),
            "source": "user_specified",
            "persisted": persist,
        }

    cfg = read_config()
    cfg_ws = cfg.get("workspace_dir")
    if cfg_ws and isinstance(cfg_ws, str) and cfg_ws.strip():
        return {
            "dir": str(absolute_path(cfg_ws)),
            "source": "config",
            "persisted": False,
        }

    return {
        "dir": str(get_default_output_dir().resolve()),
        "source": "default",
        "persisted": False,
    }


def format_project_folder_name(topic: str, project_date: datetime.date | None = None) -> str:
    if project_date is None:
        project_date = datetime.date.today()
    date_prefix = project_date.strftime("%Y-%m-%d")
    clean_topic = (topic or "屏幕录制").strip()
    clean_topic = re.sub(r'[\\/:*?"<>|]+', "-", clean_topic)
    clean_topic = re.sub(r"\s+", "-", clean_topic)
    clean_topic = clean_topic.strip("-. ")
    if not clean_topic:
        clean_topic = "屏幕录制"
    if re.match(r"^\d{4}-\d{2}-\d{2}", clean_topic):
        return clean_topic
    return f"{date_prefix}-{clean_topic}"


def project_subdirs(project_path: Path) -> dict[str, Path]:
    return {
        "raw_dir": project_path / "原始录屏",
        "screenshot_dir": project_path / "截图",
        "export_dir": project_path / "成片",
        "record_log": project_path / "录制记录.md",
    }


def resolve_project_dir(
    topic: str,
    user_specified_dir: str | None = None,
    project_date: datetime.date | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    ws = resolve_workspace_dir(user_specified_dir, persist=persist)
    folder_name = format_project_folder_name(topic, project_date)
    project_path = Path(ws["dir"]) / folder_name
    dirs = project_subdirs(project_path)
    return {
        "project_path": str(project_path),
        "folder_name": folder_name,
        "workspace_dir": ws["dir"],
        "workspace_source": ws["source"],
        "persisted": ws["persisted"],
        "raw_dir": str(dirs["raw_dir"]),
        "screenshot_dir": str(dirs["screenshot_dir"]),
        "export_dir": str(dirs["export_dir"]),
        "record_log": str(dirs["record_log"]),
    }


def init_project_dir(
    topic: str,
    user_specified_dir: str | None = None,
    project_date: datetime.date | None = None,
    set_active: bool = True,
) -> dict[str, Any]:
    res = resolve_project_dir(topic, user_specified_dir, project_date, persist=True)
    project_path = Path(res["project_path"])
    dirs = project_subdirs(project_path)

    for key in ("raw_dir", "screenshot_dir", "export_dir"):
        dirs[key].mkdir(parents=True, exist_ok=True)

    log_file = dirs["record_log"]
    if not log_file.exists():
        created = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
        content = (
            f"# 《{topic or '屏幕录制'}》录屏交付记录\n\n"
            f"> **工程目录**：`{res['folder_name']}`  \n"
            f"> **创建时间**：{created}  \n\n"
            "## 录制清单\n\n"
            "| 时间 | 动作 | 场景 | 文件路径 |\n"
            "|---|---|---|---|\n"
        )
        log_file.write_text(content, encoding="utf-8")

    if set_active:
        update_config({"active_project": str(project_path)})

    return res


def append_project_log(
    project_path: Path,
    action: str,
    scene: str | None = None,
    file_path: str | None = None,
) -> None:
    log_file = project_path / "录制记录.md"
    if not log_file.exists():
        return
    now_str = datetime.datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S")
    scene_cell = (scene or "-").replace("|", "\\|")
    path_cell = f"`{file_path}`" if file_path else "-"
    row = f"| {now_str} | {action} | {scene_cell} | {path_cell} |\n"
    with log_file.open("a", encoding="utf-8") as fh:
        fh.write(row)


def get_active_project_info() -> dict[str, Any] | None:
    cfg = read_config()
    active = str(cfg.get("active_project") or "").strip()
    if not active:
        return None
    p = absolute_path(active)
    if not p.exists():
        return None
    dirs = project_subdirs(p)
    return {
        "project_path": str(p),
        "folder_name": p.name,
        "raw_dir": str(dirs["raw_dir"]),
        "screenshot_dir": str(dirs["screenshot_dir"]),
        "export_dir": str(dirs["export_dir"]),
        "record_log": str(dirs["record_log"]),
    }


def _cli_status(_: argparse.Namespace) -> dict[str, Any]:
    cfg = read_config()
    ws = resolve_workspace_dir(persist=False)
    active = get_active_project_info()
    return {
        "ok": True,
        "config_path": str(get_config_path()),
        "workspace_dir": ws["dir"],
        "workspace_source": ws["source"],
        "default_output_dir": str(get_default_output_dir().resolve()),
        "active_project": active,
        "config": redact_config(cfg),
    }


def _cli_set_workspace(args: argparse.Namespace) -> dict[str, Any]:
    res = resolve_workspace_dir(args.dir, persist=True)
    Path(res["dir"]).mkdir(parents=True, exist_ok=True)
    return {"ok": True, **res}


def _cli_init(args: argparse.Namespace) -> dict[str, Any]:
    res = init_project_dir(args.topic, args.workspace, set_active=True)
    return {"ok": True, **res}


def _cli_resolve(args: argparse.Namespace) -> dict[str, Any]:
    res = resolve_project_dir(args.topic, args.workspace, persist=False)
    return {"ok": True, **res}


def _cli_clear_active(_: argparse.Namespace) -> dict[str, Any]:
    update_config({"active_project": ""})
    return {"ok": True, "active_project": None}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="workspace.py",
        description="Workspace and project archive manager for leo-obs-studio.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_status = sub.add_parser("status", help="Show effective workspace, config, and active project")
    p_status.set_defaults(func=_cli_status)

    p_set = sub.add_parser("set-workspace", help="Set and persist default workspace directory")
    p_set.add_argument("dir", help="Workspace directory path")
    p_set.set_defaults(func=_cli_set_workspace)

    p_init = sub.add_parser("init", help="Initialize YYYY-MM-DD-topic recording project folder")
    p_init.add_argument("topic", help="Recording project topic")
    p_init.add_argument("--workspace", help="Optional workspace override (persisted)")
    p_init.set_defaults(func=_cli_init)

    p_res = sub.add_parser("resolve", help="Preview resolved project paths without creating folders")
    p_res.add_argument("topic", help="Recording project topic")
    p_res.add_argument("--workspace", help="Optional workspace override")
    p_res.set_defaults(func=_cli_resolve)

    p_clr = sub.add_parser("clear-active", help="Clear active_project in config.json")
    p_clr.set_defaults(func=_cli_clear_active)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.func(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ConfigError as exc:
        print(json.dumps({"ok": False, "error": {"code": "CONFIG_ERROR", "message": str(exc)}}, ensure_ascii=False, indent=2))
        return 3
    except Exception as exc:
        print(json.dumps({"ok": False, "error": {"code": "UNEXPECTED_ERROR", "message": str(exc)}}, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
