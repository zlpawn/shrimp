import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.timeline_ir import Timeline, Track, Clip, Asset, Canvas
from leo_capcut.engine.ffmpeg_renderer import (
    find_system_font,
    compile_filtergraph,
    render_timeline_mp4,
    assert_render_quality,
)


class FfmpegRendererTests(unittest.TestCase):
    def test_compile_filtergraph_video_audio_text(self):
        tl = Timeline(
            schema_version="1.0",
            project_name="demo",
            canvas=Canvas(width=1080, height=1920, fps=30),
            duration_us=5_000_000,
            assets=[
                Asset(id="a_v", kind="video", uri="D:/video.mp4", duration_us=5_000_000),
                Asset(id="a_a", kind="audio", uri="D:/bgm.mp3", duration_us=5_000_000),
            ],
            tracks=[
                Track(id="t_v", type="video", name="Main", clips=[
                    Clip(id="c1", asset_id="a_v", start_us=0, duration_us=5_000_000)
                ]),
                Track(id="t_a", type="audio", name="Audio", clips=[
                    Clip(id="c2", asset_id="a_a", start_us=0, duration_us=5_000_000, volume=0.5)
                ]),
                Track(id="t_t", type="text", name="Sub", clips=[
                    Clip(id="c3", text="测试字幕", start_us=1_000_000, duration_us=3_000_000)
                ]),
            ]
        )
        inputs, filters, out_v, out_a = compile_filtergraph(tl)
        self.assertEqual(len(inputs), 4)
        self.assertEqual(inputs.count("-i"), 2)
        filter_str = ";".join(filters)
        self.assertTrue("drawtext=" in filter_str)
        self.assertTrue("volume=" in filter_str or "amix" in filter_str)
        self.assertTrue(len(out_v) > 0)
        self.assertTrue(len(out_a) > 0)

    def test_compile_filtergraph_fallbacks_black_and_silence(self):
        tl = Timeline(
            schema_version="1.0",
            project_name="fallback_demo",
            canvas=Canvas(width=720, height=1280, fps=30),
            duration_us=3_000_000,
            assets=[],
            tracks=[],
        )
        inputs, filters, out_v, out_a = compile_filtergraph(tl)
        self.assertEqual(len(inputs), 0)
        filter_str = ";".join(filters)
        self.assertIn("color=c=black:s=720x1280:d=3.0[v_base]", filter_str)
        self.assertIn("anullsrc=r=44100:cl=stereo:d=3.0[out_a]", filter_str)
        self.assertEqual(out_v, "[v_base]")
        self.assertEqual(out_a, "[out_a]")

    def test_compile_filtergraph_multiple_audio_amix(self):
        tl = Timeline(
            schema_version="1.0",
            project_name="amix_demo",
            canvas=Canvas(width=1080, height=1920, fps=30),
            duration_us=4_000_000,
            assets=[
                Asset(id="a_bgm", kind="audio", uri="D:/bgm.mp3", duration_us=4_000_000),
                Asset(id="a_vox", kind="audio", uri="D:/voice.wav", duration_us=4_000_000),
            ],
            tracks=[
                Track(id="t_a1", type="audio", name="BGM", clips=[
                    Clip(id="c1", asset_id="a_bgm", start_us=0, duration_us=4_000_000, volume=0.3)
                ]),
                Track(id="t_a2", type="audio", name="Voice", clips=[
                    Clip(id="c2", asset_id="a_vox", start_us=1_000_000, duration_us=3_000_000, volume=1.0)
                ]),
            ]
        )
        inputs, filters, out_v, out_a = compile_filtergraph(tl)
        self.assertEqual(len(inputs), 4)
        filter_str = ";".join(filters)
        self.assertIn("amix=inputs=2:duration=longest:normalize=0[out_a]", filter_str)
        self.assertIn("adelay=0|0,volume=0.3", filter_str)
        self.assertIn("adelay=1000|1000,volume=1.0", filter_str)

    def test_find_system_font(self):
        font = find_system_font()
        self.assertIsInstance(font, str)
        self.assertTrue(len(font) > 0)
        self.assertNotIn("\\", font)

    def test_render_timeline_mp4_and_assert_quality(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            tmp_path = Path(tmp_dir)
            video_asset = tmp_path / "dummy_video.mp4"
            audio_asset = tmp_path / "dummy_audio.mp3"
            out_mp4 = tmp_path / "output.mp4"

            # Create minimal 1-second valid video and audio files using ffmpeg
            cmd_v = [
                "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_asset)
            ]
            subprocess.run(cmd_v, check=True, capture_output=True)

            cmd_a = [
                "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=1",
                "-c:a", "libmp3lame", str(audio_asset)
            ]
            subprocess.run(cmd_a, check=True, capture_output=True)

            tl = Timeline(
                schema_version="1.0",
                project_name="render_test",
                canvas=Canvas(width=320, height=240, fps=30),
                duration_us=1_000_000,
                assets=[
                    Asset(id="a_v", kind="video", uri=str(video_asset).replace("\\", "/"), duration_us=1_000_000),
                    Asset(id="a_a", kind="audio", uri=str(audio_asset).replace("\\", "/"), duration_us=1_000_000),
                ],
                tracks=[
                    Track(id="t_v", type="video", name="Main", clips=[
                        Clip(id="c1", asset_id="a_v", start_us=0, duration_us=1_000_000)
                    ]),
                    Track(id="t_a", type="audio", name="BGM", clips=[
                        Clip(id="c2", asset_id="a_a", start_us=0, duration_us=1_000_000, volume=0.8)
                    ]),
                    Track(id="t_t", type="text", name="Sub", clips=[
                        Clip(id="c3", text="Hello", start_us=0, duration_us=1_000_000)
                    ]),
                ]
            )

            res_path = render_timeline_mp4(tl, out_mp4)
            self.assertEqual(res_path, out_mp4)
            self.assertTrue(out_mp4.is_file())
            self.assertGreater(out_mp4.stat().st_size, 0)

            # Test quality assertion
            meta = assert_render_quality(out_mp4, expected_duration_us=1_000_000)
            self.assertIn("format", meta)
            self.assertIn("streams", meta)

            # Test duration mismatch error
            with self.assertRaises(ValueError):
                assert_render_quality(out_mp4, expected_duration_us=10_000_000)

    def test_render_timeline_mp4_failure(self):
        tl = Timeline(
            schema_version="1.0",
            project_name="fail_test",
            canvas=Canvas(width=320, height=240, fps=30),
            duration_us=1_000_000,
            assets=[
                Asset(id="a_v", kind="video", uri="non_existent_file_xyz123.mp4", duration_us=1_000_000)
            ],
            tracks=[
                Track(id="t_v", type="video", name="Main", clips=[
                    Clip(id="c1", asset_id="a_v", start_us=0, duration_us=1_000_000)
                ])
            ]
        )
        with tempfile.TemporaryDirectory() as tmp_dir:
            out_file = Path(tmp_dir) / "fail.mp4"
            with self.assertRaises(RuntimeError):
                render_timeline_mp4(tl, out_file)

    def test_assert_render_quality_missing_file_failure(self):
        with self.assertRaises(RuntimeError):
            assert_render_quality(Path("non_existent_file_abc999.mp4"), expected_duration_us=1_000_000)


if __name__ == "__main__":
    unittest.main()
