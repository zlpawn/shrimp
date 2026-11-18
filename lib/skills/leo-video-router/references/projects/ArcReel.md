# ArcReel

仓库：https://github.com/ArcReel/ArcReel
本地代码：`/Users/pa/project/AI-JJ/ArcReel`
架构文档：https://docs.arc-reel.com

## 适合

- **小说/长篇故事改编成连贯漫剧或短剧**：万字文本拆集、分镜结构化、角色一致性闭环管理。
- **角色/画风强一致性要求**：固定角色设计图（Asset Sheet）、角色换装子身份（`@[角色/衍生]`）、四宫格/九宫格联合生图自动切片。
- **零耦合挂载任意外部生图 / 生视频 Skill（BYO-Media 模式）**：ArcReel 只做导演编排、提示词组装、多模态视觉验脸（`inspect_images` / `inspect_video_units`）与剪映草稿打包，底层图片与视频可自由交由任意外部 Skill 生成并一键回灌，未来新增或替换同类生图/生视频 Skill 无需改动编排流程。
- **需要输出剪映工程精修**：一键生成中国版剪映草稿包（ZIP），含多轨时间线（视频轨、字幕轨、旁白轨、BGM 轨、定格转场、动画关键帧）。

## 不适合

- 只要 15 秒极速生成单条信息流素材 → 交给 MoneyPrinterTurbo。
- 纯真人口播录屏剪辑、已有素材二次切片 → 交给 OpenMontage。
- 网页产品功能介绍演示片 → 交给 video-shotcraft。

## 安装与启动

1. **启动服务（端口 1241）**：
   - 本地 `uv` 启动：
     ```bash
     cd /Users/pa/project/AI-JJ/ArcReel && uv run uvicorn server.app:app --port 1241
     ```
   - 或 Docker 启动：
     ```bash
     cd /Users/pa/project/AI-JJ/ArcReel/deploy && docker compose up -d
     ```
2. **配置 API Token（存储于独立权限 600 文件）**：
   - 浏览器打开 `http://localhost:1241` →「系统设置」生成 API Key（`arc-` 开头）：
     ```bash
     uv run <本 skill 目录>/scripts/arcreel_bridge.py set-token arc-xxxx
     ```

---

## 外部生图 / 生视频 Skill 解耦协同工作流（锁死人物一致性标准 SOP）

`arcreel_bridge.py` 采用**标准文件契约解耦**：对外只输出结构化 Prompt JSON、只接收本地 `.png/.jpg/.mp4/.wav` 文件，**与具体选用哪个生图 Skill（如 `leo-codex-imagine` 或未来新技能）或生视频 Skill（如 `leo-autodl-imagine-video`、`leo-apimart-video` 或未来新技能）完全零耦合**。

### Step 1：剧本拆解与规划（停在 `plan` 阶段，单镜头默认 5s 防人物漂移）
```bash
B=<本 skill 目录>/scripts/arcreel_bridge.py
uv run "$B" status
uv run "$B" run --novel "<工程目录>/素材/小说.txt" --project "地府打工记" --aspect-ratio "9:16" --stage plan
```
- 自动创建 `generation_mode="storyboard"` + `grid_storyboard=true` + `default_duration=5` 项目，完成分集与剧本拆解，返回待生成的 `pending_assets`（角色/场景/道具清单）与分镜脚本，**不触发 ArcReel 内部付费生图/生视频**。

### Step 2：外部生图 Skill 出「角色定妆卡」➔ 回灌并视觉验脸
1. 读取 `pending_assets`（或 `uv run "$B" call get_prompt_preview '{"project":"地府打工记"}'`），调用当前选定的外部生图 Skill（如 `leo-codex-imagine`）生成角色定妆图。
2. 回灌进 ArcReel（若角色有换装/战损形态，用 `upload-derivative` 注入 `@[角色/衍生]`）：
   ```bash
   uv run "$B" upload-asset --project "地府打工记" --type character --name "林默" --file "<工程目录>/素材/char_林默.png"
   # 可选：注入换装衍生子身份（换衣不换脸、共享同一音色）
   uv run "$B" upload-derivative --project "地府打工记" --character "林默" --derivative "夜行衣" --file "<工程目录>/素材/char_林默_夜行衣.png"
   ```
