# Leo CapCut 与 Jianying Headless 核心能力整合实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将开源项目 `jianying-headless` 的口播切片、草稿外科修改、本地字体物理嵌入及 Windows FFmpeg 无头成片直出四大能力无缝整合进 `leo-capcut`，构建完整的视频全流程闭环。

**Architecture:** 采用分层内核扩展架构（Layered Engine Extension），在 `scripts/leo_capcut/engine/` 下扩展 `speech_planner.py`、`draft_modifier.py`、`font_embedder.py` 和 `ffmpeg_renderer.py`，保持顶层 `Timeline IR` 数据中枢地位，并在 `leo_capcut_cli.py` 与 `SKILL.md` 中暴露高阶 Agent 命令。

**Tech Stack:** Python 3.9+, FFmpeg / ffprobe, `pyJianYingDraft`, `crypto.py` (Windows `videoeditor.dll` 往返加解密), `unittest`.

## Global Constraints

- **平台与环境约束**：主要面向 Windows 10/11 剪映 10/11 环境，加解密调用本地 `videoeditor.dll`。
- **草稿安全与非破坏性原则**：绝不直接原地覆写原草稿，所有修改必须基于独立副本生成，使用全新 `project_id`。
- **运行态写保护**：向 `root_meta_info.json` 注册前必须检测剪映进程，运行态拒绝注册并提示用户；注册前备份，失败自动回滚。
- **加解密熔断机制**：加密生成草稿后必须在内存中反向解密校验关键字段（tracks, materials）。
- **视听平滑保证**：口播切口接缝处施加 20ms 微淡入淡出（Crossfade），消除波形断裂爆音；字幕时间映射严格保持单调递增并与音频切片同步。

---

### Task 1: 口播时间重映射与智能切除编译器 (`engine/speech_planner.py`)

**Files:**
- Create: `lib/skills/leo-capcut/scripts/leo_capcut/engine/__init__.py`
- Create: `lib/skills/leo-capcut/scripts/leo_capcut/engine/speech_planner.py`
- Test: `lib/skills/leo-capcut/tests/test_speech_planner.py`

**Interfaces:**
- Consumes: `Timeline`, `Asset`, `Track`, `Clip` from `leo_capcut.timeline_ir`
- Produces:
  - `compute_keep_intervals(total_duration_us: int, cuts: list[tuple[int, int]]) -> list[tuple[int, int]]`
  - `class TimeMap`: `map_time(t_orig: int) -> int`, property `mapped_duration: int`
  - `filter_and_shift_subtitles(subtitles: list[dict], time_map: TimeMap) -> list[dict]`
  - `plan_speech_cut(total_duration_us: int, transcript_segments: list[dict], remove_silence_over_sec: float = 0.6, fillers: list[str] | None = None) -> tuple[list[tuple[int, int]], list[dict], TimeMap]`

- [ ] **Step 1: 编写失败的单元测试 `tests/test_speech_planner.py`**

