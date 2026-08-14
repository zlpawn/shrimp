import importlib.util
import json
import shutil
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
            "_business_knowledge",
            "output-workspace.md",
        ]:
            self.assertIn(required, text)

    def test_output_workspace_reference_defines_ai_and_human_paths(self):
        text = (
            SKILL_DIR / "references" / "output-workspace.md"
        ).read_text(encoding="utf-8").lower()
        for required in [
            "<repository-root>/_business_knowledge/",
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

        self.assertEqual(workspace, (repo / "_business_knowledge").resolve())

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
            guard.resolve_workspace_root(repo, "_business_knowledge")

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
                repo / "_business_knowledge",
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
        rubric = json.loads(
            (expected / "semantic-rubric.json").read_text(encoding="utf-8")
        )

        self.assertEqual(len(work_order["required_unknowns"]), 5)
        self.assertEqual(len(video["required_family_members"]), 8)
        self.assertEqual(rubric["reviewer_mode"], "independent")
        self.assertGreaterEqual(rubric["minimum_total_score"], 13)

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


if __name__ == "__main__":
    unittest.main()
