import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "repository_snapshot.py"
SPEC = importlib.util.spec_from_file_location("repository_snapshot", SCRIPT)
snapshot = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(snapshot)


class RepositorySnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.email", "test@example.com"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.name", "Snapshot Test"],
            check=True,
        )
        (self.repo / "src").mkdir()
        (self.repo / "src" / "Order.java").write_text(
            "class Order { int version = 1; }\n",
            encoding="utf-8",
        )
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "commit", "-qm", "initial"],
            check=True,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_clean_capture_has_stable_content_hash(self):
        first = snapshot.capture_snapshot(self.repo, exclusions=[])
        second = snapshot.capture_snapshot(self.repo, exclusions=[])

        self.assertTrue(first["git"]["is_repository"])
        self.assertFalse(first["working_tree_dirty"])
        self.assertEqual(first["snapshot_sha256"], second["snapshot_sha256"])
        self.assertIn("src/Order.java", first["files"])
        self.assertNotIn(".git/HEAD", first["files"])

    def test_dirty_file_changes_snapshot_without_head_change(self):
        before = snapshot.capture_snapshot(self.repo, exclusions=[])
        (self.repo / "src" / "Order.java").write_text(
            "class Order { int version = 2; }\n",
            encoding="utf-8",
        )
        after = snapshot.capture_snapshot(self.repo, exclusions=[])

        self.assertEqual(before["git"]["head_sha"], after["git"]["head_sha"])
        self.assertNotEqual(before["snapshot_sha256"], after["snapshot_sha256"])
        self.assertTrue(after["working_tree_dirty"])
        diff = snapshot.compare_snapshot(before, after)
        self.assertEqual(diff["modified"], ["src/Order.java"])

    def test_added_and_deleted_files_are_reported(self):
        before = snapshot.capture_snapshot(self.repo, exclusions=[])
        (self.repo / "README.md").unlink()
        (self.repo / "src" / "NewRule.java").write_text(
            "class NewRule {}\n",
            encoding="utf-8",
        )
        after = snapshot.capture_snapshot(self.repo, exclusions=[])
        diff = snapshot.compare_snapshot(before, after)

        self.assertEqual(diff["added"], ["src/NewRule.java"])
        self.assertEqual(diff["deleted"], ["README.md"])

    def test_excluded_business_output_is_not_hashed(self):
        output = self.repo / "_business_knowledge"
        output.mkdir()
        (output / "current.json").write_text("{}\n", encoding="utf-8")
        result = snapshot.capture_snapshot(
            self.repo,
            exclusions=["_business_knowledge/**"],
        )

        self.assertNotIn("_business_knowledge/current.json", result["files"])
        self.assertIn("_business_knowledge/**", result["exclusions"])

    def test_compare_accepts_snapshot_path(self):
        before = snapshot.capture_snapshot(self.repo, exclusions=[])
        before_path = Path(self.temp.name) / "before.json"
        before_path.write_text(json.dumps(before), encoding="utf-8")
        (self.repo / "README.md").write_text("changed\n", encoding="utf-8")

        result = snapshot.compare_snapshot(
            snapshot.load_snapshot(before_path),
            snapshot.capture_snapshot(self.repo, exclusions=[]),
        )

        self.assertEqual(result["modified"], ["README.md"])

    def test_cli_writes_outside_repository_atomically(self):
        output = Path(self.temp.name) / "snapshot.json"
        subprocess.run(
            [
                "python3",
                str(SCRIPT),
                "capture",
                "--repo",
                str(self.repo),
                "--output",
                str(output),
            ],
            check=True,
        )

        data = json.loads(output.read_text(encoding="utf-8"))
        self.assertEqual(data["canonical_root"], str(self.repo.resolve()))
        self.assertFalse(any(self.repo.glob("*.partial")))


if __name__ == "__main__":
    unittest.main()
