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
            # Cut silence keeping 100ms buffer, except at very start of video
            cut_start = 0 if prev_end == 0 else prev_end + 100_000
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
