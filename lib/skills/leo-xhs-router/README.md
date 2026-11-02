# Leo XHS Router（小红书自媒体智能路由与中枢调度管家）

面向小红书（RedNote）全链路内容生产与运营的去中心化智能路由器与 JIT 调度中枢。

## ✨ 特性亮点

- 🧭 **全景交互式方案导航**：主动呈现起号、热点、标题、正文、卡片视觉、体检复盘全景卡片。
- 🔄 **非侵入式解耦架构**：与上游开源仓库（`creator-buddy` 与 `xhs-writer-skill`）保持完全解耦，支持随时 `git pull` 无痛升级，零代码冲突。
- 📦 **克制定向依赖安装**：仅引导安装小红书（XHS）相关专精模块，严格隔离公众号（GZH）与视频模块。
- 💾 **智能工作区记忆**：统一配置文件位于 `~/.shrimp/skills/leo-xhs-router/config.json`，自动持久化记住用户指定的素材目录。
- 🛡️ **纯读者视角品控门禁**：全面吸收原 `xhs-post-creator` 精华，自动扫描并清除“AI生成/草稿/参考重绘/01-06页码”等痕迹。
- 🎨 **可插拔视觉引擎**：支持在 `leo-codex-imagine`、`xhs-html`（62套纯HTML杂志排版）与本地 Pillow 脚本间自由切换。
- 🚀 **自动化发布闭环**：无缝联动 `leo-lantern`，实现真正无弹窗的原生文件注入与自动填表发布。

## 快速使用

```bash
# 查看环境与技能就绪度
node lib/skills/leo-xhs-router/scripts/cli.mjs status

# 记忆工作区
node lib/skills/leo-xhs-router/scripts/cli.mjs config --workspace "<自定义输出目录>"

# 一键安装 XHS 专属子技能
node lib/skills/leo-xhs-router/scripts/cli.mjs install --all
```
