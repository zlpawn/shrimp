# 视频摄取规范

将课程视频转换为统一 IR。ASR 是主证据；多模态视觉和 OCR 是互补的视觉通道。

## 依赖

| 能力 | 本地视频 | URL | 缺失处理 |
|---|---:|---:|---|
| `ffmpeg` / `ffprobe` | 必需 | 必需 | 停止 |
| ASR 后端或已有字幕 | 必需 | 必需 | 停止 |
| `yt-dlp` | 不需要 | 必需 | 停止 |
| 多模态图像理解 | 可选 | 可选 | 尝试 OCR |
| OCR | 可选 | 可选 | 尝试多模态 |
| pHash | 可选 | 可选 | 记录禁用原因 |

所有脚本从 `SKILL_ROOT` 解析。平台规则见 [platform-runtime.md](platform-runtime.md)。

## 视频和转写

1. 本地视频复制到本次 `temp_root`；URL 保存 `.info.json`。
2. 用 `ffprobe` 校验可读性、时长和编码。
3. 已有可靠 SRT、VTT 或结构化字幕时可转换为标准 Segment，不必重复 ASR。
4. 否则先用短片段验证 ASR，再处理完整视频。
5. Segment ID 唯一，时间戳单调且不得超出视频时长。

所有后端失败时设置 `asr_status: failed` 并停止。不得根据课件编造字幕。

## 抽帧和去重

- 保留首帧和末尾可解码帧。
- 小于 2 小时每 30 秒采样，否则每 45 秒。
- 场景阈值默认 `0.3`；白板视频可降到 `0.15` 并记录原因。
- pHash 新帧只与当前组代表帧比较，Hamming distance `<= 6` 归入当前组。

## 视觉证据

按 [decision-tables.md](decision-tables.md) 选择：

```json
{
  "id": "FRAME-0001",
  "timestamp": 120.5,
  "visual_status": "multimodal_and_ocr",
  "multimodal": {
    "status": "complete",
    "description": "目标到结果的三阶段流程",
    "visible_text": ["目标", "行动", "结果"],
    "relationships": ["目标 -> 行动", "行动 -> 结果"]
  },
  "ocr": {
    "status": "complete",
    "text": "目标 行动 结果"
  }
}
```

- 多模态负责版式、箭头、图表关系和视觉强调。
- OCR 负责可搜索文字，不单独推断空间关系。
- 冲突进入 `uncertain_items`。
- 没有 PPT 时允许 `frames: []` 和 `visual_audit_status: not_applicable`。
- 有代表帧但无法使用任何视觉通道时写 `visual_status: not_audited`。

## 多视频

每个视频独立处理，再使用 `V1-`、`V2-` 前缀合并。时间戳保持相对于各自视频。

## 校验

结构见 [intermediate-representation.schema.json](../schemas/intermediate-representation.schema.json)。

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-ir \
  --file <intermediate-representation.json>
```
