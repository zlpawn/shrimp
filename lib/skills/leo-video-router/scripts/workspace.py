#!/usr/bin/env python3
"""Workspace and configuration manager for leo-video-router.

Provides 3-tier cascade resolution for video output workspace:
1. User explicitly specified directory (persisted to config.json)
2. History workspace directory from ~/.shrimp/skills/leo-video-router/config.json
3. Fallback to ~/.shrimp/skills/leo-video-router/output/

Usage:
  python workspace.py status
  python workspace.py set-workspace <dir>
  python workspace.py init <topic> [--workspace <dir>]
  python workspace.py resolve <topic> [--workspace <dir>]
Exit codes: 0 ok, 3 config.json is corrupt or unreadable.
"""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path
from typing import Optional, Dict, Any


class ConfigError(Exception):
    """config.json is corrupt or unreadable; never overwrite it."""


def absolute_path(path: str) -> Path:
    return Path(path.strip()).expanduser().resolve()


def get_config_path() -> Path:
    """Returns the path to the configuration file.
    Defaults to ~/.shrimp/skills/leo-video-router/config.json.
    Supports LEO_VIDEO_CONFIG_PATH or LEO_VIDEO_ROUTER_HOME overrides.
    """
    env_cfg = os.environ.get("LEO_VIDEO_CONFIG_PATH")
    if env_cfg:
        return Path(env_cfg).resolve()

    router_home = os.environ.get("LEO_VIDEO_ROUTER_HOME")
    if router_home:
        return Path(router_home).resolve() / "config.json"

    return Path.home() / ".shrimp" / "skills" / "leo-video-router" / "config.json"


def get_default_output_dir() -> Path:
    """Returns default fallback output directory: ~/.shrimp/skills/leo-video-router/output"""
    router_home = os.environ.get("LEO_VIDEO_ROUTER_HOME")
    if router_home:
        return Path(router_home).resolve() / "output"
    return Path.home() / ".shrimp" / "skills" / "leo-video-router" / "output"


def read_config() -> Dict[str, Any]:
    """Reads configuration from ~/.shrimp/skills/leo-video-router/config.json.
    Returns defaults if not present; raises ConfigError if corrupt.
    """
    cfg_path = get_config_path()
    defaults = {
        "workspace_dir": "",
        "updated_at": None,
    }

    if not cfg_path.exists():
        return defaults

    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:  # ValueError includes UnicodeDecodeError
        raise ConfigError(f"{cfg_path} is corrupt or unreadable ({e}); fix or delete it") from e
    if not isinstance(data, dict):
        raise ConfigError(f"{cfg_path} is corrupt (expected a JSON object); fix or delete it")
    return {**defaults, **data}


