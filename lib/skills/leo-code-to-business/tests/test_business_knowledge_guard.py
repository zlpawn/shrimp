import importlib.util
import json
import shutil
import subprocess
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "business_knowledge_guard.py"
SPEC = importlib.util.spec_from_file_location("business_knowledge_guard", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(guard)
RENDER_SCRIPT = SKILL_DIR / "scripts" / "render_business_site.py"
RENDER_SPEC = importlib.util.spec_from_file_location(
    "render_business_site_for_guard_tests",
    RENDER_SCRIPT,
)
renderer = importlib.util.module_from_spec(RENDER_SPEC)
assert RENDER_SPEC.loader
RENDER_SPEC.loader.exec_module(renderer)


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
            ".leo_business",
            "output-workspace.md",
            "discover_repository_signals.py",
            "use-case-candidates.jsonl",
            "candidate conservation",
            "independent omission audit",
            "site-view-model.json",
            "historical-claims.jsonl",
            "commit message",
            "current_coverage_status",
            "history_coverage_status",
            "task context",
            "module-dossiers.jsonl",
            "end-to-end-flows.jsonl",
            "calculation-models.jsonl",
            "code-knowledge-matrix.jsonl",
            "module-archaeology.md",
            "end-to-end-flow-analysis.md",
            "calculation-and-scoring-analysis.md",
            "code-knowledge-traceability.md",
        ]:
            self.assertIn(required, text)

    def test_v3_references_define_deep_analysis_contracts(self):
        required_by_file = {
            "module-archaeology.md": [
                "one dossier per business module",
                "control flow",
                "failure",
                "repair",
                "module-dossiers.jsonl",
            ],
            "end-to-end-flow-analysis.md": [
                "trigger",
                "terminal outcome",
                "idempotency",
                "observability",
                "end-to-end-flows.jsonl",
            ],
            "calculation-and-scoring-analysis.md": [
                "missing value",
                "weights",
                "thresholds",
                "rounding",
                "recalculation",
                "calculation-models.jsonl",
            ],
            "code-knowledge-traceability.md": [
                "every important signal",
                "semantic comparison",
                "generic",
                "code-knowledge-matrix.jsonl",
            ],
        }
        for name, phrases in required_by_file.items():
            text = (SKILL_DIR / "references" / name).read_text(encoding="utf-8").lower()
            for phrase in phrases:
                self.assertIn(phrase, text, f"{name}: {phrase}")

    def test_v3_html_reference_fixes_business_knowledge_navigation(self):
        text = (SKILL_DIR / "references" / "html-projection.md").read_text(
            encoding="utf-8"
        )
        expected = [
            "业务地图",
            "核心业务场景",
            "专题查询",
        ]
        positions = [text.index(label) for label in expected]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("一个页面内连续讲清", text)
        self.assertIn("状态、数据与外部影响", text)
        self.assertIn("已发现", text)
        self.assertIn("不等于", text)

    def test_utopia_acceptance_defines_upload_concat_and_scoring_goldens(self):
        text = (SKILL_DIR / "references" / "acceptance-scenarios.md").read_text(
            encoding="utf-8"
        )
        for required in [
            "POST /3d/app/device/upload/video",
            "POST /linjing/video/concat/callback",
            "contactVideoByFolder",
            "retryContactVideoByFolder",
            "lowReplaceHigh",
            "triggerCalculateScore",
            "calculateAcceptanceScoreItem",
            "SpeechScoreCalculator",
            "ToolScoreCalculator",
            "CustomerScoreCalculator",
            "DurationScoreCalculator",
            "calDrainageScore",
            "recalculateTotalScore",
        ]:
            self.assertIn(required, text)

    def test_output_workspace_reference_defines_ai_and_human_paths(self):
        text = (
            SKILL_DIR / "references" / "output-workspace.md"
        ).read_text(encoding="utf-8").lower()
        for required in [
            "<repository-root>/.leo_business/",
            "current.json",
            "ai-context.md",
            "site/index.html",
            "reference or acceptance repository",
            "detached worktree",
            "read-only",
            "snapshot",
        ]:
            self.assertIn(required, text)

    def test_default_workspace_is_inside_primary_repository(self):
        repo = self.root / "repo"
        repo.mkdir()

        workspace = guard.resolve_workspace_root(repo)

        self.assertEqual(workspace, (repo / ".leo_business").resolve())

    def test_explicit_absolute_workspace_overrides_default(self):
        repo = self.root / "repo"
        repo.mkdir()
        external = self.root / "published-knowledge"

        workspace = guard.resolve_workspace_root(repo, external)

        self.assertEqual(workspace, external.resolve())

    def test_explicit_relative_workspace_is_rejected(self):
        repo = self.root / "repo"
        repo.mkdir()

        with self.assertRaisesRegex(
            guard.ValidationError,
            "absolute path",
        ):
            guard.resolve_workspace_root(repo, ".leo_business")

    def test_reference_repository_requires_external_workspace(self):
        repo = self.root / "reference-repo"
        repo.mkdir()

        with self.assertRaisesRegex(
            guard.ValidationError,
            "explicit external",
        ):
            guard.resolve_workspace_root(repo, repository_role="reference")
        with self.assertRaisesRegex(
            guard.ValidationError,
            "outside",
        ):
            guard.resolve_workspace_root(
                repo,
                repo / ".leo_business",
                repository_role="reference",
            )

        external = self.root / "reference-output"
        self.assertEqual(
            guard.resolve_workspace_root(
                repo,
                external,
                repository_role="reference",
            ),
            external.resolve(),
        )

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

    def test_business_flow_contract_is_explicit(self):
        skill = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
        discovery = (
            SKILL_DIR / "references" / "business-discovery.md"
        ).read_text(encoding="utf-8")
        model = (
            SKILL_DIR / "references" / "business-knowledge-model.md"
        ).read_text(encoding="utf-8")
        coverage = (
            SKILL_DIR / "references" / "coverage-and-completion.md"
        ).read_text(encoding="utf-8")
        evidence = (
            SKILL_DIR / "references" / "evidence-and-confidence.md"
        ).read_text(encoding="utf-8")

        self.assertIn("understandable without source-code knowledge", skill)
        self.assertIn("participant action or business event", discovery)
        self.assertIn("visible outcome or handoff", discovery)
        self.assertIn("implementation order", model)
        self.assertIn("business_flow_semantic_quality", coverage)
        self.assertIn(
            "must not substitute implementation order",
            evidence,
        )

    def test_flow_quality_rejects_technical_execution_chain(self):
        use_case = {
            "id": "UC-relate-video-site",
            "claim_status": "confirmed",
            "main_flow": [
                {
                    "local_id": "step-1",
                    "statement": "显式 tenant 覆盖上下文 tenant，否则继承上下文",
                },
                {
                    "local_id": "step-2",
                    "statement": "以 projectId+acceptanceNode 建立短时防重复键",
                },
                {
                    "local_id": "step-3",
                    "statement": "LINJING 设备进入 3D/头戴路径，其他设备进入普通/耳挂路径",
                },
                {
                    "local_id": "step-4",
                    "statement": "3D 路径将选择扩展为相同目录内全部视频",
                },
                {
                    "local_id": "step-5",
                    "statement": "写入工程、节点、地址、工长、检查员、操作人、关联状态和时间",
                },
                {
                    "local_id": "step-6",
                    "statement": "数据库更新后同步 Elasticsearch",
                },
            ],
        }

        diagnostics = guard.validate_business_flow_quality(use_case)
        by_address = {
            item["flow_step_address"]: item for item in diagnostics
        }

        self.assertEqual(len(diagnostics), 6)
        self.assertIn(
            "UC-relate-video-site#main_flow/step-1",
            by_address,
        )
        self.assertIn(
            "UC-relate-video-site#main_flow/step-2",
            by_address,
        )
        self.assertIn(
            "code_shaped_expression",
            by_address[
                "UC-relate-video-site#main_flow/step-2"
            ]["reason_codes"],
        )
        self.assertIn(
            "internal_constant_without_business_meaning",
            by_address[
                "UC-relate-video-site#main_flow/step-3"
            ]["reason_codes"],
        )
        self.assertIn(
            "field_write_inventory",
            by_address[
                "UC-relate-video-site#main_flow/step-5"
            ]["reason_codes"],
        )
        self.assertIn(
            "infrastructure_sequence",
            by_address[
                "UC-relate-video-site#main_flow/step-6"
            ]["reason_codes"],
        )
        self.assertTrue(
            all(item["severity"] == "high" for item in diagnostics)
        )

    def test_flow_quality_accepts_business_effects_with_technical_terms(self):
        use_case = {
            "id": "UC-relate-video-site",
            "claim_status": "confirmed",
            "main_flow": [
                {
                    "local_id": "step-1",
                    "statement": "视频操作人员选择现场视频和对应的工程验收节点。",
                },
                {
                    "local_id": "step-2",
                    "statement": "所选租户决定本次关联归属的组织。",
                },
                {
                    "local_id": "step-3",
                    "statement": "头戴设备会把同一次拍摄的相关视频作为一组关联。",
                },
                {
                    "local_id": "step-4",
                    "statement": "关联完成后，验收人员可以在视频搜索中找到这些资料。",
                },
                {
                    "local_id": "step-5",
                    "statement": "检查员提交 HOME2 整改工单，任务进入 TODO 待办流程。",
                },
            ],
        }

        self.assertEqual(
            guard.validate_business_flow_quality(use_case),
            [],
        )

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

    def test_changed_source_evidence_propagates_to_business_knowledge(self):
        change_set = {
            "modified": ["src/WorkOrderController.java"],
            "added": [],
            "deleted": [],
            "renamed": [],
            "forced_node_ids": ["CAP-shared-routing"],
        }
        evidence_index = {
            "src/WorkOrderController.java": ["EV-create-work-order-source"],
        }
        relationships = self.read_jsonl("relationships.jsonl")

        direct = guard.compute_direct_impacts(change_set, evidence_index)
        impacted = guard.propagate_impacts(direct, relationships)

        self.assertEqual(
            direct,
            {"EV-create-work-order-source", "CAP-shared-routing"},
        )
        self.assertTrue(
            {
                "EV-create-work-order-source",
                "UC-create-work-order",
                "UCF-work-order",
                "CAP-work-order",
            }.issubset(impacted)
        )

    def test_impact_propagation_terminates_on_cycles(self):
        relationships = [
            {"from_id": "A", "type": "contains", "to_id": "B"},
            {"from_id": "B", "type": "variant_of", "to_id": "C"},
            {"from_id": "C", "type": "uses_rule", "to_id": "A"},
        ]

        self.assertEqual(
            guard.propagate_impacts({"A"}, relationships),
            {"A", "B", "C"},
        )

    def test_impacted_confirmed_claims_are_marked_stale(self):
        revision = {
            "use_cases": self.read_jsonl("use-cases.jsonl"),
            "rules": self.read_jsonl("business-rules.jsonl"),
            "relationships": self.read_jsonl("relationships.jsonl"),
            "deleted_evidence_ids": {"EV-create-work-order-source"},
        }

        updated = guard.invalidate_stale_claims(
            revision,
            {"EV-create-work-order-source", "UC-create-work-order"},
        )
        use_case = updated["use_cases"][0]
        evidence_link = next(
            item
            for item in updated["relationships"]
            if item["id"] == "REL-use-case-evidence"
        )

        self.assertEqual(use_case["lifecycle_status"], "stale")
        self.assertEqual(use_case["confidence"], "E0")
        self.assertEqual(use_case["previous_claim_status"], "confirmed")
        self.assertEqual(evidence_link["lifecycle_status"], "invalidated")

    def test_query_gap_requires_targeted_reanalysis_for_missing_variants(self):
        revision = {
            "nodes": {
                "UC-bind-video": {
                    "id": "UC-bind-video",
                    "title": "绑定工地视频",
                    "summary": "将视频绑定到项目验收节点。",
                    "claim_status": "confirmed",
                    "lifecycle_status": "active",
                }
            },
            "aliases": [],
            "investigations": [],
        }

        gap = guard.build_query_gap(
            "工地和视频还有哪些绑定入口？",
            revision,
        )

        self.assertEqual(gap["status"], "reanalyze_before_answer")
        self.assertIn("variants", gap["missing_dimensions"])
        self.assertIn("backward_trace", gap["missing_dimensions"])
        self.assertEqual(
            gap["required_investigations"],
            [
                "alternate_entry_search",
                "backward_trace",
                "source_verification",
            ],
        )

    def test_missing_optional_provider_does_not_block(self):
        observation = {
            "provider": "codebase-memory-mcp",
            "available": False,
            "source_verification_required": True,
        }

        status = guard.provider_readiness([observation])

        self.assertTrue(status["portable_baseline_allowed"])
        self.assertEqual(status["blocking_errors"], [])
        self.assertEqual(status["usable_providers"], [])

    def test_stale_provider_requires_refresh_and_ready_provider_needs_source_check(self):
        stale = {
            "provider": "codebase-memory-mcp",
            "available": True,
            "canonical_root": "/repo",
            "status": "ready",
            "refresh_requested": False,
            "refresh_result": None,
            "source_verification_required": True,
        }
        ready = deepcopy(stale)
        ready.update(
            {
                "refresh_requested": True,
                "refresh_result": "ready",
            }
        )

        stale_status = guard.provider_readiness([stale], canonical_root="/repo")
        ready_status = guard.provider_readiness([ready], canonical_root="/repo")

        self.assertIn("codebase-memory-mcp", stale_status["refresh_required"])
        self.assertEqual(ready_status["usable_providers"], ["codebase-memory-mcp"])
        self.assertTrue(ready_status["source_verification_required"])

    def test_matching_head_does_not_hide_dirty_worktree_review_staleness(self):
        before = {
            "canonical_root": "/repo",
            "snapshot_sha256": "before",
            "git": {"head_sha": "same"},
        }
        after = {
            "canonical_root": "/repo",
            "snapshot_sha256": "after",
            "git": {"head_sha": "same"},
        }

        self.assertTrue(guard.review_is_stale(before, after))

    def test_benchmark_rejects_technical_chain_without_business_framing(self):
        bundle = {
            "nodes_by_file": {
                "use-cases.jsonl": [
                    {
                        "id": "UC-video",
                        "claim_status": "confirmed",
                        "lifecycle_status": "active",
                        "goal": {},
                        "success_outcomes": [],
                    }
                ]
            },
            "relationships": [],
        }

        with self.assertRaisesRegex(guard.ValidationError, "business goal"):
            guard._validate_business_framing(
                bundle,
                {"minimum_confirmed_use_cases": 1},
            )

    def test_benchmark_rejects_missing_use_case_family_member(self):
        nodes = [
            {
                "id": "UC-video",
                "title": "普通应用绑定",
                "summary": "通过应用把视频绑定到工地。",
                "claim_status": "confirmed",
                "lifecycle_status": "active",
            }
        ]

        with self.assertRaisesRegex(guard.ValidationError, "operational-relink"):
            guard._validate_family_members(
                nodes,
                [
                    {
                        "id": "normal",
                        "any_of": ["普通应用绑定"],
                    },
                    {
                        "id": "operational-relink",
                        "any_of": ["运维重新关联"],
                    },
                ],
            )

    def test_benchmark_rejects_invented_prohibited_claim(self):
        nodes_by_file = {
            "use-cases.jsonl": [
                {
                    "id": "UC-work-order",
                    "claim_status": "confirmed",
                    "lifecycle_status": "active",
                    "summary": "仅管理员可以创建工单。",
                }
            ],
            "unknowns.jsonl": [],
        }
        prohibited = {
            "work-order": [
                {
                    "id": "invented-authorization",
                    "any_of": ["仅管理员可以创建工单"],
                }
            ]
        }

        with self.assertRaisesRegex(
            guard.ValidationError,
            "invented-authorization",
        ):
            guard._validate_prohibited_claims(
                nodes_by_file,
                prohibited,
                "work-order",
            )

    def test_benchmark_rejects_low_or_zero_semantic_review(self):
        rubric = {
            "minimum_total_score": 13,
            "required_score_minimums": {
                "business_framing": 2,
                "evidence": 2,
            },
        }
        low_review = {
            "scores": {
                "business_framing": 0,
                "evidence": 2,
            },
            "total_score": 12,
        }

        with self.assertRaisesRegex(
            guard.ValidationError,
            "semantic review total below 13",
        ):
            guard.validate_benchmark_review(low_review, rubric)

        zero_dimension_review = {
            "scores": {
                "business_framing": 0,
                "evidence": 2,
            },
            "total_score": 13,
        }
        with self.assertRaisesRegex(
            guard.ValidationError,
            "business_framing below 2",
        ):
            guard.validate_benchmark_review(zero_dimension_review, rubric)

    def test_real_repository_expectations_preserve_core_business_gates(self):
        expected = SKILL_DIR / "tests" / "fixtures" / "expected"
        work_order = json.loads(
            (expected / "utopia-work-order.json").read_text(encoding="utf-8")
        )
        video = json.loads(
            (expected / "utopia-video-binding.json").read_text(encoding="utf-8")
        )
        concat = json.loads(
            (expected / "utopia-video-concat.json").read_text(encoding="utf-8")
        )
        scoring = json.loads(
            (expected / "utopia-linjing-scoring.json").read_text(encoding="utf-8")
        )
        rubric = json.loads(
            (expected / "semantic-rubric.json").read_text(encoding="utf-8")
        )

        self.assertEqual(len(work_order["required_unknowns"]), 5)
        self.assertEqual(len(video["required_family_members"]), 8)
        self.assertIn("required_business_flow_concepts", video)
        self.assertIn("technical_fact_placements", video)
        self.assertGreaterEqual(len(concat["required_evidence"]), 5)
        self.assertGreaterEqual(len(concat["required_business_flow_concepts"]), 8)
        self.assertGreaterEqual(len(scoring["required_evidence"]), 7)
        self.assertIn("required_calculation_concepts", scoring)
        self.assertEqual(rubric["reviewer_mode"], "independent")
        self.assertGreaterEqual(rubric["minimum_total_score"], 13)
        self.assertIn("non_technical_comprehensibility", rubric)

    def test_benchmark_cli_exposes_video_concat_and_linjing_scoring_scenarios(self):
        scenario_action = next(
            action
            for action in guard.build_parser()._subparsers._group_actions[0].choices[
                "benchmark"
            ]._actions
            if action.dest == "scenario"
        )

        self.assertIn("video-concat", scenario_action.choices)
        self.assertIn("linjing-scoring", scenario_action.choices)

    def test_benchmark_requires_calculation_concepts_from_calculation_models(self):
        expectation = {
            "required_calculation_concepts": [
                {
                    "id": "edited-tools-precedence",
                    "any_of": ["人工编辑工具优先于自动识别工具"],
                }
            ]
        }

        with self.assertRaisesRegex(
            guard.ValidationError,
            "calculation concepts.*edited-tools-precedence",
        ):
            guard._validate_calculation_concepts([], expectation)

        guard._validate_calculation_concepts(
            [
                {
                    "id": "CALC-tool-score",
                    "formula_or_algorithm": "人工编辑工具优先于自动识别工具。",
                }
            ],
            expectation,
        )

    def test_benchmark_requires_technical_facts_in_allowed_dimensions(self):
        nodes_by_file = {
            "use-cases.jsonl": [
                {
                    "id": "UC-video",
                    "decision_points": [
                        {"statement": "内部设备常量 LINJING 对应头戴拍摄模式。"}
                    ],
                    "external_effects": [
                        {"statement": "关联结果同步到 Elasticsearch 供检索。"}
                    ],
                    "main_flow": [
                        {"statement": "操作人员选择视频和验收节点。"}
                    ],
                }
            ],
            "business-rules.jsonl": [
                {
                    "id": "BR-video-dedup",
                    "statement": "projectId+acceptanceNode 构成短时防重复键。",
                }
            ],
        }
        requirements = [
            {
                "id": "device-constant",
                "any_of": ["LINJING"],
                "allowed_locations": ["decision_points", "evidence"],
            },
            {
                "id": "dedup-key",
                "any_of": ["projectId+acceptanceNode"],
                "allowed_locations": ["business_rules", "evidence"],
            },
            {
                "id": "index-sync",
                "any_of": ["Elasticsearch"],
                "allowed_locations": ["external_effects", "evidence"],
            },
        ]

        guard._validate_technical_fact_placements(
            nodes_by_file,
            [],
            requirements,
        )

        nodes_by_file["use-cases.jsonl"][0]["external_effects"] = []
        nodes_by_file["use-cases.jsonl"][0]["main_flow"].append(
            {"statement": "数据库更新后同步 Elasticsearch"}
        )
        with self.assertRaisesRegex(
            guard.ValidationError,
            "index-sync",
        ):
            guard._validate_technical_fact_placements(
                nodes_by_file,
                [],
                requirements,
            )

    def test_benchmark_rejects_keyword_complete_but_shallow_scenario(self):
        use_cases = [{
            "id": "UC-video-concat",
            "claim_status": "confirmed",
            "lifecycle_status": "active",
            "main_flow": [
                {"statement": "上传、分组、拼接、回调、失败重试和低清降级。"}
            ],
        }]

        with self.assertRaisesRegex(
            guard.ValidationError,
            "scenario depth.*UC-video-concat",
        ):
            guard._validate_benchmark_scenario_depth(
                use_cases,
                {
                    "minimum_stages": 4,
                    "minimum_atomic_steps": 8,
                    "require_branch_matrix": True,
                    "require_failure_recovery": True,
                    "require_worked_examples": True,
                },
            )

    def test_utopia_benchmarks_define_named_scenario_depth_gates(self):
        expected_dir = SKILL_DIR / "tests" / "fixtures" / "expected"
        required = {
            "work-order": {"UC-create-work-order": (2, 5)},
            "video-binding": {
                "UC-bind-site-video": (4, 9),
                "UC-bind-headmounted-video": (4, 9),
            },
            "video-concat": {
                "UC-upload-linjing-video": (3, 7),
                "UC-concat-linjing-video": (5, 12),
            },
            "linjing-scoring": {"UC-calculate-linjing-score": (4, 10)},
        }
        for scenario, expected_targets in required.items():
            expectation = json.loads(
                (expected_dir / f"utopia-{scenario}.json").read_text(encoding="utf-8")
            )
            targets = {
                item["id"]: item
                for item in expectation["scenario_depth_requirements"]["use_cases"]
            }
            self.assertEqual(set(targets), set(expected_targets))
            for use_case_id, (minimum_stages, minimum_steps) in expected_targets.items():
                self.assertEqual(targets[use_case_id]["minimum_stages"], minimum_stages)
                self.assertEqual(targets[use_case_id]["minimum_atomic_steps"], minimum_steps)
                self.assertTrue(targets[use_case_id]["require_branch_matrix"])
                self.assertTrue(targets[use_case_id]["require_failure_recovery"])
                self.assertTrue(targets[use_case_id]["require_worked_examples"])

    def test_benchmark_depth_can_target_named_use_cases(self):
        use_cases = [
            {
                "id": "UC-core",
                "claim_status": "confirmed",
                "scenario_narrative": {
                    "stages": [{"steps": [{}, {}]}, {"steps": [{}, {}]}],
                    "branch_matrix": [{}],
                    "failure_recovery_matrix": [{}],
                    "worked_examples": [{}],
                },
            },
            {
                "id": "UC-supporting",
                "claim_status": "confirmed",
            },
        ]

        guard._validate_benchmark_scenario_depth(
            use_cases,
            {
                "use_cases": [
                    {
                        "id": "UC-core",
                        "minimum_stages": 2,
                        "minimum_atomic_steps": 4,
                        "require_branch_matrix": True,
                        "require_failure_recovery": True,
                        "require_worked_examples": True,
                    }
                ]
            },
        )

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

    def test_successful_publication_points_ai_and_people_to_same_revision(self):
        workspace = self.root / "workspace"
        renderer.write_projections(self.revision)

        current = guard.publish_revision(self.revision, workspace)

        revision_id = current["revision_id"]
        self.assertEqual(
            current["ai_path"],
            f"revisions/{revision_id}/ai-context.md",
        )
        self.assertEqual(
            current["html_path"],
            f"revisions/{revision_id}/site/index.html",
        )
        self.assertTrue((workspace / current["ai_path"]).is_file())
        self.assertTrue((workspace / current["html_path"]).is_file())
        self.assertEqual(
            current["canonical_revision_sha256"],
            json.loads(
                (workspace / "current.json").read_text(encoding="utf-8")
            )["canonical_revision_sha256"],
        )

    def test_v3_publication_exposes_independent_coverage_statuses(self):
        revision = self.root / "revision-v3-publication"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v3",
            revision,
        )
        renderer.write_projections(revision)
        workspace = self.root / "workspace-v3"

        current = guard.publish_revision(revision, workspace)

        self.assertEqual(current["schema_version"], "3.0")
        self.assertEqual(current["current_coverage_status"], "passed")
        self.assertEqual(current["history_coverage_status"], "passed")
        self.assertEqual(current["aggregate_status"], "passed")
        self.assertEqual(current["coverage_status"], "passed")

    def test_publication_rejects_missing_ai_and_html_projections(self):
        workspace = self.root / "workspace"

        with self.assertRaisesRegex(
            guard.ValidationError,
            "generated projections",
        ):
            guard.publish_revision(self.revision, workspace)

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


