#!/usr/bin/env python3
"""Workspace and configuration manager for leo-3d-blender.

Provides 3-tier cascade resolution for 3D project output workspace:
1. User explicitly specified directory (persisted to config.json)
2. History workspace directory from ~/.shrimp/skills/leo-3d-blender/config.json
3. Fallback to ~/素材/3d/

Also persists mcp-for-blender repository path and Blender socket address.

Usage:
  python3 workspace.py status
  python3 workspace.py set-workspace <dir>
  python3 workspace.py set-repo <dir>         # optional: use local mcp-for-blender source repo
  python3 workspace.py clear-repo             # revert to default zero-repo uvx mode
  python3 workspace.py set-blender [--host localhost] [--port 9876]
  python3 workspace.py init <topic> [--workspace <dir>]
  python3 workspace.py resolve <topic> [--workspace <dir>]

Exit codes: 0 ok, 1 invalid args, 3 config.json is corrupt or unreadable.
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

DEFAULT_MCP_REPO_DIR = ""
DEFAULT_MCP_PACKAGE = "mcp-for-blender"
DEFAULT_BLENDER_HOST = "localhost"
DEFAULT_BLENDER_PORT = 9876


class ConfigError(Exception):
    """config.json is corrupt or unreadable; never overwrite it."""


def absolute_path(path: str) -> Path:
    return Path(path.strip()).expanduser().resolve()


def get_skill_home() -> Path:
    env_home = os.environ.get("LEO_3D_BLENDER_HOME")
    if env_home:
        return Path(env_home).expanduser().resolve()
    return Path.home() / ".shrimp" / "skills" / "leo-3d-blender"


def get_config_path() -> Path:
    """Return path to config.json (~/.shrimp/skills/leo-3d-blender/config.json)."""
    env_cfg = os.environ.get("LEO_3D_BLENDER_CONFIG_PATH")
    if env_cfg:
        return Path(env_cfg).expanduser().resolve()
    return get_skill_home() / "config.json"


def get_default_output_dir() -> Path:
    """Return default fallback output directory: ~/素材/3d."""
    return Path.home() / "素材" / "3d"


def read_config() -> dict[str, Any]:
    """Read configuration from config.json. Returns defaults if missing; raises ConfigError if corrupt."""
    cfg_path = get_config_path()
    defaults: dict[str, Any] = {
        "workspace_dir": "",
        "active_project": "",
        "mcp_repo_dir": DEFAULT_MCP_REPO_DIR,
        "mcp_package": DEFAULT_MCP_PACKAGE,
        "blender_host": DEFAULT_BLENDER_HOST,
        "blender_port": DEFAULT_BLENDER_PORT,
        "updated_at": None,
    }

    if not cfg_path.exists():
        return defaults

    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        raise ConfigError(f"{cfg_path} is corrupt or unreadable ({e}); fix or delete it") from e
    if not isinstance(data, dict):
        raise ConfigError(f"{cfg_path} is corrupt (expected a JSON object); fix or delete it")
    return {**defaults, **data}


def write_config(config: dict[str, Any]) -> dict[str, Any]:
    """Write configuration atomically to config.json."""
    cfg_path = get_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        **config,
        "updated_at": datetime.datetime.now().astimezone().isoformat(),
    }

    tmp_file = cfg_path.parent / f".config-{os.getpid()}.tmp"
    try:
        tmp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_file.replace(cfg_path)
    finally:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except OSError:
                pass

    return payload


def update_config(partial: dict[str, Any]) -> dict[str, Any]:
    """Update partial configuration fields and persist."""
    current = read_config()
    current.update(partial)
    return write_config(current)


def resolve_workspace_dir(user_specified_dir: str | None = None, persist: bool = True) -> dict[str, Any]:
    """Resolve effective workspace directory with smart persistence:
    1. User explicitly specified -> persists to config.json (unless persist=False)
    2. config.json workspace_dir -> reuses silently
    3. fallback -> ~/.shrimp/skills/leo-3d-blender/output/
    """
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
        resolved = absolute_path(cfg_ws)
        return {
            "dir": str(resolved),
            "source": "config",
            "persisted": False,
        }

    def_dir = get_default_output_dir().resolve()
    return {
        "dir": str(def_dir),
        "source": "default",
        "persisted": False,
    }


def format_project_folder_name(topic: str, project_date: datetime.date | None = None) -> str:
    """Format a 3D project topic into standard YYYY-MM-DD-<topic> folder name."""
    if project_date is None:
        project_date = datetime.date.today()

    date_prefix = project_date.strftime("%Y-%m-%d")
    clean_topic = (topic or "未命名3D工程").strip()
    clean_topic = re.sub(r'[\\/:*?"<>|]+', "-", clean_topic)
    clean_topic = re.sub(r"\s+", "-", clean_topic)
    clean_topic = clean_topic.strip("-. ")

    if not clean_topic:
        clean_topic = "未命名3D工程"

    if re.match(r"^\d{4}-\d{2}-\d{2}", clean_topic):
        return clean_topic

    return f"{date_prefix}-{clean_topic}"


def resolve_project_dir(
    topic: str,
    user_specified_dir: str | None = None,
    project_date: datetime.date | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    """Resolve standard 3D project directory under effective workspace."""
    ws = resolve_workspace_dir(user_specified_dir, persist)
    folder_name = format_project_folder_name(topic, project_date)
    project_path = Path(ws["dir"]) / folder_name

    return {
        "project_path": str(project_path),
        "folder_name": folder_name,
        "workspace_dir": ws["dir"],
        "workspace_source": ws["source"],
        "persisted": ws["persisted"],
        "scenes_dir": str(project_path / "场景"),
        "scripts_dir": str(project_path / "脚本"),
        "assets_dir": str(project_path / "资产"),
        "previews_dir": str(project_path / "预览"),
        "renders_dir": str(project_path / "渲染"),
    }


def init_project_dir(
    topic: str,
    user_specified_dir: str | None = None,
    project_date: datetime.date | None = None,
) -> dict[str, Any]:
    """Create standard 3D project directory tree and starter delivery log:
    <workspace_dir>/
    └── YYYY-MM-DD-主题/
        ├── 交付记录.md
        ├── 场景/
        ├── 脚本/
        ├── 资产/
        ├── 预览/
        └── 渲染/
    """
    res = resolve_project_dir(topic, user_specified_dir, project_date)
    project_path = Path(res["project_path"])

    for key in ("scenes_dir", "scripts_dir", "assets_dir", "previews_dir", "renders_dir"):
        Path(res[key]).mkdir(parents=True, exist_ok=True)

    update_config({"active_project": str(project_path)})

    record_file = project_path / "交付记录.md"
    if not record_file.exists():
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        record_content = f"""# 《{topic}》3D 工程交付记录

