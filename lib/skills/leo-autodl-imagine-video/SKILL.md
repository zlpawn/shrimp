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
> 2. **开机后全量自动出片原则（无需中途反复确认）与安全关机铁律**：
>    * **开机后自动全量出片，无需中途确认**：一旦云端 GPU 实例开机（或自动抢卡成功），Agent **必须全自动闭环推进全部出片流水线（包括所有镜头分镜的连续生成、下载与全片缝合拼接），严禁在中途停下来向用户二次索取确认**，避免因等待人工回复导致高昂的云端 GPU 显卡空转计费。
>    * **中途阶段严禁私自关机**：在仅生成图片、多镜头的中间分镜阶段，严禁中途私自关机。
>    * **完整视频交付后立即自动关机**：当全片/完整视频全部生成完毕并成功下载缝合回本地后，任务彻底闭环，**必须第一时间直接调用 `--power-off --confirm`（或 `client.power_off(confirm=True)`）自动关机停止计费**，坚决不浪费一分钱算力。
> 3. **默认输出目录规范（严禁污染工作区代码库）**：
>    * **默认输出位置**：若用户未显式指定目标输出目录，**所有产物（包括中间分镜、参考图、音频及最终合成完整视频）一律且必须默认存放在 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/`（即 `~/.shrimp/skills/<当前技能名>/outputs/`）**，严禁未经允许直接写入当前工作区根目录、代码目录或污染项目环境。
>    * **按需显式导出**：仅当用户明确指示导出目标路径时，才使用 `--export <文件名> --to <用户目标路径> --clean-others` 将最终成片复制/移动到用户指定目录。
> 4. **视频语言中文优先与标准普通话约束（禁止无控方言漂移）**：
>    * **中文为第一优先级**：除非用户显式要求英文或其他语言，视频中的对白与画外音提示词一律优先采用 `<d>[Chinese] 对白内容 </d>`。
>    * **显式锁定标准发音**：MiniMax-H3 为端到端音画联合扩散模型，在高戏剧冲突、反派暴怒等语境下极易激活训练集中的港台老片/粤语配音潜空间。因此在六段式 Prompt 的 `detailed_description` 角色台词描述中，必须显式追加 `speaks in clear standard Mandarin (标准普通话，发音清晰无方言杂音)`，从提示词源头杜绝非预期方言。
> 5. **字幕全自动转写与单行独立重排（联动 VoiceStudio / omnivoice）**：
>    * **实录音轨全自动转写**：全片缝合完成后，字幕生成**必须优先调用本地 VoiceStudio（`http://localhost:3900/v1/audio/transcriptions`）**，直接从最终成片真实音轨提取语音，坚决避免手工剧本漏掉模型自主发挥的动作呢喃、叹息或画外音。
>    * **严格状态依赖（不静默降级）**：转写前先检查 VoiceStudio 健康状态（`/health`）。若 VoiceStudio 未运行，**明确报错并提示用户启动 VoiceStudio 桌面端应用**，坚决不进行静默降级，确保本地高精度转写生态的一致性。
>    * **台词单行独立重排（Single-line Reflow）**：单条字幕必须按呼吸气口标点（`，。！？、`）与字数上限（$\le 18$ 汉字）自动切分为**纯单行独立条目**，严禁多行折行堆叠（杜绝遮挡关键特写道具或被移动端播放器上下边缘裁切）；压制强制采用院线级暗影描边白字（微软黑体 20pt，`MarginV=35`）。

---

## 2. 真实沉淀的知识库与工作流导航 (`references/`)

* **环境路径与 AutoDL 官方 OpenAPI 规范**：[references/autodl_env_and_api.md](references/autodl_env_and_api.md)
* **已验证工作流拓扑、核心节点 Schema 与调优指南**：[references/workflow_tuning_guide.md](references/workflow_tuning_guide.md)
* **已上机实测跑通的默认 API 工作流模板 (`references/workflows/`)**：
  * [workflows/minimax_h3_image_u33_api.json](references/workflows/minimax_h3_image_u33_api.json) —— 已在 RTX 5090 实测跑通的 9 节点生图工作流
  * [workflows/minimax_h3_video_1pass_api.json](references/workflows/minimax_h3_video_1pass_api.json) —— 已在 RTX 5090 实测跑通的 15 节点音画同步生视频工作流
