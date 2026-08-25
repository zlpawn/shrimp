import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from discovery import core
import discover_repository_signals
import repository_snapshot


class FakeAdapter:
    adapter_id = "fake"
    adapter_version = "1"
    claimed_languages = {"java"}
    claimed_frameworks = {"fixture"}
    supported_signal_kinds = {"http_entry"}

    def discover(self, context):
        return core.AdapterResult(
            findings=[
                core.RawFinding(
                    signal_class="trigger_entry",
                    kind="http_entry",
                    locator="src/A.java:A.go",
                    name="GET /a",
                    source_location={
                        "path": "src/A.java",
                        "symbol": "A.go",
                        "start_line": 3,
                        "end_line": 8,
                    },
                    framework_identity="GET /a",
                    structural_importance="high",
                    classification="business",
                )
            ],
            rejected=[
                core.RejectedFinding(
                    locator="src/B.java",
                    reason="not externally reachable",
                )
            ],
            unsupported_constructs=[],
            truncated=False,
        )


class DiscoverRepositorySignalsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        (self.repo / "src").mkdir()
        (self.repo / "src" / "A.java").write_text(
            "class A { void go() {} }\n",
            encoding="utf-8",
        )
        self.snapshot = {
            "snapshot_id": "SNAP-test",
            "repository_lineage_id": "REPO-test",
            "files": {
                "src/A.java": {"sha256": "source", "size": 25},
            },
        }
        self.fixtures = Path(__file__).resolve().parent / "fixtures"

    def tearDown(self):
        self.temp.cleanup()

    def test_observation_and_inventory_are_bidirectionally_conserved(self):
        context = core.DiscoveryContext(
            repo_root=self.repo,
            snapshot=self.snapshot,
            repository_lineage_id="REPO-test",
        )
        adapter = FakeAdapter()

        inventory, observation = core.normalize_adapter_result(
            adapter.discover(context),
            context,
            adapter=adapter,
        )

        self.assertEqual(observation["discovered_signal_ids"], [inventory[0]["id"]])
        self.assertEqual(inventory[0]["discovered_by"], [observation["id"]])
        self.assertEqual(
            observation["rejected_findings"],
            [{"locator": "src/B.java", "reason": "not externally reachable"}],
        )

    def test_seed_candidate_id_is_stable_when_later_basis_signals_are_added(self):
        inventory, _ = core.normalize_adapter_result(
            FakeAdapter().discover(
                core.DiscoveryContext(
                    repo_root=self.repo,
                    snapshot=self.snapshot,
                    repository_lineage_id="REPO-test",
                )
            ),
            core.DiscoveryContext(
                repo_root=self.repo,
                snapshot=self.snapshot,
                repository_lineage_id="REPO-test",
            ),
            adapter=FakeAdapter(),
        )
        first = core.seed_candidates(inventory, "REPO-test")
        enriched = [dict(inventory[0], related_signal_ids=["SIG-later"])]
        second = core.seed_candidates(enriched, "REPO-test")

        self.assertEqual(first[0]["id"], second[0]["id"])
        self.assertEqual(first[0]["seed_signal_id"], inventory[0]["id"])

    def test_detected_unsupported_language_is_partial_not_empty_success(self):
        (self.repo / "service.py").write_text("def handle(): pass\n", encoding="utf-8")
        self.snapshot["files"]["service.py"] = {"sha256": "python", "size": 19}

        result = discover_repository_signals.run_discovery(
            self.repo,
            self.snapshot,
            adapters=[],
        )

        self.assertEqual(result["summary"]["status"], "partial")
        self.assertEqual(
            result["summary"]["language_adapter_coverage"]["python"],
            "unsupported",
        )
        self.assertEqual(result["inventory"], [])

    def test_cli_writes_all_four_discovery_artifacts(self):
        snapshot_path = Path(self.temp.name) / "snapshot.json"
        output_dir = Path(self.temp.name) / "out"
        snapshot_path.write_text(json.dumps(self.snapshot), encoding="utf-8")

        exit_code = discover_repository_signals.main(
            [
                "--repo",
                str(self.repo),
                "--snapshot",
                str(snapshot_path),
                "--output-dir",
                str(output_dir),
            ],
            adapters=[FakeAdapter()],
        )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            {path.name for path in output_dir.iterdir()},
            {
                "inventory.jsonl",
                "discovery-observations.jsonl",
                "use-case-candidates.jsonl",
                "discovery-summary.json",
            },
        )

    def test_java_adapter_discovers_routes_writes_states_effects_events_and_repair(self):
        repo = self.fixtures / "multi-signal-java-repo"
        captured = repository_snapshot.capture_snapshot(repo)

        result = discover_repository_signals.run_discovery(repo, captured)
        kinds = {item["kind"] for item in result["inventory"]}

        self.assertTrue({
            "http_entry",
            "persistence_write",
            "state_write",
            "external_call",
            "event_producer",
            "event_consumer",
            "scheduled_job",
            "repair_entry",
        }.issubset(kinds), kinds)
        self.assertEqual(
            result["summary"]["language_adapter_coverage"]["java"],
            "covered",
        )

    def test_java_event_listener_is_not_dropped_from_observation(self):
        repo = self.fixtures / "multi-signal-java-repo"
        result = discover_repository_signals.run_discovery(
            repo,
            repository_snapshot.capture_snapshot(repo),
        )
        listener = next(
            item for item in result["inventory"] if item["kind"] == "event_consumer"
        )
        observation = next(
            item
            for item in result["observations"]
            if item["id"] == listener["discovered_by"][0]
        )

        self.assertIn(listener["id"], observation["discovered_signal_ids"])

    def test_java_payment_state_and_repair_signals_are_high_importance(self):
        repo = self.fixtures / "multi-signal-java-repo"
        result = discover_repository_signals.run_discovery(
            repo,
            repository_snapshot.capture_snapshot(repo),
        )
        important = {
            item["kind"]: item["structural_importance"]
            for item in result["inventory"]
            if item["kind"] in {"external_call", "state_write", "repair_entry"}
        }

        self.assertEqual(important["external_call"], "high")
        self.assertEqual(important["state_write"], "high")
        self.assertEqual(important["repair_entry"], "high")

    def test_node_adapter_prevents_false_empty_success(self):
        repo = self.fixtures / "node-typescript-repo"

        result = discover_repository_signals.run_discovery(
            repo,
            repository_snapshot.capture_snapshot(repo),
        )

        self.assertEqual(
            result["summary"]["language_adapter_coverage"]["typescript"],
            "covered",
        )
        self.assertGreaterEqual(len(result["inventory"]), 7)

    def test_node_adapter_discovers_reverse_effect_anchors(self):
        repo = self.fixtures / "node-typescript-repo"
        result = discover_repository_signals.run_discovery(
            repo,
            repository_snapshot.capture_snapshot(repo),
        )
        signal_classes = {item["signal_class"] for item in result["inventory"]}
        kinds = {item["kind"] for item in result["inventory"]}

        self.assertIn("mutation_anchor", signal_classes)
        self.assertIn("external_effect_anchor", signal_classes)
        self.assertIn("event_anchor", signal_classes)
        self.assertTrue({
            "http_entry",
            "server_handler",
            "persistence_write",
            "external_call",
            "event_producer",
            "event_consumer",
            "scheduled_job",
            "command_entry",
            "repair_entry",
        }.issubset(kinds), kinds)


if __name__ == "__main__":
    unittest.main()
