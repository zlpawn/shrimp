import unittest
import tempfile
import shutil
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.engine.font_embedder import parse_font_metadata, embed_font_into_draft

class FontEmbedderTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_parse_font_metadata(self):
        dummy_font = self.temp_dir / "CustomTitleFont.ttf"
        dummy_font.write_bytes(b"dummy font content")
        meta = parse_font_metadata(dummy_font)
        self.assertEqual(meta["title"], "CustomTitleFont")
        self.assertEqual(meta["file_name"], "CustomTitleFont.ttf")
        self.assertEqual(meta["family_name"], "CustomTitleFont")
        self.assertEqual(meta["extension"], ".ttf")

    def test_embed_font_into_draft(self):
        draft_dir = self.temp_dir / "draft_project"
        draft_dir.mkdir()
        font_file = self.temp_dir / "MyArtFont.otf"
        font_file.write_bytes(b"sample otf binary")
        
        font_material = embed_font_into_draft(draft_dir, font_file)
        
        # Verify font copied into draft resources/fonts
        target_font = draft_dir / "resources" / "fonts" / "MyArtFont.otf"
        self.assertTrue(target_font.is_file())
        self.assertEqual(font_material["title"], "MyArtFont")
        self.assertEqual(font_material["resource_type"], "font")
        self.assertTrue(len(font_material["id"]) > 0)
        self.assertEqual(font_material["relative_path"], "resources/fonts/MyArtFont.otf")
        self.assertEqual(font_material["type"], "font")

    def test_embed_font_file_not_found(self):
        draft_dir = self.temp_dir / "draft_project"
        draft_dir.mkdir()
        non_existent_font = self.temp_dir / "non_existent.ttf"
        with self.assertRaises(FileNotFoundError):
            embed_font_into_draft(draft_dir, non_existent_font)

    def test_embed_font_injects_into_plaintext_draft_content(self):
        import json
        draft_dir = self.temp_dir / "draft_with_json"
        draft_dir.mkdir()
        content = {
            "id": "draft_001",
            "tracks": [],
            "materials": {"videos": [], "fonts": []},
        }
        (draft_dir / "draft_content.json").write_text(json.dumps(content), encoding="utf-8")

        font_file = self.temp_dir / "SampleFont.ttf"
        font_file.write_bytes(b"sample font data")

        mat = embed_font_into_draft(draft_dir, font_file)
        self.assertEqual(mat["title"], "SampleFont")

        updated = json.loads((draft_dir / "draft_content.json").read_text(encoding="utf-8"))
        self.assertIn("fonts", updated["materials"])
        self.assertEqual(len(updated["materials"]["fonts"]), 1)
        self.assertEqual(updated["materials"]["fonts"][0]["title"], "SampleFont")

    def test_embed_font_handles_encrypted_draft_content(self):
        import json
        from unittest.mock import patch
        draft_dir = self.temp_dir / "draft_enc"
        draft_dir.mkdir()
        # Non-JSON prefix indicates encrypted content
        (draft_dir / "draft_content.json").write_bytes(b"\x00\x01\x02ENCRYPTED")

        font_file = self.temp_dir / "EncFont.ttf"
        font_file.write_bytes(b"enc font data")

        mock_content = {
            "id": "draft_enc",
            "tracks": [],
            "materials": {"fonts": []},
        }

        with patch("leo_capcut.engine.font_embedder.detect_environment", return_value={"install_dir": "D:/dummy"}), \
             patch("leo_capcut.engine.font_embedder.IsolatedJianyingCodec.decode", return_value=mock_content), \
             patch("leo_capcut.engine.font_embedder.IsolatedJianyingCodec.encode", return_value=b"RE_ENCODED"):
            mat = embed_font_into_draft(draft_dir, font_file)
            self.assertEqual(mat["title"], "EncFont")

        self.assertEqual((draft_dir / "draft_content.json").read_bytes(), b"RE_ENCODED")


if __name__ == "__main__":
    unittest.main()
