# Leo CapCut 与 Jianying Headless 核心能力深度整合设计规范

| 元数据项 | 说明 |
| :--- | :--- |
| **文档状态** | Draft / Pending Implementation |
| **设计日期** | 2026-10-10 |
| **目标模块** | `lib/skills/leo-capcut` |
| **参考系统** | `mcncarl/jianying-headless` (`skills/yichen-jianying-edit`, `engine/`) |
| **主要运行平台** | Windows 10/11 (已验证剪映 10/11 环境) |

---

## 1. 背景与设计目标

### 1.1 背景
当前工作区的 `leo-capcut` 具备优秀的高层 AI 策划管线（自然语言 → 脚本 → 分镜 → Timeline IR），并且在 Windows 平台上攻克了剪映 10/11 草稿加密机制（基于 `videoeditor.dll` 的 `crypto.py` 与首页注册 `registry.py`）。
然而，目前 `leo-capcut` 仍存在以下能力短板：
1. **只能从零创建，无法修改现有草稿**：无法读取用户既有的复杂剪映工程进行定向微调（如替换背景音乐、修改字幕文案、增加画中画），每次必须全量重建。
2. **缺乏算法级口播时间轴重映射**：缺少基于 ASR 逐词转写与静音区间的精密切除算法，难以自动化剪出口播干净、无爆音、字幕严格同频的视频。
3. **缺少一键后台直出 MP4 能力**：生成的草稿必须人工进入剪映 GUI 手动点击“导出”，无法实现纯后台免干预成片交付。
4. **字体无法随草稿物理打包**：换机或缺失系统字体时会导致排版回退。

### 1.2 目标与成功指标
通过将开源项目 `jianying-headless` 的核心算法抽离并针对 Windows 环境进行深度重构适配，实现：
1. **口播智能切除（Speech Cut）**：输入视频与 Whisper 转写，自动切除指定停顿与语气词，时间平移递归作用于字幕与音轨，接缝处做微交叉淡化，杜绝爆音。
2. **现有草稿外科手术（Draft Modification）**：解密已有草稿，支持声明式 JSON Patch 对指定轨道和片段进行安全增删改，生成独立副本，不污染原项目。
3. **Windows FFmpeg 无头成片直出（Headless Export）**：将 Timeline IR 编译为精确对齐的 FFmpeg 复合滤镜图，后台渲染 MP4，并执行全帧解码与时长校验。
4. **字体物理嵌入（Font Embedding）**：将本地 TTF/OTF 字体文件物理复制进草稿目录并注册索引。
5. **极简大模型（Agent）调用体验**：CLI 命令与 `SKILL.md` 针对大模型做全面高阶抽象，使 Agent 能轻松指挥整个剪辑闭环。

---

## 2. 总体架构与目录结构

采用**分层内核扩展架构（Layered Engine Extension）**：保持上层 AI 规划层与 Timeline IR 抽象不变，在 `scripts/leo_capcut/` 下新建 `engine/` 内核模块。

```text
lib/skills/leo-capcut/
├── SKILL.md                          # 更新面向 Agent 的提示词与全新工作流门禁
├── references/                       # 新增/扩充设计规范与场景参考
│   └── scenarios/                    # 场景模板
└── scripts/
    ├── leo_capcut_cli.py             # 扩充 CLI 命令 (speech-cut, inspect-draft, modify-draft, export)
    ├── leo_capcut/
    │   ├── brief.py                  # [现有] 创意简报
    │   ├── script_planner.py         # [现有] 脚本生成
    │   ├── storyboard_planner.py     # [现有] 分镜规划
    │   ├── timeline_ir.py            # [增强] 扩充数据模型支持切片重映射与导出配置
    │   ├── jianying_writer.py        # [现有] 从零写草稿逻辑
    │   ├── crypto.py                 # [现有] Windows DLL 往返加解密驱动
    │   ├── detect.py                 # [现有] 剪映路径与进程探测
    │   ├── registry.py               # [现有] 首页注册与原子回滚
    │   └── engine/                   # 【新增内核扩展包】
    │       ├── __init__.py
    │       ├── speech_planner.py     # 口播智能切片与时间重映射编译器
    │       ├── draft_modifier.py     # 现有草稿“手术刀”（解密 -> 检视 -> Patch -> 加密）
    │       ├── font_embedder.py      # 本地字体提取、物理复制与元数据注入
    │       └── ffmpeg_renderer.py    # Windows FFmpeg 滤镜图生成与直出校验
    └── tests/                        # 扩充单元测试与集成测试集
        ├── test_speech_planner.py
        ├── test_draft_modifier.py
        ├── test_font_embedder.py
        └── test_ffmpeg_renderer.py
```

