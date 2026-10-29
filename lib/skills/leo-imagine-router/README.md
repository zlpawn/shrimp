# leo-imagine-router (AI 生图场景智能路由与技能调度中心)

> 一个轻量级、去中心化的 AI 生图场景意图路由器与 JIT（Just-In-Time 即时能力）管理技能。

---

## 🌟 核心特性

1. **场景智能分发**：根据用户自然语言（概念、词条、故事），自动分发至最合适的高质量专精生图技能。
2. **去中心化解耦**：采用“技能名标识符”动态感知，不硬编码任何本地物理路径，不侵入下游技能的独立演进。
3. **即时技能发现与引导安装 (JIT Skill Installation)**：
   * 发现更契合的画风技能且用户未安装时，主动推送 GitHub 地址与标准安装命令；
   * 在用户授权许可后，一键自动代劳全局安装，无缝接力渲染出图。
4. **内置通用兜底引擎**：就算未安装任何外部垂直技能，内置的通用电影级生成规则也能提供高质量生图保障。

---

## 🚀 支持的场景矩阵

| 场景 | 特色 | 目标技能 |
| :--- | :--- | :--- |
| **双重曝光剪影叙事海报** | 70% 主体剪影内嵌深邃故事宇宙，工业级防崩盘约束 | `narrative-silhouette-prompt-generator` |
| **新国风写意水墨** *(规划中)* | 泼墨山水、工笔白描、传统仙侠意境 | `leo-chinese-ink-generator` |
| **3D 盲盒/黏土微缩** *(规划中)* | 黏土立体质感、微缩模型、高光萌系潮玩 | `leo-isometric-clay-generator` |
| **通用高品质出图** | 电影级构图、光影反差、真实写实质感 | `built-in-fallback` |

---

## 💻 安装到中央技能库 (Installation to ~/.agents/skills)

### 拷贝到中央 Skills 目录 (~/.agents/skills)
```bash
# Windows PowerShell
Copy-Item -Path "d:\agent-transfer\lib\skills\leo-imagine-router" -Destination "$HOME\.agents\skills\" -Recurse -Force

# macOS / Linux
cp -r "lib/skills/leo-imagine-router" ~/.agents/skills/
```

### 拷贝到 Antigravity 全局 Skills 目录 (~/.gemini/config/skills)
```bash
# Windows PowerShell
Copy-Item -Path "d:\agent-transfer\lib\skills\leo-imagine-router" -Destination "$HOME\.gemini\config\skills\" -Recurse -Force
```

### 使用 npx skills
```bash
npx skills add <repository-url> -g
```

---

## 📄 许可协议 (License)
MIT License.
