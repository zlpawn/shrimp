from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import SCRIPTS

if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.detect import detect_environment


class JianyingCryptoIntegrationTests(unittest.TestCase):
    def test_text_only_publish_roundtrips_with_installed_jianying_dll(self):
        env = detect_environment("windows")
        install_dir = Path(env["install_dir"]) if env.get("install_dir") else None
        if install_dir is None or not (install_dir / "videoeditor.dll").is_file():
            self.skipTest("installed Jianying videoeditor.dll is unavailable")

        timeline = {
            "schema_version": "1.0",
            "project_name": "crypto-integration",
            "canvas": {"width": 1080, "height": 1920, "fps": 30},
            "duration_us": 2_000_000,
            "assets": [],
            "tracks": [
                {
                    "id": "text-1",
                    "type": "text",
                    "name": "字幕",
                    "clips": [
                        {
                            "id": "t1",
                            "start_us": 0,
                            "duration_us": 2_000_000,
                            "text": "真实草稿结构回归测试",
                        }
                    ],
                }
            ],
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            adapter = JianyingAdapter.detect(
                "windows",
                draft_root=root / "drafts",
                user_data=root / "user-data",
                install_dir=install_dir,
            )
            adapter.draft_root.mkdir(parents=True)
            adapter.user_data.mkdir(parents=True)
            result = adapter.publish(timeline, project_name="crypto-integration", register=False)
            draft_dir = Path(result.draft_dir)

            content_raw = (draft_dir / "draft_content.json").read_bytes()
            meta_raw = (draft_dir / "draft_meta_info.json").read_bytes()
            self.assertFalse(content_raw.lstrip().startswith(b"{"))
            self.assertFalse(meta_raw.lstrip().startswith(b"{"))

            content = adapter.codec.decode(content_raw)
            meta = adapter.codec.decode(meta_raw)
            self.assertEqual(content["id"], result.project_id)
            self.assertEqual(meta["draft_id"], result.project_id)
            self.assertEqual(content["duration"], 2_000_000)
            self.assertEqual(content["tracks"][0]["type"], "text")
            self.assertEqual(
                json.loads(content["materials"]["texts"][0]["content"])["text"],
                "真实草稿结构回归测试",
            )


if __name__ == "__main__":
    unittest.main()
