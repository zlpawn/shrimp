import importlib.util
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "git_business_history.py"
SPEC = importlib.util.spec_from_file_location("git_business_history", SCRIPT)
git_history = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
SPEC.loader.exec_module(git_history)


class GitBusinessHistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def make_git_repo(self):
        repo = self.root / "repo"
        repo.mkdir()
        self.git(repo, "init", "-q")
        self.git(repo, "config", "user.email", "history@example.com")
        self.git(repo, "config", "user.name", "History Test")
        return repo

    def git(self, repo, *args):
        return subprocess.run(
            ["git", "-C", str(repo), *args],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ).stdout.strip()

    def commit(self, repo, message, files):
        for name, content in files.items():
            path = repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        self.git(repo, "add", "-A")
        self.git(repo, "commit", "-m", message)

    def git_all_shas(self, repo):
        return set(self.git(repo, "rev-list", "--all").splitlines())

    def test_commit_message_is_stored_as_claim_not_change_fact(self):
        repo = self.make_git_repo()
        self.commit(repo, "initial", {"src/Order.java": "class Order { int version = 1; }\n"})
        self.commit(repo, "feat: added refund", {"README.md": "rename only\n"})

        history = git_history.index_commits(repo)
        claim = git_history.extract_historical_claim(history[-1])

        self.assertEqual(claim["source_kind"], "commit_message")
        self.assertEqual(claim["verification_status"], "unverifiable")
        self.assertEqual(claim["source_locator"], history[-1]["sha"])
        self.assertEqual(git_history.extract_change_facts(repo, history[-1]), [])

    def test_all_reachable_commits_are_indexed_with_parents_and_merges(self):
        repo = self.make_git_repo()
        self.commit(repo, "initial", {"src/Base.java": "class Base {}\n"})
        self.git(repo, "checkout", "-q", "-b", "feature")
        self.commit(repo, "feature", {"src/Feature.java": "class Feature {}\n"})
        self.git(repo, "checkout", "-q", "master")
        self.commit(repo, "main change", {"src/Main.java": "class Main {}\n"})
        self.git(repo, "merge", "--no-ff", "-m", "merge feature", "feature")

        commits = git_history.index_commits(repo)

        self.assertEqual({item["sha"] for item in commits}, self.git_all_shas(repo))
        self.assertTrue(any(item["is_merge"] for item in commits))
        self.assertTrue(all("parents" in item for item in commits))

    def test_rename_and_sensitive_path_screening_are_deterministic(self):
        repo = self.make_git_repo()
        self.commit(repo, "initial", {"src/OrderController.java": "class OrderController {}\n"})
        self.git(repo, "mv", "src/OrderController.java", "src/WorkOrderController.java")
        self.git(repo, "commit", "-m", "fix")
        self.commit(
            repo,
            "message only",
            {"src/OrderService.java": "class OrderService { static final String TYPE = \"TODO\"; }\n"},
        )

        commits = git_history.index_commits(repo)
        renamed = commits[-2]
        sensitive = commits[-1]

        self.assertEqual(
            renamed["rename_facts"],
            [{"from": "src/OrderController.java", "to": "src/WorkOrderController.java"}],
        )
        self.assertFalse(git_history.screen_deep_analysis(renamed, [])["selected"])
        self.assertTrue(git_history.screen_deep_analysis(sensitive, [])["selected"])

    def test_cli_writes_history_artifacts(self):
        repo = self.make_git_repo()
        self.commit(repo, "fix", {"src/Order.java": "class Order {}\n"})
        output = self.root / "history"

        exit_code = git_history.main(["index", "--repo", str(repo), "--output-dir", str(output)])

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            {path.name for path in output.iterdir()},
            {"git-commits.jsonl", "historical-claims.jsonl", "history-index-summary.json"},
        )
        commits = [json.loads(line) for line in (output / "git-commits.jsonl").read_text().splitlines()]
        claims = [json.loads(line) for line in (output / "historical-claims.jsonl").read_text().splitlines()]
        summary = json.loads((output / "history-index-summary.json").read_text())
        self.assertEqual(len(commits), len(claims))
        self.assertEqual(summary["status"], "partial")
        self.assertTrue(summary["diagnostics"])

    def fixture_commit(self, name, subject="change"):
        repo = self.make_git_repo()
        initial = {
            "rename-only": {"src/OrderController.java": "class OrderController { void cancel() {} }\n"},
            "cancel-rule-change": {
                "src/OrderCancellation.java": (
                    "class OrderCancellation {\n"
                    "  boolean canCancel(String status) {\n"
                    "    // PREPARING orders may be cancelled\n"
                    "    return status.equals(\"PREPARING\");\n"
                    "  }\n"
                    "}\n"
                )
            },
            "revert": {
                "src/OrderCancellation.java": (
                    "class OrderCancellation {\n"
                    "  boolean canCancel(String status) {\n"
                    "    // PREPARING orders may be cancelled\n"
                    "    return status.equals(\"PREPARING\");\n"
                    "  }\n"
                    "}\n"
                )
            },
        }[name]
        self.commit(repo, "initial", initial)
        if name == "rename-only":
            self.git(repo, "mv", "src/OrderController.java", "src/WorkOrderController.java")
            self.git(repo, "commit", "-m", subject)
        elif name == "cancel-rule-change":
            self.commit(
                repo,
                subject,
                {
                    "src/OrderCancellation.java": (
                        "class OrderCancellation {\n"
                        "  boolean canCancel(String status, boolean manual) {\n"
                        "    // PREPARING orders require manual cancellation\n"
                        "    return status.equals(\"PREPARING\") && manual;\n"
                        "  }\n"
                        "}\n"
                    )
                },
            )
        elif name == "revert":
            self.commit(
                repo,
                "tighten",
                {
                    "src/OrderCancellation.java": (
                        "class OrderCancellation {\n"
                        "  boolean canCancel(String status, boolean manual) {\n"
                        "    // PREPARING orders require manual cancellation\n"
                        "    return status.equals(\"PREPARING\") && manual;\n"
                        "  }\n"
                        "}\n"
                    )
                },
            )
            self.commit(repo, "revert", initial)
        return repo, git_history.index_commits(repo)[-1]

    def test_rename_only_commit_produces_no_business_event(self):
        repo, commit = self.fixture_commit("rename-only", subject="rename")

        facts = git_history.extract_change_facts(repo, commit)

        self.assertTrue(any(item["fact_type"] == "symbol_renamed" for item in facts))
        self.assertEqual(git_history.group_evolution_events([commit], facts, [], []), [])

    def test_rule_change_produces_before_after_fact_without_message_support(self):
        repo, commit = self.fixture_commit("cancel-rule-change", subject="fix")

        facts = git_history.extract_change_facts(repo, commit)
        changed = next(item for item in facts if item["fact_type"] == "condition_changed")

        self.assertEqual(changed["before_summary"], "PREPARING orders may be cancelled")
        self.assertEqual(changed["after_summary"], "PREPARING orders require manual cancellation")
        self.assertTrue(changed["before_evidence_ids"])
        self.assertTrue(changed["after_evidence_ids"])
        self.assertNotEqual(changed["commit_id"], "message")

    def test_revert_marks_prior_event_reverted(self):
        repo = self.make_git_repo()
        initial = (
            "class OrderCancellation {\n"
            "  boolean canCancel(String status) {\n"
            "    // PREPARING orders may be cancelled\n"
            "    return status.equals(\"PREPARING\");\n"
            "  }\n"
            "}\n"
        )
        self.commit(repo, "initial", {"src/OrderCancellation.java": initial})
        tightened = initial.replace(
            "PREPARING orders may be cancelled",
            "PREPARING orders require manual cancellation",
        ).replace("boolean canCancel(String status)", "boolean canCancel(String status, boolean manual)").replace(
            'return status.equals("PREPARING");',
            'return status.equals("PREPARING") && manual;',
        )
        self.commit(repo, "tighten", {"src/OrderCancellation.java": tightened})
        self.commit(repo, "revert", {"src/OrderCancellation.java": initial})
        commits = git_history.index_commits(repo)
        facts = [fact for commit in commits for fact in git_history.extract_change_facts(repo, commit)]
        claims = [git_history.extract_historical_claim(commit) for commit in commits]

        events = git_history.group_evolution_events(commits, facts, claims, [])
        prior = next(item for item in events if item["title"] == "Tighten cancellation rule")

        self.assertEqual(prior["current_effectiveness"], "reverted")

    def test_direct_followup_changes_are_grouped_and_full_revert_marks_group_reverted(self):
        repo = self.make_git_repo()
        initial = (
            "class OrderCancellation {\n"
            "  boolean canCancel(String status) {\n"
            "    // PREPARING orders may be cancelled\n"
            "    return status.equals(\"PREPARING\");\n"
            "  }\n"
            "}\n"
        )
        manual = initial.replace(
            "PREPARING orders may be cancelled",
            "PREPARING orders require manual cancellation",
        )
        audited = manual.replace(
            "PREPARING orders require manual cancellation",
            "PREPARING orders require manual cancellation and audit",
        )
        self.commit(repo, "initial", {"src/OrderCancellationRule.java": initial})
        self.commit(repo, "fix", {"src/OrderCancellationRule.java": manual})
        self.commit(repo, "complete rule change", {"src/OrderCancellationRule.java": audited})
        self.commit(repo, "revert", {"src/OrderCancellationRule.java": initial})
        commits = git_history.index_commits(repo)
        facts = [fact for commit in commits for fact in git_history.extract_change_facts(repo, commit)]
        claims = [git_history.extract_historical_claim(commit) for commit in commits]

        events = git_history.group_evolution_events(commits, facts, claims, [])

        self.assertEqual(len(events), 2)
        changed = next(item for item in events if item["before_summary"] == "PREPARING orders may be cancelled")
        revert = next(item for item in events if item["after_summary"] == "PREPARING orders may be cancelled")
        self.assertEqual(changed["after_summary"], "PREPARING orders require manual cancellation and audit")
        self.assertEqual(changed["grouping_status"], "confirmed_group")
        self.assertEqual(len(changed["commit_ids"]), 2)
        self.assertEqual(changed["current_effectiveness"], "reverted")
        self.assertEqual(revert["current_effectiveness"], "historical_only")


if __name__ == "__main__":
    unittest.main()
