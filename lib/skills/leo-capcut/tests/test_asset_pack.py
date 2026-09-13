from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from helpers import SCRIPTS, write_json
import sys
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.asset_store import AssetStore
from leo_capcut.preset_store import PresetStore


class AssetPackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.store = PresetStore(self.root / "presets")
        self.assets = AssetStore(self.root / "assets")

    def tearDown(self):
        self.temp.cleanup()

    def test_export_import_is_portable_and_defaults_to_copy_on_conflict(self):
        source = self.root / "logo.png"
        source.write_bytes(b"fake-png")
        self.store.save(
            {
                "id": "my-tech-promo",
                "inherits": {"scenario": "knowledge-talk", "platform": "douyin"},
                "overrides": {"duration_seconds": 30},
                "assets": [
                    {
                        "id": "brand-logo",
                        "kind": "image",
                        "source_path": str(source),
                        "mode": "managed-copy",
                    }
                ],
            },
            explicit=True,
            intent="保存为模板",
            asset_store=self.assets,
        )
        pack = self.store.export_pack("my-tech-promo", self.root / "pack")
        manifest = (pack / "pack.json").read_text(encoding="utf-8")
        self.assertNotIn("C:\\\\", manifest.replace("/", "\\"))
        self.assertIn("\"schema_version\"", manifest)

        imported = self.store.import_pack(pack, conflict="copy")
        self.assertEqual(imported["id"], "my-tech-promo")

        # Importing again with default policy must not overwrite.
        second = self.store.import_pack(pack)
        self.assertNotEqual(second["id"], "my-tech-promo")
        self.assertTrue(second["id"].startswith("my-tech-promo-"))
        self.assertIn("my-tech-promo", self.store.list_ids())
        self.assertIn(second["id"], self.store.list_ids())


if __name__ == "__main__":
    unittest.main()