def write_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Writes configuration to ~/.shrimp/skills/leo-video-router/config.json atomically."""
    cfg_path = get_config_path()
    cfg_path.parent.mkdir(parents=True, exist_ok=True)

    payload = {
        **config,
        "updated_at": datetime.datetime.now().astimezone().isoformat(),
    }

    tmp_file = cfg_path.parent / f".config-{os.getpid()}.tmp"
    try:
        tmp_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_file.replace(cfg_path)
    finally:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except OSError:
                pass

    return payload


def update_config(partial: Dict[str, Any]) -> Dict[str, Any]:
    """Updates partial configuration fields and persists."""
    current = read_config()
    current.update(partial)
    return write_config(current)


def resolve_workspace_dir(user_specified_dir: Optional[str] = None, persist: bool = True) -> Dict[str, Any]:
    """Resolves effective workspace directory with smart persistence:
    1. User explicitly specified -> persists to config.json (unless persist=False)
    2. config.json workspace_dir -> reuses silently
    3. fallback -> ~/.shrimp/skills/leo-video-router/output/
    """
    if user_specified_dir and str(user_specified_dir).strip():
        resolved = absolute_path(str(user_specified_dir))
        if persist:
            update_config({"workspace_dir": str(resolved)})
        return {
            "dir": str(resolved),
            "source": "user_specified",
            "persisted": persist,
        }

    cfg = read_config()
    cfg_ws = cfg.get("workspace_dir")
    if cfg_ws and isinstance(cfg_ws, str) and cfg_ws.strip():
        resolved = absolute_path(cfg_ws)
        return {
            "dir": str(resolved),
            "source": "config",
            "persisted": False,
        }

    def_dir = get_default_output_dir().resolve()
    return {
        "dir": str(def_dir),
        "source": "default",
        "persisted": False,
    }


def format_project_folder_name(topic: str, project_date: Optional[datetime.date] = None) -> str:
    """Formats a video topic into standard YYYY-MM-DD-topic folder name.
    Cleans illegal path characters and spaces.
    """
    if project_date is None:
        project_date = datetime.date.today()

    date_prefix = project_date.strftime("%Y-%m-%d")
    clean_topic = (topic or "未命名视频").strip()

    # Replace forbidden path characters with '-'; no separator left means no path traversal
    clean_topic = re.sub(r'[\\/:*?"<>|]+', "-", clean_topic)
    clean_topic = re.sub(r"\s+", "-", clean_topic)
    clean_topic = clean_topic.strip("-. ")

    if not clean_topic:
        clean_topic = "未命名视频"

    # If topic already starts with YYYY-MM-DD, keep it
    if re.match(r"^\d{4}-\d{2}-\d{2}", clean_topic):
        return clean_topic

    return f"{date_prefix}-{clean_topic}"


def resolve_project_dir(
    topic: str,
    user_specified_dir: Optional[str] = None,
    project_date: Optional[datetime.date] = None,
    persist: bool = True,
) -> Dict[str, Any]:
    """Resolves standard video project directory under effective workspace."""
    ws = resolve_workspace_dir(user_specified_dir, persist)
    folder_name = format_project_folder_name(topic, project_date)
    project_path = Path(ws["dir"]) / folder_name

    return {
        "project_path": str(project_path),
        "folder_name": folder_name,
        "workspace_dir": ws["dir"],
        "workspace_source": ws["source"],
        "persisted": ws["persisted"],
        "publish_dir": str(project_path / "成片" / "发布版"),
        "raw_dir": str(project_path / "成片" / "原始版"),
        "audio_dir": str(project_path / "音频"),
        "assets_dir": str(project_path / "素材"),
    }


def init_project_dir(
    topic: str,
    user_specified_dir: Optional[str] = None,
    project_date: Optional[datetime.date] = None,
) -> Dict[str, Any]:
    """Creates the standard directory tree and starter files for a video project:
    <workspace_dir>/
    └── YYYY-MM-DD-视频主题/
        ├── 交付记录.md
        ├── 脚本.md
        ├── 音频/
        ├── 素材/
        └── 成片/
            ├── 发布版/
            └── 原始版/
    """
    res = resolve_project_dir(topic, user_specified_dir, project_date)
    project_path = Path(res["project_path"])

    publish_dir = Path(res["publish_dir"])
    raw_dir = Path(res["raw_dir"])
    audio_dir = Path(res["audio_dir"])
    assets_dir = Path(res["assets_dir"])

    # Create directories
    publish_dir.mkdir(parents=True, exist_ok=True)
    raw_dir.mkdir(parents=True, exist_ok=True)
    audio_dir.mkdir(parents=True, exist_ok=True)
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Initial 脚本.md
    script_file = project_path / "脚本.md"
    if not script_file.exists():
        script_content = f"""# 《{topic}》分镜与剧本

> **项目主题**：{topic}  
> **归档目录**：`{res['folder_name']}`  
> **创建日期**：{datetime.date.today().strftime('%Y-%m-%d')}  

---

## 一、 基本设定
- **题材模式**：悬疑微短剧 / 讲解动画 / 科技评测 (根据需求选定)
- **预估时长**：1~3 分钟
- **视觉美学**：暗调电影质感 (Low-Key) / 冷青与暖琥珀光影对冲 / 平稳慢推镜

---

## 二、 镜头与分镜设计 (Scene Breakdown)

