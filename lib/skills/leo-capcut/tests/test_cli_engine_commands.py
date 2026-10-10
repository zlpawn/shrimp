import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

CLI_PATH = Path(__file__).resolve().parents[1] / "scripts" / "leo_capcut_cli.py"
SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))


class CliEngineCommandsTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_cli_help_shows_new_commands(self):
        res = subprocess.run([sys.executable, str(CLI_PATH), "--help"], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("speech-cut", res.stdout)
        self.assertIn("inspect-draft", res.stdout)
        self.assertIn("modify-draft", res.stdout)
        self.assertIn("export", res.stdout)

    def test_cli_inspect_draft(self):
        draft_dir = self.temp_dir / "sample_draft"
        draft_dir.mkdir()
        content = {
            "id": "draft_test_1",
            "duration": 5_000_000,
            "canvas_config": {"width": 1080, "height": 1920, "fps": 30.0},
            "tracks": [
                {
                    "id": "track_v1",
                    "type": "video",
                    "segments": [
                        {"id": "seg_1", "material_id": "m1", "target_timerange": {"start": 0, "duration": 5_000_000}}
                    ],
                }
            ],
            "materials": {
                "videos": [{"id": "m1", "path": "D:/dummy.mp4", "duration": 5_000_000}]
            },
        }
        (draft_dir / "draft_content.json").write_text(json.dumps(content), encoding="utf-8")

        res = subprocess.run(
            [sys.executable, str(CLI_PATH), "inspect-draft", "--draft", str(draft_dir)],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data = json.loads(res.stdout)
        self.assertEqual(data["duration_sec"], 5.0)
        self.assertEqual(len(data["tracks"]), 1)
        self.assertEqual(data["tracks"][0]["type"], "video")

    def test_cli_modify_draft(self):
        draft_dir = self.temp_dir / "src_draft"
        draft_dir.mkdir()
        content = {
            "id": "draft_mod_1",
            "duration": 3_000_000,
            "canvas_config": {"width": 1080, "height": 1920, "fps": 30.0},
            "tracks": [
                {
                    "id": "track_t1",
                    "type": "text",
                    "segments": [
                        {"id": "seg_t1", "material_id": "mt1", "target_timerange": {"start": 0, "duration": 3_000_000}}
                    ],
                }
            ],
            "materials": {
                "texts": [{"id": "mt1", "content": json.dumps({"text": "旧文案"})}]
            },
        }
        (draft_dir / "draft_content.json").write_text(json.dumps(content), encoding="utf-8")

        patch_ops = [
            {"action": "update_text", "track_id": "track_t1", "segment_index": 0, "new_text": "新文案"}
        ]
        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "modify-draft",
                "--draft",
                str(draft_dir),
                "--patch",
                json.dumps(patch_ops),
                "--out-name",
                "cloned_draft",
                "--no-publish",
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data = json.loads(res.stdout)
        self.assertEqual(data["status"], "ok")
        from leo_capcut.engine.draft_modifier import read_draft_content
        cloned_content = read_draft_content(self.temp_dir / "cloned_draft")
        mat_text = cloned_content["materials"]["texts"][0]["content"]
        self.assertIn("新文案", mat_text)

    def test_cli_speech_cut(self):
        video_file = self.temp_dir / "speech.mp4"
        cmd_v = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=6",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_file)
        ]
        subprocess.run(cmd_v, check=True, capture_output=True)

        transcript_file = self.temp_dir / "transcript.json"
        transcript = [
            {"start_us": 0, "end_us": 2_000_000, "text": "第一句话"},
            {"start_us": 2_000_000, "end_us": 3_000_000, "text": "呃"},
            {"start_us": 4_500_000, "end_us": 6_000_000, "text": "第二句话"},
        ]
        transcript_file.write_text(json.dumps(transcript), encoding="utf-8")

        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "speech-cut",
                "--media",
                str(video_file),
                "--transcript",
                str(transcript_file),
                "--remove-silence-over",
                "0.6",
                "--remove-fillers",
                "呃",
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data = json.loads(res.stdout)
        self.assertEqual(data["status"], "ok")
        self.assertGreaterEqual(data["keep_count"], 2)
        self.assertEqual(data["subtitles_count"], 2)

    def test_cli_export(self):
        video_file = self.temp_dir / "video.mp4"
        cmd_v = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_file)
        ]
        subprocess.run(cmd_v, check=True, capture_output=True)

        tl_file = self.temp_dir / "timeline.json"
        tl_data = {
            "schema_version": "1.0",
            "project_name": "cli_export_test",
            "canvas": {"width": 320, "height": 240, "fps": 30},
            "duration_us": 1_000_000,
            "assets": [
                {"id": "a1", "kind": "video", "uri": str(video_file).replace("\\", "/"), "duration_us": 1_000_000}
            ],
            "tracks": [
                {
                    "id": "t1",
                    "type": "video",
                    "name": "Main",
                    "clips": [{"id": "c1", "asset_id": "a1", "start_us": 0, "duration_us": 1_000_000}],
                }
            ],
        }
        tl_file.write_text(json.dumps(tl_data), encoding="utf-8")
        out_mp4 = self.temp_dir / "out.mp4"

        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "export",
                "--timeline",
                str(tl_file),
                "--out",
                str(out_mp4),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data = json.loads(res.stdout)
        self.assertEqual(data["status"], "ok")
        self.assertTrue(out_mp4.is_file())

    def test_cli_export_from_draft(self):
        draft_dir = self.temp_dir / "draft_for_export"
        draft_dir.mkdir()
        video_file = self.temp_dir / "video2.mp4"
        cmd_v = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=green:s=320x240:d=1",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_file)
        ]
        subprocess.run(cmd_v, check=True, capture_output=True)

        content = {
            "id": "draft_exp_test",
            "duration": 1_000_000,
            "canvas_config": {"width": 320, "height": 240, "fps": 30.0},
            "tracks": [
                {
                    "id": "trk_v",
                    "type": "video",
                    "segments": [
                        {"id": "seg_v", "material_id": "mat_v", "target_timerange": {"start": 0, "duration": 1_000_000}}
                    ],
                }
            ],
            "materials": {
                "videos": [{"id": "mat_v", "path": str(video_file).replace("\\", "/"), "duration": 1_000_000}]
            },
        }
        (draft_dir / "draft_content.json").write_text(json.dumps(content), encoding="utf-8")
        out_mp4 = self.temp_dir / "out_from_draft.mp4"

        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "export",
                "--draft",
                str(draft_dir),
                "--out",
                str(out_mp4),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data = json.loads(res.stdout)
        self.assertEqual(data["status"], "ok")
        self.assertTrue(out_mp4.is_file())

    def test_cli_speech_cut_with_export_and_bgm(self):
        video_file = self.temp_dir / "speech_bgm.mp4"
        cmd_v = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=yellow:s=320x240:d=3",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_file)
        ]
        subprocess.run(cmd_v, check=True, capture_output=True)

        bgm_file = self.temp_dir / "bgm.mp3"
        cmd_a = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo:d=3",
            "-c:a", "libmp3lame", str(bgm_file)
        ]
        subprocess.run(cmd_a, check=True, capture_output=True)

        out_mp4 = self.temp_dir / "speech_cut_export.mp4"
        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "speech-cut",
                "--media",
                str(video_file),
                "--bgm",
                str(bgm_file),
                "--bgm-volume",
                "0.3",
                "--export",
                str(out_mp4),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        data = json.loads(res.stdout)
        self.assertEqual(data["status"], "ok")
        self.assertTrue(out_mp4.is_file())


    def test_cli_speech_cut_timeline_has_source_start_us(self):
        video_file = self.temp_dir / "speech_src.mp4"
        cmd_v = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x240:d=6",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_file)
        ]
        subprocess.run(cmd_v, check=True, capture_output=True)

        transcript_file = self.temp_dir / "transcript_src.json"
        transcript = [
            {"start_us": 0, "end_us": 2_000_000, "text": "第一句话"},
            {"start_us": 2_000_000, "end_us": 3_000_000, "text": "呃"},
            {"start_us": 4_500_000, "end_us": 6_000_000, "text": "第二句话"},
        ]
        transcript_file.write_text(json.dumps(transcript), encoding="utf-8")

        tl_out = self.temp_dir / "out_speech_tl.json"
        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "speech-cut",
                "--media",
                str(video_file),
                "--transcript",
                str(transcript_file),
                "--remove-silence-over",
                "0.6",
                "--remove-fillers",
                "呃",
                "--out-timeline",
                str(tl_out),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        self.assertTrue(tl_out.is_file())
        tl_data = json.loads(tl_out.read_text(encoding="utf-8"))
        video_track = next(t for t in tl_data["tracks"] if t["type"] == "video")
        clips = video_track["clips"]
        self.assertEqual(len(clips), 2)
        self.assertEqual(clips[0]["source_start_us"], 0)
        self.assertEqual(clips[1]["source_start_us"], 4_400_000)

    def test_cli_speech_cut_with_font_and_draft_output(self):
        video_file = self.temp_dir / "speech_font_vid.mp4"
        cmd_v = [
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=6",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video_file)
        ]
        subprocess.run(cmd_v, check=True, capture_output=True)

        transcript_file = self.temp_dir / "transcript_font.json"
        transcript = [
            {"start_us": 0, "end_us": 2_000_000, "text": "第一句话"},
            {"start_us": 2_000_000, "end_us": 3_000_000, "text": "呃"},
            {"start_us": 4_500_000, "end_us": 6_000_000, "text": "第二句话"},
        ]
        transcript_file.write_text(json.dumps(transcript), encoding="utf-8")

        dummy_font = self.temp_dir / "CustomBrandFont.ttf"
        dummy_font.write_bytes(b"custom font binary")

        draft_target = self.temp_dir / "draft_out_proj"
        res = subprocess.run(
            [
                sys.executable,
                str(CLI_PATH),
                "speech-cut",
                "--media",
                str(video_file),
                "--transcript",
                str(transcript_file),
                "--remove-silence-over",
                "0.6",
                "--remove-fillers",
                "呃",
                "--out-draft",
                str(draft_target),
                "--font",
                str(dummy_font),
            ],
            capture_output=True,
            text=True,
        )
        self.assertEqual(res.returncode, 0, msg=res.stderr)
        self.assertTrue(draft_target.is_dir())
        
        # Verify font was copied to resources/fonts
        font_in_draft = draft_target / "resources" / "fonts" / "CustomBrandFont.ttf"
        self.assertTrue(font_in_draft.is_file())

        # Verify draft_content.json has font material registered
        draft_content_path = draft_target / "draft_content.json"
        self.assertTrue(draft_content_path.is_file())
        from leo_capcut.engine.draft_modifier import read_draft_content
        draft_content = read_draft_content(draft_target)
        fonts = draft_content.get("materials", {}).get("fonts", [])
        self.assertTrue(any(f.get("title") == "CustomBrandFont" for f in fonts))

        # Verify second video segment has source offset > 0
        v_track = next(t for t in draft_content["tracks"] if t["type"] == "video")
        self.assertEqual(len(v_track["segments"]), 2)
        seg2_source_start = v_track["segments"][1]["source_timerange"]["start"]
        self.assertEqual(seg2_source_start, 4_400_000)


if __name__ == "__main__":
    unittest.main()
