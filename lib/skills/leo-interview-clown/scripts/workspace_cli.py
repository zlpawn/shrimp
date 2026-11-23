#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""管理 leo-interview-clown 的持久化输出配置、~/.shrimp 下的 uv 虚拟环境，以及隔离的阶段运行区。"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NoReturn

SKILL_NAME = "leo-interview-clown"
SCHEMA_VERSION = 1
RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
MODES = ("doc", "repo", "method", "hybrid")
VERIFICATION_MODES = ("none", "light", "targeted")
STATUSES = (
    "initialized",
    "reading",
    "proposal-ready",
    "blocked",
    "approved",
    "publishing",
    "published",
    "failed",
    "rejected",
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def fail(message: str) -> NoReturn:
    raise SystemExit(f"error: {message}")


def get_skill_home() -> Path:
    override = os.environ.get("LEO_INTERVIEW_CLOWN_HOME", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return (Path.home() / ".shrimp" / "skills" / SKILL_NAME).resolve()


def get_config_path() -> Path:
    override = os.environ.get("LEO_INTERVIEW_CLOWN_CONFIG", "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return get_skill_home() / "config.json"


def get_default_output_dir() -> Path:
    return (get_skill_home() / "output").resolve()


def get_runs_root() -> Path:
    return (get_skill_home() / "runs").resolve()


def get_venv_dir() -> Path:
    return (get_skill_home() / ".venv").resolve()


def get_venv_python(venv_dir: Path | None = None) -> Path:
    root = venv_dir or get_venv_dir()
    if sys.platform.startswith("win"):
        return root / "Scripts" / "python.exe"
    return root / "bin" / "python"


def default_config() -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "knowledgebase_root": "",
        "fallback_accepted": False,
        "layout": {
            "doc_subdir": "docs",
            "project_subdir": "projects",
            "method_subdir": "methods",
            "hybrid_subdir": "projects",
        },
        "updated_at": None,
    }


def read_config() -> dict[str, Any]:
    cfg_path = get_config_path()
    base = default_config()
    if not cfg_path.is_file():
        return base
    try:
        loaded = json.loads(cfg_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"无法读取配置文件 {cfg_path}: {exc}")
    if not isinstance(loaded, dict):
        fail(f"配置文件必须为 JSON 对象: {cfg_path}")

    merged_layout = {**base["layout"], **(loaded.get("layout") or {})}
    return {**base, **loaded, "layout": merged_layout}


def write_config(config: dict[str, Any]) -> dict[str, Any]:
    cfg_path = get_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        **default_config(),
        **config,
        "schema_version": SCHEMA_VERSION,
        "updated_at": now_iso(),
    }
    cfg_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return payload


def resolve_target(target_root_arg: str | None = None, once: bool = False) -> dict[str, Any]:
    cfg = read_config()
    if target_root_arg and target_root_arg.strip():
        resolved = Path(target_root_arg.strip()).expanduser().resolve()
        persisted = False
        if not once:
            cfg["knowledgebase_root"] = str(resolved)
            cfg["fallback_accepted"] = False
            write_config(cfg)
            persisted = True
        return {
            "target_root": str(resolved),
            "source": "user_specified",
            "persisted": persisted,
            "needs_config_reminder": False,
            "config_path": str(get_config_path()),
            "layout": cfg["layout"],
        }

    configured = str(cfg.get("knowledgebase_root", "")).strip()
    if configured:
        resolved = Path(configured).expanduser().resolve()
        return {
            "target_root": str(resolved),
            "source": "config",
            "persisted": False,
            "needs_config_reminder": False,
            "config_path": str(get_config_path()),
            "layout": cfg["layout"],
        }

    fallback = get_default_output_dir()
    return {
        "target_root": str(fallback),
        "source": "fallback",
        "persisted": False,
        "needs_config_reminder": not bool(cfg.get("fallback_accepted", False)),
        "config_path": str(get_config_path()),
        "layout": cfg["layout"],
    }


def metadata_path(run_dir: Path) -> Path:
    return run_dir / "run.json"


def read_metadata(run_dir: Path) -> dict[str, Any]:
    path = metadata_path(run_dir)
    if not path.is_file():
        fail(f"缺少运行元数据: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"无法读取运行元数据: {exc}")
    if not isinstance(data, dict):
        fail("运行元数据必须为 JSON 对象")
    return data


def write_metadata(run_dir: Path, data: dict[str, Any]) -> None:
    data["updated_at"] = now_iso()
    metadata_path(run_dir).write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def default_run_id(mode: str) -> str:
    return f"{mode}-{datetime.now().strftime('%Y%m%d-%H%M%S')}"


def validate_run_id(run_id: str) -> None:
    if not RUN_ID_PATTERN.fullmatch(run_id):
        fail("run ID 仅允许字母、数字、点、下划线或连字符")
    if run_id in {".", ".."}:
        fail("无效的 run ID")


def validate_owned_run(run_dir_arg: str) -> tuple[Path, dict[str, Any]]:
    run_dir = Path(run_dir_arg).expanduser().resolve()
    data = read_metadata(run_dir)
    if data.get("schema_version") != SCHEMA_VERSION:
        fail("不支持的运行元数据版本")
    if data.get("owner") != SKILL_NAME:
        fail("该运行目录不属于本 skill")

    recorded_run = Path(str(data.get("run_dir", ""))).expanduser().resolve()
    recorded_parent = Path(str(data.get("runs_root", ""))).expanduser().resolve()
    expected_parent = get_runs_root()

    if run_dir != recorded_run:
        fail("运行路径与元数据记录不一致")
    if run_dir.parent != recorded_parent or recorded_parent != expected_parent:
        fail("运行目录不在受控 runs 根目录下")
    if run_dir == recorded_parent or run_dir == get_skill_home():
        fail("触发安全边界：禁止清理父目录")
    return run_dir, data


def cmd_config_get(_args: argparse.Namespace) -> None:
    cfg = read_config()
    resolved = resolve_target()
    venv_dir = get_venv_dir()
    venv_python = get_venv_python(venv_dir)
    print(
        json.dumps(
            {
                "config_path": str(get_config_path()),
                "default_output_dir": str(get_default_output_dir()),
                "runs_root": str(get_runs_root()),
                "venv_dir": str(venv_dir),
                "venv_python": str(venv_python),
                "venv_ready": venv_python.is_file(),
                "config": cfg,
                "resolved": resolved,
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def cmd_config_set(args: argparse.Namespace) -> None:
    cfg = read_config()
    if args.target_root:
        resolved = Path(args.target_root).expanduser().resolve()
        cfg["knowledgebase_root"] = str(resolved)
        cfg["fallback_accepted"] = False
    if args.use_fallback:
        cfg["knowledgebase_root"] = ""
        cfg["fallback_accepted"] = True
    if args.doc_subdir:
        cfg["layout"]["doc_subdir"] = args.doc_subdir.strip()
    if args.project_subdir:
        cfg["layout"]["project_subdir"] = args.project_subdir.strip()
    if args.method_subdir:
        cfg["layout"]["method_subdir"] = args.method_subdir.strip()
    if args.hybrid_subdir:
        cfg["layout"]["hybrid_subdir"] = args.hybrid_subdir.strip()
    updated = write_config(cfg)
    print(
        json.dumps(
            {
                "config_path": str(get_config_path()),
                "config": updated,
                "resolved": resolve_target(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def cmd_config_resolve(args: argparse.Namespace) -> None:
    result = resolve_target(target_root_arg=args.target_root, once=args.once)
    print(json.dumps(result, ensure_ascii=False, indent=2))


def cmd_venv_ensure(args: argparse.Namespace) -> None:
    venv_dir = get_venv_dir()
    venv_python = get_venv_python(venv_dir)
    created = False
    if not venv_python.is_file():
        uv_bin = shutil.which("uv")
        if not uv_bin:
            fail("未找到 uv 命令，请先安装 uv 后再初始化 ~/.shrimp/skills/leo-interview-clown/.venv")
        venv_dir.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run([uv_bin, "venv", str(venv_dir)], check=True)
        created = True

    if args.packages:
        uv_bin = shutil.which("uv")
        if not uv_bin:
            fail("未找到 uv 命令，无法安装依赖")
        subprocess.run(
            [uv_bin, "pip", "install", "--python", str(venv_python), *args.packages],
            check=True,
        )

    print(
        json.dumps(
            {
                "venv_dir": str(venv_dir),
                "venv_python": str(venv_python),
                "created": created,
                "ready": venv_python.is_file(),
            },
            ensure_ascii=False,
            indent=2,
        )
    )


def cmd_run_init(args: argparse.Namespace) -> None:
    resolved = resolve_target(target_root_arg=args.target_root, once=args.once)
    runs_root = get_runs_root()
    runs_root.mkdir(parents=True, exist_ok=True)

    run_id = args.run_id or default_run_id(args.mode)
    validate_run_id(run_id)
    run_dir = (runs_root / run_id).resolve()
    if run_dir.parent != runs_root:
        fail("run 路径越界")
    if run_dir.exists():
        fail(f"运行目录已存在: {run_dir}")

    subdirs = [
        "source",
        "media/original",
        "media/previews",
        "extraction",
        "proposal",
        "drafts",
    ]
    for rel in subdirs:
        (run_dir / rel).mkdir(parents=True, exist_ok=False)

    created_at = now_iso()
    data: dict[str, Any] = {
        "schema_version": SCHEMA_VERSION,
        "owner": SKILL_NAME,
        "run_id": run_id,
        "mode": args.mode,
        "source": args.source,
        "runs_root": str(runs_root),
        "run_dir": str(run_dir),
        "target_root": resolved["target_root"],
        "target_source": resolved["source"],
        "needs_config_reminder": resolved["needs_config_reminder"],
        "verification_mode": args.verification,
        "status": "initialized",
        "created_at": created_at,
        "updated_at": created_at,
        "artifacts": [],
        "audit": {"result": "not-run", "notes": []},
    }
    write_metadata(run_dir, data)
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_run_set_status(args: argparse.Namespace) -> None:
    run_dir, data = validate_owned_run(args.run_dir)
    data["status"] = args.status
    if args.target_root:
        resolved = resolve_target(target_root_arg=args.target_root, once=args.once)
        data["target_root"] = resolved["target_root"]
        data["target_source"] = resolved["source"]
        data["needs_config_reminder"] = resolved["needs_config_reminder"]
    if args.artifact:
        artifacts = data.setdefault("artifacts", [])
        for artifact in args.artifact:
            if artifact not in artifacts:
                artifacts.append(artifact)
    write_metadata(run_dir, data)
    print(f"{run_dir}: {args.status}")


def cmd_run_record_audit(args: argparse.Namespace) -> None:
    run_dir, data = validate_owned_run(args.run_dir)
    data["audit"] = {
        "result": args.result,
        "checked_at": now_iso(),
        "notes": list(args.note or []),
    }
    write_metadata(run_dir, data)
    print(f"{run_dir}: audit={args.result}")


def cmd_run_show(args: argparse.Namespace) -> None:
    _run_dir, data = validate_owned_run(args.run_dir)
    print(json.dumps(data, ensure_ascii=False, indent=2))


def cmd_run_cleanup(args: argparse.Namespace) -> None:
    run_dir, data = validate_owned_run(args.run_dir)
    if data.get("status") != "published":
        fail("清理要求状态必须为 published")
    audit = data.get("audit")
    if not isinstance(audit, dict) or audit.get("result") != "pass":
        fail("清理要求审计结果必须为 pass")
    if not run_dir.is_dir() or run_dir.is_symlink():
        fail("运行目录不存在或为符号链接")

    shutil.rmtree(run_dir)
    print(f"removed owned run: {run_dir}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    top = parser.add_subparsers(dest="group", required=True)

    # config group
    cfg_parser = top.add_parser("config", help="管理持久化输出目录配置")
    cfg_sub = cfg_parser.add_subparsers(dest="command", required=True)

    cfg_get = cfg_sub.add_parser("get", help="查看当前配置、venv 与生效目录")
    cfg_get.set_defaults(func=cmd_config_get)

    cfg_set = cfg_sub.add_parser("set", help="设置永久知识库目录或子目录结构")
    cfg_set.add_argument("--target-root", help="永久知识库根目录")
    cfg_set.add_argument(
        "--use-fallback",
        action="store_true",
        help="确认使用默认保底输出目录",
    )
    cfg_set.add_argument("--doc-subdir")
    cfg_set.add_argument("--project-subdir")
    cfg_set.add_argument("--method-subdir")
    cfg_set.add_argument("--hybrid-subdir")
    cfg_set.set_defaults(func=cmd_config_set)

    cfg_resolve = cfg_sub.add_parser("resolve", help="按三级策略解析输出目录")
    cfg_resolve.add_argument("--target-root", help="本次指定的目标根目录")
    cfg_resolve.add_argument("--once", action="store_true", help="仅本次生效，不写入 config.json")
    cfg_resolve.set_defaults(func=cmd_config_resolve)

    # venv group
    venv_parser = top.add_parser("venv", help="管理 ~/.shrimp/skills/leo-interview-clown/.venv")
    venv_sub = venv_parser.add_subparsers(dest="command", required=True)
    venv_ensure = venv_sub.add_parser("ensure", help="使用 uv 确保虚拟环境存在并可选安装依赖")
    venv_ensure.add_argument("packages", nargs="*", help="可选：使用 uv pip install 安装的包")
    venv_ensure.set_defaults(func=cmd_venv_ensure)

    # run group
    run_parser = top.add_parser("run", help="管理 ~/.shrimp 下的隔离运行区")
    run_sub = run_parser.add_subparsers(dest="command", required=True)

    run_init = run_sub.add_parser("init", help="初始化新的受控运行区")
    run_init.add_argument("--mode", choices=MODES, required=True)
    run_init.add_argument("--source", required=True)
    run_init.add_argument("--target-root", help="可选目标目录覆盖")
    run_init.add_argument("--once", action="store_true", help="仅本次生效，不持久化")
    run_init.add_argument("--run-id")
    run_init.add_argument("--verification", choices=VERIFICATION_MODES, default="light")
    run_init.set_defaults(func=cmd_run_init)

    run_status = run_sub.add_parser("set-status", help="更新运行状态或确认后的目标目录")
    run_status.add_argument("--run-dir", required=True)
    run_status.add_argument("--status", choices=STATUSES, required=True)
    run_status.add_argument("--target-root", help="用户确认后更新目标根目录")
    run_status.add_argument("--once", action="store_true", help="仅本次生效，不持久化")
    run_status.add_argument("--artifact", action="append")
    run_status.set_defaults(func=cmd_run_set_status)

    run_audit = run_sub.add_parser("record-audit", help="记录反向完整性审计结果")
    run_audit.add_argument("--run-dir", required=True)
    run_audit.add_argument("--result", choices=("pass", "fail"), required=True)
    run_audit.add_argument("--note", action="append")
    run_audit.set_defaults(func=cmd_run_record_audit)

    run_show = run_sub.add_parser("show", help="查看运行元数据")
    run_show.add_argument("--run-dir", required=True)
    run_show.set_defaults(func=cmd_run_show)

    run_cleanup = run_sub.add_parser("cleanup", help="安全清理已发布且审计通过的运行区")
    run_cleanup.add_argument("--run-dir", required=True)
    run_cleanup.set_defaults(func=cmd_run_cleanup)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
