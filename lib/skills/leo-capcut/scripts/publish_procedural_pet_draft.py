import sys, time
from pathlib import Path

SCRIPTS_DIR = Path('D:/agent-transfer/lib/skills/leo-capcut/scripts')
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from leo_capcut.adapters.jianying import JianyingAdapter
from leo_capcut.timeline_ir import validate_timeline

VIDEO_PATH = Path('D:/agent-transfer/lib/skills/leo-capcut/procedural_cat_verified_preview.mp4')
TOTAL_DURATION_US = 10_000_000

timeline_payload = {
    'schema_version': '1.0',
    'project_name': '纯代码程序化萌宠_小猫与蝴蝶',
    'canvas': {'width': 720, 'height': 960, 'fps': 30},
    'duration_us': TOTAL_DURATION_US,
    'assets': [
        {
            'id': 'procedural_cat_video',
            'kind': 'video',
            'uri': str(VIDEO_PATH),
            'duration_us': TOTAL_DURATION_US
        }
    ],
    'tracks': [
        {
            'id': 'trk_video_main',
            'type': 'video',
            'name': '程序化萌宠主轨',
            'clips': [
                {
                    'id': 'cat_clip',
                    'start_us': 0,
                    'duration_us': TOTAL_DURATION_US,
                    'asset_id': 'procedural_cat_video',
                    'filter_type': '_1980',
                    'keyframes': [
                        {'property': 'scale_x', 'time_offset': 0, 'value': 1.0},
                        {'property': 'scale_y', 'time_offset': 0, 'value': 1.0},
                        {'property': 'scale_x', 'time_offset': 6_500_000, 'value': 1.0},
                        {'property': 'scale_y', 'time_offset': 6_500_000, 'value': 1.0},
                        {'property': 'scale_x', 'time_offset': 10_000_000, 'value': 1.15},
                        {'property': 'scale_y', 'time_offset': 10_000_000, 'value': 1.15},
                        {'property': 'position_y', 'time_offset': 10_000_000, 'value': -0.08}
                    ]
                }
            ]
        },
        {
            'id': 'trk_subtitles',
            'type': 'text',
            'name': '治愈系花字解说',
            'clips': [
                {
                    'id': 'sub_1',
                    'start_us': 300_000,
                    'duration_us': 3_000_000,
                    'text': '纯代码程序化小猫：好奇苏醒 🐾',
                    'font': '黑体',
                    'font_size': 7.5
                },
                {
                    'id': 'sub_2',
                    'start_us': 3_500_000,
                    'duration_us': 3_200_000,
                    'text': '捕捉到发光小蝴蝶啦！伸出粉嫩小爪~ ✨',
                    'font': '黑体',
                    'font_size': 7.5
                },
                {
                    'id': 'sub_3',
                    'start_us': 6_900_000,
                    'duration_us': 3_000_000,
                    'text': '蝴蝶落入耳畔，心满意足进梦乡 🌸',
                    'font': '黑体',
                    'font_size': 7.5
                }
            ]
        }
    ]
}

timeline = validate_timeline(timeline_payload)
print(f'Timeline IR Validated: {timeline.project_name}')

adapter = JianyingAdapter.detect('windows')
proj_name = f'纯代码程序化萌宠小猫_{int(time.time())}'
is_running = adapter.process_checker.is_running()
res = adapter.publish(timeline, project_name=proj_name, register=(not is_running))
print(f'Draft Published Successfully!')
print(f'Draft Folder: {res.draft_dir}')
print(f'Project ID: {res.project_id}')
