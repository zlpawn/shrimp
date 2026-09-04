import importlib.util
import json
import random
import shutil
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "site_view_model.py"
SPEC = importlib.util.spec_from_file_location("site_view_model", SCRIPT)
view_model = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(view_model)
RENDER_SCRIPT = SKILL_DIR / "scripts" / "render_business_site.py"
RENDER_SPEC = importlib.util.spec_from_file_location(
    "site_view_model_renderer", RENDER_SCRIPT
)
renderer = importlib.util.module_from_spec(RENDER_SPEC)
assert RENDER_SPEC.loader
RENDER_SPEC.loader.exec_module(renderer)


class SiteViewModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.revision_dir = Path(self.temp.name) / "revision"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2",
            self.revision_dir,
        )
        self.revision = renderer.load_canonical_revision(self.revision_dir)

    def tearDown(self):
        self.temp.cleanup()

    def test_view_model_always_contains_fixed_views(self):
        model = view_model.build_site_view_model(self.revision)

        self.assertEqual(model["view_schema_version"], "2.0")
        self.assertEqual(list(model["views"]), list(view_model.FIXED_VIEW_IDS))

    def test_use_case_details_use_exact_section_order(self):
        model = view_model.build_site_view_model(self.revision)

        self.assertEqual(
            [item["id"] for item in model["views"]["use_case_details"][0]["sections"]],
            list(view_model.USE_CASE_SECTION_IDS),
        )

    def test_shuffled_canonical_records_produce_identical_view_model_and_html(self):
        first = view_model.build_site_view_model(self.revision)
        self.shuffle_every_collection(self.revision_dir, seed=42)
        shuffled_revision = renderer.load_canonical_revision(self.revision_dir)
        second = view_model.build_site_view_model(shuffled_revision)

        self.assertEqual(
            json.dumps(first, ensure_ascii=False, sort_keys=True),
            json.dumps(second, ensure_ascii=False, sort_keys=True),
        )
        self.assertEqual(
            renderer.render_html_site(first),
            renderer.render_html_site(second),
        )

    def test_empty_states_and_navigation_remain_distinct_and_fixed(self):
        model = view_model.build_site_view_model(self.revision)
        rendered = renderer.render_html_site(model)

        for state in [
            "confirmed_empty",
            "searched_not_found",
            "not_investigated",
            "not_applicable",
        ]:
            self.assertIn(f'data-empty-state="{state}"', rendered)
        self.assertEqual(
            model["navigation"],
            [
                {"id": key, "label": label}
                for key, label in view_model.FIXED_NAVIGATION_LABELS.items()
            ],
        )
        for label in ["业务全景", "业务场景", "关键规则", "待确认事项", "分析说明"]:
            self.assertIn(label, rendered)
        self.assertIn("<noscript>", rendered)
        self.assertIn("UC-create-work-order", rendered)

    def test_v3_html_uses_three_business_reading_tasks(self):
        v3_dir = Path(self.temp.name) / "revision-v3"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v3",
            v3_dir,
        )
        renderer.write_projections(v3_dir)
        revision = renderer.load_canonical_revision(v3_dir)
        model = view_model.build_site_view_model(revision)
        rendered = renderer.render_html_site(model)

        self.assertEqual(
            [item["id"] for item in model["navigation"]],
            [
                "business_map",
                "core_scenarios",
                "knowledge_topics",
            ],
        )
        labels = ["业务地图", "核心业务场景", "专题查询"]
        positions = [rendered.index(label) for label in labels]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("scenario_reading_pages", model["views"])
        page = model["views"]["scenario_reading_pages"][0]
        self.assertEqual(
            [section["id"] for section in page["sections"]],
            [
                "context_and_start",
                "staged_flow",
                "branches",
                "state_data_effects",
                "failure_and_recovery",
                "variants",
                "worked_examples",
                "evolution",
                "open_questions",
                "implementation_evidence",
            ],
        )
        self.assertIn("FLOW-create-work-order", rendered)
        self.assertIn("MOD-work-order", rendered)
        self.assertNotIn("engineering_views", model["views"])
        self.assertNotIn("研发实现导航", rendered)

    def test_v31_aligns_engineering_detail_to_business_steps(self):
        v31_dir = Path(self.temp.name) / "revision-v31"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v31",
            v31_dir,
        )
        renderer.write_projections(v31_dir)
        revision = renderer.load_canonical_revision(v31_dir)
        model = view_model.build_site_view_model(revision)
        rendered = renderer.render_html_site(model)

        self.assertEqual(
            [item["label"] for item in model["navigation"]],
            ["业务地图", "核心业务场景", "专题查询"],
        )
        page = model["views"]["scenario_reading_pages"][0]
        self.assertEqual(
            [section["id"] for section in page["sections"]],
            list(view_model.SCENARIO_READING_SECTION_IDS),
        )
        staged_flow = next(
            section["items"]
            for section in page["sections"]
            if section["id"] == "staged_flow"
        )
        mappings = {
            step["step_id"]: step["engineering_mapping"]
            for stage in staged_flow
            for step in stage["steps"]
        }
        self.assertEqual(set(mappings), {"submit", "enrich", "call-external"})
        self.assertEqual(
            mappings["enrich"]["implementation_units"][0]["locator"],
            "WorkOrderService.create",
        )
        self.assertIn("研发实现导航", rendered)
        self.assertIn("改动影响与验证", rendered)
        self.assertIn("WorkOrderService.create", rendered)

        persisted = json.loads((v31_dir / "site-view-model.json").read_text(encoding="utf-8"))
        persisted_page = persisted["views"]["scenario_reading_pages"][0]
        self.assertEqual(
            [section["id"] for section in persisted_page["sections"]],
            list(view_model.SCENARIO_READING_SECTION_IDS),
        )

    def test_v32_exposes_project_progress_without_changing_primary_navigation(self):
        v32_dir = Path(self.temp.name) / "revision-v32"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v32",
            v32_dir,
        )
        renderer.write_projections(v32_dir)
        model = view_model.build_site_view_model(
            renderer.load_canonical_revision(v32_dir)
        )
        self.assertEqual(
            [item["label"] for item in model["navigation"]],
            ["业务地图", "核心业务场景", "专题查询"],
        )
        self.assertEqual(
            model["views"]["project_progress"]["project_completion_status"],
            "complete",
        )

    @staticmethod
    def shuffle_every_collection(root: Path, seed: int) -> None:
        random.seed(seed)
        for path in root.glob("*.json"):
            value = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(value, list):
                random.shuffle(value)
            elif isinstance(value, dict):
                for nested in value.values():
                    if isinstance(nested, list):
                        random.shuffle(nested)
            path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
        for path in root.glob("*.jsonl"):
            records = [
                json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line
            ]
            random.shuffle(records)
            path.write_text(
                "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in records),
                encoding="utf-8",
            )


if __name__ == "__main__":
    unittest.main()
