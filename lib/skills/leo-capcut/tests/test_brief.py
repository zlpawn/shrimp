from __future__ import annotations

import unittest
from pathlib import Path

from helpers import ROOT, SCRIPTS
import sys
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.brief import compose_brief


class BriefMergeTests(unittest.TestCase):
    def setUp(self):
        self.templates = ROOT / "assets" / "templates"

    def test_request_overrides_preset_platform_and_scenario(self):
        brief = compose_brief(
            request={
                "title": "今晚这条必须 20 秒",
                "duration_seconds": 20,
                "platform": "douyin",
                "scenario": "knowledge-talk",
            },
            project_settings={"hook_seconds": 3},
            user_preset={
                "id": "my-tech-promo",
                "inherits": {
                    "scenario": "knowledge-talk",
                    "style": "clean-vertical",
                    "platform": "douyin",
                },
                "overrides": {
                    "duration_seconds": 45,
                    "pace": "very-fast",
                    "hook_seconds": 2,
                },
            },
            template_root=self.templates,
        )
        self.assertEqual(brief.scenario, "knowledge-talk")
        self.assertEqual(brief.platform, "douyin")
        self.assertEqual(brief.duration_seconds, 20)
        self.assertEqual(brief.hook_seconds, 3)
        self.assertEqual(brief.pace, "very-fast")
        self.assertEqual(brief.priority_trace[-1]["source"], "request")

    def test_secondary_scenario_adds_constraints_without_replacing_primary(self):
        brief = compose_brief(
            request={
                "scenario": "product-promo",
                "secondary_scenarios": ["tutorial"],
            },
            template_root=self.templates,
        )
        self.assertEqual(brief.scenario, "product-promo")
        self.assertIn("tutorial", brief.secondary_scenarios)
        self.assertTrue(any("step_clarity" in item for item in brief.quality_constraints))

    def test_missing_scenario_falls_back_to_generic(self):
        brief = compose_brief(request={"title": "随便做一条"}, template_root=self.templates)
        self.assertEqual(brief.scenario, "generic")
        self.assertGreaterEqual(brief.duration_seconds, 8)


if __name__ == "__main__":
    unittest.main()
