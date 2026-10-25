# U视频-MINIMAX-H3

本文档收录 `comfyui-workflow/U视频-MINIMAX-H3/` 目录下按 Windows 文件名自然排序的全部 53 个工作流。说明根据工作流名称、实际节点、上传输入及内部示例提示词整理。目录现无 U15；原 `U08-Aiden-minimax文-图-首尾帧生视频-自动切换-8G-48G` 已移除，仅保留 `U08-MiniMax-H3-极速生成10S只要2分半`。`U00-minimax_h3提示词QWEN3.8群主版V2`、`U09-单采全新加速版`、`U09-双模型版无编解码二采放大` 已不在清单中。U00 V3、U26 需镜像 9.34 及以上。

分辨率普遍按兆像素 × 画幅表对齐到 32 倍数（如 0.7MP / 16:9 ≈ 1152×640）。时长会按 24fps 下 H3 的 `17k+5` 帧网格向上对齐，输入秒数只是请求值。


## U00-minimax_h3提示词QWEN3.8群主版

**工作流类型：** MiniMax H3 多图提示词反推工作流

**主要用途：** 用 Qwen3.8 27B 视觉语言模型读取最多约 9 张参考图，生成可直接用于后续 H3 视频工作流的中文/分镜提示词，不负责出视频。

**能做到的效果：**
- 上传多张主体、服装、场景参考图。
- 用本地 Qwen3.8 + mmproj 理解图片内容。
- 按群主模板整理角色关系、对白与场景描述。
- 预览生成文本，便于复制到 U01/U06 等生成流。

**主要输入：** 多张参考图片，以及描述规则或剧情意图。

**核心模型与技术：** Qwen3.8-27B GGUF、Qwen3.8 mmproj BF16、ZealmanLLM。

## U00-minimax_h3提示词QWEN3.8群主版V3

**工作流类型：** MiniMax H3 提示词规范化工作流

**主要用途：** V2 的升级版。视觉分析改为 `H3_Vision`，可同时吃参考图、参考视频与参考音频；另增「规范化自己已有的提示词」分组，把已写好的剧情草稿整理成正式 H3 提示词。需镜像 9.34 及以上。不负责出视频。

**能做到的效果：**
- 用 Fast Groups Bypasser 在「图+文生成规范化提示词」与「规范化自己已有的提示词」之间切换。
- 图文组：最多 4 张主体参考图，可选参考视频/音频，经 H3_Vision 提取外观后再交给 H3_Promptor。
- 文本组：把带主体编号与对白的草稿（如「主体1少女…主体3说：…」）规范化为可直接粘到生成流的提示词。
- 预览生成文本，便于复制到 U01/U06 等生成流。

**主要输入：** 多张参考图片（图文组）、可选参考视频/音频、剧情/对白草稿。

**核心模型与技术：** H3_Promptor、H3_Vision、ZealmanLLM、Qwen3.8-27B GGUF、Qwen3.8 mmproj BF16。

## U00-selflift群主试玩版

**工作流类型：** MiniMax H3 Self-Lift 群主试玩工作流

**主要用途：** 三张参考图直接出片的试玩流。FL2VA BF16 底模叠加 Turbo v4 EMA，可再挂 Combat、Motion Repair、fafafast 和电影质感 LoRA；采样走 SelfLift，并可用 Qwen3.8 做提示词增强。

**能做到的效果：**
- 三张参考图约束人物与场景。
- SelfLift 采样，可选 LMS 潜空间放大。
- 本地 Qwen3.8 增强提示词。
- Semantic Bridge 对齐语义，8 步 simple 出片。

**主要输入：** 三张参考图片、提示词、秒数、分辨率（默认约 2MP / 16:9）、LoRA 开关。

**核心模型与技术：** MiniMax H3 FL2VA BF16、Qwen3-VL BF16、`minimax_h3_turbo_v4_step600_ema_pruned`、SelfLiftH3Sampler、`h3_upscaler_lms_v0.1_fp32`、MiniMaxH3PromptEnhancerT8、Qwen3.8-27B GGUF、SenseNova Semantic Bridge。

## U01-minimax_h3_light2v多图参考生视频加速版

**工作流类型：** MiniMax H3 多图参考生视频加速工作流

**主要用途：** 使用 MiniMax H3 Reference-to-Video 与 LightX2V / Turbo 加速 LoRA，根据多张参考图生成带音频的短视频。可按兆像素与画幅表选择输出尺寸，适合角色、服装、场景多参考一致性镜头。

**能做到的效果：**
- 上传多张参考图，按节点说明复制加载图可扩展到更多参考位。
- 用分镜式提示词描述动作、运镜与音效。
- 通过 Turbo / LightX2V 降低采样步数、加快出片。
- 按秒数自动推算对齐到模型约束的帧数。
- 解码视频与音频并可选 RTX 视频超分后保存。

**主要输入：** 多张参考图片、分镜/主体描述提示词、视频秒数、分辨率预设（兆像素与画幅）、采样与随机种子。

**核心模型与技术：** MiniMax H3 ref2va INT8、Qwen3-VL MiniMax H3、MiniMax H3 Video/Audio VAE、`minimax_h3_fl2v_turbo_8step_v1.0`、MiniMaxH3ReferenceToVideo、TAEH3、SageAttention。

## U01-minimax_h3_多图参考生视频基础版

**工作流类型：** MiniMax H3 多图参考生视频基础工作流

**主要用途：** U01 加速版的无 Turbo 基线，使用 pruned INT8 ref2va 与 nvfp4 文本编码器，适合对照加速版画质、或在加速 LoRA 不兼容时出片。

**能做到的效果：**
- 多参考图约束人物、服装与场景。
- 按 `subject_definitions` 绑定主体与分镜。
- 原生步数采样，不叠加 LightX2V/Turbo。
- 联合解码画面与音频并输出视频。

**主要输入：** 多张参考图片、分镜提示词、秒数、分辨率与采样参数。

**核心模型与技术：** MiniMax H3 ref2va pruned INT8、Qwen3-VL nvfp4、MiniMax H3 Video/Audio VAE、MiniMaxH3ReferenceToVideo、TAEH3。

## U02-minimax_h3_lightX2v首尾帧图生视频加速版V2

**工作流类型：** MiniMax H3 首尾帧图生视频加速工作流

**主要用途：** 以首帧与尾帧图片锁定起止画面，再用 Turbo 加速的 MiniMax H3 FL2VA 生成中间过渡，适合姿态转换、镜头推进收束和竖屏展示。

**能做到的效果：**
- 分别指定起始帧与结束帧的主体与构图。
- 用分镜提示词控制运镜、光线和氛围过渡。
- 使用 Turbo 8 步 LoRA 加速采样。
- 联合解码画面与音频；可选 RTX 超分。

**主要输入：** 一张首帧图片、一张尾帧图片、动作与氛围提示词、时长/分辨率与采样参数。

