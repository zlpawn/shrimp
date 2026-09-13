from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping


@dataclass
class CreativeBrief:
    title: str
    scenario: str
    secondary_scenarios: list[str]
    style: str
    platform: str
    duration_seconds: int
    hook_seconds: int
    pace: str
    canvas: dict[str, int]
    structure: list[str]
    quality_constraints: list[str]
    request: dict[str, Any]
    priority_trace: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "title": self.title,
            "scenario": self.scenario,
            "secondary_scenarios": self.secondary_scenarios,
            "style": self.style,
            "platform": self.platform,
            "duration_seconds": self.duration_seconds,
            "hook_seconds": self.hook_seconds,
            "pace": self.pace,
            "canvas": self.canvas,
            "structure": self.structure,
            "quality_constraints": self.quality_constraints,
        }


def _load_template(root: Path, kind: str, template_id: str) -> dict[str, Any]:
    path = root / kind / f"{template_id}.json"
    if not path.is_file():
        fallback = root / kind / "generic.json"
        if fallback.is_file() and template_id != "generic":
            return json.loads(fallback.read_text(encoding="utf-8"))
        if not path.is_file():
            return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    return []


def compose_brief(
    request: Mapping[str, Any] | None = None,
    *,
    project_settings: Mapping[str, Any] | None = None,
    user_preset: Mapping[str, Any] | None = None,
    template_root: Path | None = None,
) -> CreativeBrief:
    request = dict(request or {})
    project_settings = dict(project_settings or {})
    user_preset = dict(user_preset or {})
    template_root = Path(template_root) if template_root else Path(__file__).resolve().parents[2] / "assets" / "templates"

    inherits = dict(user_preset.get("inherits") or {})
    scenario = str(request.get("scenario") or inherits.get("scenario") or "generic")
    platform = str(request.get("platform") or inherits.get("platform") or "douyin")
    style = str(request.get("style") or inherits.get("style") or "clean-vertical")
    secondary = _as_list(request.get("secondary_scenarios") or inherits.get("secondary_scenarios"))

    scenario_tpl = _load_template(template_root, "scenarios", scenario) or _load_template(template_root, "scenarios", "generic")
    if not scenario_tpl:
        scenario_tpl = {"id": "generic", "duration_seconds": 15, "hook_seconds": 3, "pace": "medium", "canvas": {"width": 1080, "height": 1920, "fps": 30}, "structure": ["hook", "body", "close"], "quality_constraints": []}
        scenario = "generic"
    platform_tpl = _load_template(template_root, "platforms", platform) or _load_template(template_root, "platforms", "generic")
    style_tpl = _load_template(template_root, "styles", style) or _load_template(template_root, "styles", "clean-vertical")

    layers = [
        ("system", {"duration_seconds": 15, "hook_seconds": 3, "pace": "medium", "canvas": {"width": 1080, "height": 1920, "fps": 30}}),
        ("scenario", scenario_tpl),
        ("platform", platform_tpl),
        ("style", style_tpl),
        ("user_preset", dict(user_preset.get("overrides") or {})),
        ("project", project_settings),
        ("request", request),
    ]
    merged: dict[str, Any] = {}
    trace: list[dict[str, Any]] = []
    for source, layer in layers:
        applied = {key: layer[key] for key in ("duration_seconds", "hook_seconds", "pace", "canvas", "title") if key in layer}
        if applied:
            merged.update(applied)
            trace.append({"source": source, "applied": applied})

    constraints: list[str] = []
    for item in scenario_tpl.get("quality_constraints", []):
        constraints.append(str(item))
    for extra_id in secondary:
        extra = _load_template(template_root, "scenarios", extra_id)
        for item in extra.get("quality_constraints", []):
            text = str(item)
            if text not in constraints:
                constraints.append(text)

    canvas = dict(merged.get("canvas") or scenario_tpl.get("canvas") or {"width": 1080, "height": 1920, "fps": 30})
    if platform_tpl.get("canvas"):
        canvas = dict(platform_tpl["canvas"])
        if request.get("canvas"):
            canvas = dict(request["canvas"])

    return CreativeBrief(
        title=str(merged.get("title") or request.get("title") or "未命名视频"),
        scenario=str(scenario_tpl.get("id") or scenario),
        secondary_scenarios=secondary,
        style=str(style_tpl.get("id") or style),
        platform=str(platform_tpl.get("id") or platform),
        duration_seconds=int(merged.get("duration_seconds") or 15),
        hook_seconds=int(merged.get("hook_seconds") or 3),
        pace=str(merged.get("pace") or "medium"),
        canvas={"width": int(canvas.get("width", 1080)), "height": int(canvas.get("height", 1920)), "fps": int(canvas.get("fps", 30))},
        structure=[str(item) for item in scenario_tpl.get("structure", ["hook", "body", "close"])],
        quality_constraints=constraints,
        request=dict(request),
        priority_trace=trace,
    )
