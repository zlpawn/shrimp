---
name: leo-3d-blender
description: 面向 3D 场景构建、Blender 自动化建模与多引擎扩展的智能调度与归档中枢。通过无头 stdio MCP 桥接脚本直连 mcp-for-blender，支持工作区目录记忆（~/.shrimp/skills/leo-3d-blender/config.json）、标准 3D 工程落盘、bpy 脚本文件执行、多视角 look 截图自动保存、以及 Poly Haven/Sketchfab/AI 3D 生成工具调度。当用户提到 Blender、3D 建模、场景搭建、bpy 脚本、mcp-for-blender、渲染出图或 3D 资产处理时使用。
---

# Leo 3D Blender（3D 场景与 Blender MCP 调度中枢）

## 核心定位

`leo-3d-blender` 采用与 `leo-video-router` 一致的**桥接解耦 + 工作区记忆**架构：

- **MCP 桥接解耦**：不要求把庞大的 MCP Tool Schema 常驻塞进上下文，而是通过 `scripts/blender_bridge.py`（PEP 723 + `uv run`）按需拉起并调用 `mcp-for-blender`（`stdio` MCP Server），动态发现工具、执行 `bpy` 代码、读取 `blender://` 资源，并将 `look` 返回的截图自动落盘供多模态模型审片。
- **工作区智能记忆（Smart Persistence）**：配置持久化在 `~/.shrimp/skills/leo-3d-blender/config.json`，支持三级级联目录解析、记住 `mcp-for-blender` 本地仓库路径及 Blender Host/Port。
- **可扩展 Router 底座**：当前默认路由至 `mcp-for-blender`（见 [references/providers-roadmap.md](references/providers-roadmap.md)），后续可平滑挂载更多 3D 生成/渲染引擎而无需改动工程归档契约。

---

## 工作流

### Step 0：前置工作区与工程初始化

1. **查看当前记忆状态**（默认免本地源码，直接走 `uvx mcp-for-blender`）：
   ```bash
   python3 <本 skill 目录>/scripts/workspace.py status
   ```
2. **若用户指定了新的默认输出目录 / Blender 端口**（或开发者需挂载本地源码仓库），持久化记住：
   ```bash
   python3 <本 skill 目录>/scripts/workspace.py set-workspace "<工作区目录>"
   python3 <本 skill 目录>/scripts/workspace.py set-blender --host localhost --port 9876
   # 可选：仅当需要调试本地魔改源码时绑定；clear-repo 可恢复默认 uvx 模式
   python3 <本 skill 目录>/scripts/workspace.py set-repo "<本地 mcp-for-blender 路径>"
   ```
3. **初始化本次 3D 工程目录**（会自动更新 `active_project`，后续 `look` 截图默认保存到该工程的 `预览/`）：
   ```bash
   python3 <本 skill 目录>/scripts/workspace.py init "<3D主题>"
   ```

### Step 1：探测 Blender 与 MCP 连接状态

```bash
uv run <本 skill 目录>/scripts/blender_bridge.py status
```

- **若 `blender_socket_online` 为 `true`**：同时会返回 `addon_status`（Blender 版本、协议版本、Poly Haven / Sketchfab / Tripo 等可用状态），继续下一步。
- **若 `blender_socket_online` 为 `false`**：
  - 提示用户在 Blender 界面打开右侧边栏（`N` 键）→ **MCP for Blender** → 点击 **Connect to MCP server**；
  - 若尚未安装插件，在用户同意后运行 `uv run <本 skill 目录>/scripts/blender_bridge.py install-addon`。
- **动态查看服务端最新工具清单**（不靠猜测参数）：
  ```bash
  uv run <本 skill 目录>/scripts/blender_bridge.py tools --format markdown --with-instructions
  ```

### Step 2：按需加载工艺指南 & 检查现有场景