**核心模型与技术：** MiniMax H3 fl2va pruned INT8、Qwen3-VL nvfp4、`minimax_h3_fl2v_turbo_8step_v1.0`、MiniMaxH3ImageToVideo、RTXVideoSuperResolution、TAEH3。

## U02-minimax_h3_图生视频基础版

**工作流类型：** MiniMax H3 单图图生视频基础工作流

**主要用途：** 无加速 LoRA 的 I2V 基线。上传一张首帧图，用 FL2VA 生成带音频短视频，便于对照加速版或做低风险试镜。

**能做到的效果：**
- 单图驱动图生视频。
- 按秒数与兆像素表控制成片规格。
- 同步生成并解码音频轨。
- 通过显存清理节点降低连续跑图压力。

**主要输入：** 一张首帧图片、动作提示词、时长、分辨率与采样参数。

**核心模型与技术：** MiniMax H3 fl2va pruned INT8、Qwen3-VL nvfp4、MiniMaxH3ImageToVideo、MiniMaxLowVRAMAttention、TAEH3。

## U03-minimax_h3_light2v-文生视频加速版

**工作流类型：** MiniMax H3 文生视频加速工作流

**主要用途：** 无需参考图，直接用文本提示生成 MiniMax H3 音视频短片，并叠加 Turbo 加速，适合预告片风、动作场景和纯文本试镜。

**能做到的效果：**
- 仅凭提示词生成含动作、运镜与氛围的短视频。
- 使用 Turbo LoRA 降低步数、加快出片。
- 同步生成并解码音频轨。
- 按预设分辨率与秒数控制成片规格。

**主要输入：** 文生视频提示词、视频秒数、分辨率预设、采样与随机种子。

**核心模型与技术：** MiniMax H3 fl2va pruned INT8、Qwen3-VL nvfp4、`minimax_h3_fl2v_turbo_8step_v1.0`、MiniMaxH3ImageToVideo、TAEH3。

## U03-minimax_h3_文生视频基础版

**工作流类型：** MiniMax H3 文生视频基础工作流

**主要用途：** U03 加速版的无 Turbo 基线，使用低显存注意力与分块前馈，适合对照加速版或显存紧张时的纯文生。

**能做到的效果：**
- 纯文本生成带音频短视频。
- 不叠加加速 LoRA，便于观察底模动态。
- 使用 MiniMaxChunkFeedForward / LowVRAMAttention 降低显存。

**主要输入：** 文生视频提示词、秒数、分辨率与采样参数。

**核心模型与技术：** MiniMax H3 fl2va pruned INT8、Qwen3-VL nvfp4、MiniMaxH3ImageToVideo、MiniMaxLowVRAMAttention。

## U04-minimax_h3_5图参考生视频30步版

**工作流类型：** MiniMax H3 五图参考 30 步基础工作流

**主要用途：** U04 加速版的无 Turbo 对照。ref2va BF16 底模、beta57 调度跑满 30 步，适合要看底模动态、不叠加速 LoRA 的多图参考出片。

**能做到的效果：**
- 多张参考图约束角色、服装与场景。
- 30 步 beta57 采样，不挂加速 LoRA。
- 联合解码画面与音频。
- 按兆像素表选择成片尺寸，默认约 1MP / 16:9、10 秒。

**主要输入：** 多张参考图片、分镜提示词、秒数、分辨率与种子。

**核心模型与技术：** MiniMax H3 ref2va BF16、Qwen3-VL INT8、MiniMax H3 Video/Audio VAE、MiniMaxH3ReferenceToVideo、SolAttn、TAEH3。

## U04-minimax_h3_light2v-5图参考生视频加速版

**工作流类型：** MiniMax H3 五图参考生视频加速工作流

**主要用途：** 固定五路参考图输入的 Reference-to-Video 加速版，示例为古风仙侠多镜头叙事（人物、服饰、场景交叉引用），适合短剧预演和角色一致性镜头。

**能做到的效果：**
- 使用五张参考图约束人物、服装与场景外观。
- 按分秒分镜写运镜、对白氛围与环境音效。
- 通过 Turbo 8 步 LoRA 加速生成。
- 输出带音频的成片视频。

**主要输入：** 五张参考图片、分镜提示词、视频秒数、分辨率与采样参数。

**核心模型与技术：** MiniMax H3 ref2va INT8、Qwen3-VL INT8、`minimax_h3_fl2v_turbo_8step_v1.0`、MiniMaxH3ReferenceToVideo、TAEH3。

## U05-MiniMax-H3-一键视频换装

**工作流类型：** MiniMax H3 视频换装工作流

**主要用途：** 上传一段人物视频和一张「只有服装、不要有人」的服装图，用 Qwen3.8 反推服装描述后，按参考生视频把衣服换上，尽量保持人物、发型、姿势、鞋子、背景、光照和运镜不变。

**能做到的效果：**
- 视频 1 提供人物动作与镜头运动，图片 1 只提供目标服装。
- 本地 Qwen3.8 自动写不超过约 100 字的服装描述，并拼进换装提示词。
- 按秒数对齐到 H3 帧网格；默认约 10 秒、最长边约 912。
- Turbo v4 EMA 加速采样，输出带音频的换装成片。

**主要输入：** 一段人物视频、一张纯服装参考图、可选改写换装提示词、生成秒数与最长边分辨率。

**核心模型与技术：** MiniMax H3 ref2va INT8、Qwen3-VL INT8、`minimax_h3_turbo_v4_step600_ema_pruned_comfyui`、Qwen3.8-27B GGUF、ZealmanLLM、MiniMaxH3ReferenceToVideo。

## U05-MiniMax-H3-数字人视频带货-多图生视频

**工作流类型：** MiniMax H3 数字人带货多图生视频工作流

**主要用途：** 用三张参考图分别锁定人物、商品和场景，生成竖屏口播带货短视频。示例为人物手持护肤霜趴在床上介绍产品；适合电商口播、固定场景不跳转的广告镜头。

**能做到的效果：**
- 图片 1 人物、图片 2 商品、图片 3 场景，三路参考约束外观。
- 按口播台词写分镜，要求首帧就启动动作、全程不切场景。
- 一采用 Turbo v4 EMA 加速；二走 ManualSigmas + latent 放大提清。
- 默认竖屏 9:16、0.2MP；画布备注把兆像素改成 0.5 约为 2K。

**主要输入：** 三张参考图片（人物/商品/场景）、口播与动作提示词、生成秒数（默认约 8 秒）、分辨率档位。

**核心模型与技术：** MiniMax H3 ref2va pruned FP8、Qwen3-VL nvfp4、`minimax_h3_turbo_v4_step600_ema_pruned_comfyui`、`minimax_h3_latent_upscaler_3d_fp16`、ManualSigmas、MiniMaxH3ReferenceToVideo。

## U05-minimax_h3-多参考图light2v加速生成-LTX超分

**工作流类型：** MiniMax H3 多参考生成 + LTX 超分综合工作流

