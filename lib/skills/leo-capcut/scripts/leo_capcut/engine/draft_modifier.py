from __future__ import annotations

import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from ..crypto import IsolatedJianyingCodec
from ..detect import detect_environment


def inspect_draft_dict(content: dict[str, Any]) -> dict[str, Any]:
    """Produce a concise high-level summary of a draft JSON for LLMs."""
    duration_us = content.get("duration", 0)
    canvas = content.get("canvas_config", {})
    materials = content.get("materials", {})

    video_map = {m["id"]: m.get("path", "") for m in materials.get("videos", [])}
    audio_map = {m["id"]: m.get("path", "") for m in materials.get("audios", [])}
    text_map = {}
    for m in materials.get("texts", []):
        try:
            parsed = json.loads(m.get("content", "{}"))
            text_map[m["id"]] = parsed.get("text", "")
        except Exception:
            text_map[m["id"]] = ""

    tracks_summary: list[dict[str, Any]] = []
    for trk in content.get("tracks", []):
        t_type = trk.get("type", "unknown")
        t_id = trk.get("id", "")
        clips: list[dict[str, Any]] = []
        for idx, seg in enumerate(trk.get("segments", [])):
            tr = seg.get("target_timerange", {})
            mat_id = seg.get("material_id", "")
            clip_info: dict[str, Any] = {
                "index": idx,
                "id": seg.get("id", ""),
                "start_sec": round(tr.get("start", 0) / 1_000_000, 2),
                "duration_sec": round(tr.get("duration", 0) / 1_000_000, 2),
            }
            if t_type == "video":
                clip_info["asset"] = video_map.get(mat_id, "")
            elif t_type == "audio":
                clip_info["asset"] = audio_map.get(mat_id, "")
                clip_info["volume"] = seg.get("volume", 1.0)
            elif t_type == "text":
                clip_info["text"] = text_map.get(mat_id, "")
            clips.append(clip_info)

        tracks_summary.append({
            "id": t_id,
            "type": t_type,
            "clips_count": len(clips),
            "clips": clips,
        })

    return {
        "duration_sec": round(duration_us / 1_000_000, 2),
        "canvas": {
            "width": canvas.get("width", 1080),
            "height": canvas.get("height", 1920),
            "fps": canvas.get("fps", 30.0),
        },
        "tracks": tracks_summary,
    }


def read_draft_content(draft_dir: Path, env: dict[str, Any] | None = None) -> dict[str, Any]:
    """Read and decrypt draft_content.json from a draft directory."""
    draft_path = Path(draft_dir) / "draft_content.json"
    if not draft_path.is_file():
        raise FileNotFoundError(f"draft_content.json not found in {draft_dir}")

    raw = draft_path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]

    if raw.lstrip().startswith(b"{"):
        return json.loads(raw.decode("utf-8"))

    if env is None:
        env = detect_environment()
    install_dir = env.get("install_dir")
    if not install_dir:
        raise RuntimeError("Cannot decrypt draft: Jianying install directory not found")

    codec = IsolatedJianyingCodec(Path(install_dir))
    return codec.decode(raw)


def inspect_draft(draft_dir: Path, env: dict[str, Any] | None = None) -> dict[str, Any]:
    """Inspect an existing draft folder and return its high-level structure."""
    draft_dir = Path(draft_dir)
    content = read_draft_content(draft_dir, env=env)
    summary = inspect_draft_dict(content)
    summary["draft_id"] = content.get("id", "")
    summary["draft_name"] = draft_dir.name
    return summary


def apply_patch_operations(
    draft_content: dict[str, Any],
    operations: list[dict[str, Any]],
    asset_copy_dir: Path,
) -> dict[str, Any]:
    """Apply declarative patch operations to draft JSON content."""
    content = json.loads(json.dumps(draft_content))
    materials = content.setdefault("materials", {})
    audios = materials.setdefault("audios", [])
    texts = materials.setdefault("texts", [])
    videos = materials.setdefault("videos", [])
    tracks = content.setdefault("tracks", [])

    for op in operations:
        action = op.get("action", "")
        track_id = op.get("track_id", "")

        target_track = None
        for t in tracks:
            if t.get("id") == track_id or (track_id and t.get("type") == track_id):
                target_track = t
                break

        if action in ("replace_audio", "replace_asset") and target_track:
            new_asset = Path(op["new_asset"])
            mat_id = uuid.uuid4().hex
            dest = asset_copy_dir / f"{mat_id[:8]}_{new_asset.name}"
            if new_asset.resolve() != dest.resolve():
                shutil.copy2(new_asset, dest)

            track_type = target_track.get("type", "audio")
            if track_type == "audio":
                audios.append({
                    "id": mat_id,
                    "path": str(dest),
                    "name": new_asset.name,
                    "duration": content.get("duration", 10_000_000),
                    "type": "extract_music",
                })
            else:
                videos.append({
                    "id": mat_id,
                    "path": str(dest),
                    "name": new_asset.name,
                    "duration": content.get("duration", 10_000_000),
                    "type": "video",
                })

            seg_idx = op.get("segment_index", 0)
            if 0 <= seg_idx < len(target_track.get("segments", [])):
                seg = target_track["segments"][seg_idx]
                seg["material_id"] = mat_id
                if "volume" in op:
                    seg["volume"] = float(op["volume"])

        elif action == "update_text" and target_track:
            seg_idx = op.get("segment_index", 0)
            if 0 <= seg_idx < len(target_track.get("segments", [])):
                seg = target_track["segments"][seg_idx]
                mat_id = seg.get("material_id", "")
                text_mat = next((m for m in texts if m.get("id") == mat_id), None)
                if text_mat:
                    try:
                        parsed = json.loads(text_mat.get("content", "{}"))
                    except Exception:
                        parsed = {}
                    parsed["text"] = op.get("new_text", "")
                    text_mat["content"] = json.dumps(parsed, ensure_ascii=False)

        elif action == "adjust_volume" and target_track:
            seg_idx = op.get("segment_index", 0)
            if 0 <= seg_idx < len(target_track.get("segments", [])):
                target_track["segments"][seg_idx]["volume"] = float(op["volume"])

        elif action == "delete_clip" and target_track:
            seg_idx = op.get("segment_index", 0)
            if 0 <= seg_idx < len(target_track.get("segments", [])):
                target_track["segments"].pop(seg_idx)

    return content