3. 调 `inspect_images`（免费，图片自动解码落盘至 `saved_images` 路径供 Agent 查看）：
   ```bash
   uv run "$B" call inspect_images '{"project":"地府打工记","resource_type":"character","ids":["林默"]}' --save-media-dir "<工程目录>/素材/_review"
   ```

### Step 3：外部生图 Skill 出「宫格联合分镜图 / 单镜首帧」➔ 验脸切片
1. 以角色定妆图为参考图，调用外部生图 Skill 一次生成 2×2 / 3×3 宫格联合分镜大图（同一张大图注意力共享，跨镜头人脸与服装天然锁死），或逐镜生成首帧定妆图（大幅动作镜头可同时生成尾帧图）。
2. 回灌宫格大图并调 `split_grids` 自动裁切落格（或用 `upload-shot --kind storyboard` / `--kind end-frame` 逐镜回灌）：
   ```bash
   # 方式 A：上传宫格联合大图 -> 视觉验脸 -> 自动切分落格
   uv run "$B" upload-grid --project "地府打工记" --grid-id "grid_01" --file "<工程目录>/素材/grid_01.png"
   uv run "$B" call split_grids '{"project":"地府打工记","grid_ids":["grid_01"]}'

   # 方式 B：单镜头首帧 / 尾帧精准覆盖
   uv run "$B" upload-shot --project "地府打工记" --shot-id "E1S01" --kind storyboard --file "<工程目录>/素材/E1S01_start.png"
   uv run "$B" upload-shot --project "地府打工记" --shot-id "E1S01" --kind end-frame --file "<工程目录>/素材/E1S01_end.png"
   ```
3. 调 `inspect_images`（`resource_type="storyboard"`）核对所有分镜格人脸一致后，才允许进入生视频阶段（改一张图远比重跑视频便宜）。

### Step 4：外部生视频 Skill 锁首帧渲染 ➔ 回灌与抽帧联系表质检
1. 将确认无误的分镜首帧（及可选尾帧）交给外部生视频 Skill 渲染 `.mp4`：
   - 例如使用 `leo-autodl-imagine-video` 时，传 1～2 张分镜首尾帧会自动走 `API-U02`（`fl2va` 25+2 步首尾帧严格锁死底模）；若单镜需大幅转头且有多角度角色图，可显式 `--mode r2v` 走 `API-U06`（`ref_image_size=max` 2048px 高保真多图绑定）。
2. 将渲染好的 `.mp4` 回灌挂载到对应分镜槽位：
   ```bash
   uv run "$B" upload-shot --project "地府打工记" --shot-id "E1S01" --kind video --file "<工程目录>/素材/E1S01.mp4"
   ```
3. **关键防崩质检**：调用 ArcReel 免费的 `inspect_video_units`，服务端自动用 `ffmpeg` 生成带时间戳的抽帧联系表，并标记 `CUT`（单视频内私自切镜/变脸点）、`BLACK`、`FREEZE`，桥接脚本自动将联系表落盘供 Agent 审片：
   ```bash
   uv run "$B" call inspect_video_units '{"project":"地府打工记","unit_ids":["E1S01"]}' --save-media-dir "<工程目录>/素材/_review"
   ```
   一旦发现某条视频中途变脸或私自切镜，仅针对该 `shot_id` 重跑外部生视频 Skill 并重新 `upload-shot` 即可（旧版本自动保留在历史记录中，可通过 `select_video_version` 回滚）。

### Step 5：音频协同、剪映草稿导出与字幕归档
1. **配音**：遵循 Router Step 5 优先级（推荐本机 `voicestudio` / `omnivoice` 生成高质量旁白，或保留生视频引擎如 MiniMax-H3 的音画同步原生对白）。
2. **导出剪映草稿与合成成片**：
   ```bash
   uv run "$B" call export_jianying_draft '{"project":"地府打工记"}'
   uv run "$B" call render_final_cut '{"project":"地府打工记"}'
   ```
3. 交回 Router Step 7 执行单行字幕压制（≤ 16 字）、3-Pick 多平台标题与高潮帧双簧封面归档。

---

## 注意

1. 若某次希望直接使用 ArcReel 内部配置的云端供应商一跑到底，可传 `--stage storyboard` / `video` / `all`（批量生成前会触发 ArcReel 原生 All-or-Nothing 资费准入确认）。
2. 剪映草稿导出面向中国大陆版剪映，解压后直接用剪映打开即可二次手工精修。
