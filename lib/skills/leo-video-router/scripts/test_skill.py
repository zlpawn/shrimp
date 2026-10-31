import json, os, sys, tempfile, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import registry  # noqa: E402


def touch(p: Path, text="x"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def skill_md(name: str) -> str:
    return f"---\nname: {name}\ndescription: test\n---\n\n# {name}\n"


class RegistryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.home = self.tmp / "home"
        self.cwd = self.tmp / "cwd"
        self.cwd.mkdir(parents=True)
        self.data = self.tmp / "data"
        os.environ["LEO_VIDEO_ROUTER_HOME"] = str(self.data)

    def tearDown(self):
        os.environ.pop("LEO_VIDEO_ROUTER_HOME", None)

    def test_unknown_project_raises(self):
        with self.assertRaises(KeyError):
            registry.locate("nope", self.home, self.cwd)

    def test_not_found(self):
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))

    def test_standard_skill_dir_uses_skill_name(self):
        d = self.home / ".agents/skills/moneyprinterturbo-video"
        touch(d / "SKILL.md", skill_md("moneyprinterturbo-video"))
        r = registry.locate("MoneyPrinterTurbo", self.home, self.cwd)
        self.assertEqual(r["via"], "skills-dir")
        self.assertEqual(r["entry_dir"], str(d))

    def test_skill_md_with_other_name_is_not_a_match(self):
        touch(self.home / ".agents/skills/hypit/SKILL.md", skill_md("something-else"))
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))

    def test_default_download_dir_source_project(self):
        touch(self.home / ".shrimp/skills/OpenMontage/AGENT_GUIDE.md", "# OpenMontage - Agent Guide\n")
        r = registry.locate("OpenMontage", self.home, self.cwd)
        self.assertEqual(r["via"], "default-dir")

    def test_openmontage_never_matched_in_skill_dirs(self):
        touch(self.home / ".agents/skills/OpenMontage/AGENT_GUIDE.md", "# OpenMontage - Agent Guide\n")
        self.assertIsNone(registry.locate("OpenMontage", self.home, self.cwd))

    def test_register_then_locate_prefers_registry(self):
        repo = self.tmp / "AI-JJ/lemo-opuscar"
        touch(repo / "plugin/skills/lemo-opuscar/SKILL.md", skill_md("lemo-opuscar"))
        touch(self.home / ".agents/skills/lemo-opuscar/SKILL.md", skill_md("lemo-opuscar"))
        registry.register("lemo-opuscar", repo, "user", self.home)
        r = registry.locate("lemo-opuscar", self.home, self.cwd)
        self.assertEqual(r["via"], "registry")
        self.assertEqual(r["path"], str(repo.resolve()))  # macOS: /var -> /private/var
        self.assertTrue(r["entry_dir"].endswith("plugin/skills/lemo-opuscar"))

    def test_register_rejects_dir_without_entry(self):
        empty = self.tmp / "empty"
        empty.mkdir()
        with self.assertRaises(ValueError):
            registry.register("hypit", empty, "user", self.home)

    def test_register_rejects_other_projects_skill(self):
        repo = self.tmp / "wrong"
        touch(repo / "SKILL.md", skill_md("huashu-art-motion"))
        with self.assertRaises(ValueError):
            registry.register("dashi-animationstyle", repo, "user", self.home)

    def test_stale_registry_entry_pruned(self):
        repo = self.tmp / "gone/dashi-animationstyle"
        touch(repo / "SKILL.md", skill_md("dashi-animationstyle"))
        registry.register("dashi-animationstyle", repo, "user", self.home)
        (repo / "SKILL.md").unlink()
        self.assertIsNone(registry.locate("dashi-animationstyle", self.home, self.cwd))
        data = json.loads((self.data / "registry.json").read_text())
        self.assertNotIn("dashi-animationstyle", data["projects"])

    def test_workspace_dir(self):
        touch(self.cwd / "lib/skills/video-shotcraft/SKILL.md", skill_md("video-shotcraft"))
        r = registry.locate("video-shotcraft", self.home, self.cwd)
        self.assertEqual(r["via"], "workspace")

    def test_corrupt_registry_is_reported_not_overwritten(self):
        touch(self.data / "registry.json", "{not json")
        repo = self.tmp / "AI-JJ/video-shotcraft"
        touch(repo / "SKILL.md", skill_md("video-shotcraft"))
        with self.assertRaises(registry.RegistryError):
            registry.register("video-shotcraft", repo, "user", self.home)
        with self.assertRaises(registry.RegistryError):
            registry.locate("video-shotcraft", self.home, self.cwd)
        self.assertEqual((self.data / "registry.json").read_text(), "{not json")


if __name__ == "__main__":
    unittest.main()
