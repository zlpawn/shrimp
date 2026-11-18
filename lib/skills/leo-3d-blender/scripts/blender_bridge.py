#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=1.26.0,<2",
# ]
# ///
"""Headless MCP Bridge for leo-3d-blender -> mcp-for-blender (stdio).

Decouples 3D workflow orchestration (leo-3d-blender) from the underlying
mcp-for-blender stdio MCP server via a single-file uv CLI:

1. Server & Blender Status:  `blender_bridge.py status [--probe-mcp]`
2. Dynamic Tool Discovery:   `blender_bridge.py tools [--format json|markdown]`
3. Generic Tool Invocation:  `blender_bridge.py call <tool_name> ['<json>'] [--save-media-dir <dir>]`
4. Execute bpy Code:         `blender_bridge.py exec (--code <py> | --file <path>)`
5. Visual Viewport Look:     `blender_bridge.py look [--mode viewport|camera|angles|frames] [--shading rendered|solid|material|wireframe|xray]`
6. Scene Inspection:         `blender_bridge.py scene-info`
7. MCP Resources:            `blender_bridge.py resources` / `read-resource <uri>`
8. Local Craft Guides:       `blender_bridge.py guides [topic]`
9. Addon Management:         `blender_bridge.py install-addon` / `addon-paths`

Exit codes: 0 ok, 1 execution/MCP error, 2 connection/setup error, 3 config error.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import mimetypes
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

from workspace import (  # noqa: E402
    ConfigError,
    DEFAULT_BLENDER_HOST,
    DEFAULT_BLENDER_PORT,
    DEFAULT_MCP_PACKAGE,
    get_skill_home,
    read_config,
)

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False


def resolve_runtime_settings(
    cli_repo: str | None = None,
    cli_host: str | None = None,
    cli_port: int | None = None,
) -> tuple[Path | None, str, str, int, dict[str, Any]]:
    """Resolve optional local repo, PyPI package, and Blender host/port: CLI -> Env -> Config -> Default."""
    cfg = read_config()
    raw_repo = str(cli_repo or os.environ.get("BLENDER_MCP_REPO") or cfg.get("mcp_repo_dir") or "").strip()
    repo_dir = Path(raw_repo).expanduser().resolve() if raw_repo else None

    package = str(os.environ.get("BLENDER_MCP_PACKAGE") or cfg.get("mcp_package") or DEFAULT_MCP_PACKAGE).strip()
    host = str(cli_host or os.environ.get("BLENDER_HOST") or cfg.get("blender_host") or DEFAULT_BLENDER_HOST).strip()

    raw_port = cli_port if cli_port is not None else os.environ.get("BLENDER_PORT") or cfg.get("blender_port") or DEFAULT_BLENDER_PORT
    try:
        port = int(raw_port)
    except (TypeError, ValueError):
        port = DEFAULT_BLENDER_PORT

    return repo_dir, package, host, port, cfg


def build_mcp_command(
    repo_dir: Path | None,
    package: str,
    extra_args: list[str],
) -> tuple[str, list[str], str]:
    """Build command + args to launch mcp-for-blender via local repo or zero-repo uvx mode."""
    if repo_dir is not None:
        if not (repo_dir / "pyproject.toml").is_file():
            raise FileNotFoundError(
                f"已指定的 mcp-for-blender 本地仓库无效或不存在: {repo_dir}（可用 workspace.py clear-repo 切回默认 uvx 模式）"
            )
        uv_bin = shutil.which("uv")
        if not uv_bin:
            raise RuntimeError("未找到 `uv` 命令，请先安装 uv (https://docs.astral.sh/uv/)")
        return uv_bin, ["run", "--directory", str(repo_dir), "mcp-for-blender", *extra_args], "local_repo"

    uvx_bin = shutil.which("uvx")
    if uvx_bin:
        return uvx_bin, [package, *extra_args], "uvx"

    uv_bin = shutil.which("uv")
    if uv_bin:
        return uv_bin, ["tool", "run", package, *extra_args], "uvx"

    raise RuntimeError("未找到 `uvx` 或 `uv` 命令，请先安装 uv (https://docs.astral.sh/uv/)")


def default_media_dir(cfg: dict[str, Any], override_dir: str | None = None) -> Path:
    """Resolve directory for saved screenshots from `look` or image-returning tools."""
    if override_dir and override_dir.strip():
        return Path(override_dir).expanduser().resolve()

    active_project = str(cfg.get("active_project") or "").strip()
    if active_project:
        previews_dir = Path(active_project).expanduser().resolve() / "预览"
        if previews_dir.parent.exists():
            return previews_dir

    return get_skill_home() / "review_cache"


def _ext_for_mime(mime_type: str | None) -> str:
    if not mime_type:
        return ".png"
    m = mime_type.lower()
    if "png" in m:
        return ".png"
    if "jpeg" in m or "jpg" in m:
        return ".jpg"
    if "webp" in m:
        return ".webp"
    return mimetypes.guess_extension(m) or ".bin"


def save_binary_block(
    raw_data: str | bytes,
    mime_type: str | None,
    tool_name: str,
    index: int,
    target_dir: Path,
    stamp: int,
) -> Path:
    """Decode base64/bytes MCP image content block to disk so multimodal Agents can inspect it."""
    target_dir.mkdir(parents=True, exist_ok=True)
    ext = _ext_for_mime(mime_type)
    out_path = target_dir / f"{tool_name}_{stamp}_{index}{ext}"
    payload = raw_data if isinstance(raw_data, bytes) else base64.b64decode(raw_data)
    out_path.write_bytes(payload)
    return out_path.resolve()


def serialize_tool_result(
    tool_name: str,
    res: Any,
    media_dir: Path,
) -> dict[str, Any]:
    """Convert MCP CallToolResult to JSON-friendly dict and persist returned images to disk."""
    output: dict[str, Any] = {
        "tool": tool_name,
        "isError": bool(getattr(res, "isError", False)),
        "content": [],
        "saved_images": [],
    }
    if getattr(res, "structuredContent", None) is not None:
        output["structuredContent"] = res.structuredContent

    img_idx = 0
    stamp = int(time.time() * 1000)
    for item in getattr(res, "content", []) or []:
        text = getattr(item, "text", None)
        if text is not None:
            try:
                output["content"].append(json.loads(text))
            except Exception:
                output["content"].append(text)
            continue

        data = getattr(item, "data", None)
        if data is not None:
            img_idx += 1
            mime = getattr(item, "mimeType", None) or "image/png"
            saved_path = save_binary_block(data, mime, tool_name, img_idx, media_dir, stamp)
            output["content"].append({
                "type": "saved_image",
                "index": img_idx,
                "mime_type": mime,
                "path": str(saved_path),
            })
            output["saved_images"].append(str(saved_path))
            continue

        if hasattr(item, "model_dump"):
            output["content"].append(item.model_dump(mode="json", exclude_none=True))
        else:
            output["content"].append(str(item))

    return output


def probe_blender_socket(host: str, port: int, timeout: float = 1.5) -> dict[str, Any]:
    """Lightweight TCP check to see if the Blender addon socket is listening."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"online": True, "host": host, "port": port, "error": None}
    except OSError as e:
        return {"online": False, "host": host, "port": port, "error": str(e)}