```python
import unittest
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.engine.speech_planner import (
    compute_keep_intervals,
    TimeMap,
    filter_and_shift_subtitles,
    plan_speech_cut,
)

class SpeechPlannerTests(unittest.TestCase):
    def test_compute_keep_intervals(self):
        # 10s video, cut 2s-3s (silence) and 5s-6s (filler)
        total_us = 10_000_000
        cuts = [(2_000_000, 3_000_000), (5_000_000, 6_000_000)]
        keeps = compute_keep_intervals(total_us, cuts)
        expected = [(0, 2_000_000), (3_000_000, 5_000_000), (6_000_000, 10_000_000)]
        self.assertEqual(keeps, expected)

    def test_time_map_monotonicity_and_duration(self):
        keeps = [(0, 2_000_000), (3_000_000, 5_000_000)]
        tm = TimeMap(keeps)
        self.assertEqual(tm.mapped_duration, 4_000_000)
        self.assertEqual(tm.map_time(1_000_000), 1_000_000)
        # 2s-3s cut out: 2.5s clamps to 2.0s
        self.assertEqual(tm.map_time(2_500_000), 2_000_000)
        # 3.5s becomes 2.0s + 0.5s = 2.5s
        self.assertEqual(tm.map_time(3_500_000), 2_500_000)

    def test_subtitle_shifting(self):
        keeps = [(0, 2_000_000), (3_000_000, 5_000_000)]
        tm = TimeMap(keeps)
        subs = [
            {"start_us": 500_000, "end_us": 1_500_000, "text": "保留一"},
            {"start_us": 2_200_000, "end_us": 2_800_000, "text": "废话被切"},
            {"start_us": 3_500_000, "end_us": 4_500_000, "text": "保留二"},
        ]
        shifted = filter_and_shift_subtitles(subs, tm)
        self.assertEqual(len(shifted), 2)
        self.assertEqual(shifted[0]["text"], "保留一")
        self.assertEqual(shifted[0]["start_us"], 500_000)
        self.assertEqual(shifted[1]["text"], "保留二")
        self.assertEqual(shifted[1]["start_us"], 2_500_000)

    def test_plan_speech_cut(self):
        total_us = 6_000_000
        transcript = [
            {"start_us": 0, "end_us": 2_000_000, "text": "大家好"},
            {"start_us": 2_000_000, "end_us": 3_200_000, "text": "呃"},  # filler
            {"start_us": 4_500_000, "end_us": 6_000_000, "text": "欢迎收看"},  # silence between 3.2s and 4.5s is 1.3s (>0.6s)
        ]
        keeps, shifted_subs, tm = plan_speech_cut(total_us, transcript, remove_silence_over_sec=0.6, fillers=["呃", "啊"])
        self.assertTrue(len(keeps) >= 2)
        self.assertEqual(len(shifted_subs), 2)
        self.assertEqual(shifted_subs[0]["text"], "大家好")
        self.assertEqual(shifted_subs[1]["text"], "欢迎收看")

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试以确认失败**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_speech_planner.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'leo_capcut.engine')

- [ ] **Step 3: 编写最小实现代码**

创建 `lib/skills/leo-capcut/scripts/leo_capcut/engine/__init__.py`：
```python
"""Leo CapCut Engine Extensions."""
```

创建 `lib/skills/leo-capcut/scripts/leo_capcut/engine/speech_planner.py`：
```python
from __future__ import annotations
from typing import Any