- **创建时间**：{now_str}
- **归档路径**：`{project_path}`
- **选用引擎**：`mcp-for-blender` (Live Blender + bpy)
- **资产来源**：待补充（原创 bpy 建模 / Poly Haven / Sketchfab / Poly Pizza / 3D 生成）

---

## 目录约定
- `场景/`：`.blend` 工程文件与增量备份
- `脚本/`：可复用 `bpy` / `bmesh` 构建脚本
- `资产/`：导入或导出的模型与贴图（`.glb` / `.fbx` / `.obj`）
- `预览/`：`look` 工具多视角/线框/渲染预览截图
- `渲染/`：最终静帧或动画渲染输出

---

## 交付检查清单
- [ ] 已保存 `.blend` 工程至 `场景/`
- [ ] 已通过 `look` 检查比例、材质与光照
- [ ] 已输出最终渲染图/导出模型至 `渲染/` 或 `资产/`
"""
        record_file.write_text(record_content, encoding="utf-8")

    return res


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="leo-3d-blender workspace and config manager")
    subparsers = parser.add_subparsers(dest="subcommand", help="Subcommand to execute")

    subparsers.add_parser("status", help="Show current configuration and workspace status")

    p_set_ws = subparsers.add_parser("set-workspace", help="Set and persist default workspace directory")
    p_set_ws.add_argument("dir", help="Directory path to set as default workspace")

    p_set_repo = subparsers.add_parser("set-repo", help="Optional: bind a local mcp-for-blender repo instead of uvx")
    p_set_repo.add_argument("dir", help="Local path to mcp-for-blender repo")

    subparsers.add_parser("clear-repo", help="Clear local repo binding and use default uvx mcp-for-blender")

    p_set_blender = subparsers.add_parser("set-blender", help="Set and persist Blender addon host/port")
    p_set_blender.add_argument("--host", default=None, help="Blender addon host (default: localhost)")
    p_set_blender.add_argument("--port", type=int, default=None, help="Blender addon port (default: 9876)")

    p_init = subparsers.add_parser("init", help="Initialize a standard 3D project directory structure")
    p_init.add_argument("topic", help="3D scene or asset topic")
    p_init.add_argument("--workspace", default=None, help="Explicit workspace directory override")

    p_resolve = subparsers.add_parser("resolve", help="Resolve project directory paths without writing")
    p_resolve.add_argument("topic", help="3D scene or asset topic")
    p_resolve.add_argument("--workspace", default=None, help="Explicit workspace directory override")

    args = parser.parse_args(argv)

    try:
        if args.subcommand == "status":
            cfg = read_config()
            cfg_path = get_config_path()
            ws = resolve_workspace_dir()
            repo_val = str(cfg.get("mcp_repo_dir") or "").strip()
            print(json.dumps({
                "config_path": str(cfg_path),
                "config_exists": cfg_path.exists(),
                "config": cfg,
                "mcp_mode": "local_repo" if repo_val else "uvx",
                "effective_workspace": ws["dir"],
                "workspace_source": ws["source"],
                "default_fallback": str(get_default_output_dir().resolve()),
            }, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "set-workspace":
            resolved = absolute_path(args.dir)
            update_config({"workspace_dir": str(resolved)})
            print(json.dumps({
                "ok": True,
                "workspace_dir": str(resolved),
                "config_path": str(get_config_path()),
            }, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "set-repo":
            resolved = absolute_path(args.dir)
            if not (resolved / "pyproject.toml").is_file():
                print(json.dumps({
                    "ok": False,
                    "error": f"无效的 mcp-for-blender 仓库目录（未找到 pyproject.toml）: {resolved}",
                }, ensure_ascii=False), file=sys.stderr)
                return 1
            update_config({"mcp_repo_dir": str(resolved)})
            print(json.dumps({
                "ok": True,
                "mcp_mode": "local_repo",
                "mcp_repo_dir": str(resolved),
                "config_path": str(get_config_path()),
            }, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "clear-repo":
            update_config({"mcp_repo_dir": ""})
            print(json.dumps({
                "ok": True,
                "mcp_mode": "uvx",
                "mcp_repo_dir": "",
                "config_path": str(get_config_path()),
            }, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "set-blender":
            updates: dict[str, Any] = {}
            if args.host is not None:
                updates["blender_host"] = args.host.strip()
            if args.port is not None:
                if args.port <= 0 or args.port > 65535:
                    print(json.dumps({"ok": False, "error": f"非法端口号: {args.port}"}, ensure_ascii=False), file=sys.stderr)
                    return 1
                updates["blender_port"] = args.port
            if not updates:
                print(json.dumps({"ok": False, "error": "请至少指定 --host 或 --port"}, ensure_ascii=False), file=sys.stderr)
                return 1
            cfg = update_config(updates)
            print(json.dumps({
                "ok": True,
                "blender_host": cfg["blender_host"],
                "blender_port": cfg["blender_port"],
                "config_path": str(get_config_path()),
            }, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "init":
            res = init_project_dir(args.topic, user_specified_dir=args.workspace)
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "resolve":
            res = resolve_project_dir(args.topic, user_specified_dir=args.workspace, persist=False)
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0
    except ConfigError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 3

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
