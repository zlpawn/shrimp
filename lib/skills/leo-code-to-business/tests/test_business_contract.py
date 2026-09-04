import importlib.util
import json
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "business_contract.py"
SCHEMA_DIR = SKILL_DIR / "schemas"
V2_FIXTURE = SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2"
V3_FIXTURE = SKILL_DIR / "tests" / "fixtures" / "sample-revision-v3"
V31_FIXTURE = SKILL_DIR / "tests" / "fixtures" / "sample-revision-v31"
V32_FIXTURE = SKILL_DIR / "tests" / "fixtures" / "sample-revision-v32"
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
                "navigation",
                "views",
            ],
        }
        for name, fields in required.items():
            schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
            for field in fields:
                self.assertIn(field, schema["properties"], f"{name}: {field}")

    def test_manifest_schema_preserves_v1_and_v2_without_mixing_required_fields(self):
        schema = json.loads(
            (SCHEMA_DIR / "manifest.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            schema["oneOf"][:2],
            [{"$ref": "#/$defs/v1"}, {"$ref": "#/$defs/v2"}],
        )
        self.assertNotIn("current_coverage_status", schema["$defs"]["v1"]["required"])
        self.assertTrue({
            "current_coverage_status",
            "history_coverage_status",
            "aggregate_status",
        }.issubset(schema["$defs"]["v2"]["required"]))

    def test_v3_contract_requires_deep_business_archaeology_artifacts(self):
        self.assertEqual(contract.V3_SCHEMA_VERSION, "3.0")
        self.assertTrue(
            {
                "module-dossiers.jsonl",
                "end-to-end-flows.jsonl",
                "calculation-models.jsonl",
                "code-knowledge-matrix.jsonl",
            }.issubset(contract.V3_CANONICAL_FILE_KINDS)
        )

        use_case_schema = json.loads(
            (SCHEMA_DIR / "use-case.schema.json").read_text(encoding="utf-8")
        )
        narrative = use_case_schema["properties"]["scenario_narrative"]
        self.assertIn("stages", narrative["required"])
        self.assertIn("branch_matrix", narrative["required"])
        self.assertIn("failure_recovery_matrix", narrative["required"])
        self.assertIn("worked_examples", narrative["required"])

        site_schema = json.loads(
            (SCHEMA_DIR / "site-view-model.schema.json").read_text(encoding="utf-8")
        )
        views = site_schema["properties"]["views"]
        self.assertIn("scenario_reading_pages", views["properties"])
        self.assertIn("knowledge_topics", views["properties"])

    def test_manifest_schema_routes_v31_without_breaking_older_versions(self):
        schema = json.loads(
            (SCHEMA_DIR / "manifest.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            schema["oneOf"],
            [
                {"$ref": "#/$defs/v1"},
                {"$ref": "#/$defs/v2"},
                {"$ref": "#/$defs/v3"},
                {"$ref": "#/$defs/v31"},
                {"$ref": "#/$defs/v32"},
            ],
        )
        self.assertEqual(schema["$defs"]["v3"]["properties"]["schema_version"], {"const": "3.0"})
        self.assertEqual(schema["$defs"]["v31"]["properties"]["schema_version"], {"const": "3.1"})
        self.assertEqual(schema["properties"]["schema_version"]["enum"], ["1.0", "2.0", "3.0", "3.1", "3.2"])

    def test_v31_contract_adds_extensible_engineering_views(self):
        self.assertEqual(contract.V31_SCHEMA_VERSION, "3.1")
        self.assertEqual(
            set(contract.V31_CANONICAL_FILE_KINDS) - set(contract.V3_CANONICAL_FILE_KINDS),
            {"engineering-views.jsonl"},
        )
        schema = json.loads(
            (SCHEMA_DIR / "engineering-view.schema.json").read_text(encoding="utf-8")
        )
        unit_kind = schema["properties"]["step_mappings"]["items"]["properties"][
            "implementation_units"
        ]["items"]["properties"]["kind"]
        topic_kind = schema["properties"]["engineering_topics"]["items"]["properties"]["kind"]
        self.assertEqual(unit_kind["type"], "string")
        self.assertNotIn("enum", unit_kind)
        self.assertEqual(topic_kind["type"], "string")
        self.assertNotIn("enum", topic_kind)

    def test_v32_contract_adds_repository_progress_without_breaking_v31(self):
        self.assertEqual(contract.V32_SCHEMA_VERSION, "3.2")
        self.assertEqual(
            set(contract.V32_CANONICAL_FILE_KINDS)
            - set(contract.V31_CANONICAL_FILE_KINDS),
            {"project-progress.json"},
        )
        schema = json.loads(
            (SCHEMA_DIR / "manifest.schema.json").read_text(encoding="utf-8")
        )
        self.assertEqual(schema["oneOf"][-1], {"$ref": "#/$defs/v32"})
        self.assertIn(
            "project_completion_status", schema["$defs"]["v32"]["required"]
        )
        self.assertEqual(
            schema["properties"]["schema_version"]["enum"],
            ["1.0", "2.0", "3.0", "3.1", "3.2"],
        )

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

    def test_v3_sample_revision_contains_every_contract_artifact(self):
        expected = set(contract.V3_CANONICAL_FILE_KINDS) | {
            "manifest.json",
            "coverage.json",
            "omission-audit.json",
            "semantic-review.json",
            "ai-context.md",
            "site-view-model.json",
            "site/index.html",
        }
        missing = sorted(name for name in expected if not (V3_FIXTURE / name).exists())
        self.assertEqual(missing, [])

        manifest = json.loads((V3_FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], "3.0")

    def test_v31_sample_revision_contains_engineering_artifact(self):
        expected = set(contract.V31_CANONICAL_FILE_KINDS) | {
            "manifest.json",
            "coverage.json",
            "omission-audit.json",
            "semantic-review.json",
            "ai-context.md",
            "site-view-model.json",
            "site/index.html",
        }
        missing = sorted(name for name in expected if not (V31_FIXTURE / name).exists())
        self.assertEqual(missing, [])
        manifest = json.loads((V31_FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], "3.1")

    def test_v32_sample_revision_contains_project_progress(self):
        expected = set(contract.V32_CANONICAL_FILE_KINDS) | {
            "manifest.json",
            "coverage.json",
            "omission-audit.json",
            "semantic-review.json",
            "ai-context.md",
            "site-view-model.json",
            "site/index.html",
        }
        missing = sorted(name for name in expected if not (V32_FIXTURE / name).exists())
        self.assertEqual(missing, [])
        manifest = json.loads((V32_FIXTURE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["schema_version"], "3.2")
        self.assertEqual(manifest["project_completion_status"], "complete")


if __name__ == "__main__":
    unittest.main()