def compute_keep_intervals(total_duration_us: int, cuts: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Compute retained intervals [start, end] given total duration and cut intervals."""
    if not cuts:
        return [(0, total_duration_us)] if total_duration_us > 0 else []
    
    # Sort and merge overlapping cut intervals
    sorted_cuts = sorted(cuts, key=lambda x: x[0])
    merged_cuts: list[tuple[int, int]] = []
    for s, e in sorted_cuts:
        s = max(0, min(total_duration_us, s))
        e = max(0, min(total_duration_us, e))
        if s >= e:
            continue
        if not merged_cuts or s > merged_cuts[-1][1]:
            merged_cuts.append((s, e))
        else:
            merged_cuts[-1] = (merged_cuts[-1][0], max(merged_cuts[-1][1], e))
    
    keeps: list[tuple[int, int]] = []
    cursor = 0
    for s, e in merged_cuts:
        if s > cursor:
            keeps.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < total_duration_us:
        keeps.append((cursor, total_duration_us))
    return keeps

class TimeMap:
    """Monotonic piece-wise linear mapping from original timeline to cut timeline."""
    def __init__(self, keep_intervals: list[tuple[int, int]]):
        self.keep_intervals = sorted(keep_intervals, key=lambda x: x[0])
        self.offsets: list[int] = []
        accum = 0
        for s, e in self.keep_intervals:
            self.offsets.append(accum)
            accum += (e - s)
        self._mapped_duration = accum

    @property
    def mapped_duration(self) -> int:
        return self._mapped_duration

    def map_time(self, t_orig: int) -> int:
        if not self.keep_intervals:
            return 0
        if t_orig <= self.keep_intervals[0][0]:
            return 0
        
        for idx, (s, e) in enumerate(self.keep_intervals):
            if t_orig < s:
                return self.offsets[idx]
            elif s <= t_orig <= e:
                return self.offsets[idx] + (t_orig - s)
        
        return self._mapped_duration

def filter_and_shift_subtitles(subtitles: list[dict[str, Any]], time_map: TimeMap) -> list[dict[str, Any]]:
    """Shift subtitle timings using time_map, dropping subtitles that collapse inside cuts."""
    shifted: list[dict[str, Any]] = []
    for sub in subtitles:
        orig_s = sub.get("start_us", 0)
        orig_e = sub.get("end_us", 0)
        new_s = time_map.map_time(orig_s)
        new_e = time_map.map_time(orig_e)
        if new_e - new_s >= 100_000:  # At least 100ms
            item = dict(sub)
            item["start_us"] = new_s
            item["end_us"] = new_e
            item["duration_us"] = new_e - new_s
            shifted.append(item)
    return shifted

def plan_speech_cut(
    total_duration_us: int,
    transcript_segments: list[dict[str, Any]],
    remove_silence_over_sec: float = 0.6,
    fillers: list[str] | None = None,
) -> tuple[list[tuple[int, int]], list[dict[str, Any]], TimeMap]:
    """Detect silences and fillers, compute cuts, and shift retained transcript items."""
    min_silence_us = int(remove_silence_over_sec * 1_000_000)
    filler_set = set(f.strip() for f in (fillers or []))
    cuts: list[tuple[int, int]] = []
    
    # 1. Detect inter-word silences
    prev_end = 0
    for seg in transcript_segments:
        s = seg.get("start_us", 0)
        e = seg.get("end_us", 0)
        text = seg.get("text", "").strip()
        if s - prev_end > min_silence_us:
            # Cut silence keeping 100ms buffer
            cut_start = prev_end + 100_000
            cut_end = s - 100_000
            if cut_end > cut_start:
                cuts.append((cut_start, cut_end))
        if text in filler_set and (e - s) > 0:
            cuts.append((s, e))
        prev_end = max(prev_end, e)
    
    # Trailing silence
    if total_duration_us - prev_end > min_silence_us:
        cuts.append((prev_end + 100_000, total_duration_us))

    keeps = compute_keep_intervals(total_duration_us, cuts)
    time_map = TimeMap(keeps)
    shifted_subs = filter_and_shift_subtitles(transcript_segments, time_map)
    # Remove filler items from subtitles
    shifted_subs = [s for s in shifted_subs if s.get("text", "").strip() not in filler_set]
    return keeps, shifted_subs, time_map
```

- [ ] **Step 4: 运行测试以确认全部通过**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_speech_planner.py -v`
Expected: OK (Ran 4 tests)

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-capcut/scripts/leo_capcut/engine/__init__.py lib/skills/leo-capcut/scripts/leo_capcut/engine/speech_planner.py lib/skills/leo-capcut/tests/test_speech_planner.py
git commit -m "feat(leo-capcut): add speech_planner with time mapping and subtitle shifting"
```

---

### Task 2: 本地字体物理打包与索引生成 (`engine/font_embedder.py`)

**Files:**
- Create: `lib/skills/leo-capcut/scripts/leo_capcut/engine/font_embedder.py`
- Test: `lib/skills/leo-capcut/tests/test_font_embedder.py`

**Interfaces:**
- Consumes: `Path` from standard library
- Produces:
  - `parse_font_metadata(font_path: Path) -> dict[str, str]`
  - `embed_font_into_draft(draft_dir: Path, font_path: Path) -> dict[str, Any]`

- [ ] **Step 1: 编写失败的单元测试 `tests/test_font_embedder.py`**

```python
import unittest
import tempfile
import shutil
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.engine.font_embedder import parse_font_metadata, embed_font_into_draft

class FontEmbedderTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_parse_font_metadata(self):
        dummy_font = self.temp_dir / "CustomTitleFont.ttf"
        dummy_font.write_bytes(b"dummy font content")
        meta = parse_font_metadata(dummy_font)
        self.assertEqual(meta["title"], "CustomTitleFont")
        self.assertEqual(meta["file_name"], "CustomTitleFont.ttf")

    def test_embed_font_into_draft(self):
        draft_dir = self.temp_dir / "draft_project"
        draft_dir.mkdir()
        font_file = self.temp_dir / "MyArtFont.otf"
        font_file.write_bytes(b"sample otf binary")
        
        font_material = embed_font_into_draft(draft_dir, font_file)
        
        # Verify font copied into draft resources/fonts
        target_font = draft_dir / "resources" / "fonts" / "MyArtFont.otf"
        self.assertTrue(target_font.is_file())
        self.assertEqual(font_material["title"], "MyArtFont")
        self.assertEqual(font_material["resource_type"], "font")
        self.assertTrue(len(font_material["id"]) > 0)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试以确认失败**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_font_embedder.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'leo_capcut.engine.font_embedder')

- [ ] **Step 3: 编写最小实现代码**

创建 `lib/skills/leo-capcut/scripts/leo_capcut/engine/font_embedder.py`：
```python
from __future__ import annotations
import shutil
import uuid
from pathlib import Path
from typing import Any

def parse_font_metadata(font_path: Path) -> dict[str, str]:
    """Extract font title and basic identification from file path."""
    p = Path(font_path)
    stem = p.stem
    return {
        "title": stem,
        "family_name": stem,
        "file_name": p.name,
        "extension": p.suffix.lower(),
    }

def embed_font_into_draft(draft_dir: Path, font_path: Path) -> dict[str, Any]:
    """Copy font file into draft folder resources/fonts and return font material metadata."""
    font_path = Path(font_path).resolve()
    if not font_path.is_file():
        raise FileNotFoundError(f"font file not found: {font_path}")
    
    meta = parse_font_metadata(font_path)
    fonts_dir = Path(draft_dir) / "resources" / "fonts"
    fonts_dir.mkdir(parents=True, exist_ok=True)
    
    target_path = fonts_dir / font_path.name
    if not target_path.exists() or target_path.stat().st_size != font_path.stat().st_size:
        shutil.copy2(font_path, target_path)
    
    font_id = uuid.uuid4().hex
    return {
        "id": font_id,
        "title": meta["title"],
        "path": str(target_path),
        "relative_path": f"resources/fonts/{font_path.name}",
        "resource_type": "font",
        "type": "font",
    }
```

- [ ] **Step 4: 运行测试以确认通过**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_font_embedder.py -v`
Expected: OK (Ran 2 tests)

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-capcut/scripts/leo_capcut/engine/font_embedder.py lib/skills/leo-capcut/tests/test_font_embedder.py
git commit -m "feat(leo-capcut): add font_embedder for bundling local fonts into drafts"
```

---

### Task 3: 现有草稿“手术刀”与声明式 Patch (`engine/draft_modifier.py`)

**Files:**
- Create: `lib/skills/leo-capcut/scripts/leo_capcut/engine/draft_modifier.py`
- Test: `lib/skills/leo-capcut/tests/test_draft_modifier.py`

**Interfaces:**
- Consumes: `IsolatedJianyingCodec` from `leo_capcut.crypto`, `detect_environment` from `leo_capcut.detect`, `publish_draft_safely` from `leo_capcut.registry`
- Produces:
  - `inspect_draft(draft_dir: Path) -> dict[str, Any]`
  - `apply_patch_operations(draft_content: dict[str, Any], operations: list[dict[str, Any]], asset_copy_dir: Path) -> dict[str, Any]`
  - `modify_draft_copy(src_draft_dir: Path, out_name: str, operations: list[dict[str, Any]], publish: bool = True) -> Path`

- [ ] **Step 1: 编写失败的单元测试 `tests/test_draft_modifier.py`**

```python
import unittest
import tempfile
import json
import shutil
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.engine.draft_modifier import inspect_draft_dict, apply_patch_operations

class DraftModifierTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.sample_content = {
            "id": "draft-001",
            "duration": 10_000_000,
            "canvas_config": {"width": 1080, "height": 1920, "fps": 30.0},
            "tracks": [
                {
                    "id": "track_v1",
                    "type": "video",
                    "segments": [
                        {"id": "seg_v1", "material_id": "mat_v1", "target_timerange": {"start": 0, "duration": 10_000_000}}
                    ]
                },
                {
                    "id": "track_a1",
                    "type": "audio",
                    "segments": [
                        {"id": "seg_a1", "material_id": "mat_a1", "volume": 0.5, "target_timerange": {"start": 0, "duration": 10_000_000}}
                    ]
                },
                {
                    "id": "track_t1",
                    "type": "text",
                    "segments": [
                        {"id": "seg_t1", "material_id": "mat_t1", "target_timerange": {"start": 0, "duration": 5_000_000}}
                    ]
                }
            ],
            "materials": {
                "videos": [{"id": "mat_v1", "path": "D:/assets/old_video.mp4", "duration": 10_000_000}],
                "audios": [{"id": "mat_a1", "path": "D:/assets/old_bgm.mp3", "duration": 10_000_000}],
                "texts": [{"id": "mat_t1", "content": json.dumps({"text": "原标题"})}]
            }
        }

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_inspect_draft_dict(self):
        summary = inspect_draft_dict(self.sample_content)
        self.assertEqual(summary["duration_sec"], 10.0)
        self.assertEqual(len(summary["tracks"]), 3)
        self.assertEqual(summary["tracks"][1]["type"], "audio")
        self.assertEqual(summary["tracks"][1]["clips"][0]["volume"], 0.5)

    def test_apply_patch_replace_audio_and_update_text(self):
        new_audio = self.temp_dir / "new_bgm.mp3"
        new_audio.write_bytes(b"dummy audio content")
        
        ops = [
            {"action": "replace_audio", "track_id": "track_a1", "new_asset": str(new_audio), "volume": 0.2},
            {"action": "update_text", "track_id": "track_t1", "segment_index": 0, "new_text": "新标题文案"},
            {"action": "adjust_volume", "track_id": "track_a1", "segment_index": 0, "volume": 0.3},
        ]
        
        updated = apply_patch_operations(self.sample_content, ops, self.temp_dir)
        
        # Verify text updated
        text_mat = next(m for m in updated["materials"]["texts"] if m["id"] == "mat_t1")
        text_payload = json.loads(text_mat["content"])
        self.assertEqual(text_payload["text"], "新标题文案")
        
        # Verify audio volume updated
        aud_seg = updated["tracks"][1]["segments"][0]
        self.assertEqual(aud_seg["volume"], 0.3)
        
        # Verify audio material replaced
        aud_mat = next(m for m in updated["materials"]["audios"] if m["id"] == aud_seg["material_id"])
        self.assertTrue("new_bgm.mp3" in aud_mat["path"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试以确认失败**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_draft_modifier.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'leo_capcut.engine.draft_modifier')

- [ ] **Step 3: 编写最小实现代码**

创建 `lib/skills/leo-capcut/scripts/leo_capcut/engine/draft_modifier.py`：
```python
from __future__ import annotations
import json
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from ..crypto import IsolatedJianyingCodec
from ..detect import detect_environment
from ..registry import publish_draft_safely

def inspect_draft_dict(content: dict[str, Any]) -> dict[str, Any]:
    """Produce a concise high-level summary of a draft JSON for LLMs."""
    duration_us = content.get("duration", 0)
    canvas = content.get("canvas_config", {})
    materials = content.get("materials", {})
    
    video_map = {m["id"]: m.get("path", "") for m in materials.get("videos", [])}
    audio_map = {m["id"]: m.get("path", "") for m in materials.get("audios", [])}
    text_map = {}
    for m in materials.get("texts", []):
        try:
            parsed = json.loads(m.get("content", "{}"))
            text_map[m["id"]] = parsed.get("text", "")
        except Exception:
            text_map[m["id"]] = ""

    tracks_summary: list[dict[str, Any]] = []
    for trk in content.get("tracks", []):
        t_type = trk.get("type", "unknown")
        t_id = trk.get("id", "")
        clips: list[dict[str, Any]] = []
        for idx, seg in enumerate(trk.get("segments", [])):
            tr = seg.get("target_timerange", {})
            mat_id = seg.get("material_id", "")
            clip_info: dict[str, Any] = {
                "index": idx,
                "id": seg.get("id", ""),
                "start_sec": round(tr.get("start", 0) / 1_000_000, 2),
                "duration_sec": round(tr.get("duration", 0) / 1_000_000, 2),
            }
            if t_type == "video":
                clip_info["asset"] = video_map.get(mat_id, "")
            elif t_type == "audio":
                clip_info["asset"] = audio_map.get(mat_id, "")
                clip_info["volume"] = seg.get("volume", 1.0)
            elif t_type == "text":
                clip_info["text"] = text_map.get(mat_id, "")
            clips.append(clip_info)
            
        tracks_summary.append({
            "id": t_id,
            "type": t_type,
            "clips_count": len(clips),
            "clips": clips,
        })

    return {
        "duration_sec": round(duration_us / 1_000_000, 2),
        "canvas": {
            "width": canvas.get("width", 1080),
            "height": canvas.get("height", 1920),
            "fps": canvas.get("fps", 30.0),
        },
        "tracks": tracks_summary,
    }

def apply_patch_operations(
    draft_content: dict[str, Any],
    operations: list[dict[str, Any]],
    asset_copy_dir: Path,
) -> dict[str, Any]:
    """Apply declarative patch operations to draft JSON content."""
    content = json.loads(json.dumps(draft_content))
    materials = content.setdefault("materials", {})
    audios = materials.setdefault("audios", [])
    texts = materials.setdefault("texts", [])
    videos = materials.setdefault("videos", [])
    tracks = content.setdefault("tracks", [])

    for op in operations:
        action = op.get("action", "")
        track_id = op.get("track_id", "")
        
        target_track = None
        for t in tracks:
            if t.get("id") == track_id or (track_id and t.get("type") == track_id):
                target_track = t
                break

        if action == "replace_audio" and target_track:
            new_asset = Path(op["new_asset"])
            dest = asset_copy_dir / new_asset.name
            shutil.copy2(new_asset, dest)
            mat_id = uuid.uuid4().hex
            audios.append({
                "id": mat_id,
                "path": str(dest),
                "name": new_asset.name,
                "duration": content.get("duration", 10_000_000),
                "type": "extract_music",
            })
            seg_idx = op.get("segment_index", 0)
            if seg_idx < len(target_track.get("segments", [])):
                seg = target_track["segments"][seg_idx]
                seg["material_id"] = mat_id
                if "volume" in op:
                    seg["volume"] = float(op["volume"])

        elif action == "update_text" and target_track:
            seg_idx = op.get("segment_index", 0)
            if seg_idx < len(target_track.get("segments", [])):
                seg = target_track["segments"][seg_idx]
                mat_id = seg.get("material_id", "")
                text_mat = next((m for m in texts if m.get("id") == mat_id), None)
                if text_mat:
                    try:
                        parsed = json.loads(text_mat.get("content", "{}"))
                    except Exception:
                        parsed = {}
                    parsed["text"] = op.get("new_text", "")
                    text_mat["content"] = json.dumps(parsed, ensure_ascii=False)

        elif action == "adjust_volume" and target_track:
            seg_idx = op.get("segment_index", 0)
            if seg_idx < len(target_track.get("segments", [])):
                target_track["segments"][seg_idx]["volume"] = float(op["volume"])

        elif action == "delete_clip" and target_track:
            seg_idx = op.get("segment_index", 0)
            if seg_idx < len(target_track.get("segments", [])):
                target_track["segments"].pop(seg_idx)

    return content
```

- [ ] **Step 4: 运行测试以确认通过**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_draft_modifier.py -v`
Expected: OK (Ran 2 tests)

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-capcut/scripts/leo_capcut/engine/draft_modifier.py lib/skills/leo-capcut/tests/test_draft_modifier.py
git commit -m "feat(leo-capcut): add draft_modifier for inspecting and patching drafts"
```

---

### Task 4: Windows FFmpeg 导出引擎与画质断言 (`engine/ffmpeg_renderer.py`)

**Files:**
- Create: `lib/skills/leo-capcut/scripts/leo_capcut/engine/ffmpeg_renderer.py`
- Test: `lib/skills/leo-capcut/tests/test_ffmpeg_renderer.py`

**Interfaces:**
- Consumes: `Timeline` from `leo_capcut.timeline_ir`
- Produces:
  - `compile_filtergraph(timeline: Timeline, font_path: Path | None = None) -> tuple[list[str], list[str], str, str]`
  - `render_timeline_mp4(timeline: Timeline, out_mp4: Path, font_path: Path | None = None) -> Path`
  - `assert_render_quality(mp4_path: Path, expected_duration_us: int) -> dict[str, Any]`

- [ ] **Step 1: 编写失败的单元测试 `tests/test_ffmpeg_renderer.py`**

```python
import unittest
from pathlib import Path
import sys

ENGINE_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(ENGINE_DIR))

from leo_capcut.timeline_ir import Timeline, Track, Clip, Asset, Canvas
from leo_capcut.engine.ffmpeg_renderer import compile_filtergraph

class FfmpegRendererTests(unittest.TestCase):
    def test_compile_filtergraph_video_audio_text(self):
        tl = Timeline(
            canvas=Canvas(width=1080, height=1920, fps=30.0),
            duration_us=5_000_000,
            assets=[
                Asset(id="a_v", kind="video", uri="D:/video.mp4", duration_us=5_000_000),
                Asset(id="a_a", kind="audio", uri="D:/bgm.mp3", duration_us=5_000_000),
            ],
            tracks=[
                Track(id="t_v", type="video", name="Main", clips=[
                    Clip(id="c1", asset_id="a_v", start_us=0, duration_us=5_000_000)
                ]),
                Track(id="t_a", type="audio", name="Audio", clips=[
                    Clip(id="c2", asset_id="a_a", start_us=0, duration_us=5_000_000, volume=0.5)
                ]),
                Track(id="t_t", type="text", name="Sub", clips=[
                    Clip(id="c3", text="测试字幕", start_us=1_000_000, duration_us=3_000_000)
                ]),
            ]
        )
        inputs, filters, out_v, out_a = compile_filtergraph(tl)
        self.assertEqual(len(inputs), 2)
        filter_str = ";".join(filters)
        self.assertTrue("drawtext=" in filter_str)
        self.assertTrue("volume=" in filter_str or "amix" in filter_str)
        self.assertTrue(len(out_v) > 0)
        self.assertTrue(len(out_a) > 0)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试以确认失败**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_ffmpeg_renderer.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'leo_capcut.engine.ffmpeg_renderer')

- [ ] **Step 3: 编写最小实现代码**

创建 `lib/skills/leo-capcut/scripts/leo_capcut/engine/ffmpeg_renderer.py`：
```python
from __future__ import annotations
import json
import os
import subprocess
from pathlib import Path
from typing import Any

from ..timeline_ir import Timeline

def find_system_font() -> str:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("C:/Windows/Fonts/arial.ttf"),
    ]
    for c in candidates:
        if c.is_file():
            return str(c).replace("\\", "/")
    return "arial"

def compile_filtergraph(timeline: Timeline, font_path: Path | None = None) -> tuple[list[str], list[str], str, str]:
    """Translate Timeline IR tracks into FFmpeg input args and filter_complex expressions."""
    asset_map = timeline.asset_map()
    input_assets = list(timeline.assets)
    input_args: list[str] = []
    
    asset_idx_map: dict[str, int] = {}
    for idx, asset in enumerate(input_assets):
        asset_idx_map[asset.id] = idx
        input_args.extend(["-i", asset.uri])

    filter_chains: list[str] = []
    video_stage = ""
    audio_chains: list[str] = []

    # 1. Main video track
    video_tracks = [t for t in timeline.tracks if t.type == "video"]
    if video_tracks:
        main_track = video_tracks[0]
        if main_track.clips and main_track.clips[0].asset_id:
            in_idx = asset_idx_map[main_track.clips[0].asset_id]
            filter_chains.append(f"[{in_idx}:v]scale={timeline.canvas.width}:{timeline.canvas.height}:force_original_aspect_ratio=decrease,pad={timeline.canvas.width}:{timeline.canvas.height}:(ow-iw)/2:(oh-ih)/2[v_base]")
            video_stage = "[v_base]"
        else:
            filter_chains.append(f"color=c=black:s={timeline.canvas.width}x{timeline.canvas.height}:d={timeline.duration_us/1_000_000}[v_base]")
            video_stage = "[v_base]"
    else:
        filter_chains.append(f"color=c=black:s={timeline.canvas.width}x{timeline.canvas.height}:d={timeline.duration_us/1_000_000}[v_base]")
        video_stage = "[v_base]"

    # 2. Text overlays
    font_file = str(font_path).replace("\\", "/") if font_path else find_system_font()
    text_tracks = [t for t in timeline.tracks if t.type == "text"]
    text_idx = 0
    for tt in text_tracks:
        for clip in tt.clips:
            if not clip.text:
                continue
            s_sec = clip.start_us / 1_000_000
            e_sec = (clip.start_us + clip.duration_us) / 1_000_000
            txt = clip.text.replace("'", "'\\''")
            next_stage = f"[v_txt_{text_idx}]"
            filter_chains.append(
                f"{video_stage}drawtext=fontfile='{font_file}':text='{txt}':fontsize=48:fontcolor=white:x=(w-text_w)/2:y=h*0.8:enable='between(t,{s_sec},{e_sec})'{next_stage}"
            )
            video_stage = next_stage
            text_idx += 1

    # 3. Audio tracks
    audio_tracks = [t for t in timeline.tracks if t.type == "audio"]
    for a_idx, at in enumerate(audio_tracks):
        for clip in at.clips:
            if clip.asset_id and clip.asset_id in asset_idx_map:
                in_idx = asset_idx_map[clip.asset_id]
                delay_ms = int(clip.start_us / 1000)
                vol = clip.volume if clip.volume is not None else 1.0
                chain_name = f"[a_{a_idx}]"
                filter_chains.append(f"[{in_idx}:a]adelay={delay_ms}|{delay_ms},volume={vol}{chain_name}")
                audio_chains.append(chain_name)

    out_a = "[out_a]"
    if audio_chains:
        if len(audio_chains) > 1:
            filter_chains.append(f"{''.join(audio_chains)}amix=inputs={len(audio_chains)}:duration=longest:normalize=0{out_a}")
        else:
            filter_chains.append(f"{audio_chains[0]}aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo{out_a}")
    else:
        filter_chains.append(f"anullsrc=r=44100:cl=stereo:d={timeline.duration_us/1_000_000}{out_a}")

    out_v = video_stage
    return input_args, filter_chains, out_v, out_a

def render_timeline_mp4(timeline: Timeline, out_mp4: Path, font_path: Path | None = None) -> Path:
    out_mp4 = Path(out_mp4).resolve()
    out_mp4.parent.mkdir(parents=True, exist_ok=True)
    input_args, filter_chains, out_v, out_a = compile_filtergraph(timeline, font_path)
    
    cmd = [
        "ffmpeg", "-y",
        *input_args,
        "-filter_complex", ";".join(filter_chains),
        "-map", out_v,
        "-map", out_a,
        "-t", str(timeline.duration_us / 1_000_000),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        str(out_mp4)
    ]
    
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg rendering failed: {res.stderr}")
    return out_mp4

def assert_render_quality(mp4_path: Path, expected_duration_us: int) -> dict[str, Any]:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration:stream=codec_type,nb_frames,width,height",
        "-of", "json",
        str(mp4_path)
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFprobe check failed: {res.stderr}")
    data = json.loads(res.stdout)
    actual_dur = float(data.get("format", {}).get("duration", 0))
    expected_sec = expected_duration_us / 1_000_000
    if abs(actual_dur - expected_sec) > 1.0:
        raise ValueError(f"duration mismatch: expected {expected_sec}s, got {actual_dur}s")
    return data
```

- [ ] **Step 4: 运行测试以确认通过**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_ffmpeg_renderer.py -v`
Expected: OK (Ran 1 test)

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-capcut/scripts/leo_capcut/engine/ffmpeg_renderer.py lib/skills/leo-capcut/tests/test_ffmpeg_renderer.py
git commit -m "feat(leo-capcut): add ffmpeg_renderer with filtergraph compilation and quality assertion"
```

---

### Task 5: CLI 子命令扩展与 SKILL.md 门禁强化 (`leo_capcut_cli.py` & `SKILL.md`)

**Files:**
- Modify: `lib/skills/leo-capcut/scripts/leo_capcut_cli.py`
- Modify: `lib/skills/leo-capcut/SKILL.md`
- Test: `lib/skills/leo-capcut/tests/test_cli_engine_commands.py`

**Interfaces:**
- Consumes: `engine.speech_planner`, `engine.draft_modifier`, `engine.ffmpeg_renderer`, `engine.font_embedder`
- Produces: CLI commands: `speech-cut`, `inspect-draft`, `modify-draft`, `export`

- [ ] **Step 1: 编写 CLI 扩展单元测试 `tests/test_cli_engine_commands.py`**

```python
import unittest
import subprocess
import sys
from pathlib import Path

CLI_PATH = Path(__file__).resolve().parents[1] / "scripts" / "leo_capcut_cli.py"

class CliEngineCommandsTests(unittest.TestCase):
    def test_cli_help_shows_new_commands(self):
        res = subprocess.run([sys.executable, str(CLI_PATH), "--help"], capture_output=True, text=True)
        self.assertEqual(res.returncode, 0)
        self.assertIn("speech-cut", res.stdout)
        self.assertIn("inspect-draft", res.stdout)
        self.assertIn("modify-draft", res.stdout)
        self.assertIn("export", res.stdout)

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 运行测试以确认失败**

Run: `python -m unittest lib/skills/leo-capcut/tests/test_cli_engine_commands.py -v`
Expected: FAIL (AssertionError: 'speech-cut' not in help output)

- [ ] **Step 3: 更新 `scripts/leo_capcut_cli.py` 与 `SKILL.md`**

在 `lib/skills/leo-capcut/scripts/leo_capcut_cli.py` 中添加 `speech-cut`、`inspect-draft`、`modify-draft`、`export` 的子命令解析与分发。

更新 `lib/skills/leo-capcut/SKILL.md` 中的命令列表、场景指南与完成度门禁。

- [ ] **Step 4: 运行全部测试集**

Run: `python -m unittest discover -s lib/skills/leo-capcut/tests -v`
Expected: OK (所有测试包括原 29 个测试与新增测试全部 PASS)

- [ ] **Step 5: 提交更改**

```bash
git add lib/skills/leo-capcut/scripts/leo_capcut_cli.py lib/skills/leo-capcut/SKILL.md lib/skills/leo-capcut/tests/test_cli_engine_commands.py
git commit -m "feat(leo-capcut): expose speech-cut, inspect-draft, modify-draft, export CLI commands and update SKILL.md"
```

---

## 7. 执行选项与交接

实施计划已就绪并保存到 `docs/superpowers/plans/2026-10-10-leo-capcut-headless-integration.md`。
