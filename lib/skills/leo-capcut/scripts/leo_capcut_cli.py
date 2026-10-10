#!/usr/bin/env python3
"""Command-line entry for leo-capcut."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
from typing import Any
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.detect import detect_environment
from leo_capcut.engine.draft_modifier import inspect_draft, modify_draft_copy, read_draft_content
from leo_capcut.engine.ffmpeg_renderer import assert_render_quality, render_timeline_mp4
from leo_capcut.engine.font_embedder import embed_font_into_draft
from leo_capcut.engine.speech_planner import plan_speech_cut
from leo_capcut.orchestrator import run_pipeline
from leo_capcut.preset_store import PresetStore
from leo_capcut.timeline_ir import Asset, Canvas, Clip, Timeline, Track, validate_timeline


def _draft_to_timeline(content: dict[str, Any], project_name: str = "draft_export") -> Timeline:
    canvas_cfg = content.get("canvas_config", {})
    canvas = Canvas(
        width=int(canvas_cfg.get("width", 1080)),
        height=int(canvas_cfg.get("height", 1920)),
        fps=int(canvas_cfg.get("fps", 30)),
    )
    duration_us = content.get("duration", 0)
    materials = content.get("materials", {})

    assets: list[Asset] = []
    for m in materials.get("videos", []):
        m_id = m.get("id")
        p = m.get("path", "")
        if p:
            assets.append(Asset(id=m_id, kind="video", uri=p, duration_us=m.get("duration")))

    for m in materials.get("audios", []):
        m_id = m.get("id")
        p = m.get("path", "")
        if p:
            assets.append(Asset(id=m_id, kind="audio", uri=p, duration_us=m.get("duration")))

    text_map: dict[str, str] = {}
    for m in materials.get("texts", []):
        m_id = m.get("id")
        try:
            parsed = json.loads(m.get("content", "{}"))
            text_map[m_id] = parsed.get("text", "")
        except Exception:
            text_map[m_id] = ""

    tracks: list[Track] = []
    for trk in content.get("tracks", []):
        t_type = trk.get("type", "video")
        t_id = trk.get("id", str(uuid.uuid4()))
        clips: list[Clip] = []
        for idx, seg in enumerate(trk.get("segments", [])):
            tr = seg.get("target_timerange", {})
            start_us = tr.get("start", 0)
            dur_us = tr.get("duration", 0)
            mat_id = seg.get("material_id", "")
            if t_type == "video":
                clips.append(Clip(id=seg.get("id", f"v_{idx}"), asset_id=mat_id, start_us=start_us, duration_us=dur_us))
            elif t_type == "audio":
                clips.append(Clip(id=seg.get("id", f"a_{idx}"), asset_id=mat_id, start_us=start_us, duration_us=dur_us, volume=seg.get("volume", 1.0)))
            elif t_type == "text":
                clips.append(Clip(id=seg.get("id", f"t_{idx}"), text=text_map.get(mat_id, ""), start_us=start_us, duration_us=dur_us))
        tracks.append(Track(id=t_id, type=t_type, name=trk.get("name", t_type), clips=tuple(clips)))

    return Timeline(
        schema_version="1.0",
        project_name=content.get("id") or project_name,
        canvas=canvas,
        duration_us=duration_us,
        assets=tuple(assets),
        tracks=tuple(tracks),
    )


def cmd_doctor(_: argparse.Namespace) -> int:
    env = detect_environment(sys.platform)
    adapter = JianyingAdapter.detect(sys.platform)
    payload = {"environment": env, "capabilities": adapter.capabilities()}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    media = [Path(item) for item in (args.media or [])]
    result = run_pipeline(
        args.text,
        media_paths=media,
        template_root=ROOT / "assets" / "templates",
        publish=False,
    )
    draft_root = Path(args.draft_root) if args.draft_root else Path.cwd() / "leo-capcut-output"
    user_data = Path(args.user_data) if args.user_data else draft_root / "user-data"
    draft_root.mkdir(parents=True, exist_ok=True)
    user_data.mkdir(parents=True, exist_ok=True)
    adapter = JianyingAdapter.detect(
        sys.platform,
        draft_root=draft_root,
        user_data=user_data,
        install_dir=Path(args.install_dir) if args.install_dir else None,
    )
    published = adapter.publish(result.timeline, project_name=args.name or result.brief.title, register=bool(args.register))
    print(json.dumps({
        "brief": result.brief.to_dict(),
        "draft_dir": published.draft_dir,
        "project_id": published.project_id,
        "registered": published.registered,
        "backup_path": published.backup_path,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    media = [Path(item) for item in (args.media or [])]
    result = run_pipeline(
        args.text,
        media_paths=media,
        template_root=ROOT / "assets" / "templates",
        publish=False,
    )
    print(json.dumps({
        "brief": result.brief.to_dict(),
        "script": result.artifacts["script"],
        "storyboard": result.artifacts["storyboard"],
        "timeline": result.timeline.raw,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_save_preset(args: argparse.Namespace) -> int:
    store = PresetStore(Path(args.store) if args.store else Path.home() / ".leo-capcut" / "presets")
    saved = store.save(
        {
            "id": args.id,
            "inherits": {"scenario": args.scenario, "platform": args.platform, "style": args.style},
            "overrides": {"duration_seconds": args.duration} if args.duration else {},
        },
        explicit=True,
        intent=args.intent,
    )
    print(json.dumps({"id": saved["id"], "path": saved["path"]}, ensure_ascii=False, indent=2))
    return 0


def cmd_catalog(_: argparse.Namespace) -> int:
    from leo_capcut.registry import AssetRegistry
    reg = AssetRegistry.get()
    cats = reg.list_categories()
    payload = {
        "total_categories": len(cats),
        "total_native_assets": sum(cats.values()),
        "categories": cats,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_query_enum(args: argparse.Namespace) -> int:
    from leo_capcut.registry import AssetRegistry
    reg = AssetRegistry.get()
    results = reg.search(args.category, keyword=args.keyword or "", limit=args.limit)
    payload = {
        "category": args.category,
        "keyword": args.keyword,
        "count": len(results),
        "results": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_speech_cut(args: argparse.Namespace) -> int:
    media_path = Path(args.media).resolve()
    if not media_path.is_file():
        raise FileNotFoundError(f"media file not found: {media_path}")

    transcript_segments: list[dict[str, Any]] = []
    if args.transcript:
        t_path = Path(args.transcript).resolve()
        if not t_path.is_file():
            raise FileNotFoundError(f"transcript file not found: {t_path}")
        raw_data = json.loads(t_path.read_text(encoding="utf-8"))
        if isinstance(raw_data, list):
            items = raw_data
        elif isinstance(raw_data, dict):
            items = raw_data.get("segments") or raw_data.get("words") or raw_data.get("transcription") or []
        else:
            items = []

        for item in items:
            s_us = item.get("start_us")
            e_us = item.get("end_us")
            if s_us is None and "start" in item:
                s_us = int(float(item["start"]) * 1_000_000)
            if e_us is None and "end" in item:
                e_us = int(float(item["end"]) * 1_000_000)
            transcript_segments.append({
                "start_us": s_us or 0,
                "end_us": e_us or 0,
                "text": item.get("text", "").strip(),
            })

    total_duration_us = 0
    try:
        cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(media_path)]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode == 0:
            dur_sec = float(json.loads(res.stdout).get("format", {}).get("duration", 0))
            total_duration_us = int(dur_sec * 1_000_000)
    except Exception:
        pass

    if total_duration_us <= 0:
        if transcript_segments:
            total_duration_us = max(seg.get("end_us", 0) for seg in transcript_segments)
        else:
            total_duration_us = 10_000_000

    fillers = None
    if args.remove_fillers:
        fillers = [f.strip() for f in args.remove_fillers.replace("，", ",").split(",") if f.strip()]

    keeps, shifted_subs, time_map = plan_speech_cut(
        total_duration_us,
        transcript_segments,
        remove_silence_over_sec=float(args.remove_silence_over),
        fillers=fillers,
    )

    assets: list[Asset] = []
    tracks: list[Track] = []

    media_asset_id = "asset_media_main"
    assets.append(
        Asset(
            id=media_asset_id,
            kind="video",
            uri=str(media_path).replace("\\", "/"),
            duration_us=total_duration_us,
        )
    )

    bgm_asset_id = None
    if args.bgm:
        bgm_path = Path(args.bgm).resolve()
        if not bgm_path.is_file():
            raise FileNotFoundError(f"bgm file not found: {bgm_path}")
        bgm_asset_id = "asset_bgm"
        assets.append(
            Asset(
                id=bgm_asset_id,
                kind="audio",
                uri=str(bgm_path).replace("\\", "/"),
                duration_us=time_map.mapped_duration,
            )
        )

    video_clips: list[Clip] = []
    timeline_cursor = 0
    for idx, (s, e) in enumerate(keeps):
        dur = e - s
        video_clips.append(
            Clip(
                id=f"v_seg_{idx}",
                asset_id=media_asset_id,
                start_us=timeline_cursor,
                duration_us=dur,
                audio_fade_in_us=20_000,
                audio_fade_out_us=20_000,
            )
        )
        timeline_cursor += dur

    tracks.append(Track(id="track_video", type="video", name="Main Video", clips=tuple(video_clips)))

    if shifted_subs:
        text_clips: list[Clip] = []
        for idx, sub in enumerate(shifted_subs):
            text_clips.append(
                Clip(
                    id=f"t_seg_{idx}",
                    text=sub.get("text", ""),
                    start_us=sub.get("start_us", 0),
                    duration_us=sub.get("duration_us", 0),
                )
            )
        tracks.append(Track(id="track_subs", type="text", name="Subtitles", clips=tuple(text_clips)))

    if bgm_asset_id:
        bgm_vol = float(args.bgm_volume) if getattr(args, "bgm_volume", None) is not None else 0.2
        bgm_clip = Clip(
            id="a_bgm_0",
            asset_id=bgm_asset_id,
            start_us=0,
            duration_us=time_map.mapped_duration,
            volume=bgm_vol,
        )
        tracks.append(Track(id="track_bgm", type="audio", name="BGM", clips=(bgm_clip,)))

    proj_name = args.name or media_path.stem
    timeline = Timeline(
        schema_version="1.0",
        project_name=proj_name,
        canvas=Canvas(width=1080, height=1920, fps=30),
        duration_us=time_map.mapped_duration,
        assets=tuple(assets),
        tracks=tuple(tracks),
    )

    published_info = None
    if args.out_draft:
        out_draft_path = Path(args.out_draft).resolve()
        draft_root = out_draft_path.parent
        adapter = JianyingAdapter.detect(
            sys.platform,
            draft_root=draft_root,
            user_data=Path(args.user_data) if getattr(args, "user_data", None) else None,
            install_dir=Path(args.install_dir) if getattr(args, "install_dir", None) else None,
        )
        published = adapter.publish(timeline, project_name=out_draft_path.name, register=bool(args.register))
        published_info = {
            "draft_dir": published.draft_dir,
            "project_id": published.project_id,
            "registered": published.registered,
        }
        if args.font:
            embed_font_into_draft(Path(published.draft_dir), Path(args.font))

    exported_path = None
    if args.export:
        exp_path = Path(args.export).resolve()
        render_timeline_mp4(
            timeline,
            exp_path,
            font_path=Path(args.font) if args.font else None,
        )
        assert_render_quality(exp_path, expected_duration_us=timeline.duration_us)
        exported_path = str(exp_path)

    result_payload = {
        "status": "ok",
        "duration_sec": round(time_map.mapped_duration / 1_000_000, 2),
        "keep_count": len(keeps),
        "subtitles_count": len(shifted_subs),
    }
    if published_info:
        result_payload["draft"] = published_info
    if exported_path:
        result_payload["export_path"] = exported_path
    if not published_info and not exported_path:
        result_payload["timeline"] = {
            "duration_us": timeline.duration_us,
            "assets_count": len(timeline.assets),
            "tracks_count": len(timeline.tracks),
        }

    print(json.dumps(result_payload, ensure_ascii=False, indent=2))
    return 0


def cmd_inspect_draft(args: argparse.Namespace) -> int:
    draft_dir = Path(args.draft).resolve()
    summary = inspect_draft(draft_dir)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def cmd_modify_draft(args: argparse.Namespace) -> int:
    draft_dir = Path(args.draft).resolve()
    patch_raw = args.patch.strip()
    if Path(patch_raw).is_file():
        ops = json.loads(Path(patch_raw).read_text(encoding="utf-8"))
    else:
        ops = json.loads(patch_raw)
    if not isinstance(ops, list):
        raise ValueError("Patch must be a JSON array of operations")

    cloned_dir = modify_draft_copy(
        draft_dir,
        args.out_name,
        ops,
        publish=args.publish,
    )
    payload = {
        "status": "ok",
        "draft_dir": str(cloned_dir),
        "out_name": args.out_name,
        "operations_applied": len(ops),
        "published": args.publish,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_export(args: argparse.Namespace) -> int:
    if not args.timeline and not args.draft:
        raise ValueError("Either --timeline or --draft must be specified")

    if args.timeline:
        tl_path = Path(args.timeline).resolve()
        if not tl_path.is_file():
            raise FileNotFoundError(f"timeline file not found: {tl_path}")
        raw_data = json.loads(tl_path.read_text(encoding="utf-8"))
        timeline = validate_timeline(raw_data)
    else:
        draft_path = Path(args.draft).resolve()
        content = read_draft_content(draft_path)
        timeline = _draft_to_timeline(content, project_name=draft_path.name)

    out_mp4 = Path(args.out).resolve()
    font_path = Path(args.font).resolve() if args.font else None

    render_timeline_mp4(timeline, out_mp4, font_path=font_path)
    assert_render_quality(out_mp4, expected_duration_us=timeline.duration_us)

    payload = {
        "status": "ok",
        "output": str(out_mp4),
        "duration_sec": round(timeline.duration_us / 1_000_000, 2),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="leo-capcut")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor")
    doctor.set_defaults(func=cmd_doctor)

    plan = sub.add_parser("plan")
    plan.add_argument("--text", required=True)
    plan.add_argument("--media", action="append")
    plan.set_defaults(func=cmd_plan)

    publish = sub.add_parser("publish")
    publish.add_argument("--text", required=True)
    publish.add_argument("--media", action="append")
    publish.add_argument("--name")
    publish.add_argument("--draft-root")
    publish.add_argument("--user-data")
    publish.add_argument("--install-dir")
    publish.add_argument("--register", action="store_true")
    publish.set_defaults(func=cmd_publish)

    save = sub.add_parser("save-preset")
    save.add_argument("--intent", required=True)
    save.add_argument("--id", required=True)
    save.add_argument("--scenario", default="generic")
    save.add_argument("--platform", default="douyin")
    save.add_argument("--style", default="clean-vertical")
    save.add_argument("--duration", type=int)
    save.add_argument("--store")
    save.set_defaults(func=cmd_save_preset)

    catalog = sub.add_parser("catalog")
    catalog.set_defaults(func=cmd_catalog)

    query = sub.add_parser("query-enum")
    query.add_argument("--category", required=True)
    query.add_argument("--keyword", default="")
    query.add_argument("--limit", type=int, default=20)
    query.set_defaults(func=cmd_query_enum)

    # speech-cut
    speech_cut = sub.add_parser("speech-cut", help="Cut pauses and filler words, align subtitles, and build/export timeline")
    speech_cut.add_argument("--media", required=True, help="Path to input speech media (video or audio)")
    speech_cut.add_argument("--transcript", help="Path to transcript JSON file")
    speech_cut.add_argument("--remove-silence-over", type=float, default=0.6, help="Min silence duration in seconds to cut")
    speech_cut.add_argument("--remove-fillers", help="Comma-separated filler words to remove (e.g. '呃,啊,然后')")
    speech_cut.add_argument("--bgm", help="Path to background music audio file")
    speech_cut.add_argument("--bgm-volume", type=float, default=0.2, help="BGM volume multiplier (default 0.2)")
    speech_cut.add_argument("--out-draft", help="Output draft directory to publish")
    speech_cut.add_argument("--export", help="Output MP4 file path for headless export")
    speech_cut.add_argument("--font", help="Path to custom font file")
    speech_cut.add_argument("--name", help="Project name")
    speech_cut.add_argument("--register", action="store_true", help="Register published draft to homepage index")
    speech_cut.add_argument("--user-data", help="Custom user-data directory for Jianying")
    speech_cut.add_argument("--install-dir", help="Custom install directory for Jianying")
    speech_cut.set_defaults(func=cmd_speech_cut)

    # inspect-draft
    inspect_parser = sub.add_parser("inspect-draft", help="Inspect an existing draft and print high-level summary JSON")
    inspect_parser.add_argument("--draft", required=True, help="Path to draft directory")
    inspect_parser.set_defaults(func=cmd_inspect_draft)

    # modify-draft
    modify = sub.add_parser("modify-draft", help="Apply surgical patch operations to a draft copy")
    modify.add_argument("--draft", required=True, help="Path to source draft directory")
    modify.add_argument("--patch", required=True, help="JSON string or file path containing patch operations")
    modify.add_argument("--out-name", required=True, help="Name for the modified draft copy")
    modify.add_argument("--no-publish", dest="publish", action="store_false", default=True, help="Skip registering in root_meta_info.json")
    modify.set_defaults(func=cmd_modify_draft)

    # export
    exp = sub.add_parser("export", help="Export Timeline IR or existing draft to MP4 via FFmpeg")
    exp.add_argument("--timeline", help="Path to Timeline IR JSON file")
    exp.add_argument("--draft", help="Path to draft directory")
    exp.add_argument("--out", required=True, help="Path to output MP4 file")
    exp.add_argument("--font", help="Path to custom font file")
    exp.set_defaults(func=cmd_export)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
