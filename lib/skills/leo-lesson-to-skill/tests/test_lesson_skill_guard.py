import importlib.util
import argparse
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "lesson_skill_guard.py"
SPEC = importlib.util.spec_from_file_location("lesson_skill_guard", SCRIPT)
guard = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def sample_ir(self):
        return {
            "schema_version": "1.0",
            "source": {
                "type": "video",
                "uris": ["lesson.mp4"],
                "metadata": {
                    "video_count": 1,
                    "duration_seconds": [30.0],
                    "asr_status": "complete",
                    "visual_audit_status": "not_applicable",
                },
            },
            "transcript": {
                "segments": [
                    {
                        "id": "ASR-S0001",
                        "start": 0.0,
                        "end": 2.0,
                        "text": "第一步先明确目标",
                    }
                ]
            },
            "visual_evidence": {"frames": []},
            "uncertain_items": [],
        }

    def sample_methodology(self):
        return {
            "schema_version": "1.0",
            "course_topic": "表达",
            "target_scenario": "述职",
            "frameworks": [],
            "steps": [
                {
                    "id": "STEP-001",
                    "source_refs": ["ASR-S0001"],
                    "evidence_type": "transcribed",
                    "confidence": "high",
                    "conflict_status": "none",
                }
            ],
            "principles": [],
            "templates": [],
            "anti_patterns": [],
            "uncertain_items": [],
        }

    def sample_report(self):
        frozen_suite = [
            {
                "scenario_id": "MOCK-1",
                "required": True,
                "description": "normal input",
                "user_input": "input one",
                "check_ids": ["structure"],
            },
            {
                "scenario_id": "MOCK-2",
                "required": True,
                "description": "anti-pattern input",
                "user_input": "input two",
                "check_ids": ["anti_pattern"],
            },
        ]
        return {
            "schema_version": "1.0",
            "skill_name": "leo-performance-review",
            "skill_spec_hash": guard.canonical_sha256(self.sample_skill_spec()),
            "frozen_suite": frozen_suite,
            "frozen_suite_hash": guard.canonical_sha256(frozen_suite),
            "test_rounds": [
                {
                    "round": 1,
                    "scenarios": [
                        {
                            "scenario_id": "MOCK-1",
                            "required": True,
                            "checks": {"structure": True},
                        },
                        {
                            "scenario_id": "MOCK-2",
                            "required": True,
                            "checks": {"anti_pattern": True},
                        },
                    ],
                    "failed_items": [],
                    "fix_applied": None,
                }
            ],
            "final_status": "passed",
            "evaluation_mode": "deterministic",
            "consistency_metrics": {
                "methodology_coverage": 1.0,
                "step_order_match": True,
                "required_elements_coverage": 1.0,
                "anti_patterns_coverage": 1.0,
                "unsupported_claims": 0,
                "open_conflicts_reported": True,
                "required_test_pass_rate": 1.0,
                "spec_hash_match": True,
            },
        }

    def sample_skill_spec(self):
        return {
            "schema_version": "1.0",
            "skill_name": "leo-performance-review",
            "target_scenario": "述职",
            "skill_type": "execution",
            "methodology_refs": ["STEP-001"],
            "workflow": [
                {
                    "id": "FLOW-001",
                    "order": 1,
                    "name": "明确目标",
                    "methodology_refs": ["STEP-001"],
                    "inputs": ["用户目标"],
                    "actions": ["归纳目标"],
                    "outputs": ["目标陈述"],
                    "checkpoints": ["目标明确"],
                }
            ],
            "required_elements": ["目标陈述"],
            "anti_patterns": ["流水账"],
            "freedom_policy": {
                "locked": ["workflow_order", "checkpoints", "required_elements", "anti_patterns"],
                "free": ["wording", "material_grouping", "scenario_adaptation"],
            },
            "acceptance_thresholds": {
                "methodology_coverage": 1.0,
                "required_elements_coverage": 1.0,
                "anti_patterns_coverage": 1.0,
                "required_test_pass_rate": 1.0,
                "unsupported_claims_max": 0,
                "require_exact_step_order": True,
                "require_spec_hash_match": True,
                "require_open_conflicts_reported": True,
            },
        }

    def write_candidate_skill(self, skill, include_openai=True, broken_link=False):
        (skill / "references").mkdir(parents=True)
        spec = self.sample_skill_spec()
        (skill / "references" / "skill-spec.json").write_text(
            json.dumps(spec, ensure_ascii=False),
            encoding="utf-8",
        )
        link = (
            "[missing](references/missing.md)\n"
            if broken_link
            else "[spec](references/skill-spec.json)\n"
        )
        (skill / "SKILL.md").write_text(
            "---\n"
            "name: leo-performance-review\n"
            "description: test\n"
            "---\n"
            "[COURSE_EVIDENCE] x\n"
            "[DERIVED_TEMPLATE] y\n"
            "[MODEL_OUTPUT] z\n"
            "FLOW-001 明确目标\n"
            "目标陈述\n"
            "流水账\n"
            + link,
            encoding="utf-8",
        )
        if include_openai:
            (skill / "agents").mkdir(parents=True)
            (skill / "agents" / "openai.yaml").write_text(
                'interface:\n'
                '  default_prompt: "Use $leo-performance-review."\n',
                encoding="utf-8",
            )

    def test_valid_ir_and_methodology(self):
        refs = guard.validate_ir_data(self.sample_ir())
        guard.validate_methodology_data(self.sample_methodology(), refs)

    def test_missing_evidence_is_rejected(self):
        methodology = self.sample_methodology()
        methodology["steps"][0]["source_refs"] = ["ASR-MISSING"]
        with self.assertRaises(guard.ValidationError):
            guard.validate_methodology_data(methodology, {"ASR-S0001"})

    def test_passed_report_requires_every_required_check(self):
        report = self.sample_report()
        report["test_rounds"][0]["scenarios"][0]["checks"]["structure"] = False
        with self.assertRaises(guard.ValidationError):
            guard.validate_test_report_data(report)

    def test_failed_after_three_rounds_requires_three_rounds(self):
        report = self.sample_report()
        report["final_status"] = "failed_after_3_rounds"
        report["test_rounds"][0]["failed_items"] = ["MOCK-1 failed"]
        with self.assertRaises(guard.ValidationError):
            guard.validate_test_report_data(report)

    def test_cleanup_never_accepts_outside_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "run"
            root.mkdir()
            outside = Path(temp) / "outside.txt"
            outside.write_text("keep", encoding="utf-8")
            manifest = {
                "schema_version": "1.0",
                "run_id": "RUN_TEST",
                "status": "cleanup_pending",
                "created_at": "2026-08-10T00:00:00Z",
                "platform": "windows",
                "source_inputs": ["lesson.mp4"],
                "temp_root": str(root.resolve()),
                "permanent_assets": [],
                "temporary_files": [
                    {
                        "path": str(outside.resolve()),
                        "created_by_run": True,
                        "size_bytes": 4,
                        "status": "pending",
                    }
                ],
            }
            candidates, retained = guard.cleanup_candidates(manifest)
            self.assertEqual(candidates, [])
            self.assertTrue(retained)
            self.assertTrue(outside.exists())

    def test_skill_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            skill = Path(temp) / "leo-performance-review"
            self.write_candidate_skill(skill)
            self.assertEqual(
                guard.validate_skill_dir(skill, profile="openai"),
                "leo-performance-review",
            )

    def test_broken_relative_link_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            skill = Path(temp) / "leo-performance-review"
            self.write_candidate_skill(skill, broken_link=True)
            with self.assertRaises(guard.ValidationError):
                guard.validate_skill_dir(skill)

    def test_publish_requires_passed_report_and_publishes_atomically(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            skill = temp_path / "leo-performance-review"
            destination_root = temp_path / "installed"
            self.write_candidate_skill(skill)
            report_path = temp_path / "report.json"
            report_path.write_text(
                json.dumps(self.sample_report()),
                encoding="utf-8",
            )
            args = argparse.Namespace(
                candidate=str(skill),
                test_report=str(report_path),
                destination_root=str(destination_root),
                manifest=None,
                profile="openai",
                spec=str(skill / "references" / "skill-spec.json"),
                allow_overwrite=False,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                guard.command_publish(args)
            published = destination_root / "leo-performance-review"
            self.assertTrue((published / "SKILL.md").is_file())
            self.assertFalse(
                any(path.name.endswith(".partial") for path in destination_root.iterdir())
            )

            with self.assertRaises(guard.ValidationError):
                guard.command_publish(args)

    def test_publish_updates_passed_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            run_root = temp_path / "run"
            run_root.mkdir()
            skill = run_root / "leo-performance-review"
            destination_root = temp_path / "installed"
            self.write_candidate_skill(skill)
            report_path = run_root / "report.json"
            report_path.write_text(
                json.dumps(self.sample_report()),
                encoding="utf-8",
            )
            manifest_path = run_root / "run_manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "run_id": "RUN_TEST",
                        "status": "passed",
                        "created_at": "2026-08-10T00:00:00Z",
                        "platform": "windows",
                        "source_inputs": ["lesson.mp4"],
                        "temp_root": str(run_root.resolve()),
                        "permanent_assets": [],
                        "temporary_files": [],
                    }
                ),
                encoding="utf-8",
            )
            args = argparse.Namespace(
                candidate=str(skill),
                test_report=str(report_path),
                destination_root=str(destination_root),
                manifest=str(manifest_path),
                profile="openai",
                spec=str(skill / "references" / "skill-spec.json"),
                allow_overwrite=False,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                guard.command_publish(args)
            updated = guard.load_json(manifest_path)
            self.assertEqual(updated["status"], "published")
            self.assertIn(
                str((destination_root / "leo-performance-review").resolve()),
                updated["permanent_assets"],
            )

    def test_test_suite_shape_cannot_change_between_rounds(self):
        report = self.sample_report()
        second_round = {
            "round": 2,
            "scenarios": [
                {
                    "scenario_id": "MOCK-1",
                    "required": True,
                    "checks": {"weaker_check": True},
                },
                {
                    "scenario_id": "MOCK-2",
                    "required": True,
                    "checks": {"anti_pattern": True},
                },
            ],
            "failed_items": [],
            "fix_applied": "weakened test",
        }
        report["test_rounds"].append(second_round)
        with self.assertRaises(guard.ValidationError):
            guard.validate_test_report_data(report)

    def test_frozen_suite_hash_must_match(self):
        report = self.sample_report()
        report["frozen_suite_hash"] = "0" * 64
        with self.assertRaises(guard.ValidationError):
            guard.validate_test_report_data(report)

    def test_ir_timestamps_must_fit_video_duration(self):
        ir = self.sample_ir()
        ir["transcript"]["segments"][0]["end"] = 31.0
        with self.assertRaises(guard.ValidationError):
            guard.validate_ir_data(ir)

    def test_skill_spec_rejects_missing_methodology_reference(self):
        spec = self.sample_skill_spec()
        with self.assertRaises(guard.ValidationError):
            guard.validate_skill_spec_data(spec, {"OTHER-ID"})

    def test_skill_spec_must_cover_all_methodology_items(self):
        spec = self.sample_skill_spec()
        with self.assertRaises(guard.ValidationError):
            guard.validate_skill_spec_data(
                spec,
                {"STEP-001", "PRIN-001"},
            )

    def test_skill_spec_rejects_duplicate_step_order(self):
        spec = self.sample_skill_spec()
        duplicate = dict(spec["workflow"][0])
        duplicate["id"] = "FLOW-002"
        spec["workflow"].append(duplicate)
        with self.assertRaises(guard.ValidationError):
            guard.validate_skill_spec_data(spec, {"STEP-001"})

    def test_skill_spec_rejects_weakened_threshold(self):
        spec = self.sample_skill_spec()
        spec["acceptance_thresholds"]["methodology_coverage"] = 0.9
        with self.assertRaises(guard.ValidationError):
            guard.validate_skill_spec_data(spec, {"STEP-001"})

    def test_passed_report_rejects_low_consistency_metric(self):
        report = self.sample_report()
        report["consistency_metrics"]["methodology_coverage"] = 0.9
        with self.assertRaises(guard.ValidationError):
            guard.validate_test_report_data(report)

    def test_multimodal_only_frame_is_valid(self):
        ir = self.sample_ir()
        ir["source"]["metadata"]["visual_audit_status"] = "complete"
        ir["visual_evidence"]["frames"] = [
            {
                "id": "FRAME-0001",
                "timestamp": 3.0,
                "visual_status": "multimodal_only",
                "multimodal": {
                    "status": "complete",
                    "description": "目标到结果的流程图",
                    "visible_text": ["目标", "结果"],
                    "relationships": ["目标 -> 结果"],
                },
                "ocr": {"status": "not_run", "text": ""},
            }
        ]
        guard.validate_ir_data(ir)

    def test_ocr_only_frame_is_valid(self):
        ir = self.sample_ir()
        ir["source"]["metadata"]["visual_audit_status"] = "complete"
        ir["visual_evidence"]["frames"] = [
            {
                "id": "FRAME-0001",
                "timestamp": 3.0,
                "visual_status": "ocr_only",
                "multimodal": {"status": "not_run", "description": ""},
                "ocr": {"status": "complete", "text": "目标 结果"},
            }
        ]
        guard.validate_ir_data(ir)

    def test_frame_without_declared_visual_channel_is_rejected(self):
        ir = self.sample_ir()
        ir["visual_evidence"]["frames"] = [
            {"id": "FRAME-0001", "timestamp": 3.0, "ocr_text": "legacy"}
        ]
        with self.assertRaises(guard.ValidationError):
            guard.validate_ir_data(ir)

    def test_linux_manifest_is_valid(self):
        manifest = {
            "schema_version": "1.0",
            "run_id": "RUN_TEST",
            "status": "initialized",
            "created_at": "2026-08-11T00:00:00Z",
            "platform": "linux",
            "source_inputs": ["lesson.mp4"],
            "temp_root": str(Path(tempfile.gettempdir()).resolve()),
            "permanent_assets": [],
            "temporary_files": [],
        }
        guard.validate_manifest_data(manifest)

    def test_portable_skill_does_not_require_openai_adapter(self):
        with tempfile.TemporaryDirectory() as temp:
            skill = Path(temp) / "leo-performance-review"
            skill.mkdir()
            spec = self.sample_skill_spec()
            spec_dir = skill / "references"
            spec_dir.mkdir()
            (spec_dir / "skill-spec.json").write_text(
                json.dumps(spec, ensure_ascii=False),
                encoding="utf-8",
            )
            (skill / "SKILL.md").write_text(
                "---\n"
                "name: leo-performance-review\n"
                "description: test\n"
                "---\n"
                "[COURSE_EVIDENCE] x\n"
                "[DERIVED_TEMPLATE] y\n"
                "[MODEL_OUTPUT] z\n"
                "FLOW-001 明确目标\n"
                "目标陈述\n"
                "流水账\n"
                "[spec](references/skill-spec.json)\n",
                encoding="utf-8",
            )
            self.assertEqual(
                guard.validate_skill_dir(skill, profile="portable"),
                "leo-performance-review",
            )

    def test_openai_profile_requires_adapter(self):
        with tempfile.TemporaryDirectory() as temp:
            skill = Path(temp) / "leo-performance-review"
            skill.mkdir()
            (skill / "SKILL.md").write_text(
                "---\n"
                "name: leo-performance-review\n"
                "description: test\n"
                "---\n"
                "[COURSE_EVIDENCE] x\n"
                "[DERIVED_TEMPLATE] y\n"
                "[MODEL_OUTPUT] z\n",
                encoding="utf-8",
            )
            with self.assertRaises(guard.ValidationError):
                guard.validate_skill_dir(skill, profile="openai")

    def test_candidate_spec_must_match_frozen_spec(self):
        with tempfile.TemporaryDirectory() as temp:
            skill = Path(temp) / "leo-performance-review"
            (skill / "references").mkdir(parents=True)
            spec = self.sample_skill_spec()
            (skill / "references" / "skill-spec.json").write_text(
                json.dumps(spec, ensure_ascii=False),
                encoding="utf-8",
            )
            (skill / "SKILL.md").write_text(
                "---\n"
                "name: leo-performance-review\n"
                "description: test\n"
                "---\n"
                "[COURSE_EVIDENCE] x\n"
                "[DERIVED_TEMPLATE] y\n"
                "[MODEL_OUTPUT] z\n"
                "[spec](references/skill-spec.json)\n",
                encoding="utf-8",
            )
            frozen = self.sample_skill_spec()
            frozen["required_elements"].append("下一步计划")
            frozen_path = Path(temp) / "frozen-spec.json"
            frozen_path.write_text(
                json.dumps(frozen, ensure_ascii=False),
                encoding="utf-8",
            )
            with self.assertRaises(guard.ValidationError):
                guard.validate_skill_dir(
                    skill,
                    profile="portable",
                    frozen_spec_path=frozen_path,
                )

    def test_candidate_markdown_step_order_must_match_spec(self):
        with tempfile.TemporaryDirectory() as temp:
            skill = Path(temp) / "leo-performance-review"
            self.write_candidate_skill(skill, include_openai=False)
            spec_path = skill / "references" / "skill-spec.json"
            spec = guard.load_json(spec_path)
            second = {
                "id": "FLOW-002",
                "order": 2,
                "name": "形成计划",
                "methodology_refs": ["STEP-001"],
                "inputs": ["目标陈述"],
                "actions": ["形成计划"],
                "outputs": ["行动计划"],
                "checkpoints": ["计划明确"],
            }
            spec["workflow"].append(second)
            spec_path.write_text(
                json.dumps(spec, ensure_ascii=False),
                encoding="utf-8",
            )
            skill_md = skill / "SKILL.md"
            text = skill_md.read_text(encoding="utf-8")
            text += "FLOW-002 行动计划\n"
            text = text.replace(
                "FLOW-001 明确目标",
                "FLOW-002 形成计划\nFLOW-001 明确目标",
            )
            skill_md.write_text(text, encoding="utf-8")
            with self.assertRaises(guard.ValidationError):
                guard.validate_skill_dir(skill, profile="portable")

    def test_publish_requires_frozen_spec(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            skill = temp_path / "leo-performance-review"
            self.write_candidate_skill(skill)
            report_path = temp_path / "report.json"
            report_path.write_text(
                json.dumps(self.sample_report()),
                encoding="utf-8",
            )
            with self.assertRaises(guard.ValidationError):
                guard.command_publish(
                    argparse.Namespace(
                        candidate=str(skill),
                        test_report=str(report_path),
                        destination_root=str(temp_path / "installed"),
                        manifest=None,
                        profile="openai",
                        spec=None,
                        allow_overwrite=False,
                    )
                )

    def test_publish_rejects_report_spec_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            skill = temp_path / "leo-performance-review"
            self.write_candidate_skill(skill)
            spec_path = skill / "references" / "skill-spec.json"
            report = self.sample_report()
            report["skill_spec_hash"] = "0" * 64
            report_path = temp_path / "report.json"
            report_path.write_text(json.dumps(report), encoding="utf-8")
            with self.assertRaises(guard.ValidationError):
                guard.command_publish(
                    argparse.Namespace(
                        candidate=str(skill),
                        test_report=str(report_path),
                        destination_root=str(temp_path / "installed"),
                        manifest=None,
                        profile="openai",
                        spec=str(spec_path),
                        allow_overwrite=False,
                    )
                )

    def test_manifest_commands_register_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "run"
            root.mkdir()
            manifest_path = root / "run_manifest.json"
            manifest = {
                "schema_version": "1.0",
                "run_id": "RUN_TEST",
                "status": "initialized",
                "created_at": "2026-08-10T00:00:00Z",
                "platform": "windows",
                "source_inputs": ["lesson.mp4"],
                "temp_root": str(root.resolve()),
                "permanent_assets": [],
                "temporary_files": [],
            }
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
            temporary = root / "transcript.json"
            temporary.write_text("{}", encoding="utf-8")
            guard.command_manifest_add_temp(
                argparse.Namespace(
                    manifest=str(manifest_path),
                    path=str(temporary),
                )
            )
            updated = guard.load_json(manifest_path)
            self.assertEqual(len(updated["temporary_files"]), 1)

            permanent = Path(temp) / "installed"
            permanent.mkdir()
            guard.command_manifest_add_permanent(
                argparse.Namespace(
                    manifest=str(manifest_path),
                    path=str(permanent),
                )
            )
            updated = guard.load_json(manifest_path)
            self.assertEqual(len(updated["permanent_assets"]), 1)

    def test_cleanup_deletes_only_registered_regular_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "run"
            root.mkdir()
            temporary = root / "candidate.txt"
            temporary.write_text("temporary", encoding="utf-8")
            manifest_path = root / "run_manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "run_id": "RUN_TEST",
                        "status": "cleanup_pending",
                        "created_at": "2026-08-10T00:00:00Z",
                        "platform": "windows",
                        "source_inputs": ["lesson.mp4"],
                        "temp_root": str(root.resolve()),
                        "permanent_assets": [],
                        "temporary_files": [
                            {
                                "path": str(temporary.resolve()),
                                "created_by_run": True,
                                "size_bytes": temporary.stat().st_size,
                                "status": "pending",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            with contextlib.redirect_stdout(io.StringIO()):
                guard.command_cleanup(
                    argparse.Namespace(
                        manifest=str(manifest_path),
                        approve="DELETE",
                    )
                )
            self.assertFalse(temporary.exists())
            updated = guard.load_json(manifest_path)
            self.assertEqual(updated["status"], "cleaned")
            self.assertEqual(
                updated["temporary_files"][0]["status"],
                "deleted",
            )

    def test_manifest_rejects_state_jump(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            manifest_path = root / "run_manifest.json"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schema_version": "1.0",
                        "run_id": "RUN_TEST",
                        "status": "initialized",
                        "created_at": "2026-08-10T00:00:00Z",
                        "platform": "windows",
                        "source_inputs": ["lesson.mp4"],
                        "temp_root": str(root.resolve()),
                        "permanent_assets": [],
                        "temporary_files": [],
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaises(guard.ValidationError):
                guard.command_manifest_set_status(
                    argparse.Namespace(
                        manifest=str(manifest_path),
                        status="published",
                        error=None,
                    )
                )


if __name__ == "__main__":
    unittest.main()
