import contextlib, io, json, os, shutil, sys, tempfile, unittest
from datetime import date
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import endcard  # noqa: E402
import registry   # noqa: E402
import subtitle_engine  # noqa: E402
import workspace  # noqa: E402


def touch(p: Path, text="x"):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


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
        env = mock.patch.dict(os.environ, {
            "LEO_VIDEO_ROUTER_HOME": str(self.data),
            "HOME": str(self.home),
            "USERPROFILE": str(self.home),
        })
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
        self.assertTrue(Path(r["entry_dir"]).as_posix().endswith("plugin/skills/lemo-opuscar"))

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
        data = json.loads((self.data / "registry.json").read_text(encoding="utf-8"))
        self.assertNotIn("dashi-animationstyle", data["projects"])

    def test_projects_not_a_dict_is_corrupt(self):
        touch(self.data / "registry.json", '{"projects": []}')
        with self.assertRaises(registry.RegistryError):
            registry.locate("hypit", self.home, self.cwd)
        self.assertEqual((self.data / "registry.json").read_text(encoding="utf-8"), '{"projects": []}')

    def test_name_outside_frontmatter_is_not_a_match(self):
        touch(self.home / ".agents/skills/hypit/SKILL.md", skill_md("other") + "name: hypit\n")
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))
        touch(self.home / ".agents/skills/hypit/SKILL.md", "name: hypit\n")  # no frontmatter at all
        self.assertIsNone(registry.locate("hypit", self.home, self.cwd))

    def test_quoted_frontmatter_name(self):
        for q in ('"', "'"):
            touch(self.home / ".agents/skills/hypit/SKILL.md", f"---\nname: {q}hypit{q}\n---\n")
            self.assertIsNotNone(registry.locate("hypit", self.home, self.cwd), q)
        touch(self.home / ".agents/skills/hypit/SKILL.md", "---\nname: \"hypit'\n---\n")  # mismatched
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
        self.assertEqual((self.data / "registry.json").read_text(encoding="utf-8"), "{not json")


    def test_dynamic_custom_project_register_and_locate(self):
        repo = self.tmp / "custom-repo/future-video-project"
        touch(repo / "SKILL.md", skill_md("future-video-project"))
        registry.register("future-video-project", repo, "user", self.home)
        r = registry.locate("future-video-project", self.home, self.cwd)
        self.assertIsNotNone(r)
        self.assertEqual(r["via"], "registry")
        self.assertEqual(r["name"], "future-video-project")

