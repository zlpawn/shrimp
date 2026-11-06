---
name: leo-autodl-imagine-video
description: "MiniMax-H3 dedicated cloud image & audio-synced video generation skill on AutoDL ComfyUI. Uses verified MiniMax-H3 workflows for image and audio-video generation, and provides tools to inspect nodes, fetch remote U00~U43 workflows, patch/execute custom ComfyUI workflows, and reference archived U-series workflows and prompt guides."
---

# leo-autodl-imagine-video

基于 AutoDL 共创云 (`www.autodl.art`) 旗舰 GPU 与 ComfyUI 的 **MiniMax-H3 专属远程生图与音画同步生视频技能**。
生图与生视频**统一采用 `MiniMax-H3` 体系**（`MiniMax-H3 DiT` + `Qwen3-VL 32B` 编码器 + `MiniMax Video/Audio VAE`）。

---

## 1. 核心行为铁律 (Iron Rules — 必读)

> [!IMPORTANT]
> 1. **实事求是与可持续验证原则**：
>    * 优先使用 `references/workflows/` 下**已经真机实测跑通**的两个基准工作流（生图 `minimax_h3_image_u33_api.json`、生视频 `minimax_h3_video_1pass_api.json`）。
>    * 若用户对效果不满意需要调优，或需使用二采超分、武戏、文戏等进阶工作流，Agent 可通过 `--patch` 修改已知节点参数，或选用 `references/workflows/u_series_api/` 下的备用工作流。**任何新改造的工作流必须经真机运行验证通过后，才可沉淀进 `references/workflows/`，严禁凭空捏造未经验证的节点连线。**
> 2. **开机后的出片节奏与安全关机**：
>    * **开机后先盘点（几秒钟）**：`--list-remote-workflows` 和 `--list-models all`，和本地 `references/workflows/` 备份比对。远端有本地没有的工作流时告诉用户；换用没验证过的工作流前先征得同意。
>    * **效果优先（默认）**：参考图或布局定妆图出完后停下来请用户挑选，确认后再生视频。开机前告诉用户：等待期间照常计费；用户想省钱可以选成本优先。
>    * **成本优先（用户说“省钱”“一口气跑完”“不用确认”等时）**：开机后全自动跑完全部镜头的生成、下载与拼接，中途不停下来确认。
>    * **中途不私自关机**；**完整视频下载、拼接回本地后立即 `--power-off --confirm` 关机**。
>    * **任务失败**：默认不自动关机，因为重新抢显卡可能等很久。把错误告诉用户，由用户决定重试还是关机。用户不在场时生成命令加 `--off-on-fail`。
> 3. **默认输出目录规范（严禁污染工作区代码库）**：
>    * **默认输出位置**：若用户未显式指定目标输出目录，**所有产物（包括中间分镜、参考图、音频及最终合成完整视频）一律且必须默认存放在 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/`（即 `~/.shrimp/skills/<当前技能名>/outputs/`）**，严禁未经允许直接写入当前工作区根目录、代码目录或污染项目环境。
>    * **按需显式导出**：仅当用户明确指示导出目标路径时，才使用 `--export <文件名> --to <用户目标路径> --clean-others` 将最终成片复制/移动到用户指定目录。
> 4. **视频语言中文优先与标准普通话约束（禁止无控方言漂移）**：
>    * **中文为第一优先级**：除非用户显式要求英文或其他语言，视频中的对白与画外音提示词一律优先采用 `<d>[Chinese] 对白内容 </d>`。
>    * **显式锁定标准发音**：MiniMax-H3 为端到端音画联合扩散模型，在高戏剧冲突、反派暴怒等语境下极易激活训练集中的港台老片/粤语配音潜空间。因此在六段式 Prompt 的 `detailed_description` 角色台词描述中，必须显式追加 `speaks in clear standard Mandarin (标准普通话，发音清晰无方言杂音)`，从提示词源头杜绝非预期方言。
> 5. **字幕不在本 skill 实现**：成片要字幕时，用 `leo-video-router` 的 `scripts/subtitle_engine.py`（VoiceStudio 转写、单行重排、压制），标准见它的 `references/subtitle-standard.md`。

---

## 2. 真实沉淀的知识库与工作流导航 (`references/`)

* **按场景的提示词模板（一个场景一份，新场景验证后再加）**：[references/prompt_templates/](references/prompt_templates/)
  * [dialogue-static-shot.md](references/prompt_templates/dialogue-static-shot.md) —— 固定机位多人对白短剧：布局定妆图锁站位、闭嘴约束、实际时长换算
* **环境路径与 AutoDL 官方 OpenAPI 规范**：[references/autodl_env_and_api.md](references/autodl_env_and_api.md)
* **已验证工作流拓扑、核心节点 Schema 与调优指南**：[references/workflow_tuning_guide.md](references/workflow_tuning_guide.md)
* **已上机实测跑通的默认 API 工作流模板 (`references/workflows/`)**：
  * [workflows/minimax_h3_image_u33_api.json](references/workflows/minimax_h3_image_u33_api.json) —— 已在 RTX 5090 实测跑通的 9 节点生图工作流
  * [workflows/minimax_h3_video_1pass_api.json](references/workflows/minimax_h3_video_1pass_api.json) —— 已在 RTX 5090 实测跑通的 15 节点音画同步生视频工作流
* **可选参考资料与工作流/提示词备份库（供 Agent 按需查阅或跨镜像复用，非强制规范）**：
  * 这些文件很大（工作流 JSON 共约 7 MB，工作流说明约 47 KB）：不要整份读取，先按文件名或标题 grep 出需要的那一节。
  * [workflows/u_series_api/](references/workflows/u_series_api/) —— 19 套 `API-U*.json` 工作流备份（标准 ComfyUI API 格式，内含 `_api_config` 参数说明，可直接通过 `--run-workflow` 运行）
  * [workflows/u_series_canvas/](references/workflows/u_series_canvas/) —— 61 套 `U00~U43` ComfyUI 网页画布原始工作流备份（供参考节点连线或导入其他镜像画布）
  * [prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md](references/prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md) —— `U00~U37` 各工作流的用途、输入与模型技术栈参考说明
  * [prompts_and_guides/minimax_h3_prompt_guide.md](references/prompts_and_guides/minimax_h3_prompt_guide.md) —— MiniMax-H3 六段式分镜、运镜与角色对白提示词编写指南（去重精简版）
  * [prompts_and_guides/minimax_h3_models_and_loras.json](references/prompts_and_guides/minimax_h3_models_and_loras.json) —— MiniMax-H3 底模、CLIP 与 LoRA 清单及 `adaln` 兼容性字典

---

## 3. CLI 命令速查

```bash
# <本 skill 目录> 指含本 SKILL.md 的目录，用实际路径替换。uv 按 client.py 头部声明自动安装依赖
CLI_PATH="<本 skill 目录>/scripts/client.py"

