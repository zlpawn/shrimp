# Leo 3D Blender 可插拔引擎接入卡 (Providers Roadmap)

`leo-3d-blender` 采用与 `leo-video-router` 同源的**桥接解耦架构**：上层统一管理工作区记忆、工程目录归档、脚本沉淀与交付清单；底层通过独立桥接脚本对接不同 3D 引擎 / MCP Server。

---

## 已接入引擎

### 1. `mcp-for-blender`（主力实时 Blender 引擎）

- **定位**：本地实时 Blender 场景建模、材质着色、灯光相机、`bpy` 脚本执行、资产库导入与 Cycles/EEVEE 渲染。
- **默认运行模式**：零源码依赖的 `uvx mcp-for-blender`（跨平台开箱即用）；可选通过 `workspace.py set-repo <path>` 绑定本地源码目录。
- **传输协议**：`stdio` MCP（`uvx mcp-for-blender`）+ Blender 插件 TCP Socket（默认 `localhost:9876`）。
- **桥接脚本**：`scripts/blender_bridge.py`
- **内置第三方能力**（取决于用户在 Blender 插件面板开启的状态，由 `status` / `get_addon_status` 探测）：
  - **资产库**：Poly Haven、Sketchfab、Poly Pizza（`search_assets` / `import_asset`）
  - **AI 3D 模型生成**：Tripo、Hunyuan3D、Hyper3D (Rodin)、Meshy（`generate_3d`，可能消耗用户额度）
  - **AI 3D 世界生成**：WorldLabs（`generate_gaussian_world`）

---

## 未来扩展路由设计（Router-Ready）

后续接入新的 3D MCP 或外部管线时，只需按同样模式新增：
1. 在 `~/.shrimp/skills/leo-3d-blender/config.json` 中记录对应引擎配置/端点；
2. 在 `scripts/` 下增加独立桥接脚本（例如 `tripo_bridge.py`、`comfy3d_bridge.py`、`threejs_bridge.py`）；
3. 在 `references/` 下补充对应接入卡并在 `SKILL.md` 的意图路由表中注册触发条件；
4. 所有产出的 `.blend`、`.glb`、脚本与渲染图继续统一归档至同一 `<workspace_dir>/YYYY-MM-DD-主题/` 工程目录。
