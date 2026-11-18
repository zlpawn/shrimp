#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "mcp>=1.2.0",
#     "httpx>=0.27.0",
#     "socksio>=1.0.0",
# ]
# ///
"""ArcReel Headless MCP & BYO-Media Bridge for leo-video-router and external Agents.

Decouples narrative/storyboard/JianYing orchestration (ArcReel) from underlying
image & video generation skills (e.g. leo-codex-imagine, leo-autodl-imagine-video,
leo-apimart-video, or any future image/video skill) via standard file contracts:

1. Dynamic Tool Discovery: `arcreel_bridge.py tools`
2. Dynamic Tool Calling (auto-saves inspect_images / inspect_video_units images!):
   `arcreel_bridge.py call <tool_name> ['<json>'] [--save-media-dir <dir>]`
3. Server Health Check:    `arcreel_bridge.py status`
4. BYO-Media Uploads (inject external skill outputs into ArcReel with 0 API cost):
   - `upload-asset`      -> character / scene / prop / product / bgm / source
   - `upload-derivative` -> @[角色/衍生] outfit/variant sheet
   - `upload-grid`       -> 4/6/9-panel composite storyboard grid (ready for `split_grids`)
   - `upload-shot`       -> per-shot `storyboard` | `end-frame` | `video` | `ref-video-unit`
5. Macro Orchestration:    `arcreel_bridge.py run --novel <file> [--stage plan|storyboard|video|export|all]`

Exit codes: 0 ok, 1 execution/MCP/API error, 2 connection/auth error.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import mimetypes
import os
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.types import CallToolResult

    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

DEFAULT_MCP_URL = "http://localhost:1241/mcp"


def _router_home() -> Path:
    override = os.environ.get("LEO_VIDEO_ROUTER_HOME")
    if override:
        return Path(override)
    return Path.home() / ".shrimp" / "skills" / "leo-video-router"


def default_config_path() -> Path:
    return Path(os.environ.get("LEO_VIDEO_CONFIG_PATH", _router_home() / "config.json"))


def default_token_file() -> Path:
    return _router_home() / "arcreel_token"


def default_review_dir() -> Path:
    return _router_home() / "review_cache"


def read_token_from_file(token_file: Path | None = None) -> str | None:
    """Read ArcReel API Token from ~/.shrimp/skills/leo-video-router/arcreel_token."""
    f = token_file or default_token_file()
    if f.exists() and f.is_file():
        try:
            token = f.read_text(encoding="utf-8").strip()
            if token:
                return token
        except Exception:
            pass
    return None


def save_token_to_file(token: str, target_file: Path | None = None) -> Path:
    """Save ArcReel API Token to ~/.shrimp/skills/leo-video-router/arcreel_token."""
    f = target_file or default_token_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(token.strip() + "\n", encoding="utf-8")
    try:
        os.chmod(f, 0o600)
    except OSError:
        pass
    return f


def get_config() -> dict[str, Any]:
    """Read router config or fallback."""
    cfg_path = default_config_path()
    if cfg_path.exists():
        try:
            return json.loads(cfg_path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def resolve_auth_and_url(cli_url: str | None = None, cli_key: str | None = None) -> tuple[str, str | None]:
    """Resolve ArcReel MCP URL and API key from CLI -> Token File -> Env -> Config."""
    cfg = get_config()
    url = cli_url or os.environ.get("ARCREEL_MCP_URL") or cfg.get("arcreel_mcp_url") or DEFAULT_MCP_URL
    api_key = cli_key or read_token_from_file() or os.environ.get("ARCREEL_API_KEY") or cfg.get("arcreel_api_key")
    return url, api_key


def derive_base_url(mcp_url: str) -> str:
    """Strip trailing /mcp from MCP endpoint URL to obtain REST API base URL."""
    base = mcp_url.strip().rstrip("/")
    if base.endswith("/mcp"):
        base = base[:-4]
    return base.rstrip("/")


def _ext_for_mime(mime_type: str | None) -> str:
    if not mime_type:
        return ".jpg"
    m = mime_type.lower()
    if "png" in m:
        return ".png"
    if "webp" in m:
        return ".webp"
    if "jpeg" in m or "jpg" in m:
        return ".jpg"
    guessed = mimetypes.guess_extension(m)
    return guessed or ".bin"


def save_mcp_binary_block(
    raw_data: str | bytes,
    mime_type: str | None,
    tool_name: str,
    index: int,
    save_dir: Path | None = None,
) -> Path:
    """Decode base64/bytes MCP image or binary content block to disk so multimodal Agents can inspect it."""
    target_dir = save_dir or (default_review_dir() / f"{tool_name}_{int(time.time() * 1000)}")
    target_dir.mkdir(parents=True, exist_ok=True)
    ext = _ext_for_mime(mime_type)
    out_path = target_dir / f"{tool_name}_{index}{ext}"
    if isinstance(raw_data, bytes):
        payload = raw_data
    else:
        payload = base64.b64decode(raw_data)
    out_path.write_bytes(payload)
    return out_path.resolve()


async def check_server_status(url: str, api_key: str | None) -> dict[str, Any]:
    """Check connectivity to ArcReel server."""
    base_url = derive_base_url(url)
    tf = default_token_file()
    result: dict[str, Any] = {
        "mcp_url": url,
        "base_url": base_url,
        "api_key_configured": bool(api_key),
        "token_file": str(tf),
        "token_file_exists": tf.exists(),
        "online": False,
        "system_status": None,
        "error": None,
    }
    async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
        try:
            headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
            for ver_path in ("/api/v1/system/version", "/api/system/version"):
                resp = await client.get(f"{base_url}{ver_path}", headers=headers)
                if resp.status_code == 200:
                    result["online"] = True
                    result["system_status"] = resp.json()
                    return result
                if resp.status_code in (401, 403):
                    result["online"] = True
                    result["error"] = "Authentication failed (API Key required or invalid)"
                    return result
            resp_root = await client.get(f"{base_url}/")
            result["online"] = resp_root.status_code < 500
        except Exception as e:
            result["error"] = f"Connection failed: {e}"
    return result


async def upload_multipart(
    mcp_url: str,
    api_key: str | None,
    endpoint_path: str,
    file_path: Path,
    query_params: dict[str, str] | None = None,
) -> tuple[int, dict[str, Any]]:
    """Upload a local image/video/audio file to an ArcReel REST /api/v1/... upload route."""
    if not file_path.exists() or not file_path.is_file():
        return 1, {"ok": False, "error": f"本地文件不存在: {file_path}"}
    if not api_key:
        return 2, {"ok": False, "error": "缺少 ArcReel API Key（请先执行 set-token arc-xxxx）"}

    base_url = derive_base_url(mcp_url)
    full_url = f"{base_url}{endpoint_path}"
    mime_type, _ = mimetypes.guess_type(file_path.name)
    content_type = mime_type or "application/octet-stream"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
            with file_path.open("rb") as fh:
                files = {"file": (file_path.name, fh, content_type)}
                resp = await client.post(full_url, params=query_params or {}, files=files, headers=headers)
        try:
            body = resp.json()
        except Exception:
            body = {"raw_text": resp.text}

        if 200 <= resp.status_code < 300:
            return 0, {
                "ok": True,
                "status_code": resp.status_code,
                "endpoint": endpoint_path,
                "uploaded_file": str(file_path.resolve()),
                "response": body,
            }
        code = 2 if resp.status_code in (401, 403) else 1
        return code, {
            "ok": False,
            "status_code": resp.status_code,
            "endpoint": endpoint_path,
            "error": body,
        }
    except Exception as e:
        return 2, {"ok": False, "endpoint": endpoint_path, "error": f"请求失败: {e}"}


async def list_mcp_tools(url: str, api_key: str | None, format_mode: str = "json") -> int:
    """Discover all tools dynamically from ArcReel MCP server."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed. Run with `uv run`."}, ensure_ascii=False))
        return 2

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools_res = await session.list_tools()

                tools_data = [
                    {"name": t.name, "description": t.description, "inputSchema": t.inputSchema}
                    for t in tools_res.tools
                ]

                if format_mode == "markdown":
                    print(f"# ArcReel MCP 可用工具清单 (共 {len(tools_data)} 个)\n")
                    for t in tools_data:
                        print(f"### `{t['name']}`")
                        print(f"{t['description']}\n")
                        props = t.get("inputSchema", {}).get("properties", {})
                        required = set(t.get("inputSchema", {}).get("required", []))
                        if props:
                            print("| 参数名 | 类型 | 必填 | 说明 |")
                            print("|---|---|---|---|")
                            for k, v in props.items():
                                req_str = "✅ 是" if k in required else "否"
                                p_type = v.get("type", "any")
                                p_desc = v.get("description", "-")
                                print(f"| `{k}` | `{p_type}` | {req_str} | {p_desc} |")
                            print()
                else:
                    print(json.dumps({"count": len(tools_data), "tools": tools_data}, ensure_ascii=False, indent=2))
                return 0
    except Exception as e:
        print(json.dumps({"error": f"Failed to list tools from {url}: {e}"}, ensure_ascii=False), file=sys.stderr)
        return 2


