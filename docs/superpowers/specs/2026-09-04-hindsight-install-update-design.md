# Hindsight 安装与更新设计

## 目标

在现有 Command Apps 的 Hindsight 控制面中增加安装、版本检测和更新能力。页面只管理本地 `hindsight-embed` 工具，不安装或管理独立的 `hindsight` API 客户端 CLI，也不改动 `hindsight-api` 工具。

## 用户体验

- 未安装 `hindsight-embed` 时，Hindsight 汇总卡片显示“未安装”，并提供“安装 Hindsight”按钮。
- 已通过 uv 安装时，卡片显示当前版本，并提供“更新 Hindsight”按钮。
- 安装命令固定为 `uv tool install hindsight-embed`。
- 更新命令固定为 `uv tool upgrade hindsight-embed`。
- uv 不可用时展示明确提示，不回退到 pip、pipx 或任意 shell 安装脚本。
- 安装或更新成功后，页面重新扫描 `hindsight-embed` 可执行文件并刷新所有 profile 状态。
- 更新前停止当前正在运行或启动中的 Hindsight profile；更新完成后恢复这些 profile。

## 架构

新增 `lib/command-apps/infra/hindsight-tool.mjs`，集中负责 uv 可用性检测、`uv tool list` 解析以及安装/更新命令执行。所有命令均通过 `execFile` 风格的参数数组调用，不拼接 shell 字符串。

`createCommandAppsService` 注入该模块的检测、安装和更新函数，对外提供 `getHindsightToolStatus()`、`installHindsightTool()`、`updateHindsightTool()`。HTTP 层增加三个固定路由；前端独立加载工具状态，避免每个 Hindsight profile 的轮询都重复执行 `uv tool list`。

## 接口

- `GET /v1/command-apps/hindsight/tool`：返回 uv 与 `hindsight-embed` 的本地安装状态。
- `POST /v1/command-apps/hindsight/install`：执行安装、重新发现路径并返回刷新后的应用状态。
- `POST /v1/command-apps/hindsight/update`：停止活动 profile、执行更新、重新发现路径、恢复 profile 并返回刷新后的状态。

## 错误处理

- 找不到 uv：返回 `executable_not_found`，提示先安装 uv。
- uv 命令失败：返回 `process_error`，包含经过裁剪的 stderr/stdout 信息。
- 安装后仍找不到 `hindsight-embed`：返回 `executable_not_found`。
- 更新失败时不自动删除工具、不修改 `~/.hindsight`，也不清理记忆库。
- 更新失败后尽力恢复更新前正在运行的 profile；恢复失败记录日志，但保留原始更新错误。

## 测试

- 单元测试覆盖 uv 列表解析、uv 缺失、固定安装/更新参数和命令失败。
- 服务测试覆盖更新前停止与更新后恢复、安装后路径发现和状态返回。
- 路由测试覆盖三个新接口。
- 配置面板测试覆盖版本文案、安装/更新按钮及前端请求。