1. 读取 [references/blender-mcp-workflow.md](references/blender-mcp-workflow.md) 掌握 `bpy` 核心避坑点，编写建模/材质/布光脚本前可复用 [references/bpy-templates.md](references/bpy-templates.md) 中的通用原语。
2. 若涉及特定领域（材质、布光、绑定、动画、拓扑等），先读取本地指南：
   ```bash
   uv run <本 skill 目录>/scripts/blender_bridge.py guides
   uv run <本 skill 目录>/scripts/blender_bridge.py guides <topic>
   ```
3. 检查 Blender 当前场景结构：
   ```bash
   uv run <本 skill 目录>/scripts/blender_bridge.py scene-info
   ```

### Step 3：执行建模 / 资产调度 / 视觉闭环验收

1. **优先将复杂 `bpy` 脚本写入 `<工程目录>/脚本/` 再执行**（可读、可复现、避免 Shell 转义错误）：
   ```bash
   uv run <本 skill 目录>/scripts/blender_bridge.py exec --file "<工程目录>/脚本/build_scene.py" --prompt "<用户原始需求>"
   ```
   简单探测或单行操作可用 `--code`：
   ```bash
   uv run <本 skill 目录>/scripts/blender_bridge.py exec --code "import bpy; print(bpy.data.objects.keys())"
   ```
2. **调用任意 MCP Tool（如资产搜索、导入或 3D 生成）**：
   ```bash
   uv run <本 skill 目录>/scripts/blender_bridge.py call search_assets '{"source":"polyhaven","query":"wood","asset_type":"textures"}'
   ```
   > 注意：`generate_3d` / `generate_gaussian_world` 可能消耗用户的第三方积分或 API 额度，调用前应向用户确认。
3. **每次关键改动后用 `look` 做视觉验收**：
   ```bash
   # 快速查看当前视口（自动落盘 PNG 到 <工程目录>/预览/ 并输出路径）
   uv run <本 skill 目录>/scripts/blender_bridge.py look --mode viewport --shading rendered --max-size 768

   # 多角度检查指定物体（solid / wireframe 瞬时出图，适合检查穿模与比例）
   uv run <本 skill 目录>/scripts/blender_bridge.py look --mode angles --shading solid --target "HeroModel" --views "front,right,top,three_quarter"
   ```
   随后使用 `read_file` 查看返回的 `saved_images` 路径，确认构图、比例、贴地与材质无误。

### Step 4：保存工程、渲染出图与交付归档

1. 通过 `exec` 将 `.blend` 保存到 `<工程目录>/场景/<主题>.blend`，最终成图或视频输出到 `<工程目录>/渲染/`，导出模型（如 `.glb`）放到 `<工程目录>/资产/`。
2. 更新 `<工程目录>/交付记录.md`，勾选检查清单并向用户汇报产出路径。

---

## 📁 标准工程目录与三级级联工作区

```text
<workspace_dir>/                         # 用户指定 > config.json 历史记录 > ~/素材/3d/
└── YYYY-MM-DD-3D主题/
    ├── 交付记录.md                      # 场景说明、资产来源、渲染参数与交付清单
    ├── 场景/                            # .blend 工程文件
    ├── 脚本/                            # 可复用 bpy / bmesh 构建脚本
    ├── 资产/                            # 导入/导出的 .glb / .fbx / .obj / 贴图
    ├── 预览/                            # look 自动落盘的检查截图
    └── 渲染/                            # 最终渲染成图与视频
```

---

## 铁律

1. **禁止盲猜工具参数**：不确定参数结构时先执行 `blender_bridge.py tools`。
2. **必须做视觉验收**：每次建模、摆放或调光后用 `look` 截图并查看图片，不能只凭代码没报错就宣告完成。
3. **付费生成需确认**：触发 `generate_3d` / `generate_gaussian_world` 前必须让用户确认。
4. **跨平台与编码安全**：所有脚本与文件操作优先通过 `pathlib.Path` 和 `uv run` 执行。