def serialize_tool_result(
    tool_name: str,
    res: Any,
    save_media_dir: Path | None = None,
) -> dict[str, Any]:
    """Convert MCP CallToolResult to JSON-friendly dict and persist returned image blocks to disk."""
    output: dict[str, Any] = {
        "tool": tool_name,
        "isError": bool(getattr(res, "isError", False)),
        "content": [],
        "saved_images": [],
    }
    if getattr(res, "structuredContent", None):
        output["structuredContent"] = res.structuredContent

    img_idx = 0
    batch_dir = save_media_dir or (default_review_dir() / f"{tool_name}_{int(time.time() * 1000)}")
    for c in getattr(res, "content", []) or []:
        if hasattr(c, "text") and c.text is not None:
            try:
                output["content"].append(json.loads(c.text))
            except Exception:
                output["content"].append(c.text)
        elif hasattr(c, "data") and c.data is not None:
            img_idx += 1
            mime = getattr(c, "mimeType", None) or "image/jpeg"
            saved_path = save_mcp_binary_block(c.data, mime, tool_name, img_idx, save_dir=batch_dir)
            entry = {"type": "saved_image", "index": img_idx, "mime_type": mime, "path": str(saved_path)}
            output["content"].append(entry)
            output["saved_images"].append(str(saved_path))
    return output


