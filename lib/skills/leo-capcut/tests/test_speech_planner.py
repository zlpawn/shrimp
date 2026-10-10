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