def _read_tail(file_obj: Any, max_lines: int = 25) -> str:
    try:
        file_obj.flush()
        file_obj.seek(0)
        lines = file_obj.read().splitlines()
        return "\n".join(lines[-max_lines:])
    except Exception:
        return ""


@asynccontextmanager
async def open_mcp_session(
    repo_dir: Path | None,
    package: str,
    host: str,
    port: int,
    verbose: bool = False,
) -> AsyncIterator[tuple[ClientSession, Any]]:
    """Spawn mcp-for-blender over stdio (uvx or local repo) and yield ClientSession + InitializeResult."""
    if not MCP_AVAILABLE:
        raise RuntimeError("缺少 mcp Python SDK，请通过 `uv run blender_bridge.py ...` 执行")

    cmd, args, _ = build_mcp_command(repo_dir, package, ["--host", host, "--port", str(port)])

    env = os.environ.copy()
    env["BLENDER_HOST"] = host
    env["BLENDER_PORT"] = str(port)
    env.setdefault("PYTHONIOENCODING", "utf-8")

    server_params = StdioServerParameters(
        command=cmd,
        args=args,
        env=env,
    )

    if verbose:
        async with stdio_client(server_params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                init_res = await session.initialize()
                yield session, init_res
        return

    with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as err_fh:
        try:
            async with stdio_client(server_params, errlog=err_fh) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    init_res = await session.initialize()
                    yield session, init_res
        except Exception as exc:
            stderr_tail = _read_tail(err_fh)
            if stderr_tail:
                raise RuntimeError(f"{exc}\n--- server stderr ---\n{stderr_tail}") from exc
            raise


async def cmd_status(
    repo_dir: Path | None,
    package: str,
    host: str,
    port: int,
    cfg: dict[str, Any],
    probe_mcp: bool = False,
    verbose: bool = False,
) -> int:
    try:
        cmd, cmd_args, mode = build_mcp_command(repo_dir, package, ["--host", host, "--port", str(port)])
        runtime_ok = True
        runtime_error = None
    except Exception as e:
        cmd, cmd_args, mode = "", [], "local_repo" if repo_dir else "uvx"
        runtime_ok = False
        runtime_error = str(e)

    sock = probe_blender_socket(host, port)

    payload: dict[str, Any] = {
        "mcp_mode": mode,
        "mcp_package": package,
        "repo_dir": str(repo_dir) if repo_dir else None,
        "mcp_launch_command": [cmd, *cmd_args] if runtime_ok else None,
        "runtime_ready": runtime_ok,
        "runtime_error": runtime_error,
        "blender_host": host,
        "blender_port": port,
        "blender_socket_online": sock["online"],
        "blender_socket_error": sock["error"],
        "active_project": cfg.get("active_project") or None,
        "workspace_dir": cfg.get("workspace_dir") or None,
        "addon_status": None,
        "mcp_tools_count": None,
    }

    if not runtime_ok:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 2

    if sock["online"] or probe_mcp:
        try:
            async with open_mcp_session(repo_dir, package, host, port, verbose=verbose) as (session, init_res):
                tools_res = await session.list_tools()
                payload["mcp_tools_count"] = len(tools_res.tools)
                server_info = getattr(init_res, "serverInfo", None)
                if server_info:
                    payload["server_info"] = {
                        "name": getattr(server_info, "name", None),
                        "version": getattr(server_info, "version", None),
                    }
                if sock["online"]:
                    res = await session.call_tool("get_addon_status", {})
                    payload["addon_status"] = serialize_tool_result(
                        "get_addon_status", res, default_media_dir(cfg)
                    )
        except Exception as e:
            payload["mcp_error"] = str(e)
            print(json.dumps(payload, ensure_ascii=False, indent=2))
            return 2

    if not sock["online"]:
        payload["hint"] = (
            "Blender 插件端口未监听。请打开 Blender → 右侧边栏 (N 键) → MCP for Blender → "
            "点击 Connect to MCP server；若未安装插件可先运行 `blender_bridge.py install-addon`。"
        )

    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


async def cmd_tools(
    repo_dir: Path | None,
    package: str,
    host: str,
    port: int,
    format_mode: str = "json",
    with_instructions: bool = False,
    verbose: bool = False,
) -> int:
    try:
        async with open_mcp_session(repo_dir, package, host, port, verbose=verbose) as (session, init_res):
            tools_res = await session.list_tools()
            tools_data = [
                {
                    "name": t.name,
                    "description": t.description,
                    "inputSchema": t.inputSchema,
                }
                for t in tools_res.tools
            ]
            instructions = getattr(init_res, "instructions", None) if with_instructions else None

            if format_mode == "markdown":
                print(f"# mcp-for-blender 可用工具清单 (共 {len(tools_data)} 个)\n")
                if instructions:
                    print(f"## Server Instructions\n\n```text\n{instructions}\n```\n")
                for t in tools_data:
                    print(f"### `{t['name']}`")
                    print(f"{t['description'] or ''}\n")
                    schema = t.get("inputSchema") or {}
                    props = schema.get("properties", {})
                    required = set(schema.get("required", []))
                    if props:
                        print("| 参数名 | 类型 | 必填 | 说明 |")
                        print("|---|---|---|---|")
                        for k, v in props.items():
                            req_str = "✅ 是" if k in required else "否"
                            p_type = v.get("type") or (" | ".join(str(x.get("type")) for x in v.get("anyOf", [])) if "anyOf" in v else "any")
                            p_desc = str(v.get("description", "-")).replace("\n", " ")
                            print(f"| `{k}` | `{p_type}` | {req_str} | {p_desc} |")
                        print()
            else:
                out: dict[str, Any] = {"count": len(tools_data), "tools": tools_data}
                if instructions:
                    out["instructions"] = instructions
                print(json.dumps(out, ensure_ascii=False, indent=2))
            return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"获取工具列表失败: {e}"}, ensure_ascii=False), file=sys.stderr)
        return 2