---

## 3. 核心子系统详细设计

### 3.1 口播时间重映射编译器 (`engine/speech_planner.py`)

#### 3.1.1 核心算法：时间映射函数
设原始视频时长为 $T_{orig}$，根据 ASR 识别出的有效保留时间段集合为有序不相交区间：
$$\mathcal{K} = \{[s_1, e_1], [s_2, e_2], \dots, [s_n, e_n]\} \quad (0 \le s_1 < e_1 < s_2 < \dots < e_n \le T_{orig})$$
每个区间时长为 $\Delta_i = e_i - s_i$。裁剪后的新总时长为：
$$T_{new} = \sum_{i=1}^n \Delta_i$$

对于原始时间戳 $t \in [0, T_{orig}]$，映射到新时间轴 $t' \in [0, T_{new}]$ 的函数定义为：
$$f(t) = \sum_{k=1}^{j-1} \Delta_k + \max(0, \min(t - s_j, \Delta_j)) \quad \text{其中 } j \text{ 满足 } s_j \le t \le s_{j+1} \text{ 或最后一个区间}$$

#### 3.1.2 轨道协同平移与音频去爆音（Audio De-clicking）
1. **主视频轨（A-Roll）**：拆分成 $n$ 个独立 VideoSegment，每个片段的播放时间范围严格绑定保留区间 $[s_i, e_i]$。
2. **切口交叉淡入淡出（Crossfade）**：为了消除由于波形瞬断导致的爆音（Click/Pop），在相邻视频片段的接缝音频处，自动配置 20ms（20,000 微秒）的线性淡出与淡入。
3. **字幕时间对齐**：
   - 遍历原始 Whisper 字幕片段，其原始起止时间 $[sub_{start}, sub_{end}]$ 映射为 $[f(sub_{start}), f(sub_{end})]$。
   - 若字幕整体完全落在被剔除的停顿区间内（即 $f(sub_{start}) == f(sub_{end})$），则该字幕自动丢弃。
4. **BGM 铺底**：背景音乐独立于口播切口，保持完整连续播放，音量自动做 ducking（有口播时 15% 音量，留白时平滑过渡）。

---

### 3.2 现有草稿“手术刀” (`engine/draft_modifier.py`)

#### 3.2.1 检视（Inspect）数据结构
为了让大模型在修改前了解草稿骨架，提供轻量级结构提取函数 `inspect_draft(draft_dir: Path) -> dict`：
```python
{
    "draft_id": "uuid-xxxx",
    "draft_name": "项目名称",
    "duration_sec": 42.5,
    "canvas": {"width": 1080, "height": 1920, "fps": 30},
    "tracks": [
        {
            "id": "track_video_main",
            "type": "video",
            "segment_count": 5,
            "clips": [
                {"index": 0, "name": "clip_01.mp4", "start_sec": 0.0, "duration_sec": 12.3}
            ]
        },
        {
            "id": "track_audio_bgm",
            "type": "audio",
            "segment_count": 1,
            "clips": [
                {"index": 0, "name": "old_bgm.mp3", "volume": 0.4}
            ]
        }
    ]
}
```

#### 3.2.2 声明式 Patch 语法规范
大模型通过标准 JSON 操作列表下达修改意图：
* `replace_asset`: 替换指定片段对应的素材文件（自动更新 material 与 segment）。
* `adjust_volume`: 调整指定音视频片段的音量。
* `update_text`: 修改指定字幕/标题文字内容、字号或颜色。
* `insert_pip`: 插入画中画图片/视频片段。
* `trim_clip`: 修改片段的源裁剪区间（source_timerange）与时长。
* `delete_clip`: 删除指定轨道上的某一片段。

#### 3.2.3 安全复制与原子重加密
1. **源工程锁**：只读取并解密原工程的 `draft_content.json`，绝对不修改原目录文件。
2. **克隆工作区**：在草稿根目录下创建新目录 `{原工程名}_AI修改_{时间戳}`。
3. **素材内部化**：新插入的素材复制至副本目录下的 `agent_media/` 中。
4. **重新加密与首页登记**：调用 `crypto.IsolatedJianyingCodec` 加密，并安全注册到 `root_meta_info.json`。

---

### 3.3 Windows FFmpeg 导出引擎 (`engine/ffmpeg_renderer.py`)

