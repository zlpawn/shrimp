#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "obsws-python>=1.8.0",
# ]
# ///
"""Cross-platform OBS Studio WebSocket v5 control CLI for AI agents."""

from __future__ import annotations

import argparse
import importlib.util
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any

SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import workspace as ws_mgr  # noqa: E402

SKILL_DATA_DIR = ws_mgr.get_skill_data_dir()
SKILL_VENV_DIR = SKILL_DATA_DIR / "venv"
SKILL_VENV_PYTHON = (
    SKILL_VENV_DIR / "Scripts" / "python.exe"
    if sys.platform == "win32"
    else SKILL_VENV_DIR / "bin" / "python"
)

if (
    importlib.util.find_spec("obsws_python") is None
    and SKILL_VENV_PYTHON.exists()
    and Path(sys.executable).resolve() != SKILL_VENV_PYTHON.resolve()
):
    os.execv(str(SKILL_VENV_PYTHON), [str(SKILL_VENV_PYTHON), *sys.argv])

DEFAULT_HOST = "localhost"
DEFAULT_PORT = 4455


def _obs_ws_config_path() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    return base / "obs-studio" / "plugin_config" / "obs-websocket" / "config.json"


OBS_WS_CONFIG_PATH = _obs_ws_config_path()


class CliError(Exception):
    """Structured error reported as JSON to callers."""

    def __init__(self, code: str, message: str, hint: str | None = None, details: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.hint = hint
        self.details = details


def _load_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _resolve_connection(args: argparse.Namespace) -> dict[str, Any]:
    """Resolve connection settings from CLI flags > env > skill config > OBS config > defaults."""
    skill_cfg = ws_mgr.read_config()
    obs_cfg = _load_json_file(OBS_WS_CONFIG_PATH)

    obs_password = ""
    if obs_cfg.get("auth_required", True):
        obs_password = str(obs_cfg.get("server_password") or "")

    host = (
        getattr(args, "host", None)
        or os.environ.get("OBS_WS_HOST")
        or skill_cfg.get("host")
        or DEFAULT_HOST
    )
    port_raw = (
        getattr(args, "port", None)
        or os.environ.get("OBS_WS_PORT")
        or skill_cfg.get("port")
        or obs_cfg.get("server_port")
        or DEFAULT_PORT
    )
    password = getattr(args, "password", None)
    if password is None:
        password = os.environ.get("OBS_WS_PASSWORD")
    if password is None and "password" in skill_cfg:
        password = skill_cfg.get("password")
    if password is None:
        password = obs_password

    return {
        "host": str(host),
        "port": int(port_raw),
        "password": str(password or ""),
        "default_scene": skill_cfg.get("default_scene"),
        "record_directory": skill_cfg.get("record_directory"),
        "auto_launch": bool(skill_cfg.get("auto_launch", True)),
        "obs_ws_config": obs_cfg,
        "skill_config": skill_cfg,
    }


def _find_obs_executable() -> Path | None:
    if sys.platform == "darwin":
        candidates = [
            Path("/Applications/OBS.app"),
            Path.home() / "Applications" / "OBS.app",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        if shutil.which("mdfind"):
            res = subprocess.run(
                ["mdfind", "kMDItemFSName == 'OBS.app'"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
            )
            for line in res.stdout.splitlines():
                p = Path(line.strip())
                if p.exists():
                    return p
        return None

    if sys.platform == "win32":
        candidates = [
            Path(os.environ.get("ProgramFiles", "C:\\Program Files"))
            / "obs-studio"
            / "bin"
            / "64bit"
            / "obs64.exe",
            Path(os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"))
            / "obs-studio"
            / "bin"
            / "64bit"
            / "obs64.exe",
        ]
        for candidate in candidates:
            if candidate.exists():
                return candidate
        found = shutil.which("obs64.exe") or shutil.which("obs64")
        return Path(found) if found else None

    found = shutil.which("obs")
    return Path(found) if found else None


def _is_obs_running() -> bool:
    if sys.platform == "win32":
        res = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq obs64.exe", "/NH"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        return "obs64.exe" in res.stdout.lower()

    pattern = "OBS" if sys.platform == "darwin" else "obs"
    res = subprocess.run(["pgrep", "-x", pattern], capture_output=True, check=False)
    return res.returncode == 0


def _launch_obs(minimize: bool = False) -> None:
    obs_target = _find_obs_executable()
    if obs_target is None:
        install_hint = (
            "Install OBS Studio first (e.g. `brew install --cask obs`)."
            if sys.platform == "darwin"
            else "Install OBS Studio and ensure obs64.exe / obs is available."
        )
        raise CliError("OBS_NOT_INSTALLED", "OBS Studio was not found on this machine.", hint=install_hint)

    if sys.platform == "darwin":
        cmd = ["open", "-a", str(obs_target)]
        if minimize:
            cmd.extend(["--args", "--minimize-to-tray"])
        res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", check=False)
        if res.returncode != 0:
            raise CliError("OBS_LAUNCH_FAILED", f"Failed to launch OBS.app: {res.stderr.strip() or res.stdout.strip()}")
        return

    cmd = [str(obs_target)]
    if minimize:
        cmd.append("--minimize-to-tray")
    try:
        subprocess.Popen(
            cmd,
            cwd=str(obs_target.parent),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as exc:
        raise CliError("OBS_LAUNCH_FAILED", f"Failed to launch OBS: {exc}") from exc


def _connect_obs(conn: dict[str, Any], timeout: float = 5.0):
    import obsws_python as obs
    from obsws_python.error import OBSSDKError

    logging.getLogger("obsws_python").setLevel(logging.CRITICAL)
    obs_cfg = conn["obs_ws_config"]
    if obs_cfg and obs_cfg.get("server_enabled") is False:
        raise CliError(
            "WEBSOCKET_DISABLED",
            "OBS WebSocket server is disabled in OBS settings.",
            hint="Open OBS -> Tools -> WebSocket Server Settings -> Enable WebSocket server, then retry.",
        )

    try:
        return obs.ReqClient(
            host=conn["host"],
            port=conn["port"],
            password=conn["password"],
            timeout=timeout,
        )
    except ConnectionRefusedError as exc:
        raise CliError(
            "CONNECTION_REFUSED",
            f"Cannot connect to OBS WebSocket at ws://{conn['host']}:{conn['port']}.",
            hint="Ensure OBS is running and WebSocket server is enabled on this port.",
        ) from exc
    except OBSSDKError as exc:
        msg = str(exc)
        code = "WEBSOCKET_AUTH_FAILED" if "auth" in msg.lower() else "OBS_SDK_ERROR"
        hint = (
            "Check WebSocket password in OBS Tools -> WebSocket Server Settings, or configure via `config set --password ...`."
            if code == "WEBSOCKET_AUTH_FAILED"
            else None
        )
        raise CliError(code, msg, hint=hint) from exc
    except Exception as exc:
        raise CliError("CONNECTION_ERROR", f"Failed to connect to OBS: {exc}") from exc


def _ensure_ready(conn: dict[str, Any], allow_launch: bool, wait_seconds: float, minimize: bool = False) -> dict[str, Any]:
    obs_cfg = conn["obs_ws_config"]
    if obs_cfg and obs_cfg.get("server_enabled") is False:
        raise CliError(
            "WEBSOCKET_DISABLED",
            "OBS WebSocket server is disabled (`server_enabled: false`).",
            hint="In OBS Studio, open Tools -> WebSocket Server Settings and check 'Enable WebSocket server'.",
        )

    launched = False
    if not _is_obs_running():
        if not allow_launch:
            raise CliError(
                "OBS_NOT_RUNNING",
                "OBS Studio is not running.",
                hint="Run `ensure --launch` or open OBS Studio manually.",
            )
        _launch_obs(minimize=minimize)
        launched = True

    deadline = time.monotonic() + max(wait_seconds, 1.0)
    last_err: CliError | None = None
    while time.monotonic() <= deadline:
        try:
            with _connect_obs(conn, timeout=3.0) as client:
                ver = client.get_version()
                return {
                    "ok": True,
                    "launched": launched,
                    "host": conn["host"],
                    "port": conn["port"],
                    "obs_version": ver.obs_version,
                    "obs_web_socket_version": ver.obs_web_socket_version,
                }
        except CliError as exc:
            last_err = exc
            if exc.code in ("WEBSOCKET_DISABLED", "WEBSOCKET_AUTH_FAILED"):
                raise
            time.sleep(0.5)

    if last_err is not None:
        raise last_err
    raise CliError("OBS_TIMEOUT", "Timed out waiting for OBS WebSocket to become ready.")


def _to_plain(obj: Any) -> Any:
    if is_dataclass(obj):
        return asdict(obj)
    return obj


def _record_status_payload(client) -> dict[str, Any]:
    st = client.get_record_status()
    rec_dir = client.get_record_directory().record_directory
    scene_info = client.get_scene_list()
    return {
        "recording": bool(st.output_active),
        "paused": bool(st.output_paused),
        "timecode": st.output_timecode,
        "duration_ms": st.output_duration,
        "bytes": st.output_bytes,
        "current_scene": scene_info.current_program_scene_name,
        "record_directory": rec_dir,
    }


def _resolve_start_target_dir(args: argparse.Namespace, conn: dict[str, Any]) -> tuple[str | None, dict[str, Any] | None]:
    """Decide target record directory and optional project metadata for `start`."""
    if args.record_dir:
        resolved = ws_mgr.absolute_path(args.record_dir)
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved), ws_mgr.get_active_project_info()

    if args.topic:
        proj = ws_mgr.init_project_dir(args.topic, args.workspace, set_active=True)
        return proj["raw_dir"], proj

    if args.use_obs_dir:
        return None, ws_mgr.get_active_project_info()

    if args.workspace:
        proj = ws_mgr.init_project_dir("屏幕录制", args.workspace, set_active=True)
        return proj["raw_dir"], proj

    active = ws_mgr.get_active_project_info()
    if active:
        Path(active["raw_dir"]).mkdir(parents=True, exist_ok=True)
        return active["raw_dir"], active

    if conn["record_directory"]:
        resolved = ws_mgr.absolute_path(conn["record_directory"])
        resolved.mkdir(parents=True, exist_ok=True)
        return str(resolved), None

    proj = ws_mgr.init_project_dir("屏幕录制", None, set_active=True)
    return proj["raw_dir"], proj


def cmd_doctor(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    obs_app = _find_obs_executable()
    obs_running = _is_obs_running()
    obs_cfg = conn["obs_ws_config"]
    ws_info_cfg = ws_mgr.resolve_workspace_dir(persist=False)
    active_proj = ws_mgr.get_active_project_info()
    issues: list[dict[str, str]] = []

    if obs_app is None:
        issues.append({
            "code": "OBS_NOT_INSTALLED",
            "message": "OBS Studio was not found on this machine.",
            "hint": "Install OBS Studio (on macOS: `brew install --cask obs`).",
        })
    if not SKILL_VENV_PYTHON.exists():
        issues.append({
            "code": "VENV_MISSING",
            "message": f"Expected venv python missing at {SKILL_VENV_PYTHON}",
            "hint": f"Create venv with `uv venv {SKILL_VENV_DIR}` and install obsws-python via `uv pip install`.",
        })
    if not obs_cfg:
        issues.append({
            "code": "OBS_WS_CONFIG_NOT_FOUND",
            "message": f"OBS WebSocket config not found at {OBS_WS_CONFIG_PATH}",
            "hint": "Launch OBS Studio once so it generates its default config.",
        })
    elif obs_cfg.get("server_enabled") is False:
        issues.append({
            "code": "WEBSOCKET_DISABLED",
            "message": "OBS WebSocket server is currently disabled (`server_enabled: false`).",
            "hint": "In OBS Studio: Tools -> WebSocket Server Settings -> check 'Enable WebSocket server' and click OK.",
        })

    ws_info: dict[str, Any] = {"connected": False}
    if obs_running and not any(i["code"] == "WEBSOCKET_DISABLED" for i in issues):
        try:
            with _connect_obs(conn, timeout=3.0) as client:
                ver = client.get_version()
                ws_info = {
                    "connected": True,
                    "obs_version": ver.obs_version,
                    "obs_web_socket_version": ver.obs_web_socket_version,
                    **_record_status_payload(client),
                }
        except CliError as exc:
            issues.append({
                "code": exc.code,
                "message": exc.message,
                "hint": exc.hint or "",
            })
    elif not obs_running:
        issues.append({
            "code": "OBS_NOT_RUNNING",
            "message": "OBS Studio process is not currently running.",
            "hint": "Run `obs_ctl.py ensure --launch` after enabling WebSocket.",
        })

    cfg_path = ws_mgr.get_config_path()
    return {
        "ok": len(issues) == 0,
        "platform": sys.platform,
        "obs_app": str(obs_app) if obs_app else None,
        "obs_running": obs_running,
        "venv_python": str(SKILL_VENV_PYTHON),
        "venv_exists": SKILL_VENV_PYTHON.exists(),
        "skill_config_path": str(cfg_path),
        "skill_config_exists": cfg_path.exists(),
        "workspace_dir": ws_info_cfg["dir"],
        "workspace_source": ws_info_cfg["source"],
        "active_project": active_proj,
        "obs_ws_config_path": str(OBS_WS_CONFIG_PATH),
        "obs_ws_server_enabled": obs_cfg.get("server_enabled") if obs_cfg else None,
        "connection_target": {
            "host": conn["host"],
            "port": conn["port"],
            "password_configured": bool(conn["password"]),
        },
        "websocket": ws_info,
        "issues": issues,
    }


def cmd_config(args: argparse.Namespace) -> dict[str, Any]:
    if args.config_action == "show":
        conn = _resolve_connection(args)
        ws_resolved = ws_mgr.resolve_workspace_dir(persist=False)
        return {
            "ok": True,
            "skill_config_path": str(ws_mgr.get_config_path()),
            "effective": {
                "host": conn["host"],
                "port": conn["port"],
                "password_configured": bool(conn["password"]),
                "workspace_dir": ws_resolved["dir"],
                "workspace_source": ws_resolved["source"],
                "active_project": ws_mgr.get_active_project_info(),
                "default_scene": conn["default_scene"],
                "record_directory": conn["record_directory"],
                "auto_launch": conn["auto_launch"],
            },
            "stored": ws_mgr.redact_config(conn["skill_config"]),
        }

    cfg = ws_mgr.read_config()
    if args.set_host is not None:
        cfg["host"] = args.set_host
    if args.set_port is not None:
        cfg["port"] = args.set_port
    if args.set_password is not None:
        cfg["password"] = args.set_password
    if args.clear_password:
        cfg.pop("password", None)
    if args.set_workspace is not None:
        ws_path = ws_mgr.absolute_path(args.set_workspace)
        ws_path.mkdir(parents=True, exist_ok=True)
        cfg["workspace_dir"] = str(ws_path)
    if args.default_scene is not None:
        cfg["default_scene"] = args.default_scene
    if args.record_dir is not None:
        cfg["record_directory"] = str(ws_mgr.absolute_path(args.record_dir))
    if args.clear_record_dir:
        cfg.pop("record_directory", None)
    if args.auto_launch is not None:
        cfg["auto_launch"] = args.auto_launch == "true"

    saved = ws_mgr.write_config(cfg)
    return {
        "ok": True,
        "skill_config_path": str(ws_mgr.get_config_path()),
        "stored": ws_mgr.redact_config(saved),
    }


def cmd_ensure(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    allow_launch = args.launch if args.launch is not None else conn["auto_launch"]
    return _ensure_ready(conn, allow_launch=allow_launch, wait_seconds=args.wait, minimize=args.minimize)


def cmd_scenes(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        res = client.get_scene_list()
        names = [s.get("sceneName") for s in reversed(res.scenes)]
        return {
            "ok": True,
            "current_scene": res.current_program_scene_name,
            "scenes": names,
        }


def cmd_scene(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        client.set_current_program_scene(args.name)
        res = client.get_scene_list()
        return {
            "ok": True,
            "current_scene": res.current_program_scene_name,
        }


def cmd_status(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        return {
            "ok": True,
            "active_project": ws_mgr.get_active_project_info(),
            **_record_status_payload(client),
        }


def cmd_start(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    allow_launch = args.launch if args.launch is not None else conn["auto_launch"]
    _ensure_ready(conn, allow_launch=allow_launch, wait_seconds=args.wait, minimize=args.minimize)

    with _connect_obs(conn) as client:
        st = client.get_record_status()
        if st.output_active:
            return {
                "ok": True,
                "already_recording": True,
                "active_project": ws_mgr.get_active_project_info(),
                **_record_status_payload(client),
            }

        target_dir, project_info = _resolve_start_target_dir(args, conn)
        if target_dir:
            client.set_record_directory(target_dir)

        target_scene = args.scene or conn["default_scene"]
        if target_scene:
            client.set_current_program_scene(target_scene)

        client.start_record()
        for _ in range(10):
            payload = _record_status_payload(client)
            if payload["recording"]:
                if project_info:
                    ws_mgr.append_project_log(
                        Path(project_info["project_path"]),
                        action="开始录屏",
                        scene=payload["current_scene"],
                    )
                return {
                    "ok": True,
                    "already_recording": False,
                    "active_project": project_info,
                    **payload,
                }
            time.sleep(0.15)
        return {
            "ok": True,
            "already_recording": False,
            "active_project": project_info,
            **_record_status_payload(client),
        }


def cmd_stop(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        st = client.get_record_status()
        if not st.output_active:
            return {
                "ok": True,
                "already_stopped": True,
                "recording": False,
                "output_path": None,
                "active_project": ws_mgr.get_active_project_info(),
            }
        scene_name = client.get_scene_list().current_program_scene_name
        res = client.stop_record()
        output_path = getattr(res, "output_path", None)
        file_size_bytes = None
        if output_path:
            out_file = Path(output_path)
            # OBS can finish finalizing the muxed file shortly after StopRecord returns.
            prev_size = -1
            for _ in range(20):
                if out_file.exists():
                    size = out_file.stat().st_size
                    if size > 0 and size == prev_size:
                        file_size_bytes = size
                        break
                    prev_size = size
                time.sleep(0.15)
            if file_size_bytes is None and out_file.exists():
                file_size_bytes = out_file.stat().st_size

        active = ws_mgr.get_active_project_info()
        if active and output_path:
            ws_mgr.append_project_log(
                Path(active["project_path"]),
                action="完成录屏",
                scene=scene_name,
                file_path=output_path,
            )
        return {
            "ok": True,
            "already_stopped": False,
            "recording": False,
            "output_path": output_path,
            "file_size_bytes": file_size_bytes,
            "active_project": active,
        }


def cmd_pause(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        client.pause_record()
        for _ in range(10):
            payload = _record_status_payload(client)
            if payload["paused"]:
                return {"ok": True, **payload}
            time.sleep(0.1)
        return {"ok": True, **_record_status_payload(client)}


def cmd_resume(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        client.resume_record()
        for _ in range(10):
            payload = _record_status_payload(client)
            if not payload["paused"]:
                return {"ok": True, **payload}
            time.sleep(0.1)
        return {"ok": True, **_record_status_payload(client)}


def cmd_screenshot(args: argparse.Namespace) -> dict[str, Any]:
    conn = _resolve_connection(args)
    with _connect_obs(conn) as client:
        source_name = args.source
        if not source_name:
            source_name = client.get_scene_list().current_program_scene_name

        active = ws_mgr.get_active_project_info()
        if args.out:
            out_path = ws_mgr.absolute_path(args.out)
        elif active:
            stamp = time.strftime("%Y%m%d-%H%M%S")
            out_path = Path(active["screenshot_dir"]) / f"obs-screenshot-{stamp}.{args.format}"
        else:
            rec_dir = Path(client.get_record_directory().record_directory)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            out_path = rec_dir / f"obs-screenshot-{stamp}.{args.format}"

        out_path.parent.mkdir(parents=True, exist_ok=True)
        client.save_source_screenshot(
            name=source_name,
            img_format=args.format,
            file_path=str(out_path),
            width=args.width,
            height=args.height,
            quality=args.quality,
        )
        if active:
            ws_mgr.append_project_log(
                Path(active["project_path"]),
                action="画面截图",
                scene=source_name,
                file_path=str(out_path),
            )
        return {
            "ok": True,
            "source": source_name,
            "format": args.format,
            "file_path": str(out_path),
            "active_project": active,
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="obs_ctl.py",
        description="Control OBS Studio via WebSocket v5 and output structured JSON.",
    )
    parser.add_argument("--host", help="OBS WebSocket host (default: localhost)")
    parser.add_argument("--port", type=int, help="OBS WebSocket port (default: 4455)")
    parser.add_argument("--password", help="OBS WebSocket password")

    sub = parser.add_subparsers(dest="command", required=True)

    p_doc = sub.add_parser("doctor", help="Check OBS install, process, venv, and WebSocket readiness")
    p_doc.set_defaults(func=cmd_doctor)

    p_cfg = sub.add_parser("config", help="View or update ~/.shrimp/skills/leo-obs-studio/config.json")
    cfg_sub = p_cfg.add_subparsers(dest="config_action", required=True)
    p_cfg_show = cfg_sub.add_parser("show", help="Show effective and stored config")
    p_cfg_show.set_defaults(func=cmd_config)
    p_cfg_set = cfg_sub.add_parser("set", help="Update stored config values")
    p_cfg_set.add_argument("--host", dest="set_host")
    p_cfg_set.add_argument("--port", dest="set_port", type=int)
    p_cfg_set.add_argument("--password", dest="set_password")
    p_cfg_set.add_argument("--clear-password", action="store_true")
    p_cfg_set.add_argument("--workspace", dest="set_workspace", help="Default workspace directory")
    p_cfg_set.add_argument("--default-scene")
    p_cfg_set.add_argument("--record-dir")
    p_cfg_set.add_argument("--clear-record-dir", action="store_true")
    p_cfg_set.add_argument("--auto-launch", choices=["true", "false"])
    p_cfg_set.set_defaults(func=cmd_config)

    p_ens = sub.add_parser("ensure", help="Ensure OBS is running and WebSocket is ready")
    p_ens.add_argument("--launch", action=argparse.BooleanOptionalAction, default=None)
    p_ens.add_argument("--minimize", action="store_true", help="Launch minimized to tray if launching")
    p_ens.add_argument("--wait", type=float, default=15.0, help="Seconds to wait for readiness")
    p_ens.set_defaults(func=cmd_ensure)

    p_scenes = sub.add_parser("scenes", help="List available scenes")
    p_scenes.set_defaults(func=cmd_scenes)

    p_scene = sub.add_parser("scene", help="Switch active program scene")
    p_scene.add_argument("name", help="Target scene name")
    p_scene.set_defaults(func=cmd_scene)

    p_status = sub.add_parser("status", help="Get current recording status and scene")
    p_status.set_defaults(func=cmd_status)

    p_start = sub.add_parser("start", help="Ensure OBS ready, resolve archive dir, and start recording")
    p_start.add_argument("--topic", help="Recording topic (creates YYYY-MM-DD-<topic> project dir)")
    p_start.add_argument("--workspace", help="Workspace override (persisted to config.json)")
    p_start.add_argument("--scene", help="Scene name to switch to before recording")
    p_start.add_argument("--record-dir", help="One-off output directory override")
    p_start.add_argument("--use-obs-dir", action="store_true", help="Use OBS GUI current record directory as-is")
    p_start.add_argument("--launch", action=argparse.BooleanOptionalAction, default=None)
    p_start.add_argument("--minimize", action="store_true", help="Launch minimized if OBS is not running")
    p_start.add_argument("--wait", type=float, default=15.0, help="Seconds to wait if launching OBS")
    p_start.set_defaults(func=cmd_start)

    p_stop = sub.add_parser("stop", help="Stop recording and return output video path")
    p_stop.set_defaults(func=cmd_stop)

    p_pause = sub.add_parser("pause", help="Pause current recording")
    p_pause.set_defaults(func=cmd_pause)

    p_resume = sub.add_parser("resume", help="Resume paused recording")
    p_resume.set_defaults(func=cmd_resume)

    p_shot = sub.add_parser("screenshot", help="Save a screenshot of a scene or source")
    p_shot.add_argument("--source", help="Scene or source name (default: current scene)")
    p_shot.add_argument("--out", help="Output file path")
    p_shot.add_argument("--format", default="png", choices=["png", "jpg", "jpeg", "bmp", "webp"])
    p_shot.add_argument("--width", type=int, default=None)
    p_shot.add_argument("--height", type=int, default=None)
    p_shot.add_argument("--quality", type=int, default=-1)
    p_shot.set_defaults(func=cmd_screenshot)

    return parser


def main() -> int:
    from obsws_python.error import OBSSDKRequestError

    parser = build_parser()
    args = parser.parse_args()
    try:
        result = args.func(args)
        print(json.dumps(_to_plain(result), ensure_ascii=False, indent=2))
        return 0
    except ws_mgr.ConfigError as exc:
        err_payload = {
            "ok": False,
            "error": {
                "code": "CONFIG_ERROR",
                "message": str(exc),
            },
        }
        print(json.dumps(err_payload, ensure_ascii=False, indent=2))
        return 3
    except OBSSDKRequestError as exc:
        hint = None
        if getattr(exc, "code", None) == 503:
            hint = "OBS is not in the required output state for this action (e.g. pause may be unsupported under 'Same as stream' encoder, or output is not paused)."
        err_payload = {
            "ok": False,
            "error": {
                "code": "OBS_REQUEST_ERROR",
                "message": str(exc),
                "hint": hint,
                "details": {"req_name": getattr(exc, "req_name", None), "obs_code": getattr(exc, "code", None)},
            },
        }
        print(json.dumps(err_payload, ensure_ascii=False, indent=2))
        return 1
    except CliError as exc:
        err_payload = {
            "ok": False,
            "error": {
                "code": exc.code,
                "message": exc.message,
                "hint": exc.hint,
                "details": exc.details,
            },
        }
        print(json.dumps(err_payload, ensure_ascii=False, indent=2))
        return 1
    except Exception as exc:
        err_payload = {
            "ok": False,
            "error": {
                "code": "UNEXPECTED_ERROR",
                "message": str(exc),
            },
        }
        print(json.dumps(err_payload, ensure_ascii=False, indent=2))
        return 1


if __name__ == "__main__":
    sys.exit(main())
