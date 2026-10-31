import contextlib, io, json, os, shutil, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import registry  # noqa: E402


def touch(p: Path, text="x"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def skill_md(name: str) -> str:
    return f"---\nname: {name}\ndescription: test\n---\n\n# {name}\n"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.cwd = self.tmp / "cwd"
        self.cwd.mkdir(parents=True)
        self.data = self.tmp / "data"
        env = mock.patch.dict(os.environ, {"LEO_VIDEO_ROUTER_HOME": str(self.data)})  # restores prior value
        env.start()
        self.addCleanup(env.stop)


class RegistryTest(Base):

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

    def test_projects_not_a_dict_is_corrupt(self):
        touch(self.data / "registry.json", '{"projects": []}')
        with self.assertRaises(registry.RegistryError):
            registry.locate("hypit", self.home, self.cwd)
        self.assertEqual((self.data / "registry.json").read_text(), '{"projects": []}')

    def test_name_outside_frontmatter_is_not_a_match(self):
        touch(self.home / ".agents/skills/hypit/SKILL.md", skill_md("other") + "name: hypit\n")
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))
        touch(self.home / ".agents/skills/hypit/SKILL.md", "name: hypit\n")  # no frontmatter at all
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))

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


class CliTest(Base):
    def setUp(self):
        super().setUp()
        env = mock.patch.dict(os.environ, {"HOME": str(self.home)})  # Path.home() follows $HOME
        env.start()
        self.addCleanup(env.stop)
        self.addCleanup(os.chdir, os.getcwd())
        os.chdir(self.cwd)

    def run_cli(self, *argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            code = registry.main(list(argv))
        return code, json.loads(buf.getvalue())

    def test_locate_missing(self):
        self.assertEqual(self.run_cli("locate", "hypit"), (1, {"name": "hypit", "found": False}))

    def test_register_dir_without_entry(self):
        (self.tmp / "empty").mkdir()
        code, obj = self.run_cli("register", "hypit", str(self.tmp / "empty"))
        self.assertEqual(code, 2)
        self.assertIn("error", obj)

    def test_list_corrupt_registry(self):
        touch(self.data / "registry.json", "{not json")
        code, obj = self.run_cli("list")
        self.assertEqual(code, 3)
        self.assertIn("error", obj)

    def test_locate_installed(self):
        touch(self.cwd / "lib/skills/video-shotcraft/SKILL.md", skill_md("video-shotcraft"))
        code, obj = self.run_cli("locate", "video-shotcraft")
        self.assertEqual(code, 0)
        self.assertIn("entry_dir", obj)


SKILL = HERE.parent


class DocsTest(unittest.TestCase):
    def read(self, rel):
        return (SKILL / rel).read_text(encoding="utf-8")

    def test_matrix_lists_every_project_and_drops_mg_styles(self):
        text = self.read("references/routing-matrix.md")
        for name in registry.PROJECTS:
            self.assertIn(f"projects/{name}.md", text, name)
        self.assertIn("mg-styles-15", text)  # recorded as removed, with reason
        self.assertIn("## 重叠项目的区分规则", text)
        self.assertIn("## 歧义处理", text)
        self.assertIn("references/fallback.md", text)  # no-match path

    CARD_SECTIONS = ["## 适合", "## 不适合", "## 安装", "## 交接", "## 音频", "## 注意"]
    CARD_FACTS = {
        "MoneyPrinterTurbo": ["npx skills add harry0703/MoneyPrinterTurbo -g -y", "--root", "entry_dir", "--custom-audio-file", "--video-script", "subtitle_provider", "绝对路径"],
        "OpenMontage": ["git clone https://github.com/calesthio/OpenMontage.git", "AGENT_GUIDE.md", "OPENAI_BASE_URL=http://127.0.0.1:3900/v1", "tts-1", "不要写进"],
        "hypit": ["npx skills add hypit-ai/hypit -g -y"],
        "lemo-opuscar": ["npx skills add lemomo-ai/lemo-opuscar -g -y", "LEMO_OPUSCAR_HOME",
                         'LEMO_OPUSCAR_HOME=<目录> sh "<entry_dir>/scripts/setup.sh"',
                         'LEMO_OPUSCAR_HOME=<目录> sh "<entry_dir>/scripts/setup.sh" deps',
                         'LEMO_OPUSCAR_HOME=<目录> sh "<entry_dir>/scripts/setup.sh" demo <slug>'],
        "xilo-opus-video": ["npx skills add Kianzzz/xilo-opus-video -g -y", "绿幕"],
        "dashi-animationstyle": ["npx skills add chuspeeism/dashi-animationstyle -g -y", "--audio", "pipeline/新建作品.mjs", 'node "'],
        "huashu-art-motion": ["npx skills add alchaincyf/huashu-art-motion -g -y", "use-audio", "重试", "S=<entry_dir>"],
        "video-shotcraft": ["npx skills add Vincentwei1021/video-shotcraft -g -y"],
    }

    def test_project_cards(self):
        for name, facts in self.CARD_FACTS.items():
            text = self.read(f"references/projects/{name}.md")
            for s in self.CARD_SECTIONS + facts:
                self.assertIn(s, text, f"{name}: missing {s!r}")
            self.assertNotIn("python3 scripts/registry.py", text, f"{name}: registry.py needs <本 skill 目录>")

    def test_dashi_card_runs_subtitles(self):
        self.assertIn("pipeline/字幕.mjs", self.read("references/projects/dashi-animationstyle.md"))

    def test_audio_doc(self):
        text = self.read("references/audio-omnivoice.md")
        for s in ["http://127.0.0.1:3900/v1", "/v1/audio/speech", "/v1/audio/voices", "--fail-with-body",
                  "--retry", "3902", "asr_model_missing", "口型"]:
            self.assertIn(s, text, s)

    def test_install_doc(self):
        text = self.read("references/install-and-registry.md")
        for s in ["registry.py locate", "registry.py register", "entry_dir", "-g -y", "~/.shrimp/skills/<项目名>",
                  "~/.shrimp/skills/leo-video-router/registry.json", "用户同意"]:
            self.assertIn(s, text, s)

    def test_fallback_doc_names_no_engine_commands(self):
        text = self.read("references/fallback.md")
        self.assertIn("让用户选", text)
        for s in ["leo_huoshan_imagine.mjs", "grok_imagine.mjs", "client.py"]:
            self.assertNotIn(s, text, f"fallback must not hard-code {s}")

    def test_skill_md(self):
        text = self.read("SKILL.md")
        self.assertTrue(text.startswith("---\nname: leo-video-router\ndescription: "))
        for s in ["references/routing-matrix.md", "references/install-and-registry.md",
                  "references/audio-omnivoice.md", "references/fallback.md",
                  "scripts/registry.py locate", "entry_dir", "不选择、不调用任何底层生成引擎"]:
            self.assertIn(s, text, s)
        self.assertLess(len(text.splitlines()), 200, "keep SKILL.md lean; details live in references/")

    def test_relative_links_resolve(self):
        import re
        for md in SKILL.rglob("*.md"):
            for link in re.findall(r"\]\(([^)#:]+\.md)", md.read_text(encoding="utf-8")):
                self.assertTrue((md.parent / link).exists(), f"{md.relative_to(SKILL)} -> {link}")


if __name__ == "__main__":
    unittest.main()