* **可选参考资料与工作流/提示词备份库（供 Agent 按需查阅或跨镜像复用，非强制规范）**：
  * [workflows/u_series_api/](references/workflows/u_series_api/) —— 19 套 `API-U*.json` 工作流备份（标准 ComfyUI API 格式，内含 `_api_config` 参数说明，可直接通过 `--run-workflow` 运行）
  * [workflows/u_series_canvas/](references/workflows/u_series_canvas/) —— 61 套 `U00~U43` ComfyUI 网页画布原始工作流备份（供参考节点连线或导入其他镜像画布）
  * [prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md](references/prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md) —— `U00~U37` 各工作流的用途、输入与模型技术栈参考说明
  * [prompts_and_guides/minimax_h3_prompt_guide.md](references/prompts_and_guides/minimax_h3_prompt_guide.md) —— MiniMax-H3 六段式分镜、运镜与角色对白提示词编写指南（去重精简版）
  * [prompts_and_guides/minimax_h3_models_and_loras.json](references/prompts_and_guides/minimax_h3_models_and_loras.json) —— MiniMax-H3 底模、CLIP 与 LoRA 清单及 `adaln` 兼容性字典

---

## 3. CLI 命令速查

```bash
PYTHON_BIN="$HOME/.shrimp/skills/leo-autodl-imagine-video/.venv/Scripts/python.exe"
# CLI_PATH 取当前 SKILL.md 所在目录下的 scripts/client.py（如 "$HOME/.agents/skills/leo-autodl-imagine-video/scripts/client.py"）
CLI_PATH="$HOME/.agents/skills/leo-autodl-imagine-video/scripts/client.py"

# 1. 探活 / 远程开机（支持高峰期高频抢卡轮询）
& $PYTHON_BIN $CLI_PATH --probe --json
& $PYTHON_BIN $CLI_PATH --power-on --poll --interval 5 --json

# 2. 查询云端 MiniMax-H3 模型清单 / 查询任意 ComfyUI 节点 Schema
& $PYTHON_BIN $CLI_PATH --list-models all --json
& $PYTHON_BIN $CLI_PATH --inspect-node MiniMaxH3ReferenceToVideo --json

# 3. 列出或拉取远端预置的成熟工作流原文件 (U00~U43 / VRGDG)
& $PYTHON_BIN $CLI_PATH --list-remote-workflows --json
& $PYTHON_BIN $CLI_PATH --fetch-remote-workflow "/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_audio_driven_builder_latent_upscale_2pass_api.json"

# 4. 执行已验证的 MiniMax-H3 生图工作流（默认暂存至 ~/.shrimp/skills/leo-autodl-imagine-video/outputs/）
& $PYTHON_BIN $CLI_PATH --image \
  --prompt "A cinematic close-up portrait of a cyberpunk girl in neon rain, glowing blue eyes, 8k photorealistic masterpiece" \
  --width 1280 --height 736 --steps 12 --json

# 5. 执行已验证的 MiniMax-H3 音画同步生视频工作流（支持 --patch 动态调整任意节点字段）
& $PYTHON_BIN $CLI_PATH --video \
  --prompt "A sleek futuristic sports car speeding through neon rain, dynamic tracking shot, 8k cinematic" \
  --duration 3.0 --aspect-ratio "16:9" --steps 10 \
  --patch "174.inputs.reuse_threshold=0.15" --json

# 6. 直接运行任意自定义或拉取转换后的工作流 JSON
& $PYTHON_BIN $CLI_PATH --run-workflow "path/to/workflow.json" --json

# 7. 将用户选定的最终产物移至指定目录，并清理暂存目录中其余无用草稿
& $PYTHON_BIN $CLI_PATH --export "MiniMaxH3_Image_00001_.png" --to "D:/my-project/assets/" --clean-others --json

# 8. 远程关机停止计费（完整视频全部生成完毕后可直接自动执行；若处于生图/多镜中途阶段则须先获用户确认）
& $PYTHON_BIN $CLI_PATH --power-off --confirm --json
```