**主要用途：** 先用 MiniMax H3 Turbo 多参考快速出片，再接入 LTX 空间超分与画质增强，适合“先快出、再提清”的两段式生产。

**能做到的效果：**
- 五参考图驱动 MiniMax H3 生成带分镜描述的短视频。
- 使用 Turbo 加速降低首轮生成耗时。
- 将结果送入后续超分/封装链路。
- 同时保存一采与提清后的成片。

**主要输入：** 多张参考图片、分镜提示词、MiniMax 生成参数，以及超分相关尺寸与采样参数。

**核心模型与技术：** MiniMax H3 ref2va pruned FP8、Qwen3-VL nvfp4、`minimax_h3_fl2v_turbo_8step_v1.0`、TAEH3。

## U06-minimax_h3_lightX2v多图参考生视频V5

**工作流类型：** MiniMax H3 多图/视频/音频参考加速工作流

**主要用途：** 九图参考位 + 三路参考视频 + 三路参考音频的综合参考生视频。空位可放占位图/空视频/空音频；适合多角色古风或剧情短镜头。

**能做到的效果：**
- 最多约 9 张参考图约束多角色与场景。
- 可选参考视频与参考音频作为额外条件。
- Turbo 8 步加速采样。
- 按兆像素表与秒数对齐帧数。

**主要输入：** 多张参考图片、可选参考视频与参考音频、主体定义与分镜提示词、秒数/分辨率。

**核心模型与技术：** MiniMax H3 ref2va pruned INT8、Qwen3-VL nvfp4、`minimax_h3_fl2v_turbo_8step_v1.0`、MiniMaxH3ReferenceToVideo、Video Helper Suite。

## U06-minimax_h3_多图参考生视频V6

**工作流类型：** MiniMax H3 Turbo 多图参考工作流

**主要用途：** V5 的加速迭代。参考位默认可用空白占位图/视频/音频；加速改为 `minimax_h3_turbo_v4_step600_ema_pruned`，适合在兼容环境下进一步压低步数。

**能做到的效果：**
- 九图 + 三视频 + 三音频参考位，不用的保持空白占位。
- 使用 MiniMax H3 Turbo v4 EMA 加速。
- 与 V5 共用同类输入组织，便于对比两条加速路线。

**主要输入：** 多张参考图片、可选参考视频/音频、主体定义与分镜提示词、Turbo 采样参数。

**核心模型与技术：** MiniMax H3 ref2va pruned INT8、Qwen3-VL INT8、`minimax_h3_turbo_v4_step600_ema_pruned_comfyui`、MiniMaxH3ReferenceToVideo。

## U06-minimax_h3_多图参考生视频V8

**工作流类型：** MiniMax H3 Hybrid 多图参考工作流

**主要用途：** V6 之后的 Hybrid 底模版。主模型改为 `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8`，并叠加 Turbo EMA 与电影质感 LoRA，适合同时吃文生/参考能力的综合参考镜头。

**能做到的效果：**
- 九图 + 三视频 + 三音频参考。
- Hybrid FL2VA/REF2VA 底模兼顾首帧与多参考。
- 电影质感 LoRA 提升成片观感。
- 空白占位位可直接忽略。

**主要输入：** 多张参考图片、可选参考视频/音频、分镜提示词、秒数/分辨率、LoRA 强度。

**核心模型与技术：** MiniMax H3 Hybrid INT8、Qwen3-VL INT8、Turbo v4 EMA、`MinimaxH3真实电影质感V0.1`、MiniMaxH3ReferenceToVideo。

## U07-MiniMax-H3全能参考工作流Work-Fisher

**工作流类型：** MiniMax H3 文生/单图/多图参考综合工作流

**主要用途：** Work-Fisher 整合的全能参考入口，可在文生、单图参考与多图参考间切换，内置 5/10/15 秒提示词三流程模板，并提供低显存保留建议。

**能做到的效果：**
- 在文生、单图参考、多图参考模式间切换。
- 使用内置 5/10/15 秒导演式提示词模板快速写片。
- 用参考位锁定主角、服装与场景一致性。
- 支持原生立体声与多镜头时间轴描述。
- 通过保留显存参数适配约 8G 起的不同显卡配置。

**主要输入：** 提示词（或选用内置模板）、可选单张/多张参考图、可选参考音频、秒数与分辨率、保留显存与采样参数。

**核心模型与技术：** MiniMax H3 fl2va / ref2va、Qwen3-VL nvfp4、MiniMaxH3MultiRateSamplerEXPT8、MiniMaxH3AVDecodeT8、MiniMaxH3AudioConditioningT8、ReservedVRAMSetter、UniBlockSwap。

## U08-MiniMax-H3-极速生成10S只要2分半

**工作流类型：** MiniMax H3 融合 Turbo 极速参考生视频工作流

**主要用途：** 用 fused refdelta Turbo8 底模做双采参考生视频，目标是约 10 秒成片、较短墙钟时间。内置旋钮说明：先降 `steps`，再调 Duration；秒数会按 H3 帧网格向上取整。

**能做到的效果：**
- 双参考图 + 可选音频条件。
- 一采快速出动态，二采可接 latent 放大。
- 建议正式前用 12–14 步检查构图，默认质量约 20 步。
- 按分辨率选择器适配画幅。

**主要输入：** 两张参考图、可选音频、提示词、步数、时长、分辨率。

**核心模型与技术：** `minimax_h3_fused_refdelta_r1024_turbo8_mystic07_int8_convrot`、Qwen3-VL INT8、INT8 Video VAE、`minimax_h3_latent_upscaler_3d_fp16`、MiniMaxH3SigmaShift。

## U09-Minimax-H3二采重绘单模型极速版wuwukasi-V3

**工作流类型：** MiniMax H3 单模型二采重绘工作流

**主要用途：** 九图 + 参考视频 + 三路参考音频的单底模二采。一采快速出剧情，二采用 latent upscaler 提清，强调角色一致性。

**能做到的效果：**
- 一采快速生成运动草稿。
- 二采按更高规格重绘放大。
- 多参考图 + 参考视频 + 多参考音频。
- 可单独调节一采/二采步数与短边分辨率。

**主要输入：** 最多约 9 张参考图、可选参考视频与三路参考音频、主体/分镜提示词、一采与二采分辨率及步数。

**核心模型与技术：** MiniMax H3 ref2va INT8、Turbo 4step、Turbo 8step、`minimax_h3_latent_upscaler_3d_bf16`、EasyCache。

## U09-Minimax-H3二采重绘双模型极速版wuwukasi-V4

**工作流类型：** MiniMax H3 双模型二采重绘工作流

**主要用途：** V3 的双 UNET 版。一采/二采可走不同量化底模（如 INT8 + W4A8 pruned），二采放大更稳，适合要清晰度与一致性的全能参考成片。

**能做到的效果：**
- 双模型分别承担一采动态与二采细节。
- 九图 + 参考视频 + 三音频。
- 两路 VideoCombine 分别预览一采/二采。
- EasyCache 降低重复计算。

