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

    def test_v2_render_uses_v2_canonical_hash_contract(self):
        revision = Path(self.temp.name) / "revision-v2"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2",
            revision,
        )

        renderer.refresh_canonical_hashes(revision)

        manifest = json.loads(
            (revision / "manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(
            manifest["canonical_revision_sha256"],
            renderer.guard.canonical_revision_sha256_v2(revision),
        )

    def test_v3_renders_scenario_as_one_complete_reading_page(self):
        revision = Path(self.temp.name) / "revision-v3"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v3",
            revision,
        )

        renderer.write_projections(revision)
        html = (revision / "site" / "index.html").read_text(encoding="utf-8")

        self.assertIn('id="business_map"', html)
        self.assertIn('id="core_scenarios"', html)
        self.assertIn('id="knowledge_topics"', html)
        self.assertIn("分阶段完整流程", html)
        self.assertIn("分支与判断", html)
        self.assertIn("状态、数据与外部影响", html)
        self.assertIn("失败、恢复与降级", html)
        self.assertIn("业务实例", html)
        self.assertIn("实现证据", html)
        self.assertIn("已达到场景可读标准", html)
        self.assertIn("已发现、已分类、已保留或已建立代码映射", html)
        self.assertIn("不等于业务已经被完整理解", html)
        self.assertIn('href="#scenario-UC-create-work-order"', html)
        self.assertNotIn('href="#module_dossiers">模块档案</a>', html)

    def test_v32_projects_whole_project_progress_for_people_and_ai(self):
        revision = Path(self.temp.name) / "revision-v32"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v32",
            revision,
        )
        progress = json.loads((revision / "project-progress.json").read_text())
        progress["project_completion_status"] = "in_progress"
        progress["active_module_id"] = "MODQ-consumer-acceptance"
        progress["next_module_ids"] = ["MODQ-consumer-acceptance"]
        progress["modules"].append({
            "id": "MODQ-consumer-acceptance",
            "title": "消费者新版验收体验",
            "priority": "high",
            "status": "pending",
            "signal_ids": [],
            "candidate_ids": [],
            "module_dossier_id": None,
            "flow_ids": [],
            "use_case_ids": [],
            "engineering_view_ids": [],
            "history_status": "pending",
            "gap_ids": [],
            "next_action": "完成灰度、列表、详情、归档恢复、反馈和推送的端到端追踪。",
        })
        (revision / "project-progress.json").write_text(
            json.dumps(progress, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        manifest = json.loads((revision / "manifest.json").read_text())
        manifest.update({
            "project_completion_status": "in_progress",
            "current_coverage_status": "partial",
            "aggregate_status": "partial",
            "coverage_status": "partial",
        })
        (revision / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False) + "\n", encoding="utf-8"
        )

        renderer.write_projections(revision)
        html = (revision / "site" / "index.html").read_text(encoding="utf-8")
        ai = (revision / "ai-context.md").read_text(encoding="utf-8")
        for text in ["全仓业务沉淀进度", "消费者新版验收体验", "全项目尚未完成"]:
            self.assertIn(text, html)
        for text in ["Whole-project status：`in_progress`", "消费者新版验收体验", "不能把本修订描述为全仓业务知识库已完成"]:
            self.assertIn(text, ai)

    def test_v3_ai_context_leads_with_deep_scenario_behavior(self):
        revision = Path(self.temp.name) / "revision-v3-ai"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v3",
            revision,
        )

        renderer.write_projections(revision)
        ai_context = (revision / "ai-context.md").read_text(encoding="utf-8")

        self.assertIn("已达到场景可读标准", ai_context)
        self.assertIn("当前行为：分阶段执行", ai_context)
        self.assertIn("整改工单服务：读取项目检查员并补齐", ai_context)
        self.assertIn("#### 分支与判断", ai_context)
        self.assertIn("#### 状态、数据与外部影响", ai_context)
        self.assertIn("#### 失败、恢复与降级", ai_context)
        self.assertIn("#### 业务实例", ai_context)
        self.assertIn("上一版本", ai_context)
        self.assertIn("原因状态：unknown", ai_context)
        self.assertIn("scenario_narrative", ai_context)
        self.assertIn("Scenario readiness：`1/1`", ai_context)

    def test_projection_file_tampering_is_rejected(self):
        renderer.write_projections(self.revision)
        with (self.revision / "ai-context.md").open("a", encoding="utf-8") as handle:
            handle.write("\ntampered\n")

        with self.assertRaisesRegex(renderer.guard.ValidationError, "file hash mismatch"):
            renderer.guard.validate_revision(self.revision)


if __name__ == "__main__":
    unittest.main()
