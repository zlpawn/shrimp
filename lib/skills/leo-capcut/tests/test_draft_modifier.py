import unittest
import tempfile
import json
import shutil
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.engine.draft_modifier import (
    inspect_draft_dict,
    apply_patch_operations,
    read_draft_content,
    inspect_draft,
    modify_draft_copy,
)

class DraftModifierTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.sample_content = {
            "id": "draft-001",
            "duration": 10_000_000,
            "canvas_config": {"width": 1080, "height": 1920, "fps": 30.0},
            "tracks": [
                {
                    "id": "track_v1",
                    "type": "video",
                    "segments": [
                        {"id": "seg_v1", "material_id": "mat_v1", "target_timerange": {"start": 0, "duration": 10_000_000}}
                    ]
                },
                {
                    "id": "track_a1",
                    "type": "audio",
                    "segments": [
                        {"id": "seg_a1", "material_id": "mat_a1", "volume": 0.5, "target_timerange": {"start": 0, "duration": 10_000_000}}
                    ]
                },
                {
                    "id": "track_t1",
                    "type": "text",
                    "segments": [
                        {"id": "seg_t1", "material_id": "mat_t1", "target_timerange": {"start": 0, "duration": 5_000_000}}
                    ]
                }
            ],
            "materials": {
                "videos": [{"id": "mat_v1", "path": "D:/assets/old_video.mp4", "duration": 10_000_000}],
                "audios": [{"id": "mat_a1", "path": "D:/assets/old_bgm.mp3", "duration": 10_000_000}],
                "texts": [{"id": "mat_t1", "content": json.dumps({"text": "原标题"})}]
            }
        }

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_inspect_draft_dict(self):
        summary = inspect_draft_dict(self.sample_content)
        self.assertEqual(summary["duration_sec"], 10.0)
        self.assertEqual(len(summary["tracks"]), 3)
        self.assertEqual(summary["tracks"][1]["type"], "audio")
        self.assertEqual(summary["tracks"][1]["clips"][0]["volume"], 0.5)

    def test_apply_patch_replace_audio_and_update_text(self):
        new_audio = self.temp_dir / "new_bgm.mp3"
        new_audio.write_bytes(b"dummy audio content")
        
        ops = [
            {"action": "replace_audio", "track_id": "track_a1", "new_asset": str(new_audio), "volume": 0.2},
            {"action": "update_text", "track_id": "track_t1", "segment_index": 0, "new_text": "新标题文案"},
            {"action": "adjust_volume", "track_id": "track_a1", "segment_index": 0, "volume": 0.3},
        ]
        
        updated = apply_patch_operations(self.sample_content, ops, self.temp_dir)
        
        # Verify text updated
        text_mat = next(m for m in updated["materials"]["texts"] if m["id"] == "mat_t1")
        text_payload = json.loads(text_mat["content"])
        self.assertEqual(text_payload["text"], "新标题文案")
        
        # Verify audio volume updated
        aud_seg = updated["tracks"][1]["segments"][0]
        self.assertEqual(aud_seg["volume"], 0.3)
        
        # Verify audio material replaced
        aud_mat = next(m for m in updated["materials"]["audios"] if m["id"] == aud_seg["material_id"])
        self.assertTrue("new_bgm.mp3" in aud_mat["path"])

    def test_apply_patch_delete_clip(self):
        ops = [
            {"action": "delete_clip", "track_id": "track_t1", "segment_index": 0}
        ]
        updated = apply_patch_operations(self.sample_content, ops, self.temp_dir)
        text_track = next(t for t in updated["tracks"] if t["id"] == "track_t1")
        self.assertEqual(len(text_track["segments"]), 0)

    def test_inspect_draft_and_modify_draft_copy(self):
        src_draft = self.temp_dir / "src_project"
        src_draft.mkdir()
        (src_draft / "draft_content.json").write_text(
            json.dumps(self.sample_content, ensure_ascii=False),
            encoding="utf-8",
        )
        (src_draft / "draft_meta_info.json").write_text(
            json.dumps({"draft_id": "draft-001", "draft_name": "src_project"}, ensure_ascii=False),
            encoding="utf-8",
        )

        inspected = inspect_draft(src_draft)
        self.assertEqual(inspected["draft_id"], "draft-001")
        self.assertEqual(inspected["draft_name"], "src_project")
        self.assertEqual(inspected["duration_sec"], 10.0)

        new_audio = self.temp_dir / "copied_bgm.mp3"
        new_audio.write_bytes(b"bgm content")
        ops = [
            {"action": "replace_audio", "track_id": "track_a1", "new_asset": str(new_audio), "volume": 0.8},
        ]
        out_dir = modify_draft_copy(src_draft, "out_project", ops, publish=False)
        self.assertTrue(out_dir.is_dir())
        self.assertTrue((out_dir / "draft_content.json").is_file())
        
        out_content = read_draft_content(out_dir)
        self.assertNotEqual(out_content["id"], "draft-001")
        aud_seg = out_content["tracks"][1]["segments"][0]
        self.assertEqual(aud_seg["volume"], 0.8)

    def test_read_draft_content_missing(self):
        with self.assertRaises(FileNotFoundError):
            read_draft_content(self.temp_dir / "non_existent_draft")

    def test_modify_draft_copy_target_exists(self):
        src_draft = self.temp_dir / "src_draft"
        src_draft.mkdir()
        (src_draft / "draft_content.json").write_text(json.dumps(self.sample_content), encoding="utf-8")
        existing_target = self.temp_dir / "existing_target"
        existing_target.mkdir()

        with self.assertRaises(FileExistsError):
            modify_draft_copy(src_draft, "existing_target", [], publish=False)

if __name__ == "__main__":
    unittest.main()