**主要输入：** 多张参考图片、可选参考视频/音频、分镜提示词、一采与二采模型及步数。

**核心模型与技术：** MiniMax H3 ref2va INT8、ref2va pruned W4A8、Turbo 4/8 step、latent upscaler 3D BF16、EasyCache。

## U10-DaSiWa-MiniMaxH3-MythicAlchemy-v16导演台

**工作流类型：** MiniMax H3 导演台综合工作流

**主要用途：** Darksidewalker MythicAlchemy v16 导演台，在同一 Controls 面板中切换 T2V / I2V / FLF2V / R2V 与音频条件，并集成超分、插帧等后处理。

**能做到的效果：**
- 在文生、单图、首尾帧、多参考图模式间统一切换。
- 用导演节点编排分镜、参考图时间对齐与提示词。
- 设置分辨率预设、画幅与后处理（AnimeSharp 超分、插帧、RTX 等）。
- 支持音频条件与多示例提示模板。

**主要输入：** 按所选模式提供提示词，和/或首帧、尾帧、多参考图、音频；Settings 面板中的分辨率、画幅与后处理开关。

**核心模型与技术：** MiniMaxH3Director、MiniMax H3 fl2va / ref2va pruned INT8、Qwen3-VL INT4、2x-AnimeSharpV4、TAEH3、DaSiWa EnhancedVideoCombine。

## U11-Minimax-H3-图生视频-音频同步V2

**工作流类型：** MiniMax H3 图生视频 + 音频分析同步工作流

**主要用途：** 单图参考生视频，同时用上传音频做转写/分析，把台词与节奏写进提示词，再叠加 Turbo 4 步，适合对口型或歌曲卡点镜头。

**能做到的效果：**
- 单图锁定人物外观。
- 分析参考音频内容并拼进提示词。
- 可用 Qwen3.8 / Gemma 辅助写词。
- Turbo 4 步（768p）加速出片。

**主要输入：** 一张参考图、一段参考音频、提示词、秒数与分辨率。

**核心模型与技术：** DenoMiniMaxH3ReferenceToVideo、DenoAudioTranscript / AudioAnalysis、Qwen3.8-27B GGUF、Gemma4 E4B、`minimax_h3_fl2v_turbo_4step_v1.0_768p`。

## U12-minimax_h3-全能无加速-可选超分

**工作流类型：** MiniMax H3 全能参考 + 可选 LTX 超分工作流

**主要用途：** 九图 + 参考视频 + 音频的无加速（或轻 Turbo）全能参考流，可选把成片送进 LTX 2.3 做空间超分。分组旁路可关超分、关部分参考位。

**能做到的效果：**
- 多图/视频/音频综合参考生成。
- 默认可走官方 ref2va pruned INT8 底模。
- 可选 LTX 2.3 Distilled + Spatial Upscaler 提清。
- 大量 Get/Set 便于改线与开关模块。

**主要输入：** 多张参考图、可选参考视频与音频、提示词、超分开关、分辨率与秒数。

**核心模型与技术：** MiniMax H3 ref2va pruned INT8、Qwen3-VL nvfp4、LTX 2.3 22B Distilled INT8、LTX Spatial Upscaler x2、Gemma 3 12B、可选 Turbo 4step EMA。

## U13-MiniMaxH3-黑鹤加速视频流整合

**工作流类型：** MiniMax H3 多模式加速整合工作流

**主要用途：** 黑鹤整合的文生/图生/参考生多路并行模板，可同时挂 FL2VA INT8、FL2VA GGUF、REF2VA 等路线，并用 LightX2V 4 步加速，适合一条画布里对比多种出片方式。

**能做到的效果：**
- 多路加载图分别服务不同模式。
- LightX2V Turbo 4 步加速。
- 同时预留 GGUF 低显存路线。
- 各路独立分辨率选择器与 SageAttention。

**主要输入：** 按所选支路提供提示词和/或参考图、秒数与分辨率。

**核心模型与技术：** MiniMax H3 fl2va / ref2va pruned INT8、MiniMax-H3-FL2VA Q4_K_M GGUF、`minimax_h3_fl2v_lightx2v_turbo_4step_v0.1`、SageAttention。

## U14-minimax_h3_神棍最优官方工作流-手动sigma

**工作流类型：** MiniMax H3 手动 Sigma 官方向参考工作流

**主要用途：** 用 ManualSigmas + H3SigmaRefiner 精细控制噪声日程，可在 ref2va / fl2va 间切换，适合对照官方采样曲线、微调动态与清晰度。

**能做到的效果：**
- 多图 + 参考视频 + 参考音频。
- 手动编辑 sigma 曲线并可视化/精炼。
- 开关在不同底模间切换。
- Turbo 8 步可叠加。

**主要输入：** 多张参考图、可选参考视频/音频、提示词、手动 sigma、分辨率。

**核心模型与技术：** MiniMax H3 ref2va / fl2va INT8、ManualSigmas、H3SigmaRefiner、`minimax_h3_fl2v_turbo_8step_v1.0`、TAEH3。

## U16-H3-sigma强化-潜空间放大-爱屋

**工作流类型：** MiniMax H3 Sigma 强化 + 潜空间放大工作流

**主要用途：** 爱屋版参考生视频：一采用官方 Turbo 4 步，二走 latent upscaler 提清，并用 sigma 强化控制动态，适合要清晰度又不想上 LTX 的中短片。

**能做到的效果：**
- 四张参考图驱动角色一致短片。
- 潜空间放大后再采，减少编解码损失。
- 可调放大倍率与双采步数。

**主要输入：** 多张参考图、提示词、秒数、分辨率、放大倍率。

**核心模型与技术：** MiniMax H3 ref2va pruned INT8、`minimax_h3_ref2v_turbo_4step_v0.1`、`minimax_h3_latent_upscaler_3d_fp16`、Qwen3-VL nvfp4。

## U17-MiniMax-H3-latent放大模型双采加速-高动态不糊-去油腻-修音频-全能工作流

**工作流类型：** MiniMax H3 Hybrid 双采 latent 放大全能工作流

**主要用途：** Hybrid 底模 + 双 Turbo LoRA + latent 放大的全能参考流，强调高动态、去油腻和音频条件，是快捷页 U17 的源工作流之一。

**能做到的效果：**
- 四图 + 双音频参考。
- 一采出动态，二采 latent 放大提清。
- Hybrid 底模兼顾 FL2VA/REF2VA。
- 可叠 8 步 / 4 步 Turbo。

**主要输入：** 多张参考图、可选参考音频、提示词、一采/二采步数与放大倍率。

**核心模型与技术：** `minimax_h3_hybrid_fl2va_ref2va_b25-49-int8`、Turbo 8step / 4step 768p、`minimax_h3_latent_upscaler_3d_bf16`、Qwen3-VL nvfp4。

## U18-MiniMax-H3-Remix-FeiHou-Easy-H3-二次采样工作流v2

