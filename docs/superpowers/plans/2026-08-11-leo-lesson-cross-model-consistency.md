# Leo Lesson Cross-Model Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock course-to-Skill behavior so different models may vary wording but must preserve the same methodology, workflow, evidence boundaries, and release criteria.

**Architecture:** Add `skill-spec.json` between extracted methodology and generated Markdown. Extend the standard-library guard to validate the frozen specification, compare it with the candidate Skill, and enforce normalized consistency metrics. Keep detailed decision rules and calibration examples in references so every model receives the same boundary cases.

**Tech Stack:** Markdown Skill instructions, JSON Schema Draft 2020-12 documents, Python 3 standard library, `unittest`, Git.

## Global Constraints

- Do not require vendor APIs or a specific model provider.
- Allow wording differences; reject methodology, step-order, checkpoint, required-element, and anti-pattern drift.
- Use `[COURSE_EVIDENCE]`, `[DERIVED_TEMPLATE]`, and `[MODEL_OUTPUT]` as machine-stable provenance markers.
- Prefer multimodal frame understanding; use OCR as an optional text-index channel.
- Preserve the existing three-round release gate and safe publish/cleanup behavior.
- Support Windows, macOS, and Linux manifests.

---

### Task 1: Freeze the generated Skill behavior

**Files:**
- Create: `lib/skills/leo-lesson-to-skill/schemas/skill-spec.schema.json`
- Modify: `lib/skills/leo-lesson-to-skill/schemas/test-report.schema.json`
- Test: `lib/skills/leo-lesson-to-skill/tests/test_lesson_skill_guard.py`

**Interfaces:**
- Produces: `skill-spec.json` containing `skill_name`, `target_scenario`, `skill_type`, ordered `workflow`, `required_elements`, `anti_patterns`, `freedom_policy`, and `acceptance_thresholds`.
- Produces: test-report `consistency_metrics` and `evaluation_mode`.

- [ ] Add failing tests for a missing source reference, duplicate step order, invalid threshold, and a passed report below consistency thresholds.
- [ ] Run the focused unit tests and confirm failure.
- [ ] Add the two JSON Schemas with explicit required fields and enums.
- [ ] Re-run the focused tests after guard implementation in Task 2.

### Task 2: Enforce the behavior lock

**Files:**
- Modify: `lib/skills/leo-lesson-to-skill/scripts/lesson_skill_guard.py`
- Test: `lib/skills/leo-lesson-to-skill/tests/test_lesson_skill_guard.py`

**Interfaces:**
- Produces: `validate_skill_spec_data(data, methodology_ids=None) -> None`.
- Produces: `validate-skill-spec --file <path> [--methodology <path>]`.
- Extends: `validate-skill --dir <path> [--spec <path>] [--profile portable|openai]`.

- [ ] Implement semantic validation for ordered workflow steps, unique IDs, methodology references, freedom boundaries, and exact acceptance thresholds.
- [ ] Require candidate `references/skill-spec.json` to match the frozen spec by canonical SHA-256 when `--spec` is provided.
- [ ] Validate stable ASCII provenance markers instead of relying only on emoji.
- [ ] Make `agents/openai.yaml` optional in `portable` profile and required in `openai` profile.
- [ ] Add Linux to Manifest validation and platform detection.
- [ ] Run the full unit suite.

### Task 3: Normalize visual evidence and model decisions

**Files:**
- Modify: `lib/skills/leo-lesson-to-skill/schemas/intermediate-representation.schema.json`
- Modify: `lib/skills/leo-lesson-to-skill/scripts/lesson_skill_guard.py`
- Create: `lib/skills/leo-lesson-to-skill/references/decision-tables.md`
- Create: `lib/skills/leo-lesson-to-skill/references/calibration-examples.md`
- Test: `lib/skills/leo-lesson-to-skill/tests/test_lesson_skill_guard.py`

**Interfaces:**
- Frames contain optional `multimodal` and `ocr` evidence channels plus required `visual_status`.
- Decision tables define skill type, scenario split, evidence priority, uncertainty, and derived-checkpoint behavior.

- [ ] Add failing tests for multimodal-only, OCR-only, and undeclared no-visual evidence.
- [ ] Implement evidence-channel validation.
- [ ] Write deterministic decision tables.
- [ ] Write concise positive, negative, and boundary examples for provenance and inference.
- [ ] Run the full unit suite.

### Task 4: Integrate the consistency pipeline into the Skill

**Files:**
- Modify: `lib/skills/leo-lesson-to-skill/SKILL.md`
- Modify: `lib/skills/leo-lesson-to-skill/references/ingest-pipeline.md`
- Modify: `lib/skills/leo-lesson-to-skill/references/methodology-extraction.md`
- Modify: `lib/skills/leo-lesson-to-skill/references/skill-generation.md`
- Modify: `lib/skills/leo-lesson-to-skill/references/auto-test.md`
- Modify: `lib/skills/leo-lesson-to-skill/references/platform-runtime.md`
- Modify: `lib/skills/leo-lesson-to-skill/references/workflow-contract.md`

**Interfaces:**
- Documents instruct all models to resolve `SKILL_ROOT`.
- Pipeline becomes IR → methodology → skill spec → candidate Skill → frozen tests.

- [ ] Add the `skill-spec` stage and hard gate to the main workflow.
- [ ] Replace OCR-first language with multimodal-first, OCR-assisted evidence.
- [ ] Link decision tables and calibration examples directly from `SKILL.md`.
- [ ] Document portable/openai profiles and Linux support.
- [ ] Keep `SKILL.md` below 500 lines and eliminate contradictory rules.

### Task 5: Verify, commit, and push

**Files:**
- Verify all files under `lib/skills/leo-lesson-to-skill/`
- Include design and plan documents under `docs/superpowers/`

**Interfaces:**
- Produces: one intentional commit on `main`.
- Produces: updated `origin/main`.

- [ ] Run `python -m unittest discover` with bytecode disabled.
- [ ] Run official `quick_validate.py`.
- [ ] Parse all JSON Schemas.
- [ ] Run `git diff --check`.
- [ ] Inspect staged diff and confirm no unrelated files are staged.
- [ ] Commit with `feat: align lesson skill across models`.
- [ ] Fetch and ensure push is fast-forward.
- [ ] Push `main` to `origin`.
