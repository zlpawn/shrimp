import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SKILL_DIR = Path(__file__).parents[1]
SCRIPT = SKILL_DIR / "scripts" / "run_v2_acceptance.py"
SPEC = importlib.util.spec_from_file_location("run_v2_acceptance", SCRIPT)
acceptance = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(acceptance)
EXPECTED = json.loads(
    (
        SKILL_DIR / "tests" / "fixtures" / "real-git-history-expected.json"
    ).read_text(encoding="utf-8")
)


class RealGitAcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name) / "output"

    def tearDown(self):
        self.temp.cleanup()

    def test_real_git_fixture_is_not_skippable_and_matches_expected(self):
        result = acceptance.run_real_git_fixture(SKILL_DIR, self.output)

        self.assertEqual(result["status"], "passed")
        self.assertEqual(result["commit_count"], EXPECTED["commit_count"])
        self.assertEqual(result["commits"], EXPECTED["commits"])
        self.assertEqual(result["fact_types"], EXPECTED["fact_types"])
        self.assertEqual(result["business_event_ids"], EXPECTED["business_event_ids"])
        self.assertEqual(result["reverted_event_ids"], EXPECTED["reverted_event_ids"])
        self.assertEqual(result["claim_verification"], EXPECTED["claim_verification"])
        self.assertEqual(result["event_effectiveness"], EXPECTED["event_effectiveness"])

    def test_missing_bundle_is_a_hard_failure(self):
        with tempfile.TemporaryDirectory() as missing_dir:
            with self.assertRaisesRegex(FileNotFoundError, "real-git-history.bundle"):
                acceptance.run_real_git_fixture(Path(missing_dir), self.output)

    def test_real_git_cli_writes_deterministic_result_file(self):
        first = Path(self.temp.name) / "first.json"
        second = Path(self.temp.name) / "second.json"

        for target in (first, second):
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "real-git-fixture", "--output", str(target)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)

        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(json.loads(first.read_text(encoding="utf-8"))["status"], "passed")

    def test_extended_java_unavailable_has_named_exit_two_diagnostic(self):
        missing = Path(self.temp.name) / "missing-java-repo"

        result = acceptance.run_extended_java(missing, "deadbeef", self.output)

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["exit_code"], 2)
        self.assertEqual(result["diagnostic"], "extended_java_repository_unavailable")

    def test_extended_java_core_surface_checks_cover_concat_and_scoring(self):
        inventory = [
            {
                "kind": kind,
                "name": name,
                "source_location": {"symbol": symbol, "path": path},
            }
            for kind, name, symbol, path in [
                ("http_entry", "POST /construction/site/work-order/add", "WorkOrderController.add", "WorkOrderController.java"),
                ("http_entry", "POST /app/video/relate", "VideoController.relate", "VideoController.java"),
                ("repair_entry", "VideoService.relink", "VideoService.relink", "BackdoorController.java"),
                ("http_entry", "POST /3d/app/device/upload/video", "LinjingDeviceController.upload", "LinjingDeviceController.java"),
                ("callback_entry", "POST /linjing/video/concat/callback", "LinjingVideoProcessFeign.saveConcatResult", "LinjingVideoProcessFeign.java"),
                ("business_process", "VideoContactTaskServiceImpl.contactVideoByFolder", "VideoContactTaskServiceImpl.contactVideoByFolder", "VideoContactTaskServiceImpl.java"),
                ("repair_entry", "VideoContactTaskServiceImpl.retryContactVideoByFolder", "VideoContactTaskServiceImpl.retryContactVideoByFolder", "VideoContactTaskServiceImpl.java"),
                ("business_process", "VideoInfoServiceImpl.uploaded3dVideoRelate", "VideoInfoServiceImpl.uploaded3dVideoRelate", "VideoInfoServiceImpl.java"),
                ("calculation", "LinjingScoreServiceV2.triggerCalculateScore", "LinjingScoreServiceV2.triggerCalculateScore", "LinjingScoreServiceV2.java"),
                ("calculation", "SpeechScoreCalculator.calculate", "SpeechScoreCalculator.calculate", "SpeechScoreCalculator.java"),
                ("calculation", "ToolScoreCalculator.calculate", "ToolScoreCalculator.calculate", "ToolScoreCalculator.java"),
                ("calculation", "CustomerScoreCalculator.calculate", "CustomerScoreCalculator.calculate", "CustomerScoreCalculator.java"),
                ("calculation", "DurationScoreCalculator.calculate", "DurationScoreCalculator.calculate", "DurationScoreCalculator.java"),
                ("calculation", "LinjingScoreServiceV2.recalculateTotalScore", "LinjingScoreServiceV2.recalculateTotalScore", "LinjingScoreServiceV2.java"),
            ]
        ]

        checks = acceptance.extended_java_surface_checks(inventory, has_history_sample=True)

        for name in [
            "video_concat_entry",
            "video_concat_callback",
            "video_concat_process",
            "video_concat_retry",
            "video_binding_uploaded_3d",
            "linjing_scoring_orchestrator",
            "linjing_scoring_calculators",
            "linjing_score_recalculation",
        ]:
            self.assertTrue(checks[name], name)

    def test_extended_java_snapshot_fingerprint_ignores_temporary_clone_path(self):
        base = {
            "schema_version": "1.0",
            "repository_root": "/tmp/first/repo",
            "canonical_root": "/tmp/first/repo",
            "git": {
                "head_sha": "abc123",
                "root_commit_shas": ["root123"],
                "status_porcelain": [],
            },
            "working_tree_dirty": False,
            "files": {"src/A.java": {"sha256": "source", "size": 42}},
            "exclusions": [".git/**", ".leo_business/**"],
            "diagnostics": [],
        }
        moved = {
            **base,
            "repository_root": "/tmp/second/repo",
            "canonical_root": "/tmp/second/repo",
        }

        self.assertEqual(
            acceptance.extended_java_snapshot_fingerprint(base),
            acceptance.extended_java_snapshot_fingerprint(moved),
        )

    def test_cross_model_comparison_rejects_missing_high_seed_candidate(self):
        base = Path(self.temp.name)
        run_a = base / "a"
        run_b_missing_high = base / "b"
        for root, count in ((run_a, 2), (run_b_missing_high, 1)):
            root.mkdir()
            (root / "inventory.jsonl").write_text(
                "".join(
                    json.dumps(
                        {
                            "id": f"SIG-{index}",
                            "structural_importance": "high",
                            "signal_class": "trigger_entry",
                            "kind": "http_entry",
                            "name": f"signal {index}",
                            "source_location": {"path": "src/A.java", "start_line": 1},
                            "discovered_by": ["OBS-test"],
                            "classification": "business",
                            "resolution_status": "unresolved",
                            "mapped_node_ids": [],
                            "resolution_reason": "test",
                            "snapshot_id": "SNAP-test",
                            "id_scheme": "v2",
                        },
                        sort_keys=True,
                    )
                    + "\n"
                    for index in range(count)
                ),
                encoding="utf-8",
            )

        result = acceptance.compare_cross_model_runs(run_a, run_b_missing_high)

        self.assertEqual(result["status"], "failed")
        self.assertIn("missing critical/high candidate", result["errors"][0])

    def test_cross_model_comparison_preserves_normal_low_adjudication(self):
        base = Path(self.temp.name)
        run_a = base / "normal-a"
        run_b = base / "normal-b"
        run_a.mkdir()
        run_b.mkdir()
        common = {
            "structural_importance": "normal",
            "signal_class": "scenario_evidence",
            "kind": "helper_method",
            "source_location": {"path": "src/A.java", "start_line": 1},
            "discovered_by": ["OBS-test"],
            "classification": "unresolved",
            "resolution_status": "unresolved",
            "mapped_node_ids": [],
            "resolution_reason": "test",
            "snapshot_id": "SNAP-test",
            "id_scheme": "v2",
        }
        (run_a / "inventory.jsonl").write_text(
            json.dumps({**common, "id": "SIG-normal-a", "name": "normal a"}) + "\n",
            encoding="utf-8",
        )
        (run_b / "inventory.jsonl").write_text(
            json.dumps({**common, "id": "SIG-normal-b", "name": "normal b"}) + "\n",
            encoding="utf-8",
        )

        result = acceptance.compare_cross_model_runs(run_a, run_b)

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["critical_high_union"], [])
        self.assertEqual(
            result["normal_low_adjudication"],
            ["SIG-normal-a", "SIG-normal-b"],
        )


if __name__ == "__main__":
    unittest.main()
