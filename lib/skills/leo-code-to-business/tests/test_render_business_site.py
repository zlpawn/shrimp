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

        business_heading = html.index("业务目标")
        trace_heading = html.index("技术证据")
        self.assertLess(business_heading, trace_heading)
        self.assertIn("工地检查员", html)
        self.assertIn("将施工问题转为可跟踪的整改待办", html)
        self.assertIn("工单创建权限未知", html)
        self.assertIn("<details", html)

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

        self.assertIn("Canonical revision", ai_context)
        self.assertIn("工单管理", ai_context)
        self.assertIn("use-cases.jsonl", ai_context)
        self.assertIn("Unknowns", ai_context)
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
