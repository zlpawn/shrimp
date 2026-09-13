from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from helpers import SCRIPTS
import sys
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.preset_store import PresetStore, PresetError


class PresetStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = PresetStore(Path(self.temp.name) / "presets")

    def tearDown(self):
        self.temp.cleanup()

    def test_save_requires_explicit_intent(self):
        with self.assertRaises(PresetError):
            self.store.save(
                {
                    "id": "my-tech-promo",
                    "inherits": {"scenario": "knowledge-talk"},
                    "overrides": {"duration_seconds": 30},
                },
                explicit=False,
            )

    def test_explicit_save_stores_delta_not_absolute_paths(self):
        saved = self.store.save(
            {
                "id": "my-tech-promo",
                "name": "我的科技口播",
                "inherits": {
                    "scenario": "knowledge-talk",
                    "style": "clean-vertical",
                    "platform": "douyin",
                },
                "overrides": {"duration_seconds": 30, "pace": "fast"},
                "assets": [
                    {
                        "id": "brand-logo",
                        "kind": "image",
                        "source_path": r"C:\Users\xtea\logo.png",
                        "mode": "managed-copy",
                    }
                ],
            },
            explicit=True,
            intent="保存为模板",
        )
        loaded = self.store.load("my-tech-promo")
        self.assertEqual(loaded["inherits"]["scenario"], "knowledge-talk")
        self.assertEqual(loaded["overrides"]["duration_seconds"], 30)
        serialized = Path(saved["path"]).read_text(encoding="utf-8")
        self.assertNotIn(r"C:\Users\xtea\logo.png", serialized)
        self.assertIn("asset://my-tech-promo/brand-logo", serialized)

    def test_history_does_not_create_preset(self):
        self.store.record_project_edit({"duration_seconds": 18, "title": "今晚这条"})
        self.assertEqual(self.store.list_ids(), [])


if __name__ == "__main__":
    unittest.main()