async def cmd_call(
    repo_dir: Path | None,
    package: str,
    host: str,
    port: int,
    cfg: dict[str, Any],
    tool_name: str,
    arguments: dict[str, Any],
    save_media_dir: str | None = None,
    verbose: bool = False,
) -> int:
    media_dir = default_media_dir(cfg, save_media_dir)
    try:
        async with open_mcp_session(repo_dir, package, host, port, verbose=verbose) as (session, _):
            res = await session.call_tool(tool_name, arguments)
            output = serialize_tool_result(tool_name, res, media_dir=media_dir)
            print(json.dumps(output, ensure_ascii=False, indent=2))
            return 1 if output["isError"] else 0
    except Exception as e:
        print(json.dumps({"tool": tool_name, "isError": True, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


async def cmd_resources(
    repo_dir: Path | None,
    package: str,
    host: str,
    port: int,
    verbose: bool = False,
) -> int:
    try:
        async with open_mcp_session(repo_dir, package, host, port, verbose=verbose) as (session, _):
            res = await session.list_resources()
            tpl = await session.list_resource_templates()
            out = {
                "resources": [r.model_dump(mode="json", exclude_none=True) for r in res.resources],
                "resourceTemplates": [t.model_dump(mode="json", exclude_none=True) for t in tpl.resourceTemplates],
            }
            print(json.dumps(out, ensure_ascii=False, indent=2))
            return 0
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"获取资源列表失败: {e}"}, ensure_ascii=False), file=sys.stderr)
        return 2


