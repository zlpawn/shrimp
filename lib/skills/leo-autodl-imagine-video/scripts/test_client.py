"""uv run --with paramiko --with requests python -B scripts/test_client.py  （全部 mock，不连云端、不花钱）"""
import contextlib, copy, hashlib, io, json, os, shutil, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import client as client_mod  # noqa: E402
import config_manager  # noqa: E402
import remote_engine  # noqa: E402
from remote_engine import AutoDLRemoteEngine  # noqa: E402

IMAGE_WF = json.loads((HERE.parent / "references/workflows/minimax_h3_image_u33_api.json").read_text(encoding="utf-8"))
VIDEO_WF = json.loads((HERE.parent / "references/workflows/minimax_h3_video_1pass_api.json").read_text(encoding="utf-8"))


class FakeStream:
    def __init__(self, text=""):
        self.text = text
        self.channel = mock.Mock()

    def read(self):
        return self.text.encode()

    def write(self, data):
        self.text = data


class FakeSSH:
    """history: /history 的返回；submitted: 提交给 ComfyUI 的工作流。"""

    def __init__(self, history="{}", queue=None):
        self.history = history  # 字符串，或按次序返回的列表（最后一个重复）
        self.queue = queue if queue is not None else [json.dumps({"queue_running": [], "queue_pending": []})]
        self.commands = []
        self.submitted = None

    def exec_command(self, cmd, timeout=None):
        self.commands.append(cmd)
        if "/prompt" in cmd:
            stdin = FakeStream()
            ssh = self

            class Out(FakeStream):
                def read(self):
                    ssh.submitted = json.loads(stdin.text)["prompt"]
                    return json.dumps({"prompt_id": "pid"}).encode()
            return stdin, Out(), FakeStream()
        if "/history/" in cmd:
            history = self.history if isinstance(self.history, str) else (self.history.pop(0) if len(self.history) > 1 else self.history[0])
            return FakeStream(), FakeStream(history), FakeStream()
        if "/queue" in cmd and "POST" not in cmd:
            return FakeStream(), FakeStream(self.queue.pop(0) if len(self.queue) > 1 else self.queue[0]), FakeStream()
        return FakeStream(), FakeStream("{}"), FakeStream()

    def open_sftp(self):
        return mock.Mock()

    def close(self):
        pass


def engine(**cfg):
    base = {"host": "h", "port": 1, "password": "p", "token": "t", "instance_uuid": "u"}
    base.update(cfg)
    return AutoDLRemoteEngine({k: v for k, v in base.items() if v is not None})


def run(eng, ssh, workflow, **kw):
    with mock.patch.object(eng, "probe", return_value={"ok": True}), \
            mock.patch.object(eng, "connect_ssh", return_value=ssh), \
            mock.patch.object(remote_engine.time, "sleep"):
        return eng.run_workflow(workflow, **kw)


DONE = json.dumps({"pid": {"status": {"status_str": "success"}, "outputs": {"9": {"images": [{"filename": "a.png"}]}}}})


class ReferenceBindingTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.ref = self.tmp / "plate.png"
        self.ref.write_bytes(b"x")

    def test_image_template_gets_a_media_node_wired_like_the_verified_video_template(self):
        ssh = FakeSSH(DONE)
        res = run(engine(), ssh, copy.deepcopy(IMAGE_WF), reference_images=[str(self.ref)], output_dir=str(self.tmp))
        self.assertTrue(res["ok"], res)
        media = [n for n in ssh.submitted.values() if n["class_type"] == remote_engine.MEDIA_NODE]
        self.assertEqual(len(media), 1)
        self.assertEqual(json.loads(media[0]["inputs"]["image_paths"]), ["/root/ComfyUI/input/plate.png"])
        media_id = next(k for k, n in ssh.submitted.items() if n is media[0])
        inputs = ssh.submitted["4"]["inputs"]
        video_inputs = VIDEO_WF["136"]["inputs"]
        for key, (src, slot) in ((k, v) for k, v in video_inputs.items() if k.startswith(("ref_images.", "ref_videos."))):
            self.assertEqual(src, "180")
            self.assertEqual(inputs[key], [media_id, slot], key)

    def test_no_references_leaves_the_verified_template_untouched(self):
        ssh = FakeSSH(DONE)
        run(engine(), ssh, copy.deepcopy(IMAGE_WF), output_dir=str(self.tmp))
        self.assertEqual(set(ssh.submitted), set(IMAGE_WF))
        self.assertNotIn("ref_images.ref_image_0", ssh.submitted["4"]["inputs"])

    def test_video_template_uses_its_existing_media_node(self):
        ssh = FakeSSH(DONE)
        run(engine(), ssh, copy.deepcopy(VIDEO_WF), reference_images=[str(self.ref)], output_dir=str(self.tmp))
        self.assertEqual(set(ssh.submitted), set(VIDEO_WF))
        self.assertIn("plate.png", ssh.submitted["180"]["inputs"]["image_paths"])

    def test_unbindable_workflow_warns_instead_of_silently_ignoring(self):
        wf = {"1": {"class_type": "LoadImage", "inputs": {"image": "x.png"}}}
        res = run(engine(), FakeSSH(DONE), wf, reference_images=[str(self.ref)], output_dir=str(self.tmp))
        self.assertTrue(res["ok"], res)
        self.assertIn("plate.png", res["warnings"][0])

    def test_missing_reference_file_fails_before_rendering(self):
        ssh = FakeSSH(DONE)
        res = run(engine(), ssh, copy.deepcopy(IMAGE_WF), reference_images=[str(self.tmp / "typo.png")])
        self.assertFalse(res["ok"])
        self.assertEqual(res["error_type"], "REF_FILE_MISSING")
        self.assertIsNone(ssh.submitted)


class TimeoutTest(unittest.TestCase):
    def test_timeout_cancels_the_remote_job_and_says_so(self):
        ssh = FakeSSH("{}")
        res = run(engine(), ssh, copy.deepcopy(IMAGE_WF), timeout_seconds=0)
        self.assertFalse(res["ok"])
        self.assertEqual(res["error_type"], "RENDER_TIMEOUT")
        self.assertTrue(any('"delete"' in c and "pid" in c for c in ssh.commands), ssh.commands)
        self.assertTrue(any("/interrupt" in c for c in ssh.commands), ssh.commands)

    def test_default_timeout_fits_long_renders(self):
        self.assertGreaterEqual(remote_engine.DEFAULT_RENDER_TIMEOUT, 1800)

    def test_finished_without_output_is_not_called_a_timeout(self):
        ssh = FakeSSH(json.dumps({"pid": {"status": {"status_str": "success"}, "outputs": {}}}))
        res = run(engine(), ssh, copy.deepcopy(IMAGE_WF))
        self.assertEqual(res["error_type"], "NO_OUTPUT")
        self.assertFalse(any("/interrupt" in c for c in ssh.commands))

    def test_timeout_reaches_the_shortcuts(self):
        for call in (lambda e: e.generate_image("p", timeout_seconds=7), lambda e: e.generate_video("p", timeout_seconds=7)):
            eng = engine()
            with mock.patch.object(eng, "run_workflow", return_value={"ok": False}) as rw:
                call(eng)
            self.assertEqual(rw.call_args.kwargs["timeout_seconds"], 7)


