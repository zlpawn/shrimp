# leo-ppt-router (PPT 需求引导与技能路由中心)

> 一个轻量级、去中心化的 PPT / 演示文稿需求引导路由器、下游专精技能调度器与 JIT（Just-In-Time 即时能力）管理技能。

---

## 🌟 核心特性

1. **引导式四维度导航**：在用户需求不明确时，主动呈现编号选项卡（支持 `1B 2A 3推荐 4B` 简短回复），引导确认 **① 用途场景、② 交付形态（含 WPS / PowerPoint 可编辑需求）、③ 视觉风格、④ 素材来源**；已知维度自动跳过，亦支持“你定”一键委托。
2. **双层智能路由与公司品牌优先（Z1 / Z2）**：优先响应 **Z2 公司 PPT 模板**（区分一次性骨架扩页 `Edit Native PPTX` 与常用模板沉淀 `Create Template`）和 **Z1 公司品牌色**，再按“交付形态 → 场景/风格”双层矩阵路由至最合适的下游专精 PPT Skill，不侵入下游技能内部门禁与演进。
3. **WPS 可编辑性标注与冲突提醒**：全链路统一以 `✅`（原生可编辑）/ `🟡`（部分可编辑或转换导出）/ `❌`（仅网页或整页图片）标注可编辑性；当用户选择网页或图片形态却要求在 WPS / PowerPoint 修改文字，或所选目标技能对公司品牌色存在色值偏差时，主动给出冲突与色差提醒。
4. **即时技能发现与引导安装 (JIT Skill Installation)**：
   * 按规范技能目录动态探测下游 Skill 是否就绪，不硬编码任何个人主机路径；
   * 目标技能缺失时，主动推送包含开源地址、安装命令、运行依赖与 WPS 可编辑性的安装卡片，在用户确认后代为安装并携带已选维度无缝接力制作。
5. **内置多形态兜底引擎 (`built-in-fallback`)**：当未安装外部技能且用户选择“直接出”（或安装失败改走兜底）时，内置金字塔大纲、便当网格（Bento Grid）、认知设计与 CJK 宽度折算规范，按交付形态自动调用 PptxGenJS、Marp CLI、单文件 `16:9` HTML 或 `python-pptx` 公司模板扩页填充兜底出片。

---

## 🚀 支持的路由矩阵

| 交付形态 | 场景 | 目标 Skill | WPS 可编辑 |
| :--- | :--- | :--- | :--- |
| **A 可编辑 PPTX** | 默认（工作汇报、述职、咨询提案、教学课件等绝大多数场景） | `ppt-master` | ✅ 原生形状/图表/表格 |
| **A 可编辑 PPTX** | 用户点名 `dashi-ppt` 的 12 套主题视觉 | `dashi-ppt`（导出 PPTX） | 🟡 DOM 提取，部分区域截图 |
| **B HTML 网页** | 人文分享、发布会、强个人风格；杂志风 / 瑞士风 | `guizang-ppt-skill` | ❌ 仅 HTML |
| **B HTML 网页** | 商务、科技、数据类主题 | `dashi-ppt` | 🟡 可转 PPTX |
| **C 整页图片式 PPTX** | 麦肯锡、科研答辩、党政红、手绘、教学等风格 | `codex-ppt` | ❌ 整页图片 |
| **D Markdown** | 技术分享、代码演示、课程 | `slidev` | ✅ 用 `--format pptx-editable` 导出 |
| **E 已有 PPTX** | 美化 / 填充内容 / 做模板 / 加讲稿动画 | `ppt-master` | ✅ 原生形状/图表/表格 |
| **任意形态** | 目标未安装且用户拒绝安装（或安装失败改走兜底） | `built-in-fallback` | ✅ PptxGenJS / `python-pptx`；🟡 Marp `--pptx-editable`；❌ HTML / 图片式 |

### 公司品牌与模板路由（③ Z1 / Z2，优先级高于主矩阵）

| 品牌选项 | 场景与形态组合 | 目标 Skill | WPS 可编辑与说明 |
| :--- | :--- | :--- | :--- |
| **Z2 公司 PPT 模板**（`.pptx`） | 任意场景与形态（原选 B/C/D 时提醒改为 PPTX 交付） | `ppt-master`（兜底：`python-pptx`） | ✅ 一次性走 `Edit Native PPTX` 骨架扩页，常用走 `Create Template` 沉淀工作区；保留母版、Logo 与页眉页脚 |
| **Z1 公司品牌色** | 搭配 **A 可编辑 PPTX / E 已有 PPTX** | `ppt-master` | ✅ 建议走 `Create Brand` 沉淀品牌色值与 Logo |
| **Z1 公司品牌色** | 搭配 **B HTML 网页**（`dashi-ppt` 仅固定主题不支持品牌色，自动改荐） | `guizang-ppt-skill` | ❌ 按品牌色受约束生成主题，不直接使用原色值（会提示色差） |
| **Z1 公司品牌色** | 搭配 **C 整页图片式 PPTX** | `codex-ppt` | ❌ 提示词指定色值，AI 生图不保证精确色值（会提示色差） |
| **Z1 公司品牌色** | 搭配 **D Markdown** | `slidev` | ✅ 通过主题 CSS 变量精确设置（`--format pptx-editable` 导出可编辑） |

---

## 💻 安装

在仓库根目录执行以下命令，将 `leo-ppt-router` 复制到中央技能目录（`~/.agents/skills`）与 Antigravity 全局技能目录（`~/.gemini/config/skills`）：

### macOS / Linux (Bash)
```bash
mkdir -p ~/.agents/skills ~/.gemini/config/skills
cp -r "lib/skills/leo-ppt-router" ~/.agents/skills/
cp -r "lib/skills/leo-ppt-router" ~/.gemini/config/skills/
```

### Windows (PowerShell)
```powershell
Copy-Item -Path "lib\skills\leo-ppt-router" -Destination "$HOME\.agents\skills\" -Recurse -Force
Copy-Item -Path "lib\skills\leo-ppt-router" -Destination "$HOME\.gemini\config\skills\" -Recurse -Force
```

---

## 📄 许可协议 (License)
MIT License.
