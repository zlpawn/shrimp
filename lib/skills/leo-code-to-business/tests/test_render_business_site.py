import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "render_business_site.py"
SPEC = importlib.util.spec_from_file_location("render_business_site", SCRIPT)
renderer = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(renderer)


class RenderBusinessSiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.revision = Path(self.temp.name) / "revision"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision",
            self.revision,
        )

    def tearDown(self):
        self.temp.cleanup()

    def test_ai_and_html_share_canonical_hash(self):
        result = renderer.write_projections(self.revision)

        self.assertEqual(
            result["ai"]["canonical_sha256"],
            result["html"]["canonical_sha256"],
        )
        manifest = json.loads(
            (self.revision / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            manifest["canonical_revision_sha256"],
            result["ai"]["canonical_sha256"],
        )

    def test_html_is_file_protocol_safe(self):
        renderer.write_projections(self.revision)
        html = (self.revision / "site" / "index.html").read_text(encoding="utf-8")

        self.assertNotIn('type="module"', html)
        self.assertNotRegex(html, r"\bfetch\s*\(")
        self.assertNotIn("http://", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("serviceWorker", html)
        self.assertIn(
            '<script id="business-knowledge-data" type="application/json">',
            html,
        )
        self.assertIn("<noscript>", html)
        self.assertIn("#use-case-UC-create-work-order", html)

    def test_html_leads_with_business_content_and_exposes_traces(self):
        renderer.write_projections(self.revision)
        html = (self.revision / "site" / "index.html").read_text(encoding="utf-8")

        overview_section = html.index('<section class="overview" id="overview">')
        analysis_section = html.index('id="analysis_notes"')
        self.assertLess(overview_section, analysis_section)
        self.assertIn("业务场景", html)
        self.assertIn("查看场景详情", html)
        self.assertIn('href="#use-case-UC-create-work-order"', html)
        self.assertIn("业务流程", html)
        self.assertIn("异常与恢复", html)
        self.assertIn("待确认事项", html)
        self.assertIn("工地检查员", html)
        self.assertIn("将施工问题转为可跟踪的整改待办", html)
        self.assertIn("工单创建权限未知", html)
        self.assertIn("实现依据", html)
        self.assertNotIn("<details open>", html)

    def test_html_keeps_analysis_metadata_out_of_the_first_reading_layer(self):
        renderer.write_projections(self.revision)
        html = (self.revision / "site" / "index.html").read_text(encoding="utf-8")

        overview = html.split('<section class="overview" id="overview">', 1)[1].split(
            "</section>", 1
        )[0]
        self.assertNotIn("Canonical", overview)
        self.assertNotIn("Repository", overview)
        self.assertNotIn("Snapshot", overview)
        self.assertNotIn('<span class="meta">partial</span>', html)
        self.assertIn('id="analysis_notes"', html)
        analysis = html.split('id="analysis_notes"', 1)[1]
        self.assertIn("Canonical revision", analysis)
        self.assertIn("Repository", analysis)
        self.assertIn("Snapshot", analysis)

    def test_html_escapes_script_termination_in_embedded_data(self):
        aliases = json.loads(
            (self.revision / "aliases.json").read_text(encoding="utf-8")
        )
        aliases.append(
            {
                "alias": "</script><script>alert(1)</script>",
                "target_ids": ["UC-create-work-order"],
            }
        )
        (self.revision / "aliases.json").write_text(
            json.dumps(aliases, ensure_ascii=False),
            encoding="utf-8",
        )
        renderer.refresh_canonical_hashes(self.revision)
        renderer.write_projections(self.revision)
        html = (self.revision / "site" / "index.html").read_text(encoding="utf-8")
        embedded = html.split(
            '<script id="business-knowledge-data" type="application/json">',
            1,
        )[1].split("</script>", 1)[0]

        self.assertNotIn("</script>", embedded.lower())
        self.assertIn("UC-create-work-order", embedded)

    def test_ai_context_is_compact_orientation_not_full_dump(self):
        renderer.write_projections(self.revision)
        ai_context = (self.revision / "ai-context.md").read_text(encoding="utf-8")

        business_orientation = ai_context.index("## 项目业务定位")
        organized_scope = ai_context.index("## 当前已整理范围")
        scenarios = ai_context.index("## 已确认业务场景")
        development_policy = ai_context.index("## 新需求开发工作法")
        retrieval_guide = ai_context.index("## 检索与核验指南")
        revision_metadata = ai_context.index("## 修订信息")

        self.assertLess(business_orientation, organized_scope)
        self.assertLess(organized_scope, scenarios)
        self.assertLess(scenarios, development_policy)
        self.assertLess(development_policy, retrieval_guide)
        self.assertLess(retrieval_guide, revision_metadata)
        self.assertIn("先分析业务影响，再进入代码实现", ai_context)
        self.assertIn("不代表系统完整业务全貌", ai_context)
        self.assertIn("工单管理", ai_context)
        self.assertIn("UC-create-work-order", ai_context)
        self.assertIn("use-cases.jsonl", ai_context)
        self.assertLess(len(ai_context), 8000)
        self.assertNotIn('"main_flow":', ai_context)

    def test_projection_validation_passes_after_render(self):
        renderer.write_projections(self.revision)
        result = renderer.guard.validate_revision(self.revision)
        self.assertEqual(result["status"], "passed")

    def test_projection_file_tampering_is_rejected(self):
        renderer.write_projections(self.revision)
        with (self.revision / "ai-context.md").open("a", encoding="utf-8") as handle:
            handle.write("\ntampered\n")

        with self.assertRaisesRegex(renderer.guard.ValidationError, "file hash mismatch"):
            renderer.guard.validate_revision(self.revision)


if __name__ == "__main__":
    unittest.main()