async def call_mcp_tool(
    url: str,
    api_key: str | None,
    tool_name: str,
    arguments: dict[str, Any],
    save_media_dir: Path | None = None,
) -> int:
    """Call an arbitrary tool dynamically via MCP and persist any returned review images."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed"}, ensure_ascii=False), file=sys.stderr)
        return 2

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                res: CallToolResult = await session.call_tool(tool_name, arguments)
                output = serialize_tool_result(tool_name, res, save_media_dir=save_media_dir)
                print(json.dumps(output, ensure_ascii=False, indent=2))
                return 1 if output["isError"] else 0
    except Exception as e:
        print(json.dumps({"tool": tool_name, "isError": True, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


def _extract_batch_token(res: Any) -> str | None:
    if getattr(res, "structuredContent", None) and isinstance(res.structuredContent, dict):
        tok = res.structuredContent.get("generation_batch")
        if tok:
            return str(tok)
    for c in getattr(res, "content", []) or []:
        if hasattr(c, "text") and c.text and "generation_batch" in c.text:
            try:
                parsed = json.loads(c.text)
                if isinstance(parsed, dict) and parsed.get("generation_batch"):
                    return str(parsed["generation_batch"])
            except Exception:
                pass
    return None


async def call_and_wait_if_batch(
    session: Any,
    project: str,
    tool_name: str,
    arguments: dict[str, Any],
    poll_interval: float = 3.0,
    max_wait_seconds: float = 900.0,
) -> dict[str, Any]:
    """Call an ArcReel MCP tool and automatically poll get_generation_batch if it returns a batch token."""
    res = await session.call_tool(tool_name, arguments)
    serialized = serialize_tool_result(tool_name, res)
    if serialized["isError"]:
        return serialized

    batch_token = _extract_batch_token(res)
    if not batch_token:
        return serialized

    elapsed = 0.0
    while elapsed < max_wait_seconds:
        poll_res = await session.call_tool(
            "get_generation_batch", {"project": project, "generation_batch": batch_token}
        )
        poll_data = serialize_tool_result("get_generation_batch", poll_res)
        if poll_data["isError"]:
            raise RuntimeError(f"轮询批次失败 ({tool_name}): {poll_data}")
        status_obj = poll_data.get("structuredContent") or (
            poll_data["content"][0] if poll_data["content"] and isinstance(poll_data["content"][0], dict) else {}
        )
        if status_obj.get("done", False):
            serialized["batch_result"] = status_obj
            return serialized
        interval = float(status_obj.get("poll_after_seconds", poll_interval))
        await asyncio.sleep(interval)
        elapsed += interval

    raise TimeoutError(f"{tool_name} 批次等待超时 (> {max_wait_seconds}s)")


async def run_pipeline(
    url: str,
    api_key: str | None,
    novel_path: Path,
    project_name: str,
    aspect_ratio: str,
    stage: str,
    grid_storyboard: bool,
    default_duration: int,
    export_jianying: bool,
) -> int:
    """Orchestrate real ArcReel MCP workflow stages.

    Recommended for external Image/Video Skills (`--stage plan`, the default):
      Creates storyboard project (grid_storyboard=True, default_duration=5s), uploads novel,
      runs episode planning & script generation, and outputs pending assets + prompt previews
      WITHOUT calling ArcReel's internal paid image/video backends.
    """
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if not novel_path.exists():
        print(json.dumps({"error": f"输入文本文件不存在: {novel_path}"}, ensure_ascii=False), file=sys.stderr)
        return 1

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    novel_content = novel_path.read_text(encoding="utf-8", errors="replace")

    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # 1. 创建标准宫格分镜项目（单镜头默认 5s 防人物漂移）
                create_res = await session.call_tool(
                    "create_project",
                    {
                        "name": project_name,
                        "title": project_name,
                        "content_mode": "drama",
                        "generation_mode": "storyboard",
                        "grid_storyboard": grid_storyboard,
                        "aspect_ratio": aspect_ratio,
                        "default_duration": default_duration,
                    },
                )
                if create_res.isError and "project_exists" not in str(create_res.content):
                    print(json.dumps(serialize_tool_result("create_project", create_res), ensure_ascii=False, indent=2))
                    return 1

                # 2. 上传源文本
                up_res = await session.call_tool(
                    "upload_source",
                    {
                        "project": project_name,
                        "filename": novel_path.name,
                        "text": novel_content,
                        "role": "whole_source",
                        "on_conflict": "replace",
                    },
                )
                if up_res.isError:
                    print(json.dumps(serialize_tool_result("upload_source", up_res), ensure_ascii=False, indent=2))
                    return 1

                # 3. 分集规划 -> 剧本大纲 -> 确认 -> 单集分镜剧本生成
                for step_tool, step_args in (
                    ("plan_episodes", {"project": project_name}),
                    ("generate_script_plan", {"project": project_name}),
                    ("confirm_script_review", {"project": project_name}),
                    ("generate_episode_script", {"project": project_name, "episode": 1}),
                ):
                    step_out = await call_and_wait_if_batch(session, project_name, step_tool, step_args)
                    if step_out["isError"]:
                        print(json.dumps({"failed_step": step_tool, "details": step_out}, ensure_ascii=False, indent=2))
                        return 1

                pending_assets = serialize_tool_result(
                    "list_pending_assets",
                    await session.call_tool("list_pending_assets", {"project": project_name}),
                )
                ep_script = serialize_tool_result(
                    "get_episode_script",
                    await session.call_tool("get_episode_script", {"project": project_name, "episode": 1}),
                )

                if stage == "plan":
                    print(
                        json.dumps(
                            {
                                "status": "plan_complete",
                                "project": project_name,
                                "next_byo_steps": [
                                    "1. 用外部生图 Skill 按 pending_assets 生成角色定妆图，调 `upload-asset --type character` 回灌并用 `call inspect_images` 验脸",
                                    "2. 用外部生图 Skill 按分镜剧本生成宫格图或单镜图，调 `upload-grid` + `call split_grids`（或 `upload-shot --kind storyboard`）回灌并验脸",
                                    "3. 用外部生视频 Skill 锁首帧生成各镜头 MP4，调 `upload-shot --kind video` 回灌并用 `call inspect_video_units` 抽帧审片",
                                    "4. 调 `call export_jianying_draft` 或 `call render_final_cut` 导出成片",
                                ],
                                "pending_assets": pending_assets,
                                "episode_script": ep_script,
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                    )
                    return 0

                # 以下阶段仅在配置了 ArcReel 内部生图/生视频供应商时使用
                assets_out = await call_and_wait_if_batch(
                    session, project_name, "generate_assets", {"project": project_name}
                )
                if assets_out["isError"]:
                    print(json.dumps({"failed_step": "generate_assets", "details": assets_out}, ensure_ascii=False, indent=2))
                    return 1

                if grid_storyboard:
                    sb_out = await call_and_wait_if_batch(
                        session, project_name, "generate_grid", {"project": project_name, "episode": 1}
                    )
                else:
                    sb_out = await call_and_wait_if_batch(
                        session, project_name, "generate_storyboards", {"project": project_name, "episode": 1}
                    )
                if sb_out["isError"]:
                    print(json.dumps({"failed_step": "storyboard", "details": sb_out}, ensure_ascii=False, indent=2))
                    return 1

                if stage == "storyboard":
                    print(
                        json.dumps(
                            {
                                "status": "storyboard_complete",
                                "project": project_name,
                                "note": "宫格联合图已生成，请先调 `call inspect_images` 审阅人脸一致后再调 `call split_grids` 切分落格",
                                "storyboard_result": sb_out,
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                    )
                    return 0

                vid_out = await call_and_wait_if_batch(
                    session, project_name, "generate_videos", {"project": project_name, "episode": 1}
                )
                if vid_out["isError"]:
                    print(json.dumps({"failed_step": "generate_videos", "details": vid_out}, ensure_ascii=False, indent=2))
                    return 1
                if stage == "video":
                    print(json.dumps({"status": "video_complete", "project": project_name, "result": vid_out}, ensure_ascii=False, indent=2))
                    return 0

                exported: dict[str, Any] = {}
                if export_jianying:
                    jy = await session.call_tool("export_jianying_draft", {"project": project_name})
                    exported["jianying_draft"] = serialize_tool_result("export_jianying_draft", jy)
                fc = await session.call_tool("render_final_cut", {"project": project_name})
                exported["final_cut"] = serialize_tool_result("render_final_cut", fc)
                print(json.dumps({"status": "success", "project": project_name, "exported": exported}, ensure_ascii=False, indent=2))
                return 0
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="ArcReel MCP & BYO-Media Bridge for leo-video-router")
    parser.add_argument("--url", default=None, help="ArcReel MCP URL (default: http://localhost:1241/mcp)")
    parser.add_argument("--api-key", default=None, help="ArcReel API Key (arc-xxxx)")

    sub = parser.add_subparsers(dest="subcommand", required=True)

    # status
    sub.add_parser("status", help="检查 ArcReel 服务状态与连通性")

    # set-token
    set_token_p = sub.add_parser("set-token", help="将 ArcReel API Token 保存到本地配置文件中")
    set_token_p.add_argument("token", help="ArcReel API Key (arc-xxxx)")
    set_token_p.add_argument("--file", type=Path, default=None, help="目标 Token 文件路径")

    # tools
    tools_p = sub.add_parser("tools", help="动态列出 ArcReel 所有可用 MCP 工具清单")
    tools_p.add_argument("--format", choices=["json", "markdown"], default="markdown", help="输出格式")

    # call (supports saving inspect_images / inspect_video_units media blocks!)
    call_p = sub.add_parser("call", help="动态调用任意 MCP 工具（自动解码保存验脸图与视频抽帧联系表）")
    call_p.add_argument("tool", help="MCP 工具名（如 inspect_images, inspect_video_units, split_grids, get_prompt_preview）")
    call_p.add_argument("args", nargs="?", default="{}", help="JSON 格式入参")
    call_p.add_argument("--save-media-dir", type=Path, default=None, help="图片内容块落盘目录（缺省存至 review_cache/）")

    # upload-asset (external skill -> ArcReel character / scene / prop / bgm / source)
    up_asset_p = sub.add_parser("upload-asset", help="将任意外部生图/音频 Skill 产出的角色、场景、道具或 BGM 注入 ArcReel")
    up_asset_p.add_argument("--project", required=True, help="ArcReel 项目名")
    up_asset_p.add_argument(
        "--type",
        required=True,
        choices=["character", "character_ref", "character_audio_ref", "scene", "prop", "product", "product_ref", "bgm", "source"],
        help="上传资产类别",
    )
    up_asset_p.add_argument("--name", default=None, help="角色/场景/道具名称（如 张三）")
    up_asset_p.add_argument("--file", required=True, type=Path, help="本地图片/音频/文本文件路径")

    # upload-derivative (external skill -> @[角色/衍生] outfit/variant sheet)
    up_deriv_p = sub.add_parser("upload-derivative", help="将外部生图 Skill 产出的角色换装/变身衍生图注入 @[角色/衍生]")
    up_deriv_p.add_argument("--project", required=True, help="ArcReel 项目名")
    up_deriv_p.add_argument("--character", required=True, help="本体角色名称")
    up_deriv_p.add_argument("--derivative", required=True, help="衍生形态名称（如 夜行衣、战损）")
    up_deriv_p.add_argument("--file", required=True, type=Path, help="本地衍生设定图路径")

    # upload-grid (external skill -> 4/6/9 composite storyboard grid)
    up_grid_p = sub.add_parser("upload-grid", help="将外部生图 Skill 产出的四宫格/九宫格联合分镜大图注入 ArcReel（随后调 call split_grids 切片）")
    up_grid_p.add_argument("--project", required=True, help="ArcReel 项目名")
    up_grid_p.add_argument("--grid-id", required=True, help="宫格 ID（如 grid_01）")
    up_grid_p.add_argument("--file", required=True, type=Path, help="本地宫格联合大图路径")

    # upload-shot (external skill -> per-shot storyboard / end-frame / video / ref-video-unit)
    up_shot_p = sub.add_parser("upload-shot", help="将外部生图/生视频 Skill 产出的单镜首帧图、尾帧图或 MP4 视频回灌挂载到指定分镜")
    up_shot_p.add_argument("--project", required=True, help="ArcReel 项目名")
    up_shot_p.add_argument("--kind", required=True, choices=["storyboard", "end-frame", "video", "ref-video-unit"], help="挂载类型")
    up_shot_p.add_argument("--shot-id", default=None, help="分镜 ID（如 E1S01；storyboard/end-frame/video 必填）")
    up_shot_p.add_argument("--script-file", default="episode_1.json", help="分集剧本文件名（默认 episode_1.json）")
    up_shot_p.add_argument("--episode", type=int, default=1, help="集号（仅 ref-video-unit 模式使用，默认 1）")
    up_shot_p.add_argument("--unit-id", default=None, help="参考视频单元 ID（仅 ref-video-unit 模式必填）")
    up_shot_p.add_argument("--file", required=True, type=Path, help="本地图片或 MP4 视频路径")

    # run
    run_p = sub.add_parser("run", help="执行剧本拆解与规划（默认停在 plan 阶段供外部生图/生视频 Skill 接管）")
    run_p.add_argument("--novel", required=True, type=Path, help="小说/剧本源文件路径 (.txt, .md)")
    run_p.add_argument("--project", default=None, help="项目名称（缺省根据文件名派生）")
    run_p.add_argument("--aspect-ratio", default="9:16", choices=["9:16", "16:9"], help="画幅比例")
    run_p.add_argument("--stage", choices=["plan", "storyboard", "video", "export", "all"], default="plan", help="阶段截断（外部 Skill 协同默认选 plan）")
    run_p.add_argument("--no-grid", action="store_true", help="关闭宫格联合分镜模式（默认开启宫格锁脸）")
    run_p.add_argument("--default-duration", type=int, default=5, help="单镜头默认秒数（默认 5 秒防单视频内人物漂移）")
    run_p.add_argument("--export-jianying", action="store_true", default=True, help="导出剪映草稿工程")

    return parser


def build_upload_route(args: argparse.Namespace) -> tuple[str, dict[str, str]]:
    """Construct exact ArcReel /api/v1/... upload route and query parameters from parsed CLI args."""
    q = urllib.parse.quote
    proj = q(args.project, safe="")
    if args.subcommand == "upload-asset":
        utype = q(args.type, safe="")
        params: dict[str, str] = {}
        if args.name:
            params["name"] = args.name
        if args.type == "source":
            params["on_conflict"] = "replace"
        return f"/api/v1/projects/{proj}/upload/{utype}", params

    if args.subcommand == "upload-derivative":
        char = q(args.character, safe="")
        deriv = q(args.derivative, safe="")
        return f"/api/v1/projects/{proj}/characters/{char}/derivatives/{deriv}/upload", {}

    if args.subcommand == "upload-grid":
        gid = q(args.grid_id, safe="")
        return f"/api/v1/projects/{proj}/grids/{gid}/upload", {}

    if args.subcommand == "upload-shot":
        if args.kind == "ref-video-unit":
            if not args.unit_id:
                raise ValueError("--kind ref-video-unit 必须提供 --unit-id")
            uid = q(args.unit_id, safe="")
            return f"/api/v1/projects/{proj}/episodes/{args.episode}/units/{uid}/upload-video", {}
        if not args.shot_id:
            raise ValueError(f"--kind {args.kind} 必须提供 --shot-id")
        sid = q(args.shot_id, safe="")
        params = {"script_file": args.script_file}
        if args.kind == "end-frame":
            return f"/api/v1/projects/{proj}/shots/{sid}/end-frame/upload", params
        return f"/api/v1/projects/{proj}/shots/{sid}/upload/{args.kind}", params

    raise ValueError(f"未知上传命令: {args.subcommand}")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    url, api_key = resolve_auth_and_url(args.url, args.api_key)

    if args.subcommand == "status":
        res = asyncio.run(check_server_status(url, api_key))
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return 0 if res["online"] else 1

    if args.subcommand == "set-token":
        target = save_token_to_file(args.token, args.file)
        print(json.dumps({"status": "saved", "file": str(target)}, ensure_ascii=False, indent=2))
        return 0

    if args.subcommand == "tools":
        return asyncio.run(list_mcp_tools(url, api_key, format_mode=args.format))

    if args.subcommand == "call":
        try:
            parsed_args = json.loads(args.args)
        except Exception as e:
            print(json.dumps({"error": f"参数不是合法的 JSON: {e}"}, ensure_ascii=False), file=sys.stderr)
            return 1
        return asyncio.run(call_mcp_tool(url, api_key, args.tool, parsed_args, save_media_dir=args.save_media_dir))

    if args.subcommand in ("upload-asset", "upload-derivative", "upload-grid", "upload-shot"):
        try:
            route, params = build_upload_route(args)
        except ValueError as e:
            print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
            return 1
        code, payload = asyncio.run(upload_multipart(url, api_key, route, args.file, query_params=params))
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return code

    if args.subcommand == "run":
        proj_name = args.project or args.novel.stem.replace(" ", "_")
        return asyncio.run(
            run_pipeline(
                url=url,
                api_key=api_key,
                novel_path=args.novel,
                project_name=proj_name,
                aspect_ratio=args.aspect_ratio,
                stage=args.stage,
                grid_storyboard=not args.no_grid,
                default_duration=args.default_duration,
                export_jianying=args.export_jianying,
            )
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
