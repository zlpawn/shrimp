# leo-md-router（文档转 Markdown 质量优先路由中心）

> 一个以**产出质量为第一优先级**的文档解析与 Markdown 转换智能路由器，首批集成 **`docling`** 与 **`markitdown`**，采用能力画像动态路由与实测质量纠偏机制，支持 Skill/CLI 自动探测、版本更新检测、JIT 引导安装及 `~/素材/md/` 统一归档。

---

## 🌟 核心特性

1. **动态质量优先路由（非僵化硬编码）**：
   - 根据文件实际结构复杂度、下游任务诉求与 [`references/engines-catalog.md`](references/engines-catalog.md) 的引擎能力画像综合研判；
   - 转换后若实测效果不理想，主动调整参数或切换另一引擎交叉对比，择优交付。
2. **全自动状态探测与更新协助**：
   - 通过 `node scripts/probe.mjs` 探测下游 Skill 与 CLI 安装状态；
   - 支持 `--check-updates` 联网比对 PyPI 最新版，发现新版本可协助 `uv tool upgrade` 并同步 Skill；
   - 未安装时引导用户确认执行 `uv tool install docling` / `uv tool install "markitdown[all]"` 与 Skill 配置，或使用 `uvx` 零安装兜底。
3. **统一归档与删除强确认**：
   - 默认输出根目录：`~/素材/md/`；
   - 目录层级：`<output_dir>/<分类>/YYYY-MM-DD/<文档名>/`；
   - 源文件先校验拷贝至 `<docDir>/source/` 留底；**不管源文件在哪个目录，清理原文件前均须经过用户明确确认（`--confirm-delete`）**。

---

## 🛠️ 脚本用法

```bash
# 探测 docling 与 markitdown 的 Skill / CLI 状态
node scripts/probe.mjs

# 同时检查 PyPI 是否有更新
node scripts/probe.mjs --check-updates

# 查看或修改归档配置（持久化至 ~/.shrimp/skills/leo-md-router/config.json）
node scripts/config.mjs get
node scripts/config.mjs set --dir "~/素材/md" --source-policy copy

# 解析目标输出路径
node scripts/config.mjs resolve --cat "论文研报" --topic "report" --engine docling

# 第一阶段：校验拷贝源文件到 <docDir>/source/（绝不自动删除原文件）
node scripts/config.mjs archive-source --src "/path/to/report.pdf" --dest-dir "/path/to/docDir"

# 第二阶段：经用户明确同意后，校验副本完整性再删除原文件
node scripts/config.mjs delete-original --src "/path/to/report.pdf" --archived "/path/to/docDir/source/report.pdf" --confirm-delete
```

---

## 💻 安装到中央技能库

```bash
# macOS / Linux
cp -r "lib/skills/leo-md-router" ~/.agents/skills/
ln -sfn ~/.agents/skills/leo-md-router ~/.gemini/config/skills/leo-md-router
```
