#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "mcp>=1.2.0",
#     "httpx>=0.27.0",
#     "socksio>=1.0.0",
# ]
# ///
"""ArcReel Headless MCP Bridge for leo-video-router and external Agents.

Acts as a universal MCP client bridging ArcReel's capabilities to any Agent:
1. Dynamic Tool Discovery: `arcreel_bridge.py tools`
2. Dynamic Tool Calling:   `arcreel_bridge.py call <tool_name> [--args '<json>']`
3. Server Health Check:     `arcreel_bridge.py status`
4. Macro Orchestration:     `arcreel_bridge.py run --novel <file> [--stage <plan|storyboard|video|export|all>] [--export-jianying]`

Exit codes: 0 ok, 1 execution/MCP error, 2 connection/auth error.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any

import httpx

try:
    from mcp import ClientSession
    from mcp.client.streamable_http import streamable_http_client
    from mcp.types import CallToolResult
    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False

DEFAULT_MCP_URL = "http://localhost:1241/mcp"
DEFAULT_CONFIG_PATH = Path.home() / ".shrimp" / "skills" / "leo-video-router" / "config.json"
DEFAULT_TOKEN_FILE = Path.home() / ".shrimp" / "skills" / "leo-video-router" / "arcreel_token"


def read_token_from_file() -> str | None:
    """Read ArcReel API Token strictly from ~/.shrimp/skills/leo-video-router/arcreel_token."""
    if DEFAULT_TOKEN_FILE.exists() and DEFAULT_TOKEN_FILE.is_file():
        try:
            token = DEFAULT_TOKEN_FILE.read_text(encoding="utf-8").strip()
            if token:
                return token
        except Exception:
            pass
    return None


def save_token_to_file(token: str, target_file: Path | None = None) -> Path:
    """Save ArcReel API Token strictly to ~/.shrimp/skills/leo-video-router/arcreel_token."""
    f = target_file or DEFAULT_TOKEN_FILE
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(token.strip() + "\n", encoding="utf-8")
    return f


def get_config() -> dict[str, Any]:
    """Read router config or fallback."""
    cfg_path = Path(os.environ.get("LEO_VIDEO_CONFIG_PATH", DEFAULT_CONFIG_PATH))
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


async def check_server_status(url: str, api_key: str | None) -> dict[str, Any]:
    """Check connectivity to ArcReel server."""
    base_url = url.split("/mcp")[0]
    result: dict[str, Any] = {
        "mcp_url": url,
        "base_url": base_url,
        "api_key_configured": bool(api_key),
        "token_file": str(DEFAULT_TOKEN_FILE),
        "token_file_exists": DEFAULT_TOKEN_FILE.exists(),
        "online": False,
        "system_status": None,
        "error": None,
    }
    async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
        try:
            # Check root or system endpoint
            headers = {}
            if api_key:
                headers["Authorization"] = f"Bearer {api_key}"
            resp = await client.get(f"{base_url}/api/system/version", headers=headers)
            if resp.status_code == 200:
                result["online"] = True
                result["system_status"] = resp.json()
            elif resp.status_code in (401, 403):
                result["online"] = True
                result["error"] = "Authentication failed (API Key required or invalid)"
            else:
                # Check root
                resp_root = await client.get(f"{base_url}/")
                result["online"] = (resp_root.status_code < 500)
        except Exception as e:
            result["error"] = f"Connection failed: {e}"
    return result


async def list_mcp_tools(url: str, api_key: str | None, format_mode: str = "json") -> int:
    """Discover all tools dynamically from ArcReel MCP server."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed. Run with `uv run` to auto-resolve dependencies."}, ensure_ascii=False))
        return 2

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                tools_res = await session.list_tools()
                
                tools_data = []
                for t in tools_res.tools:
                    tools_data.append({
                        "name": t.name,
                        "description": t.description,
                        "inputSchema": t.inputSchema,
                    })

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


