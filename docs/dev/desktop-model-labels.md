# Desktop 模型展示名映射 (model_labels)

## 背景

Claude Desktop 3P 的 `inferenceModels[].name` 必须是 `claude-xxx` 官方格式才被识别。
旧方案要求用户在 `model_mapping` 的 key 里手填 `claude-opus-4-7` 这种官方名，
value 是真实上游模型。问题：同一模型在多个第三方平台订阅时（如 glm-5.2 既在
agentplan 也在 codingplan），用户被迫编不同的 claude 名来规避全局重名校验。

## 新方案

把「claude 官方 id 分配」从用户职责变成系统职责，用户只关心两件事：
1. 展示名（label）-- 在 Claude Desktop UI 里看到的，如 `glm-5.2-loe`
2. 上游模型（upstream）-- 真实路由目标，如 `glm-5.2`

claude 官方 id 由系统从内置池自动分配，全局唯一。

### 数据结构（挂在 endpoint 上）

```
model_mapping: { "claude-opus-4-7": "glm-5.2" }      // id -> 上游，路由用，结构不变
model_labels:  { "claude-opus-4-7": "glm-5.2-loe" }  // id -> 展示名，新增
```

`model_mapping` 的语义和结构完全不变，网关路由代码 `resolveConfiguredModel`
一行不改--继续 `model_mapping[claude_id]` 查上游。只有落盘 3P config 时
`labelOverride` 的来源从 `model_mapping[key]`（上游名）改成
`model_labels[key]`（展示名，缺失则退回上游名）。

### auto-id 分配策略 (allocateClaudePublicId)

按优先级分配，保证生成的 id 都是 Claude Desktop 认可的真实格式：

1. 内置池（6 个真实官方 id）：opus-4-8 / opus-4-7 / opus-4-6 /
   sonnet-4-5 / haiku-4-5 / haiku-4-0
2. 内置池各 id 的 -max 变体（6 个）：claude-opus-4-8-max 等。
   -max 是 Claude Desktop 认可的真实后缀，附加在真实版本号上。
   **不用编造版本号**（如 claude-opus-4-9），Desktop 不认。
3. 最后兜底：版本号递增（nextClaudeVersionSuggestion）。
   实际几乎不会触达，池子 + -max 变体已覆盖 12 个 id。

### 数据流

```
用户配:  展示名=glm-5.2-loe   上游=glm-5.2
                    |
      系统自动分配 claude id (内置池 -> -max 变体 -> 版本递增)
                    |
                    v
存储:  model_mapping[claude-opus-4-7] = glm-5.2       // 路由
       model_labels[claude-opus-4-7]  = glm-5.2-loe   // 展示
                    |
      保存 -> syncClaudeThirdPartyInferenceConfig
                    v
3P config:  { name: claude-opus-4-7, labelOverride: glm-5.2-loe, supports1m }
                    |
      Claude Desktop UI 显示 glm-5.2-loe, 请求带 model=claude-opus-4-7
                    v
网关 /desktop:  model_mapping[claude-opus-4-7] -> glm-5.2  (路由不变)
```

## 改动清单

### 1. lib/config/gateway-config-store.mjs

#### 1a. buildClaudeInferenceModels 读取 model_labels
- 遍历 endpoint.model_mapping 时，labelOverride 优先取
  endpoint.model_labels[key]，取不到退回 upstreamModel（向后兼容旧配置）。
- 其余逻辑（isClaudePublicModelName 校验、supports1m、去重）不变。

#### 1b. auto-id 分配函数（新增 export）
- allocateClaudePublicId(usedIds)：内置池 -> -max 变体 -> 版本递增兜底。
- BUILTIN_CLAUDE_OFFICIAL_MODELS 常量在 lib 里新增一份。

#### 1c. 校验逻辑
- desktop 的 model_mapping key 仍必须是 claude 官方名（路由依赖），
  isClaudePublicModelName 校验保留。
- model_labels 的 key 不在 model_mapping 时报 stale_model_label 告警
  （不阻塞保存）。
- 重复 public id 校验（duplicate_public_model）逻辑不变。

### 2. desktop/src/app.ts（前端）

#### 2a. desktop 节点的映射输入区改造
- 左栏（原：选 claude 官方名）：desktop 改成「展示名」输入框，
  placeholder `展示名 (如 glm-5.2-loe)`，不再绑 map-source 建议弹层。
  非 desktop 客户端保持原样（仍可手填 claude 名）。
- 右栏（上游模型）：不变。
- 添加映射时（handleMappingInput）：desktop 分支--
  label = 左栏值，upstream = 右栏值，
  前端分配 claude id，写入 model_mapping[id]=upstream 和
  model_labels[id]=label。
- 已有映射的 tag 展示：desktop 显示 `label -> upstream (id: claude-xxx)`，
  非 desktop 保持 `key -> value`。
- removeMapping：desktop 同时删 model_mapping 和 model_labels 对应项。

#### 2b. claude id 分配
- 新增前端函数 allocateDesktopClaudeId()：与 lib 同策略
  （内置池 -> -max 变体 -> 版本递增兜底），不新增端点。

#### 2c. 旧映射建议弹层
- renderMappingSourceSuggestions / availableClaudeDesktopMappingSources
  对 desktop 不再触发。函数保留供非 desktop 用。

### 3. 迁移与兼容

- 旧配置 {model_mapping: {claude-opus-4-7: glm-5.2}} 无 model_labels：
  buildClaudeInferenceModels 退回用上游名当 labelOverride，视觉零变化。
  用户可后续手动补展示名。无需强制迁移脚本。
- 新增 desktop 节点的 model_mapping / model_labels 初始为 {}。

## 测试

### 单元测试（tests/unit/gateway-config-store.test.mjs）
- buildClaudeInferenceModels 读 model_labels：有 label 用 label，
  无 label 退回上游名。
- allocateClaudePublicId：池内优先、池满返回 -max 变体、池+max 满
  才版本递增、永不重复。

### 手动验证（8788 端口）
- 用独立配置文件 + 独立 3P configLibrary 启动，避免污染主环境。
- 配两个节点同上游不同展示名，确认分到不同 claude id、都路由到 glm-5.2。
- 旧配置（无 model_labels）保存后确认 labelOverride 退回上游名。

## 环境隔离
- worktree: .worktrees/desktop-model-labels (分支 codex/desktop-model-labels)
- 测试启动: GATEWAY_PORT=8788 GATEWAY_CONFIG_FILE=测试config
  GATEWAY_SECRETS_FILE=测试secrets CLAUDE_3P_CONFIG_LIBRARY=测试3P目录