**工作流类型：** FeiHou Easy-H3 Remix 二次采样工作流

**主要用途：** 肥猴 Easy-H3 面板驱动的 Remix 二次采样。主模型为 `FeiHou_MiniMax-H3_Remix_v0.6`，可在 FL2VA 与 REF2VA W4A8 间配合，适合用一体化输出节点快速改提示与预览。

**能做到的效果：**
- 用 FeiHouEasyH3 面板统一改提示、预览与输出。
- 双采分别解码音视频。
- 分组旁路可关其中一路。
- 注意力后端可切换。

**主要输入：** 按面板提供提示词与参考、分辨率、双采步数。

**核心模型与技术：** FeiHou MiniMax-H3 Remix v0.6、uncensored Qwen3-VL INT8、FeiHouEasyH3Output / PromptPreview、LTXVConcatAVLatent。

## U19-MiniMax-H3-Director导演台二采加速

**工作流类型：** MiniMax H3 Director 导演台工作流

**主要用途：** MiniMaxH3Director 统一切换文生、图生、首尾帧和参考生视频。加速 LoRA、二采、SelfLift 采样和脸部修复都做成可关分组：用就打开，不用就关掉。R2V / V2V / RV2V 换 ref2va 底模，T2V / I2V / FL2V 换 fl2va 底模。

**能做到的效果：**
- 导演节点切换 T2V / I2V / FL2V / R2V。
- 加速 LoRA 打开后走 8 步，关闭后走 20/25 步。
- 二采 Refine 提清，SelfLift 可改走 LMS 潜空间放大；关掉则沿用导演台自己的采样。
- 脸部修复用 YOLOv8 检脸，另可选 4x-UltraSharp。

**主要输入：** 按导演台所选模式提供提示词与参考、分辨率、加速 / 二采 / SelfLift / 脸修开关。

**核心模型与技术：** MiniMaxH3Director / DirectorRefine / DirectorSelfLift / DirectorFaceRefine、FL2VA pruned INT8、REF2VA BF16、Turbo 8step v1.0 与 4step v1.1 768p、`minimax_h3_latent_upscaler_3d_bf16`、`face_yolov8m`、4x-UltraSharp。

## U20-MiniMax-H3-FL2VA-REF2VA-极致高动态-四只兔子

**工作流类型：** MiniMax H3 Hybrid FL2VA/REF2VA 高动态双采工作流

**主要用途：** Hybrid 底模同时吃文生与多参考，叠加 Turbo v4 EMA、武器战斗 LoRA 与动作修复 LoRA，再用 T8 双时钟 + 学习型二采（对齐/放大/细节混合）拉高动态与清晰度。

**能做到的效果：**
- Hybrid FL2VA/REF2VA 一条线兼顾首帧与多参考。
- 战斗武器 LoRA 加强动作与兵器交互。
- Motion Repair 稳住高速肢体。
- T8 一采/二采 + latent 放大 + AVDecode 出片。

**主要输入：** 多张参考图、战斗/高动态分镜提示词、秒数与分辨率、LoRA 强度。

**核心模型与技术：** MiniMax H3 Hybrid INT8、Turbo v4 EMA、`Bunny_weapon_combatV1`、`Motion_Repair`、MiniMaxH3DualClockSamplerT8、MiniMaxH3LearnedLatentUpscaleT8Advanced、MiniMaxH3AVDecodeT8。

## U20-MiniMax-H3-激烈战斗动作连续性-四只兔子

**工作流类型：** MiniMax H3 战斗动作双 LoRA 工作流

**主要用途：** Hybrid 底模叠加 Combat LoRA 与动作连续性修复 LoRA，针对高速对打、连续攻击和双人交互。一采 Combat 为主、连续性修复 0.5–0.7；二采连续性修复降到 0.2–0.3 收模糊与重影。

**能做到的效果：**
- 多参考图锁定角色外观。
- Combat LoRA 加强动作速度与受击反馈。
- 动作连续性修复 LoRA 稳住高速肢体。
- 可选触发词：`prfight2` / `prfin1`、`bunny_crisp_motion`。

**主要输入：** 多张参考图、战斗分镜提示词、两路 LoRA 权重、秒数与分辨率。

**核心模型与技术：** MiniMax H3 Hybrid INT8、`H3_Combat_V2`、`动作i连续性修复LORA`、LightX2V Turbo 4 步。

## U21-H3视频生成双显卡加速-非双显卡勿用

**工作流类型：** MiniMax H3 Raylight 双 GPU 参考生视频工作流

**主要用途：** 用 RayInitializer + RayUNETLoader 把 DiT 拆到双卡并行。单卡环境不要跑，会初始化失败或更慢。

**能做到的效果：**
- 单图参考生视频。
- 双卡分担 UNET 前向。
- Turbo 8 步 768p 加速。
- 按兆像素表出片。

**主要输入：** 一张参考图、提示词、秒数与分辨率；机器需两张可用 GPU。

**核心模型与技术：** Raylight（RayInitializer / RayUNETLoader / RayBasicGuider）、MiniMax H3 ref2va pruned INT8、`minimax_h3_fl2v_turbo_8step_v1.0_768p`。

## U21-H3视频生成双显卡加速-非双显卡勿用V2

**工作流类型：** MiniMax H3 Raylight 双 GPU 多参考工作流（V2）

**主要用途：** U21 的升级版。九图 + 三路参考音频，底模改为 Hybrid INT8，叠加 Turbo v4 EMA 与电影质感 LoRA。仍用 Raylight 把 DiT 拆到双卡；单卡环境不要跑。

**能做到的效果：**
- 最多 9 张参考图 + 3 路参考音频。
- 双卡分担 UNET 前向（RayLoraLoader / RayUNET）。
- Hybrid 底模兼顾 FL2VA/REF2VA。
- 按兆像素 × 画幅表对齐到 32 倍数。

**主要输入：** 多张参考图、可选参考音频、分镜提示词、秒数与分辨率；机器需两张可用 GPU。

**核心模型与技术：** Raylight、MiniMax H3 Hybrid INT8、Qwen3-VL INT8、Turbo v4 EMA、`MinimaxH3真实电影质感V0.1`、INT8 Video VAE。

## U22-MiniMaxH3-多参考生视频-优化版-YZ金鱼

**工作流类型：** MiniMax H3 多参考双采优化工作流

**主要用途：** 金鱼优化的九图 + 三视频 + 三音频参考流。Hybrid 底模叠加 MysticXXX、武术空间物理、Turbo EMA 与 latent 放大；参考图最多 9 张，不用的位用开关关掉。

**能做到的效果：**
- 多参考图/视频/音频综合条件。
- 双采 + latent 放大提清。
- 多 LoRA 分别控风格、动态与物理。
- 两路 VideoCombine 预览。

**主要输入：** 最多 9 张参考图、可选参考视频/音频、分镜提示词、LoRA 开关与强度。

