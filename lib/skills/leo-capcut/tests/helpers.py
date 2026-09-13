from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def sample_timeline(project_name: str = "demo") -> dict:
    return {
        "schema_version": "1.0",
        "project_name": project_name,
        "canvas": {"width": 1080, "height": 1920, "fps": 30},
        "duration_us": 4_000_000,
        "assets": [
            {
                "id": "clip-a",
                "kind": "video",
                "uri": "file://clip-a.mp4",
                "duration_us": 4_000_000,
            }
        ],
        "tracks": [
            {
                "id": "video-1",
                "type": "video",
                "name": "主画面",
                "clips": [
                    {
                        "id": "v1",
                        "start_us": 0,
                        "duration_us": 4_000_000,
                        "asset_id": "clip-a",
                    }
                ],
            },
            {
                "id": "text-1",
                "type": "text",
                "name": "字幕",
                "clips": [
                    {
                        "id": "t1",
                        "start_us": 200_000,
                        "duration_us": 3_000_000,
                        "text": "先讲结论",
                    }
                ],
            },
        ],
    }
