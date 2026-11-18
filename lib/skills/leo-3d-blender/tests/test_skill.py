#!/usr/bin/env python3
"""Unit tests for leo-3d-blender skill structure, workspace memory, and MCP bridge."""

from __future__ import annotations

import base64
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

SKILL_DIR = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = SKILL_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import blender_bridge  # noqa: E402
import workspace  # noqa: E402


class BaseSkillTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.skill_home = self.tmp / "skill_home"
        self.home.mkdir(parents=True, exist_ok=True)
        env = mock.patch.dict(
            os.environ,
            {
                "LEO_3D_BLENDER_HOME": str(self.skill_home),
                "HOME": str(self.home),
                "USERPROFILE": str(self.home),
            },
            clear=False,
        )
        env.start()
        self.addCleanup(env.stop)
        for key in ("LEO_3D_BLENDER_CONFIG_PATH", "BLENDER_MCP_REPO", "BLENDER_HOST", "BLENDER_PORT"):
            if key in os.environ:
                patch_del = mock.patch.dict(os.environ, {}, clear=False)
                patch_del.start()
                os.environ.pop(key, None)
                self.addCleanup(patch_del.stop)


class SkillLayoutTests(BaseSkillTest):
    def test_required_files_and_frontmatter(self) -> None:
        skill_md = SKILL_DIR / "SKILL.md"
        pkg_json = SKILL_DIR / "package.json"
        self.assertTrue(skill_md.is_file(), "SKILL.md must exist")
        self.assertTrue(pkg_json.is_file(), "package.json must exist")

        text = skill_md.read_text(encoding="utf-8")
        self.assertRegex(text, r"^---\r?\nname: leo-3d-blender\r?\ndescription: .+")

        for ref in (
            "references/blender-mcp-workflow.md",
            "references/bpy-templates.md",
            "references/providers-roadmap.md",
            "scripts/workspace.py",
            "scripts/blender_bridge.py",
        ):
            self.assertIn(ref, text)
            self.assertTrue((SKILL_DIR / ref).is_file(), f"missing {ref}")

        pkg = json.loads(pkg_json.read_text(encoding="utf-8"))
        self.assertEqual(pkg["name"], "leo-3d-blender")
        self.assertIn("status", pkg.get("scripts", {}))
        self.assertIn("test", pkg.get("scripts", {}))


class WorkspaceMemoryTests(BaseSkillTest):
    def test_three_tier_workspace_cascade(self) -> None:
        # 1. Default fallback
        ws_default = workspace.resolve_workspace_dir()
        self.assertEqual(ws_default["source"], "default")
        self.assertEqual(Path(ws_default["dir"]), (self.home / "素材" / "3d").resolve())

        # 2. Explicit workspace persists to config.json
        custom = self.tmp / "custom_3d"
        ws_user = workspace.resolve_workspace_dir(str(custom), persist=True)
        self.assertEqual(ws_user["source"], "user_specified")
        self.assertTrue(ws_user["persisted"])
        self.assertEqual(Path(ws_user["dir"]), custom.resolve())

        # 3. Subsequent calls reuse remembered workspace
        ws_cfg = workspace.resolve_workspace_dir()
        self.assertEqual(ws_cfg["source"], "config")
        self.assertEqual(Path(ws_cfg["dir"]), custom.resolve())

    def test_init_project_dir_creates_standard_tree_and_sets_active_project(self) -> None:
        ws_root = self.tmp / "3d_projects"
        res = workspace.init_project_dir("赛博 茶壶/v1", user_specified_dir=str(ws_root), project_date=date(2026, 11, 18))
        project_path = Path(res["project_path"])
        self.assertEqual(project_path.name, "2026-11-18-赛博-茶壶-v1")
        for sub in ("场景", "脚本", "资产", "预览", "渲染"):
            self.assertTrue((project_path / sub).is_dir(), f"missing subdir {sub}")
        self.assertTrue((project_path / "交付记录.md").is_file())

        cfg = workspace.read_config()
        self.assertEqual(Path(cfg["active_project"]), project_path)

    def test_set_repo_and_clear_repo(self) -> None:
        fake_repo = self.tmp / "fake_repo"
        fake_repo.mkdir()
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            rc = workspace.main(["set-repo", str(fake_repo)])
        self.assertEqual(rc, 1)

        (fake_repo / "pyproject.toml").write_text('[project]\nname = "mcp-for-blender"\n', encoding="utf-8")
        with contextlib.redirect_stdout(io.StringIO()):
            rc = workspace.main(["set-repo", str(fake_repo)])
        self.assertEqual(rc, 0)
        self.assertEqual(Path(workspace.read_config()["mcp_repo_dir"]), fake_repo.resolve())

        with contextlib.redirect_stdout(io.StringIO()):
            rc = workspace.main(["clear-repo"])
        self.assertEqual(rc, 0)
        self.assertEqual(workspace.read_config()["mcp_repo_dir"], "")

    def test_corrupt_config_raises_and_is_not_overwritten(self) -> None:
        cfg_path = workspace.get_config_path()
        cfg_path.parent.mkdir(parents=True, exist_ok=True)
        cfg_path.write_text("{broken json", encoding="utf-8")
        with self.assertRaises(workspace.ConfigError):
            workspace.read_config()
        self.assertEqual(cfg_path.read_text(encoding="utf-8"), "{broken json")


