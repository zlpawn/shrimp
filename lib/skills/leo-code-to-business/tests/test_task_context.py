import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "task_context.py"
SPEC = importlib.util.spec_from_file_location("task_context", SCRIPT)
task_context = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(task_context)
RENDER_SCRIPT = SKILL_DIR / "scripts" / "render_business_site.py"
RENDER_SPEC = importlib.util.spec_from_file_location("task_context_renderer", RENDER_SCRIPT)
renderer = importlib.util.module_from_spec(RENDER_SPEC)
assert RENDER_SPEC.loader
RENDER_SPEC.loader.exec_module(renderer)


class TaskContextTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.revision_dir = Path(self.temp.name) / "revision"
        shutil.copytree(SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2", self.revision_dir)
        self.revision = renderer.load_canonical_revision(self.revision_dir)

    def tearDown(self):
        self.temp.cleanup()

    def test_work_order_question_retrieves_family_rule_entity_evidence_and_history(self):
        pack = task_context.build_task_context_pack(
            "修改整改工单创建规则",
            self.revision,
        )

        self.assertIn("UC-create-work-order", pack["primary_use_case_ids"])
        self.assertIn("BR-create-work-order-type", pack["rule_ids"])
        self.assertIn("ENT-work-order", pack["entity_ids"])
        self.assertIn("EVOL-work-order-type", pack["evolution_ids"])
        self.assertIn("EV-create-work-order-source", pack["evidence_ids"])

    def test_context_pack_exposes_unknowns_and_coverage_warnings(self):
        pack = task_context.build_task_context_pack(
            "修改创建规则",
            self.revision,
        )

        self.assertIn("UNK-work-order-permission", pack["unknown_ids"])
        self.assertTrue(pack["coverage_warnings"])

    def test_context_pack_keeps_the_existing_top_level_contract(self):
        pack = task_context.build_task_context_pack(
            "修改整改工单创建规则",
            self.revision,
        )

        self.assertEqual(
            set(pack),
            {
                "question",
                "node_ids",
                "node_count",
                "primary_use_case_ids",
                "related_use_case_ids",
                "rule_ids",
                "state_ids",
                "entity_ids",
                "evolution_ids",
                "evidence_ids",
                "unknown_ids",
                "coverage_warnings",
                "retrieval_reasons",
            },
        )

    def test_context_expansion_is_bounded_and_deterministic(self):
        first = task_context.expand_business_context(
            ["UC-create-work-order"], self.revision, max_nodes=2
        )
        second = task_context.expand_business_context(
            ["UC-create-work-order"], self.revision, max_nodes=2
        )

        self.assertEqual(first, second)
        self.assertLessEqual(first["node_count"], 2)
        self.assertIn("context_truncated", first["coverage_warnings"])

    def test_impact_is_evidence_qualified(self):
        impacts = task_context.analyze_business_impact(
            ["BR-create-work-order-type"], self.revision
        )

        self.assertTrue(impacts)
        self.assertEqual(impacts[0]["impact"], "confirmed")
        self.assertTrue(impacts[0]["evidence_ids"])

    def test_cli_writes_atomic_run_artifact_only(self):
        output = Path(self.temp.name) / "task-pack.json"

        exit_code = task_context.main(
            [
                "build",
                "--revision",
                str(self.revision_dir),
                "--question",
                "整改工单",
                "--output",
                str(output),
            ]
        )

        self.assertEqual(exit_code, 0)
        payload = json.loads(output.read_text(encoding="utf-8"))
        self.assertIn("UC-create-work-order", payload["primary_use_case_ids"])
        self.assertFalse(list(self.revision_dir.glob("*.partial")))


if __name__ == "__main__":
    unittest.main()
