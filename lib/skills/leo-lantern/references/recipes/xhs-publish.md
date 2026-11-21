# 小红书创作者平台一键发布 (`recipes/xhs-publish.mjs`)

集成了标题 20 字截断安全校验、正文 1000 字符限制校验与 Markdown 脱壳、CDP 原生多图批量上传、黄金时段（15:00~17:00）定时发布配置、Shadow DOM 穿透提交以及后台结果截图存档。

## 参数完全参考表

| 参数名 | 简写 | 类型 | 必填 | 默认值 | 平台约束与功能说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--images` | `-i` | string | **是** | - | 图片列表（以英文逗号分隔），支持 1~18 张图片。自动检查文件存在性。 |
| `--title` | `-t` | string | **是** | - | 笔记标题。**严格限制 <= 20 字符**，超出自动拦截报错。 |
| `--content` | `-c` | string | 否 | `""` | 笔记正文。**严格限制 <= 1000 字符**，支持自动 Markdown 标记脱壳清洗。 |
| `--content-file`| `-f` | string | 否 | `""` | 从 Markdown 文件提取正文（优先匹配 `## 正文可复制版` 区块）。 |
| `--schedule` | `-s` | string | 否 | 黄金时段(`16:00`) | 定时发布时间，格式为 `YYYY-MM-DD HH:MM`。**未传时默认优先读取 `~/.shrimp/skills/leo-xhs-router/config.json` 下的 `preferred_publish_window`（`15:00-17:00`）开启定时发布**（若无对应配置文件则提示询问用户定时发布时间）。 |
| `--now` | - | boolean | 否 | `false` | 显式立即发布模式（跳过默认定时发布）。 |
| `--dry-run` | - | boolean | 否 | `false` | 安全预览模式，填完表单停留在提交前并截取表单。 |
| `--out` | - | string | 否 | `xhs_publish_result.png` | 存证截图落盘路径。 |

## 调用示例

```bash
node <skillDir>/recipes/xhs-publish.mjs \
  --title "别再用Chrome了！实测Zig极速AI浏览器" \
  --content-file "./内容.md" \
  --images "01.png,02.png,03.png" \
  --schedule "2026-11-03 16:00" \
  --out "publish_proof.png"
```

> **退出码与状态确认**：任一步骤失败都以非零退出并中止，不会继续提交；`🎉` 只在确认发布成功时出现。小红书无法仅靠点击确认平台是否受理，点击后只提示“已点击”，须查看截图或平台管理页核对。
