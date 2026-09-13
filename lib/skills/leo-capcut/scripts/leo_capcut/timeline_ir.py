from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable, Mapping

from .errors import TimelineValidationError


ALLOWED_TRACK_TYPES = {"video", "audio", "text", "filter", "effect", "sticker"}
ALLOWED_ASSET_KINDS = {"video", "audio", "image"}


@dataclass(frozen=True)
class Canvas:
    width: int
    height: int
    fps: int


@dataclass(frozen=True)
class Asset:
    id: str
    kind: str
    uri: str
    duration_us: int | None = None


@dataclass(frozen=True)
class Clip:
    id: str
    start_us: int
    duration_us: int
    asset_id: str | None = None
    text: str | None = None
    volume: float | None = None
    mix_mode: str | None = None
    keyframes: tuple[dict[str, Any], ...] = ()
    transition: str | None = None
    transition_duration_us: int | None = None
    font: str | None = None
    font_size: float | None = None
    text_color: str | None = None
    text_border_color: str | None = None
    text_border_width: float | None = None
    text_background_color: str | None = None
    text_shadow_color: str | None = None
    text_align: int | None = None
    text_vertical: bool | None = None
    text_animation: str | None = None
    text_animation_duration_us: int | None = None
    text_animation_out: str | None = None
    text_animation_out_duration_us: int | None = None
    text_animation_loop: str | None = None
    text_effect: str | None = None
    text_bubble: str | None = None
    filter_type: str | None = None
    effect_type: str | None = None
    mask: str | None = None
    mask_feather: float | None = None
    mask_invert: bool | None = None
    mask_size: float | None = None
    mask_center_x: float | None = None
    mask_center_y: float | None = None
    mask_rotation: float | None = None
    audio_fade_in_us: int | None = None
    audio_fade_out_us: int | None = None
    video_fade_in_us: int | None = None
    video_fade_out_us: int | None = None
    tone_effect: str | None = None
    audio_scene_effect: str | None = None
    speech_to_song: str | None = None
    sticker_resource_id: str | None = None
    video_animation_in: str | None = None
    video_animation_in_duration_us: int | None = None
    video_animation_out: str | None = None
    video_animation_out_duration_us: int | None = None
    video_animation_combo: str | None = None
    chroma_color: str | None = None
    chroma_intensity: float | None = None
    chroma_shadow: float | None = None
    background_filling_type: str | None = None
    background_filling_blur: float | None = None
    background_filling_color: str | None = None
    speed: float | None = None
    change_pitch: bool | None = None
    flip_horizontal: bool | None = None
    flip_vertical: bool | None = None
    style_ranges: tuple[dict[str, Any], ...] = ()
    beauty_type: str | None = None
    beauty_value: float | None = None
    skin_tone_type: str | None = None
    skin_tone_intensity: float | None = None
    transform_x: float | None = None
    transform_y: float | None = None
    scale_x: float | None = None
    scale_y: float | None = None
    rotation: float | None = None
    alpha: float | None = None

    @property
    def end_us(self) -> int:
        return self.start_us + self.duration_us


@dataclass(frozen=True)
class Track:
    id: str
    type: str
    name: str
    clips: tuple[Clip, ...] = ()


@dataclass(frozen=True)
class Timeline:
    schema_version: str
    project_name: str
    canvas: Canvas
    duration_us: int
    assets: tuple[Asset, ...]
    tracks: tuple[Track, ...]
    raw: Mapping[str, Any] = field(repr=False, default_factory=dict)

    def asset_map(self) -> dict[str, Asset]:
        return {asset.id: asset for asset in self.assets}


def _require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise TimelineValidationError(f"{label} must be an object")
    return value


