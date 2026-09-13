from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from .brief import CreativeBrief, compose_brief
from .intent_router import parse_request_text
from .script_planner import plan_script
from .storyboard_planner import plan_storyboard
from .timeline_ir import Timeline, validate_timeline


@dataclass
class PipelineResult:
    brief: CreativeBrief
    timeline: Timeline
    artifacts: dict[str, Any]
    publish_result: Any | None = None


def _timeline_from_storyboard(brief: CreativeBrief, storyboard: dict, media_paths: Sequence[Path]) -> dict:
    duration_us = int(storyboard.get("duration_us") or brief.duration_seconds * 1_000_000)
    assets = []
    clips = []
    texts = []
    for index, shot in enumerate(storyboard["shots"]):
        media = shot.get("media") or (str(media_paths[0]) if media_paths else None)
        if media:
            asset_id = f"clip-{index+1}"
            assets.append({"id": asset_id, "kind": "video", "uri": str(media), "duration_us": shot["duration_us"]})
            clips.append(
                {
                    "id": f"v{index+1}",
                    "start_us": shot["start_us"],
                    "duration_us": shot["duration_us"],
                    "asset_id": asset_id,
                }
            )
        if shot.get("caption"):
            texts.append(
                {
                    "id": f"t{index+1}",
                    "start_us": shot["start_us"],
                    "duration_us": shot["duration_us"],
                    "text": shot["caption"],
                }
            )
    if not assets and media_paths:
        assets.append({"id": "clip-1", "kind": "video", "uri": str(media_paths[0]), "duration_us": duration_us})
        clips.append({"id": "v1", "start_us": 0, "duration_us": duration_us, "asset_id": "clip-1"})
    tracks = []
    if clips:
        tracks.append({"id": "video-1", "type": "video", "name": "主画面", "clips": clips})
    if texts:
        tracks.append({"id": "text-1", "type": "text", "name": "字幕", "clips": texts})
    return {
        "schema_version": "1.0",
        "project_name": brief.title,
        "canvas": brief.canvas,
        "duration_us": duration_us,
        "assets": assets,
        "tracks": tracks,
    }


def run_pipeline(
    request_text: str,
    *,
    media_paths: Sequence[Path] | None = None,
    template_root: Path | None = None,
    user_preset: dict | None = None,
    project_settings: dict | None = None,
    publish: bool = False,
    adapter: Any | None = None,
) -> PipelineResult:
    parsed = parse_request_text(request_text)
    brief = compose_brief(
        parsed,
        project_settings=project_settings,
        user_preset=user_preset,
        template_root=template_root,
    )
    script = plan_script(brief, request_text)
    storyboard = plan_storyboard(brief, script, media_paths or [])
    timeline = validate_timeline(_timeline_from_storyboard(brief, storyboard, media_paths or []))
    publish_result = None
    if publish:
        if adapter is None:
            raise RuntimeError("publish=True requires a JianyingAdapter")
        publish_result = adapter.publish(timeline, project_name=brief.title, register=True)
    return PipelineResult(
        brief=brief,
        timeline=timeline,
        artifacts={"script": script, "storyboard": storyboard, "brief": brief.to_dict()},
        publish_result=publish_result,
    )
