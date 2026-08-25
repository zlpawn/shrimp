#!/usr/bin/env python3
import sys
import unittest
from pathlib import Path

# Add scripts directory to path
SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import discover_entrypoints


class TestDiscoverEntrypoints(unittest.TestCase):
    def setUp(self):
        self.fixtures_dir = Path(__file__).resolve().parent / "fixtures"

    def test_discover_ambiguous_java_repo(self):
        repo_path = self.fixtures_dir / "ambiguous-java-repo"
        entries = discover_entrypoints.discover_all_entrypoints(repo_path)
        
        # Should discover BindingController and BindingRepairCommand
        self.assertGreaterEqual(len(entries), 2)
        
        symbols = [e["source_location"]["symbol"] for e in entries]
        self.assertTrue(any("BindingController.bind" in s for s in symbols))
        self.assertTrue(any("BindingRepairCommand.relink" in s for s in symbols))

    def test_classification_detection(self):
        repo_path = self.fixtures_dir / "ambiguous-java-repo"
        entries = discover_entrypoints.discover_all_entrypoints(repo_path)
        
        for e in entries:
            self.assertIn("id", e)
            self.assertIn("name", e)
            self.assertIn("kind", e)
            self.assertIn("classification", e)
            self.assertIn("source_location", e)
            self.assertIn(e["classification"], [
                "business",
                "operations",
                "technical_infrastructure",
                "compensation_or_retry",
                "dead_or_deprecated",
                "unknown",
            ])

    def test_compatibility_wrapper_keeps_legacy_fact_ids(self):
        repo_path = self.fixtures_dir / "ambiguous-java-repo"

        entries = discover_entrypoints.discover_all_entrypoints(repo_path)

        self.assertTrue(all(entry["id"].startswith("FACT-") for entry in entries))
        self.assertTrue(all("signal_class" not in entry for entry in entries))


if __name__ == "__main__":
    unittest.main()
