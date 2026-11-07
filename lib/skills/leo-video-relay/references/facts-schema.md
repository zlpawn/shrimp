# facts.draft.json

Write only the fields below. `check` adds the video block and computes `status`.

```json
{
  "type": "技术讲解",
  "topic": "用作目录名的主题",
  "sections": [
    { "start": 0, "end": 180, "title": "这一段讲什么", "summary": "可选，一两句", "fact_ids": ["FACT-0001"] }
  ],
  "facts": [
    { "id": "FACT-0001", "kind": "speech", "text": "讲者说用数据库实现队列", "start": 255.2, "end": 262.8, "evidence": ["ASR-S00042"] },
    { "id": "FACT-0002", "kind": "on_screen_text", "text": "白板写着 Data Store as MQ", "start": 258, "end": 258.5, "evidence": ["FRAME-0058"] }
  ],
  "unconfirmed": [
    { "start": 765.1, "end": 770, "description": "白板缩写字迹模糊，疑为 KSQL", "evidence": ["FRAME-0102"] }
  ]
}
```

| `kind` | 内容 | 必须引用 |
|---|---|---|
| `speech` | 说的话 | `ASR-S…` 或 `SUB-S…` |
| `visual` | 画面里发生了什么 | `FRAME-…`（detail） |
| `on_screen_text` | 屏幕文字、烧录字幕、代码、板书 | `FRAME-…`（detail） |
| `metadata` | 平台信息，如发布时间 | 无 |

What makes a useful fact:

- It can be checked against the video, and states what was said or shown rather than what it implies.
- Numbers, names, code, steps and quotes keep their original form.
- Times are in seconds, and sections run in order across the whole video.

Things that go in `unconfirmed`:

- Blurry text, unclear speech, or ambiguous visuals. Write what it looks like and keep the doubt.
- ASR and subtitles that disagree when no manual subtitle or frame settles it. Record both versions.

When a manual subtitle or a frame settles a disagreement, write the settled version as the fact and cite that evidence.
