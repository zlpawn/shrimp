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


if __name__ == "__main__":
    unittest.main()
