# Hindsight 配置变更后重启设计

## 背景

Command Apps 页面当前会把 Hindsight 的 LLM、embedding 和运行参数写入对应 profile 的环境文件，但已经运行的 `hindsight-embed` daemon 不会热加载该文件。页面随即读取文件并显示新配置，运行中的进程却继续使用启动时的旧模型，造成“页面显示的模型”和“实际请求使用的模型”不一致。

本修复要求运行配置强一致：对于正在运行的 Hindsight profile，配置变更只有在该 profile 完成重启并恢复健康后才算生效。

## 目标

- 修改 Hindsight daemon 会读取的配置后，自动重启当前正在运行的目标 profile。
- 原本停止的 profile 只保存配置，不被意外启动。
- 成功响应必须表示配置已写入，并且原本运行的 profile 已使用新配置完成重启且恢复健康。
- 重启失败时返回明确错误，前端不得提示配置已经生效。
- 多个 Hindsight profile 相互隔离，只检查和重启被修改的 profile。

## 非目标

- 不修改网关 endpoint、模型映射或 fallback 行为。
- 不验证上游模型服务是否真的返回了指定模型；本修复验证的是目标 Hindsight profile 已由新进程健康启动。
- 不为原本停止的 profile 自动启动服务。
- 不在重启失败时恢复使用旧配置的进程，因为这可能继续消耗用户已经取消选择的模型。
- 不改变 Hindsight 安装、更新或卸载流程。

## 配置变更范围

以下写入 Hindsight profile 环境文件的配置视为需要重启的运行配置：

- `llm` 对象中的 provider、base URL、model、API key 和运行参数。
- `llmSource` 和 `embeddingSource`，包括由 gateway source 渲染出的 provider、base URL、model 和 API key。
- 兼容接口中的顶层 `provider`、`baseUrl`、`model` 和 `apiKey`。

仅修改 `daemonProfile` 或 Command Apps 的可执行文件路径时，沿用现有行为，不纳入本次自动重启语义。没有 Hindsight 运行配置字段的请求不得触发重启。只要请求包含运行配置字段，即使写入值与当前值相同，也按配置应用流程处理；这避免 API key 等不可安全回读字段造成错误的“无变化”判断。

## 后端流程

`createCommandAppsService().updateConfig(appId, patch)` 对 `cli-daemon` 类型的 Hindsight profile 使用以下顺序：

1. 在写文件前读取并保留旧 profile 设置，包括旧 host、port、配置路径和 profile 名。
2. 调用 `inspectHindsight` 检查目标 profile，记录 `running`、`launching` 或 `stopped` 以及可用 PID。`running` 和 `launching` 都视为活动状态。
3. 如果是活动状态，在修改文件之前先停止旧实例：
   - `running` 使用旧设置调用现有 `stopHindsight`，健康探测必须指向旧 host/port；
   - `launching` 不能依赖健康探测，必须通过 profile 专属 lock、实时父子进程关系和实时命令行共同确认 PID 属于目标 profile；默认 profile 必须接受省略 `-p default` 的命令行形式，`hindsight-embed` 父进程和其 `hindsight-api` 子进程都要有明确的接受规则；
   - 停止命令超时后，仅允许对同样完成上述身份确认的目标 profile PID 做一次强制终止兜底；
   - inspector 的全局进程列表 fallback、未经验证的 lock PID、已复用 PID、无法读取命令行或父子关系的 PID 都不得被终止；身份不能确证时安全失败，保持旧配置不写入；
   - 只有确认旧 PID 已退出且旧 host/port 不再健康，才能继续写配置；无法确认时终止请求，不写新配置，也不启动任何实例。
4. 以一个组合持久化操作写入 profile 环境文件和 Command Apps source 配置：
   - 在写入前保留环境文件原始内容和旧 source 配置；
   - 先原子替换 profile 环境文件，再保存 Command Apps source 配置；
   - 任一步失败时恢复两处旧值；只有两处新值都成功时才算 `configSaved: true`；
   - 如果回滚本身失败，错误 details 必须额外标记 `configState: "unknown"`，不得声称完全未保存。
5. 如果保存前是 `stopped`，直接返回刷新后的状态，保持停止。
6. 如果保存前是活动状态：
   - 重新读取 profile 设置，取得新 host/port；
   - 清除该 profile 在 `processStore` 中对应的旧 PID；
   - 调用现有 `startHindsight`，使用相同 profile 名、清理过的 daemon 环境、新设置和完整健康等待；
   - 启动健康探测必须指向新 host/port；
   - 记录新 PID（若返回），并在启动成功后返回最新状态。

启动前必须检查新 host/port 是否已经被任何健康服务占用；若已占用，不得调用 `startHindsight`，因为现有 `alreadyRunning` 分支可能把其他 profile 或无关服务误判为启动成功。启动完成必须同时满足：新端口健康、目标 profile 的专属 lock 指向新进程或可确认的新进程身份。无法确认身份时按 start 阶段失败处理，保留新配置并保持未启动状态。

自动重启不得复用 `launch()` 当前的异步快速返回语义。配置接口必须等待 `startHindsight` 的健康检查完成，避免 HTTP 成功响应早于配置真正生效。

## 失败语义

停止旧实例发生在写配置之前；启动新实例发生在写配置之后。这保证 stop 失败不会再次制造“文件是新配置、进程是旧配置”的不一致。