class VanishedJobTest(unittest.TestCase):
    """真机上发现：等待中的任务被 --interrupt 清掉后，本地进程会一直等到超时。"""

    def test_job_cleared_from_queue_stops_waiting(self):
        res = run(engine(), FakeSSH("{}"), copy.deepcopy(IMAGE_WF), timeout_seconds=60)
        self.assertEqual(res["error_type"], "RENDER_CANCELLED")

    def test_job_still_queued_keeps_waiting(self):
        queued = json.dumps({"queue_running": [], "queue_pending": [[1, "pid"]]})
        res = run(engine(), FakeSSH("{}", [queued]), copy.deepcopy(IMAGE_WF), timeout_seconds=0.05)
        self.assertEqual(res["error_type"], "RENDER_TIMEOUT")

    def test_unreadable_queue_is_not_treated_as_cleared(self):
        for bad in ("", "<html>", "{}"):
            res = run(engine(), FakeSSH("{}", [bad]), copy.deepcopy(IMAGE_WF), timeout_seconds=0.05)
            self.assertEqual(res["error_type"], "RENDER_TIMEOUT", bad)

    def test_job_finishing_between_the_two_queries_is_not_lost(self):
        res = run(engine(), FakeSSH(["{}", DONE]), copy.deepcopy(IMAGE_WF), timeout_seconds=60, output_dir=tempfile.mkdtemp())
        self.assertNotEqual(res.get("error_type"), "RENDER_CANCELLED", res)

    def test_interrupted_job_has_its_own_error_type(self):
        history = json.dumps({"pid": {"status": {"status_str": "error", "messages": [["execution_interrupted", {}]]}}})
        res = run(engine(), FakeSSH(history), copy.deepcopy(IMAGE_WF))
        self.assertEqual(res["error_type"], "RENDER_INTERRUPTED")


class InterruptTest(unittest.TestCase):
    def test_interrupt_waits_for_the_running_job_to_stop(self):
        busy = json.dumps({"queue_running": [[1, "pid"]], "queue_pending": []})
        idle = json.dumps({"queue_running": [], "queue_pending": []})
        ssh, eng = FakeSSH(queue=[busy, busy, idle]), engine()
        with mock.patch.object(eng, "connect_ssh", return_value=ssh), mock.patch.object(remote_engine.time, "sleep"):
            res = eng.interrupt_queue()
        self.assertEqual(res["running"], 0)
        self.assertEqual(res["message"], "已中断并清空队列")

    def test_interrupt_says_so_when_the_job_will_not_stop(self):
        busy = json.dumps({"queue_running": [[1, "pid"]], "queue_pending": []})
        ssh, eng = FakeSSH(queue=[busy]), engine()
        with mock.patch.object(eng, "connect_ssh", return_value=ssh), mock.patch.object(remote_engine.time, "sleep"):
            res = eng.interrupt_queue()
        self.assertEqual(res["running"], 1)
        self.assertIn("没停下", res["message"])

    def test_interrupt_clears_queue_and_reports(self):
        ssh = FakeSSH()
        eng = engine()
        with mock.patch.object(eng, "connect_ssh", return_value=ssh):
            res = eng.interrupt_queue()
        self.assertTrue(res["ok"], res)
        self.assertEqual((res["running"], res["pending"]), (0, 0))
        self.assertTrue(any("/interrupt" in c for c in ssh.commands))
        self.assertTrue(any('"clear"' in c for c in ssh.commands))

    def test_interrupt_when_unreachable(self):
        eng = engine()
        with mock.patch.object(eng, "connect_ssh", side_effect=OSError("down")):
            res = eng.interrupt_queue()
        self.assertFalse(res["ok"])


class FakeRemote(FakeSSH):
    """远端工作流目录：path -> 内容。sha256sum 和 sftp 都按它返回。"""

    def __init__(self, files):
        super().__init__()
        self.files = files
        self.downloads = []
        self.fail = set()

    def exec_command(self, cmd, timeout=None):
        if cmd.startswith("sha256sum"):
            lines = [f"{hashlib.sha256(c.encode()).hexdigest()}  {p}" for p, c in self.files.items()]
            return FakeStream(), FakeStream("\n".join(lines)), FakeStream()
        return super().exec_command(cmd, timeout)

    def open_sftp(self):
        def get(remote, local):
            self.downloads.append(remote)
            Path(local).write_text(self.files[remote], encoding="utf-8")
            if remote in self.fail:
                raise OSError("dropped")
        sftp = mock.Mock()
        sftp.get.side_effect = get
        return sftp


