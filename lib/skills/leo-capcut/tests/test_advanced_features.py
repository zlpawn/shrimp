import json
import sys
import tempfile
import unittest
from pathlib import Path

TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

from helpers import SCRIPTS
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.detect import detect_environment
from leo_capcut.timeline_ir import validate_timeline

class AdvancedFeaturesTests(unittest.TestCase):
    def test_advanced_tier1_and_tier2(self):
        env = detect_environment("windows")
        install_dir = Path(env["install_dir"]) if env.get("install_dir") else None
        if install_dir is None or not (install_dir / "videoeditor.dll").is_file():
            self.skipTest("installed Jianying videoeditor.dll is unavailable")

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_file = root / "sample.mp4"
            video_file.write_bytes(b"fake-video-bytes")
            audio_file = root / "bgm.mp3"
            audio_file.write_bytes(b"fake-audio-bytes")

            timeline_payload = {
                "schema_version": "1.0",
                "project_name": "adv-tier1-tier2",
                "canvas": {"width": 1080, "height": 1920, "fps": 25},
                "duration_us": 6_000_000,
                "assets": [
                    {"id": "v1", "kind": "video", "uri": str(video_file), "duration_us": 3_000_000},
                    {"id": "v2", "kind": "video", "uri": str(video_file), "duration_us": 3_000_000},
                    {"id": "bgm", "kind": "audio", "uri": str(audio_file), "duration_us": 6_000_000},
                ],
                "tracks": [
                    {
                        "id": "video-1",
                        "type": "video",
                        "name": "主画面",
                        "clips": [
                            {
                                "id": "vc1",
                                "start_us": 0,
                                "duration_us": 3_000_000,
                                "asset_id": "v1",
                                "transition": "叠化",
                                "transition_duration_us": 500_000,
                                "keyframes": [
                                    {"property": "uniform_scale", "time_offset": 0, "value": 1.0},
                                    {"property": "uniform_scale", "time_offset": 3_000_000, "value": 1.15}
                                ]
                            },
                            {
                                "id": "vc2",
                                "start_us": 3_000_000,
                                "duration_us": 3_000_000,
                                "asset_id": "v2",
                            }
                        ]
                    },
                    {
                        "id": "text-1",
                        "type": "text",
                        "name": "字幕",
                        "clips": [
                            {
                                "id": "tc1",
                                "start_us": 0,
                                "duration_us": 3_000_000,
                                "text": "高级功能测试字幕",
                                "font_size": 9.5,
                                "text_effect": "潮酷发光立体花字",
                                "text_animation": "冲屏位移",
                                "text_animation_duration_us": 600_000
                            }
                        ]
                    },
                    {
                        "id": "audio-1",
                        "type": "audio",
                        "name": "背景音乐",
                        "clips": [
                            {
                                "id": "ac1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "asset_id": "bgm",
                                "volume": 0.2,
                                "keyframes": [
                                    {"time_offset": 0, "value": 0.35},
                                    {"time_offset": 1_000_000, "value": 0.12},
                                    {"time_offset": 5_000_000, "value": 0.12},
                                    {"time_offset": 6_000_000, "value": 0.35},
                                ]
                            }
                        ]
                    },
                    {
                        "id": "filter-1",
                        "type": "filter",
                        "name": "复古滤镜",
                        "clips": [
                            {
                                "id": "fc1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "filter_type": "_1980",
                                "volume": 0.8
                            }
                        ]
                    },
                    {
                        "id": "effect-1",
                        "type": "effect",
                        "name": "港风画质特效",
                        "clips": [
                            {
                                "id": "ec1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "effect_type": "_90s画质"
                            }
                        ]
                    }
                ]
            }

            timeline = validate_timeline(timeline_payload)
            adapter = JianyingAdapter.detect(
                "windows",
                draft_root=root / "drafts",
                user_data=root / "user-data",
                install_dir=install_dir,
            )
            adapter.draft_root.mkdir(parents=True)
            adapter.user_data.mkdir(parents=True)

            res = adapter.publish(timeline, project_name="adv-tier1-tier2", register=False)
            draft_dir = Path(res.draft_dir)

            content_raw = (draft_dir / "draft_content.json").read_bytes()
            content = adapter.codec.decode(content_raw)

            # Assert tracks
            track_types = [t["type"] for t in content["tracks"]]
            self.assertIn("video", track_types)
            self.assertIn("text", track_types)
            self.assertIn("audio", track_types)
            self.assertIn("filter", track_types)
            self.assertIn("effect", track_types)

            # Assert transitions
            self.assertEqual(len(content["materials"]["transitions"]), 1)
            # Assert text effect (flower text) + filter in effects
            self.assertGreaterEqual(len(content["materials"].get("effects", [])), 2)
            # Assert video effect (90s画质)
            self.assertEqual(len(content["materials"].get("video_effects", [])), 1)
            # Assert audio ducking keyframes
            audio_segment = [t for t in content["tracks"] if t["type"] == "audio"][0]["segments"][0]
            self.assertGreater(len(audio_segment.get("common_keyframes", [])), 0)

    def test_all_tiers_comprehensive(self):
        env = detect_environment("windows")
        install_dir = Path(env["install_dir"]) if env.get("install_dir") else None
        if install_dir is None or not (install_dir / "videoeditor.dll").is_file():
            self.skipTest("installed Jianying videoeditor.dll is unavailable")

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_file = root / "sample.mp4"
            video_file.write_bytes(b"fake-video-bytes")
            audio_file = root / "bgm.mp3"
            audio_file.write_bytes(b"fake-audio-bytes")

            timeline_payload = {
                "schema_version": "1.0",
                "project_name": "adv-all-tiers",
                "canvas": {"width": 1080, "height": 1920, "fps": 25},
                "duration_us": 6_000_000,
                "assets": [
                    {"id": "v1", "kind": "video", "uri": str(video_file), "duration_us": 6_000_000},
                    {"id": "v2", "kind": "video", "uri": str(video_file), "duration_us": 6_000_000},
                    {"id": "bgm", "kind": "audio", "uri": str(audio_file), "duration_us": 6_000_000},
                ],
                "tracks": [
                    {
                        "id": "video-1",
                        "type": "video",
                        "name": "主画面",
                        "clips": [
                            {
                                "id": "vc1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "asset_id": "v1",
                                "mask": "圆形",
                                "mask_size": 0.6,
                                "mask_feather": 10.0,
                                "mix_mode": "滤色",
                            }
                        ]
                    },
                    {
                        "id": "text-1",
                        "type": "text",
                        "name": "字幕",
                        "clips": [
                            {
                                "id": "tc1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "text": "全功能测试气泡",
                                "text_bubble": "标题58",
                                "text_effect": "潮酷发光立体花字"
                            }
                        ]
                    },
                    {
                        "id": "audio-1",
                        "type": "audio",
                        "name": "背景音乐",
                        "clips": [
                            {
                                "id": "ac1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "asset_id": "bgm",
                                "volume": 0.5,
                                "audio_fade_in_us": 1_000_000,
                                "audio_fade_out_us": 1_000_000,
                                "audio_scene_effect": "回音"
                            }
                        ]
                    },
                    {
                        "id": "sticker-1",
                        "type": "sticker",
                        "name": "贴纸轨",
                        "clips": [
                            {
                                "id": "sc1",
                                "start_us": 0,
                                "duration_us": 3_000_000,
                                "sticker_resource_id": "like_sticker_01"
                            }
                        ]
                    }
                ]
            }

            timeline = validate_timeline(timeline_payload)
            adapter = JianyingAdapter.detect(
                "windows",
                draft_root=root / "drafts",
                user_data=root / "user-data",
                install_dir=install_dir,
            )
            adapter.draft_root.mkdir(parents=True)
            adapter.user_data.mkdir(parents=True)

            res = adapter.publish(timeline, project_name="adv-all-tiers", register=False)
            draft_dir = Path(res.draft_dir)

            content_raw = (draft_dir / "draft_content.json").read_bytes()
            content = adapter.codec.decode(content_raw)

            # Assert mask in materials
            self.assertEqual(len(content["materials"]["masks"]), 1)
            # Assert audio fades in materials
            self.assertEqual(len(content["materials"]["audio_fades"]), 1)
            # Assert audio effects in materials
            self.assertEqual(len(content["materials"]["audio_effects"]), 1)
            # Assert sticker in materials
            self.assertEqual(len(content["materials"]["stickers"]), 1)

    def test_tiers_7_to_10_comprehensive(self):
        env = detect_environment("windows")
        install_dir = Path(env["install_dir"]) if env.get("install_dir") else None
        if install_dir is None or not (install_dir / "videoeditor.dll").is_file():
            self.skipTest("installed Jianying videoeditor.dll is unavailable")

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            video_file = root / "sample.mp4"
            video_file.write_bytes(b"fake-video-bytes")
            audio_file = root / "sample.mp3"
            audio_file.write_bytes(b"fake-audio-bytes")

            timeline_payload = {
                "schema_version": "1.0",
                "project_name": "adv-tiers-7-10",
                "canvas": {"width": 1080, "height": 1920, "fps": 30},
                "duration_us": 6_000_000,
                "assets": [
                    {"id": "v1", "kind": "video", "uri": str(video_file), "duration_us": 6_000_000},
                    {"id": "a1", "kind": "audio", "uri": str(audio_file), "duration_us": 6_000_000},
                ],
                "tracks": [
                    {
                        "id": "video-1",
                        "type": "video",
                        "name": "主画面",
                        "clips": [
                            {
                                "id": "vc1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "asset_id": "v1",
                                "speed": 1.5,
                                "change_pitch": True,
                                "flip_horizontal": True,
                                "flip_vertical": False,
                                "video_animation_in": "动感放大",
                                "video_animation_in_duration_us": 500_000,
                                "video_animation_out": "渐隐",
                                "video_animation_out_duration_us": 500_000,
                                "video_animation_combo": "缩小旋转",
                                "background_filling_type": "blur",
                                "background_filling_blur": 0.375,
                                "chroma_color": "#00FF00FF",
                                "chroma_intensity": 45.0,
                                "chroma_shadow": 15.0,
                                "beauty_type": "磨皮",
                                "beauty_value": 70.0,
                            }
                        ]
                    },
                    {
                        "id": "audio-1",
                        "type": "audio",
                        "name": "音频轨",
                        "clips": [
                            {
                                "id": "ac1",
                                "start_us": 0,
                                "duration_us": 6_000_000,
                                "asset_id": "a1",
                                "speed": 1.2,
                                "volume": 0.8
                            }
                        ]
                    },
                    {
                        "id": "text-1",
                        "type": "text",
                        "name": "字幕轨",
                        "clips": [
                            {
                                "id": "tc1",
                                "start_us": 0,
                                "duration_us": 5_000_000,
                                "text": "高阶文字样式测试",
                                "text_animation": "冲屏位移",
                                "text_animation_duration_us": 500_000,
                                "text_animation_out": "向上滑动",
                                "text_animation_out_duration_us": 500_000,
                                "text_animation_loop": "扫光",
                                "style_ranges": [
                                    {"start": 0, "end": 2, "color": "#FFCC00FF", "bold": True}
                                ]
                            }
                        ]
                    }
                ]
            }

            timeline = validate_timeline(timeline_payload)
            adapter = JianyingAdapter.detect(
                "windows",
                draft_root=root / "drafts",
                user_data=root / "user-data",
                install_dir=install_dir,
            )
            adapter.draft_root.mkdir(parents=True)
            adapter.user_data.mkdir(parents=True)

            res = adapter.publish(timeline, project_name="adv-tiers-7-10", register=False)
            draft_dir = Path(res.draft_dir)

            content_raw = (draft_dir / "draft_content.json").read_bytes()
            content = adapter.codec.decode(content_raw)

            # Assert canvases (blur background)
            self.assertEqual(len(content["materials"]["canvases"]), 1)
            # Assert chromas (green screen)
            self.assertEqual(len(content["materials"]["chromas"]), 1)
            # Assert material animations (video animations + text animations)
            self.assertGreaterEqual(len(content["materials"]["material_animations"]), 2)
            # Assert speeds (video speed 1.5 + audio speed 1.2)
            self.assertGreaterEqual(len(content["materials"]["speeds"]), 2)
            # Assert beauty effect in effects
            self.assertGreaterEqual(len(content["materials"]["effects"]), 1)

            # Assert rich text styling in texts
            raw_text_content = content["materials"]["texts"][0]["content"]
            parsed_text = json.loads(raw_text_content)
            self.assertTrue(any(s.get("range") == [0, 2] for s in parsed_text.get("styles", [])))

            # Assert flip_horizontal in video segment clip_settings
            v_seg = [t for t in content["tracks"] if t["type"] == "video"][0]["segments"][0]
            self.assertTrue(v_seg.get("clip", {}).get("flip", {}).get("horizontal", False))

    def test_fuzzy_resolver_anti_hallucination(self):
        from leo_capcut.registry import AssetRegistry, EnumResolutionError
        reg = AssetRegistry.get()

        # 1. Fuzzy matching
        resolved_text_outro = reg.resolve("text_outros", "向上滑")
        self.assertEqual(resolved_text_outro.name, "向上滑动")

        resolved_filter = reg.resolve("filters", "1980")
        self.assertEqual(resolved_filter.name, "_1980")

        resolved_tone = reg.resolve("tone_effects", "小帅")
        self.assertEqual(resolved_tone.name, "解说小帅")

        resolved_effect = reg.resolve("video_scene_effects", "90s")
        self.assertEqual(resolved_effect.name, "_90s画质")

        # 2. Safe Fallback for wild hallucination
        resolved_wild = reg.resolve("transitions", "量子折叠神级转场", fallback_to_safe=True)
        self.assertEqual(resolved_wild.name, "叠化")
        resolved_wild_font = reg.resolve("fonts", "量子超级字体", fallback_to_safe=True)
        self.assertEqual(resolved_wild_font.name, "宋体")

        # 3. Keyframe normalization
        resolved_kf = reg.resolve("keyframe_properties", "positionX")
        self.assertEqual(resolved_kf.name, "position_x")

        # 4. Strict mode raising EnumResolutionError with suggestions
        with self.assertRaises(EnumResolutionError) as ctx:
            reg.resolve("transitions", "超空间折跃", allow_fuzzy=False, fallback_to_safe=False)
        self.assertIn("Did you mean", str(ctx.exception))

    def test_comprehensive_full_asset_wiring(self):
        from leo_capcut.jianying_writer import build_draft_payloads
        from leo_capcut.timeline_ir import validate_timeline

        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            v_file = root / "sample.mp4"
            v_file.write_bytes(b"video")
            a_file = root / "bgm.mp3"
            a_file.write_bytes(b"audio")

            payload = {
                "schema_version": "1.0",
                "project_name": "test-full-wiring",
                "canvas": {"width": 1080, "height": 1920, "fps": 30},
                "duration_us": 3000000,
                "assets": [
                    {"id": "v1", "kind": "video", "uri": str(v_file), "duration_us": 3000000},
                    {"id": "a1", "kind": "audio", "uri": str(a_file), "duration_us": 3000000},
                ],
                "tracks": [
                    {
                        "id": "v-trk",
                        "type": "video",
                        "name": "video",
                        "clips": [
                            {
                                "id": "v-clip-1",
                                "start_us": 0,
                                "duration_us": 3000000,
                                "asset_id": "v1",
                                "filter_type": "1980",
                                "effect_type": "90s",
                                "skin_tone_type": "粉白",
                                "video_fade_in_us": 500000,
                                "video_fade_out_us": 500000,
                                "keyframes": [
                                    {"property": "positionX", "time_offset": 0, "value": 0.0},
                                    {"property": "positionY", "time_offset": 1000000, "value": 0.5},
                                ],
                                "scale_x": 0.8,
                                "scale_y": 0.8,
                            }
                        ],
                    },
                    {
                        "id": "t-trk",
                        "type": "text",
                        "name": "text",
                        "clips": [
                            {
                                "id": "t-clip-1",
                                "start_us": 0,
                                "duration_us": 3000000,
                                "text": "全量特性验证",
                                "font": "宋体",
                                "text_color": "#FFCC00",
                                "text_border_color": "#000000",
                                "text_border_width": 20.0,
                                "transform_y": 0.2,
                            }
                        ],
                    },
                    {
                        "id": "a-trk",
                        "type": "audio",
                        "name": "audio",
                        "clips": [
                            {
                                "id": "a-clip-1",
                                "start_us": 0,
                                "duration_us": 3000000,
                                "asset_id": "a1",
                                "speech_to_song": "Lofi",
                                "keyframes": [
                                    {"time_offset": 0, "value": 0.2},
                                    {"time_offset": 1000000, "value": 0.9},
                                ],
                            }
                        ],
                    },
                ],
            }

            tl = validate_timeline(payload)
            draft_dir = root / "drafts"
            draft_dir.mkdir()
            draft_content, meta_content = build_draft_payloads(
                tl, "proj_test", "test-full-wiring", {"v1": v_file, "a1": a_file}, draft_dir
            )
            self.assertGreaterEqual(len(draft_content["materials"]["effects"]), 1)
            self.assertGreaterEqual(len(draft_content["materials"]["video_effects"]), 1)
            self.assertGreaterEqual(len(draft_content["materials"]["texts"]), 1)
            self.assertGreaterEqual(len(draft_content["materials"]["audios"]), 1)

if __name__ == "__main__":
    unittest.main()