async def call_mcp_tool(url: str, api_key: str | None, tool_name: str, arguments: dict[str, Any]) -> int:
    """Call an arbitrary tool dynamically via MCP."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed"}, ensure_ascii=False), file=sys.stderr)
        return 2

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                res: CallToolResult = await session.call_tool(tool_name, arguments)
                
                output: dict[str, Any] = {
                    "tool": tool_name,
                    "isError": res.isError,
                    "content": [],
                }
                
                if res.structuredContent:
                    output["structuredContent"] = res.structuredContent

                for c in res.content:
                    if hasattr(c, "text"):
                        try:
                            # Try parsing text as json for cleaner perception
                            output["content"].append(json.loads(c.text))
                        except Exception:
                            output["content"].append(c.text)
                    elif hasattr(c, "data"):
                        output["content"].append(f"[Binary Data: {len(c.data)} bytes]")

                print(json.dumps(output, ensure_ascii=False, indent=2))
                return 1 if res.isError else 0
    except Exception as e:
        print(json.dumps({"tool": tool_name, "isError": True, "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 2


async def poll_batch_until_done(
    session: ClientSession,
    project: str,
    batch_token: str,
    poll_interval: float = 3.0,
    max_wait_seconds: float = 600.0,
) -> dict[str, Any]:
    """Poll get_generation_batch until all items in batch are terminal."""
    elapsed = 0.0
    while elapsed < max_wait_seconds:
        res = await session.call_tool("get_generation_batch", {"project": project, "generation_batch": batch_token})
        if res.isError:
            raise RuntimeError(f"轮询批次失败: {res.content}")
        
        status_obj: dict[str, Any] = {}
        for c in res.content:
            if hasattr(c, "text"):
                try:
                    status_obj = json.loads(c.text)
                    break
                except Exception:
                    pass
        if res.structuredContent:
            status_obj = res.structuredContent

        done = status_obj.get("done", False)
        succeeded = status_obj.get("succeeded_count", 0)
        failed = status_obj.get("failed_count", 0)
        total = status_obj.get("total_count", 0)
        print(f"⏳ [进度] 批次处理中: {succeeded}/{total} 成功, {failed} 失败... ({elapsed:.0f}s)", file=sys.stderr)

        if done:
            return status_obj

        interval = status_obj.get("poll_after_seconds", poll_interval)
        await asyncio.sleep(interval)
        elapsed += interval

    raise TimeoutError(f"批次生成超时 (等待超过 {max_wait_seconds} 秒)")


async def run_pipeline(
    url: str,
    api_key: str | None,
    novel_path: Path,
    project_name: str,
    style: str,
    aspect_ratio: str,
    stage: str,
    export_jianying: bool,
    output_dir: Path | None,
) -> int:
    """Run an automated multi-stage video generation pipeline using MCP tools."""
    if not MCP_AVAILABLE:
        print(json.dumps({"error": "mcp library not installed"}, ensure_ascii=False), file=sys.stderr)
        return 2

    if not novel_path.exists():
        print(json.dumps({"error": f"输入文本文件不存在: {novel_path}"}, ensure_ascii=False), file=sys.stderr)
        return 1

    headers = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    novel_content = novel_path.read_text(encoding="utf-8", errors="replace")
    
    print(f"🚀 [ArcReel Pipeline] 启动工程: {project_name}")
    print(f"📄 源文件: {novel_path} ({len(novel_content)} 字)")
    print(f"🎯 阶段: {stage} | 风格: {style} | 画幅: {aspect_ratio}")

    try:
        async with streamable_http_client(url, headers=headers) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()

                # Step 1: 检查或创建项目
                print(f"▶ [1/5] 创建/确认项目: {project_name}...", file=sys.stderr)
                create_res = await session.call_tool(
                    "create_project",
                    {
                        "name": project_name,
                        "title": project_name,
                        "content_mode": "drama",
                        "generation_mode": "grid",
                        "aspect_ratio": aspect_ratio,
                    }
                )
                if create_res.isError and "project_exists" not in str(create_res.content):
                    print(json.dumps({"step": "create_project", "isError": True, "details": str(create_res.content)}, ensure_ascii=False))
                    return 1

                # Step 2: 上传/解析源文本并拆解剧本 (author_script_plan)
                print(f"▶ [2/5] 上传小说并执行剧本规划 (author_script_plan)...", file=sys.stderr)
                upload_res = await session.call_tool(
                    "upload_source",
                    {
                        "project": project_name,
                        "filename": novel_path.name,
                        "text": novel_content,
                        "role": "whole_source",
                    }
                )
                
                # 规划分集与剧本
                plan_res = await session.call_tool(
                    "author_script_plan",
                    {
                        "project": project_name,
                        "episode_id": "01",
                        "instruction": f"按风格【{style}】拆解小说前序剧情，提取主角、场景与核心冲突分镜",
                    }
                )
                if plan_res.isError:
                    print(json.dumps({"step": "author_script_plan", "isError": True, "details": str(plan_res.content)}, ensure_ascii=False))
                    return 1

                print("✅ 剧本拆解完成！", file=sys.stderr)
                if stage == "plan":
                    print(json.dumps({"status": "plan_complete", "project": project_name}, ensure_ascii=False, indent=2))
                    return 0

                # Step 3: 四宫格/九宫格分镜生成与切片
                print(f"▶ [3/5] 提交四宫格分镜图生成与切片 (generate_grid_storyboard)...", file=sys.stderr)
                grid_res = await session.call_tool(
                    "generate_grid_storyboard",
                    {
                        "project": project_name,
                        "episode_id": "01",
                        "style": style,
                    }
                )
                if grid_res.isError:
                    print(json.dumps({"step": "generate_grid_storyboard", "isError": True, "details": str(grid_res.content)}, ensure_ascii=False))
                    return 1

                if stage == "storyboard":
                    print(json.dumps({"status": "storyboard_complete", "project": project_name}, ensure_ascii=False, indent=2))
                    return 0

                # Step 4: 视频与音频单元生成
                print(f"▶ [4/5] 批量推进视频镜头生成...", file=sys.stderr)
                vid_res = await session.call_tool(
                    "generate_video",
                    {
                        "project": project_name,
                        "episode_id": "01",
                    }
                )
                if vid_res.isError:
                    print(json.dumps({"step": "generate_video", "isError": True, "details": str(vid_res.content)}, ensure_ascii=False))
                    return 1

                # 解析批次 token 并轮询
                batch_token = None
                for c in vid_res.content:
                    if hasattr(c, "text") and "generation_batch" in c.text:
                        try:
                            parsed = json.loads(c.text)
                            batch_token = parsed.get("generation_batch")
                        except Exception:
                            pass
                if not batch_token and vid_res.structuredContent:
                    batch_token = vid_res.structuredContent.get("generation_batch")

                if batch_token:
                    print(f"⏳ 批次任务在途 (token: {batch_token})，开始安全轮询...", file=sys.stderr)
                    await poll_batch_until_done(session, project_name, batch_token)

                if stage == "video":
                    print(json.dumps({"status": "video_complete", "project": project_name}, ensure_ascii=False, indent=2))
                    return 0

                # Step 5: 导出成片 / 剪映工程包
                exported_files: dict[str, str] = {}
                if export_jianying:
                    print(f"▶ [5/5] 导出剪映草稿工程 (export_jianying_draft)...", file=sys.stderr)
                    draft_res = await session.call_tool(
                        "export_jianying_draft",
                        {"project": project_name, "timeline_id": "01"}
                    )
                    exported_files["jianying_draft"] = str(draft_res.content)

                # 合成最终 MP4
                print(f"▶ 本地音视频合成 (render_final_cut)...", file=sys.stderr)
                render_res = await session.call_tool(
                    "render_final_cut",
                    {"project": project_name, "timeline_id": "01"}
                )
                exported_files["final_cut"] = str(render_res.content)

                result_summary = {
                    "status": "success",
                    "project": project_name,
                    "stage": stage,
                    "exported": exported_files,
                }
                print(json.dumps(result_summary, ensure_ascii=False, indent=2))
                return 0
    except Exception as e:
        print(json.dumps({"status": "failed", "error": str(e)}, ensure_ascii=False), file=sys.stderr)
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="ArcReel MCP Bridge for leo-video-router")
    parser.add_argument("--url", default=None, help="ArcReel MCP URL (default: http://localhost:1241/mcp)")
    parser.add_argument("--api-key", default=None, help="ArcReel API Key (arc-xxxx)")

    sub = parser.add_subparsers(dest="subcommand", required=True)

    # status
    sub.add_parser("status", help="检查 ArcReel 服务状态与连通性")

    # set-token
    set_token_p = sub.add_parser("set-token", help="将 ArcReel API Token 保存到本地配置文件中")
    set_token_p.add_argument("token", help="ArcReel API Key (arc-xxxx)")
    set_token_p.add_argument("--file", type=Path, default=None, help=f"目标文件路径（默认 {DEFAULT_TOKEN_FILE}）")

    # tools
    tools_p = sub.add_parser("tools", help="动态列出 ArcReel 所有可用 MCP 工具清单")
    tools_p.add_argument("--format", choices=["json", "markdown"], default="markdown", help="输出格式")

    # call
    call_p = sub.add_parser("call", help="动态调用任意 MCP 工具并输出结果")
    call_p.add_argument("tool", help="工具名称 (如 create_project, list_projects, export_jianying_draft)")
    call_p.add_argument("args", nargs="?", default="{}", help="JSON 格式入参或为空")

    # run / pipeline
    run_p = sub.add_parser("run", help="一键执行小说漫剧端到端流水线")
    run_p.add_argument("--novel", required=True, type=Path, help="小说/剧本源文件路径 (.txt, .md)")
    run_p.add_argument("--project", default=None, help="项目名称（缺省自动根据文件名派生）")
    run_p.add_argument("--style", default="default", help="生图风格模板名称")
    run_p.add_argument("--aspect-ratio", default="9:16", choices=["9:16", "16:9"], help="画幅比例")
    run_p.add_argument("--stage", choices=["all", "plan", "storyboard", "video", "export"], default="all", help="执行阶段截断")
    run_p.add_argument("--export-jianying", action="store_true", default=True, help="是否导出剪映草稿工程")
    run_p.add_argument("--output-dir", type=Path, default=None, help="成片产物导出目录")

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
        return asyncio.run(call_mcp_tool(url, api_key, args.tool, parsed_args))

    if args.subcommand == "run":
        proj_name = args.project or args.novel.stem.replace(" ", "_")
        return asyncio.run(run_pipeline(
            url=url,
            api_key=api_key,
            novel_path=args.novel,
            project_name=proj_name,
            style=args.style,
            aspect_ratio=args.aspect_ratio,
            stage=args.stage,
            export_jianying=args.export_jianying,
            output_dir=args.output_dir,
        ))

    return 0


if __name__ == "__main__":
    sys.exit(main())
