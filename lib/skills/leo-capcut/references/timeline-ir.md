# Timeline IR Specification & Advanced Capabilities

AI output must strictly be Timeline IR, never raw Jianying JSON. The IR is platform-agnostic and validated before draft compilation.

## 1. Core Structure

```json
{
  "schema_version": "1.0",
  "project_name": "string",
  "canvas": { "width": 1920, "height": 1080, "fps": 30 },
  "duration_us": 38450000,
  "assets": [
    { "id": "asset_1", "type": "video", "uri": "D:/path/to/media.mp4" }
  ],
  "tracks": [
    { "id": "track_1", "type": "video", "clips": [ ... ] }
  ]
}
```

## 2. Supported Track Types

`video`, `audio`, `text`, `filter`, `effect`, `sticker`

## 3. Advanced Feature Tiers (Tiers 1 - 6)

### Tier 1: Cinematic Basics (Transitions, Keyframes, Typography)
- **Transitions**: `transition` (e.g. `"信号故障"`, `"运镜向上"`), `transition_duration_us` (e.g. `500000`)
- **Keyframes (Visual)**: `keyframes: [{ "property": "scale_x"|"scale_y"|"transform_x"|"transform_y"|"alpha"|"rotation", "time_offset_us": int, "value": float }]`
- **Typography & Animations**:
  - `font_size`: float (e.g. `8.0`)
  - `text_animation`: string (e.g. `"打字机"`, `"向下飞入"`)
  - `text_animation_duration_us`: int
  - `text_effect`: string (Flower text / 花字, e.g. `"发光"`, `"故障风"`)

### Tier 2: Color Grading & Visual VFX (LUT Filters & Screen Effects)
- **Track `filter`**: `filter_type` (e.g. `"_1980"`, `"港风"`, `"黑白电影"`)
- **Track `effect`**: `effect_type` (e.g. `"_90s画质"`, `"老电视"`, `"雪花"`, `"发光"`)

### Tier 3: Compositing & PIP (Masks & Blend Modes)
- **Masks (`mask`)**: `MaskType` (`"圆形"`, `"矩形"`, `"线性"`, `"镜面"`, `"爱心"`, `"星形"`)
  - `mask_size`: float (default 0.5)
  - `mask_feather`: float (0.0 - 1.0)
  - `mask_invert`: bool
  - `mask_center_x`, `mask_center_y`: float
  - `mask_rotation`: float
- **Mix Modes (`mix_mode`)**: `MixModeType` (`"正片叠底"`, `"滤色"`, `"柔光"`, `"强光"`, `"叠加"`, `"变暗"`, `"变亮"`)

### Tier 4: Audio Engineering (Ducking, Fades, Tone & Scene Effects)
- **Audio Fades**: `audio_fade_in_us`, `audio_fade_out_us`
- **Audio Keyframes (Ducking)**: `keyframes: [{ "property": "volume", "time_offset_us": int, "value": float }]`
- **Tone Effects (`tone_effect`)**: `ToneEffectType` (`"解说小帅"`, `"大叔"`, `"萝莉"`, `"怪物"`, `"机器人"`)
- **Audio Scene Effects (`audio_scene_effect`)**: `AudioSceneEffectType` (`"回音"`, `"扩音器"`, `"电话"`, `"水下"`, `"环绕音"`)

### Tier 5: Dynamic Bubbles & Subtitle Enhancements
- **Text Bubbles (`text_bubble`)**: `TextBubbleType` (e.g. `"标题58"`, `"对话框"`)

### Tier 6: Overlays & Stickers
- **Stickers**: Track `sticker` with `sticker_resource_id` (e.g. `"arrow_down"`, `"like_button"`)

### Tier 7: Video Animations & Chroma Keying
- **Video Animations**:
  - `video_animation_in`: `IntroType` (155 builtin animations, e.g. `"动感放大"`, `"向上滑动"`, `"翻出"`)
  - `video_animation_in_duration_us`: int
  - `video_animation_out`: `OutroType` (124 builtin animations, e.g. `"渐隐"`, `"缩小"`, `"向右滑动"`)
  - `video_animation_out_duration_us`: int
  - `video_animation_combo`: `GroupAnimationType` (123 builtin animations, e.g. `"动感缩小"`, `"三分割"`, `"晃动"`)
- **Chroma Key (Green/Blue Screen)**:
  - `chroma_color`: string (`"#00FF00FF"`, `"#0000FFFF"`)
  - `chroma_intensity`: float (0.0 - 100.0)
  - `chroma_shadow`: float (0.0 - 100.0)

### Tier 8: Canvas Background Filling, Speed & Transform
- **Background Filling**:
  - `background_filling_type`: `"blur"` | `"color"`
  - `background_filling_blur`: float (`0.0625`, `0.375`, `0.75`, `1.0`)
  - `background_filling_color`: string (`"#RRGGBBAA"`)
- **Clip Speed & Pitch**:
  - `speed`: float (0.1 - 100.0)
  - `change_pitch`: bool
- **Orientation**:
  - `flip_horizontal`: bool
  - `flip_vertical`: bool

### Tier 9: Text Outro, Loop Animations & Rich Text Styling
- **Text Outro & Loop**:
  - `text_animation_out`: `TextOutro` (97 builtin animations, e.g. `"向上滑动"`, `"渐隐"`)
  - `text_animation_out_duration_us`: int
  - `text_animation_loop`: `TextLoopAnim` (95 builtin animations, e.g. `"扫光"`, `"摇摆"`, `"彩虹"`, `"弹幕滚动"`)
- **Rich Text Keyword Styling (`style_ranges`)**:
  - `style_ranges: [{ "start": int, "end": int, "color": "#RRGGBB", "size": float, "bold": bool, "italic": bool, "underline": bool }]`

### Tier 10: Portrait Beauty & Skin Tone Enhancement
- **Beauty Retouching**:
  - `beauty_type`: `BeautyType` (`"磨皮"`, `"美白"`, `"匀肤"`, `"清晰"`)
  - `beauty_value`: float (0.0 - 100.0)
- **Skin Tone**:
  - `skin_tone_type`: `SkinToneType` (`"粉白"`)
  - `skin_tone_intensity`: float (0.0 - 100.0)

### Universal Segment Extensions (Clip-level Styling & Audio)
- **Fonts & Typography**: `font` (798 built-in fonts), `text_color`, `text_border_color`, `text_border_width`, `text_background_color`, `text_shadow_color`, `text_align`, `text_vertical`
- **Clip-level Filter & Effect**: `filter_type` and `effect_type` can be attached directly to `video` clips or to global `filter`/`effect` tracks
- **Transforms & Fades**: `transform_x`, `transform_y`, `scale_x`, `scale_y`, `rotation`, `alpha`, `video_fade_in_us`, `video_fade_out_us`
- **Audio Engineering**: `speech_to_song` (`"Lofi"`, `"民谣"`, `"嘻哈"`, `"爵士"`), volume keyframes on audio clips

## 4. Anti-Hallucination Query & Self-Inspection
Agents can query the asset registry before drafting:
- `python -m leo_capcut_cli catalog`: List all 21 categories and counts
- `python -m leo_capcut_cli query-enum --category <cat> --keyword <kw>`: Fuzzy lookup accurate enum names

## 5. Hard Validation Rules
- Video and audio clips require a valid `asset_id` existing in `assets[]`.
- No overlapping clips allowed on the same track.
- Clips must stay within the overall timeline duration.
- Text clips require `text`.
- Clips on the same track cannot overlap in time.
- Clip endpoints cannot exceed timeline `duration_us`.
- Asset and track IDs must be unique across the timeline.