# 1. 探活 / 远程开机（--poll 默认 3 秒一次、共约 15 分钟，--interval / --max-attempts 可调）
uv run --script "$CLI_PATH" --probe --json
uv run --script "$CLI_PATH" --power-on --poll --json

# 2. 查询云端 MiniMax-H3 模型清单 / 查询任意 ComfyUI 节点 Schema
uv run --script "$CLI_PATH" --list-models all --json
uv run --script "$CLI_PATH" --inspect-node MiniMaxH3ReferenceToVideo --json

# 3. 列出或拉取远端预置的成熟工作流原文件 (U00~U43 / VRGDG)
uv run --script "$CLI_PATH" --list-remote-workflows --json
uv run --script "$CLI_PATH" --fetch-remote-workflow "/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_audio_driven_builder_latent_upscale_2pass_api.json"

# 4. 执行已验证的 MiniMax-H3 生图工作流（默认暂存至 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/）
uv run --script "$CLI_PATH" --image \
  --prompt "A cinematic close-up portrait of a cyberpunk girl in neon rain, glowing blue eyes, 8k photorealistic masterpiece" \
  --width 1280 --height 736 --steps 12 --json

# 5. 执行已验证的 MiniMax-H3 音画同步生视频工作流（支持 --patch 动态调整任意节点字段）
uv run --script "$CLI_PATH" --video \
  --prompt "A sleek futuristic sports car speeding through neon rain, dynamic tracking shot, 8k cinematic" \
  --duration 3.0 --aspect-ratio "16:9" --steps 10 \
  --patch "174.inputs.reuse_threshold=0.15" --json

# 6. 直接运行任意自定义或拉取转换后的工作流 JSON
uv run --script "$CLI_PATH" --run-workflow "path/to/workflow.json" --json

# 7. 将用户选定的最终产物移至指定目录，并清理暂存目录中其余无用草稿
uv run --script "$CLI_PATH" --export "MiniMaxH3_Image_00001_.png" --to "<目标目录>" --clean-others --json

# 8. 远程关机停止计费（完整视频全部生成完毕后可直接自动执行；若处于生图/多镜中途阶段则须先获用户确认）
uv run --script "$CLI_PATH" --power-off --confirm --json

# 9. 中断远端正在跑的任务并清空队列（本地进程被杀后远端任务还在跑时用）
uv run --script "$CLI_PATH" --interrupt --json
```

生成命令（`--image` / `--video` / `--run-workflow`）的通用参数：
* `--timeout <秒>`：单次渲染时限，默认 1800，超时会取消远端任务。
* `--off-on-fail`：失败时自动关机，用于无人值守。
* `--ref-images a.png,b.png`：参考图。工作流没有可绑定的节点时，结果里的 `warnings` 会说明；生图模板带参考图的连线**还没有真机验证**，第一次用时要抽查结果是否真的参考了。

**跨平台说明**：
* **Windows PowerShell**：变量写成 `$CLI_PATH = "<本 skill 目录>/scripts/client.py"`，多行命令的续行符 `\` 换成反引号。
* **没有 uv**：先 `python3 -m pip install paramiko requests`，再把 `uv run --script` 换成 `python3`（Windows 用 `python`）。
