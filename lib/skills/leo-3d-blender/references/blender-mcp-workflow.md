# `mcp-for-blender` 操作规范与避坑指南

> 本指南提炼自 `mcp-for-blender` 的 `SERVER_INSTRUCTIONS` 与工具契约，供 `leo-3d-blender` 在执行 `bpy` 建模、材质、布光、资产导入与渲染时遵循。

---

## 1. 核心连接模型

```text
Agent (Shell) ──▶ blender_bridge.py (stdio MCP Client)
                        │ stdio (JSON-RPC)
                        ▼
               uvx mcp-for-blender (FastMCP，零本地源码依赖)
                        │ TCP Socket (localhost:9876)
                        ▼
               Blender GUI + addon.py (主线程执行 bpy)
```

- **Blender 必须保持 GUI 运行并开启监听**：Blender 侧边栏（`N` 键）→ **MCP for Blender** → 点击 **Connect to MCP server**。无头模式 `blender -b` 不会触发插件定时器。
- **插件未安装或版本过期时**：不要手动复制文件，直接运行 `uv run <skill>/scripts/blender_bridge.py install-addon` 并让用户在 Blender 重启/启用插件。如果安装前 Blender 已处于打开状态且此前尚无 `scripts/addons/` 目录，必须**完全退出（`Cmd+Q`）并重启 Blender**，否则启用插件时会报 `No module named 'blender_mcp'`。

---

## 2. `bpy` 脚本铁律（跨语言/跨版本 Blender 防崩）

1. **按 `node.type` 查找着色器节点，禁止按节点名硬编码**：
   - 中文或其他本地化界面的 Blender 节点 `.name` 可能不同，必须用类型匹配：
   ```python
   bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
   ```
2. **禁止硬编码枚举标识符，先读取 `bl_rna`**：
   ```python
   formats = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["file_format"].enum_items]
   ```
   - 切换渲染引擎（如 Cycles / EEVEE）时先读当前 `scene.render.engine`，并在 `try / except TypeError` 中赋值（异常信息会返回合法引擎列表，注意 Blender 4.2+ EEVEE 为 `BLENDER_EEVEE_NEXT`）。
3. **材质颜色必须连入着色器节点输入**：
   - `material.diffuse_color` 只影响 Solid 视口颜色，Rendered 视图与最终出图必须改 `Principled BSDF` 的 `Base Color` / `Roughness` / `Metallic` 等输入口。
4. **导入/生成模型后必须用 `world_bounding_box` 对齐缩放与落地**：
   - 来自 `import_asset`（Poly Haven / Sketchfab / Poly Pizza）或 `generate_3d` 的模型原始比例和原点不一定在地面（`Z=0`），务必先计算世界包围盒并缩放到目标米制尺寸后再贴地摆放。
5. **严禁调用 `bpy.ops.wm.read_factory_settings()` 清空场景**：
   - `read_factory_settings()` 会把已加载的 `blender_mcp` 插件一并卸载，导致 `localhost:9876` 断开！清空场景请改用遍历删除 `bpy.data.objects` / `bpy.data.collections` 及孤立数据块。
6. **长脚本写文件再执行（注意 `__file__` 未定义）**：
   - 复杂建模/材质/动画脚本先写入 `<工程目录>/脚本/<step>.py`，再用 `blender_bridge.py exec --file ...` 执行，既可版本沉淀又能规避 Shell 引号转义问题。注意 `execute_blender_code` 在 Blender 内通过 `exec(code, namespace)` 运行，**脚本中不要直接引用 `__file__`**（可用 `Path.home()` 或 `"__file__" in globals()` 兜底）。

---

## 3. 视觉验收工具 `look` 用法

`blender_bridge.py look` 会自动把 MCP 返回的 `ImageContent` 解码落盘为 PNG 并返回路径（默认保存到 `<当前工程>/预览/`）：