class WorkflowBackupTest(unittest.TestCase):
    """真实文件系统：源目录 -> ~/.agents/skills（真实目录）<- ~/.claude/skills（软链）。"""
    NAME = "leo-autodl-imagine-video"

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        home = Path(tmp.name).resolve()
        self.source = home / "repo" / self.NAME
        (self.source / "references/workflows/u_series_canvas").mkdir(parents=True)
        (self.source / "SKILL.md").write_text("x")
        (self.source / "references/workflows/verified.json").write_text("verified")
        (self.source / "references/workflows/u_series_canvas/known.json").write_text("old")
        self.central = home / ".agents/skills" / self.NAME
        shutil.copytree(self.source, self.central)
        (home / ".claude/skills").mkdir(parents=True)
        (home / ".claude/skills" / self.NAME).symlink_to(self.central)
        self.roots = [home / ".agents/skills", home / ".claude/skills", home / "absent/skills"]
        self.eng = engine()
        self.eng.skill_root = self.central  # 从已安装的副本运行
        self.eng.workflows_dir = self.central / "references/workflows"
        self.remote = FakeRemote({"/r/known.json": "old", "/r/new.json": "new"})

    def backup(self, source="default"):
        source = self.source if source == "default" else source
        with mock.patch.object(remote_engine, "get_source_dir", return_value=source), \
                mock.patch.object(remote_engine, "INSTALLED_SKILL_ROOTS", self.roots), \
                mock.patch.object(self.eng, "connect_ssh", return_value=self.remote), \
                mock.patch.object(self.eng, "list_remote_workflows", return_value={"ok": True, "remote_workflows": list(self.remote.files)}):
            return self.eng.backup_remote_workflows()

    def read(self, root, rel):
        return (root / "references/workflows" / rel).read_text()

    def test_new_workflow_reaches_source_then_every_agent(self):
        res = self.backup()
        self.assertTrue(res["ok"], res)
        self.assertEqual((res["new"], res["updated"]), (["new.json"], []))
        self.assertEqual(self.read(self.source, "remote_backup/new.json"), "new")
        self.assertEqual(self.read(self.central, "remote_backup/new.json"), "new")
        self.assertEqual(self.remote.downloads, ["/r/new.json"])

    def test_same_name_with_new_content_is_updated_in_place_everywhere(self):
        self.remote.files["/r/known.json"] = "changed"
        res = self.backup()
        self.assertEqual(res["updated"], ["known.json"])
        self.assertEqual(self.read(self.source, "u_series_canvas/known.json"), "changed")
        self.assertEqual(self.read(self.central, "u_series_canvas/known.json"), "changed")
        self.assertFalse((self.source / "references/workflows/remote_backup/known.json").exists())

    def test_second_run_downloads_nothing(self):
        self.backup()
        self.remote.downloads.clear()
        res = self.backup()
        self.assertTrue(res["ok"])
        self.assertEqual((res["new"], res["updated"], self.remote.downloads), ([], [], []))

    def test_verified_template_is_never_overwritten(self):
        self.remote.files["/r/verified.json"] = "remote version"
        self.backup()
        self.assertEqual(self.read(self.source, "verified.json"), "verified")
        self.assertEqual(self.read(self.source, "remote_backup/verified.json"), "remote version")

    def test_failed_download_leaves_no_partial_file_and_retries(self):
        self.remote.fail = {"/r/new.json"}
        res = self.backup()
        self.assertFalse(res["ok"])
        self.assertEqual(res["failed"], ["/r/new.json"])
        self.assertEqual(list((self.source / "references/workflows/remote_backup").iterdir()), [])
        self.remote.fail = set()
        self.assertEqual(self.backup()["new"], ["new.json"])

    def test_failed_distribution_is_reported_and_healed_next_run(self):
        real_copy = shutil.copyfile
        with mock.patch.object(remote_engine.shutil, "copyfile", side_effect=OSError("denied")):
            res = self.backup()
        self.assertFalse(res["ok"])
        self.assertEqual(self.read(self.source, "remote_backup/new.json"), "new")
        self.assertTrue(res["distribute_failed"])
        self.assertIs(shutil.copyfile, real_copy)
        res = self.backup()
        self.assertTrue(res["ok"], res)
        self.assertEqual(self.remote.downloads, ["/r/new.json"])  # 没有重新下载，直接从源目录补
        self.assertEqual(self.read(self.central, "remote_backup/new.json"), "new")

    def test_no_recorded_source_writes_nowhere(self):
        res = self.backup(source=None)
        self.assertFalse(res["ok"])
        self.assertIn("--set-source-dir", res["message"])
        self.assertEqual(self.remote.downloads, [])
        self.assertFalse((self.central / "references/workflows/remote_backup").exists())

    def test_running_from_the_source_itself_still_distributes(self):
        self.eng.skill_root = self.source
        self.backup()
        self.assertEqual(self.read(self.central, "remote_backup/new.json"), "new")

    def test_backups_are_not_picked_up_as_runnable_templates(self):
        self.backup()
        with self.assertRaises(FileNotFoundError):
            self.eng.load_workflow_template("new.json")

    def test_listing_failure_is_reported_not_raised(self):
        with mock.patch.object(remote_engine, "get_source_dir", return_value=self.source), \
                mock.patch.object(self.eng, "list_remote_workflows", side_effect=OSError("ssh down")):
            res = self.eng.backup_remote_workflows()
        self.assertFalse(res["ok"])
        self.assertIn("--backup-remote-workflows", res["message"])


class SourceDirTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.home = Path(tmp.name).resolve()
        patches = [mock.patch.object(config_manager, "DEFAULT_CONFIG_DIR", self.home / "cfg"),
                   mock.patch.object(config_manager, "SOURCE_FILE", self.home / "cfg/source.json")]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_round_trip_and_validation(self):
        self.assertIsNone(config_manager.get_source_dir())
        with self.assertRaises(ValueError):
            config_manager.set_source_dir(str(self.home))
        (self.home / "SKILL.md").write_text("x")
        self.assertEqual(config_manager.set_source_dir(str(self.home)), self.home)
        self.assertEqual(config_manager.get_source_dir(), self.home)

    def test_moved_or_corrupt_source_is_none(self):
        config_manager.DEFAULT_CONFIG_DIR.mkdir()
        for bad in ('{"source_dir": "/nope"}', "not json", "[]", '{"source_dir": null}'):
            config_manager.SOURCE_FILE.write_text(bad)
            self.assertIsNone(config_manager.get_source_dir(), bad)


class PowerOnBackupTest(unittest.TestCase):
    def client(self, power_on):
        c = client_mod.AutoDLMediaClient.__new__(client_mod.AutoDLMediaClient)
        c.engine = mock.Mock()
        c.engine.power_on.return_value = power_on
        c.engine.poll_power_on.return_value = power_on
        c.engine.backup_remote_workflows.return_value = {"ok": False, "message": "backup failed"}
        return c

    def test_successful_boot_backs_up_on_both_paths_and_backup_failure_does_not_fail_it(self):
        for poll in (False, True):
            res = self.client({"ok": True}).power_on(poll=poll)
            self.assertTrue(res["ok"])
            self.assertEqual(res["workflow_backup"]["message"], "backup failed")

    def test_failed_boot_does_not_touch_the_instance(self):
        c = self.client({"ok": False})
        c.power_on()
        c.engine.backup_remote_workflows.assert_not_called()


class ProbeErrorTest(unittest.TestCase):
    def test_bad_token_reports_the_api_error_not_missing_config(self):
        eng = engine(host=None, password=None)
        with mock.patch.object(eng, "refresh_credentials_from_api", return_value={"ok": False, "message": "token 无效"}):
            res = eng.probe()
        self.assertEqual(res["error_type"], "CREDENTIAL_REFRESH_FAILED")
        self.assertIn("token 无效", res["message"])

    def test_nothing_configured_is_config_missing(self):
        res = engine(host=None, password=None, token=None, instance_uuid=None).probe()
        self.assertEqual(res["error_type"], "CONFIG_MISSING")
        self.assertIn("instance", res["message"])


class ConfigTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "config.json"
        for name, val in (("DEFAULT_CONFIG_DIR", Path(tmp.name)), ("CONFIG_FILE", self.path)):
            p = mock.patch.object(config_manager, name, val)
            p.start()
            self.addCleanup(p.stop)

    def test_token_pasted_across_lines_still_loads(self):
        self.path.write_text('{"token": "abc\n  def ", "instance_uuid": " u1\n", "password": "a b"}', encoding="utf-8")
        cfg = config_manager.load_config()
        self.assertEqual(cfg["token"], "abcdef")
        self.assertEqual(cfg["instance_uuid"], "u1")
        self.assertEqual(cfg["password"], "a b")

    def test_update_strips_token_whitespace(self):
        self.assertEqual(config_manager.update_credentials(token=" a\nb ")["token"], "ab")

    def test_corrupt_config_raises_and_is_never_overwritten(self):
        self.path.write_text('{"token": "secret",', encoding="utf-8")
        with self.assertRaises(config_manager.ConfigError) as ctx:
            config_manager.update_credentials(host="h")
        self.assertNotIn("secret", str(ctx.exception))
        self.assertEqual(self.path.read_text(encoding="utf-8"), '{"token": "secret",')


class CliTest(unittest.TestCase):
    def cli(self, *argv, client=None):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["client.py", *argv, "--json"]), contextlib.redirect_stdout(out):
            if client is not None:
                with mock.patch.object(client_mod, "AutoDLMediaClient", return_value=client):
                    client_mod.main()
            else:
                client_mod.main()
        return json.loads(out.getvalue())

    def test_polling_defaults_to_three_seconds(self):
        c = mock.Mock()
        c.power_on.return_value = {"ok": True}
        self.cli("--power-on", "--poll", client=c)
        self.assertEqual(c.power_on.call_args.kwargs["interval"], 3)
        self.assertEqual(c.power_on.call_args.kwargs["max_attempts"], 300)

    def test_off_on_fail_powers_off_only_after_a_failed_render(self):
        c = mock.Mock()
        c.generate_image.return_value = {"ok": False, "message": "boom"}
        c.power_off.return_value = {"ok": True}
        res = self.cli("--image", "--prompt", "p", "--off-on-fail", client=c)
        c.power_off.assert_called_once_with(confirm=True)
        self.assertTrue(res["power_off"]["ok"])

        c = mock.Mock()
        c.generate_image.return_value = {"ok": True}
        self.cli("--image", "--prompt", "p", "--off-on-fail", client=c)
        c.power_off.assert_not_called()

        c = mock.Mock()
        c.generate_image.return_value = {"ok": False}
        self.cli("--image", "--prompt", "p", client=c)
        c.power_off.assert_not_called()

    def test_timeout_flag_reaches_generation(self):
        c = mock.Mock()
        c.generate_video.return_value = {"ok": True}
        self.cli("--video", "--prompt", "p", "--timeout", "99", client=c)
        self.assertEqual(c.generate_video.call_args.kwargs["timeout_seconds"], 99)

    def test_backup_flag(self):
        c = mock.Mock()
        c.backup_remote_workflows.return_value = {"ok": True}
        self.cli("--backup-remote-workflows", client=c)
        c.backup_remote_workflows.assert_called_once()

    def test_interrupt_flag(self):
        c = mock.Mock()
        c.interrupt_queue.return_value = {"ok": True}
        self.assertTrue(self.cli("--interrupt", client=c)["ok"])

    def test_corrupt_config_is_a_clean_json_error(self):
        with mock.patch.object(client_mod, "AutoDLMediaClient", side_effect=config_manager.ConfigError("坏了")):
            res = self.cli("--probe")
        self.assertFalse(res["ok"])
        self.assertEqual(res["error_type"], "CONFIG_CORRUPT")


class SourceTest(unittest.TestCase):
    def test_no_real_instance_values_in_code(self):
        path = Path(os.path.expanduser("~/.shrimp/skills/leo-autodl-imagine-video/config.json"))
        if not path.exists():
            self.skipTest("no local config")
        cfg = json.loads(path.read_text(encoding="utf-8"), strict=False)
        values = [str(cfg[k]) for k in ("token", "instance_uuid", "password", "host") if cfg.get(k)]
        for f in [*HERE.glob("*.py"), HERE.parent / "SKILL.md", *(HERE.parent / "references").glob("*.md")]:
            if f.name == "test_client.py":
                continue
            text = f.read_text(encoding="utf-8")
            for v in values:
                self.assertNotIn(v, text, f.name)


if __name__ == "__main__":
    unittest.main()