class BlenderBridgeTests(BaseSkillTest):
    def test_default_uvx_mode_command_without_local_repo(self) -> None:
        repo_dir, pkg, host, port, _ = blender_bridge.resolve_runtime_settings()
        self.assertIsNone(repo_dir)
        self.assertEqual(pkg, "mcp-for-blender")
        self.assertEqual(host, "localhost")
        self.assertEqual(port, 9876)

        with mock.patch("shutil.which", side_effect=lambda name: "/usr/local/bin/uvx" if name == "uvx" else None):
            cmd, args, mode = blender_bridge.build_mcp_command(repo_dir, pkg, ["--host", host, "--port", str(port)])
        self.assertEqual(mode, "uvx")
        self.assertEqual(cmd, "/usr/local/bin/uvx")
        self.assertEqual(args, ["mcp-for-blender", "--host", "localhost", "--port", "9876"])

        with mock.patch("shutil.which", side_effect=lambda name: "/usr/local/bin/uv" if name == "uv" else None):
            cmd, args, mode = blender_bridge.build_mcp_command(repo_dir, pkg, ["addon-paths"])
        self.assertEqual(mode, "uvx")
        self.assertEqual(cmd, "/usr/local/bin/uv")
        self.assertEqual(args, ["tool", "run", "mcp-for-blender", "addon-paths"])

    def test_local_repo_mode_command(self) -> None:
        fake_repo = self.tmp / "mcp-for-blender"
        fake_repo.mkdir()
        (fake_repo / "pyproject.toml").write_text('[project]\nname = "mcp-for-blender"\n', encoding="utf-8")

        with mock.patch("shutil.which", side_effect=lambda name: "/usr/local/bin/uv" if name == "uv" else None):
            cmd, args, mode = blender_bridge.build_mcp_command(fake_repo, "mcp-for-blender", ["--host", "127.0.0.1"])
        self.assertEqual(mode, "local_repo")
        self.assertEqual(cmd, "/usr/local/bin/uv")
        self.assertEqual(args, ["run", "--directory", str(fake_repo), "mcp-for-blender", "--host", "127.0.0.1"])

    def test_serialize_tool_result_saves_images_to_active_project_previews(self) -> None:
        ws_root = self.tmp / "out"
        proj = workspace.init_project_dir("测试渲染", user_specified_dir=str(ws_root))
        cfg = workspace.read_config()
        media_dir = blender_bridge.default_media_dir(cfg)
        self.assertEqual(media_dir, Path(proj["previews_dir"]).resolve())

        png_bytes = b"\x89PNG\r\n\x1a\nfake"
        b64 = base64.b64encode(png_bytes).decode("ascii")
        fake_result = SimpleNamespace(
            isError=False,
            structuredContent=None,
            content=[
                SimpleNamespace(data=b64, mimeType="image/png"),
                SimpleNamespace(text='{"ok": true, "mode": "viewport"}'),
            ],
        )
        out = blender_bridge.serialize_tool_result("look", fake_result, media_dir)
        self.assertFalse(out["isError"])
        self.assertEqual(len(out["saved_images"]), 1)
        saved = Path(out["saved_images"][0])
        self.assertTrue(saved.is_file())
        self.assertEqual(saved.parent, media_dir)
        self.assertEqual(saved.read_bytes(), png_bytes)
        self.assertEqual(out["content"][1], {"ok": True, "mode": "viewport"})

    def test_local_guides_listing_and_reading(self) -> None:
        fake_repo = self.tmp / "repo"
        guides_dir = fake_repo / "src" / "blender_mcp" / "guides"
        guides_dir.mkdir(parents=True)
        (guides_dir / "bpy.md").write_text(
            "---\ntitle: BPY Guide\nsummary: Safe bpy patterns\n---\n\n# Body\nHello\n",
            encoding="utf-8",
        )
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = blender_bridge.cmd_guides(fake_repo, "mcp-for-blender")
        self.assertEqual(rc, 0)
        parsed = json.loads(buf.getvalue())
        self.assertEqual(parsed["count"], 1)
        self.assertEqual(parsed["guides"][0]["topic"], "bpy")

        buf2 = io.StringIO()
        with contextlib.redirect_stdout(buf2):
            rc2 = blender_bridge.cmd_guides(fake_repo, "mcp-for-blender", "bpy")
        self.assertEqual(rc2, 0)
        self.assertIn("Hello", buf2.getvalue())

    def test_scene_info_and_look_arg_builders_match_mcp_schema(self) -> None:
        parser = blender_bridge.build_parser()

        scene_ns = parser.parse_args([
            "scene-info",
            "--query",
            "Cube",
            "--root",
            "SceneRoot",
            "--fields",
            "location,size,topology",
            "--limit",
            "10",
            "--prompt",
            "inspect cube",
        ])
        scene_args = blender_bridge.build_scene_info_args(scene_ns)
        self.assertEqual(
            scene_args,
            {
                "query": "Cube",
                "root": "SceneRoot",
                "fields": ["location", "size", "topology"],
                "limit": 10,
                "user_prompt": "inspect cube",
            },
        )

        look_ns = parser.parse_args([
            "look",
            "--mode",
            "angles",
            "--shading",
            "solid",
            "--target",
            "Cube,Light",
            "--views",
            '["front", [0, -1, 0.2]]',
            "--view",
            "[0, -1, 0.2]",
            "--frames",
            "1, 12, 24",
            "--max-size",
            "640",
        ])
        look_args = blender_bridge.build_look_args(look_ns)
        self.assertEqual(look_args["mode"], "angles")
        self.assertEqual(look_args["shading"], "solid")
        self.assertEqual(look_args["target"], ["Cube", "Light"])
        self.assertEqual(look_args["views"], ["front", [0, -1, 0.2]])
        self.assertEqual(look_args["view"], [0, -1, 0.2])
        self.assertEqual(look_args["frames"], [1, 12, 24])
        self.assertEqual(look_args["max_size"], 640)


if __name__ == "__main__":
    unittest.main()
