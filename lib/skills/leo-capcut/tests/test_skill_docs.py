from __future__ import annotations

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class SkillDocTests(unittest.TestCase):
    def test_frontmatter_and_routing(self):
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\n"))
        self.assertIn("name: leo-capcut", text)
        self.assertIn("description:", text)
        self.assertNotIn("[TODO:", text)
        self.assertIn("Timeline IR", text)
        self.assertIn("保存为模板", text)
        self.assertIn("macos", text.lower())
        self.assertIn("windows", text.lower())
        self.assertTrue((ROOT / "agents" / "openai.yaml").is_file())
        self.assertTrue((ROOT / "references" / "architecture.md").is_file())
        self.assertTrue((ROOT / "assets" / "templates" / "scenarios" / "generic.json").is_file())

    def test_no_subskill_language(self):
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"子 skill|sub-skill|subskill", text, flags=re.IGNORECASE))


if __name__ == "__main__":
    unittest.main()

