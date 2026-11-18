# leo-imagine-router (AI 生图场景智能路由与技能调度中心)

> 一个轻量级、去中心化的 AI 生图场景意图路由器、技能目录导航器、内置顶级画风库与 JIT（Just-In-Time 即时能力）管理技能。

---

## 🌟 核心特性

1. **主动场景导航与探索交互**：在用户未确定具体 Prompt 前，主动呈现生图场景全景技能菜单，让用户自由选择或激发创意。
2. **场景智能分发**：根据用户自然语言（概念、词条、故事）或参考照片，自动分发至最合适的高质量专精生图技能。
3. **去中心化解耦**：采用“技能名标识符”动态感知，不硬编码任何本地物理路径，不侵入下游技能的独立演进。
4. **内置开箱即用顶级画风库 (Master Cookbook)**：
   * 全面收录 10 大类、60+ 细分视觉场景顶级提示词库与视觉设计规约（文博四区拆解、马卡龙信息图、情绪书法真迹、3D诗画卷轴、4:5品牌包装家族、12格短剧分镜、宋代工笔游戏角色等）；
   * 详见 [`references/cookbook.md`](references/cookbook.md)。
5. **即时技能发现与引导安装 (JIT Skill Installation)**：
   * 发现更契合的外部画风技能且用户未安装时，主动推送 GitHub 地址与标准安装命令；
   * 在用户授权许可后，一键自动代劳全局安装，无缝接力渲染出图。
6. **通用兜底引擎**：就算未安装任何外部垂直技能，内置通用 6 槽位生图规范（[`references/prompting.md`](references/prompting.md)）也能提供工业级生图保障。
7. **与底层生图引擎无缝串联**：Router 专注于场景识别与提示词编译，完成后自动调度当前项目或环境中功能完备的生图执行类 Skill（推荐 **`leo-codex-imagine`**，支持 gpt-image-2 与中转站）完成出图与本地落盘。

---

## 🚀 支持的场景矩阵

| 场景分类 | 特色与手法 | 目标技能 / 规范来源 |
| :--- | :--- | :--- |
| **实景拼贴 · 拾景纸刊** | 真景为锚，保留核心摄影主体，手撕纤维毛边，背景抽象为印刷线描，高纯度单色块 | `scenes-gathered-zine-v1-3` (外部) |
| **影像蒸馏 · 极简插画** | 不保留原照片像素，提炼人物关系与情绪隐喻，极简艺术插画，支持单色块模式 | `scene-distillation-zine-v1-3` (外部) |
| **莫兰迪电影摄影海报** | 原片锁定不重绘，莫兰迪纸张与克制油墨，5大电影排版构型 + 虚构演职员表(Billing Block) | `morandi-cinematic-poster-zeejay` (外部) |
| **拾景实况动效海报** | 纸刊海报 + 平铺手撕纸向外揭开动效，输出 Apple Live Photo 配对（JPG+MOV） | `scenes-gathered-zine-live-flow-v1-0` (外部) |
| **单色/双色编辑印刷** | 严格 1~2 块印刷墨版（主墨70-85%+辅墨15-30%），网点照片(Halftone)、孔版印刷(Risograph)、25%-55%留白 | `mono-color` (外部) |
| **摄影双联抽象面板** | 原片绝对锁定不改写，无缝拼接象牙白纯净抽象面板(#F3F0E8)，真实几何/轴线/墨点抽象，诗意衬线标题 | `photo-abstract-editorial` (外部) |
| **双重曝光剪影叙事海报** | 70% 主体剪影内嵌深邃故事宇宙，工业级防崩盘约束 | `narrative-silhouette-prompt-generator` (外部) |
| **博物馆图鉴式中文拆解** | 四区分割法，兼具真实写实主视觉、引线部位标注、局部特写、材质纹样与流转流程 | `built-in-cookbook:deconstruction` |
| **建筑师手绘速写手稿** | 反过度完成感，钢笔淡彩、铅笔辅助线、线条呼吸感与松弛手写笔记（天坛/大佛） | `built-in-cookbook:architectural-sketch` |
| **马卡龙单页信息图** | #F5F0E8暖米纸、马卡龙圆角色块、手绘抖动线条（wobble）、珊瑚红强调色 | `built-in-cookbook:infographic-macaron` |
| **数学/理论概念可视化** | 优雅学术风、时域到频域分解、几何直觉与本质拆解（傅里叶变换、算法原理） | `built-in-cookbook:math-visualization` |
| **3D 诗画卷轴世界海报** | 悬浮画卷破纸而出微缩天地、金箔烫印大字与印章（城市文旅形象、宏大文学IP） | `built-in-cookbook:chinese-scroll-world` |
| **情绪书法传世真迹** | 注入历史作者悲怆/隐忍情绪核、墨色枯浓顿挫、纸张泛黄磨损真迹质感（祭侄文稿/报任安书） | `built-in-cookbook:emotional-calligraphy` |
| **敦煌唐代重彩壁画** | 吴带当风铁线描、矿物重彩设色、龟裂风化泥壁与沥粉贴金剥落质感（飞天神女/千手观音） | `built-in-cookbook:dunhuang-fresco` |
| **东方手绘双重曝光海报** | 巨大侧脸主形融合写意山海云气卷轴叙事，纸本淡彩与大面积留白（红楼梦/刺客聂隐娘） | `built-in-cookbook:oriental-double-exposure` |
| **4:5 品牌包装家族系统** | 品牌包装全案展示，涵盖手提袋、礼盒、容器、标签吊牌与产品本体，商业摄影陈列 | `built-in-cookbook:brand-packaging-system` |
| **极简几何装置产品海报** | 高调纯净摄影棚，圆柱、亚克力支架等几何装置与自然食材/原料切片穿插，高级通透留白 | `built-in-cookbook:geometric-product-kv` |
| **12格电影感短剧分镜表** | 4×3网格均匀排版，主角人设/服装/发型 100% 贯穿连贯，近中远景镜头交替，编号01-12 | `built-in-cookbook:storyboard-12frames` |
| **现代游戏角色宋代工笔** | 英雄联盟/最终幻想角色化身宋代绢本工笔，带专属台词题跋与印章（金克丝/艾希） | `built-in-cookbook:game-song-gongbi` |
| **时空融合与四季长卷** | 时代广场百年前与当今无缝过渡交融；上海外滩四季无缝全景长卷 | `built-in-cookbook:temporal-blending` |
| **青田石篆刻印谱五印体系** | 姓名印、理念印、精神印、愿景印、项目印成套青田石金石篆刻印谱（马斯克五印） | `built-in-cookbook:seal-carving` |
| **复古电影票根海报** | 左侧电影核心主视觉，右侧撕票虚线与规范票务排版（ADMIT ONE、席位、日期、条形码） | `built-in-cookbook:collector-ticket` |
| **生活美学与文创** | 宋朝人朋友圈（苏轼发东坡肉）、文学金句日历（地坛/小王子）、传统老黄历、反重力折叠城市 | `built-in-cookbook:lifestyle-tradition` |
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
