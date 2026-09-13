#!/usr/bin/env python3
"""Command-line entry for leo-capcut."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.detect import detect_environment
from leo_capcut.orchestrator import run_pipeline
from leo_capcut.preset_store import PresetStore


def cmd_doctor(_: argparse.Namespace) -> int:
    env = detect_environment(sys.platform)
    adapter = JianyingAdapter.detect(sys.platform)
    payload = {"environment": env, "capabilities": adapter.capabilities()}
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_publish(args: argparse.Namespace) -> int:
    media = [Path(item) for item in (args.media or [])]
    result = run_pipeline(
        args.text,
        media_paths=media,
        template_root=ROOT / "assets" / "templates",
        publish=False,
    )
    draft_root = Path(args.draft_root) if args.draft_root else Path.cwd() / "leo-capcut-output"
    user_data = Path(args.user_data) if args.user_data else draft_root / "user-data"
    draft_root.mkdir(parents=True, exist_ok=True)
    user_data.mkdir(parents=True, exist_ok=True)
    adapter = JianyingAdapter.detect(
        sys.platform,
        draft_root=draft_root,
        user_data=user_data,
        install_dir=Path(args.install_dir) if args.install_dir else None,
    )
    published = adapter.publish(result.timeline, project_name=args.name or result.brief.title, register=bool(args.register))
    print(json.dumps({
        "brief": result.brief.to_dict(),
        "draft_dir": published.draft_dir,
        "project_id": published.project_id,
        "registered": published.registered,
        "backup_path": published.backup_path,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_plan(args: argparse.Namespace) -> int:
    media = [Path(item) for item in (args.media or [])]
    result = run_pipeline(
        args.text,
        media_paths=media,
        template_root=ROOT / "assets" / "templates",
        publish=False,
    )
    print(json.dumps({
        "brief": result.brief.to_dict(),
        "script": result.artifacts["script"],
        "storyboard": result.artifacts["storyboard"],
        "timeline": result.timeline.raw,
    }, ensure_ascii=False, indent=2))
    return 0


def cmd_save_preset(args: argparse.Namespace) -> int:
    store = PresetStore(Path(args.store) if args.store else Path.home() / ".leo-capcut" / "presets")
    saved = store.save(
        {
            "id": args.id,
            "inherits": {"scenario": args.scenario, "platform": args.platform, "style": args.style},
            "overrides": {"duration_seconds": args.duration} if args.duration else {},
        },
        explicit=True,
        intent=args.intent,
    )
    print(json.dumps({"id": saved["id"], "path": saved["path"]}, ensure_ascii=False, indent=2))
    return 0


def cmd_catalog(_: argparse.Namespace) -> int:
    from leo_capcut.registry import AssetRegistry
    reg = AssetRegistry.get()
    cats = reg.list_categories()
    payload = {
        "total_categories": len(cats),
        "total_native_assets": sum(cats.values()),
        "categories": cats,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def cmd_query_enum(args: argparse.Namespace) -> int:
    from leo_capcut.registry import AssetRegistry
    reg = AssetRegistry.get()
    results = reg.search(args.category, keyword=args.keyword or "", limit=args.limit)
    payload = {
        "category": args.category,
        "keyword": args.keyword,
        "count": len(results),
        "results": results,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="leo-capcut")
    sub = parser.add_subparsers(dest="command", required=True)

    doctor = sub.add_parser("doctor")
    doctor.set_defaults(func=cmd_doctor)

    plan = sub.add_parser("plan")
    plan.add_argument("--text", required=True)
    plan.add_argument("--media", action="append")
    plan.set_defaults(func=cmd_plan)

    publish = sub.add_parser("publish")
    publish.add_argument("--text", required=True)
    publish.add_argument("--media", action="append")
    publish.add_argument("--name")
    publish.add_argument("--draft-root")
    publish.add_argument("--user-data")
    publish.add_argument("--install-dir")
    publish.add_argument("--register", action="store_true")
    publish.set_defaults(func=cmd_publish)

    save = sub.add_parser("save-preset")
    save.add_argument("--intent", required=True)
    save.add_argument("--id", required=True)
    save.add_argument("--scenario", default="generic")
    save.add_argument("--platform", default="douyin")
    save.add_argument("--style", default="clean-vertical")
    save.add_argument("--duration", type=int)
    save.add_argument("--store")
    save.set_defaults(func=cmd_save_preset)

    catalog = sub.add_parser("catalog")
    catalog.set_defaults(func=cmd_catalog)

    query = sub.add_parser("query-enum")
    query.add_argument("--category", required=True)
    query.add_argument("--keyword", default="")
    query.add_argument("--limit", type=int, default=20)
    query.set_defaults(func=cmd_query_enum)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
