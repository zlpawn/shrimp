# leo-video-router（视频场景路由）

> 一个轻量的视频场景路由 skill：听懂用户想做什么视频，把需求交给最合适的开源项目或 skill，缺失时引导安装。

---

## 🌟 核心特性

1. **场景路由**：按触发词和重叠区分规则，把需求分发到 8 个下游项目之一；判断不了时最多给 2 个候选让用户选。
2. **与生成引擎解耦**：Router 只决定交给谁，不选择、不调用任何底层生成引擎，下游用什么模型由它自己决定。
3. **JIT 安装与目录记忆**：探测项目是否已在本地；未安装时展示仓库和安装命令，用户同意后逐个安装，并把目录登记到 registry，换 agent、重装 skill 都不丢。
4. **omnivoice 优先**：没有录音、也没配商业 TTS 时，优先用本机 omnivoice（VoiceStudio）生成配音，再交给下游。
5. **兜底**：没有命中任何场景或用户拒绝安装时，把需求整理成通用视频提示词，交给环境里已有的视频生成 skill。
6. **不绑定 agent**：所有接入知识都在 skill 自己的 `references/` 和 `scripts/` 里，Claude、Codex、Gemini 等都能直接使用。

---

## 🚀 支持的场景

| 场景 | 项目 |
| :--- | :--- |
| 给个主题，快速或批量出「旁白 + 素材混剪 + 字幕 + BGM」的竖屏信息流短视频 | MoneyPrinterTurbo |
| 已有素材的加工：真人口播剪辑、长视频切短、播客转视频、多语字幕与配音、录屏演示、纪录片、预告片、数字人口播 | OpenMontage |
| 用 AI 生成的人物表演：UGC 口播、短剧、双人播客、街头采访、排行榜、旁白带货 | hypit |
| 指定风格的代码短片（66 种风格），保存自己的风格 | lemo-opuscar |
| 不限风格的代码视频：先出三个方案、按音乐卡点、绿幕人物 + 代码场景、Manim | xilo-opus-video |
| 中文知识口播（15–60 秒）→ 风格讲解动画，可直接拖进剪映 | dashi-animationstyle |
| 具名艺术家笔法、名画穿越、YouTube 解说语法（Vox / 3b1b / Kurzgesagt / 白板 / 财经） | huashu-art-motion |
| 用真实网页做产品宣传片，或给已有视频配音效 | video-shotcraft |

路由规则见 [references/routing-matrix.md](references/routing-matrix.md)，各项目接入细节见 `references/projects/`。

---

## 💻 安装到中央技能库 (~/.agents/skills)

```bash
# macOS / Linux
cp -r "lib/skills/leo-video-router" ~/.agents/skills/

# Windows PowerShell
Copy-Item -Path "lib\skills\leo-video-router" -Destination "$HOME\.agents\skills\" -Recurse -Force
```

需要 Python 3（探测与登记脚本 `scripts/registry.py` 只用标准库）。

---

## 🗂️ 运行期数据

- `~/.shrimp/skills/leo-video-router/registry.json`：已登记的下游项目目录，不在 skill 目录内，换 agent、重装 skill 都不丢。
- `~/.shrimp/skills/<项目名>`：源码类下游项目（如 OpenMontage）的默认下载目录；下载前会先问您要不要指定其他目录。

---

## 📄 许可协议 (License)

MIT License.
