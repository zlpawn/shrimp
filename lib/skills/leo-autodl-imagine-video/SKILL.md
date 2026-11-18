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
> 1. **成品效果第一（Quality-First）与双擎智能路由原则**：
>    * **废除低参 1-Pass 草稿流，默认直出高保真锁脸成片**：`--video` 根据传入的参考图与 `--mode` 自动分流至两套无损高精工作流（无 `EasyCache` 劣化，自带 `H3SigmaRefiner` 尾段细节精修）：
>      * **首帧 / 首尾帧严格锁死模式（`--mode i2v` 或 `auto` 下传入 0～2 张图，默认主力）**：自动路由至 `API-U02-minimax_h3_图生视频基础版-V2.json`（`fl2va` 底模 + `MiniMaxH3ImageToVideo` 25+2 步）。传入 **1 张分镜首帧图**时自动钉死第 0 秒首帧并解绑尾帧；传入 **2 张图**时同时钉死首帧与尾帧；传入 **0 张图**时清理示例图走纯净文生视频。配合上游生图技能（如 `leo-codex-imagine`）生成的宫格分镜切片，彻底根治跨视频换脸与开场构图漂移！
>      * **多图角色参考模式（`--mode r2v` 或 `auto` 下传入 3～9 张图 / 含参考视频）**：自动路由至 `API-U06-9图版API-V5.json`（`ref2va` 底模 + `MiniMaxH3ReferenceToVideo` 22+2 步，默认开启 `--ref-image-size max` 2048px 高保真参考与无 Turbo 满步分支 `718.inputs.select=1`），适合单镜头大幅转头或多角色同框绑定。
>    * **进阶专项场景自由调度**：
>      * **文戏微表情 + 外部人声驱动超分**：选用 `minimax_audio_driven_builder_latent_upscale_2pass_api.json` 或 `API-U30.json`（2-Pass 潜空间放大）；
>      * **疾驰奔跑 / 剧烈运动 / 武戏打斗**：选用挂载 Combat / Motion Repair LoRA 的 `API-U24-文武双修T8版.json`、`API-U08.json`；
>      * **严丝合缝说话对口型**：选用 `API-U11-Minimax-图片音频对口型API.json`。
>    * **单镜头防漂移铁律**：单条生成时长推荐控制在 **4～6 秒**、一镜一连续动作；严禁在一条长镜头里硬塞多机位切镜或未给尾帧的大幅 180° 转身。
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
* **默认基准与双擎核心工作流 (`references/workflows/`)**：
  * [workflows/minimax_h3_image_u33_api.json](references/workflows/minimax_h3_image_u33_api.json) —— 9 节点高清生图与分镜定妆工作流
  * [workflows/u_series_api/API-U02-minimax_h3_图生视频基础版-V2.json](references/workflows/u_series_api/API-U02-minimax_h3_图生视频基础版-V2.json) —— **默认主视频流（`i2v` 首帧/首尾帧锁死 + `H3SigmaRefiner` 25+2 步）**
  * [workflows/u_series_api/API-U06-9图版API-V5.json](references/workflows/u_series_api/API-U06-9图版API-V5.json) —— **默认多参考视频流（`r2v` 最多 9 图主体绑定 + `ref_image_size=max` 22+2 步）**
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

# 5. 执行高保真音画同步生视频（自动分流双默认引擎）
# 示例 A：锁死分镜首帧（传入 1 张分镜图自动走 API-U02 首帧锁死；传 2 张自动锁首尾两帧）
uv run --script "$CLI_PATH" --video --mode i2v \
  --ref-images "./shot_01_start.png" \
  --prompt "<六段式或动作提示词>" --duration 5.0 --aspect-ratio "9:16" --json

# 示例 B：多视角角色参考生成（传正脸+侧面+全身图，走 API-U06 2048px 高保真多图绑定）
uv run --script "$CLI_PATH" --video --mode r2v \
  --ref-images "./char_front.png,./char_side.png,./scene.png" \
  --prompt "<六段式提示词>" --duration 5.0 --aspect-ratio "9:16" --json

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
