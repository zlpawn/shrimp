# 方法论提炼规范

从 IR 提炼课程事实。必须同时读取 [decision-tables.md](decision-tables.md) 和 [calibration-examples.md](calibration-examples.md)。

## 提炼对象

提取框架、步骤、原则、检查点、场景、模板和反模式。常识上合理但课程未讲的内容不得进入事实层。

## 证据字段

每项必须包含：

- `source_refs`：IR 中真实存在的 Segment/Frame ID；
- `evidence_type`：`verbatim`、`transcribed`、`visual` 或 `synthesized`；
- `confidence`：`high`、`medium` 或 `low`；
- `conflict_status`：`none`、`open` 或 `resolved_by_user`。

普通 ASR 使用 `transcribed`。只有逐字核对后才使用 `verbatim`。多条同义课程证据可标记 `synthesized`，但不能引入外部知识。

## 一致性规则

1. 保留课程的步骤粒度和顺序。
2. 讲者例子只作为 `speaker_examples`，不自动升级为规则。
3. 课程未给检查点时，不在 `methodology.json` 补写。
4. 口述与课件冲突时保留两个版本。
5. ASR、OCR 或画面不清时进入 `uncertain_items`。
6. 用户指定场景必须有课程正文证据；课程标题不够。
7. 多场景按决策表拆分，一个方法论文件只有一个 `target_scenario`。

## 校验

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-methodology \
  --file <methodology.json> --ir <intermediate-representation.json>
```