**核心模型与技术：** MiniMax H3 Hybrid INT8、Turbo v4 EMA、MysticXXX_MMH3-V1、`wushu_spatial_physics_v2`、latent upscaler 3D FP16。

## U23-MiniMaxH3-南风V10

**工作流类型：** MiniMax H3 南风多参考一体节点工作流

**主要用途：** 用 `NanFengH3MultiReferenceGeneratorV10` 把模型、参考、提示词和输出收进单一节点，画布极简，适合按南风 V10 面板习惯出多参考片。

**能做到的效果：**
- 在一个节点内完成多参考生成。
- Hybrid 底模 + 官方 Turbo 4 步 + 电影质感 LoRA。
- 可选 Hunyuan 1080p latent upsampler。
- 直接 VideoCombine 出片。

**主要输入：** 按南风节点面板提供参考图/音频、提示词、分辨率与秒数。

**核心模型与技术：** NanFengH3MultiReferenceGeneratorV10、MiniMax H3 Hybrid INT8、`minimax_h3_ref2v_turbo_4step_v0.1`、`MinimaxH3真实电影质感V0.1`。

## U23-MiniMaxH3-南风V15

**工作流类型：** MiniMax H3 南风多参考一体节点工作流

**主要用途：** V10 的后继。`NanFengH3MultiReferenceGeneratorV15` 把底模、参考、提示词和输出收进单一节点。画布注明本镜像不支持 DLSS；RTX 超分需先确认机器支持再开。

**能做到的效果：**
- 在一个节点内完成多参考生成。
- ref2va INT8 底模配合 Qwen3-VL BF16。
- 直接 VideoCombine 出片。
- 示例提示词按约 5 秒参考生成写好，可改成自己的分镜。

**主要输入：** 按南风 V15 面板提供参考图、提示词、画幅、兆像素与秒数。

**核心模型与技术：** NanFengH3MultiReferenceGeneratorV15、`minimax_h3_ref2va_int8_convrot`、Qwen3-VL BF16、MiniMax H3 Video/Audio VAE。

## U24-文武双修T8版MiniMaxH3双采参考生视频V2

**工作流类型：** MiniMax H3 T8 双采参考生视频工作流

**主要用途：** T8 插件双时钟采样 + 学习型二采对齐/放大/细节混合。九图参考，一采/二采可分别挂 Combat、Dasiwa、ErosMax、Motion Repair、电影质感等 LoRA。快捷页 U24 源工作流。

**能做到的效果：**
- 最多 9 张参考图（空位用空白占位图）。
- T8 双时钟采样与音频条件。
- 学习型二采：parity plan → latent upscale → reconcile → detail mixer。
- 一采/二采 LoRA 链可独立开关。
- AVDecodeT8 联合解码音视频。

**主要输入：** 多张参考图片、分镜提示词、秒数、分辨率（建议不超过约 1MP）、一采/二采 LoRA 与放大倍率。

**核心模型与技术：** MiniMax H3 Hybrid INT8、MiniMaxH3DualClockSamplerT8、MiniMaxH3LearnedTwoPassParityPlanT8Advanced、MiniMaxH3LearnedLatentUpscaleT8Advanced、MiniMaxH3TwoPassLatentReconcileT8Advanced、MiniMaxH3TwoPassDetailMixerT8Advanced、MiniMaxH3AVDecodeT8、`minimax_h3_fl2v_turbo_4step_v1.2_768p`、T8 curve-projected Turbo / Dasiwa / Combat / Motion Repair。

## U24-文武双修T8版MiniMaxH3双采参考生视频V927

**工作流类型：** MiniMax H3 T8 双采参考生视频工作流

**主要用途：** U24 V2 的 9 月 27 日修订。仍是 T8 双时钟 + 学习型二采，九图参考。LoRA 链按 index 0 文戏、index 1 武戏切换；特效多时动态权重可调到 5–10。放大模型换成锐度向 `h3_upscaler_sharpness_2000steps`。

**能做到的效果：**
- 最多 9 张参考图。
- 文戏 / 武戏两套 LoRA 索引。
- T8 双时钟、语义桥和音频条件。
- 学习型二采：parity plan → latent upscale → reconcile → detail mixer。

**主要输入：** 多张参考图片、分镜提示词、秒数、分辨率、文戏/武戏索引、一采/二采 LoRA 与放大倍率。

**核心模型与技术：** MiniMax H3 Hybrid INT8、MiniMaxH3DualClockSamplerT8、LearnedTwoPass 系列节点、`minimax_h3_fl2v_turbo_4step_v1.2_768p`、`h3_upscaler_sharpness_2000steps_v0.1_fp32`、Combat / Dasiwa curve-proj / ErosMax T8 / Motion Repair V2 / 电影质感 / LMS / fafafast、Semantic Bridge。

## U25-Singularity-Vdn文戏版-MiniMaxH3单采极速参考生视频V2-T8

**工作流类型：** MiniMax H3 Singularity + VDN 单采参考工作流

**主要用途：** 文戏向单采。底模用 Singularity ref2va v1.3 INT8，经 T8 的 VDN Model Composer / Execution Plan 做单次极速参考生视频，不走二采。快捷页 U25 源工作流之一。

**能做到的效果：**
- 单张参考图即可出片。
- T8 VDN 组合器与执行计划压低步数。
- AVDecodeT8 联合解码音视频。
- 适合对白、站位、中近景文戏，不适合激烈打戏。

**主要输入：** 一张参考图、分镜/对白提示词、秒数与分辨率。

**核心模型与技术：** `Minimax-h3_Singularity_ref2va_v1.3_int8`、MiniMaxH3VDNModelComposerT8Advanced、MiniMaxH3VDNExecutionPlanT8Advanced、MiniMaxH3AVDecodeT8、Qwen3-VL nvfp4。

## U26-MiniMax-H3智能一体化视频创作V3-孤海

**工作流类型：** MiniMax H3 孤海一体化双采工作流

**主要用途：** 孤海 `MiniMaxH3IntegrationGH` 把模式、参考素材、提示词和规格收进单一面板。可在文生/关键帧（`text_keyframes`）与全参考（`all_reference`）间切换；一采用 FL2VA + T8 双时钟，二采 REF2VA + latent 放大 + 分块采样提清。需镜像 9.34 及以上。

**能做到的效果：**
- 一体化节点选择画幅（含 adaptive）、兆像素与秒数，并按 `<Picture 1>` 等标签引用参考图。
- 一采出动态预览，二采可按倍率放大并分块采样。
- 备选 FeiHou Remix 底模 + 校色，用于去油腻。
- 两路 VideoCombine 分别预览一采/二采。

**主要输入：** 按一体化面板提供首帧/尾帧/多参考图与可选音频、分镜提示词、秒数与分辨率、二采放大倍率。

**核心模型与技术：** MiniMaxH3IntegrationGH / IntegrationAdapterGH、MiniMaxH3DualClockT8GH、MiniMaxH3AVDecodeT8GH、GoohaiMinimaxH3TiledSampler、GoohaiMinimaxH3LatentUpscalerGH、FL2VA INT8、REF2VA INT8、FeiHou Remix v0.6、`minimax_h3_turbo_4步加速_comfyui`、Qwen3-VL nvfp4。