### 镜头 01（破局钩子）
- **景别机位**：特写 / 慢速推镜 (`cinematic slow push-in`)
- **画面描述 (Prompt)**：
- **台词对白 (Audio)**：
- **音效/拟音 (Foley)**：

### 镜头 02（矛盾展开）
- **景别机位**：中景 / 侧光对峙
- **画面描述 (Prompt)**：
- **台词对白 (Audio)**：
- **音效/拟音 (Foley)**：

---

## 三、 提示词工程 (下游引擎)
```text
(待生成或填入提示词公式)
```
"""
        script_file.write_text(script_content, encoding="utf-8")

    # Initial 交付记录.md
    record_file = project_path / "交付记录.md"
    if not record_file.exists():
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        record_content = f"""# 《{topic}》视频交付记录

- **创建时间**：{now_str}
- **归档路径**：`{project_path}`
- **选用下游项目**：待指定 (MoneyPrinterTurbo / OpenMontage / hypit / lemo-opuscar / xilo-opus-video / dashi-animationstyle / huashu-art-motion / video-shotcraft)
- **音频来源**：VoiceStudio omnivoice / 用户录音 / 下游TTS
- **字幕处理**：待处理（下游已烧录字幕 / subtitle_engine 重排压制 / 不需要字幕）

---

## 平台分发建议 (Bilibili / 社交平台)
- **首选发布平台**：哔哩哔哩 (Bilibili) 优先，联动 `leo-lantern` 自动发布
- **去 AI 标签原生标题**：《{topic}》
- **极简一句话悬念简介**：（待提炼，≤ 50 字符）
- **建议发布排期**：次日 16:30（黄金高峰时段）
- **平台合规标签**：声明为自制，规范勾选「含AI生成内容」

---

## 交付文件清单
- [ ] 成片/原始版/{res['folder_name']}.mp4
- [ ] 成片/发布版/{res['folder_name']}_with_subtitles.mp4
- [ ] 成片/发布版/{res['folder_name']}.srt
- [ ] 成片/发布版/封面.png（可选：下游或用户提供）
"""
        record_file.write_text(record_content, encoding="utf-8")

    return res


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="leo-video-router workspace and config manager")
    subparsers = parser.add_subparsers(dest="subcommand", help="Subcommand to execute")

    # status
    subparsers.add_parser("status", help="Show current configuration and workspace status")

    # set-workspace
    p_set = subparsers.add_parser("set-workspace", help="Set and persist default workspace directory")
    p_set.add_argument("dir", help="Directory path to set as default workspace")

    # init
    p_init = subparsers.add_parser("init", help="Initialize a standard video project directory structure")
    p_init.add_argument("topic", help="Video topic / project title")
    p_init.add_argument("--workspace", default=None, help="Explicit workspace directory override")

    # resolve
    p_resolve = subparsers.add_parser("resolve", help="Resolve project directory paths without writing anything")
    p_resolve.add_argument("topic", help="Video topic / project title")
    p_resolve.add_argument("--workspace", default=None, help="Explicit workspace directory override")

    args = parser.parse_args(argv)

    try:
        if args.subcommand == "status":
            cfg = read_config()
            cfg_path = get_config_path()
            ws = resolve_workspace_dir()
            print(json.dumps({
                "config_path": str(cfg_path),
                "config_exists": cfg_path.exists(),
                "config": cfg,
                "effective_workspace": ws["dir"],
                "workspace_source": ws["source"],
                "default_fallback": str(get_default_output_dir()),
            }, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "set-workspace":
            resolved = absolute_path(args.dir)
            update_config({"workspace_dir": str(resolved)})
            print(f"✅ 工作区目录已更新并持久化记忆: {resolved}")
            print(f"配置文件: {get_config_path()}")
            return 0

        if args.subcommand == "init":
            res = init_project_dir(args.topic, user_specified_dir=args.workspace)
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0

        if args.subcommand == "resolve":
            res = resolve_project_dir(args.topic, user_specified_dir=args.workspace, persist=False)
            print(json.dumps(res, ensure_ascii=False, indent=2))
            return 0
    except ConfigError as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return 3

    parser.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