| 参数 | 可选值 / 说明 | 适用场景 |
|---|---|---|
| `--mode` | `viewport`（默认）/ `camera` / `angles` / `frames` | 自由视角 / 相机机位 / 多角度检查 / 动画采样条 |
| `--shading` | `rendered`（默认）/ `material` / `solid` / `wireframe` / `xray` | 检查光照材质时用 `rendered`；快速看结构/拓扑/骨骼用 `solid` / `wireframe` / `xray` |
| `--target` | 逗号分隔物体名，如 `"HeroChair,Table"` | 仅聚焦目标物体及子级 |
| `--views` | `front,right,top,three_quarter,back,left` | 配合 `--mode angles` 一次生成多视角对比图 |
| `--max-size` | `200`~`2000`（默认 `768`） | 快速检查用 `512`~`768`，看细节再用 `1200+` |

---

## 4. `mcp-for-blender` 全量 MCP 能力矩阵

`blender_bridge.py` 已完整接入当前服务端暴露的 **10 个模型工具**、**Resources / Resource Templates** 与 **CLI 子命令**：

| MCP 能力 | 桥接调用方式 | 核心说明 |
|---|---|---|
| `get_addon_status` | `status` / `call get_addon_status` | 查看 Blender 版本、插件协议版本、可用资产库与生成器开关 |
| `get_scene_info` | `scene-info [--query ...] [--root ...] [--fields ...] [--limit N]` | 查询场景物体、层级、`placement`/`contents`/`health`/`settings` 字段 |
| `execute_blender_code` | `exec (--code ... \| --file ...)` | 在实时 Blender 中执行 `bpy` / `bmesh` / `mathutils` 代码 |
| `look` | `look [--mode ...] [--shading ...] [--views ...]` | 视口/相机/多视角/动画帧/图片查看，返回图自动保存 PNG |
| `search_assets` | `call search_assets '{"source":"polyhaven",...}'` | 搜索 Poly Haven / Sketchfab / Poly Pizza；传 `previews: 1..6` 时缩略图自动落盘 |
| `import_asset` | `call import_asset '{"source":"polyhaven","id":...}'` | 下载并导入模型/材质/HDRI（注意传 `target_size` 或 `apply_to`） |
| `generate_3d` | `call generate_3d '{"prompt":...}'` | Tripo/Hunyuan3D/Hyper3D/Meshy 文/图生 3D 模型；超时返回 `job` 句柄可续等 |
| `generate_gaussian_world` | `call generate_gaussian_world '{"prompt":...}'` | World Labs Marble 生成高斯泼溅世界（需 Blender 5.3+）；支持 `job` 续等 |
| `record_trajectory_feedback` | `call record_trajectory_feedback '{"feedback":"accept"}'` | 记录 `accept` / `reject` / `undo` / `correction` 反馈 |
| `disable_telemetry` | `call disable_telemetry '{}'` | 立即关闭遥测数据采集 |
| `blender://object\|material\|collection/{name}` | `resources` / `read-resource <uri>` | 读取场景对象、材质、集合的 JSON 资源 |

> 注：服务端另含 5 个标记为 `visibility: ["app"]` 的 UI 专用内部能力（`viewport`、`viewport_latest`、`viewport_capture`、`viewport_pick`、`search_mentions`），仅面向支持 MCP Apps 嵌入式面板的宿主 UI，模型/CLI 侧默认不可见也不需要调用。

---

## 5. 按需加载内置工艺指南

当任务涉及特定 3D 专业领域时，先用本地零开销命令阅读 `mcp-for-blender` 自带指南：

```bash
uv run <skill>/scripts/blender_bridge.py guides            # 查看全部 7 份指南
uv run <skill>/scripts/blender_bridge.py guides materials  # 材质与着色器
uv run <skill>/scripts/blender_bridge.py guides scene      # 场景构图与布光
uv run <skill>/scripts/blender_bridge.py guides bpy        # bpy 编程规范
uv run <skill>/scripts/blender_bridge.py guides rigging    # 骨骼绑定
uv run <skill>/scripts/blender_bridge.py guides animation  # 关键帧与动画
uv run <skill>/scripts/blender_bridge.py guides retopology # 拓扑优化
uv run <skill>/scripts/blender_bridge.py guides level-design # 关卡布局
```