## U27-MinimaxH3纹理增强-爱屋

**工作流类型：** MiniMax H3 成片纹理增强工作流

**主要用途：** 爱屋版「已有视频再增强」。把成片当作引导视频，用 Hybrid 底模 + LMS LoRA + LightX2V 做一次锐化提清，尽量保持照片级真实感，而不是从零生成新剧情。

**能做到的效果：**
- 上传待增强视频，按时长与分辨率表重采样。
- `MiniMaxH3AddGuide` 以原视频为引导，提示词强调锐利细节、自然真实。
- LMS LoRA 加强纹理，LightX2V 4 步加速。
- 左右拼接对比原片与增强片，并分别保存。
- 低显存注意力与分块前馈，降低长视频显存压力。

**主要输入：** 一段待增强视频、可选增强提示词、分辨率（兆像素与画幅）、采样步数。

**核心模型与技术：** MiniMax H3 Hybrid INT8（`b30-49`）、`minimax_h3_lms_v1.0_r64`、`minimax_h3_fl2v_lightx2v_turbo_4step_v0.1`、MiniMaxH3AddGuide、MiniMaxH3SigmaShift、MiniMaxLowVRAMAttention、TAEH3。

## U28-双采数字人-self-lift工作流-爱屋

**工作流类型：** MiniMax H3 Self-Lift 双采数字人工作流

**主要用途：** 爱屋版数字人口播。一张人物图 + 一段口播音频，先编音频潜空间再参考生视频，二采 latent 放大提清；本地 Qwen3.8 可辅助写词。

**能做到的效果：**
- 单图锁定人物外观，音频驱动口型与节奏。
- 一采 FL2VA + LightX2V 4 步，二采 latent upscaler。
- 音视频 latent 分离/拼接（LTXVSeparateAVLatent / Concat）。
- 预览中间结果后再封装成片。

**主要输入：** 一张人物参考图、一段口播音频、提示词、秒数与分辨率。

**核心模型与技术：** MiniMax H3 FL2VA BF16、LightX2V Turbo 4 步、`minimax_h3_latent_upscaler_3d_fp16`、MiniMaxH3ReferenceToVideo、Qwen3.8-27B GGUF、TAEH3。

## U28-黑科技加速双采-self-lift工作流-爱屋

**工作流类型：** MiniMax H3 Self-Lift 双采加速工作流

**主要用途：** 爱屋另一条 Self-Lift 双采。两张参考图，一采 LightX2V 4 步出动态，二采 latent 放大。画布备注：文戏总步数约 6、`transition_step` 5；激烈打戏总步数约 8、`transition_step` 6。

**能做到的效果：**
- 双参考图约束外观。
- 按戏种切换总步数与过渡步。
- 二采 latent 放大提清。
- 按兆像素表出片。

**主要输入：** 两张参考图、提示词、总步数 / transition_step、秒数与分辨率。

**核心模型与技术：** MiniMax H3 FL2VA BF16、LightX2V Turbo 4 步、`minimax_h3_latent_upscaler_3d_bf16`、Qwen3-VL INT8、TAEH3。

## U29-H3高动态多图版-宫格图反推写词-小岚-扣群868450976

**工作流类型：** MiniMax H3 宫格反推 + 高动态多图参考工作流

**主要用途：** 小岚版。最多 6 张图（含宫格），用本地 Qwen3.8 反推 `subject_definitions` 再交给 Hybrid 双采。可叠 Combat、Dasiwa、ErosMax、Motion Repair、电影质感、LMS 等 LoRA，适合高动态分镜。

**能做到的效果：**
- 宫格/多图反推主体定义，减少手写分镜。
- Hybrid 底模 + Turbo 4 步 768p / v4 EMA。
- 多 LoRA 分别控战斗、动态与质感。
- 二采 latent 放大提清。

**主要输入：** 最多 6 张参考/宫格图、可选手改提示词、秒数与分辨率、LoRA 开关。

**核心模型与技术：** MiniMax H3 Hybrid INT8、Qwen3.8 Uncensored GGUF、Turbo 4step 768p、Combat V2、Dasiwa curve-proj、10ErosMax T8、Motion Repair、电影质感、LMS r64、latent upscaler 3D FP16。

## U30-Minimax-H3-Singularity超双采放大-AIGC特异点

**工作流类型：** MiniMax H3 Singularity 超双采放大工作流

**主要用途：** AIGC 特异点版。九图 + 三视频 + 三音频参考，底模 Singularity ref2va v1.3 INT8。一采 Turbo 4 步，二采可叠 LMS 并走 latent 放大。快捷页 U30 源工作流。剪枝底不要挂 AdaLN LoRA。

**能做到的效果：**
- 多图/视频/音频综合参考。
- Singularity 剪枝底 + 官方 Turbo 4 步。
- 二采 latent 放大与 LMS 纹理增强（可选）。
- 分组旁路可关不用的参考位。

**主要输入：** 最多 9 张参考图、可选参考视频/音频、分镜提示词、秒数与分辨率、LMS 强度。

**核心模型与技术：** `Minimax-h3_Singularity_ref2va_Pruned_v1.3_int8`、`minimax_h3_ref2v_turbo_4step_v0.1`、`minimax_h3_lms_v1.0_r64`、`minimax_h3_latent_upscaler_3d_bf16`、`minimax_h3_video_vae_int8_convrot-v2`、Qwen3-VL INT8。

## U31-H3动作替换迁移

**工作流类型：** MiniMax H3 Viggle 动作替换工作流

**主要用途：** 用驱动视频的动作替换到一张人物参考图。底模是 Viggle 剪枝 INT8 + DMD LoRA，配合固定文本条件与手动 sigma。分辨率建议 0.4–1.2MP；1.2MP 时驱动视频和参考图必须足够清晰。

**能做到的效果：**
- 视频驱动、图片定外观。
- 6–8 步 simple/beta/normal/bong_tangent，或手写 sigma 点。
- DMD LoRA 加速蒸馏采样。
- 双路 VideoCombine 预览。

**主要输入：** 一张人物参考图、一段动作驱动视频、提示词、步数或手动 sigma、分辨率。

**核心模型与技术：** `minimax_h3_ref2va_viggle_pruned_int8_convrot`、`viggle_animate_dmd_lora`、ViggleTextCondLoader、CustomSigmas、TAEH3。

## U32-Minimax-H3-1080P-高动态不糊-BUNNY-SelfLift

**工作流类型：** MiniMax H3 Self-Lift 1080P 高动态工作流

**主要用途：** BUNNY 的 1080P 高动态不糊流。Hybrid 底模只走 SelfLift 一条有效采样链，统一 LoRA 链可挂武器战斗、Combat、Motion Repair 和 fafafast，并用 3D latent 放大把成片拉到高分辨率。

