from __future__ import annotations

import configparser
import json
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Mapping

from .timeline_ir import Asset, Timeline


def _load_vendor():
    vendor_root = Path(__file__).resolve().parents[1] / "vendor"
    if str(vendor_root) not in sys.path:
        sys.path.insert(0, str(vendor_root))
    import pyJianYingDraft as draft

    return draft


def _parse_rgb(color_val: Any) -> tuple[float, float, float]:
    if isinstance(color_val, (tuple, list)) and len(color_val) >= 3:
        return (float(color_val[0]), float(color_val[1]), float(color_val[2]))
    if isinstance(color_val, str):
        h = color_val.lstrip("#")
        if len(h) >= 6:
            return (int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0)
    return (1.0, 1.0, 1.0)


def _video_material(draft, asset: Asset, path: Path, timeline: Timeline):
    material = draft.VideoMaterial.__new__(draft.VideoMaterial)
    material.material_id = uuid.uuid4().hex
    material.local_material_id = ""
    material.check_flag = 63487
    material.material_name = path.name
    material.path = str(path)
    material.duration = int(asset.duration_us or timeline.duration_us)
    material.width = timeline.canvas.width
    material.height = timeline.canvas.height
    material.crop_settings = draft.CropSettings()
    material.material_type = "photo" if asset.kind == "image" else "video"
    material.beauty_face_auto_preset_infos = []
    material.beauty_face_preset_infos = []
    material.beauty_body_preset_id = ""
    material.beauty_body_auto_preset = None
    material.beauty_face_auto_preset = {"name": "", "preset_id": "", "rate_map": "", "scene": ""}
    material.is_unified_beauty_mode = False
    return material


def _audio_material(draft, asset: Asset, path: Path, timeline: Timeline):
    material = draft.AudioMaterial.__new__(draft.AudioMaterial)
    material.material_id = uuid.uuid4().hex
    material.material_name = path.name
    material.path = str(path)
    material.duration = int(asset.duration_us or timeline.duration_us)
    return material


