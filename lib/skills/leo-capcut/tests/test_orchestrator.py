from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from helpers import ROOT, SCRIPTS
import sys
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.orchestrator import run_pipeline


class OrchestratorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.media = Path(self.temp.name) / "talk.mp4"
        self.media.write_bytes(b"fake-mp4")

    def tearDown(self):
        self.temp.cleanup()

    def test_natural_language_request_builds_validated_timeline(self):
        result = run_pipeline(
            request_text="做一条 12 秒的知识口播，讲清楚为什么不要用界面去点剪映",
            media_paths=[self.media],
            template_root=ROOT / "assets" / "templates",
            publish=False,
        )
        self.assertEqual(result.brief.scenario, "knowledge-talk")
        self.assertEqual(result.timeline.canvas.width, 1080)
        self.assertGreaterEqual(len(result.timeline.tracks), 2)
        self.assertTrue(any(track.type == "text" for track in result.timeline.tracks))
        self.assertIn("script", result.artifacts)
        self.assertIn("storyboard", result.artifacts)

    def test_short_knowledge_talk_keeps_positive_clip_durations(self):
        result = run_pipeline(
            request_text="做一条 8 秒的知识口播，讲清楚为什么不要用界面去点剪映",
            media_paths=[self.media],
            template_root=ROOT / "assets" / "templates",
            publish=False,
        )
        self.assertEqual(result.brief.scenario, "knowledge-talk")
        self.assertTrue(all(clip.duration_us >= 1 for track in result.timeline.tracks for clip in track.clips))
        self.assertEqual(sum(clip.duration_us for clip in result.timeline.tracks[0].clips), result.timeline.duration_us)


if __name__ == "__main__":
    unittest.main()
