#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "mcp>=1.2.0",
#     "httpx>=0.27.0",
#     "socksio>=1.0.0",
#     "pillow>=10.0.0",
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
4. BYO-Media Uploads (inject external skill outputs into ArcReel with 0 internal API cost):
   - `upload-asset`      -> character / scene / prop / product / bgm / source
   - `upload-derivative` -> @[角色/衍生] outfit/variant sheet
   - `split-upload-grid` -> locally slice 2x2 / 3x3 composite grid PNG into per-shot start
                            frames (for external video I2V!) AND upload all cells to ArcReel
   - `upload-grid`       -> replace an existing ArcReel GridGeneration image
   - `upload-shot`       -> per-shot `storyboard` | `end-frame` | `video` | `ref-video-unit`
5. Timeline & Export:      `arcreel_bridge.py export --project <proj> [--output-mp4 <path>]`
6. Macro Orchestration:    `arcreel_bridge.py run --novel <file> [--stage plan|storyboard|video|export|all]`

Exit codes: 0 ok, 1 execution/MCP/API error, 2 connection/auth error.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import mimetypes
import os
import re
import sys
import time
import unicodedata
import urllib.parse
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError:
    httpx = None  # type: ignore[assignment]

try:
    from PIL import Image
except ImportError:
    Image = None  # type: ignore[assignment]

try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.types import CallToolResult

    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

DEFAULT_MCP_URL = "http://localhost:1241/mcp"
_VALID_PROJECT_ID_RE = re.compile(r"^[A-Za-z0-9-]+$")


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


def slugify_project_name(raw: str) -> str:
    """Convert any human title (including Chinese/spaces/underscores) into a valid ArcReel project ID ([A-Za-z0-9-]+).

    Deterministic: passing the same Chinese title across `run`, `upload-*`, `export`, and `call`
    always resolves to the exact same valid ArcReel project identifier.
    """
    cleaned = str(raw).strip()
    if not cleaned:
        raise ValueError("项目名称不能为空")
    if _VALID_PROJECT_ID_RE.fullmatch(cleaned) and any(ch.isalpha() for ch in cleaned):
        return cleaned

    ascii_part = unicodedata.normalize("NFKD", cleaned).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_part).strip("-").lower()[:24].strip("-")
    digest = hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:8]
    if slug and any(ch.isalpha() for ch in slug):
        return f"{slug}-{digest}"
    return f"proj-{digest}"


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
    payload = raw_data if isinstance(raw_data, bytes) else base64.b64decode(raw_data)
    out_path.write_bytes(payload)
    return out_path.resolve()


def slice_grid_image(
    grid_file: Path,
    rows: int,
    cols: int,
    shot_ids: list[str],
    out_dir: Path,
    trim_px: int = 0,
) -> list[tuple[str, Path]]:
    """Slice a composite (rows x cols) storyboard grid image in row-major order into per-shot start-frame PNGs."""
    if Image is None:
        raise RuntimeError("缺少 Pillow 依赖，请使用 `uv run arcreel_bridge.py ...` 运行")
    if rows <= 0 or cols <= 0:
        raise ValueError(f"非法的行列数: {rows}x{cols}")
    if not shot_ids:
        raise ValueError("shot_ids 不能为空")
    if len(shot_ids) > rows * cols:
        raise ValueError(f"分镜数 ({len(shot_ids)}) 超过宫格总格数 ({rows}x{cols}={rows * cols})")

    out_dir.mkdir(parents=True, exist_ok=True)
    results: list[tuple[str, Path]] = []
    with Image.open(grid_file) as img:
        rgb = img.convert("RGB")
        total_w, total_h = rgb.size
        cell_w = total_w / cols
        cell_h = total_h / rows
        for idx, shot_id in enumerate(shot_ids):
            r = idx // cols
            c = idx % cols
            left = int(round(c * cell_w)) + trim_px
            top = int(round(r * cell_h)) + trim_px
            right = int(round((c + 1) * cell_w)) - trim_px
            bottom = int(round((r + 1) * cell_h)) - trim_px
            if right <= left or bottom <= top:
                raise ValueError(f"trim_px={trim_px} 过大，导致单元格尺寸非法")
            cell = rgb.crop((left, top, right, bottom))
            cell_path = (out_dir / f"{shot_id}_start.png").resolve()
            cell.save(cell_path, format="PNG")
            results.append((shot_id, cell_path))
    return results