def publish_draft_safely(
    draft_dir: Path,
    draft_id: str,
    draft_name: str,
    duration_us: int = 0,
    env: dict[str, Any] | None = None,
) -> Path | None:
    """Register a draft to root_meta_info.json safely with backup and process check."""
    if env is None:
        env = detect_environment()
    if env.get("jianying_running", False):
        raise RuntimeError(
            "Jianying is currently running; please close it before registering drafts to avoid corrupted metadata."
        )

    user_data = env.get("user_data")
    if not user_data:
        return None

    root_meta = Path(user_data) / "Projects" / "com.lveditor.draft" / "root_meta_info.json"
    if not root_meta.is_file():
        return None

    before_bytes = root_meta.read_bytes()
    backup_dir = Path(draft_dir).parent / ".agent-backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"root_meta_info.before-{stamp}-{time.time_ns()}.json"
    backup_path.write_bytes(before_bytes)

    try:
        payload = json.loads(before_bytes.decode("utf-8-sig"))
        entries = list(payload.get("all_draft_store") or [])
        entries.append({
            "draft_id": draft_id,
            "draft_name": draft_name,
            "draft_fold_path": str(draft_dir).replace("\\", "/"),
            "tm_duration": duration_us,
        })
        payload["all_draft_store"] = entries
        root_meta.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        return backup_path
    except Exception as exc:
        root_meta.write_bytes(before_bytes)
        raise exc


def modify_draft_copy(
    src_draft_dir: Path,
    out_name: str,
    operations: list[dict[str, Any]],
    publish: bool = True,
    env: dict[str, Any] | None = None,
) -> Path:
    """Safely clone an existing draft directory and apply patch operations."""
    src_draft_dir = Path(src_draft_dir)
    dest_dir = src_draft_dir.parent / out_name
    if dest_dir.exists():
        raise FileExistsError(f"Target draft directory already exists: {dest_dir}")

    if env is None:
        env = detect_environment()

    # Pre-check running state before copying to avoid partial/orphaned state
    if publish and env.get("jianying_running", False):
        raise RuntimeError(
            "Jianying is currently running; please close it before registering drafts to avoid corrupted metadata."
        )

    shutil.copytree(src_draft_dir, dest_dir)
    try:
        asset_dir = dest_dir / "agent_media"
        asset_dir.mkdir(parents=True, exist_ok=True)

        content = read_draft_content(src_draft_dir, env=env)
        new_id = str(uuid.uuid4()).upper()
        content["id"] = new_id

        patched = apply_patch_operations(content, operations, asset_copy_dir=asset_dir)

        # Check whether source draft was encrypted
        src_content_file = src_draft_dir / "draft_content.json"
        src_raw = src_content_file.read_bytes() if src_content_file.is_file() else b""
        if src_raw.startswith(b"\xef\xbb\xbf"):
            src_raw = src_raw[3:]
        needs_encryption = not src_raw.lstrip().startswith(b"{") if src_raw else False

        install_dir = env.get("install_dir")
        if needs_encryption and not install_dir:
            raise RuntimeError("Draft requires encryption but Jianying install directory not found")

        encoded_bytes = None
        if install_dir:
            codec = IsolatedJianyingCodec(Path(install_dir))
            # Strict fuse: do not swallow exceptions or silently downgrade to plaintext
            encoded_bytes = codec.encode(patched)
            (dest_dir / "draft_content.json").write_bytes(encoded_bytes)
        else:
            (dest_dir / "draft_content.json").write_text(
                json.dumps(patched, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

        meta_path = dest_dir / "draft_meta_info.json"
        if meta_path.is_file():
            meta_raw = meta_path.read_bytes()
            if meta_raw.startswith(b"\xef\xbb\xbf"):
                meta_raw = meta_raw[3:]
            meta_is_plain = meta_raw.lstrip().startswith(b"{")
            if meta_is_plain:
                meta_data = json.loads(meta_raw.decode("utf-8"))
            elif install_dir:
                codec = IsolatedJianyingCodec(Path(install_dir))
                meta_data = codec.decode(meta_raw)
            else:
                raise RuntimeError("draft_meta_info.json is encrypted but Jianying install directory not found")

            meta_data["draft_id"] = new_id
            meta_data["draft_name"] = out_name

            if install_dir:
                codec = IsolatedJianyingCodec(Path(install_dir))
                meta_path.write_bytes(codec.encode(meta_data))
            else:
                meta_path.write_text(
                    json.dumps(meta_data, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )

        if publish:
            publish_draft_safely(
                dest_dir,
                new_id,
                out_name,
                duration_us=patched.get("duration", 0),
                env=env,
            )

        return dest_dir
    except Exception:
        if dest_dir.exists():
            shutil.rmtree(dest_dir, ignore_errors=True)
        raise
