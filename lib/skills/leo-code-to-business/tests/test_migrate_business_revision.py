import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "migrate_business_revision.py"
SPEC = importlib.util.spec_from_file_location("migrate_business_revision", SCRIPT)
migrator = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(migrator)
GUARD_SCRIPT = SKILL_DIR / "scripts" / "business_knowledge_guard.py"
GUARD_SPEC = importlib.util.spec_from_file_location("migration_guard", GUARD_SCRIPT)
guard = importlib.util.module_from_spec(GUARD_SPEC)
assert GUARD_SPEC.loader
GUARD_SPEC.loader.exec_module(guard)


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.v1_revision = self.root / "v1"
        shutil.copytree(SKILL_DIR / "tests" / "fixtures" / "sample-revision", self.v1_revision)
        self.target_run = self.root / "target"

    def tearDown(self):
        self.temp.cleanup()

    def read_jsonl(self, path):
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]

    def test_migration_preserves_v1_ids_and_marks_legacy_inventory(self):
        migrated = migrator.migrate_v1_to_v2(self.v1_revision, self.target_run)

        before = self.read_jsonl(self.v1_revision / "inventory.jsonl")
        after = self.read_jsonl(migrated / "inventory.jsonl")

        self.assertEqual([item["id"] for item in before], [item["id"] for item in after])
        self.assertTrue(all(item["id_scheme"] == "legacy_v1" for item in after))
        self.assertTrue(all(item.get("migrated_from_revision") for item in after))

    def test_migration_is_partial_until_v2_discovery_runs(self):
        migrated = migrator.migrate_v1_to_v2(self.v1_revision, self.target_run)

        result = guard.validate_revision(migrated)

        self.assertEqual(result["coverage"]["current_coverage_status"], "partial")
        self.assertIn("v2 discovery required", result["coverage"]["migration_gaps"])

    def test_invalid_unversioned_revision_is_rejected(self):
        manifest = json.loads((self.v1_revision / "manifest.json").read_text(encoding="utf-8"))
        manifest["schema_version"] = None
        (self.v1_revision / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )
        (self.v1_revision / "inventory.jsonl").unlink()

        with self.assertRaisesRegex(migrator.MigrationError, "not a complete v1 revision"):
            migrator.detect_revision_schema(self.v1_revision)

    def test_migration_does_not_change_source_or_create_pointer(self):
        source_before = {
            path.relative_to(self.v1_revision).as_posix(): path.read_bytes()
            for path in self.v1_revision.rglob("*")
            if path.is_file()
        }

        migrator.migrate_v1_to_v2(self.v1_revision, self.target_run)

        source_after = {
            path.relative_to(self.v1_revision).as_posix(): path.read_bytes()
            for path in self.v1_revision.rglob("*")
            if path.is_file()
        }
        self.assertEqual(source_before, source_after)
        self.assertFalse((self.v1_revision / "current.json").exists())


if __name__ == "__main__":
    unittest.main()
