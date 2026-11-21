# 抖音创作者服务平台自动化发布 (`recipes/douyin-publish.mjs`)

原生支持**视频投稿**与**多图图文**双模自动发布。集成作品标题与描述限制校验、CDP 极速文件上传、遗留未发布草稿自动清理、Bytedance EditorKit 富文本与话题标签注入、自定义封面上传裁剪弹层联动、平台「内容由AI生成」自主声明、定时发布（2小时~14天）、全页高保真预览核对图（Full-Page Screenshot）。**默认直接发布**；传入 `--dry-run` 才会停在提交前。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 平台约束与功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--video` | `-v` | string | 条件必填 | - | 本地视频文件路径（.mp4/.mov等）。与 `--images` 二选一，提供时走**视频发布**流程。 |
| `--images` | `-i` | string | 条件必填 | - | 本地图片列表（以英文逗号分隔），支持 1~35 张图片。提供时走**图文发布**流程。 |
| `--title` | `-t` | string | **是** | - | 作品标题。**视频严格限制 <= 30 字，图文限制 <= 20 字**。**建议精练短小（如《请慢用》）**，因抖音移动端信息流中标题与描述紧密相连，过长会导致第一行折叠并影响视觉。 |
| `--desc` | `-d` | string | 否 | `""` | 作品描述文案。**完全可选（可不写/留空）**。**严格限制 <= 1000 字符**。不写时直接清空富文本，保持纯标题极简发布。 |
| `--desc-file`| `-f` | string | 否 | `""` | 从外部文本/Markdown 文件读取描述（与 `--desc` 二选一）。 |
| `--tags` | - | string | 否 | `[]` | 话题标签列表（如 `AI工具,效率`），自动格式化为 `#话题` 规范追加至正文末尾。 |
| `--cover` | - | string | 否 | `""` | 自定义封面图片路径。提供时自动穿透视频封面裁剪弹窗上传，并跳过横屏补充提示。 |
| `--no-ai` | - | boolean | 否 | `false` | 关闭默认的平台 AI 声明。默认会自动在「自主声明」中规范勾选「内容由AI生成」。 |
| `--visibility` | - | string | 否 | `"公开"` | 谁可以看：`公开` / `好友可见` / `仅自己可见`。 |
| `--schedule` | `-s` | string | 否 | 黄金时段(`16:30`) | 定时发布时间，格式为 `YYYY-MM-DD HH:MM`。**未传时默认优先读取 `~/.shrimp/skills/leo-video-router/config.json`（及 `style-preferences.md`）开启定时发布**（距当前不足 2.5 小时则自动顺延至次日 16:30；若无对应 skill 配置文件则中止并提示询问用户定时发布时间）。 |
| `--now` | - | boolean | 否 | `false` | 显式立即发布模式。仅在传入 `--now`（或 `--immediate` / `--schedule now`）时跳过定时发布、立即公开上线。 |
| `--dry-run` | - | boolean | 否 | `false` | 预览模式。完成上传、所有表单字段填妥并渲染手机预览后，**停留在最终提交前**，截取高清全页核对图供人工复核。不传时会直接点击「发布」。 |
| `--reuse-form` | - | boolean | 否 | `false` | 沿用已打开的同体裁编辑页，**不上传** `--video`/`--images`，只重新填写字段。用于失败后续跑；不传时总是重新上传。 |
| `--out` | - | string | 否 | `douyin_publish_review.png` | 流程结束后的全页核对/存证截图落盘路径。 |

## 调用示例

```bash
# 1. 视频直接发布（默认行为）：
node <skillDir>/recipes/douyin-publish.mjs \
  --video "path/to/video.mp4" \
  --title "视频标题（30字内）" \
  --desc "视频简介文案" \
  --tags "AI视频,效率工具" \
  --schedule "2026-11-06 15:30"

# 2. 只预览（填妥所有选项，截取全页预览图，不提交）：
node <skillDir>/recipes/douyin-publish.mjs \
  --video "path/to/video.mp4" \
  --title "视频标题" \
  --desc "视频简介文案" \
  --tags "AI视频,效率工具" \
  --dry-run

# 3. 多图图文发布：
node <skillDir>/recipes/douyin-publish.mjs \
  --images "img1.png,img2.png" \
  --title "图文标题（20字内）" \
  --desc "图文正文描述" \
  --tags "摄影,胶片感" \
  --schedule "2026-11-06 17:00"
```

> **退出码说明**：任一步骤失败都以非零退出并中止，不会继续提交；`🎉` 只在确认发布成功时出现。
