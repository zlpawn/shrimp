import importlib.util
import json
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "business_contract.py"
SCHEMA_DIR = SKILL_DIR / "schemas"
V2_FIXTURE = SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2"
SPEC = importlib.util.spec_from_file_location("business_contract", SCRIPT)
contract = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(contract)


class BusinessContractTests(unittest.TestCase):
    def test_candidate_id_depends_only_on_repository_and_seed_signal(self):
        self.assertEqual(
            contract.candidate_id("REPO-abc", "SIG-seed"),
            "UCC-" + "1e7f9f595d97a65d5bfc",
        )

    def test_repository_lineage_ignores_root_order(self):
        roots = ["b" * 40, "a" * 40]
        self.assertEqual(
            contract.repository_lineage_id(roots),
            contract.repository_lineage_id(list(reversed(roots))),
        )

    def test_canonical_json_normalizes_unicode_keys_and_record_order(self):
        left = [{"id": "B", "title": "e\u0301"}, {"id": "A", "title": "x"}]
        right = [{"title": "x", "id": "A"}, {"title": "é", "id": "B"}]
        expected = b'[{"id":"A","title":"x"},{"id":"B","title":"\xc3\xa9"}]'
        self.assertEqual(
            contract.canonical_json_bytes(left, sort_records=True),
            expected,
        )
        self.assertEqual(
            contract.canonical_json_bytes(right, sort_records=True),
            expected,
        )

    def test_aggregate_status_uses_blocked_then_partial_precedence(self):
        self.assertEqual(contract.aggregate_status("passed", "not_requested"), "passed")
        self.assertEqual(contract.aggregate_status("passed", "partial"), "partial")
        self.assertEqual(contract.aggregate_status("partial", "passed"), "partial")
        self.assertEqual(contract.aggregate_status("passed", "blocked"), "blocked")

    def test_v2_schema_files_expose_required_contract_fields(self):
        required = {
            "discovery-observation.schema.json": [
                "discovered_signal_ids",
                "rejected_findings",
            ],
            "use-case-candidate.schema.json": [
                "seed_signal_id",
                "candidate_status",
            ],
            "historical-claim.schema.json": ["verification_status"],
            "site-view-model.schema.json": [
                "view_schema_version",
                "use_case_details",
            ],
        }
        for name, fields in required.items():
            schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
            for field in fields:
                self.assertIn(field, schema["properties"], f"{name}: {field}")

    def test_manifest_schema_routes_v1_and_v2_without_mixing_required_fields(self):
        schema = json.loads(
            (SCHEMA_DIR / "manifest.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(schema["oneOf"], [
            {"$ref": "#/$defs/v1"},
            {"$ref": "#/$defs/v2"},
        ])
        self.assertNotIn("current_coverage_status", schema["$defs"]["v1"]["required"])
        self.assertTrue({
            "current_coverage_status",
            "history_coverage_status",
            "aggregate_status",
        }.issubset(schema["$defs"]["v2"]["required"]))

    def test_v2_sample_revision_contains_every_contract_artifact(self):
        expected = set(contract.V2_CANONICAL_FILE_KINDS) | {
            "manifest.json",
            "coverage.json",
            "omission-audit.json",
            "semantic-review.json",
            "ai-context.md",
            "site-view-model.json",
            "site/index.html",
        }
        missing = sorted(name for name in expected if not (V2_FIXTURE / name).exists())
        self.assertEqual(missing, [])

        manifest = json.loads((V2_FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], "2.0")
        self.assertEqual(manifest["current_coverage_status"], "passed")
        self.assertEqual(manifest["history_coverage_status"], "passed")
        self.assertEqual(manifest["aggregate_status"], "passed")


if __name__ == "__main__":
    unittest.main()