async def cmd_read_resource(
    repo_dir: Path | None,
    package: str,
    host: str,
    port: int,
    uri: str,
    verbose: bool = False,
) -> int:
    try:
        async with open_mcp_session(repo_dir, package, host, port, verbose=verbose) as (session, _):
            res = await session.read_resource(uri)
            contents = []
            for c in getattr(res, "contents", []) or []:
                text = getattr(c, "text", None)
                if text is not None:
                    try:
                        contents.append(json.loads(text))
                    except Exception:
                        contents.append(text)
                else:
                    contents.append(c.model_dump(mode="json", exclude_none=True) if hasattr(c, "model_dump") else str(c))
            print(json.dumps({"uri": uri, "contents": contents}, ensure_ascii=False, indent=2))
            return 0
    except Exception as e:
        print(json.dumps({"uri": uri, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


def _guides_from_package(package: str, topic: str | None = None) -> int:
    uv_bin = shutil.which("uv")
    if not uv_bin:
        print(json.dumps({"ok": False, "error": "未找到 `uv` 命令"}, ensure_ascii=False), file=sys.stderr)
        return 2

    if not topic:
        py = (
            "import json; from blender_mcp import guides; "
            "items = [{'topic': k, 'title': g.title, 'summary': g.summary} "
            "for k, g in guides.all_guides().items()]; "
            "print(json.dumps({'count': len(items), 'guides': items}, ensure_ascii=False, indent=2))"
        )
        proc = subprocess.run([uv_bin, "run", "--with", package, "--no-project", "python", "-c", py], check=False)
        return proc.returncode

    clean = topic.strip().lower().removesuffix(".md")
    py = (
        "import json, sys; from blender_mcp import guides\n"
        "t = sys.argv[1]; gs = guides.all_guides(); g = gs.get(t)\n"
        "if g is not None:\n"
        "    print(g.body)\n"
        "    sys.exit(0)\n"
        "print(json.dumps({'ok': False, 'error': f'未找到指南 {t!r}', 'available': list(gs.keys())}, ensure_ascii=False), file=sys.stderr)\n"
        "sys.exit(1)\n"
    )
    proc = subprocess.run([uv_bin, "run", "--with", package, "--no-project", "python", "-c", py, clean], check=False)
    return proc.returncode


def cmd_guides(repo_dir: Path | None, package: str, topic: str | None = None) -> int:
    if repo_dir is None:
        return _guides_from_package(package, topic)

    guides_dir = repo_dir / "src" / "blender_mcp" / "guides"
    if not guides_dir.is_dir():
        print(json.dumps({"ok": False, "error": f"未找到 guides 目录: {guides_dir}"}, ensure_ascii=False), file=sys.stderr)
        return 2

    files = sorted(guides_dir.glob("*.md"))
    if not topic:
        items = []
        for f in files:
            text = f.read_text(encoding="utf-8", errors="replace")
            title, summary = f.stem, ""
            if text.startswith("---\n"):
                header, _, _ = text[4:].partition("\n---\n")
                for line in header.splitlines():
                    k, _, v = line.partition(":")
                    if k.strip() == "title":
                        title = v.strip()
                    elif k.strip() == "summary":
                        summary = v.strip()
            items.append({"topic": f.stem, "title": title, "summary": summary, "path": str(f)})
        print(json.dumps({"count": len(items), "guides": items}, ensure_ascii=False, indent=2))
        return 0

    clean = topic.strip().lower().removesuffix(".md")
    target = guides_dir / f"{clean}.md"
    if not target.is_file():
        available = [f.stem for f in files]
        print(json.dumps({
            "ok": False,
            "error": f"未找到指南 {topic!r}",
            "available": available,
        }, ensure_ascii=False), file=sys.stderr)
        return 1

    print(target.read_text(encoding="utf-8"))
    return 0


def cmd_addon_subcommand(
    repo_dir: Path | None,
    package: str,
    subcmd: str,
    extra_args: list[str] | None = None,
) -> int:
    try:
        cmd, args, _ = build_mcp_command(repo_dir, package, [subcmd, *(extra_args or [])])
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2

    proc = subprocess.run([cmd, *args], check=False)
    return proc.returncode


def _parse_json_arg(raw: str | None) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("JSON 参数必须是对象 ({...})")
    return parsed


def _parse_comma_list(raw: str | None) -> list[str] | None:
    if not raw or not raw.strip():
        return None
    items = [x.strip() for x in raw.split(",") if x.strip()]
    return items or None


def _parse_views_arg(raw: str | None) -> list[Any] | None:
    if not raw or not raw.strip():
        return None
    stripped = raw.strip()
    if stripped.startswith("["):
        parsed = json.loads(stripped)
        if not isinstance(parsed, list):
            raise ValueError("--views JSON 必须是数组")
        return parsed
    return _parse_comma_list(stripped)


def _parse_single_view_arg(raw: str | None) -> Any:
    if not raw or not raw.strip():
        return None
    stripped = raw.strip()
    if stripped.startswith("["):
        parsed = json.loads(stripped)
        if not isinstance(parsed, list):
            raise ValueError("--view JSON 必须是 [x, y, z] 数组")
        return parsed
    return stripped


def build_look_args(args: argparse.Namespace) -> dict[str, Any]:
    tool_args: dict[str, Any] = {"max_size": args.max_size}
    if args.mode is not None:
        tool_args["mode"] = args.mode
    if args.shading is not None:
        tool_args["shading"] = args.shading
    target_list = _parse_comma_list(args.target)
    if target_list is not None:
        tool_args["target"] = target_list
    views_list = _parse_views_arg(args.views)
    if views_list is not None:
        tool_args["views"] = views_list
    if args.distance is not None:
        tool_args["distance"] = args.distance
    if args.frames is not None:
        tool_args["frames"] = [int(x.strip()) for x in args.frames.split(",") if x.strip()]
    if args.frame_count != 6:
        tool_args["frame_count"] = args.frame_count
    view_val = _parse_single_view_arg(args.view)
    if view_val is not None:
        tool_args["view"] = view_val
    if args.image is not None:
        tool_args["image"] = args.image
    if args.prompt:
        tool_args["user_prompt"] = args.prompt
    return tool_args


def build_scene_info_args(args: argparse.Namespace) -> dict[str, Any]:
    tool_args: dict[str, Any] = {}
    if args.query is not None:
        tool_args["query"] = args.query
    if args.root is not None:
        tool_args["root"] = args.root
    fields_list = _parse_comma_list(args.fields)
    if fields_list is not None:
        tool_args["fields"] = fields_list
    if args.limit is not None:
        tool_args["limit"] = args.limit
    if args.prompt:
        tool_args["user_prompt"] = args.prompt
    return tool_args


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="leo-3d-blender headless MCP bridge for mcp-for-blender (stdio)"
    )
    parser.add_argument("--repo", default=None, help="Path to local mcp-for-blender repository")
    parser.add_argument("--host", default=None, help="Blender addon host override")
    parser.add_argument("--port", type=int, default=None, help="Blender addon port override")
    parser.add_argument("--verbose", action="store_true", help="Stream MCP server stderr directly")

    sub = parser.add_subparsers(dest="subcommand", help="Bridge action")

    p_status = sub.add_parser("status", help="Check mcp-for-blender repo, Blender socket, and addon status")
    p_status.add_argument("--probe-mcp", action="store_true", help="Launch MCP server even when Blender socket is offline")

    p_tools = sub.add_parser("tools", help="List available MCP tools dynamically")
    p_tools.add_argument("--format", choices=["json", "markdown"], default="json", help="Output format")
    p_tools.add_argument("--with-instructions", action="store_true", help="Include MCP server instructions")

    p_call = sub.add_parser("call", help="Call any MCP tool by name")
    p_call.add_argument("tool_name", help="Exact MCP tool name")
    p_call.add_argument("args_json", nargs="?", default="{}", help="Tool arguments as JSON object string")
    p_call.add_argument("--save-media-dir", default=None, help="Directory to save returned images")

    p_exec = sub.add_parser("exec", help="Execute Python code inside live Blender (execute_blender_code)")
    exec_src = p_exec.add_mutually_exclusive_group(required=True)
    exec_src.add_argument("--code", help="Inline Python code string (or '-' for stdin)")
    exec_src.add_argument("--file", help="Path to a .py file to execute in Blender")
    p_exec.add_argument("--prompt", default="", help="Verbatim user goal for trajectory context")

    p_look = sub.add_parser("look", help="Capture Blender viewport/camera/multi-angle image and save locally")
    p_look.add_argument("--mode", choices=["viewport", "camera", "angles", "frames"], default=None)
    p_look.add_argument("--shading", choices=["rendered", "material", "solid", "wireframe", "xray"], default=None)
    p_look.add_argument("--target", default=None, help="Comma-separated object names to frame")
    p_look.add_argument("--views", default=None, help="Comma-separated views for angles mode (e.g. front,right,top,three_quarter)")
    p_look.add_argument("--distance", type=float, default=None, help="Camera distance in metres for angles/frames")
    p_look.add_argument("--frames", default=None, help="Comma-separated frame numbers for frames mode")
    p_look.add_argument("--frame-count", type=int, default=6, help="Number of sampled frames (2-12)")
    p_look.add_argument("--view", default=None, help="View name or 'camera' for frames mode")
    p_look.add_argument("--image", default=None, help="Show an image datablock or file path instead of 3D scene")
    p_look.add_argument("--max-size", type=int, default=768, help="Longest side in pixels (200-2000)")
    p_look.add_argument("--save-media-dir", default=None, help="Directory to save the captured PNG")
    p_look.add_argument("--prompt", default="", help="Verbatim user goal")

    p_scene = sub.add_parser("scene-info", help="Inspect current Blender scene objects, topology, placement, settings")
    p_scene.add_argument("--query", default=None, help="Filter objects whose name contains this text")
    p_scene.add_argument("--root", default=None, help="Object whose hierarchy to list")
    p_scene.add_argument(
        "--fields",
        default=None,
        help="Comma-separated fields (location,size,ground,rotation,scale,parent,children,hidden,details,materials,modifiers,animation,topology,weights,settings)",
    )
    p_scene.add_argument("--limit", type=int, default=None, help="Maximum object lines (server default: 20)")
    p_scene.add_argument("--prompt", default="", help="Verbatim user goal")

    sub.add_parser("resources", help="List MCP resources and templates")

    p_rres = sub.add_parser("read-resource", help="Read an MCP resource URI (e.g. blender://object/Cube)")
    p_rres.add_argument("uri", help="Resource URI")

    p_guides = sub.add_parser("guides", help="List or read built-in Blender craft guides from local repo")
    p_guides.add_argument("topic", nargs="?", default=None, help="Guide topic (e.g. bpy, materials, rigging, scene)")

    sub.add_parser("install-addon", help="Install bundled addon.py into local Blender addons directory")
    sub.add_parser("addon-paths", help="Show detected Blender addon paths")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args, extra = parser.parse_known_args(argv)
    if not args.subcommand:
        parser.print_help()
        return 0

    try:
        repo_dir, package, host, port, cfg = resolve_runtime_settings(args.repo, args.host, args.port)
    except ConfigError as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 3

    if args.subcommand == "guides":
        return cmd_guides(repo_dir, package, args.topic)

    if args.subcommand in ("install-addon", "addon-paths"):
        return cmd_addon_subcommand(repo_dir, package, args.subcommand, extra)

    if extra:
        parser.error(f"未识别的参数: {' '.join(extra)}")

    if args.subcommand == "status":
        return asyncio.run(cmd_status(repo_dir, package, host, port, cfg, probe_mcp=args.probe_mcp, verbose=args.verbose))

    if args.subcommand == "tools":
        return asyncio.run(
            cmd_tools(repo_dir, package, host, port, format_mode=args.format, with_instructions=args.with_instructions, verbose=args.verbose)
        )

    if args.subcommand == "call":
        try:
            tool_args = _parse_json_arg(args.args_json)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"JSON 解析失败: {e}"}, ensure_ascii=False), file=sys.stderr)
            return 1
        return asyncio.run(
            cmd_call(repo_dir, package, host, port, cfg, args.tool_name, tool_args, save_media_dir=args.save_media_dir, verbose=args.verbose)
        )

    if args.subcommand == "exec":
        if args.file:
            py_path = Path(args.file).expanduser().resolve()
            if not py_path.is_file():
                print(json.dumps({"ok": False, "error": f"脚本文件不存在: {py_path}"}, ensure_ascii=False), file=sys.stderr)
                return 1
            code = py_path.read_text(encoding="utf-8")
        elif args.code == "-":
            code = sys.stdin.read()
        else:
            code = args.code

        tool_args: dict[str, Any] = {"code": code}
        if args.prompt:
            tool_args["user_prompt"] = args.prompt
        return asyncio.run(cmd_call(repo_dir, package, host, port, cfg, "execute_blender_code", tool_args, verbose=args.verbose))

    if args.subcommand == "look":
        try:
            tool_args = build_look_args(args)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"look 参数解析失败: {e}"}, ensure_ascii=False), file=sys.stderr)
            return 1
        return asyncio.run(
            cmd_call(repo_dir, package, host, port, cfg, "look", tool_args, save_media_dir=args.save_media_dir, verbose=args.verbose)
        )

    if args.subcommand == "scene-info":
        tool_args = build_scene_info_args(args)
        return asyncio.run(cmd_call(repo_dir, package, host, port, cfg, "get_scene_info", tool_args, verbose=args.verbose))

    if args.subcommand == "resources":
        return asyncio.run(cmd_resources(repo_dir, package, host, port, verbose=args.verbose))

    if args.subcommand == "read-resource":
        return asyncio.run(cmd_read_resource(repo_dir, package, host, port, args.uri, verbose=args.verbose))

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
