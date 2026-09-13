from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from helpers import SCRIPTS, sample_timeline, write_json
import sys
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.adapters.jianying import (
    JianyingAdapter,
    JianyingBusyError,
    JianyingCapabilityError,
    JianyingPublishError,
)


class FakeProcess:
    def __init__(self, running: bool = False):
        self.running = running

    def is_running(self) -> bool:
        return self.running


class FakeCodec:
    MAGIC = b"JYENC"

    def encode(self, payload: dict) -> bytes:
        return self.MAGIC + json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")

    def decode(self, raw: bytes) -> dict:
        if not raw.startswith(self.MAGIC):
            raise ValueError("not encrypted")
        return json.loads(raw[len(self.MAGIC):].decode("utf-8"))


class JianyingAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.draft_root = self.root / "drafts"
        self.user_data = self.root / "user-data"
        self.media = self.root / "clip-a.mp4"
        self.media.write_bytes(b"fake-mp4")
        self.draft_root.mkdir()
        meta_dir = self.user_data / "Projects" / "com.lveditor.draft"
        meta_dir.mkdir(parents=True)
        self.root_meta = write_json(
            meta_dir / "root_meta_info.json",
            {
                "all_draft_store": [
                    {"draft_id": "OLD-1", "draft_name": "已有草稿", "draft_fold_path": "C:/old"}
                ]
            },
        )
        self.timeline = sample_timeline("AI Agent 测试草稿")
        self.timeline["assets"][0]["uri"] = str(self.media)

    def tearDown(self):
        self.temp.cleanup()

    def make_adapter(self, *, running: bool = False, platform: str = "windows"):
        return JianyingAdapter(
            platform=platform,
            draft_root=self.draft_root,
            user_data=self.user_data,
            install_dir=self.root / "install",
            process_checker=FakeProcess(running),
            codec=FakeCodec(),
        )

    def test_windows_capabilities_are_implemented(self):
        caps = self.make_adapter().capabilities()
        self.assertEqual(caps["status"], "implemented")
        self.assertTrue(caps["can_publish"])
        self.assertTrue(caps["can_register"])

    def test_macos_capabilities_are_planned(self):
        adapter = self.make_adapter(platform="darwin")
        caps = adapter.capabilities()
        self.assertEqual(caps["status"], "planned")
        self.assertFalse(caps["can_publish"])
        with self.assertRaises(JianyingCapabilityError):
            adapter.publish(self.timeline, project_name="mac draft", register=True)

    def test_refuses_to_register_while_jianying_is_running(self):
        adapter = self.make_adapter(running=True)
        with self.assertRaises(JianyingBusyError):
            adapter.publish(self.timeline, project_name="busy", register=True)
        self.assertEqual(
            json.loads(self.root_meta.read_text(encoding="utf-8"))["all_draft_store"][0]["draft_id"],
            "OLD-1",
        )

    def test_publish_encrypts_copies_media_and_preserves_old_entries(self):
        adapter = self.make_adapter()
        result = adapter.publish(self.timeline, project_name="AI Agent 测试草稿", register=True)
        draft_dir = Path(result.draft_dir)
        content = (draft_dir / "draft_content.json").read_bytes()
        meta = (draft_dir / "draft_meta_info.json").read_bytes()
        self.assertTrue(content.startswith(FakeCodec.MAGIC))
        self.assertTrue(meta.startswith(FakeCodec.MAGIC))
        decoded = FakeCodec().decode(content)
        self.assertEqual(decoded["id"], result.project_id)
        self.assertNotEqual(result.project_id, "OLD-1")
        copied = list((draft_dir / "agent_media").glob("*"))
        self.assertEqual(len(copied), 1)
        homepage = json.loads(self.root_meta.read_text(encoding="utf-8"))["all_draft_store"]
        self.assertEqual(len(homepage), 2)
        self.assertEqual(homepage[0]["draft_id"], "OLD-1")
        self.assertTrue(Path(result.backup_path).is_file())

    def test_failed_publish_rolls_back_homepage_and_quarantines_draft(self):
        adapter = self.make_adapter()

        def exploding_codec_encode(payload):
            raise RuntimeError("boom")

        adapter.codec.encode = exploding_codec_encode  # type: ignore[method-assign]
        with self.assertRaises(JianyingPublishError):
            adapter.publish(self.timeline, project_name="失败草稿", register=True)
        homepage = json.loads(self.root_meta.read_text(encoding="utf-8"))["all_draft_store"]
        self.assertEqual(homepage, [{"draft_id": "OLD-1", "draft_name": "已有草稿", "draft_fold_path": "C:/old"}])
        self.assertFalse((self.draft_root / "失败草稿").exists())

    def test_does_not_overwrite_existing_draft(self):
        existing = self.draft_root / "AI Agent 测试草稿"
        existing.mkdir()
        (existing / "keep.txt").write_text("keep", encoding="utf-8")
        adapter = self.make_adapter()
        with self.assertRaises(FileExistsError):
            adapter.publish(self.timeline, project_name="AI Agent 测试草稿", register=True)
        self.assertEqual((existing / "keep.txt").read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
