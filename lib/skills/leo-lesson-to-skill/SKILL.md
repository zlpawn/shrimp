---
name: leo-lesson-to-skill
description: "将一个或多个课程/教学视频中的方法论提炼为可执行、可追溯、跨模型行为一致且经过测试的独立 leo- Skill。用于“把这个视频转成 skill”“固化课程方法论”“让不同大模型按同一标准生成 skill”等请求；支持本地视频或 URL、已指定场景或先发现候选场景。输出不是课程总结，而是一个场景一个、带冻结行为规范的 Skill。"
---

# Leo Lesson to Skill

把课程方法论转成可重复调用的执行能力。不同模型可以使用不同措辞，但必须生成相同的方法论骨架、行为契约和验收门槛。

## 运行前

1. 将当前 `SKILL.md` 所在目录解析为绝对路径 `SKILL_ROOT`。
2. 后续脚本一律使用：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" <command>
```

不要假设当前工作目录是 Skill 目录。`<PYTHON>` 使用当前环境可用的 Python 3 绝对路径。

输入必须包含一个或多个视频来源。场景支持：

- **已知场景**：用户提供视频和目标场景。
- **场景发现**：先从课程证据识别候选场景，用户选择后继续。

## 不可违反的规则

1. 不补写课程没讲过的方法论；事实层必须带真实 `source_refs`。
2. 模糊和冲突内容进入 `uncertain_items`，不得静默裁决。
3. 一个生成 Skill 只服务一个场景维度。
4. 机器使用稳定来源标记：
   - `[COURSE_EVIDENCE]`：课程证据；
   - `[DERIVED_TEMPLATE]`：基于课程骨架派生的执行模板；
   - `[MODEL_OUTPUT]`：根据用户材料生成的内容。
5. 锁定步骤顺序、检查点、必需要素和反模式；只放开措辞、材料归类和不改变骨架的场景适配。
6. `skill-spec.json` 是行为真源。Markdown 不得覆盖或弱化它。
7. 所有必需测试与一致性指标全部通过前禁止发布。
8. 生成的 Skill 必须自包含，不依赖或提及本 Skill。
9. 用户业务成品默认不显示内部来源标记。

关键判断必须读取：

- [decision-tables.md](references/decision-tables.md)
- [calibration-examples.md](references/calibration-examples.md)

## 固定流水线

```text
视频/字幕/视觉证据
→ intermediate-representation.json
→ methodology.json
→ skill-spec.json
→ 候选 Skill
→ frozen test suite
→ test-report.json
→ 发布
```

不得跳过 `skill-spec.json` 直接从方法论生成最终 Markdown。

## 1. 初始化和摄取

读取：

- [workflow-contract.md](references/workflow-contract.md)
- [platform-runtime.md](references/platform-runtime.md)
- [ingest-pipeline.md](references/ingest-pipeline.md)

执行：

1. 区分本地文件和 URL；URL 才要求 `yt-dlp`。
2. 创建唯一运行目录和 Manifest：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" init-run --source <来源>
```

3. 归档视频、验证媒体、运行 ASR。
4. 对代表帧优先使用多模态理解，OCR 作为可选文字索引。
5. 生成 IR 并执行 `validate-ir`。
6. 每完成阶段用 `manifest-set-status` 更新；临时文件用 `manifest-add-temp` 登记。

门禁：转写非空、ID 唯一、时间戳有效、视觉通道状态明确、IR 校验通过。

## 2. 提炼方法论

读取 [methodology-extraction.md](references/methodology-extraction.md)。

1. 提取框架、步骤、原则、检查点、场景、模板和反模式。
2. 每项记录来源、证据类型、置信度和冲突状态。
3. 根据决策表处理场景、顺序和不确定项。
4. 生成 `methodology.json`：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-methodology \
  --file <methodology.json> --ir <intermediate-representation.json>
```

门禁：目标场景唯一；每项事实均有 IR 中存在的来源；开放冲突被保留。

## 3. 冻结行为规范

读取 [skill-generation.md](references/skill-generation.md)。

1. 根据决策表确定 `execution` 或 `guidance`。
2. 从 `methodology.json` 生成 `skill-spec.json`，固定：
   - Skill 名称和场景；
   - 类型和有序工作流；
   - 每步输入、动作、输出、检查点；
   - 方法论引用；
   - 必需要素和反模式；
   - 锁定区、自由区和验收阈值。
3. 校验：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-skill-spec \
  --file <skill-spec.json> --methodology <methodology.json>
```

门禁：所有方法论引用存在；步骤顺序连续；所有一致性阈值保持最高标准。

## 4. 生成候选 Skill

1. 在临时目录生成候选 Skill。
2. 所有宿主都必须包含：

```text
leo-<scenario>/
  SKILL.md
  references/
    skill-spec.json
    ...
```

3. OpenAI/Codex 宿主可以额外生成 `agents/openai.yaml`。
4. 候选中的 `references/skill-spec.json` 必须与冻结规范完全一致。
5. 校验：

```text
<PYTHON> "<SKILL_ROOT>/scripts/lesson_skill_guard.py" validate-skill \
  --dir <候选目录> --spec <冻结skill-spec.json> --profile portable
```

OpenAI/Codex 交付改用 `--profile openai`。

## 5. 测试和回炉

读取 [auto-test.md](references/auto-test.md)。

1. 在首次执行前冻结至少两个必需测试及 SHA-256。
2. 覆盖正常输入、信息缺失和反模式诱导。
3. 执行阶段不得看到期望答案。
4. 记录测试模式：`deterministic`、`self_eval` 或 `independent_eval`。
5. 检查方法论覆盖、步骤顺序、必需要素、反模式、无来源断言、冲突呈报、测试通过率和规范哈希。
6. 一轮只修一个根因，重新运行全部测试，最多三轮。
7. 运行 `validate-test-report`。

门禁：所有必需检查为真，所有一致性指标达到冻结阈值，才允许 `final_status: passed`。

## 6. 发布和清理

只有测试通过才执行 `publish`，并传入 `--spec` 和正确 `--profile`。同名目录默认拒绝覆盖；用户明确授权后才使用 `--allow-overwrite`，并保留备份。

清理按 [cleanup-policy.md](references/cleanup-policy.md)。先预览，用户明确授权后才删除本次运行创建的常规临时文件。

## 数据契约

- [run-manifest.schema.json](schemas/run-manifest.schema.json)
- [intermediate-representation.schema.json](schemas/intermediate-representation.schema.json)
- [methodology.schema.json](schemas/methodology.schema.json)
- [skill-spec.schema.json](schemas/skill-spec.schema.json)
- [test-report.schema.json](schemas/test-report.schema.json)