async def check_server_status(url: str, api_key: str | None) -> dict[str, Any]:
    """Check connectivity to ArcReel server."""
    if httpx is None:
        return {"online": False, "error": "httpx not installed"}
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
    if httpx is None:
        return 2, {"ok": False, "error": "httpx not installed"}
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


async def download_http_file(base_url: str, download_url: str, api_key: str | None, dest: Path) -> Path:
    """Download a rendered final-cut MP4 from ArcReel to local disk."""
    if httpx is None:
        raise RuntimeError("httpx not installed")
    full = download_url if download_url.startswith("http") else f"{base_url}{download_url if download_url.startswith('/') else '/' + download_url}"
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with httpx.AsyncClient(timeout=300.0, trust_env=False, follow_redirects=True) as client:
        async with client.stream("GET", full, headers=headers) as resp:
            resp.raise_for_status()
            with dest.open("wb") as fh:
                async for chunk in resp.aiter_bytes():
                    fh.write(chunk)
    return dest.resolve()


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

    args_copy = dict(arguments)
    if "project" in args_copy and isinstance(args_copy["project"], str) and args_copy["project"].strip():
        args_copy["project"] = slugify_project_name(args_copy["project"])

    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                res: CallToolResult = await session.call_tool(tool_name, args_copy)
                output = serialize_tool_result(tool_name, res, save_media_dir=save_media_dir)
                print(json.dumps(output, ensure_ascii=False, indent=2))
                return 1 if output["isError"] else 0
    except Exception as e:
        print(json.dumps({"tool": tool_name, "isError": True, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


def _extract_batch_token(res: Any) -> str | None:
    sc = getattr(res, "structuredContent", None)
    if isinstance(sc, dict):
        gb = sc.get("generation_batch")
        if isinstance(gb, dict) and gb.get("batch_id"):
            return str(gb["batch_id"])
        if isinstance(gb, str) and gb:
            return gb
    for c in getattr(res, "content", []) or []:
        if hasattr(c, "text") and c.text and "generation_batch" in c.text:
            try:
                parsed = json.loads(c.text)
                if isinstance(parsed, dict):
                    gb = parsed.get("generation_batch")
                    if isinstance(gb, dict) and gb.get("batch_id"):
                        return str(gb["batch_id"])
                    if isinstance(gb, str) and gb:
                        return gb
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
    """Call an ArcReel MCP tool and automatically poll get_generation_batch if it returns a batch handle."""
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
        sc = poll_data.get("structuredContent") or {}
        batch_obj = sc.get("generation_batch", sc) if isinstance(sc, dict) else {}
        if not batch_obj and poll_data["content"] and isinstance(poll_data["content"][0], dict):
            batch_obj = poll_data["content"][0]
        if batch_obj.get("done", False):
            serialized["batch_result"] = sc or batch_obj
            return serialized
        interval = float(batch_obj.get("poll_after_seconds", poll_interval))
        await asyncio.sleep(interval)
        elapsed += interval

    raise TimeoutError(f"{tool_name} 批次等待超时 (> {max_wait_seconds}s)")


def build_plan_step_payloads(
    *,
    project_id: str,
    title: str,
    filename: str,
    content: str,
    aspect_ratio: str,
    grid_storyboard: bool,
    default_duration: int,
    episode_id: int = 1,
    script_filename: str = "episode_1.json",
) -> dict[str, dict[str, Any]]:
    """Construct exact Pydantic-validated remote MCP tool payloads for ArcReel workflow steps."""
    return {
        "create_project": {
            "name": project_id,
            "title": title,
            "content_mode": "drama",
            "generation_mode": "storyboard",
            "grid_storyboard": grid_storyboard,
            "aspect_ratio": aspect_ratio,
            "default_duration": default_duration,
        },
        "upload_source": {
            "project": project_id,
            "filename": filename,
            "content": content,
            "role": "whole_source",
            "on_conflict": "replace",
        },
        "plan_episodes": {"project": project_id},
        "get_workflow_plan": {"project": project_id},
        "generate_script_plan": {"project": project_id, "episode_id": episode_id},
        "confirm_script_review": {"project": project_id, "episode_id": episode_id},
        "generate_episode_script": {"project": project_id, "episode_id": episode_id},
        "list_pending_assets": {"project": project_id, "episode_id": episode_id},
        "get_episode_script": {"project": project_id, "script": script_filename},
        "generate_assets": {"project": project_id, "episode_id": episode_id},
        "generate_grid": {"project": project_id, "script": script_filename},
        "generate_storyboards": {"project": project_id, "script": script_filename},
        "generate_videos": {"project": project_id, "script": script_filename, "target": {"scope": "episode", "episode_id": episode_id}},
        "list_timelines": {"project": project_id, "episode": episode_id},
        "create_timeline": {"project": project_id, "from": "script", "episode": episode_id, "name": "默认完整版"},
    }


def _extract_target_from_plan(plan_serialized: dict[str, Any]) -> tuple[int, str]:
    """Read authoritative (episode_id, script_filename) from get_workflow_plan structuredContent."""
    sc = plan_serialized.get("structuredContent") or {}
    plan_obj = sc.get("workflow_plan", sc) if isinstance(sc, dict) else {}
    target = (plan_obj.get("status") or {}).get("target") or {}
    ep_id = int(target.get("episode") or 1)
    script_fn = str(target.get("script_filename") or f"episode_{ep_id}.json")
    return ep_id, script_fn


def _extract_timeline_id(tl_serialized: dict[str, Any]) -> str | None:
    """Extract timeline ID (tl-...) from list_timelines or create_timeline output."""
    sc = tl_serialized.get("structuredContent") or {}
    if isinstance(sc, dict):
        for key in ("edit_timeline", "timeline"):
            sub = sc.get(key)
            if isinstance(sub, dict) and sub.get("id"):
                return str(sub["id"])
        tls = sc.get("list_timelines") or sc.get("timelines")
        if isinstance(tls, dict):
            tls = tls.get("timelines")
        if isinstance(tls, list) and tls:
            first = tls[0]
            if isinstance(first, dict) and first.get("id"):
                return str(first["id"])
    text_dump = json.dumps(tl_serialized, ensure_ascii=False)
    m = re.search(r"\btl-[a-zA-Z0-9_-]+\b", text_dump)
    return m.group(0) if m else None


def _extract_download_url(fc_serialized: dict[str, Any]) -> str | None:
    text_dump = json.dumps(fc_serialized, ensure_ascii=False)
    try:
        for obj in (
            (fc_serialized.get("batch_result") or {}).get("final_cut"),
            (fc_serialized.get("structuredContent") or {}).get("final_cut"),
        ):
            if isinstance(obj, dict) and obj.get("download_url"):
                return str(obj["download_url"])
    except Exception:
        pass
    m = re.search(r'"download_url"\s*:\s*"([^"]+)"', text_dump)
    return m.group(1) if m else None


async def ensure_timeline_and_export(
    session: Any,
    base_url: str,
    api_key: str | None,
    project_id: str,
    episode_id: int = 1,
    timeline_id: str | None = None,
    export_jianying: bool = True,
    render_mp4: bool = True,
    burn_subtitles: bool = False,
    output_mp4: Path | None = None,
) -> dict[str, Any]:
    """Ensure an edit timeline exists, then poll export_jianying_draft and/or render_final_cut."""
    tl_id = timeline_id
    if not tl_id:
        listed = serialize_tool_result(
            "list_timelines",
            await session.call_tool("list_timelines", {"project": project_id, "episode": episode_id}),
        )
        tl_id = _extract_timeline_id(listed)
    if not tl_id:
        created = serialize_tool_result(
            "create_timeline",
            await session.call_tool(
                "create_timeline",
                {"project": project_id, "from": "script", "episode": episode_id, "name": "默认完整版"},
            ),
        )
        if created["isError"]:
            raise RuntimeError(f"创建剪辑时间线失败: {created}")
        tl_id = _extract_timeline_id(created)
    if not tl_id:
        raise RuntimeError("未能获取有效的剪辑时间线 ID (tl-...)")

    exported: dict[str, Any] = {"timeline_id": tl_id}
    if export_jianying:
        jy = await call_and_wait_if_batch(
            session, project_id, "export_jianying_draft", {"project": project_id, "timeline": tl_id}
        )
        exported["jianying_draft"] = jy
    if render_mp4:
        fc = await call_and_wait_if_batch(
            session,
            project_id,
            "render_final_cut",
            {"project": project_id, "timeline": tl_id, "burn_subtitles": burn_subtitles},
        )
        exported["final_cut"] = fc
        dl_url = _extract_download_url(fc)
        if dl_url and output_mp4 is not None:
            saved_mp4 = await download_http_file(base_url, dl_url, api_key, output_mp4)
            exported["downloaded_mp4"] = str(saved_mp4)
    return exported


async def run_pipeline(
    url: str,
    api_key: str | None,
    novel_path: Path,
    raw_project_name: str,
    aspect_ratio: str,
    stage: str,
    grid_storyboard: bool,
    default_duration: int,
    export_jianying: bool,
    output_mp4: Path | None = None,
) -> int:
    """Orchestrate real ArcReel MCP workflow stages."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed"}, ensure_ascii=False), file=sys.stderr)
        return 2
    if not novel_path.exists():
        print(json.dumps({"error": f"输入文本文件不存在: {novel_path}"}, ensure_ascii=False), file=sys.stderr)
        return 1

    project_id = slugify_project_name(raw_project_name)
    display_title = raw_project_name.strip()
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    novel_content = novel_path.read_text(encoding="utf-8", errors="replace")
    base_payloads = build_plan_step_payloads(
        project_id=project_id,
        title=display_title,
        filename=novel_path.name,
        content=novel_content,
        aspect_ratio=aspect_ratio,
        grid_storyboard=grid_storyboard,
        default_duration=default_duration,
    )

    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # 1. 创建标准宫格分镜项目
                create_res = await session.call_tool("create_project", base_payloads["create_project"])
                if create_res.isError and "project_exists" not in str(create_res.content):
                    print(json.dumps(serialize_tool_result("create_project", create_res), ensure_ascii=False, indent=2))
                    return 1

                # 2. 上传源文本（字段名为 content）
                up_res = await session.call_tool("upload_source", base_payloads["upload_source"])
                if up_res.isError:
                    print(json.dumps(serialize_tool_result("upload_source", up_res), ensure_ascii=False, indent=2))
                    return 1

                # 3. 分集规划，并从 get_workflow_plan 读取权威 episode_id 与 script_filename
                plan_ep_out = await call_and_wait_if_batch(
                    session, project_id, "plan_episodes", base_payloads["plan_episodes"]
                )
                if plan_ep_out["isError"]:
                    print(json.dumps({"failed_step": "plan_episodes", "details": plan_ep_out}, ensure_ascii=False, indent=2))
                    return 1

                wf_plan = serialize_tool_result(
                    "get_workflow_plan",
                    await session.call_tool("get_workflow_plan", {"project": project_id}),
                )
                ep_id, script_fn = _extract_target_from_plan(wf_plan)
                payloads = build_plan_step_payloads(
                    project_id=project_id,
                    title=display_title,
                    filename=novel_path.name,
                    content=novel_content,
                    aspect_ratio=aspect_ratio,
                    grid_storyboard=grid_storyboard,
                    default_duration=default_duration,
                    episode_id=ep_id,
                    script_filename=script_fn,
                )

                # 4. 生成结构化 script_plan -> 确认 -> 生成分镜视觉提示词 (image_prompt / video_prompt)
                for step_tool in ("generate_script_plan", "confirm_script_review", "generate_episode_script"):
                    step_out = await call_and_wait_if_batch(session, project_id, step_tool, payloads[step_tool])
                    if step_out["isError"]:
                        print(json.dumps({"failed_step": step_tool, "project_id": project_id, "details": step_out}, ensure_ascii=False, indent=2))
                        return 1

                # 重新读取最终剧本文件名与待补齐资产
                wf_plan_after = serialize_tool_result(
                    "get_workflow_plan",
                    await session.call_tool("get_workflow_plan", {"project": project_id, "episode_id": ep_id}),
                )
                ep_id, script_fn = _extract_target_from_plan(wf_plan_after)
                pending_assets = serialize_tool_result(
                    "list_pending_assets",
                    await session.call_tool("list_pending_assets", {"project": project_id, "episode_id": ep_id}),
                )
                ep_script = serialize_tool_result(
                    "get_episode_script",
                    await session.call_tool("get_episode_script", {"project": project_id, "script": script_fn}),
                )

                if stage == "plan":
                    print(
                        json.dumps(
                            {
                                "status": "plan_complete",
                                "project_id": project_id,
                                "title": display_title,
                                "episode_id": ep_id,
                                "script_file": script_fn,
                                "aspect_ratio": aspect_ratio,
                                "next_byo_steps": [
                                    f"1. 用生图 Skill 生成角色定妆图 -> `upload-asset --project {project_id} --type character --name <角色名> --file <图>` -> `call inspect_images` 验脸",
                                    f"2. 用生图 Skill 生成 2x2/3x3 宫格分镜大图 -> `split-upload-grid --project {project_id} --script-file {script_fn} --grid 2x2 --shot-ids E1S01,... --file <宫格图> --save-cells-dir <工程目录>/素材/shots` -> `call inspect_images` 验分镜",
                                    f"3. 用生视频 Skill 锁死各镜首帧 PNG 出 MP4 -> `upload-shot --project {project_id} --script-file {script_fn} --shot-id E1S01 --kind video --file <mp4>` -> `call inspect_video_units` 看联系表审片",
                                    f"4. 调 `export --project {project_id} --episode-id {ep_id} --output-mp4 <工程目录>/成片/原始版/raw.mp4` 导出剪映草稿与无字幕原片，再交回 Router Step 7 压制单行字幕",
                                ],
                                "pending_assets": pending_assets,
                                "episode_script": ep_script,
                            },
                            ensure_ascii=False,
                            indent=2,
                        )
                    )
                    return 0

                # 以下仅在使用 ArcReel 内部生图/生视频供应商时执行
                assets_out = await call_and_wait_if_batch(session, project_id, "generate_assets", payloads["generate_assets"])
                if assets_out["isError"]:
                    print(json.dumps({"failed_step": "generate_assets", "details": assets_out}, ensure_ascii=False, indent=2))
                    return 1

                sb_tool = "generate_grid" if grid_storyboard else "generate_storyboards"
                sb_out = await call_and_wait_if_batch(session, project_id, sb_tool, payloads[sb_tool])
                if sb_out["isError"]:
                    print(json.dumps({"failed_step": sb_tool, "details": sb_out}, ensure_ascii=False, indent=2))
                    return 1

                if stage == "storyboard":
                    print(json.dumps({"status": "storyboard_complete", "project_id": project_id, "result": sb_out}, ensure_ascii=False, indent=2))
                    return 0

                vid_out = await call_and_wait_if_batch(session, project_id, "generate_videos", payloads["generate_videos"])
                if vid_out["isError"]:
                    print(json.dumps({"failed_step": "generate_videos", "details": vid_out}, ensure_ascii=False, indent=2))
                    return 1
                if stage == "video":
                    print(json.dumps({"status": "video_complete", "project_id": project_id, "result": vid_out}, ensure_ascii=False, indent=2))
                    return 0

                exported = await ensure_timeline_and_export(
                    session=session,
                    base_url=derive_base_url(url),
                    api_key=api_key,
                    project_id=project_id,
                    episode_id=ep_id,
                    export_jianying=export_jianying,
                    render_mp4=True,
                    burn_subtitles=False,
                    output_mp4=output_mp4,
                )
                print(json.dumps({"status": "success", "project_id": project_id, "exported": exported}, ensure_ascii=False, indent=2))
                return 0
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 1


async def run_export_command(
    url: str,
    api_key: str | None,
    raw_project: str,
    episode_id: int,
    timeline_id: str | None,
    export_jianying: bool,
    render_mp4: bool,
    burn_subtitles: bool,
    output_mp4: Path | None,
) -> int:
    """Standalone CLI entry to build timeline, export JianYing draft, and download clean raw MP4."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed"}, ensure_ascii=False), file=sys.stderr)
        return 2
    project_id = slugify_project_name(raw_project)
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                exported = await ensure_timeline_and_export(
                    session=session,
                    base_url=derive_base_url(url),
                    api_key=api_key,
                    project_id=project_id,
                    episode_id=episode_id,
                    timeline_id=timeline_id,
                    export_jianying=export_jianying,
                    render_mp4=render_mp4,
                    burn_subtitles=burn_subtitles,
                    output_mp4=output_mp4,
                )
                print(json.dumps({"ok": True, "project_id": project_id, **exported}, ensure_ascii=False, indent=2))
                return 0
    except Exception as e:
        print(json.dumps({"ok": False, "project_id": project_id, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 1


async def run_split_upload_grid(
    url: str,
    api_key: str | None,
    raw_project: str,
    grid_file: Path,
    grid_spec: str,
    shot_ids_csv: str,
    script_file: str,
    save_cells_dir: Path | None,
    trim_px: int,
) -> int:
    """Slice an externally generated NxM composite grid locally, save start-frames, and upload all shots to ArcReel."""
    m = re.fullmatch(r"(\d+)[xX](\d+)", grid_spec.strip())
    if not m:
        print(json.dumps({"ok": False, "error": f"--grid 格式须为 行x列（如 2x2, 3x3），收到: {grid_spec}"}, ensure_ascii=False), file=sys.stderr)
        return 1
    rows, cols = int(m.group(1)), int(m.group(2))
    shot_ids = [s.strip() for s in shot_ids_csv.split(",") if s.strip()]
    project_id = slugify_project_name(raw_project)
    cells_dir = save_cells_dir or (grid_file.resolve().parent / f"{grid_file.stem}_cells")

    try:
        sliced = slice_grid_image(grid_file, rows=rows, cols=cols, shot_ids=shot_ids, out_dir=cells_dir, trim_px=trim_px)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"本地切分宫格失败: {e}"}, ensure_ascii=False), file=sys.stderr)
        return 1

    q = urllib.parse.quote
    proj_q = q(project_id, safe="")
    uploaded_results = []
    any_error = False
    for shot_id, cell_path in sliced:
        route = f"/api/v1/projects/{proj_q}/shots/{q(shot_id, safe='')}/upload/storyboard"
        code, res = await upload_multipart(url, api_key, route, cell_path, query_params={"script_file": script_file})
        uploaded_results.append({"shot_id": shot_id, "local_start_frame": str(cell_path), "upload_ok": code == 0, "detail": res})
        if code != 0:
            any_error = True

    print(
        json.dumps(
            {
                "ok": not any_error,
                "project_id": project_id,
                "grid": f"{rows}x{cols}",
                "cells_dir": str(cells_dir.resolve()),
                "shots": uploaded_results,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 1 if any_error else 0


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

    # call
    call_p = sub.add_parser("call", help="动态调用任意 MCP 工具（自动解码保存验脸图与视频抽帧联系表）")
    call_p.add_argument("tool", help="MCP 工具名（如 inspect_images, inspect_video_units, get_workflow_plan, get_prompt_preview）")
    call_p.add_argument("args", nargs="?", default="{}", help="JSON 格式入参")
    call_p.add_argument("--save-media-dir", type=Path, default=None, help="图片内容块落盘目录（缺省存至 review_cache/）")

    # upload-asset
    up_asset_p = sub.add_parser("upload-asset", help="将外部生图/音频 Skill 产出的角色、场景、道具或 BGM 注入 ArcReel")
    up_asset_p.add_argument("--project", required=True, help="ArcReel 项目标识或标题（中文自动转为固定项目 ID）")
    up_asset_p.add_argument(
        "--type",
        required=True,
        choices=["character", "character_ref", "character_audio_ref", "scene", "prop", "product", "product_ref", "bgm", "source"],
        help="上传资产类别",
    )
    up_asset_p.add_argument("--name", default=None, help="角色/场景/道具名称（如 林默）")
    up_asset_p.add_argument("--file", required=True, type=Path, help="本地图片/音频/文本文件路径")

    # upload-derivative
    up_deriv_p = sub.add_parser("upload-derivative", help="将外部生图 Skill 产出的角色换装/变身衍生图注入 @[角色/衍生]")
    up_deriv_p.add_argument("--project", required=True, help="ArcReel 项目标识或标题")
    up_deriv_p.add_argument("--character", required=True, help="本体角色名称")
    up_deriv_p.add_argument("--derivative", required=True, help="衍生形态名称（如 夜行衣、战损）")
    up_deriv_p.add_argument("--file", required=True, type=Path, help="本地衍生设定图路径")

    # split-upload-grid (Pure BYO-Media 0-provider grid slicer + uploader!)
    split_up_p = sub.add_parser("split-upload-grid", help="本地切分外部生图 Skill 产出的 2x2/3x3 宫格大图为各镜首帧 PNG 并批量回灌 ArcReel")
    split_up_p.add_argument("--project", required=True, help="ArcReel 项目标识或标题")
    split_up_p.add_argument("--file", required=True, type=Path, help="外部生图 Skill 生成的宫格联合大图路径")
    split_up_p.add_argument("--grid", default="2x2", help="宫格行列规格（如 2x2, 2x3, 3x3，默认 2x2）")
    split_up_p.add_argument("--shot-ids", required=True, help="按从左到右、从上到下顺序对应的分镜 ID 列表（逗号分隔，如 E1S01,E1S02,E1S03,E1S04）")
    split_up_p.add_argument("--script-file", default="episode_1.json", help="分集剧本文件名（默认 episode_1.json）")
    split_up_p.add_argument("--save-cells-dir", type=Path, default=None, help="切出的单镜首帧 PNG 保存目录（供生视频 Skill 直接引用锁首帧）")
    split_up_p.add_argument("--trim-px", type=int, default=0, help="每格四周内缩像素数（用于裁掉生图模型画出的白边分割线，默认 0）")

    # upload-grid (replaces existing internal GridGeneration record)
    up_grid_p = sub.add_parser("upload-grid", help="替换 ArcReel 已有宫格记录（仅当已存在 grid_id 时使用；纯外部生图请用 split-upload-grid）")
    up_grid_p.add_argument("--project", required=True, help="ArcReel 项目标识或标题")
    up_grid_p.add_argument("--grid-id", required=True, help="已有宫格 ID")
    up_grid_p.add_argument("--file", required=True, type=Path, help="本地宫格联合大图路径")

    # upload-shot
    up_shot_p = sub.add_parser("upload-shot", help="将外部生图/生视频 Skill 产出的单镜首帧图、尾帧图或 MP4 视频回灌挂载到指定分镜")
    up_shot_p.add_argument("--project", required=True, help="ArcReel 项目标识或标题")
    up_shot_p.add_argument("--kind", required=True, choices=["storyboard", "end-frame", "video", "ref-video-unit"], help="挂载类型")
    up_shot_p.add_argument("--shot-id", default=None, help="分镜 ID（如 E1S01；storyboard/end-frame/video 必填）")
    up_shot_p.add_argument("--script-file", default="episode_1.json", help="分集剧本文件名（默认 episode_1.json）")
    up_shot_p.add_argument("--episode", type=int, default=1, help="集 ID（仅 ref-video-unit 模式使用，默认 1）")
    up_shot_p.add_argument("--unit-id", default=None, help="参考视频单元 ID（仅 ref-video-unit 模式必填）")
    up_shot_p.add_argument("--file", required=True, type=Path, help="本地图片或 MP4 视频路径")

    # export
    exp_p = sub.add_parser("export", help="自动创建/复用剪辑时间线，导出剪映草稿工程并渲染下载成片 MP4")
    exp_p.add_argument("--project", required=True, help="ArcReel 项目标识或标题")
    exp_p.add_argument("--episode-id", type=int, default=1, help="集 ID（默认 1）")
    exp_p.add_argument("--timeline", default=None, help="指定剪辑时间线 ID（缺省自动查询或按脚本新建）")
    exp_p.add_argument("--no-jianying", action="store_true", help="跳过导出剪映草稿")
    exp_p.add_argument("--no-mp4", action="store_true", help="跳过渲染合成 MP4")
    exp_p.add_argument("--burn-subtitles", action="store_true", default=False, help="是否在 ArcReel 内烧录字幕（默认关闭，交由 Router Step 7 压制院线单行字幕防双层重叠）")
    exp_p.add_argument("--output-mp4", type=Path, default=None, help="将合成好的成片 MP4 自动下载保存至本地路径（如 <工程目录>/成片/原始版/raw.mp4）")

    # run
    run_p = sub.add_parser("run", help="执行剧本拆解与规划（默认停在 plan 阶段供外部生图/生视频 Skill 接管）")
    run_p.add_argument("--novel", required=True, type=Path, help="小说/剧本源文件路径 (.txt, .md)")
    run_p.add_argument("--project", default=None, help="项目名称或标题（中文自动映射为合法项目 ID）")
    run_p.add_argument("--aspect-ratio", default="9:16", choices=["9:16", "16:9"], help="画幅比例")
    run_p.add_argument("--stage", choices=["plan", "storyboard", "video", "export", "all"], default="plan", help="阶段截断（外部 Skill 协同默认选 plan）")
    run_p.add_argument("--no-grid", action="store_true", help="关闭宫格联合分镜标记")
    run_p.add_argument("--default-duration", type=int, default=5, help="单镜头默认秒数（默认 5 秒防单视频内人物漂移）")
    run_p.add_argument("--export-jianying", action="store_true", default=True, help="全自动模式下是否导出剪映草稿")
    run_p.add_argument("--output-mp4", type=Path, default=None, help="全自动模式下成片 MP4 下载路径")

    return parser


def build_upload_route(args: argparse.Namespace) -> tuple[str, dict[str, str]]:
    """Construct exact ArcReel /api/v1/... upload route and query parameters from parsed CLI args."""
    q = urllib.parse.quote
    proj = q(slugify_project_name(args.project), safe="")
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

    if args.subcommand == "split-upload-grid":
        return asyncio.run(
            run_split_upload_grid(
                url=url,
                api_key=api_key,
                raw_project=args.project,
                grid_file=args.file,
                grid_spec=args.grid,
                shot_ids_csv=args.shot_ids,
                script_file=args.script_file,
                save_cells_dir=args.save_cells_dir,
                trim_px=args.trim_px,
            )
        )

    if args.subcommand in ("upload-asset", "upload-derivative", "upload-grid", "upload-shot"):
        try:
            route, params = build_upload_route(args)
        except ValueError as e:
            print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
            return 1
        code, payload = asyncio.run(upload_multipart(url, api_key, route, args.file, query_params=params))
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return code

    if args.subcommand == "export":
        return asyncio.run(
            run_export_command(
                url=url,
                api_key=api_key,
                raw_project=args.project,
                episode_id=args.episode_id,
                timeline_id=args.timeline,
                export_jianying=not args.no_jianying,
                render_mp4=not args.no_mp4,
                burn_subtitles=args.burn_subtitles,
                output_mp4=args.output_mp4,
            )
        )

    if args.subcommand == "run":
        raw_proj = args.project or args.novel.stem
        return asyncio.run(
            run_pipeline(
                url=url,
                api_key=api_key,
                novel_path=args.novel,
                raw_project_name=raw_proj,
                aspect_ratio=args.aspect_ratio,
                stage=args.stage,
                grid_storyboard=not args.no_grid,
                default_duration=args.default_duration,
                export_jianying=args.export_jianying,
                output_mp4=args.output_mp4,
            )
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
