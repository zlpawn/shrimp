# 跨模型一致性测试

## 冻结测试集

首次执行候选 Skill 前冻结至少两个必需场景，覆盖正常输入、信息缺失和反模式诱导。记录 `scenario_id`、`required`、`description`、`user_input` 和 `check_ids`，并计算规范化 JSON 的 SHA-256。

后续轮次不得改变场景、必需标记或检查项。

## 执行隔离

- 执行模型只看到候选 Skill 和用户输入。
- 不泄漏期望答案、已知失败或修复建议。
- 保留每轮完整输入、输出、判断和修改。
- 能使用独立模型时优先 `independent_eval`；否则明确记录 `self_eval`。程序检查使用 `deterministic`。

## 一致性指标

`passed` 必须同时满足：

| 指标 | 要求 |
|---|---:|
| `methodology_coverage` | `1.0` |
| `step_order_match` | `true` |
| `required_elements_coverage` | `1.0` |
| `anti_patterns_coverage` | `1.0` |
| `unsupported_claims` | `0` |
| `open_conflicts_reported` | `true` |
| `required_test_pass_rate` | `1.0` |
| `spec_hash_match` | `true` |

所有必需场景中的所有检查项也必须为真，`failed_items` 必须为空。

## 回炉

一轮只修一个根因，不修改冻结标准，重新运行全部测试，最多三轮。三轮仍失败时写 `failed_after_3_rounds` 并禁止发布。

## 校验

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-test-report \
  --file <test-report.json>
```
