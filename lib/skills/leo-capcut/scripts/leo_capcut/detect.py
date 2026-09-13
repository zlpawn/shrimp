from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from typing import Any


def normalize_platform(platform: str | None = None) -> str:
    value = (platform or sys.platform or "").strip().lower()
    if value in {"win32", "windows", "win"}:
        return "windows"
    if value in {"darwin", "macos", "mac", "osx"}:
        return "darwin"
    return value or "windows"


def _env_path(name: str) -> Path | None:
    value = os.environ.get(name)
    if not value:
        return None
    path = Path(value).expanduser()
    return path if path.exists() else None


def find_windows_install_dir() -> Path | None:
    override = _env_path("LEO_CAPCUT_JY_INSTALL_DIR")
    if override and (override / "videoeditor.dll").is_file():
        return override
    roots = [
        Path(r"D:/JianyingPro"),
        Path(r"C:/JianyingPro"),
        Path(os.environ.get("ProgramFiles", r"C:/Program Files")) / "JianyingPro",
        Path(os.environ.get("LOCALAPPDATA", "")) / "JianyingPro",
    ]
    candidates: list[Path] = []
    for root in roots:
        if not root.is_dir():
            continue
        if (root / "videoeditor.dll").is_file():
            candidates.append(root)
        for child in root.iterdir():
            if child.is_dir() and (child / "videoeditor.dll").is_file():
                candidates.append(child)
    if not candidates:
        return None
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)[0]


def find_windows_draft_root() -> Path | None:
    override = _env_path("LEO_CAPCUT_JY_DRAFT_ROOT")
    if override:
        return override
    home = Path.home()
    candidates = [
        Path(r"D:/素材/视频草稿/JianyingPro Drafts"),
        home / "Documents" / "JianyingPro Drafts",
        home / "JianyingPro Drafts",
    ]
    for path in candidates:
        if path.is_dir():
            return path
    return None


def find_windows_user_data() -> Path | None:
    override = _env_path("LEO_CAPCUT_JY_USER_DATA")
    if override:
        return override
    local = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    path = local / "JianyingPro" / "User Data"
    return path if path.exists() else None


class WindowsProcessChecker:
    def is_running(self) -> bool:
        if sys.platform != "win32":
            return False
        completed = subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq JianyingPro.exe", "/NH"],
            check=False,
            capture_output=True,
        )
        return b"jianyingpro.exe" in completed.stdout.lower()


def detect_environment(platform: str | None = None) -> dict[str, Any]:
    normalized = normalize_platform(platform)
    env: dict[str, Any] = {"platform": normalized}
    if normalized == "windows":
        install = find_windows_install_dir()
        drafts = find_windows_draft_root()
        user_data = find_windows_user_data()
        env.update({
            "install_dir": str(install) if install else None,
            "has_videoeditor_dll": bool(install and (install / "videoeditor.dll").is_file()),
            "draft_root": str(drafts) if drafts else None,
            "user_data": str(user_data) if user_data else None,
            "jianying_running": WindowsProcessChecker().is_running(),
        })
    else:
        env.update({
            "install_dir": None,
            "draft_root": None,
            "user_data": None,
            "jianying_running": False,
            "note": "macOS detection requires native verification",
        })
    return env