- stop 或强制终止失败：不写新配置、不执行 start，返回 `process_error`。错误 details 标记 `configSaved: false`、`configState: "rolled_back"`、`phase: "stop"`，并明确警告旧实例可能仍在运行。
- 写配置失败且成功回滚：旧实例已经停止；不执行 start，返回现有配置写入错误，details 标记 `configSaved: false`、`configState: "rolled_back"`、`phase: "write"`。
- 写配置失败且回滚失败：不执行 start，details 标记 `configSaved: false`、`configState: "unknown"`、`phase: "write"`，并明确要求用户检查配置状态。
- start 或新端口健康检查失败：保留已经写入的新配置，保持服务停止或不可用，返回 `process_error`。不得重新启动旧配置；details 标记 `configSaved: true`、`configState: "saved"`、`phase: "start"`。
- start 阶段失败信息必须说明“配置已保存，但 Hindsight 重启失败”，避免用户重复编辑或误以为配置未落盘。
- 无论失败发生在哪一步，都只操作目标 profile，不停止其他 profile。

这种处理是失败关闭：相较于恢复旧进程，宁可明确停止后台记忆处理，也不允许系统继续静默使用用户已经取消选择的旧模型。

## HTTP 响应与前端体验

现有 `PUT /v1/command-apps/apps/:appId/config` 路由保持不变。

任何成功的 Hindsight 运行配置更新都必须返回 `CommandAppStatus.configApply`，其结构固定为：

```ts
type ConfigApply = {
  restartRequired: boolean;
  restarted: boolean;
};
```

原本活动且重启成功时返回：

```json
{
  "configApply": {
    "restartRequired": true,
    "restarted": true
  }
}
```

原本停止时返回：

```json
{
  "configApply": {
    "restartRequired": false,
    "restarted": false
  }
}
```

前端根据结果显示：

- 已重启：`LLM 配置已保存并重启生效`。
- 原本停止：`LLM 配置已保存，将在下次启动时生效`。
- 重启失败：使用接口错误信息显示 `配置已保存，但 Hindsight 重启失败：…`，不显示成功 toast。

失败响应必须提供结构化 details：

```ts
type ConfigApplyFailure = {
  configSaved: boolean;
  configState: "saved" | "rolled_back" | "unknown";
  restartRequired: boolean;
  restarted: false;
  phase: "stop" | "write" | "start";
};
```

`CommandAppsError` 和 HTTP 错误序列化需要保留这些安全字段。前端不得通过解析英文错误字符串来决定提示：`configSaved: true` 显示“配置已保存，但 Hindsight 重启失败”；`configSaved: false` 显示普通保存/停止失败信息。

## 并发与状态

- `updateConfig` 在一次请求内串行执行检查、停止、写配置和启动。
- 服务层维护一个全局 Hindsight 配置/生命周期异步互斥锁；所有 Hindsight profile 的配置更新、launch、stop 和自动重启必须串行。该锁用于避免不同 profile 并发读改写共享 Command Apps 配置时丢失更新。
- 前端 action busy 状态只是交互优化，不能替代后端全局 Hindsight 锁；直接 API 请求也必须受到相同保护。
- 后端以目标 profile 的 inspector 和健康探测为准，而不是仅依赖 `processStore`，以覆盖外部启动以及仍处于 `launching` 的 daemon。
- profile 名必须由 `profileNameFromId(appId)` 和 `settingsWithProfile(...)` 解析，避免默认 profile 与 `coding-agent` profile 串用。

## 测试

### 服务单元测试

- 运行中的 profile 保存 LLM 配置后，调用顺序为 inspect、stop、写配置、start，并等待新端口健康完成。
- `launching` profile 被视为活动状态，先验证并终止目标 PID，再写配置和启动。
- `launching` 或 stop 兜底只终止命令行已验证属于目标 profile 的 PID；stale lock、PID 复用和其他 profile PID 必须拒绝终止。
- 停止状态保存配置只写文件，不调用 stop/start。
- source 配置变更与直接 `llm` 配置变更都触发相同行为。
- stop 失败时不写配置、不调用 start，并返回 `configSaved: false`、`phase: "stop"`。
- start 或健康检查失败时返回错误，不恢复旧进程。
- host/port 变更时，停止探测使用旧端口，启动探测使用新端口。
- 环境文件写入成功但 source 配置保存失败时恢复两处旧值；回滚失败返回 `configState: "unknown"`。
- 任意两个 Hindsight profile 的并发配置/生命周期请求按全局锁串行，后一个请求不得穿插前一个请求的 stop/write/start，也不能丢失共享配置更新。
- 默认 profile 命令行省略 `-p default` 时仍可完成身份确认；`hindsight-api` 子进程需要通过父子关系或专属 lock 确认。
- 新端口已被健康服务占用时拒绝启动并返回 start 阶段错误，不得把 `alreadyRunning` 当成配置已生效。
- 只把目标 profile 名传给 stop/start，不影响其他 profile。
- 成功状态包含可区分“已重启”和“下次启动生效”的 `configApply` 信息。

### 路由与前端测试

- 配置路由保留结构化错误信息。
- 前端对运行中重启成功显示“已保存并重启生效”。
- 前端对原本停止显示“将在下次启动时生效”。
- 前端对重启失败只显示失败提示，不显示成功 toast。

### 回归验证

- 运行现有 `tests/unit/command-apps.test.mjs` 和相关 Command Apps UI 测试。
- 构建 desktop panel，确保 TypeScript 和 bundle 正常。
- 当前基线中 `command apps service opens the coding-agent control plane deep link` 在本机 Hindsight `127.0.0.1:9077` 离线时失败；该环境依赖失败单独记录，不作为本修复引入的回归。

## 验收标准

- 当目标 profile 正在运行时，修改 `grok-4.5` 等模型配置后，配置接口在该 profile 完成健康重启前不会返回成功。
- 配置接口成功返回后，不存在旧 daemon 继续使用保存前模型的窗口。
- stop 失败时不写新配置；start 失败时用户能够明确知道新配置已经保存但尚未生效，并且旧模型进程不会被自动恢复。
- 原本停止的 profile 保存配置后仍保持停止。