def build_draft_payloads(
    timeline: Timeline,
    project_id: str,
    project_name: str,
    copied: Mapping[str, Path],
    draft_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Translate validated Timeline IR through pyJianYingDraft's real schema writer."""
    draft = _load_vendor()
    from .registry import AssetRegistry
    reg = AssetRegistry.get()
    script = draft.ScriptFile(
        timeline.canvas.width,
        timeline.canvas.height,
        timeline.canvas.fps,
        True,
    )
    script.content["id"] = project_id
    assets = timeline.asset_map()
    material_cache: dict[str, Any] = {}

    for track in timeline.tracks:
        track_ref = script.append_track(
            draft.TrackSpec(draft.TrackType.from_name(track.type), track.name)
        )
        for clip in track.clips:
            timerange = draft.Timerange(clip.start_us, clip.duration_us)
            if track.type == "text":
                font_size = clip.font_size or 8.0
                font_enum = reg.resolve("fonts", clip.font) if clip.font else None
                text_color = _parse_rgb(clip.text_color) if clip.text_color else (1.0, 1.0, 1.0)
                text_align = clip.text_align if clip.text_align in (0, 1, 2) else 1
                text_vert = bool(clip.text_vertical)
                border = None
                if clip.text_border_color or clip.text_border_width is not None:
                    b_col = _parse_rgb(clip.text_border_color) if clip.text_border_color else (0.0, 0.0, 0.0)
                    b_w = clip.text_border_width if clip.text_border_width is not None else 35.0
                    border = draft.TextBorder(color=b_col, width=b_w)
                else:
                    border = draft.TextBorder(color=(0.0, 0.0, 0.0), width=35.0)
                bg = draft.TextBackground(color=clip.text_background_color) if clip.text_background_color else None
                shadow = draft.TextShadow(color=_parse_rgb(clip.text_shadow_color)) if clip.text_shadow_color else None
                ty = clip.transform_y if clip.transform_y is not None else -0.72
                tx = clip.transform_x if clip.transform_x is not None else 0.0
                clip_settings = draft.ClipSettings(
                    transform_x=tx,
                    transform_y=ty,
                    scale_x=clip.scale_x or 1.0,
                    scale_y=clip.scale_y or 1.0,
                    rotation=clip.rotation or 0.0,
                    alpha=clip.alpha if clip.alpha is not None else 1.0,
                )
                segment = draft.TextSegment(
                    clip.text or "",
                    timerange,
                    font=font_enum,
                    style=draft.TextStyle(size=font_size, color=text_color, align=text_align, vertical=text_vert, auto_wrapping=True),
                    border=border,
                    background=bg,
                    shadow=shadow,
                    clip_settings=clip_settings,
                )
                te_enum = reg.resolve("text_effects", clip.text_effect)
                if te_enum:
                    segment.add_effect(te_enum)
                tb = reg.resolve("text_bubbles", clip.text_bubble)
                if tb:
                    segment.add_bubble(tb)
                anim_enum = reg.resolve("text_intros", clip.text_animation)
                if anim_enum:
                    anim_dur = clip.text_animation_duration_us / 1_000_000 if clip.text_animation_duration_us else None
                    segment.add_animation(anim_enum, duration=anim_dur)
                out_enum = reg.resolve("text_outros", clip.text_animation_out)
                if out_enum:
                    out_dur = clip.text_animation_out_duration_us / 1_000_000 if clip.text_animation_out_duration_us else None
                    segment.add_animation(out_enum, duration=out_dur)
                loop_enum = reg.resolve("text_loops", clip.text_animation_loop)
                if loop_enum:
                    segment.add_animation(loop_enum)
                if clip.style_ranges and hasattr(segment, "add_style_range"):
                    for sr in clip.style_ranges:
                        start_idx = int(sr.get("start", 0))
                        end_idx = int(sr.get("end", len(clip.text or "")))
                        style_kw: dict[str, Any] = {}
                        if "color" in sr:
                            style_kw["color"] = _parse_rgb(sr["color"])
                        if "size" in sr:
                            style_kw["size"] = float(sr["size"])
                        if "bold" in sr:
                            style_kw["bold"] = bool(sr["bold"])
                        if "italic" in sr:
                            style_kw["italic"] = bool(sr["italic"])
                        if "underline" in sr:
                            style_kw["underline"] = bool(sr["underline"])
                        segment.add_style_range(start_idx, end_idx, style=draft.TextStyle(**style_kw) if style_kw else None)
            elif track.type == "filter":
                filt_name = clip.filter_type or clip.text or ""
                filt_enum = reg.resolve("filters", filt_name)
                if filt_enum:
                    segment = draft.FilterSegment(filt_enum, timerange, intensity=clip.volume if clip.volume is not None else 1.0)
                    script.add_segment(segment, track=track_ref)
                    if segment.material not in script.materials:
                        script.materials.filters.append(segment.material)
                continue
            elif track.type == "effect":
                eff_name = clip.effect_type or clip.text or ""
                eff_enum = reg.resolve("video_scene_effects", eff_name) or reg.resolve("video_character_effects", eff_name)
                if eff_enum:
                    segment = draft.EffectSegment(eff_enum, timerange)
                    script.add_segment(segment, track=track_ref)
                    if segment.effect_inst not in script.materials:
                        script.materials.video_effects.append(segment.effect_inst)
                continue
            elif track.type == "sticker":
                res_id = clip.sticker_resource_id or clip.asset_id or ""
                if res_id and hasattr(draft, "StickerSegment"):
                    segment = draft.StickerSegment(res_id, timerange)
                    script.add_segment(segment, track=track_ref)
                continue
            else:
                if clip.asset_id is None or clip.asset_id not in copied:
                    raise FileNotFoundError(f"copied asset is missing for clip {clip.id}: {clip.asset_id}")
                asset = assets[clip.asset_id]
                material = material_cache.get(asset.id)
                if material is None:
                    if track.type == "video":
                        material = _video_material(draft, asset, copied[asset.id], timeline)
                    else:
                        material = _audio_material(draft, asset, copied[asset.id], timeline)
                    material_cache[asset.id] = material
                speed_val = clip.speed if clip.speed is not None else 1.0
                source_duration = round(clip.duration_us * speed_val)
                if int(material.duration) < source_duration:
                    material.duration = source_duration
                source = draft.Timerange(0, source_duration)
                if track.type == "video":
                    has_settings = (
                        clip.flip_horizontal
                        or clip.flip_vertical
                        or clip.transform_x is not None
                        or clip.transform_y is not None
                        or clip.scale_x is not None
                        or clip.scale_y is not None
                        or clip.rotation is not None
                        or clip.alpha is not None
                    )
                    clip_settings = None
                    if has_settings:
                        clip_settings = draft.ClipSettings(
                            transform_x=clip.transform_x or 0.0,
                            transform_y=clip.transform_y or 0.0,
                            scale_x=clip.scale_x or 1.0,
                            scale_y=clip.scale_y or 1.0,
                            rotation=clip.rotation or 0.0,
                            alpha=clip.alpha if clip.alpha is not None else 1.0,
                            flip_horizontal=bool(clip.flip_horizontal),
                            flip_vertical=bool(clip.flip_vertical),
                        )
                    segment = draft.VideoSegment(
                        material,
                        timerange,
                        source_timerange=source,
                        volume=clip.volume if clip.volume is not None else 1.0,
                        speed=speed_val,
                        change_pitch=bool(clip.change_pitch),
                        clip_settings=clip_settings,
                    )
                    if clip.filter_type:
                        v_filt = reg.resolve("filters", clip.filter_type)
                        if v_filt:
                            segment.add_filter(v_filt)
                    if clip.effect_type:
                        v_eff = reg.resolve("video_scene_effects", clip.effect_type) or reg.resolve("video_character_effects", clip.effect_type)
                        if v_eff:
                            segment.add_effect(v_eff)
                    if clip.audio_fade_in_us or clip.audio_fade_out_us:
                        segment.add_fade(clip.audio_fade_in_us or 0, clip.audio_fade_out_us or 0)
                    trans_enum = reg.resolve("transitions", clip.transition)
                    if trans_enum:
                        segment.add_transition(trans_enum, duration=clip.transition_duration_us)
                    m_enum = reg.resolve("masks", clip.mask)
                    if m_enum:
                        segment.add_mask(
                            m_enum,
                            center_x=clip.mask_center_x or 0.0,
                            center_y=clip.mask_center_y or 0.0,
                            size=clip.mask_size or 0.5,
                            rotation=clip.mask_rotation or 0.0,
                            feather=clip.mask_feather or 0.0,
                            invert=bool(clip.mask_invert),
                        )
                    mm_enum = reg.resolve("mix_modes", clip.mix_mode)
                    if mm_enum:
                        segment.set_mix_mode(mm_enum)
                    if clip.keyframes and hasattr(draft, "KeyframeProperty"):
                        for kf in clip.keyframes:
                            prop_name = kf.get("property")
                            prop_enum = reg.resolve("keyframe_properties", prop_name)
                            if prop_enum and "time_offset" in kf and "value" in kf:
                                try:
                                    segment.add_keyframe(prop_enum, kf["time_offset"], float(kf["value"]))
                                except Exception:
                                    pass
                    in_enum = reg.resolve("video_intros", clip.video_animation_in)
                    out_enum = reg.resolve("video_outros", clip.video_animation_out)
                    combo_enum = reg.resolve("video_combos", clip.video_animation_combo)
                    if not in_enum and clip.video_fade_in_us:
                        in_enum = reg.resolve("video_intros", "渐显")
                    if not out_enum and clip.video_fade_out_us:
                        out_enum = reg.resolve("video_outros", "渐隐")
                    if in_enum or out_enum:
                        if in_enum:
                            in_dur = clip.video_animation_in_duration_us or clip.video_fade_in_us
                            segment.add_animation(in_enum, duration=in_dur)
                        if out_enum:
                            out_dur = clip.video_animation_out_duration_us or clip.video_fade_out_us
                            segment.add_animation(out_enum, duration=out_dur)
                    elif combo_enum:
                        segment.add_animation(combo_enum)
                    if clip.background_filling_type and hasattr(segment, "add_background_filling"):
                        b_type = clip.background_filling_type
                        b_blur = clip.background_filling_blur if clip.background_filling_blur is not None else 0.0625
                        b_color = clip.background_filling_color or "#00000000"
                        segment.add_background_filling(b_type, blur=b_blur, color=b_color)
                    if clip.chroma_color and hasattr(segment, "add_chroma"):
                        c_intensity = clip.chroma_intensity if clip.chroma_intensity is not None else 20.0
                        c_shadow = clip.chroma_shadow if clip.chroma_shadow is not None else 0.0
                        segment.add_chroma(clip.chroma_color, intensity=c_intensity, shadow=c_shadow)
                    b_enum = reg.resolve("beauty", clip.beauty_type)
                    if b_enum and hasattr(segment, "add_beauty"):
                        b_val = clip.beauty_value if clip.beauty_value is not None else 100.0
                        segment.add_beauty(b_enum, value=b_val)
                    st_enum = reg.resolve("skin_tone", clip.skin_tone_type)
                    if st_enum and hasattr(segment, "set_skin_tone"):
                        st_val = clip.skin_tone_intensity if clip.skin_tone_intensity is not None else 100.0
                        segment.set_skin_tone(st_enum, intensity=st_val)
                else:
                    segment = draft.AudioSegment(
                        material,
                        timerange,
                        source_timerange=source,
                        volume=clip.volume if clip.volume is not None else 1.0,
                        speed=speed_val,
                        change_pitch=bool(clip.change_pitch),
                    )
                    if clip.audio_fade_in_us or clip.audio_fade_out_us:
                        segment.add_fade(clip.audio_fade_in_us or 0, clip.audio_fade_out_us or 0)
                    te = reg.resolve("tone_effects", clip.tone_effect)
                    if te:
                        segment.add_effect(te)
                    s2s = reg.resolve("speech_to_song", clip.speech_to_song)
                    if s2s:
                        segment.add_effect(s2s)
                    ase = reg.resolve("audio_scene_effects", clip.audio_scene_effect)
                    if ase:
                        segment.add_effect(ase)
                    if clip.keyframes:
                        for kf in clip.keyframes:
                            if "time_offset" in kf and "value" in kf:
                                try:
                                    segment.add_keyframe(int(kf["time_offset"]), float(kf["value"]))
                                except Exception:
                                    pass
            script.add_segment(segment, track=track_ref)

    script.duration = timeline.duration_us
    content = json.loads(script.dumps())
    now_us = time.time_ns() // 1_000
    meta_template = Path(draft.__file__).resolve().parent / "assets" / "draft_meta_info.json"
    meta = json.loads(meta_template.read_text(encoding="utf-8"))
    meta.update(
        {
            "draft_cover": "draft_cover.jpg",
            "draft_fold_path": str(draft_dir),
            "draft_id": project_id,
            "draft_name": project_name,
            "draft_root_path": str(draft_dir.parent),
            "tm_draft_create": now_us,
            "tm_draft_modified": now_us,
            "tm_duration": timeline.duration_us,
            "draft_timeline_materials_size_": sum(path.stat().st_size for path in copied.values()),
        }
    )
    return content, meta


def write_auxiliary_files(draft_dir: Path, encrypted_content: bytes, project_id: str) -> None:
    (draft_dir / "draft_content.json.bak").write_bytes(encrypted_content)
    (draft_dir / "template-2.tmp").write_bytes(encrypted_content)
    (draft_dir / "draft_biz_config.json").write_bytes(b"")
    (draft_dir / "draft_agency_config.json").write_text(
        json.dumps(
            {
                "is_auto_agency_enabled": False,
                "is_auto_agency_popup": False,
                "is_single_agency_mode": False,
                "marterials": None,
                "use_converter": False,
                "video_resolution": 720,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    (draft_dir / "timeline_layout.json").write_text(
        json.dumps(
            {
                "dockItems": [
                    {
                        "dockIndex": 0,
                        "ratio": 1,
                        "timelineIds": [project_id],
                        "timelineNames": ["时间线01"],
                    }
                ],
                "layoutOrientation": 1,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    settings = configparser.ConfigParser()
    now = int(time.time())
    settings["General"] = {
        "draft_create_time": str(now),
        "draft_last_edit_time": str(now),
        "real_edit_seconds": "0",
        "real_edit_keys": "0",
    }
    with (draft_dir / "draft_settings").open("w", encoding="utf-8", newline="\n") as stream:
        settings.write(stream, space_around_delimiters=False)
