from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.timeline_ir import TimelineValidationError, validate_timeline


def sample_timeline(**overrides):
    payload = {
        "schema_version": "1.0",
        "project_name": "demo",
        "canvas": {"width": 1080, "height": 1920, "fps": 30},
        "duration_us": 4_000_000,
        "assets": [
            {
                "id": "clip-a",
                "kind": "video",
                "uri": "asset://demo/clip-a",
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
    payload.update(overrides)
    return payload


class TimelineIrTests(unittest.TestCase):
    def test_valid_timeline_passes(self):
        result = validate_timeline(sample_timeline())
        self.assertEqual(result.duration_us, 4_000_000)
        self.assertEqual(result.canvas.width, 1080)
        self.assertEqual(len(result.tracks), 2)

    def test_missing_asset_is_rejected(self):
        payload = sample_timeline()
        payload["tracks"][0]["clips"][0]["asset_id"] = "missing"
        with self.assertRaises(TimelineValidationError):
            validate_timeline(payload)

    def test_overlapping_clips_on_same_track_are_rejected(self):
        payload = sample_timeline()
        payload["tracks"][0]["clips"].append(
            {
                "id": "v2",
                "start_us": 2_000_000,
                "duration_us": 2_000_000,
                "asset_id": "clip-a",
            }
        )
        with self.assertRaises(TimelineValidationError):
            validate_timeline(payload)

    def test_clip_past_duration_is_rejected(self):
        payload = sample_timeline()
        payload["tracks"][1]["clips"][0]["duration_us"] = 5_000_000
        with self.assertRaises(TimelineValidationError):
            validate_timeline(payload)

    def test_video_clip_without_asset_is_rejected(self):
        payload = sample_timeline()
        del payload["tracks"][0]["clips"][0]["asset_id"]
        with self.assertRaises(TimelineValidationError):
            validate_timeline(payload)

    def test_text_clip_without_text_is_rejected(self):
        payload = sample_timeline()
        del payload["tracks"][1]["clips"][0]["text"]
        with self.assertRaises(TimelineValidationError):
            validate_timeline(payload)


if __name__ == "__main__":
    unittest.main()
