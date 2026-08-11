# 行为规范与候选 Skill 生成

## 1. 先生成 Skill Spec

根据 [decision-tables.md](decision-tables.md) 确定 `execution` 或 `guidance`，再生成符合 [skill-spec.schema.json](../schemas/skill-spec.schema.json) 的 `skill-spec.json`。

规范必须锁定：

- 名称、目标场景和类型；
- 方法论引用；
- 有序步骤及每步输入、动作、输出和检查点；
- 必需要素；
- 反模式；
- 锁定区和模型自由区；
- 全量一致性阈值。

不得把 Markdown 当作行为真源。

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-skill-spec \
  --file <skill-spec.json> --methodology <methodology.json>
```

## 2. 候选结构

Portable 核心：

```text
leo-<scenario>/
  SKILL.md
  references/
    skill-spec.json
    <主题>框架.md
    <主题>模板.md
    检查清单.md
```

OpenAI/Codex 适配可增加：

```text
agents/
  openai.yaml
```

## 3. 来源隔离

候选 Skill 必须包含稳定机器标记：

- `[COURSE_EVIDENCE]`：有方法论引用的课程内容；
- `[DERIVED_TEMPLATE]`：派生执行模板和工程门禁；
- `[MODEL_OUTPUT]`：实际调用时由模型生成的内容。

可以附加中文和 Emoji，但程序只依赖 ASCII 标记。

## 4. 生成边界

锁定 `skill-spec.json` 中的步骤顺序、检查点、必需要素和反模式。允许模型调整措辞、用户材料归类和不改变骨架的行业适配。

候选 `references/skill-spec.json` 必须是冻结规范的完整副本。

## 5. 校验

Portable：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-skill \
  --dir <候选目录> --spec <冻结skill-spec.json> --profile portable
```

OpenAI/Codex：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-skill \
  --dir <候选目录> --spec <冻结skill-spec.json> --profile openai
```

候选不得引用本 Skill，也不得依赖其他 Skill 完成核心流程。