#### 3.3.1 Filtergraph 编译机制
将多轨 Timeline IR 编译为纯代码的 FFmpeg `filter_complex` 管道：
1. **视频流合成**：
   - 主轨道按时间线拼接（`concat` 或 `tpad/trim`）。
   - 画中画与贴纸按起始时间进行 `overlay=enable='between(t, start, end)':x=...:y=...` 叠加。
2. **文字流合成**：
   - 转换为 `drawtext=fontfile='...':text='...':fontsize=...:fontcolor=...:x=...:y=...:enable='between(t, start, end)'` 滤镜链。
   - 自动处理路径转义（Windows 下的 `C\:/...` 冒号转义与单引号转义）。
3. **音频流混音**：
   - 多个音频输入流按时间轴延迟对其（`adelay=start_ms|start_ms`）。
   - 通过 `amix=inputs=N:duration=longest:normalize=0` 进行无损混音，保留各自音量增益。

#### 3.3.2 渲染输出与完整性断言
- 渲染格式：`H.264 (libx264) + AAC (aac)`, 像素格式 `yuv420p`。
- **逐帧断言**：运行 `ffprobe -select_streams v -count_frames`，校验实际输出帧数是否符合预期，若丢帧直接抛出明确异常。

---

### 3.4 字体物理嵌入 (`engine/font_embedder.py`)

- **功能**：将本地 TTF/OTF 文件复制入草稿包专属目录（如 `resources/fonts/`）。
- **元数据绑定**：在 `draft_content.json` 的 `materials.fonts` 数组中添加字体结构体，记录字体的家族名（Family Name）、字重与相对存储路径，确保异地免安装字体渲染。

---

## 4. 大模型（Agent）调用与 CLI 接口

在 `scripts/leo_capcut_cli.py` 扩充以下高阶子命令：

```bash
# 1. 口播智能剪辑（自动去废话、加字幕与 BGM）
python scripts/leo_capcut_cli.py speech-cut \
  --media "D:/videos/talk.mp4" \
  --transcript "D:/videos/talk.json" \
  --remove-silence-over 0.6 \
  --remove-fillers "呃,啊,然后,那个" \
  --bgm "D:/audios/bgm.mp3" \
  --out-draft "D:/JianyingPro Drafts/口播精修" \
  --export "D:/output/talk_cut.mp4"

# 2. 检视现有草稿摘要（供大模型快速理解草稿结构）
python scripts/leo_capcut_cli.py inspect-draft \
  --draft "D:/JianyingPro Drafts/现有项目"

# 3. 声明式修改已有草稿（生成独立副本）
python scripts/leo_capcut_cli.py modify-draft \
  --draft "D:/JianyingPro Drafts/现有项目" \
  --patch '[{"action":"replace_asset","track":"t2","new_asset":"D:/audios/new_bgm.mp3"}]' \
  --out-name "现有项目_AI修改版"

# 4. 后台无头导出 MP4
python scripts/leo_capcut_cli.py export \
  --timeline "D:/work/timeline.json" \
  --out "D:/output/final_render" \
  --font "C:/Windows/Fonts/msyh.ttc"
```

---

## 5. 异常处理与工程防御策略

1. **写保护与进程互斥**：在向剪映首页 `root_meta_info.json` 注册前，检测 `JianyingPro.exe` 进程。若正在运行，优雅阻断并提示 Agent：“剪映正在运行，请提醒用户保存并关闭后重试”。
2. **原子备份与自动回滚**：修改首页索引前备份 `root_meta_info.json.bak`，若异常中断自动复原。
3. **加解密熔断验证**：加密完成后必须在内存中反向解密验证 JSON 节点完整性，不一致立刻中断。
4. **字体 Fallback 机制**：未提供字体时，自动定位 Windows 系统内置中文字体（如 `C:/Windows/Fonts/msyh.ttc` 或 `simhei.ttf`）。

---

## 6. 测试与验证计划

1. **单元测试 (`tests/test_speech_planner.py`)**：
   - 验证时间映射函数严格单调不减，切除停顿后所有保留片段紧密相连。
   - 验证字幕时间前移计算准确，被切除区间的字幕正确剔除。
2. **单元测试 (`tests/test_draft_modifier.py`)**：
   - 模拟解密草稿并注入 Patch 操作，验证生成的 `draft_content.json` 结构合规性。
3. **单元测试 (`tests/test_ffmpeg_renderer.py`)**：
   - 验证复合滤镜图字符串语法的正确性，包含多路流延迟与透明度混合。
4. **端到端集成测试**：
   - 运行完整 `speech-cut` 与 `export` 流程，通过 `ffprobe` 验证输出的 MP4 画面无花屏、音频无爆音。
