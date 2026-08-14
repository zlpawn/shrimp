import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "business_knowledge_guard.py"
SPEC = importlib.util.spec_from_file_location("business_knowledge_guard", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(guard)


class BusinessKnowledgeGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.revision = self.root / "revision"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision",
            self.revision,
        )

    def tearDown(self):
        self.temp.cleanup()

    def read_json(self, name):
        return json.loads((self.revision / name).read_text(encoding="utf-8"))

    def write_json(self, name, value):
        (self.revision / name).write_text(
            json.dumps(value, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def read_jsonl(self, name):
        return [
            json.loads(line)
            for line in (self.revision / name).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def write_jsonl(self, name, values):
        (self.revision / name).write_text(
            "".join(
                json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n"
                for value in values
            ),
            encoding="utf-8",
        )

    def test_valid_sample_revision_passes(self):
        result = guard.validate_revision(self.revision)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["errors"], [])
        self.assertEqual(result["coverage"]["entry_classification"], 1.0)

    def test_skill_requires_bidirectional_business_investigation(self):
        text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8").lower()
        for required in [
            "business knowledge",
            "forward trace",
            "backward trace",
            "use-case famil",
            "unknown",
            "current source",
            "codebase-memory-mcp",
        ]:
            self.assertIn(required, text)

    def test_optional_tool_reference_never_makes_mcp_required(self):
        text = (
            SKILL_DIR / "references" / "optional-code-tools.md"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("optional", text)
        self.assertIn("index_status", text)
        self.assertIn("index_repository", text)
        self.assertIn("working-tree", text)
        self.assertIn("source verification", text)
        self.assertIn("portable baseline", text)
        self.assertNotIn("cannot pass without codebase-memory-mcp", text)

    def test_references_define_all_investigation_kinds(self):
        text = (
            SKILL_DIR / "references" / "repository-investigation.md"
        ).read_text(encoding="utf-8")
        for investigation_kind in sorted(guard.REQUIRED_INVESTIGATIONS):
            self.assertIn(investigation_kind, text)

    def test_business_reference_bans_technical_substitution(self):
        text = (
            SKILL_DIR / "references" / "business-discovery.md"
        ).read_text(encoding="utf-8").lower()
        for phrase in [
            "method-name translation",
            "one-controller",
            "use-case family",
            "actor",
            "business outcome",
        ]:
            self.assertIn(phrase, text)

    def test_inventory_requires_exactly_one_classification(self):
        inventory = self.read_jsonl("inventory.jsonl")
        inventory[0]["classification"] = None
        self.write_jsonl("inventory.jsonl", inventory)

        with self.assertRaisesRegex(guard.ValidationError, "classification"):
            guard.validate_revision(self.revision)

    def test_relationship_to_missing_id_is_rejected(self):
        relationships = self.read_jsonl("relationships.jsonl")
        relationships[0]["to_id"] = "UC-MISSING"
        self.write_jsonl("relationships.jsonl", relationships)

        with self.assertRaisesRegex(guard.ValidationError, "missing target"):
            guard.validate_revision(self.revision)

    def test_duplicate_foreign_id_fields_are_rejected(self):
        use_cases = self.read_jsonl("use-cases.jsonl")
        use_cases[0]["actor_ids"] = ["ACT-inspector"]
        self.write_jsonl("use-cases.jsonl", use_cases)

        with self.assertRaisesRegex(guard.ValidationError, "actor_ids"):
            guard.validate_revision(self.revision)

    def test_confirmed_rule_requires_verified_current_source(self):
        relationships = self.read_jsonl("relationships.jsonl")
        relationships = [
            item
            for item in relationships
            if not (
                item["from_id"] == "BR-create-work-order-type"
                and item["type"] == "evidenced_by"
            )
        ]
        self.write_jsonl("relationships.jsonl", relationships)

        with self.assertRaisesRegex(guard.ValidationError, "confirmed rule.*evidence"):
            guard.validate_revision(self.revision)

    def test_unknown_requires_completed_search_envelope(self):
        unknowns = self.read_jsonl("unknowns.jsonl")
        unknowns[0]["searched_evidence"] = []
        unknowns[0]["search_status"] = "not_started"
        self.write_jsonl("unknowns.jsonl", unknowns)

        with self.assertRaisesRegex(guard.ValidationError, "unknown.*search"):
            guard.validate_revision(self.revision)

    def test_truncated_investigation_cannot_be_complete(self):
        investigations = self.read_jsonl("investigations.jsonl")
        investigations[0]["truncated"] = True
        investigations[0]["status"] = "completed"
        self.write_jsonl("investigations.jsonl", investigations)

        with self.assertRaisesRegex(guard.ValidationError, "truncated"):
            guard.validate_revision(self.revision)

    def test_confirmed_use_case_requires_all_investigation_kinds(self):
        investigations = self.read_jsonl("investigations.jsonl")
        investigations = [
            item
            for item in investigations
            if item["investigation_kind"] != "backward_trace"
        ]
        self.write_jsonl("investigations.jsonl", investigations)

        with self.assertRaisesRegex(guard.ValidationError, "backward_trace"):
            guard.validate_revision(self.revision)

    def test_projection_hash_mismatch_is_rejected(self):
        manifest = self.read_json("manifest.json")
        manifest["projection_hashes"] = {
            "ai": {"canonical_sha256": "different"},
            "html": {"canonical_sha256": "different"},
        }
        self.write_json("manifest.json", manifest)

        with self.assertRaisesRegex(guard.ValidationError, "projection"):
            guard.validate_revision(self.revision)

    def test_review_hash_mismatch_is_rejected(self):
        review = self.read_json("semantic-review.json")
        review["canonical_revision_sha256"] = "old"
        self.write_json("semantic-review.json", review)

        with self.assertRaisesRegex(guard.ValidationError, "semantic review"):
            guard.validate_revision(self.revision)

    def test_failed_publication_keeps_current_pointer(self):
        workspace = self.root / "workspace"
        run = workspace / "runs" / "RUN-bad" / "staging-artifacts"
        shutil.copytree(self.revision, run)
        current = workspace / "current.json"
        current.parent.mkdir(parents=True, exist_ok=True)
        current.write_text('{"revision_id":"REV-old"}\n', encoding="utf-8")
        relationships = [
            item
            for item in self.read_jsonl_from(run / "relationships.jsonl")
            if item["type"] != "evidenced_by"
        ]
        self.write_jsonl_to(run / "relationships.jsonl", relationships)

        with self.assertRaises(guard.ValidationError):
            guard.publish_revision(run, workspace)

        self.assertEqual(
            json.loads(current.read_text(encoding="utf-8"))["revision_id"],
            "REV-old",
        )

    @staticmethod
    def read_jsonl_from(path):
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    @staticmethod
    def write_jsonl_to(path, values):
        path.write_text(
            "".join(json.dumps(value, sort_keys=True) + "\n" for value in values),
            encoding="utf-8",
        )


if __name__ == "__main__":
    unittest.main()