class WorkspaceTest(Base):

    def test_config_paths(self):
        self.assertEqual(workspace.get_config_path(), self.data.resolve() / "config.json")  # macOS: /var -> /private/var
        self.assertEqual(workspace.get_default_output_dir(), self.data.resolve() / "output")

    def test_read_and_update_config(self):
        cfg = workspace.read_config()
        self.assertEqual(cfg["workspace_dir"], "")
        self.assertNotIn("default_platform", cfg)  # nothing reads it
        self.assertNotIn("default_audio_source", cfg)

        workspace.update_config({"workspace_dir": str(self.tmp / "custom_ws")})
        cfg2 = workspace.read_config()
        self.assertEqual(cfg2["workspace_dir"], str(self.tmp / "custom_ws"))
        self.assertIsNotNone(cfg2["updated_at"])

    def test_tilde_expands_to_home(self):
        res = workspace.resolve_workspace_dir("~/Videos")
        self.assertEqual(res["dir"], str((self.home / "Videos").resolve()))

    def test_corrupt_config_is_reported_not_overwritten(self):
        touch(self.data / "config.json", "{broken")
        with self.assertRaises(workspace.ConfigError):
            workspace.update_config({"workspace_dir": "x"})
        self.assertEqual((self.data / "config.json").read_text(encoding="utf-8"), "{broken")

    def test_cli_corrupt_config_exits_3(self):
        touch(self.data / "config.json", "[]")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(workspace.main(["status"]), 3)
        self.assertIn("error", json.loads(buf.getvalue()))

    def test_cli_resolve_does_not_persist(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            self.assertEqual(workspace.main(["resolve", "demo", "--workspace", str(self.tmp / "other")]), 0)
        self.assertFalse((self.data / "config.json").exists())
        self.assertFalse(json.loads(buf.getvalue())["persisted"])

    def test_cli_init_persists(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(workspace.main(["init", "demo", "--workspace", str(self.tmp / "other")]), 0)
        self.assertEqual(workspace.read_config()["workspace_dir"], str((self.tmp / "other").resolve()))

    def test_topic_with_slash_keeps_every_part(self):
        name = workspace.format_project_folder_name("AI/机器人 评测", date(2026, 11, 5))
        self.assertEqual(name, "2026-11-05-AI-机器人-评测")

    def test_topic_cannot_escape_workspace(self):
        for topic in ("../../etc", "..", "2026-01-01/../..", "a\\..\\b"):
            name = workspace.format_project_folder_name(topic, date(2026, 11, 5))
            self.assertNotIn("/", name, topic)
            self.assertNotIn("\\", name, topic)
            self.assertNotIn(name, ("..", "."), topic)

    def test_init_records_only_what_has_happened(self):
        res = workspace.init_project_dir("短片", str(self.tmp / "p"), date(2026, 11, 5))
        p = Path(res["project_path"])
        record = (p / "交付记录.md").read_text(encoding="utf-8")
        script = (p / "脚本.md").read_text(encoding="utf-8")
        self.assertNotIn("已应用", record)  # subtitles have not run yet
        self.assertNotIn("MiniMax", record + script)  # Router does not pick engines
        self.assertNotIn("$", record)  # LaTeX does not render in plain markdown
        self.assertIn("2026-11-05-短片_with_subtitles.mp4", record)  # what subtitle_engine writes

    def test_resolve_workspace_cascade(self):
        # 1. default fallback
        res_def = workspace.resolve_workspace_dir()
        self.assertEqual(res_def["source"], "default")
        self.assertEqual(res_def["dir"], str((self.data / "output").resolve()))
        self.assertFalse(res_def["persisted"])

        # 2. explicit user specified (persisted)
        my_ws = self.tmp / "my_videos"
        res_user = workspace.resolve_workspace_dir(str(my_ws))
        self.assertEqual(res_user["source"], "user_specified")
        self.assertEqual(res_user["dir"], str(my_ws.resolve()))
        self.assertTrue(res_user["persisted"])

        # 3. re-read from config history
        res_cfg = workspace.resolve_workspace_dir()
        self.assertEqual(res_cfg["source"], "config")
        self.assertEqual(res_cfg["dir"], str(my_ws.resolve()))
        self.assertFalse(res_cfg["persisted"])

    def test_format_folder_name(self):
        fixed_date = date(2026, 11, 5)
        name1 = workspace.format_project_folder_name("高概念 微短剧:请慢用?", fixed_date)
        self.assertEqual(name1, "2026-11-05-高概念-微短剧-请慢用")

        name2 = workspace.format_project_folder_name("2026-12-01-已经带日期", fixed_date)
        self.assertEqual(name2, "2026-12-01-已经带日期")

    def test_init_project_dir(self):
        fixed_date = date(2026, 11, 5)
        out_ws = self.tmp / "projects"
        res = workspace.init_project_dir("测试短片", user_specified_dir=str(out_ws), project_date=fixed_date)

        p = Path(res["project_path"])
        self.assertTrue(p.exists())
        self.assertTrue((p / "成片" / "发布版").is_dir())
        self.assertTrue((p / "成片" / "原始版").is_dir())
        self.assertTrue((p / "音频").is_dir())
        self.assertTrue((p / "素材").is_dir())
        self.assertTrue((p / "脚本.md").is_file())
        self.assertTrue((p / "交付记录.md").is_file())

        script_text = (p / "脚本.md").read_text(encoding="utf-8")
        self.assertIn("《测试短片》分镜与剧本", script_text)

        record_text = (p / "交付记录.md").read_text(encoding="utf-8")
        self.assertIn("《测试短片》视频交付记录", record_text)
        self.assertIn("哔哩哔哩 (Bilibili)", record_text)


class SubtitleReflowTest(unittest.TestCase):
    def texts(self, text, **kw):
        cues = subtitle_engine.reflow_segments_single_line([{"start": 0, "end": 3, "text": text}], **kw)
        return [c["text"] for c in cues]

    def test_min_duration_survives_overlap_removal(self):
        cues = subtitle_engine.reflow_segments_single_line(
            [{"start": 0, "end": 1.6, "text": "今天我们来聊一聊，人工智能如何改变，每个普通人的生活方式。"}])
        self.assertEqual(len(cues), 3)
        for c in cues:
            self.assertGreaterEqual(c["end"] - c["start"], 0.8 - 1e-9, c)
        for a, b in zip(cues, cues[1:]):
            self.assertLessEqual(a["end"], b["start"] + 1e-9)

    def test_drift_recovers_after_a_pause(self):
        cues = subtitle_engine.reflow_segments_single_line([
            {"start": 0, "end": 1.0, "text": "第一句，第二句，第三句"},
            {"start": 10, "end": 12, "text": "停顿之后"}])
        self.assertEqual(cues[-1]["start"], 10)

    def test_leading_punctuation_is_dropped(self):
        self.assertEqual(self.texts("，你好，世界"), ["你好", "世界"])

    def test_mechanical_trailing_punctuation_is_dropped(self):
        self.assertEqual(self.texts("你好世界。真的吗？太好了！！"), ["你好世界", "真的吗？", "太好了！"])

    def test_punctuation_only_gives_no_cue(self):
        self.assertEqual(self.texts("，。！"), [])

    def test_latin_words_are_not_cut(self):
        text = "Artificial intelligence changes everything for everyone"
        lines = self.texts(text)
        self.assertEqual(" ".join(lines), text)

    def test_ascii_comma_inside_number_is_kept(self):
        self.assertEqual(self.texts("价格是1,000元"), ["价格是1,000元"])

    def test_every_line_fits_and_split_is_even(self):
        lines = self.texts("字" * 17)
        self.assertEqual([len(s) for s in lines], [9, 8])
        for s in self.texts("字" * 50):
            self.assertLessEqual(len(s), 16)

    def test_overlong_latin_token_is_hard_cut(self):
        for s in self.texts("x" * 100):
            self.assertLessEqual(subtitle_engine.text_width(s), 16)

    def test_never_multiline(self):
        for s in self.texts("第一行\n第二行\r\n第三行"):
            self.assertNotIn("\n", s)
            self.assertNotIn("\r", s)


class SubtitleEngineTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def test_burn_flags(self):
        p = subtitle_engine.build_parser()
        self.assertTrue(p.parse_args(["v.mp4"]).burn)
        self.assertTrue(p.parse_args(["v.mp4", "--burn"]).burn)
        self.assertFalse(p.parse_args(["v.mp4", "--no-burn"]).burn)

    def test_failure_exits_nonzero(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(subtitle_engine.main([str(self.tmp / "missing.mp4")]), 1)

    def test_text_only_transcript_uses_real_duration(self):
        segs = subtitle_engine.segments_from_transcript({"text": "全文"}, 42.0)
        self.assertEqual(segs, [{"start": 0.0, "end": 42.0, "text": "全文"}])

    def test_default_font_follows_platform(self):
        self.assertEqual(subtitle_engine.default_font("darwin"), "PingFang SC")
        self.assertEqual(subtitle_engine.default_font("win32"), "Microsoft YaHei")

    def test_font_is_standard_size_on_landscape(self):
        self.assertIn("FontSize=20,", subtitle_engine.subtitle_style(1920, 1080, "F"))

    def test_font_shrinks_so_a_full_line_fits_vertical_video(self):
        style = dict(kv.split("=") for kv in subtitle_engine.subtitle_style(1080, 1920, "F", max_chars=16).split(","))
        px = float(style["FontSize"]) * 1920 / 288  # SRT is converted to ASS with PlayResY=288
        line = px * 0.72 * 16  # measured: a PingFang SC glyph renders about 0.72 of the nominal size
        self.assertLessEqual(line, 1080 * 0.9)
        self.assertGreaterEqual(line, 1080 * 0.75)  # as large as fits; phones need readable text

    def test_missing_libass_fails_before_transcribing(self):
        video = self.tmp / "v.mp4"
        touch(video)
        with mock.patch.object(subtitle_engine, "find_ffmpeg", return_value=None), \
                mock.patch.object(subtitle_engine, "check_voicestudio_health") as health:
            res = subtitle_engine.process_video_subtitles(str(video))
        self.assertFalse(res["ok"])
        self.assertEqual(res["error_type"], "FFMPEG_NO_SUBTITLES_FILTER")
        health.assert_not_called()

    def test_no_burn_does_not_need_libass(self):
        video = self.tmp / "v.mp4"
        touch(video)
        with mock.patch.object(subtitle_engine, "find_ffmpeg", return_value=None), \
                mock.patch.object(subtitle_engine, "check_voicestudio_health", return_value=(False, "down")):
            res = subtitle_engine.process_video_subtitles(str(video), burn=False)
        self.assertEqual(res["error_type"], "VOICESTUDIO_NOT_RUNNING")

    def capable(self, *good):
        return mock.patch.object(subtitle_engine, "has_subtitles_filter", side_effect=lambda b="ffmpeg": b in good)

    def test_env_override_wins(self):
        with mock.patch.dict(os.environ, {"LEO_FFMPEG": "/custom/ffmpeg"}), self.capable("/custom/ffmpeg"), \
                mock.patch.object(subtitle_engine.shutil, "which", return_value="/path/ffmpeg"):
            self.assertEqual(subtitle_engine.find_ffmpeg(), "/custom/ffmpeg")

    def test_env_override_without_libass_is_reported_not_skipped(self):
        with mock.patch.dict(os.environ, {"LEO_FFMPEG": "/custom/ffmpeg"}), self.capable("/path/ffmpeg"), \
                mock.patch.object(subtitle_engine.shutil, "which", return_value="/path/ffmpeg"):
            self.assertIsNone(subtitle_engine.find_ffmpeg())

    def test_path_ffmpeg_used_when_capable(self):
        env = {k: v for k, v in os.environ.items() if k != "LEO_FFMPEG"}
        with mock.patch.dict(os.environ, env, clear=True), self.capable("/path/ffmpeg"), \
                mock.patch.object(subtitle_engine.shutil, "which", return_value="/path/ffmpeg"), \
                mock.patch.object(subtitle_engine, "brew_ffmpeg_full") as brew:
            self.assertEqual(subtitle_engine.find_ffmpeg(), "/path/ffmpeg")
        brew.assert_not_called()  # no brew call when PATH already works (e.g. Windows)

    def test_falls_back_to_brew_full_build_when_path_lacks_libass(self):
        env = {k: v for k, v in os.environ.items() if k != "LEO_FFMPEG"}
        with mock.patch.dict(os.environ, env, clear=True), self.capable("/brew/full/ffmpeg"), \
                mock.patch.object(subtitle_engine.shutil, "which", return_value="/path/ffmpeg"), \
                mock.patch.object(subtitle_engine, "brew_ffmpeg_full", return_value="/brew/full/ffmpeg"):
            self.assertEqual(subtitle_engine.find_ffmpeg(), "/brew/full/ffmpeg")

    def test_ffprobe_is_taken_next_to_chosen_ffmpeg(self):
        d = self.tmp / "bin"
        touch(d / "ffprobe")
        self.assertEqual(subtitle_engine.ffprobe_for(str(d / "ffmpeg")), str(d / "ffprobe"))
        self.assertEqual(subtitle_engine.ffprobe_for("ffmpeg"), "ffprobe")

    def test_health_check_retries_while_app_starts(self):
        import urllib.error
        ok = mock.MagicMock(status=200)
        ok.__enter__.return_value = ok
        ok.read.return_value = b'{"version": "1"}'
        with mock.patch("urllib.request.urlopen", side_effect=[urllib.error.URLError("refused"), ok]), \
                mock.patch.object(subtitle_engine.time, "sleep"):
            good, _ = subtitle_engine.check_voicestudio_health("http://x", wait_seconds=30)
        self.assertTrue(good)

    def test_health_check_gives_up_with_start_hint(self):
        import urllib.error
        with mock.patch("urllib.request.urlopen", side_effect=urllib.error.URLError("refused")), \
                mock.patch.object(subtitle_engine.time, "sleep"):
            good, msg = subtitle_engine.check_voicestudio_health("http://x", wait_seconds=10)
        self.assertFalse(good)
        self.assertIn("请先启动 VoiceStudio", msg)

    def test_health_http_error_is_not_called_not_running(self):
        import urllib.error
        err = urllib.error.HTTPError("http://x", 500, "boom", None, None)
        with mock.patch("urllib.request.urlopen", side_effect=err), \
                mock.patch.object(subtitle_engine.time, "sleep"):
            good, msg = subtitle_engine.check_voicestudio_health("http://x", wait_seconds=0)
        self.assertFalse(good)
        self.assertIn("500", msg)
        self.assertNotIn("未运行", msg)

    @unittest.skipUnless(getattr(subtitle_engine, "find_ffmpeg", lambda: None)(), "no ffmpeg with subtitles filter")
    def test_burn_handles_filter_syntax_in_file_names(self):
        import subprocess
        video = self.tmp / "it's, a [test].mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x240:d=1",
                        "-c:v", "libx264", str(video)], check=True)
        srt = self.tmp / "it's, a [test].srt"
        touch(srt, "1\n00:00:00,000 --> 00:00:01,000\n你好\n")
        out = self.tmp / "out.mp4"
        good, err = subtitle_engine.burn_subtitles_to_video(video, srt, out)
        self.assertTrue(good, err)
        self.assertTrue(out.exists())

    def test_burn_failure_reports_ffmpeg_error(self):
        srt = self.tmp / "s.srt"
        touch(srt, "")
        good, err = subtitle_engine.burn_subtitles_to_video(self.tmp / "missing.mp4", srt, self.tmp / "o.mp4")
        self.assertFalse(good)
        self.assertTrue(err)


class EndcardTest(unittest.TestCase):
    def test_ass_has_canvas_timing_and_every_char(self):
        ass = endcard.card_ass(736, 1280, "路窄处，", "见人宽", 73.3, 76.1, "PingFang SC")
        self.assertIn("PlayResX: 736", ass)
        self.assertIn("PlayResY: 1280", ass)
        self.assertIn("Dialogue: 0,0:01:13.30,0:01:16.10,Card", ass)  # past one minute
        for ch in "路窄处，见人宽":
            self.assertIn(f"}}{ch}", ass)
        self.assertIn("\\fsp", ass)  # the second phrase opens up

    def test_card_sits_above_subtitle_zone(self):
        ass = endcard.card_ass(736, 1280, "a", "", 1, 2, "F")
        self.assertIn(f"\\move(368,{round(1280 * endcard.CARD_Y) + 16},368,{round(1280 * endcard.CARD_Y)}", ass)
        # subtitle top = (MarginV 35 + font 20) / 288 of height from the bottom
        self.assertLess(endcard.CARD_Y, 1 - 55 / 288)

    def test_filter_pads_audio_only_when_present(self):
        self.assertIn("apad", endcard.build_filter(10, 0.8, 2.8, True, 736, 1280))
        self.assertNotIn("[0:a]", endcard.build_filter(10, 0.8, 2.8, False, 736, 1280))

    @unittest.skipUnless(subtitle_engine.find_ffmpeg(), "needs an ffmpeg with libass")
    def test_render_extends_video_by_hold(self):
        import subprocess
        ffmpeg = subtitle_engine.find_ffmpeg()
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / "in.mp4", Path(tmp) / "out.mp4"
            subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=gray:s=320x568:d=2",
                            "-f", "lavfi", "-i", "sine=d=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", str(src)],
                           check=True)
            self.assertEqual(endcard.main([str(src), "路窄处，", "见人宽", str(out), "--hold", "0.5"]), 0)
            dur = float(subprocess.run([subtitle_engine.ffprobe_for(ffmpeg), "-v", "error", "-show_entries",
                                        "format=duration", "-of", "csv=p=0", str(out)],
                                       capture_output=True, text=True).stdout)
            self.assertAlmostEqual(dur, 2.5, delta=0.15)