class BusinessKnowledgeGuardV2Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.revision = self.root / "revision-v2"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2",
            self.revision,
        )

    def tearDown(self):
        self.temp.cleanup()

    def read_v2_json(self, name):
        return json.loads((self.revision / name).read_text(encoding="utf-8"))

    def write_v2_json(self, name, value):
        (self.revision / name).write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def read_v2_jsonl(self, name):
        return [
            json.loads(line)
            for line in (self.revision / name).read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]

    def write_v2_jsonl(self, name, values):
        (self.revision / name).write_text(
            "".join(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n" for value in values),
            encoding="utf-8",
        )

    def first_v2_candidate(self):
        return self.read_v2_jsonl("use-case-candidates.jsonl")[0]

    def first_v2_signal(self):
        return self.read_v2_jsonl("inventory.jsonl")[0]

    def first_v2_family(self):
        return self.read_v2_json("use-case-families.json")[0]

    def assert_guard_error(self, message):
        with self.assertRaisesRegex(guard.ValidationError, message):
            guard.validate_revision(self.revision)

    def refresh_v2_revision(self):
        renderer.write_projections(self.revision)

    def assert_guard_status(self, status, *, unresolved_id):
        manifest = self.read_v2_json("manifest.json")
        manifest["current_coverage_status"] = status
        manifest["aggregate_status"] = status
        self.write_v2_json("manifest.json", manifest)
        self.refresh_v2_revision()
        result = guard.validate_revision(self.revision)
        self.assertEqual(result["status"], status)
        self.assertIn(
            unresolved_id,
            result["coverage"]["metrics"]["candidate_conservation"]["unresolved_ids"],
        )

    def test_v2_rejects_signal_missing_from_candidate_or_non_candidate_disposition(self):
        inventory = self.read_v2_jsonl("inventory.jsonl")
        target = next(item for item in inventory if item["signal_class"] == "mutation_anchor")
        candidates = self.read_v2_jsonl("use-case-candidates.jsonl")
        for item in candidates:
            item["candidate_basis_signal_ids"] = [
                value for value in item["candidate_basis_signal_ids"] if value != target["id"]
            ]
        candidates = [
            item for item in candidates if item["seed_signal_id"] != target["id"]
        ]
        target.pop("non_candidate_status", None)
        self.write_v2_jsonl("inventory.jsonl", inventory)
        self.write_v2_jsonl("use-case-candidates.jsonl", candidates)

        self.assert_guard_error("unaccounted inventory signal " + target["id"])

    def test_v2_rejects_unresolved_high_candidate(self):
        candidate = self.first_v2_candidate()
        candidate["structural_importance"] = "high"
        candidate["candidate_status"] = "unresolved"
        candidates = self.read_v2_jsonl("use-case-candidates.jsonl")
        candidates[0] = candidate
        self.write_v2_jsonl("use-case-candidates.jsonl", candidates)

        self.assert_guard_status("partial", unresolved_id=candidate["id"])

    def test_v2_rejects_missing_family_closure_cell(self):
        family = self.first_v2_family()
        family["closure_matrix"]["cancel"]["operations"] = None
        self.write_v2_json("use-case-families.json", [family])

        self.assert_guard_error(
            "missing family closure disposition " + family["id"] + ":cancel:operations"
        )

    def test_v2_rejects_unresolved_high_omission_finding(self):
        audit = self.read_v2_json("omission-audit.json")
        audit["findings"].append(
            {
                "id": "OMIT-high",
                "severity": "high",
                "resolution_status": "unresolved",
                "signal_ids": [self.first_v2_signal()["id"]],
                "candidate_ids": [],
                "evidence_ids": [],
                "resolution": "reverse writer has no use case",
            }
        )
        self.write_v2_json("omission-audit.json", audit)

        self.assert_guard_status("partial", unresolved_id="OMIT-high")

    def test_flow_diagnostics_downgrade_current_coverage(self):
        use_cases = self.read_v2_jsonl("use-cases.jsonl")
        use_cases[0]["main_flow"] = [
            {
                "local_id": "step-1",
                "statement": "以 projectId+acceptanceNode 建立短时防重复键",
                "claim_status": "confirmed",
                "lifecycle_status": "active",
                "confidence": "E3",
            },
            {
                "local_id": "step-2",
                "statement": "数据库更新后同步 Elasticsearch",
                "claim_status": "confirmed",
                "lifecycle_status": "active",
                "confidence": "E3",
            },
        ]
        self.write_v2_jsonl("use-cases.jsonl", use_cases)
        manifest = self.read_v2_json("manifest.json")
        manifest["current_coverage_status"] = "partial"
        manifest["aggregate_status"] = "partial"
        manifest["coverage_status"] = "partial"
        self.write_v2_json("manifest.json", manifest)
        self.refresh_v2_revision()

        result = guard.validate_revision(self.revision)
        metric = result["coverage"]["metrics"][
            "business_flow_semantic_quality"
        ]

        self.assertEqual(result["status"], "partial")
        self.assertEqual(
            result["coverage"]["current_coverage_status"],
            "partial",
        )
        self.assertEqual(metric["numerator"], 0)
        self.assertEqual(metric["denominator"], 1)
        self.assertIn(
            "UC-create-work-order#main_flow/step-1",
            metric["unresolved_ids"],
        )
        self.assertEqual(len(result["business_flow_diagnostics"]), 2)

    def test_valid_v2_revision_has_complete_business_flow_metric(self):
        result = guard.validate_revision(self.revision)
        metric = result["coverage"]["metrics"][
            "business_flow_semantic_quality"
        ]

        self.assertEqual(result["status"], "passed")
        self.assertEqual(metric["numerator"], 1)
        self.assertEqual(metric["denominator"], 1)
        self.assertEqual(metric["unresolved_ids"], [])
        self.assertEqual(result["business_flow_diagnostics"], [])

    def test_v2_canonical_hash_ignores_coverage_review_and_projection_changes(self):
        before = guard.canonical_revision_sha256_v2(self.revision)
        self.write_v2_json("coverage.json", {"changed": True})
        self.write_v2_json("semantic-review.json", {"changed": True})
        (self.revision / "ai-context.md").write_text("changed", encoding="utf-8")
        (self.revision / "site-view-model.json").write_text("changed", encoding="utf-8")
        (self.revision / "site" / "index.html").write_text("changed", encoding="utf-8")

        after = guard.canonical_revision_sha256_v2(self.revision)

        self.assertEqual(before, after)

    def test_v2_canonical_hash_changes_for_semantic_history_fact(self):
        before = guard.canonical_revision_sha256_v2(self.revision)
        facts = self.read_v2_jsonl("git-change-facts.jsonl")
        facts[0]["after_summary"] = "different verified behavior"
        self.write_v2_jsonl("git-change-facts.jsonl", facts)

        self.assertNotEqual(before, guard.canonical_revision_sha256_v2(self.revision))

    def test_v2_rejects_manifest_hash_from_v1_contract(self):
        manifest = self.read_v2_json("manifest.json")
        manifest["canonical_revision_sha256"] = guard.canonical_revision_sha256(
            self.revision
        )
        self.write_v2_json("manifest.json", manifest)

        self.assert_guard_error(
            "manifest canonical revision hash does not match artifacts"
        )

    def test_partial_history_does_not_stale_current_claims(self):
        manifest = self.read_v2_json("manifest.json")
        manifest["history_coverage_status"] = "partial"
        manifest["aggregate_status"] = "partial"
        manifest["coverage_status"] = "partial"
        self.write_v2_json("manifest.json", manifest)
        coverage = self.read_v2_json("coverage.json")
        coverage["history_coverage_status"] = "partial"
        coverage["aggregate_status"] = "partial"
        self.write_v2_json("coverage.json", coverage)

        result = guard.validate_revision(self.revision)

        self.assertEqual(result["coverage"]["current_coverage_status"], "passed")
        self.assertEqual(result["coverage"]["history_coverage_status"], "partial")
        self.assertEqual(result["coverage"]["aggregate_status"], "partial")

    def test_v2_publication_pointer_preserves_three_statuses(self):
        workspace = self.root / "workspace"
        manifest = self.read_v2_json("manifest.json")
        manifest["canonical_revision_sha256"] = guard.canonical_revision_sha256_v2(self.revision)
        self.write_v2_json("manifest.json", manifest)

        current = guard.publish_revision(self.revision, workspace)

        self.assertEqual(current["schema_version"], "2.0")
        self.assertEqual(current["current_coverage_status"], "passed")
        self.assertEqual(current["history_coverage_status"], "passed")
        self.assertEqual(current["aggregate_status"], "passed")
        self.assertEqual(current["coverage_status"], "passed")


class BusinessKnowledgeGuardV3Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.revision = self.root / "revision-v3"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v3",
            self.revision,
        )

    def tearDown(self):
        self.temp.cleanup()

    def read_json(self, name):
        return json.loads((self.revision / name).read_text(encoding="utf-8"))

    def write_json(self, name, value):
        (self.revision / name).write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n",
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

    def refresh(self):
        renderer.write_projections(self.revision)

    def assert_guard_error(self, message):
        canonical_hash = guard.canonical_revision_sha256_v3(self.revision)
        manifest = self.read_json("manifest.json")
        manifest["canonical_revision_sha256"] = canonical_hash
        for projection in manifest.get("projection_hashes", {}).values():
            projection["canonical_sha256"] = canonical_hash
        self.write_json("manifest.json", manifest)
        review = self.read_json("semantic-review.json")
        review["canonical_revision_sha256"] = canonical_hash
        self.write_json("semantic-review.json", review)
        with self.assertRaisesRegex(guard.ValidationError, message):
            guard.validate_revision(self.revision)

    def test_valid_v3_revision_passes_deep_coverage_gates(self):
        self.refresh()
        result = guard.validate_revision(self.revision)

        self.assertEqual(result["status"], "passed")
        for name in [
            "module_dossier_coverage",
            "end_to_end_flow_coverage",
            "calculation_model_coverage",
            "code_knowledge_coverage",
        ]:
            self.assertEqual(result["coverage"]["metrics"][name]["ratio"], 1.0)

    def test_v3_core_scenario_requires_deep_narrative(self):
        use_cases = self.read_jsonl("use-cases.jsonl")
        use_cases[0].pop("scenario_narrative", None)
        self.write_jsonl("use-cases.jsonl", use_cases)
        manifest = self.read_json("manifest.json")
        manifest["current_coverage_status"] = "partial"
        manifest["aggregate_status"] = "partial"
        manifest["coverage_status"] = "partial"
        self.write_json("manifest.json", manifest)

        self.refresh()
        result = guard.validate_revision(self.revision)

        metric = result["coverage"]["metrics"]["scenario_readiness_coverage"]
        self.assertEqual(result["status"], "partial")
        self.assertEqual(metric["ratio"], 0.0)
        self.assertIn("UC-create-work-order#scenario_narrative", metric["unresolved_ids"])

    def test_v3_rejects_narrative_step_without_current_source_evidence(self):
        use_cases = self.read_jsonl("use-cases.jsonl")
        use_cases[0]["scenario_narrative"]["stages"][0]["steps"][0]["evidence_ids"] = []
        self.write_jsonl("use-cases.jsonl", use_cases)

        self.assert_guard_error("scenario step.*evidence_ids")

    def test_v3_rejects_narrative_without_branch_failure_and_example_closure(self):
        use_cases = self.read_jsonl("use-cases.jsonl")
        narrative = use_cases[0]["scenario_narrative"]
        narrative["branch_matrix"] = []
        narrative["failure_recovery_matrix"] = []
        narrative["worked_examples"] = []
        self.write_jsonl("use-cases.jsonl", use_cases)

        self.assert_guard_error("scenario narrative.*branch_matrix")

    def test_v3_rejects_missing_deep_artifact(self):
        (self.revision / "module-dossiers.jsonl").unlink()
        with self.assertRaisesRegex(guard.ValidationError, "module-dossiers.jsonl"):
            guard.validate_revision(self.revision)

    def test_v3_rejects_shallow_flow_stage(self):
        flows = self.read_jsonl("end-to-end-flows.jsonl")
        flows[0]["stages"][0]["processing"] = ""
        self.write_jsonl("end-to-end-flows.jsonl", flows)

        self.assert_guard_error("flow stage.*processing")

    def test_v3_rejects_important_signal_without_knowledge_mapping(self):
        matrix = self.read_jsonl("code-knowledge-matrix.jsonl")
        matrix = [item for item in matrix if item["signal_id"] != "SIG-f5f099dcb958935b14ee"]
        self.write_jsonl("code-knowledge-matrix.jsonl", matrix)

        self.assert_guard_error("code-knowledge matrix missing signal")

    def test_v3_requires_calculation_model_for_detected_scoring_signal(self):
        inventory = self.read_jsonl("inventory.jsonl")
        inventory[0]["kind"] = "score_calculation"
        inventory[0]["name"] = "calculate Linjing score"
        self.write_jsonl("inventory.jsonl", inventory)

        self.assert_guard_error("calculation model missing")

    def test_v3_rejects_incomplete_calculation_model(self):
        models = [{
            "id": "CALC-linjing-score",
            "title": "临境算分",
            "business_purpose": "生成临境质量分",
            "inputs": ["检查项"],
            "source_data": ["检查结果"],
            "applicability": ["临境验收"],
            "filters": [],
            "missing_value_policy": "缺失项不计分",
            "formula_or_algorithm": "加权求和",
            "weights": [],
            "thresholds": [],
            "rounding": "未记录",
            "caps_and_floors": "未记录",
            "version_source": "当前源码",
            "output": "质量分",
            "recalculation_triggers": [],
            "examples_or_tests": [],
            "evidence_ids": [],
            "history_event_ids": [],
            "unknown_ids": [],
            "snapshot_id": "SNAP-sample"
        }]
        del models[0]["formula_or_algorithm"]
        self.write_jsonl("calculation-models.jsonl", models)

        self.assert_guard_error("calculation model.*formula_or_algorithm")

    def test_v3_rejects_high_supporting_candidate_without_semantic_comparison(self):
        candidates = self.read_jsonl("use-case-candidates.jsonl")
        candidates[1]["structural_importance"] = "high"
        candidates[1].pop("semantic_comparison", None)
        self.write_jsonl("use-case-candidates.jsonl", candidates)

        self.assert_guard_error("semantic comparison")

    def test_v3_rejects_verified_evidence_with_empty_content_hash(self):
        evidence = self.read_jsonl("evidence.jsonl")
        evidence[0]["content_sha256"] = ""
        self.write_jsonl("evidence.jsonl", evidence)

        self.assert_guard_error("content_sha256")

    def test_v3_rejects_verified_current_source_missing_from_snapshot(self):
        manifest = self.read_json("manifest.json")
        manifest["repository_snapshot"]["files"].pop(
            "src/WorkOrderController.java"
        )
        self.write_json("manifest.json", manifest)

        self.assert_guard_error("not present in frozen snapshot")

    def test_v3_rejects_verified_current_source_hash_mismatch(self):
        manifest = self.read_json("manifest.json")
        manifest["repository_snapshot"]["files"][
            "src/WorkOrderController.java"
        ]["sha256"] = "0" * 64
        self.write_json("manifest.json", manifest)

        self.assert_guard_error("does not match frozen snapshot")

    def test_v3_code_matrix_rejects_unknown_foreign_ids(self):
        matrix = self.read_jsonl("code-knowledge-matrix.jsonl")
        matrix[0]["use_case_ids"] = ["UC-does-not-exist"]
        self.write_jsonl("code-knowledge-matrix.jsonl", matrix)

        self.assert_guard_error("names unknown use case")

    def test_v3_scoring_signal_requires_explicit_model_mapping(self):
        inventory = self.read_jsonl("inventory.jsonl")
        inventory[0]["kind"] = "score_calculation"
        inventory[0]["name"] = "calculate Linjing score"
        self.write_jsonl("inventory.jsonl", inventory)
        self.write_jsonl(
            "calculation-models.jsonl",
            [{
                "id": "CALC-linjing-score",
                "title": "临境算分",
                "business_purpose": "生成临境质量分",
                "inputs": ["检查项"],
                "source_data": ["检查结果"],
                "applicability": ["临境验收"],
                "filters": [],
                "missing_value_policy": "缺失项不计分",
                "formula_or_algorithm": "按当前策略配置加权汇总",
                "weights": ["来自当前策略配置"],
                "thresholds": [],
                "rounding": "当前源码未发现额外取整",
                "caps_and_floors": "当前源码未发现额外封顶或保底",
                "version_source": "当前源码和策略配置",
                "output": "临境质量分",
                "recalculation_triggers": ["验收结果更新"],
                "examples_or_tests": [],
                "evidence_ids": ["EV-create-work-order-source"],
                "history_event_ids": [],
                "unknown_ids": [],
                "snapshot_id": "SNAP-sample",
            }],
        )

        self.assert_guard_error("calculation signal lacks explicit model mapping")

    def test_v3_rejects_template_reason_reused_for_many_important_signals(self):
        inventory = self.read_jsonl("inventory.jsonl")
        inventory[1]["structural_importance"] = "high"
        self.write_jsonl("inventory.jsonl", inventory)
        matrix = self.read_jsonl("code-knowledge-matrix.jsonl")
        template = "当前源码确认该入口属于同一个通用业务流程，因此统一归并处理。"
        for row in matrix:
            row["resolution_reason"] = template
        self.write_jsonl("code-knowledge-matrix.jsonl", matrix)

        self.assert_guard_error("reuses a generic resolution reason")

    def test_v3_confirmed_capability_requires_confirmed_business_destination(self):
        relationships = self.read_jsonl("relationships.jsonl")
        relationships = [
            item for item in relationships
            if item["id"] != "REL-cap-use-case"
        ]
        self.write_jsonl("relationships.jsonl", relationships)

        self.assert_guard_error("confirmed capability has no confirmed use case")

    def test_v3_rejects_git_commit_metadata_that_disagrees_with_repository(self):
        repo = self.root / "git-source"
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.email", "test@example.com"],
            check=True,
        )
        subprocess.run(
            ["git", "-C", str(repo), "config", "user.name", "History Test"],
            check=True,
        )
        (repo / "rule.txt").write_text("current\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(repo), "add", "rule.txt"], check=True)
        subprocess.run(
            ["git", "-C", str(repo), "commit", "-qm", "real subject"],
            check=True,
        )
        sha = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        commits = self.read_jsonl("git-commits.jsonl")
        actual = subprocess.run(
            [
                "git", "-C", str(repo), "show", "-s",
                "--format=%H%x1f%P%x1f%aI%x1f%cI%x1f%an <%ae>", sha,
            ],
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip().split("\x1f")
        commits[0]["sha"] = sha
        commits[0]["id"] = f"COMMIT-{sha}"
        commits[0]["parents"] = actual[1].split() if actual[1] else []
        commits[0]["author_time"] = actual[2]
        commits[0]["commit_time"] = actual[3]
        commits[0]["author_identity"] = actual[4]
        commits[0]["subject"] = "invented subject"

        with self.assertRaisesRegex(
            guard.ValidationError,
            "Git commit metadata mismatch.*subject",
        ):
            guard.validate_git_commit_index(
                commits,
                {"canonical_root": str(repo), "git": {"is_repository": True}},
            )

    def test_v2_investigation_gap_cannot_pass_current_coverage(self):
        revision = self.root / "revision-v2"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v2",
            revision,
        )
        investigations = [
            json.loads(line)
            for line in (revision / "investigations.jsonl").read_text().splitlines()
            if line
        ]
        investigations = [
            item for item in investigations
            if item["investigation_kind"] != "vocabulary_expansion"
        ]
        (revision / "investigations.jsonl").write_text(
            "".join(json.dumps(item, sort_keys=True) + "\n" for item in investigations),
            encoding="utf-8",
        )
        manifest = json.loads((revision / "manifest.json").read_text())
        manifest["current_coverage_status"] = "partial"
        manifest["aggregate_status"] = "partial"
        manifest["coverage_status"] = "partial"
        (revision / "manifest.json").write_text(json.dumps(manifest) + "\n")
        renderer.write_projections(revision)

        result = guard.validate_revision(revision)
        self.assertEqual(result["status"], "partial")
        metric = result["coverage"]["metrics"]["required_investigation_coverage"]
        self.assertLess(metric["ratio"], 1.0)
        self.assertTrue(metric["unresolved_ids"])

    def test_v3_rejects_fake_all_history_denominator(self):
        manifest = self.read_json("manifest.json")
        manifest["history_analysis"] = {
            "requested_scope": "all_reachable",
            "reachable_commit_count": 9,
            "indexed_commit_count": 1,
        }
        self.write_json("manifest.json", manifest)

        self.assert_guard_error("reachable Git commits")


class BusinessKnowledgeGuardV31Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.revision = Path(self.temp.name) / "revision-v31"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v31",
            self.revision,
        )

    def tearDown(self):
        self.temp.cleanup()

    def read_json(self, name):
        return json.loads((self.revision / name).read_text(encoding="utf-8"))

    def write_json(self, name, value):
        (self.revision / name).write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n",
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

    def set_partial_status(self):
        manifest = self.read_json("manifest.json")
        manifest["current_coverage_status"] = "partial"
        manifest["aggregate_status"] = "partial"
        manifest["coverage_status"] = "partial"
        self.write_json("manifest.json", manifest)

    def assert_guard_error(self, message):
        canonical_hash = guard.revision_canonical_sha256(self.revision)
        manifest = self.read_json("manifest.json")
        manifest["canonical_revision_sha256"] = canonical_hash
        for projection in manifest.get("projection_hashes", {}).values():
            projection["canonical_sha256"] = canonical_hash
        self.write_json("manifest.json", manifest)
        review = self.read_json("semantic-review.json")
        review["canonical_revision_sha256"] = canonical_hash
        self.write_json("semantic-review.json", review)
        with self.assertRaisesRegex(guard.ValidationError, message):
            guard.validate_revision(self.revision)

    def test_valid_v31_revision_passes_engineering_readiness(self):
        renderer.write_projections(self.revision)
        result = guard.validate_revision(self.revision)

        self.assertEqual(result["status"], "passed")
        metric = result["coverage"]["metrics"]["engineering_readiness_coverage"]
        self.assertEqual(metric["ratio"], 1.0)
        self.assertEqual(result["coverage"]["schema_version"], "3.1")

    def test_missing_engineering_view_makes_revision_partial(self):
        self.write_jsonl("engineering-views.jsonl", [])
        self.set_partial_status()
        renderer.write_projections(self.revision)

        result = guard.validate_revision(self.revision)

        metric = result["coverage"]["metrics"]["engineering_readiness_coverage"]
        self.assertEqual(result["status"], "partial")
        self.assertEqual(metric["ratio"], 0.0)
        self.assertIn("UC-create-work-order#engineering_view", metric["unresolved_ids"])

    def test_missing_business_step_mapping_makes_revision_partial(self):
        records = self.read_jsonl("engineering-views.jsonl")
        records[0]["step_mappings"] = [
            item for item in records[0]["step_mappings"]
            if item["step_id"] != "enrich"
        ]
        self.write_jsonl("engineering-views.jsonl", records)
        self.set_partial_status()
        renderer.write_projections(self.revision)

        result = guard.validate_revision(self.revision)

        unresolved = result["coverage"]["metrics"]["engineering_readiness_coverage"]["unresolved_ids"]
        self.assertIn("UC-create-work-order#engineering/enrich", unresolved)

    def test_unknown_business_step_is_rejected(self):
        records = self.read_jsonl("engineering-views.jsonl")
        records[0]["step_mappings"][0]["step_id"] = "not-a-business-step"
        self.write_jsonl("engineering-views.jsonl", records)

        self.assert_guard_error("maps unknown scenario step")

    def test_incomplete_implementation_unit_is_rejected(self):
        records = self.read_jsonl("engineering-views.jsonl")
        records[0]["step_mappings"][0]["implementation_units"][0]["locator"] = ""
        self.write_jsonl("engineering-views.jsonl", records)

        self.assert_guard_error("implementation unit.*requires complete fields")

    def test_missing_stable_topic_makes_revision_partial(self):
        records = self.read_jsonl("engineering-views.jsonl")
        records[0]["engineering_topics"] = [
            item for item in records[0]["engineering_topics"]
            if item["kind"] != "runtime_safety"
        ]
        self.write_jsonl("engineering-views.jsonl", records)
        self.set_partial_status()
        renderer.write_projections(self.revision)

        result = guard.validate_revision(self.revision)

        unresolved = result["coverage"]["metrics"]["engineering_readiness_coverage"]["unresolved_ids"]
        self.assertIn(
            "UC-create-work-order#engineering-topic/runtime_safety",
            unresolved,
        )

    def test_confirmed_topic_without_evidence_is_rejected(self):
        records = self.read_jsonl("engineering-views.jsonl")
        records[0]["engineering_topics"][0]["evidence_ids"] = []
        self.write_jsonl("engineering-views.jsonl", records)

        self.assert_guard_error("confirmed engineering topic.*requires evidence_ids")

    def test_source_unknown_topic_without_unknown_id_is_rejected(self):
        records = self.read_jsonl("engineering-views.jsonl")
        extension = next(
            item for item in records[0]["engineering_topics"]
            if item["kind"] == "security_boundary"
        )
        extension["unknown_ids"] = []
        self.write_jsonl("engineering-views.jsonl", records)

        self.assert_guard_error("source_unknown engineering topic.*requires unknown_ids")

    def test_change_guide_with_unknown_step_is_rejected(self):
        records = self.read_jsonl("engineering-views.jsonl")
        records[0]["change_guides"][0]["affected_step_ids"] = ["unknown-step"]
        self.write_jsonl("engineering-views.jsonl", records)

        self.assert_guard_error("change guide.*names unknown steps")