def _require_str(payload: Mapping[str, Any], key: str, label: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise TimelineValidationError(f"{label}.{key} must be a non-empty string")
    return value.strip()


def _require_int(payload: Mapping[str, Any], key: str, label: str, *, min_value: int = 0) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise TimelineValidationError(f"{label}.{key} must be an integer")
    if value < min_value:
        raise TimelineValidationError(f"{label}.{key} must be >= {min_value}")
    return value


def _unique_ids(items: Iterable[str], label: str) -> None:
    seen: set[str] = set()
    for item in items:
        if item in seen:
            raise TimelineValidationError(f"duplicate {label} id: {item}")
        seen.add(item)


def validate_timeline(payload: Mapping[str, Any] | Timeline) -> Timeline:
    if isinstance(payload, Timeline):
        payload = payload.raw or {
            "schema_version": payload.schema_version,
            "project_name": payload.project_name,
            "canvas": {
                "width": payload.canvas.width,
                "height": payload.canvas.height,
                "fps": payload.canvas.fps,
            },
            "duration_us": payload.duration_us,
            "assets": [asdict(asset) for asset in payload.assets],
            "tracks": [
                {
                    "id": track.id,
                    "type": track.type,
                    "name": track.name,
                    "clips": [asdict(clip) for clip in track.clips],
                }
                for track in payload.tracks
            ],
        }

    data = _require_mapping(payload, "timeline")
    schema_version = _require_str(data, "schema_version", "timeline")
    project_name = _require_str(data, "project_name", "timeline")
    canvas_raw = _require_mapping(data.get("canvas"), "timeline.canvas")
    canvas = Canvas(
        width=_require_int(canvas_raw, "width", "timeline.canvas", min_value=1),
        height=_require_int(canvas_raw, "height", "timeline.canvas", min_value=1),
        fps=_require_int(canvas_raw, "fps", "timeline.canvas", min_value=1),
    )
    duration_us = _require_int(data, "duration_us", "timeline", min_value=1)

    assets_raw = data.get("assets", [])
    if not isinstance(assets_raw, list):
        raise TimelineValidationError("timeline.assets must be a list")
    assets: list[Asset] = []
    for index, item in enumerate(assets_raw):
        raw = _require_mapping(item, f"timeline.assets[{index}]")
        kind = _require_str(raw, "kind", f"timeline.assets[{index}]")
        if kind not in ALLOWED_ASSET_KINDS:
            raise TimelineValidationError(f"unsupported asset kind: {kind}")
        duration = raw.get("duration_us")
        if duration is not None and (not isinstance(duration, int) or isinstance(duration, bool) or duration < 0):
            raise TimelineValidationError(f"timeline.assets[{index}].duration_us must be a non-negative integer")
        assets.append(
            Asset(
                id=_require_str(raw, "id", f"timeline.assets[{index}]"),
                kind=kind,
                uri=_require_str(raw, "uri", f"timeline.assets[{index}]"),
                duration_us=duration,
            )
        )
    _unique_ids((asset.id for asset in assets), "asset")
    asset_ids = {asset.id for asset in assets}

    tracks_raw = data.get("tracks", [])
    if not isinstance(tracks_raw, list) or not tracks_raw:
        raise TimelineValidationError("timeline.tracks must be a non-empty list")
    tracks: list[Track] = []
    for track_index, item in enumerate(tracks_raw):
        raw = _require_mapping(item, f"timeline.tracks[{track_index}]")
        track_type = _require_str(raw, "type", f"timeline.tracks[{track_index}]")
        if track_type not in ALLOWED_TRACK_TYPES:
            raise TimelineValidationError(f"unsupported track type: {track_type}")
        clips_raw = raw.get("clips", [])
        if not isinstance(clips_raw, list):
            raise TimelineValidationError(f"timeline.tracks[{track_index}].clips must be a list")
        clips: list[Clip] = []
        for clip_index, clip_item in enumerate(clips_raw):
            clip_raw = _require_mapping(clip_item, f"timeline.tracks[{track_index}].clips[{clip_index}]")
            start_us = _require_int(clip_raw, "start_us", f"clip {clip_index}", min_value=0)
            clip_duration = _require_int(clip_raw, "duration_us", f"clip {clip_index}", min_value=1)
            asset_id = clip_raw.get("asset_id")
            text = clip_raw.get("text")
            if track_type in {"video", "audio"}:
                if not isinstance(asset_id, str) or not asset_id.strip():
                    raise TimelineValidationError(f"{track_type} clip requires asset_id")
                if asset_id not in asset_ids:
                    raise TimelineValidationError(f"unknown asset_id: {asset_id}")
            if track_type == "text":
                if not isinstance(text, str) or not text.strip():
                    raise TimelineValidationError("text clip requires text")
            if start_us + clip_duration > duration_us:
                raise TimelineValidationError("clip exceeds timeline duration")
            keyframes = clip_raw.get("keyframes", [])
            if keyframes and not isinstance(keyframes, list):
                raise TimelineValidationError("clip.keyframes must be a list")
            clips.append(
                Clip(
                    id=_require_str(clip_raw, "id", f"clip {clip_index}"),
                    start_us=start_us,
                    duration_us=clip_duration,
                    asset_id=asset_id.strip() if isinstance(asset_id, str) else None,
                    text=text.strip() if isinstance(text, str) else None,
                    volume=float(clip_raw["volume"]) if isinstance(clip_raw.get("volume"), (int, float)) else None,
                    mix_mode=str(clip_raw["mix_mode"]) if clip_raw.get("mix_mode") else None,
                    keyframes=tuple(item for item in keyframes) if isinstance(keyframes, list) else (),
                    transition=str(clip_raw["transition"]).strip() if clip_raw.get("transition") else None,
                    transition_duration_us=int(clip_raw["transition_duration_us"]) if clip_raw.get("transition_duration_us") is not None else None,
                    font=str(clip_raw["font"]).strip() if clip_raw.get("font") else None,
                    font_size=float(clip_raw["font_size"]) if clip_raw.get("font_size") is not None else None,
                    text_color=str(clip_raw["text_color"]).strip() if clip_raw.get("text_color") else None,
                    text_border_color=str(clip_raw["text_border_color"]).strip() if clip_raw.get("text_border_color") else None,
                    text_border_width=float(clip_raw["text_border_width"]) if clip_raw.get("text_border_width") is not None else None,
                    text_background_color=str(clip_raw["text_background_color"]).strip() if clip_raw.get("text_background_color") else None,
                    text_shadow_color=str(clip_raw["text_shadow_color"]).strip() if clip_raw.get("text_shadow_color") else None,
                    text_align=int(clip_raw["text_align"]) if clip_raw.get("text_align") is not None else None,
                    text_vertical=bool(clip_raw["text_vertical"]) if clip_raw.get("text_vertical") is not None else None,
                    text_animation=str(clip_raw["text_animation"]).strip() if clip_raw.get("text_animation") else None,
                    text_animation_duration_us=int(clip_raw["text_animation_duration_us"]) if clip_raw.get("text_animation_duration_us") is not None else None,
                    text_animation_out=str(clip_raw["text_animation_out"]).strip() if clip_raw.get("text_animation_out") else None,
                    text_animation_out_duration_us=int(clip_raw["text_animation_out_duration_us"]) if clip_raw.get("text_animation_out_duration_us") is not None else None,
                    text_animation_loop=str(clip_raw["text_animation_loop"]).strip() if clip_raw.get("text_animation_loop") else None,
                    text_effect=str(clip_raw["text_effect"]).strip() if clip_raw.get("text_effect") else None,
                    text_bubble=str(clip_raw["text_bubble"]).strip() if clip_raw.get("text_bubble") else None,
                    filter_type=str(clip_raw["filter_type"]).strip() if clip_raw.get("filter_type") else None,
                    effect_type=str(clip_raw["effect_type"]).strip() if clip_raw.get("effect_type") else None,
                    mask=str(clip_raw["mask"]).strip() if clip_raw.get("mask") else None,
                    mask_feather=float(clip_raw["mask_feather"]) if clip_raw.get("mask_feather") is not None else None,
                    mask_invert=bool(clip_raw["mask_invert"]) if clip_raw.get("mask_invert") is not None else None,
                    mask_size=float(clip_raw["mask_size"]) if clip_raw.get("mask_size") is not None else None,
                    mask_center_x=float(clip_raw["mask_center_x"]) if clip_raw.get("mask_center_x") is not None else None,
                    mask_center_y=float(clip_raw["mask_center_y"]) if clip_raw.get("mask_center_y") is not None else None,
                    mask_rotation=float(clip_raw["mask_rotation"]) if clip_raw.get("mask_rotation") is not None else None,
                    audio_fade_in_us=int(clip_raw["audio_fade_in_us"]) if clip_raw.get("audio_fade_in_us") is not None else None,
                    audio_fade_out_us=int(clip_raw["audio_fade_out_us"]) if clip_raw.get("audio_fade_out_us") is not None else None,
                    video_fade_in_us=int(clip_raw["video_fade_in_us"]) if clip_raw.get("video_fade_in_us") is not None else None,
                    video_fade_out_us=int(clip_raw["video_fade_out_us"]) if clip_raw.get("video_fade_out_us") is not None else None,
                    tone_effect=str(clip_raw["tone_effect"]).strip() if clip_raw.get("tone_effect") else None,
                    audio_scene_effect=str(clip_raw["audio_scene_effect"]).strip() if clip_raw.get("audio_scene_effect") else None,
                    speech_to_song=str(clip_raw["speech_to_song"]).strip() if clip_raw.get("speech_to_song") else None,
                    sticker_resource_id=str(clip_raw["sticker_resource_id"]).strip() if clip_raw.get("sticker_resource_id") else None,
                    video_animation_in=str(clip_raw["video_animation_in"]).strip() if clip_raw.get("video_animation_in") else None,
                    video_animation_in_duration_us=int(clip_raw["video_animation_in_duration_us"]) if clip_raw.get("video_animation_in_duration_us") is not None else None,
                    video_animation_out=str(clip_raw["video_animation_out"]).strip() if clip_raw.get("video_animation_out") else None,
                    video_animation_out_duration_us=int(clip_raw["video_animation_out_duration_us"]) if clip_raw.get("video_animation_out_duration_us") is not None else None,
                    video_animation_combo=str(clip_raw["video_animation_combo"]).strip() if clip_raw.get("video_animation_combo") else None,
                    chroma_color=str(clip_raw["chroma_color"]).strip() if clip_raw.get("chroma_color") else None,
                    chroma_intensity=float(clip_raw["chroma_intensity"]) if clip_raw.get("chroma_intensity") is not None else None,
                    chroma_shadow=float(clip_raw["chroma_shadow"]) if clip_raw.get("chroma_shadow") is not None else None,
                    background_filling_type=str(clip_raw["background_filling_type"]).strip() if clip_raw.get("background_filling_type") else None,
                    background_filling_blur=float(clip_raw["background_filling_blur"]) if clip_raw.get("background_filling_blur") is not None else None,
                    background_filling_color=str(clip_raw["background_filling_color"]).strip() if clip_raw.get("background_filling_color") else None,
                    speed=float(clip_raw["speed"]) if clip_raw.get("speed") is not None else None,
                    change_pitch=bool(clip_raw["change_pitch"]) if clip_raw.get("change_pitch") is not None else None,
                    flip_horizontal=bool(clip_raw["flip_horizontal"]) if clip_raw.get("flip_horizontal") is not None else None,
                    flip_vertical=bool(clip_raw["flip_vertical"]) if clip_raw.get("flip_vertical") is not None else None,
                    style_ranges=tuple(item for item in clip_raw.get("style_ranges", [])) if isinstance(clip_raw.get("style_ranges"), list) else (),
                    beauty_type=str(clip_raw["beauty_type"]).strip() if clip_raw.get("beauty_type") else None,
                    beauty_value=float(clip_raw["beauty_value"]) if clip_raw.get("beauty_value") is not None else None,
                    skin_tone_type=str(clip_raw["skin_tone_type"]).strip() if clip_raw.get("skin_tone_type") else None,
                    skin_tone_intensity=float(clip_raw["skin_tone_intensity"]) if clip_raw.get("skin_tone_intensity") is not None else None,
                    transform_x=float(clip_raw["transform_x"]) if clip_raw.get("transform_x") is not None else None,
                    transform_y=float(clip_raw["transform_y"]) if clip_raw.get("transform_y") is not None else None,
                    scale_x=float(clip_raw["scale_x"]) if clip_raw.get("scale_x") is not None else None,
                    scale_y=float(clip_raw["scale_y"]) if clip_raw.get("scale_y") is not None else None,
                    rotation=float(clip_raw["rotation"]) if clip_raw.get("rotation") is not None else None,
                    alpha=float(clip_raw["alpha"]) if clip_raw.get("alpha") is not None else None,
                )
            )
        ordered = sorted(clips, key=lambda clip: clip.start_us)
        for previous, current in zip(ordered, ordered[1:]):
            if current.start_us < previous.end_us:
                raise TimelineValidationError(
                    f"overlapping clips on track {raw.get('id')}: {previous.id} and {current.id}"
                )
        tracks.append(
            Track(
                id=_require_str(raw, "id", f"timeline.tracks[{track_index}]"),
                type=track_type,
                name=_require_str(raw, "name", f"timeline.tracks[{track_index}]"),
                clips=tuple(clips),
            )
        )
    _unique_ids((track.id for track in tracks), "track")
    _unique_ids((clip.id for track in tracks for clip in track.clips), "clip")

    return Timeline(
        schema_version=schema_version,
        project_name=project_name,
        canvas=canvas,
        duration_us=duration_us,
        assets=tuple(assets),
        tracks=tuple(tracks),
        raw=dict(data),
    )
