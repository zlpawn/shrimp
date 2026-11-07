---
name: leo-autodl-imagine-video
description: "基于 AutoDL ComfyUI 的 MiniMax-H3 专属远程音画同步生视频与生图技能。作为无版权原创资产服务商（Footage & Audio Provider），以成品效果第一为核心原则，依托云端 50+ 丰富工作流（U00~U43、VRGDG 2-Pass 潜空间超分流等），根据文戏微表情、武戏动态、多图角色、口型对齐等分镜特征自主推理匹配最佳工作流，支持动态节点微调、断点自愈与全流程安全关机闭环。"
---

# leo-autodl-imagine-video

基于 AutoDL 共创云 (`www.autodl.art`) 旗舰 GPU 与 ComfyUI 的 **MiniMax-H3 专属远程生图与音画同步生视频技能**。
作为各类下游视频编排工程（OpenMontage、hypit、lemo-opuscar 等）的**无版权原创音画资产服务商（Asset & Compute Provider）**，生图与生视频统一采用 `MiniMax-H3` 体系（`MiniMax-H3 DiT` + `Qwen3-VL 32B` 编码器 + `MiniMax Video/Audio VAE`）。

---

## 1. 核心行为铁律 (Iron Rules — 必读)

> [!IMPORTANT]
> 1. **成品效果第一（Quality-First）与动态工作流智能选型原则**：
>    * **效果为第一导向**：云端部署了 50+ 套丰富成熟的工作流（包括 VRGDG 官方 API 系列与 U00~U43 系列）。Agent **严禁受限于单一固化工作流或死板三级档位**，必须依据分镜剧本的视听特征，**自主推理并动态匹配最佳工作流**：
>      * **文戏对白 / 细腻微表情 / 电影感质感**：优先选用 **2-Pass 潜空间放大超分工作流**（`minimax_audio_driven_builder_latent_upscale_2pass_api.json`、`API-U30.json`）。一采定动态，二采利用 Latent Upscale 与高斯噪声注入眼眶微光、皮肤毛孔与织物细节，彻底去除 AI 塑料感；
>      * **疾驰奔跑 / 剧烈运动 / 武戏打斗**：选用挂载 Combat / Motion Repair 专用动作 LoRA 的工作流（如 `API-U24-文武双修T8版.json`、`API-U08`），确保大范围位移不拉丝、不崩脸；
>      * **多图角色绑定 / 服装道具一致性**：选用 `API-U01-minimax_h3_基础版API.json` 或 `API-U06-9图版API-V5.json`；
>      * **严丝合缝说话对口型**：选用 `API-U11-Minimax-图片音频对口型API.json`；
>      * **单通道 1-Pass 高精出片**：在必须使用 1-Pass 时，强制通过 `--steps 16~20`、`--patch 174.inputs.reuse_threshold=0.08`、`--megapixels 1.1`、`--crf 17` 强行拉满画质参数。
>    * **实事求是**：任何新改造的工作流必须经真机运行验证通过后，才可沉淀进 `references/workflows/`，严禁凭空捏造未经验证的节点连线。
> 2. **开机后的出片节奏与安全关机**：
>    * **开机后先盘点（几秒钟）**：`--power-on` 会自动同步工作流备份：写入 skill 源目录（新文件放 `references/workflows/remote_backup/`，内容变了的就地更新），再分发到各 agent 目录。结果在 `workflow_backup` 字段，失败不影响开机。
>    * **效果优先（默认）**：参考图或布局定妆图出完后停下来请用户挑选，确认后再生视频。开机前告诉用户：等待期间照常计费；用户想省钱可以选成本优先。
>    * **成本优先（用户说“省钱”“一口气跑完”“不用确认”等时）**：开机后全自动跑完全部镜头的生成、下载与拼接，中途不停下来确认。
>    * **中途不私自关机**；**完整视频下载、拼接回本地后立即 `--power-off --confirm` 关机**。
>    * **任务失败**：默认不自动关机，因为重新抢显卡可能等很久。把错误告诉用户，由用户决定重试还是关机。用户不在场时生成命令加 `--off-on-fail`。
> 3. **默认输出目录规范（严禁污染工作区代码库）**：
>    * **默认输出位置**：若用户未显式指定目标输出目录，**所有产物（包括中间分镜、参考图、音频及最终合成完整视频）一律且必须默认存放在 `~/.shrimp/skills/leo-autodl-imagine-video/outputs/`**，严禁未经允许直接写入当前工作区根目录、代码目录或污染项目环境。
>    * **按需显式导出**：仅当用户明确指示导出目标路径时，才使用 `--export <文件名> --to <用户目标路径> --clean-others` 将最终成片复制/移动到用户指定目录。
> 4. **视频语言中文优先与标准普通话约束（禁止无控方言漂移）**：
>    * **中文为第一优先级**：除非用户显式要求英文或其他语言，视频中的对白与画外音提示词一律优先采用 `<d>[Chinese] 对白内容 </d>`。
>    * **显式锁定标准发音**：在六段式 Prompt 的 `detailed_description` 角色台词描述中，必须显式追加 `speaks in clear standard Mandarin (标准普通话，发音清晰无方言杂音)`，从源头杜绝非预期方言。
> 5. **字幕不在本 skill 实现**：成片要字幕时，交由 `leo-video-router` 的 `scripts/subtitle_engine.py` 执行 VoiceStudio 转写、单行重排与压制。

