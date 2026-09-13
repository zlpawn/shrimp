from __future__ import annotations

import re
from typing import Any


SCENARIO_HINTS = (
    ("knowledge-talk", ("知识", "口播", "观点", "讲解", "为什么")),
    ("product-promo", ("产品", "宣传", "种草", "卖点")),
    ("tutorial", ("教程", "步骤", "怎么做", "演示")),
)

PLATFORM_HINTS = (
    ("douyin", ("抖音", "douyin", "竖屏")),
    ("generic", ("通用",)),
)


def parse_request_text(text: str) -> dict[str, Any]:
    request: dict[str, Any] = {"title": text.strip()[:40] or "未命名视频"}
    duration = re.search(r"(\d+)\s*秒", text)
    if duration:
        request["duration_seconds"] = int(duration.group(1))
    for scenario, tokens in SCENARIO_HINTS:
        if any(token in text for token in tokens):
            request["scenario"] = scenario
            break
    for platform, tokens in PLATFORM_HINTS:
        if any(token.lower() in text.lower() for token in tokens):
            request["platform"] = platform
            break
    return request
