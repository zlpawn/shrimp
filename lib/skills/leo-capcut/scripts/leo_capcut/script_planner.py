from __future__ import annotations

from .brief import CreativeBrief


def _allocate_seconds(duration: int, beat_count: int) -> list[int]:
    if beat_count <= 0:
        return []
    if duration < beat_count:
        return [1] * duration
    base, extra = divmod(duration, beat_count)
    return [base + (1 if index < extra else 0) for index in range(beat_count)]


def plan_script(brief: CreativeBrief, request_text: str) -> dict:
    duration = max(8, int(brief.duration_seconds))
    beats = list(brief.structure or ["hook", "body", "close"])
    slices = _allocate_seconds(duration, len(beats))
    lines = []
    for beat, seconds in zip(beats, slices):
        if seconds <= 0:
            continue
        if beat == "hook":
            text = f"{brief.title}：先把结论讲清楚。"
        elif beat in {"claim", "point", "pain", "goal"}:
            text = request_text.strip() or "把核心观点说完整。"
        elif beat in {"why", "proof", "steps"}:
            text = "用一个具体例子证明这个判断，而不是空喊口号。"
        else:
            text = "收在可执行的下一步，不要再加新观点。"
        lines.append({"beat": beat, "seconds": seconds, "text": text})
    if not lines:
        lines.append({"beat": "hook", "seconds": duration, "text": request_text.strip() or brief.title})
    return {"title": brief.title, "lines": lines, "duration_seconds": duration}