---

## 2. 真实沉淀的知识库与工作流导航 (`references/`)

* **🏆 工作流场景能力图谱与选型矩阵（效果优先必读）**：[references/workflow_tuning_guide.md](references/workflow_tuning_guide.md)
* **已上机实测跑通的基准 API 工作流模板 (`references/workflows/`)**：
  * [workflows/minimax_h3_image_u33_api.json](references/workflows/minimax_h3_image_u33_api.json) —— 9 节点生图与分镜定妆工作流
  * [workflows/minimax_h3_video_1pass_api.json](references/workflows/minimax_h3_video_1pass_api.json) —— 15 节点音画同步基础生视频工作流
* **云端成熟工作流原文件与备份库**：
  * [workflows/u_series_api/](references/workflows/u_series_api/) —— 19 套 `API-U*.json` 工作流备份（标准 ComfyUI API 格式，内含 `_api_config` 参数说明，可直接通过 `--run-workflow` 运行）
  * `workflows/remote_backup/` —— 自动备份的远端新工作流
  * [workflows/u_series_canvas/](references/workflows/u_series_canvas/) —— 61 套 `U00~U43` ComfyUI 网页画布原始工作流备份
  * [prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md](references/prompts_and_guides/U视频-MINIMAX-H3_工作流说明.md) —— `U00~U37` 各工作流详细说明
  * [prompts_and_guides/minimax_h3_prompt_guide.md](references/prompts_and_guides/minimax_h3_prompt_guide.md) —— MiniMax-H3 六段式分镜提示词编写指南
  * [prompts_and_guides/minimax_h3_models_and_loras.json](references/prompts_and_guides/minimax_h3_models_and_loras.json) —— 底模、CLIP 与 LoRA 兼容性清单

---

## 3. CLI 命令速查

```bash
CLI_PATH="<本 skill 目录>/scripts/client.py"

# 1. 探活 / 远程开机（支持自动高频轮询抢卡）
uv run --script "$CLI_PATH" --probe --json
uv run --script "$CLI_PATH" --power-on --poll --json

# 2. 查询云端模型 / 自省 ComfyUI 节点 Schema
uv run --script "$CLI_PATH" --list-models all --json
uv run --script "$CLI_PATH" --inspect-node MiniMaxH3ReferenceToVideo --json

# 3. 列出或拉取远端预置的成熟工作流
uv run --script "$CLI_PATH" --list-remote-workflows --json
uv run --script "$CLI_PATH" --fetch-remote-workflow "/root/ComfyUI/custom_nodes/comfyui-vrgamedevgirl/Workflows/UsedForUIDoNotTouch/minimax_audio_driven_builder_latent_upscale_2pass_api.json"

# 4. 执行 MiniMax-H3 高清生图（分镜定妆/角色设定）
uv run --script "$CLI_PATH" --image \
  --prompt "A cinematic close-up portrait of a determined young protagonist, 8k photorealistic masterpiece" \
  --width 1280 --height 736 --steps 12 --json

# 5. 执行音画同步生视频（支持动态切换工作流模板与参数补丁）
# 示例 A：使用 2-Pass 潜空间超分流（效果最好，文戏微表情）
uv run --script "$CLI_PATH" --video \
  --workflow "minimax_audio_driven_builder_latent_upscale_2pass_api.json" \
  --prompt "<六段式提示词>" --duration 4.0 --aspect-ratio "16:9" --json

# 示例 B：单通道工作流但强行拉满画质参数
uv run --script "$CLI_PATH" --video \
  --prompt "<六段式提示词>" --duration 3.0 --aspect-ratio "16:9" \
  --steps 16 --megapixels 1.1 --crf 17 \
  --patch "174.inputs.reuse_threshold=0.08" --json

# 6. 直接执行任意远端 U 系列 API 工作流
uv run --script "$CLI_PATH" --run-workflow "API-U24-文武双修T8版.json" --json

# 7. 导出最终成片并清理临时草稿
uv run --script "$CLI_PATH" --export "MiniMaxH3_00001_.mp4" --to "<工程目录>/素材/" --clean-others --json

# 8. 远程关机停止计费
uv run --script "$CLI_PATH" --power-off --confirm --json
```

**通用参数**：
* `--timeout <秒>`：单次渲染时限，默认 1800 秒。
* `--off-on-fail`：失败时自动关机，用于无人值守。
* `--ref-images a.png,b.png`：参考图列表（最多 9 张），自动上传并绑定。
* `--ref-image-size max`：使用 2048px 短边保留最高人物细节保真度。
