# ArcReel

仓库：https://github.com/ArcReel/ArcReel
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

## 安装

- 源码项目：`git clone https://github.com/ArcReel/ArcReel.git <目录>`（默认目录 `~/.shrimp/skills/ArcReel`），装好后执行 `python3 <本 skill 目录>/scripts/registry.py register ArcReel "<目录>"` 持久化登记。
- **启动服务（端口 1241）**：项目根目录 `<ArcReel 目录>` 取自 `python3 <本 skill 目录>/scripts/registry.py locate ArcReel` 输出的 `path`：
  - 本地 `uv` 启动：
    ```bash
    cd "<ArcReel 目录>" && uv run uvicorn server.app:app --port 1241
    ```
  - 或 Docker 启动：
    ```bash
    cd "<ArcReel 目录>/deploy" && docker compose up -d
    ```
- **配置 API Token（存储于独立权限 600 文件）**：
  - 浏览器打开 `http://localhost:1241` →「系统设置」生成 API Key（`arc-` 开头），并配置用于拆剧本的文本大模型：
    ```bash
    uv run <本 skill 目录>/scripts/arcreel_bridge.py set-token arc-xxxx
    ```

## 交接

> 注意：`registry.py locate ArcReel` 输出的 `entry`（`AGENTS.md`）是 ArcReel 仓库自身的源码开发规范，**视频出片调度无需阅读源码开发规范**，一律以本接入卡与 `arcreel_bridge.py` 为准。

`arcreel_bridge.py` 采用**标准文件契约解耦**：对外只输出结构化 Prompt JSON、只接收本地 `.png/.jpg/.mp4/.wav` 文件，且支持直接传入中文项目名（内部确定性映射为合法的 `[a-z0-9-]+` 项目 ID）。

### Step 1：剧本拆解与规划（停在 `plan` 阶段，单镜头默认 5s 防人物漂移）
```bash
B=<本 skill 目录>/scripts/arcreel_bridge.py
uv run "$B" status
uv run "$B" run --novel "<工程目录>/素材/小说.txt" --project "地府打工记" --aspect-ratio "9:16" --stage plan
```
- 自动创建 `generation_mode="storyboard"` + `grid_storyboard=true` + `default_duration=5` 项目，完成分集、脚本规划与分镜视觉提示词编写，返回 `project_id`、`script_file`（如 `episode_1.json`）、待生成的 `pending_assets` 清单与分镜脚本，**不触发 ArcReel 内部付费生图/生视频**。

### Step 2：外部生图 Skill 出「角色定妆卡」➔ 回灌并视觉验脸
1. 读取 `pending_assets`（单条分镜完整拼接提示词也可随时调 `uv run "$B" call get_prompt_preview '{"project":"地府打工记","script":"episode_1.json","item_id":"E1S01"}'` 查看），调用当前选定的外部生图 Skill（如 `leo-codex-imagine`）生成角色定妆图。
2. 回灌进 ArcReel（若角色有换装/战损形态，用 `upload-derivative` 注入 `@[角色/衍生]`）：
   ```bash
   uv run "$B" upload-asset --project "地府打工记" --type character --name "林默" --file "<工程目录>/素材/char_林默.png"
   uv run "$B" upload-derivative --project "地府打工记" --character "林默" --derivative "夜行衣" --file "<工程目录>/素材/char_林默_夜行衣.png"
   ```
3. 调 `inspect_images`（免费，图片自动解码落盘至 `saved_images` 路径供 Agent 查看）：
   ```bash
   uv run "$B" call inspect_images '{"project":"地府打工记","resource_type":"character","ids":["林默"]}' --save-media-dir "<工程目录>/素材/_review"
   ```

### Step 3：外部生图 Skill 出「宫格联合分镜大图」➔ 本地切片落盘并批量回灌验脸
1. 以角色定妆图为参考图，调用外部生图 Skill 一次生成 `2x2` 或 `3x3` 宫格联合分镜大图（单图注意力共享，跨镜头人脸与服装天然一致）。
2. 调用 **`split-upload-grid`**（零依赖 ArcReel 内部图片供应商）：自动在本地将宫格大图裁切为 `<shot_id>_start.png`（直接供下一步生视频锁首帧复用！），并逐镜回灌至 ArcReel：
   ```bash
   uv run "$B" split-upload-grid \
     --project "地府打工记" --script-file "episode_1.json" \
     --grid 2x2 --shot-ids "E1S01,E1S02,E1S03,E1S04" \
     --file "<工程目录>/素材/grid_01.png" \
     --save-cells-dir "<工程目录>/素材/shots"

   # 若单镜需大幅动作过渡，可额外补一张尾帧图：
   uv run "$B" upload-shot --project "地府打工记" --script-file "episode_1.json" --shot-id "E1S01" --kind end-frame --file "<工程目录>/素材/shots/E1S01_end.png"
   ```
3. 调 `inspect_images`（`resource_type="storyboard"`）核对所有分镜格人脸完全一致后，再放行生视频：
   ```bash
   uv run "$B" call inspect_images '{"project":"地府打工记","resource_type":"storyboard","ids":["E1S01","E1S02","E1S03","E1S04"]}' --save-media-dir "<工程目录>/素材/_review"
   ```

### Step 4：外部生视频 Skill 锁首帧渲染 ➔ 回灌与抽帧联系表质检
1. 将 `<工程目录>/素材/shots/E1S01_start.png`（及可选尾帧）传给外部生视频 Skill（如 `leo-autodl-imagine-video`）：
   - 传 1～2 张图时，`leo-autodl-imagine-video` 自动嗅探首帧图片的真实宽高比（如 `9:16` 竖屏自动对齐 `736x1344`）并路由至 `API-U02`（`fl2va` 25+2 步首尾帧硬锁底模）；多视角自由运镜可显式传 `--mode r2v` 走 `API-U06`（`ref_image_size=max`）。
2. 将渲染好的 `.mp4` 回灌挂载到对应分镜：
   ```bash
   uv run "$B" upload-shot --project "地府打工记" --script-file "episode_1.json" --shot-id "E1S01" --kind video --file "<工程目录>/素材/E1S01.mp4"
   ```
3. **关键防崩质检**：调用 `inspect_video_units`，服务端自动用 `ffmpeg` 生成带时间戳的抽帧联系表，并标记 `CUT`（单视频内私自切镜/变脸点）、`BLACK`、`FREEZE`，桥接脚本自动把联系表落盘供 Agent 审片：
   ```bash
   uv run "$B" call inspect_video_units '{"project":"地府打工记","unit_ids":["E1S01","E1S02"]}' --save-media-dir "<工程目录>/素材/_review"
   ```
   若某镜出现中途变脸或私自切镜，仅重跑该单镜并再次 `upload-shot` 覆盖即可。

### Step 5：一键建时间线、导出剪映草稿与无字幕原片
```bash
uv run "$B" export --project "地府打工记" --episode-id 1 --output-mp4 "<工程目录>/成片/原始版/raw.mp4"
```
- 自动创建/复用剪辑时间线（`tl-...`），轮询完成剪映草稿导出，并以 `burn_subtitles=false` 渲染下载干净原片至 `成片/原始版/raw.mp4`，随后交回 Router Step 7 由 `subtitle_engine.py` 压制单行院线字幕（避免双层字幕重叠）。

## 音频

- **对白镜头**：保留外部视频引擎（如 `leo-autodl-imagine-video` MiniMax-H3）原生生成的音画同步普通话对白。
- **旁白解说**：优先使用本机 `voicestudio` / `omnivoice` 生成 `<工程目录>/音频/旁白.wav`，或在 ArcReel 内配置 TTS。
