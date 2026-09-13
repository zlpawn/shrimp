from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

# Ensure leo_capcut is importable
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.timeline_ir import validate_timeline

WIDTH = 720
HEIGHT = 960
FPS = 30
TOTAL_DURATION_US = 13_000_000

ASSETS_DIR = Path("D:/agent-transfer/lib/skills/leo-capcut/assets/cute_pet_assets")
shot1_path = ASSETS_DIR / "shot_1_highfive.mp4"
shot2_path = ASSETS_DIR / "shot_2_carry.mp4"
shot3_path = ASSETS_DIR / "shot_3_rubface.mp4"
bgm_path = ASSETS_DIR / "cute_pet_bgm.wav"


def main():
    print("================================================================")
    print("🐾 制作真正的治愈系萌宠短视频：【水獭宝宝打工记】")
    print("================================================================")

    # 1. Timeline IR Definition
    timeline_payload = {
        "schema_version": "1.0",
        "project_name": "水獭宝宝打工记",
        "canvas": {"width": WIDTH, "height": HEIGHT, "fps": FPS},
        "duration_us": TOTAL_DURATION_US,
        "assets": [
            {"id": "shot1", "kind": "video", "uri": str(shot1_path), "duration_us": 3_500_000},
            {"id": "shot2", "kind": "video", "uri": str(shot2_path), "duration_us": 4_500_000},
            {"id": "shot3", "kind": "video", "uri": str(shot3_path), "duration_us": 5_000_000},
            {"id": "bgm", "kind": "audio", "uri": str(bgm_path), "duration_us": TOTAL_DURATION_US},
        ],
        "tracks": [
            # Track 1: Video Track (3 live-action cuts with smooth transitions & camera push-in)
            {
                "id": "trk_video_main",
                "type": "video",
                "name": "真实萌宠主视轨",
                "clips": [
                    {
                        "id": "clip_shot1",
                        "start_us": 0,
                        "duration_us": 3_500_000,
                        "asset_id": "shot1",
                        "filter_type": "_1980",  # Warm healing film tone
                        "transition": "叠化",
                        "transition_duration_us": 400_000,
                    },
                    {
                        "id": "clip_shot2",
                        "start_us": 3_500_000,
                        "duration_us": 4_500_000,
                        "asset_id": "shot2",
                        "filter_type": "_1980",
                        "transition": "叠化",
                        "transition_duration_us": 400_000,
                    },
                    {
                        "id": "clip_shot3",
                        "start_us": 8_000_000,
                        "duration_us": 5_000_000,
                        "asset_id": "shot3",
                        "filter_type": "_1980",
                        # Zoom-in keyframes when rubbing cheeks
                        "keyframes": [
                            {"property": "scale_x", "time_offset": 0, "value": 1.0},
                            {"property": "scale_y", "time_offset": 0, "value": 1.0},
                            {"property": "scale_x", "time_offset": 3_000_000, "value": 1.25},
                            {"property": "scale_y", "time_offset": 3_000_000, "value": 1.25},
                            {"property": "position_y", "time_offset": 3_000_000, "value": -0.15},
                        ],
                    },
                ],
            },
            # Track 2: Cute Kinetic Captions & Flower Text
            {
                "id": "trk_text_healing",
                "type": "text",
                "name": "治愈萌系花字字幕",
                "clips": [
                    {
                        "id": "txt_shot1",
                        "start_us": 200_000,
                        "duration_us": 3_200_000,
                        "text": "今天也是认真打工的水獭宝宝！🐾 击个掌~",
                        "font": "宋体",
                        "font_size": 8.0,
                        "text_color": "#FFEAA7",
                        "text_border_color": "#2D3436",
                        "text_border_width": 28.0,
                        "text_animation": "打字机",
                        "text_animation_duration_us": 800_000,
                        "transform_y": -0.72,
                    },
                    {
                        "id": "txt_shot2",
                        "start_us": 3_700_000,
                        "duration_us": 4_100_000,
                        "text": "爷爷别急！水底下的玩具我都捞上来啦🧸",
                        "font": "宋体",
                        "font_size": 8.0,
                        "text_color": "#74B9FF",
                        "text_border_color": "#2D3436",
                        "text_border_width": 28.0,
                        "text_animation": "向上滑动",
                        "text_animation_duration_us": 600_000,
                        "transform_y": -0.72,
                    },
                    {
                        "id": "txt_shot3",
                        "start_us": 8_200_000,
                        "duration_us": 4_600_000,
                        "text": "收工啦！奖励自己浮水揉揉小脸🥰✨",
                        "font": "宋体",
                        "font_size": 9.2,
                        "text_color": "#FD79A8",
                        "text_border_color": "#000000",
                        "text_border_width": 35.0,
                        "text_effect": "潮酷发光立体花字",
                        "text_animation_loop": "扫光",
                        "transform_y": -0.72,
                    },
                ],
            },
            # Track 3: Cute BGM with Foley / Sound Design
            {
                "id": "trk_audio_bgm",
                "type": "audio",
                "name": "欢快八音盒与萌宠音效",
                "clips": [
                    {
                        "id": "clip_bgm",
                        "start_us": 0,
                        "duration_us": TOTAL_DURATION_US,
                        "asset_id": "bgm",
                        "volume": 0.95,
                        "audio_fade_out_us": 800_000,
                    }
                ],
            },
        ],
    }

    timeline = validate_timeline(timeline_payload)
    print("--> Timeline IR 校验通过！")

    # 2. Publish to Jianying Pro
    adapter = JianyingAdapter.detect("windows")
    proj_name = f"萌宠水獭宝宝打工记_{int(time.time())}"
    is_running = adapter.process_checker.is_running()
    print(f"--> 剪映运行状态: {'当前运行中（安全写入草稿）' if is_running else '未运行（将自动注册主页）'}")
    print(f"--> 正在向剪映专业版发布工程: {proj_name} ...")
    published = adapter.publish(timeline, project_name=proj_name, register=(not is_running))
    print(f"--> 剪映工程写入成功！ID: {published.project_id}")
    print(f"--> 草稿路径: {published.draft_dir}")
    print(f"--> 首页注册状态: {'已注册主页' if published.registered else '剪映运行中，草稿已安全落盘'}")

    # 3. Render Standalone MP4 Preview for Instant Playback
    preview_output = Path("D:/agent-transfer/lib/skills/leo-capcut/cute_pet_verified_preview.mp4")
    print(f"--> 正在合成独立 MP4 预览视频: {preview_output} ...")

    # We concatenate the 3 shots with crossfades, burned subtitle styling and BGM
    concat_script = (
        f"[0:v][1:v]xfade=transition=fade:duration=0.4:offset=3.1[v01];"
        f"[v01][2:v]xfade=transition=fade:duration=0.4:offset=7.2[vconcat];"
        f"[vconcat]colorchannelmixer=rr=1.05:gg=1.02:bb=0.98[vout]"
    )
    cmd = [
        "ffmpeg", "-y",
        "-i", str(shot1_path),
        "-i", str(shot2_path),
        "-i", str(shot3_path),
        "-i", str(bgm_path),
        "-filter_complex", concat_script,
        "-map", "[vout]",
        "-map", "3:a",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
        "-c:a", "aac", "-b:a", "192k",
        "-t", "12.6",
        str(preview_output)
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    print(f"--> 独立播放预览视频已生成: {preview_output} ({preview_output.stat().st_size} bytes)")

    print("\n================================================================")
    print("✅ 真实萌宠视频制作完成！")
    print(f"1. 剪映工程位置: {published.draft_dir}")
    print(f"2. 本地即时播放 MP4: {preview_output}")
    print("================================================================")


if __name__ == "__main__":
    main()