class BusinessKnowledgeGuardV32Tests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.revision = Path(self.temp.name) / "revision-v32"
        shutil.copytree(
            SKILL_DIR / "tests" / "fixtures" / "sample-revision-v32",
            self.revision,
        )

    def tearDown(self):
        self.temp.cleanup()

    def read_json(self, name):
        return json.loads((self.revision / name).read_text(encoding="utf-8"))

    def write_json(self, name, value):
        (self.revision / name).write_text(
            json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    def refresh(self):
        renderer.write_projections(self.revision)

    def assert_guard_error(self, message):
        renderer.refresh_canonical_hashes(self.revision)
        with self.assertRaisesRegex(guard.ValidationError, message):
            guard.validate_revision(self.revision)

    def make_in_progress(self):
        progress = self.read_json("project-progress.json")
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
        self.write_json("project-progress.json", progress)
        manifest = self.read_json("manifest.json")
        manifest["project_completion_status"] = "in_progress"
        manifest["current_coverage_status"] = "partial"
        manifest["aggregate_status"] = "partial"
        manifest["coverage_status"] = "partial"
        self.write_json("manifest.json", manifest)

    def test_valid_complete_v32_revision_passes(self):
        self.refresh()
        result = guard.validate_revision(self.revision)
        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["project_completion_status"], "complete")
        self.assertEqual(result["next_module_ids"], [])

    def test_in_progress_revision_is_publishable_partial_with_next_module(self):
        self.make_in_progress()
        self.refresh()
        result = guard.validate_revision(self.revision)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["project_completion_status"], "in_progress")
        self.assertEqual(result["next_module_ids"], ["MODQ-consumer-acceptance"])

    def test_complete_project_cannot_retain_pending_high_module(self):
        progress = self.read_json("project-progress.json")
        progress["modules"].append({
            "id": "MODQ-hidden-core",
            "title": "遗漏核心流程",
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
            "next_action": "完成端到端追踪。",
        })
        self.write_json("project-progress.json", progress)
        self.assert_guard_error("complete project cannot retain unfinished")

    def test_in_progress_project_requires_non_empty_next_queue(self):
        self.make_in_progress()
        progress = self.read_json("project-progress.json")
        progress["active_module_id"] = None
        progress["next_module_ids"] = []
        self.write_json("project-progress.json", progress)
        self.assert_guard_error("requires unfinished work and a non-empty next queue")

    def test_high_omission_must_be_attached_to_unfinished_queue(self):
        self.make_in_progress()
        audit = self.read_json("omission-audit.json")
        audit["status"] = "partial"
        audit["findings"] = [{
            "id": "OMIT-video-stitching",
            "severity": "high",
            "signal_ids": ["SIG-f5f099dcb958935b14ee"],
            "candidate_ids": [],
            "evidence_ids": [],
            "resolution_status": "unresolved",
            "resolution": "临境视频拼接流程尚未分析。",
        }]
        self.write_json("omission-audit.json", audit)
        self.assert_guard_error("unresolved omission is not represented")

    def test_publish_current_exposes_whole_project_status_and_queue(self):
        self.make_in_progress()
        self.refresh()
        workspace = Path(self.temp.name) / "workspace"
        current = guard.publish_revision(self.revision, workspace)
        self.assertEqual(current["status"], "partial")
        self.assertEqual(current["project_completion_status"], "in_progress")
        self.assertEqual(current["next_module_ids"], ["MODQ-consumer-acceptance"])

if __name__ == "__main__":
    unittest.main()
