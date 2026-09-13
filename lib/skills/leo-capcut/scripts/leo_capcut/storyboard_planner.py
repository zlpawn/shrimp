from __future__ import annotations

from pathlib import Path
from typing import Sequence

from .brief import CreativeBrief


def plan_storyboard(brief: CreativeBrief, script: dict, media_paths: Sequence[Path]) -> dict:
    shots = []
    media = [Path(path) for path in media_paths]
    start = 0
    for index, line in enumerate(script["lines"]):
        duration_us = int(line["seconds"]) * 1_000_000
        shots.append(
            {
                "id": f"shot-{index+1}",
                "start_us": start,
                "duration_us": duration_us,
                "media": str(media[index % len(media)]) if media else None,
                "caption": line["text"],
                "title": brief.title if index == 0 else "",
            }
        )
        start += duration_us
    return {"shots": shots, "duration_us": start or brief.duration_seconds * 1_000_000}
