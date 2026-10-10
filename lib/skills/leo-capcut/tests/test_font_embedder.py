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

if __name__ == "__main__":
    unittest.main()
