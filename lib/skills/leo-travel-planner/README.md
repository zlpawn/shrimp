# 🚗 Leo Travel Planner (智能旅行与自驾路书规划助手)

`leo-travel-planner` 是一套专为 **AI Agent** 定制的生产级多源协同旅行规划 Skill。它整合了 **FlyAI（飞猪 MCP）**、**高德地图 MCP** 与 **ego-browser / Chrome 插件（小红书与一嗨租车）**，旨在生成具备**真实凭证可溯源、全口径费用算清、环境安全自适应防御**的专业自驾路书。

---

## 🌟 核心特色

1. **真实凭证与链接溯源**：每一个景点、酒店、租车网点、素人避坑点均挂载真实可点击链接（小红书原贴、飞猪直订、高德导航）。
2. **多源协同**：高德地图算里程/过路费/气象/充电桩密度 + FlyAI 订机酒门票 + 小红书抓素人避坑 + 一嗨租车比价。
3. **全口径费用预算**：大交通 + 租车 + 异地还车费 + 油电能源 + 高速通行费 + 严选酒店 + 门票区间车 + 餐饮备用金。
4. **环境安全自适应雷达**：高海拔高反防御、极端温差暗冰防御、沙漠无人区自救、山区长下坡制动、边防证办理。
5. **跨平台双轨架构**：
   * **macOS**：通过 `ego-browser` 隔离空间抓取；
   * **Windows**：通过 Chrome 插件（Leo Lantern Bridge `127.0.0.1:19527`）驱动日常 Chrome 抓取。

---

## 🛠️ 前置依赖与 1 分钟快速上手

本 Skill 需要以下工具支撑（缺失时可自动降级或一键安装）：

### 1. 工具依赖清单

| 工具 | 用途 | 是否必需 | 一键安装/配置方式 |
| :--- | :--- | :--- | :--- |
| **高德地图 MCP** | 动线测距、天气温差、过路费、充电桩密度 | 推荐 | 在 MCP 配置文件中加入高德 Key 即可 |
| **FlyAI CLI** | 往返机票、火车、严选酒店、景区门票 | 推荐 | `npm i -g @fly-ai/flyai-cli` |
| **ego-browser (macOS)** | 抓取小红书素人贴与一嗨租车 | macOS 推荐 | 运行 `sh scripts/install_ego.sh` |
| **Leo Lantern 插件 (Windows)** | 抓取小红书素人贴与一嗨租车 | Windows 推荐 | 双击运行 `scripts/setup_chrome_ext.bat` |

---

## 📁 目录结构

```
leo-travel-planner/
├── SKILL.md                          # 技能主定义、核心法则与四阶段流水线
├── README.md                         # 本上手与分发指南
├── scripts/
│   ├── install_ego.sh                # macOS 下一键静默安装 ego-browser
│   └── setup_chrome_ext.bat          # Windows 下一键加载 Chrome 扩展
└── references/
    ├── cross-platform-fallback.md    # 跨平台双轨架构与交互契约
    ├── safety-guardrails.md          # 6 大环境安全自适应防御手册
    ├── budget-estimator.md           # 全口径费用预算测算模型
    ├── xhs-crawler-template.md       # 小红书与一嗨抓取模板（含滑块接管）
    └── checklist-and-emergency.md    # 行李清单与紧急救援通讯录模板
```

---

## 💡 典型使用指令

向 AI 发起自然语言诉求即可唤起本 Skill：

* *“帮我做一份中秋节去新疆自驾 6 天的路书，两个人，想住亚朵或全季”*
* *“国庆准备去川西稻城亚丁，担心高反，帮我规划一条不赶路的路线”*
* *“打算从三亚自驾到海口，查下租电车还是混动划算，算下总预算”*
