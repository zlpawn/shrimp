from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from ..timeline_ir import Timeline

__all__ = [
    "find_system_font",
    "compile_filtergraph",
    "render_timeline_mp4",
    "assert_render_quality",
]


def find_system_font() -> str:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for c in candidates:
        if c.is_file():
            return str(c).replace("\\", "/")
    return "arial"


def compile_filtergraph(
    timeline: Timeline, font_path: Path | None = None
) -> tuple[list[str], list[str], str, str]:
    """Translate Timeline IR tracks into FFmpeg input args and filter_complex expressions."""
    asset_map = timeline.asset_map()
    input_assets = list(timeline.assets)
    input_args: list[str] = []

    asset_idx_map: dict[str, int] = {}
    for idx, asset in enumerate(input_assets):
        asset_idx_map[asset.id] = idx
        input_args.extend(["-i", asset.uri])

    filter_chains: list[str] = []
    video_stage = ""
    audio_chains: list[str] = []

    # 1. Main video track
    video_tracks = [t for t in timeline.tracks if t.type == "video"]
    if video_tracks:
        main_track = video_tracks[0]
        if main_track.clips and main_track.clips[0].asset_id and main_track.clips[0].asset_id in asset_idx_map:
            in_idx = asset_idx_map[main_track.clips[0].asset_id]
            filter_chains.append(
                f"[{in_idx}:v]scale={timeline.canvas.width}:{timeline.canvas.height}:force_original_aspect_ratio=decrease,"
                f"pad={timeline.canvas.width}:{timeline.canvas.height}:(ow-iw)/2:(oh-ih)/2[v_base]"
            )
            video_stage = "[v_base]"
        else:
            filter_chains.append(
                f"color=c=black:s={timeline.canvas.width}x{timeline.canvas.height}:d={timeline.duration_us/1_000_000}[v_base]"
            )
            video_stage = "[v_base]"
    else:
        filter_chains.append(
            f"color=c=black:s={timeline.canvas.width}x{timeline.canvas.height}:d={timeline.duration_us/1_000_000}[v_base]"
        )
        video_stage = "[v_base]"

    # 2. Text overlays
    font_file = str(font_path).replace("\\", "/") if font_path else find_system_font()
    font_file_escaped = font_file.replace(":", r"\:")
    text_tracks = [t for t in timeline.tracks if t.type == "text"]
    text_idx = 0
    for tt in text_tracks:
        for clip in tt.clips:
            if not clip.text:
                continue
            s_sec = clip.start_us / 1_000_000
            e_sec = (clip.start_us + clip.duration_us) / 1_000_000
            txt = clip.text.replace(":", r"\:").replace("'", "'\\''")
            next_stage = f"[v_txt_{text_idx}]"
            filter_chains.append(
                f"{video_stage}drawtext=fontfile='{font_file_escaped}':text='{txt}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h*0.8:enable='between(t,{s_sec},{e_sec})'{next_stage}"
            )
            video_stage = next_stage
            text_idx += 1

    # 3. Audio tracks
    audio_tracks = [t for t in timeline.tracks if t.type == "audio"]
    for at in audio_tracks:
        for clip in at.clips:
            if clip.asset_id and clip.asset_id in asset_idx_map:
                in_idx = asset_idx_map[clip.asset_id]
                delay_ms = int(clip.start_us / 1000)
                vol = clip.volume if clip.volume is not None else 1.0
                chain_name = f"[a_{len(audio_chains)}]"
                filter_chains.append(f"[{in_idx}:a]adelay={delay_ms}|{delay_ms},volume={vol}{chain_name}")
                audio_chains.append(chain_name)

    out_a = "[out_a]"
    if audio_chains:
        if len(audio_chains) > 1:
            filter_chains.append(
                f"{''.join(audio_chains)}amix=inputs={len(audio_chains)}:duration=longest:normalize=0{out_a}"
            )
        else:
            filter_chains.append(
                f"{audio_chains[0]}aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo{out_a}"
            )
    else:
        filter_chains.append(f"anullsrc=r=44100:cl=stereo:d={timeline.duration_us/1_000_000}{out_a}")

    out_v = video_stage
    return input_args, filter_chains, out_v, out_a


def render_timeline_mp4(
    timeline: Timeline, out_mp4: Path | str, font_path: Path | None = None
) -> Path:
    out_mp4 = Path(out_mp4).resolve()
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    input_args, filter_chains, out_v, out_a = compile_filtergraph(timeline, font_path)

    cmd = [
        "ffmpeg",
        "-y",
        *input_args,
        "-filter_complex",
        ";".join(filter_chains),
        "-map",
        out_v,
        "-map",
        out_a,
        "-t",
        str(timeline.duration_us / 1_000_000),
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        str(out_mp4),
    ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg rendering failed: {res.stderr}")
    return out_mp4


def assert_render_quality(mp4_path: Path | str, expected_duration_us: int) -> dict[str, Any]:
    mp4_path = Path(mp4_path)
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration:stream=codec_type,nb_frames,width,height",
        "-of",
        "json",
        str(mp4_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFprobe check failed: {res.stderr}")
    data = json.loads(res.stdout)
    actual_dur = float(data.get("format", {}).get("duration", 0))
    expected_sec = expected_duration_us / 1_000_000
    if abs(actual_dur - expected_sec) > 1.0:
        raise ValueError(f"duration mismatch: expected {expected_sec}s, got {actual_dur}s")
    return data
