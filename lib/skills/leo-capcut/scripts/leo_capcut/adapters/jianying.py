from __future__ import annotations

import json
import shutil
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Protocol

from ..crypto import IsolatedJianyingCodec
from ..detect import WindowsProcessChecker, detect_environment, normalize_platform
from ..errors import JianyingBusyError, JianyingCapabilityError, JianyingPublishError
from ..jianying_writer import build_draft_payloads, write_auxiliary_files
from ..timeline_ir import Timeline, validate_timeline
from ..util import copy_file, write_json

__all__ = [
    "JianyingAdapter",
    "JianyingBusyError",
    "JianyingCapabilityError",
    "JianyingPublishError",
    "PublishResult",
]


class ProcessChecker(Protocol):
    def is_running(self) -> bool: ...


class DraftCodec(Protocol):
    def encode(self, payload: dict) -> bytes: ...
    def decode(self, raw: bytes) -> dict: ...


class DefaultProcessChecker:
    def is_running(self) -> bool:
        return False


class PlaintextCodec:
    def encode(self, payload: dict) -> bytes:
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    def decode(self, raw: bytes) -> dict:
        return json.loads(raw.decode("utf-8"))


@dataclass
class PublishResult:
    project_id: str
    draft_dir: str
    backup_path: str | None
    registered: bool
    platform: str


def _root_meta_path(user_data: Path) -> Path:
    return user_data / "Projects" / "com.lveditor.draft" / "root_meta_info.json"


def _copy_media(timeline: Timeline, draft_dir: Path) -> dict[str, Path]:
    media_dir = draft_dir / "agent_media"
    media_dir.mkdir(parents=True, exist_ok=True)
    copied: dict[str, Path] = {}
    for asset in timeline.assets:
        source = Path(asset.uri)
        if not source.is_file():
            continue
        target = media_dir / source.name
        copy_file(source, target)
        copied[asset.id] = target
    return copied


class JianyingAdapter:
    def __init__(
        self,
        *,
        platform: str = "windows",
        draft_root: Path,
        user_data: Path,
        install_dir: Path | None = None,
        process_checker: ProcessChecker | None = None,
        codec: DraftCodec | None = None,
    ) -> None:
        self.platform = normalize_platform(platform)
        self.draft_root = Path(draft_root)
        self.user_data = Path(user_data)
        self.install_dir = Path(install_dir) if install_dir else None
        self.process_checker = process_checker or DefaultProcessChecker()
        self.codec = codec or PlaintextCodec()

    @classmethod
    def detect(cls, platform: str | None = None, **kwargs) -> "JianyingAdapter":
        env = detect_environment(platform)
        normalized = env["platform"]
        draft_root = Path(kwargs["draft_root"]) if kwargs.get("draft_root") else Path(env["draft_root"] or ".")
        user_data = Path(kwargs["user_data"]) if kwargs.get("user_data") else Path(env["user_data"] or ".")
        install_dir = Path(kwargs["install_dir"]) if kwargs.get("install_dir") else (Path(env["install_dir"]) if env.get("install_dir") else None)
        process_checker = kwargs.get("process_checker")
        if process_checker is None and normalized == "windows":
            process_checker = WindowsProcessChecker()
        codec = kwargs.get("codec")
        if codec is None and normalized == "windows" and install_dir and (install_dir / "videoeditor.dll").is_file():
            codec = IsolatedJianyingCodec(install_dir)
        return cls(
            platform=normalized,
            draft_root=draft_root,
            user_data=user_data,
            install_dir=install_dir,
            process_checker=process_checker,
            codec=codec,
        )

    def capabilities(self) -> dict[str, Any]:
        if self.platform == "windows":
            return {
                "platform": "windows",
                "status": "implemented",
                "can_publish": True,
                "can_register": True,
                "verified": "locally verified",
            }
        if self.platform == "darwin":
            return {
                "platform": "macos",
                "status": "planned",
                "can_publish": False,
                "can_register": False,
                "verified": "requires native verification",
                "blocker": "macOS Jianying draft encryption, homepage index, and app bundle layout have not been verified on this host.",
            }
        return {
            "platform": self.platform,
            "status": "unsupported",
            "can_publish": False,
            "can_register": False,
        }

    def publish(self, timeline: Mapping[str, Any] | Timeline, *, project_name: str, register: bool = True) -> PublishResult:
        caps = self.capabilities()
        if not caps.get("can_publish"):
            raise JianyingCapabilityError(caps.get("blocker") or f"{self.platform} publish is not implemented")
        if register and self.process_checker.is_running():
            raise JianyingBusyError("Jianying is running; refusing to modify the homepage index")

        validated = validate_timeline(timeline)
        object.__setattr__(validated, "project_name", project_name) if False else None
        timeline_payload = dict(validated.raw)
        timeline_payload["project_name"] = project_name
        validated = validate_timeline(timeline_payload)

        draft_dir = self.draft_root / project_name
        if draft_dir.exists():
            raise FileExistsError(f"draft directory already exists: {draft_dir}")

        root_meta = _root_meta_path(self.user_data)
        before_bytes = b""
        backup_path: Path | None = None
        if register:
            if not root_meta.is_file():
                raise FileNotFoundError(f"homepage index is missing: {root_meta}")
            before_bytes = root_meta.read_bytes()
            backup_dir = self.draft_root / ".agent-backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            backup_path = backup_dir / f"root_meta_info.before-{stamp}-{time.time_ns()}.json"
            backup_path.write_bytes(before_bytes)

        quarantine_dir = self.draft_root / ".agent-backups" / f"failed-{project_name}-{time.time_ns()}"
        project_id = str(uuid.uuid4()).upper()
        try:
            draft_dir.mkdir(parents=True, exist_ok=False)
            copied = _copy_media(validated, draft_dir)
            content, meta = build_draft_payloads(
                validated,
                project_id,
                project_name,
                copied,
                draft_dir,
            )
            encoded_content = self.codec.encode(content)
            encoded_meta = self.codec.encode(meta)
            (draft_dir / "draft_content.json").write_bytes(encoded_content)
            (draft_dir / "draft_meta_info.json").write_bytes(encoded_meta)
            write_auxiliary_files(draft_dir, encoded_content, project_id)
            if register:
                payload = json.loads(before_bytes.decode("utf-8-sig"))
                entries = list(payload.get("all_draft_store") or [])
                entries.append(
                    {
                        "draft_id": project_id,
                        "draft_name": project_name,
                        "draft_fold_path": str(draft_dir).replace("\\", "/"),
                        "tm_duration": validated.duration_us,
                    }
                )
                payload["all_draft_store"] = entries
                write_json(root_meta, payload)
            return PublishResult(
                project_id=project_id,
                draft_dir=str(draft_dir),
                backup_path=str(backup_path) if backup_path else None,
                registered=register,
                platform=self.platform,
            )
        except FileExistsError:
            raise
        except Exception as exc:
            if register and before_bytes:
                root_meta.write_bytes(before_bytes)
            if draft_dir.exists():
                quarantine_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(draft_dir), str(quarantine_dir))
            raise JianyingPublishError(str(exc)) from exc
