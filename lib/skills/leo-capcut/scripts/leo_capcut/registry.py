from __future__ import annotations

import difflib
import enum
from typing import Any

from .jianying_writer import _load_vendor

CATEGORY_MAP: dict[str, str] = {
    "transitions": "TransitionType",
    "filters": "FilterType",
    "video_scene_effects": "VideoSceneEffectType",
    "video_character_effects": "VideoCharacterEffectType",
    "video_intros": "IntroType",
    "video_outros": "OutroType",
    "video_combos": "GroupAnimationType",
    "text_intros": "TextIntro",
    "text_outros": "TextOutro",
    "text_loops": "TextLoopAnim",
    "text_effects": "TextEffectType",
    "text_bubbles": "TextBubbleType",
    "fonts": "FontType",
    "audio_scene_effects": "AudioSceneEffectType",
    "tone_effects": "ToneEffectType",
    "speech_to_song": "SpeechToSongType",
    "beauty": "BeautyType",
    "skin_tone": "SkinToneType",
    "masks": "MaskType",
    "mix_modes": "MixModeType",
    "keyframe_properties": "KeyframeProperty",
}

SAFE_FALLBACKS: dict[str, str] = {
    "transitions": "叠化",
    "filters": "_1980",
    "video_scene_effects": "_90s画质",
    "video_character_effects": "光环_I",
    "video_intros": "向上滑动",
    "video_outros": "渐隐",
    "video_combos": "缩小旋转",
    "text_intros": "冲屏位移",
    "text_outros": "向上滑动",
    "text_loops": "扫光",
    "text_effects": "潮酷发光立体花字",
    "text_bubbles": "标题58",
    "fonts": "宋体",
    "tone_effects": "解说小帅",
    "audio_scene_effects": "回音",
    "speech_to_song": "Lofi",
    "masks": "圆形",
    "mix_modes": "滤色",
    "beauty": "磨皮",
    "skin_tone": "粉白",
    "keyframe_properties": "position_x",
}


class EnumResolutionError(ValueError):
    def __init__(self, category: str, query: str, candidates: list[str]) -> None:
        self.category = category
        self.query = query
        self.candidates = candidates
        msg = f"Unknown {category} '{query}'."
        if candidates:
            msg += f" Did you mean one of: {candidates}?"
        super().__init__(msg)


class AssetRegistry:
    _instance: AssetRegistry | None = None

    def __init__(self) -> None:
        self._draft = _load_vendor()
        self._categories: dict[str, type[enum.Enum]] = {}
        self._names_cache: dict[str, list[str]] = {}
        self._normalized_cache: dict[str, dict[str, str]] = {}
        self._init_registry()

    @classmethod
    def get(cls) -> AssetRegistry:
        if cls._instance is None:
            cls._instance = AssetRegistry()
        return cls._instance

    def _init_registry(self) -> None:
        for cat, class_name in CATEGORY_MAP.items():
            enum_cls = getattr(self._draft, class_name, None)
            if enum_cls and issubclass(enum_cls, enum.Enum):
                self._categories[cat] = enum_cls
                names = [m.name for m in enum_cls]
                self._names_cache[cat] = names
                norm: dict[str, str] = {}
                for name in names:
                    norm[name.lower()] = name
                    norm[name.lower().strip("_")] = name
                    norm[name.replace(" ", "").lower()] = name
                    norm[name.replace("_", "").replace(" ", "").lower()] = name
                self._normalized_cache[cat] = norm


    def list_categories(self) -> dict[str, int]:
        return {cat: len(names) for cat, names in self._names_cache.items()}

    def get_enum_class(self, category: str) -> type[enum.Enum] | None:
        return self._categories.get(category)


    def search(self, category: str, keyword: str = "", limit: int = 20) -> list[str]:
        names = self._names_cache.get(category, [])
        if not keyword:
            return names[:limit]
        kw = keyword.strip().lower()
        exact = [n for n in names if kw == n.lower()]
        contains = [n for n in names if kw in n.lower() and n not in exact]
        fuzzy = [n for n in difflib.get_close_matches(kw, names, n=limit, cutoff=0.4) if n not in exact and n not in contains]
        return (exact + contains + fuzzy)[:limit]


    def resolve(
        self,
        category: str,
        query: str,
        *,
        fallback_to_safe: bool = True,
        allow_fuzzy: bool = True,
    ) -> Any:
        if not query or not str(query).strip():
            return None
        q = str(query).strip()
        enum_cls = self._categories.get(category)
        if not enum_cls:
            return None

        # 1. Exact
        if hasattr(enum_cls, q):
            return getattr(enum_cls, q)
        if q in enum_cls.__members__:
            return enum_cls[q]

        # 2. Normalized
        norm_map = self._normalized_cache.get(category, {})
        clean_q = q.lower().strip("_")
        clean_deep = q.replace("_", "").replace(" ", "").lower()
        if clean_q in norm_map:
            canonical = norm_map[clean_q]
            return getattr(enum_cls, canonical)
        if clean_deep in norm_map:
            canonical = norm_map[clean_deep]
            return getattr(enum_cls, canonical)

        # 3. Substring: only if exactly one substring match
        names = self._names_cache.get(category, [])
        substr_matches = [n for n in names if clean_q in n.lower() or clean_deep in n.lower().replace("_", "")]
        if len(substr_matches) == 1:
            return getattr(enum_cls, substr_matches[0])

        # 4. Fuzzy
        if allow_fuzzy:
            matches = difflib.get_close_matches(q, names, n=3, cutoff=0.55)
            if matches:
                return getattr(enum_cls, matches[0])

        # 5. Safe Fallback
        if fallback_to_safe and category in SAFE_FALLBACKS:
            fb_name = SAFE_FALLBACKS[category]
            if hasattr(enum_cls, fb_name):
                return getattr(enum_cls, fb_name)

        close = difflib.get_close_matches(q, names, n=5, cutoff=0.3)
        raise EnumResolutionError(category, q, close)
