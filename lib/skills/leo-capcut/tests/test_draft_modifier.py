import unittest
import tempfile
import json
import shutil
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from unittest.mock import patch

from leo_capcut.engine.draft_modifier import (
    inspect_draft_dict,
    apply_patch_operations,
    read_draft_content,
    inspect_draft,
    modify_draft_copy,
    publish_draft_safely,
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

    def test_publish_draft_safely_refuses_when_running(self):
        draft_dir = self.temp_dir / "draft_test"
        draft_dir.mkdir()
        with patch("leo_capcut.engine.draft_modifier.detect_environment", return_value={"jianying_running": True}):
            with self.assertRaises(RuntimeError) as ctx:
                publish_draft_safely(draft_dir, "draft-1", "draft_test")
            self.assertIn("running", str(ctx.exception).lower())

    def test_publish_draft_safely_creates_backup_and_registers(self):
        draft_dir = self.temp_dir / "draft_proj"
        draft_dir.mkdir()

        user_data = self.temp_dir / "user_data"
        reg_dir = user_data / "Projects" / "com.lveditor.draft"
        reg_dir.mkdir(parents=True)
        root_meta = reg_dir / "root_meta_info.json"
        initial_payload = {
            "all_draft_store": [
                {
                    "draft_id": "existing-001",
                    "draft_name": "existing_project",
                    "draft_fold_path": "D:/drafts/existing_project",
                    "tm_duration": 1_000_000,
                }
            ]
        }
        root_meta.write_text(json.dumps(initial_payload, indent=2), encoding="utf-8")

        mock_env = {
            "jianying_running": False,
            "user_data": str(user_data),
        }
        with patch("leo_capcut.engine.draft_modifier.detect_environment", return_value=mock_env):
            backup_file = publish_draft_safely(
                draft_dir,
                draft_id="new-002",
                draft_name="new_project",
                duration_us=3_000_000,
            )

        self.assertIsNotNone(backup_file)
        self.assertTrue(backup_file.is_file())
        backup_content = json.loads(backup_file.read_text(encoding="utf-8"))
        self.assertEqual(len(backup_content["all_draft_store"]), 1)

        updated_content = json.loads(root_meta.read_text(encoding="utf-8"))
        self.assertEqual(len(updated_content["all_draft_store"]), 2)
        new_entry = updated_content["all_draft_store"][1]
        self.assertEqual(new_entry["draft_id"], "new-002")
        self.assertEqual(new_entry["draft_name"], "new_project")
        self.assertEqual(new_entry["tm_duration"], 3_000_000)

    def test_publish_draft_safely_rolls_back_on_failure(self):
        draft_dir = self.temp_dir / "draft_fail"
        draft_dir.mkdir()

        user_data = self.temp_dir / "user_data_fail"
        reg_dir = user_data / "Projects" / "com.lveditor.draft"
        reg_dir.mkdir(parents=True)
        root_meta = reg_dir / "root_meta_info.json"
        original_bytes = b'{"all_draft_store": [{"draft_id": "safe-001"}]}'
        root_meta.write_bytes(original_bytes)

        mock_env = {
            "jianying_running": False,
            "user_data": str(user_data),
        }

        # Simulate exception during json write
        with patch("leo_capcut.engine.draft_modifier.detect_environment", return_value=mock_env):
            with patch("json.dumps", side_effect=RuntimeError("serialization exploded")):
                with self.assertRaises(RuntimeError):
                    publish_draft_safely(draft_dir, "new-id", "new_name")

        # Verify root_meta was rolled back to original_bytes
        self.assertEqual(root_meta.read_bytes(), original_bytes)

    def test_modify_draft_copy_cleans_up_on_failure(self):
        src_draft = self.temp_dir / "src_for_cleanup"
        src_draft.mkdir()
        (src_draft / "draft_content.json").write_text(
            json.dumps(self.sample_content),
            encoding="utf-8",
        )

        with patch("leo_capcut.engine.draft_modifier.apply_patch_operations", side_effect=ValueError("Patch crashed")):
            with self.assertRaises(ValueError):
                modify_draft_copy(src_draft, "cleaned_up_target", [], publish=False)

        target_dir = src_draft.parent / "cleaned_up_target"
        self.assertFalse(target_dir.exists())

    def test_modify_draft_copy_refuses_when_running_before_copy(self):
        src_draft = self.temp_dir / "src_running"
        src_draft.mkdir()
        (src_draft / "draft_content.json").write_text(
            json.dumps(self.sample_content),
            encoding="utf-8",
        )

        with patch("leo_capcut.engine.draft_modifier.detect_environment", return_value={"jianying_running": True}):
            with self.assertRaises(RuntimeError) as ctx:
                modify_draft_copy(src_draft, "should_not_exist", [], publish=True)
            self.assertIn("running", str(ctx.exception).lower())

        target_dir = src_draft.parent / "should_not_exist"
        self.assertFalse(target_dir.exists())

    def test_read_draft_content_handles_utf8_bom(self):
        draft_dir = self.temp_dir / "bom_draft"
        draft_dir.mkdir()
        bom_bytes = b"\xef\xbb\xbf" + json.dumps(self.sample_content).encode("utf-8")
        (draft_dir / "draft_content.json").write_bytes(bom_bytes)

        loaded = read_draft_content(draft_dir)
        self.assertEqual(loaded["id"], "draft-001")

    def test_apply_patch_avoids_asset_name_collision(self):
        dir_a = self.temp_dir / "dir_a"
        dir_b = self.temp_dir / "dir_b"
        dir_a.mkdir()
        dir_b.mkdir()
        audio_a = dir_a / "same_name.mp3"
        audio_b = dir_b / "same_name.mp3"
        audio_a.write_bytes(b"content-a")
        audio_b.write_bytes(b"content-b")

        ops = [
            {"action": "replace_audio", "track_id": "track_a1", "new_asset": str(audio_a)},
            {"action": "replace_audio", "track_id": "track_a1", "new_asset": str(audio_b)},
        ]
        asset_dir = self.temp_dir / "assets_target"
        asset_dir.mkdir()
        apply_patch_operations(self.sample_content, ops, asset_dir)

        copied_files = list(asset_dir.glob("*.mp3"))
        self.assertEqual(len(copied_files), 2)
        for f in copied_files:
            self.assertTrue(f.name.endswith("_same_name.mp3"))

    def test_modify_draft_copy_fuse_aborts_when_codec_fails(self):
        src_draft = self.temp_dir / "src_fuse"
        src_draft.mkdir()
        (src_draft / "draft_content.json").write_text(
            json.dumps(self.sample_content),
            encoding="utf-8",
        )

        with patch("leo_capcut.engine.draft_modifier.IsolatedJianyingCodec.encode", side_effect=RuntimeError("codec exploded")):
            with self.assertRaises(RuntimeError) as ctx:
                modify_draft_copy(
                    src_draft,
                    "target_fuse",
                    [],
                    publish=False,
                    env={"install_dir": "D:/dummy/install", "jianying_running": False},
                )
            self.assertIn("codec exploded", str(ctx.exception))

        target_dir = src_draft.parent / "target_fuse"
        self.assertFalse(target_dir.exists())

    def test_modify_draft_copy_aborts_when_meta_corrupted(self):
        src_draft = self.temp_dir / "src_meta_corrupt"
        src_draft.mkdir()
        (src_draft / "draft_content.json").write_text(
            json.dumps(self.sample_content),
            encoding="utf-8",
        )
        (src_draft / "draft_meta_info.json").write_bytes(b"{not valid json")

        with self.assertRaises(Exception):
            modify_draft_copy(src_draft, "target_corrupt", [], publish=False, env={"install_dir": ""})

        target_dir = src_draft.parent / "target_corrupt"
        self.assertFalse(target_dir.exists())

if __name__ == "__main__":
    unittest.main()
