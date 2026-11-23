import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

CLI_PATH = Path(__file__).resolve().parents[1] / "scripts" / "workspace_cli.py"


class WorkspaceCliTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.home_dir = Path(self.tmp.name) / "skill-home"
        self.env = os.environ.copy()
        self.env["LEO_INTERVIEW_CLOWN_HOME"] = str(self.home_dir)
        self.env.pop("LEO_INTERVIEW_CLOWN_CONFIG", None)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def run_cli(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(CLI_PATH), *args],
            env=self.env,
            text=True,
            capture_output=True,
            check=check,
        )

    def test_unconfigured_reminds_then_uses_fallback(self) -> None:
        res = self.run_cli("config", "resolve")
        payload = json.loads(res.stdout)
        self.assertEqual(payload["source"], "fallback")
        self.assertTrue(payload["needs_config_reminder"])
        self.assertEqual(Path(payload["target_root"]), (self.home_dir / "output").resolve())

        self.run_cli("config", "set", "--use-fallback")
        res_after = self.run_cli("config", "resolve")
        payload_after = json.loads(res_after.stdout)
        self.assertEqual(payload_after["source"], "fallback")
        self.assertFalse(payload_after["needs_config_reminder"])

    def test_persist_and_once_override(self) -> None:
        vault = Path(self.tmp.name) / "ObsidianVault"
        vault.mkdir()
        res = self.run_cli("config", "resolve", "--target-root", str(vault))
        payload = json.loads(res.stdout)
        self.assertEqual(payload["source"], "user_specified")
        self.assertTrue(payload["persisted"])
        self.assertFalse(payload["needs_config_reminder"])

        res2 = self.run_cli("config", "resolve")
        payload2 = json.loads(res2.stdout)
        self.assertEqual(payload2["source"], "config")
        self.assertEqual(Path(payload2["target_root"]), vault.resolve())

        temp_out = Path(self.tmp.name) / "OneOffDir"
        temp_out.mkdir()
        res3 = self.run_cli("config", "resolve", "--target-root", str(temp_out), "--once")
        payload3 = json.loads(res3.stdout)
        self.assertFalse(payload3["persisted"])
        self.assertEqual(Path(payload3["target_root"]), temp_out.resolve())

        res4 = self.run_cli("config", "resolve")
        self.assertEqual(Path(json.loads(res4.stdout)["target_root"]), vault.resolve())

    def test_run_lifecycle_and_safe_cleanup(self) -> None:
        init_res = self.run_cli(
            "run",
            "init",
            "--mode",
            "hybrid",
            "--source",
            "/tmp/sample-repo",
            "--run-id",
            "hybrid-test-01",
        )
        run_data = json.loads(init_res.stdout)
        run_dir = Path(run_data["run_dir"])
        self.assertTrue(run_dir.is_dir())
        self.assertEqual(run_dir.parent, (self.home_dir / "runs").resolve())
        self.assertTrue((run_dir / "proposal").is_dir())

        blocked1 = self.run_cli("run", "cleanup", "--run-dir", str(run_dir), check=False)
        self.assertNotEqual(blocked1.returncode, 0)

        self.run_cli("run", "set-status", "--run-dir", str(run_dir), "--status", "published")
        blocked2 = self.run_cli("run", "cleanup", "--run-dir", str(run_dir), check=False)
        self.assertNotEqual(blocked2.returncode, 0)

        self.run_cli("run", "record-audit", "--run-dir", str(run_dir), "--result", "pass")
        self.run_cli("run", "cleanup", "--run-dir", str(run_dir))
        self.assertFalse(run_dir.exists())
        self.assertTrue((self.home_dir / "runs").is_dir())

    def test_rejects_invalid_run_id(self) -> None:
        bad = self.run_cli(
            "run",
            "init",
            "--mode",
            "doc",
            "--source",
            "https://example.com",
            "--run-id",
            "../escape",
            check=False,
        )
        self.assertNotEqual(bad.returncode, 0)

    def test_venv_ensure_with_uv_if_available(self) -> None:
        if not shutil.which("uv"):
            self.skipTest("uv not installed in environment")
        res = self.run_cli("venv", "ensure")
        payload = json.loads(res.stdout)
        self.assertTrue(payload["ready"])
        self.assertTrue(Path(payload["venv_python"]).is_file())
        self.assertEqual(Path(payload["venv_dir"]), (self.home_dir / ".venv").resolve())


if __name__ == "__main__":
    unittest.main()