**能做到的效果：**
- 最多 9 张参考图锁定外观。
- SelfLift 采样 + LMS/3D latent 放大，面向 1080P 仍保持动态。
- Bunny 武器战斗 LoRA 与 Combat 加强打戏。
- Semantic Bridge 对齐参考语义，SolAttn 稀疏注意力。

**主要输入：** 多张参考图片、战斗分镜提示词、LoRA 开关与强度、放大设置、秒数与分辨率。

**核心模型与技术：** MiniMax H3 Hybrid INT8、SelfLiftH3Sampler / SelfLiftH3TST、`minimax_h3_turbo_v4_step600_ema_pruned`、`Bunny_weapon_combatV1`、`H3_Combat_V2`、`minimax_h3_latent_upscaler_3d_bf16`、Semantic Bridge、SolAttn、TAEH3。

## U33-Minimax-H3图像编辑全能工作流

**工作流类型：** MiniMax H3 多图编辑与宫格故事板工作流

**主要用途：** 用 H3 参考模型做图像编辑和多宫格故事板，不按普通出视频来用。画布分成多图编辑和另一路模型。备注建议步数 8–15，五宫格用 1:1，`ref_image_size` 优先 max，显存紧再改 match。

**能做到的效果：**
- 最多约 9 张参考图做多图编辑。
- 五宫格故事板，画幅按 1:1。
- 两路 Hybrid 底模可分别出图。
- 步数 8–15 都可用。

**主要输入：** 多张参考图片、编辑或分镜提示词、步数、画幅（五宫格建议 1:1）、参考图缩放方式。

**核心模型与技术：** MiniMax H3 Hybrid INT8、Qwen3-VL INT8、MiniMax H3 Video VAE、MiniMaxH3ReferenceToVideo。

## U34-WORK-FISHER-9-28-MINIMAXH3-武戏高动态工作流

**工作流类型：** MiniMax H3 武戏高动态双采工作流

**主要用途：** Work-Fisher 9 月 28 日武戏版。六张参考图，高噪/低噪两段配合 T8 学习型二采。LoRA 覆盖 Combat、枪斗、Motion Repair、Dasiwa 和 fafafast，面向高动态打斗而不是文戏。

**能做到的效果：**
- 六张参考图约束角色与兵器。
- 高噪出动作，低噪收细节。
- 学习型 latent 放大提清。
- 枪斗与 Combat LoRA 加强武戏肢体。

**主要输入：** 六张参考图片、武戏分镜提示词、高噪/低噪 LoRA 强度、秒数与分辨率。

**核心模型与技术：** MiniMax H3 Hybrid INT8、Qwen3-VL nvfp4、MiniMaxH3DualClockSamplerT8、LearnedTwoPass 系列节点、`minimax_h3_fl2v_turbo_4step_v1.2_768p`、`h3_upscaler_sharpness_2000steps_v0.1_fp32`、`H3_Combat_V2`、`minimaxH3枪斗术GunFu`、Motion Repair、Dasiwa curve-proj、fafafast、Semantic Bridge。

## U35-H3官流-终极版-神棍

**工作流类型：** MiniMax H3 官方结构手动 sigma 工作流

**主要用途：** 神棍的官流终极版。Cobijada Hybrid 去审查剪枝 INT8 底模，Turbo 8 步 768p 加速，另挂人物写实 LoRA。采样可走手动 sigma，并接受参考图、参考视频和参考音频。

**能做到的效果：**
- 多图加一段参考视频、一条参考音频。
- 手动 sigma 控制采样曲线。
- Turbo 8 步加快出片，写实人物 LoRA 收皮肤与五官。
- 联合解码画面与音频。

**主要输入：** 多张参考图片、可选参考视频/音频、提示词、手动 sigma、秒数与分辨率。

**核心模型与技术：** `Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned`、Qwen3-VL INT8、`minimax_h3_ref2v_turbo_8step_v1.0_768p`、`h3-realism-people-t2v-i2v-r2v`、ManualSigmas、TAEH3。

## U36-FeiHouEasyH3二段式采样v6

**工作流类型：** FeiHou Easy-H3 二段式采样工作流

**主要用途：** 肥猴 Easy-H3 v6。Remix HSA Turbo v0.8 底模，一采/二采各一条 LoRA 栈，可加人脸精修和多人面部修复。画布备注：要画质就开加速 LoRA，一采 4 步、二采 5 步；要动态就关掉加速 LoRA、打开 Remix Enhancer，一采 8 步、二采 5–6 步。单独的人物图节点优先于主节点第一张图。

**能做到的效果：**
- 一采出动态，二采 latent 放大提清。
- 按画质或动态切换 LoRA 与步数。
- YOLOv8 脸部精修，可做多人面部修复。
- BUNNY ActionLogic Bridge 稳住动作逻辑。

**主要输入：** 多张参考图或主节点素材包、优先人物图、提示词、总步数、一采步数、二采步数、LoRA 开关。

**核心模型与技术：** `FeiHou_MiniMax-H3_Remix_HSA_turbo_v0.8_int8_convrotHQ_pruned`、uncensored Qwen3-VL INT8、FeiHouEasyH3LoraStack、`minimax_h3_fl2v_turbo_4step_v1.2_768p`、`FeiHou_H3_Remix_Enhancer_v1`、`minimax_h3_latent_upscaler_3d_bf16`、`BUNNY_H3_ActionLogic_Bridge_V2`、`face_yolov8m`。

## U37-真-上下文无缝无色差长视频-SelfLift双采-惊尘573

**工作流类型：** MiniMax H3 上下文长视频双采工作流

**主要用途：** 惊尘 573 的长视频衔接流。上一段成片可作为上下文参考接进下一段，并用偏色对齐减轻段与段之间的色差。底模是 FL2VA pruned INT8，另备 Dasiwa Hybrid，备注是混合去油腻、少加载两份大模型。SelfLift 二采走 LMS 放大。8 步 beta，再插 1 步低噪；simple 需要这一步才不糊，beta 可以不加。

**能做到的效果：**
- 上下文开关打开后，把上段视频传进来衔接。
- 偏色对齐，减轻分段色差。
- 九图加参考视频、参考音频。
- SelfLift 二采放大；显存贴边时可开 Low VRAM Attention，更慢但更容易跑完。
- 音频引导羽化，参考图 `max` 更保细节。

**主要输入：** 多张参考图片、上一段上下文视频、可选参考视频/音频、提示词、上下文开关、秒数与分辨率、加速 LoRA 权重。

**核心模型与技术：** MiniMax H3 FL2VA pruned INT8、`DasiwaMinimaxH3_dasiwaREF2VAHybridV1`、Turbo 8step v1.0 768p 与 4step v1.2 768p、SelfLiftH3Sampler、`h3_upscaler_lms_v0.1_fp32`、MiniMaxH3AddGuide、MiniMaxH3AudioGuideFeather、ExtendIntermediateSigmas、Qwen3-VL nvfp4。
