# leo-imagine-router (AI 生图场景智能路由与技能调度中心)

> 一个轻量级、去中心化的 AI 生图场景意图路由器、技能目录导航器与 JIT（Just-In-Time 即时能力）管理技能。

---

## 🌟 核心特性

1. **主动场景导航与探索交互**：在用户未确定具体 Prompt 前，主动呈现生图场景全景技能菜单，让用户自由选择或激发创意。
2. **场景智能分发**：根据用户自然语言（概念、词条、故事）或参考照片，自动分发至最合适的高质量专精生图技能。
3. **去中心化解耦**：采用“技能名标识符”动态感知，不硬编码任何本地物理路径，不侵入下游技能的独立演进。
4. **即时技能发现与引导安装 (JIT Skill Installation)**：
   * 发现更契合的画风技能且用户未安装时，主动推送 GitHub 地址与标准安装命令；
   * 在用户授权许可后，一键自动代劳全局安装，无缝接力渲染出图。
5. **内置通用兜底引擎**：就算未安装任何外部垂直技能，内置的通用电影级生成规则也能提供高质量生图保障。
6. **无缝对接底层生图算力**：可直接联动 `leo-codex-imagine`、`leo-antigravity-imagine` 等完成高清图像渲染与落盘。

---

## 🚀 支持的场景矩阵

| 场景分类 | 特色与手法 | 目标技能 |
| :--- | :--- | :--- |
| **实景拼贴 · 拾景纸刊** | 真景为锚，保留核心摄影主体，手撕纤维毛边，背景抽象为印刷线描，高纯度单色块 | `scenes-gathered-zine-v1-3` |
| **影像蒸馏 · 极简插画** | 不保留原照片像素，提炼人物关系与情绪隐喻，极简艺术插画，支持单色块模式 | `scene-distillation-zine-v1-3` |
| **莫兰迪电影摄影海报** | 原片锁定不重绘，莫兰迪纸张与克制油墨，5大电影排版构型 + 虚构演职员表(Billing Block) | `morandi-cinematic-poster-zeejay` |
| **拾景实况动效海报** | 纸刊海报 + 平铺手撕纸向外揭开动效，输出 Apple Live Photo 配对（JPG+MOV） | `scenes-gathered-zine-live-flow-v1-0` |
| **单色/双色编辑印刷** | 严格 1~2 块印刷墨版（主墨70-85%+辅墨15-30%），网点照片(Halftone)、孔版印刷(Risograph)、25%-55%留白 | `mono-color` |
| **摄影双联抽象面板** | 原片绝对锁定不改写，无缝拼接象牙白纯净抽象面板(#F3F0E8)，真实几何/轴线/墨点抽象，诗意衬线标题 | `photo-abstract-editorial` |
| **双重曝光剪影叙事海报** | 70% 主体剪影内嵌深邃故事宇宙，工业级防崩盘约束 | `narrative-silhouette-prompt-generator` |
| **新国风写意水墨** *(规划中)* | 泼墨山水、工笔白描、传统仙侠意境 | `leo-chinese-ink-generator` |
| **3D 盲盒/黏土微缩** *(规划中)* | 黏土立体质感、微缩模型、高光萌系潮玩 | `leo-isometric-clay-generator` |
| **赛博朋克科幻机甲** *(规划中)* | 未来都市、重型机甲、废土科幻、霓虹光影 | `leo-cyberpunk-concept-generator` |
| **通用高品质出图** | 电影级构图、光影反差、真实写实质感、技术架构图、局部修图 | `built-in-fallback` |

---

## 💻 安装到中央技能库 (Installation to ~/.agents/skills)

### 拷贝到中央 Skills 目录 (~/.agents/skills)
```bash
# macOS / Linux
cp -r "lib/skills/leo-imagine-router" ~/.agents/skills/

# Windows PowerShell
Copy-Item -Path "lib\skills\leo-imagine-router" -Destination "$HOME\.agents\skills\" -Recurse -Force
```

### 拷贝到 Antigravity 全局 Skills 目录 (~/.gemini/config/skills)
```bash
# 创建软链指向中央库
ln -sfn ~/.agents/skills/leo-imagine-router ~/.gemini/config/skills/leo-imagine-router
```

---

## 📄 许可协议 (License)
MIT License.