class CliTest(Base):
    def setUp(self):
        super().setUp()
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

    def test_unreadable_registry_exits_3(self):
        (self.data / "registry.json").mkdir(parents=True)  # exists but read fails with OSError
        code, obj = self.run_cli("locate", "hypit")
        self.assertEqual(code, 3)
        self.assertIn("error", obj)

    def test_save_failure_during_prune_exits_3(self):
        repo = self.tmp / "gone/hypit"
        touch(repo / "SKILL.md", skill_md("hypit"))
        registry.register("hypit", repo, "user", self.home)
        (repo / "SKILL.md").unlink()
        with mock.patch.object(registry.os, "replace", side_effect=PermissionError("denied")):
            code, obj = self.run_cli("locate", "hypit")
        self.assertEqual(code, 3)
        self.assertIn("error", obj)
        self.assertEqual(list(self.data.glob(".registry-*")), [])  # temp file cleaned up

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
        "huashu-art-motion": ["npx skills add alchaincyf/huashu-art-motion -g -y", "use-audio", "重试", 'python3 "<entry_dir>/scripts/capabilities.py" use-audio'],
        "video-shotcraft": ["npx skills add Vincentwei1021/video-shotcraft -g -y"],
    }

    def test_project_cards(self):
        for name, facts in self.CARD_FACTS.items():
            text = self.read(f"references/projects/{name}.md")
            for s in self.CARD_SECTIONS + facts:
                self.assertIn(s, text, f"{name}: missing {s!r}")
            self.assertNotIn("python3 scripts/registry.py", text, f"{name}: registry.py needs <本 skill 目录>")

    def test_lemo_setup_always_prefixed(self):
        import re
        text = self.read("references/projects/lemo-opuscar.md")
        bare = re.findall(r'(?<!LEMO_OPUSCAR_HOME=<目录> )sh "<entry_dir>/scripts/setup.sh"', text)
        self.assertEqual(bare, [], "every setup.sh call needs the LEMO_OPUSCAR_HOME prefix")

    def test_mpt_script_from_file_and_clone_asks_dir(self):
        text = self.read("references/projects/MoneyPrinterTurbo.md")
        self.assertIn('--video-script "$(cat ', text)  # same file the narration came from; quotes-safe
        self.assertNotIn('--video-script "<文案>"', text)
        self.assertIn("共用同一份文案和同一段旁白", text)  # --video-count N: one script, one narration
        ask = text.find("先问用户要不要换目录")
        self.assertNotEqual(ask, -1)
        self.assertLess(ask, text.find("git clone https://github.com/harry0703/MoneyPrinterTurbo.git"))
        self.assertIn("registry.py register MoneyPrinterTurbo", text)

    def test_dashi_card_runs_subtitles(self):
        self.assertIn("pipeline/字幕.mjs", self.read("references/projects/dashi-animationstyle.md"))

    def test_audio_doc(self):
        text = self.read("references/audio-omnivoice.md")
        for s in ["http://127.0.0.1:3900/v1", "/v1/audio/speech", "/v1/audio/voices", "--fail-with-body",
                  "--retry", "3902", "asr_model_missing", "口型", "Git Bash", "WSL"]:
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

    def test_documented_subtitle_flags_exist(self):
        import re
        known = {o for a in subtitle_engine.build_parser()._actions for o in a.option_strings}
        for rel in ("SKILL.md", "references/subtitle-standard.md"):
            for line in self.read(rel).split("subtitle_engine.py")[1:]:
                cmd = line.split("```")[0].split("。")[0]
                for flag in re.findall(r"(?<![\w-])--[a-z][a-z-]+", cmd):
                    self.assertIn(flag, known, f"{rel}: {flag}")

    def test_step7_skips_video_with_burned_subtitles(self):
        self.assertIn("已烧录", self.read("SKILL.md"))
        self.assertIn("已烧录", self.read("references/subtitle-standard.md"))

    def test_subtitle_standard_documents_libass_install(self):
        text = self.read("references/subtitle-standard.md")
        for s in ["libass", "ffmpeg-full", "FFMPEG_NO_SUBTITLES_FILTER", "LEO_FFMPEG", "VoiceStudio"]:
            self.assertIn(s, text, s)

    def test_readme_lists_runtime_data_and_subtitles(self):
        text = self.read("README.md")
        for s in ["config.json", "style-preferences.md", "subtitle_engine.py"]:
            self.assertIn(s, text, s)

    def test_playbook_and_post_effects_are_wired(self):
        text = self.read("SKILL.md")
        self.assertIn("references/production-playbook.md", text)
        self.assertIn("references/post-effects.md", text)
        self.assertIn("endcard.py", self.read("references/post-effects.md"))
        std = self.read("references/subtitle-standard.md")
        for s in ["asr_model_missing", "hf-mirror.com", "hf_revisions.py"]:
            self.assertIn(s, std, s)

    def test_documented_endcard_flags_exist(self):
        import re
        known = set(re.findall(r'add_argument\("(--[a-z-]+)"', (HERE / "endcard.py").read_text(encoding="utf-8")))
        for flag in re.findall(r"`(--[a-z][a-z-]+)`", self.read("references/post-effects.md")):
            self.assertIn(flag, known, flag)

    def test_relative_links_resolve(self):
        import re
        for md in SKILL.rglob("*.md"):
            for link in re.findall(r"\]\(([^)#:]+\.md)", md.read_text(encoding="utf-8")):
                self.assertTrue((md.parent / link).exists(), f"{md.relative_to(SKILL)} -> {link}")


if __name__ == "__main__":
    unittest.main()
