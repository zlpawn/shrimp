# 下游引擎画像与调用规范 (Engines Catalog)

`leo-to-skill-router` 作为调度中枢，纳管并协同以下底层生成引擎：

---

## 1. `book-to-skill`（文档与书籍知识编译器）

* **擅长场景**：PDF、EPUB、DOCX、Markdown 文件、工程 `docs/` 目录、API 规范。
* **核心价值**：
  * 基于 REPL 探针切片读取，避免全量长文本塞爆上下文；
  * 原汁原味保留作者命名框架与思维模型；
  * 生成按需懒加载的单章结构与决策表 `cheatsheet.md`。
* **调用方式**：
  * Agent 模式：在支持 Agent Skills 的环境下调用 `/book-to-skill <source_path> [slug]`；
  * 本地 Python 提取：使用配置的 Python 虚拟环境执行 `scripts/extract.py`。
* **JIT 安装引导（缺失时展示）**：
  ```bash
  # 跨 Agent 自动安装（推荐）
  npx skills add virgiliojr94/book-to-skill
  
  # 或手动克隆到全局技能目录
  git clone https://github.com/virgiliojr94/book-to-skill.git ~/.agents/skills/book-to-skill
  ```

---

## 2. `leo-lesson-to-skill`（课程与操作视频方法论提炼引擎）

* **擅长场景**：B站 / YouTube 教程视频、网课录音、现场演练录像、操作录屏。
* **核心价值**：
  * 多模态视频帧 + ASR 语音双通道交叉验证；
  * 生成具备严格来源溯源（`[COURSE_EVIDENCE]`）的执行规范；
  * 发布前必须经过冻结 Mock 测试集校验，保证不同大模型调用行为一致。
* **调用方式**：
  * 在当前项目中直接调度 `lib/skills/leo-lesson-to-skill/SKILL.md`；
  * 执行 `scripts/lesson_skill_guard.py` 驱动摄取、转写与校验。

---

## 3. `voicestudio`（默认语音转写 Peer Skill）

* **擅长场景**：为所有无字幕的教学视频或录音提供离线、带精确时间戳的语音识别。
* **核心价值**：
  * 作为独立的 Peer Skill，封装并管理 VoiceStudio 桌面软件与本地 Whisper 服务的通信与设备加速；
  * `leo-to-skill-router` 无需关心底层端口或模型权重，直接通过 Skill 协议交接转写任务；
  * 输出分段带起止时间戳的 JSON 数据，直接对接 IR 证据链。
* **调用方式**：
  * 直接引导 Agent 调度 peer skill `voicestudio` 完成 `audio.wav` 的转写；
  * 若未检测到该 Skill，弹出 JIT 安装引导：`npx skills add voicestudio`。

---

## 4. 复合融合模式（Fusion Pipeline）

当用户同时提供同一主题的书籍和课程视频时（例如：一本《领域驱动设计》PDF + 作者的 4 节 DDD 实战演练视频）：
1. **骨架搭建**：由 `book-to-skill` 解析书本目录结构，生成体系化的 `SKILL.md` 核心模型；
2. **血肉填充**：由 `leo-lesson-to-skill` 解析视频演示，将演示中的代码细节、现场解说中的“坑点”提炼进 `cheatsheet.md` 和 `Worked Examples`；
3. **统一输出**：最终输出一份集体系深度与实操细节于一体的旗舰 Skill。
