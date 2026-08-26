# Leo Code to Business Business Flow Semantic Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent technical execution chains from passing as canonical business flows while preserving their verified facts in the correct business-knowledge dimensions and evidence.

**Architecture:** Add a conservative, deterministic flow-quality analyzer inside the existing business knowledge Guard. The analyzer returns explainable diagnostics and contributes a coverage metric; high-severity diagnostics downgrade current coverage to `partial` without mutating canonical text or changing schema v2. Strengthened skill references and acceptance fixtures teach future analyses to author business stages first, while the real `utopia-scs-recorder` revision proves the complete workflow.

**Tech Stack:** Python 3 standard library, `unittest`, JSON/JSONL canonical artifacts, Markdown skill references, existing deterministic projection scripts.

**Spec:** `docs/superpowers/specs/2026-08-26-leo-code-to-business-business-flow-semantic-quality-design.md`

## Global Constraints

- Do not change canonical schema v2 or add a canonical field.
- Do not rewrite technical prose in HTML or AI renderers.
- Do not use a single technical keyword as a validation failure.
- Diagnostics must be deterministic, explainable, and conservative.
- High-severity diagnostics make current coverage at most `partial`, not `blocked`.
- Technical facts remain traceable in rules, decisions, permissions, data/state changes, external effects, and evidence.
- Preserve the unrelated `gateway.config.json` worktree modification.
- Never mutate an existing immutable target revision in place.

---

### Task 1: Lock the Business Flow Authoring Contract

**Files:**
- Modify: `lib/skills/leo-code-to-business/SKILL.md`
- Modify: `lib/skills/leo-code-to-business/references/business-discovery.md`
- Modify: `lib/skills/leo-code-to-business/references/business-knowledge-model.md`
- Modify: `lib/skills/leo-code-to-business/references/coverage-and-completion.md`
- Modify: `lib/skills/leo-code-to-business/references/evidence-and-confidence.md`
- Test: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`

**Interfaces:**
- Consumes: Existing confirmed use-case contract and semantic-review rubric.
- Produces: A documented `main_flow` contract and exact placement rules used by the Guard and future analysts.

- [ ] **Step 1: Add failing contract tests**

Add tests that require the references to state:

```python
self.assertIn("participant action or business event", discovery_text)
self.assertIn("visible outcome or handoff", discovery_text)
self.assertIn("must not substitute implementation order", evidence_text)
self.assertIn("business_flow_semantic_quality", coverage_text)
```

Also require `SKILL.md` to state that confirmed `main_flow` must be understandable without source-code knowledge.

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard.BusinessKnowledgeGuardTests.test_business_flow_contract_is_explicit -v
```

Expected: FAIL because the strengthened phrases and metric are absent.

- [ ] **Step 3: Update the skill and references**

Document:

```text
main_flow = participant action/business event + ordered business stages +
business-facing decisions + visible result/handoff
```

Route tenant precedence, deduplication mechanics, internal enums, persistence writes, queue/index
operations, and source identifiers to their proper dimensions and evidence.

- [ ] **Step 4: Run the focused contract tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/SKILL.md \
  lib/skills/leo-code-to-business/references/business-discovery.md \
  lib/skills/leo-code-to-business/references/business-knowledge-model.md \
  lib/skills/leo-code-to-business/references/coverage-and-completion.md \
  lib/skills/leo-code-to-business/references/evidence-and-confidence.md \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py
git commit -m "docs: strengthen business flow authoring contract"
```

### Task 2: Add Deterministic Flow Diagnostics

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`

**Interfaces:**
- Consumes: Confirmed use-case records with `id` and `main_flow[].local_id/statement`.
- Produces:

```python
analyze_flow_statement(statement: str) -> dict[str, Any]
validate_business_flow_quality(use_case: dict[str, Any]) -> list[dict[str, Any]]
validate_business_flows(use_cases: list[dict[str, Any]]) -> list[dict[str, Any]]
```

Each diagnostic contains:

```python
{
    "use_case_id": str,
    "flow_step_address": str,
    "severity": "high",
    "reason_codes": list[str],
    "statement": str,
}
```

- [ ] **Step 1: Add failing analyzer tests**

Cover the observed statements:

```python
"以 projectId+acceptanceNode 建立短时防重复键"
"LINJING 设备进入 3D/头戴路径，其他设备进入普通/耳挂路径"
"写入工程、节点、地址、工长、检查员、操作人、关联状态和时间"
"数据库更新后同步 Elasticsearch"
```

Require stable reason codes and canonical addresses such as:

```text
UC-relate-video-site#main_flow/step-2
```

- [ ] **Step 2: Add failing false-positive tests**

Require no high-severity diagnostic for:

```text
视频操作人员选择现场视频和对应的工程验收节点。
所选租户决定本次关联归属的组织。
关联完成后，验收人员可以在视频搜索中找到这些资料。
```

- [ ] **Step 3: Run analyzer tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard.BusinessKnowledgeGuardTests.test_flow_quality_rejects_technical_execution_chain \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard.BusinessKnowledgeGuardTests.test_flow_quality_accepts_business_effects_with_technical_terms -v
```

Expected: FAIL because the analyzer functions do not exist.

- [ ] **Step 4: Implement the minimal pure analyzer**

Use compiled standard-library regular expressions and small word lists grouped by signal type:

```python
FLOW_REASON_CODE_SHAPED = "code_shaped_expression"
FLOW_REASON_INFRASTRUCTURE = "infrastructure_sequence"
FLOW_REASON_FIELD_INVENTORY = "field_write_inventory"
FLOW_REASON_INTERNAL_CONSTANT = "internal_constant_without_business_meaning"
FLOW_REASON_MISSING_EVENT = "missing_actor_or_business_event"
FLOW_REASON_MISSING_EFFECT = "missing_business_effect"
```

Only emit high severity when at least one strong technical signal is present and the statement lacks
a business action/event or business-visible effect. Never mutate the input record.

- [ ] **Step 5: Run analyzer tests**

Run the command from Step 3.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py
git commit -m "feat: diagnose technical narration in business flows"
```

### Task 3: Integrate Diagnostics with Coverage and Validation

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/coverage.json`

**Interfaces:**
- Consumes: `validate_business_flows()` diagnostics.
- Produces:

```python
validation["business_flow_diagnostics"] -> list[dict[str, Any]]
validation["coverage"]["metrics"]["business_flow_semantic_quality"] -> metric
```

The metric uses:

```python
{
    "numerator": confirmed_flow_count - affected_use_case_count,
    "denominator": confirmed_flow_count,
    "ratio": float,
    "unresolved_ids": sorted(flow_step_addresses),
    "excluded_ids": [],
}
```

- [ ] **Step 1: Add failing validation integration tests**

Create a temporary copy of `sample-revision-v2`, replace its use-case flow with the observed
technical chain, update canonical/projection hashes as needed for the fixture operation, and assert:

```python
self.assertEqual(result["coverage"]["current_coverage_status"], "partial")
self.assertTrue(result["business_flow_diagnostics"])
self.assertIn(
    "UC-create-work-order#main_flow/step-1",
    result["coverage"]["metrics"]["business_flow_semantic_quality"]["unresolved_ids"],
)
```

Also assert the unchanged sample revision remains `passed`.

- [ ] **Step 2: Run the integration tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard.BusinessKnowledgeGuardTests.test_flow_diagnostics_downgrade_current_coverage \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard.BusinessKnowledgeGuardTests.test_valid_sample_revision_passes -v
```

Expected: FAIL because validation does not expose or count diagnostics.

- [ ] **Step 3: Integrate diagnostics into `validate_revision_v2()`**

After loading and validating nodes:

```python
flow_diagnostics = validate_business_flows(nodes_by_file["use-cases.jsonl"])
```

Add the metric to coverage, include affected flow addresses in current unresolved status derivation,
and return diagnostics at `validation.business_flow_diagnostics`.

Manifest consistency remains strict: a fixture whose artifacts now derive `partial` must declare
`partial`; valid fixtures remain `passed`.

- [ ] **Step 4: Run integration and full Guard tests**

Run:

```bash
python3 -m unittest \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/coverage.json
git commit -m "feat: gate coverage on business flow semantic quality"
```

### Task 4: Strengthen Acceptance Expectations

**Files:**
- Modify: `lib/skills/leo-code-to-business/references/acceptance-scenarios.md`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/expected/utopia-video-binding.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/expected/semantic-rubric.json`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_v2_acceptance.py`

**Interfaces:**
- Consumes: Existing benchmark fixture format and `validate_benchmark_review()`.
- Produces: Real-repository expectations that require business meaning while preserving technical evidence checks.

- [ ] **Step 1: Add failing expectation tests**

Require:

```python
self.assertIn("required_business_flow_concepts", video_expectation)
self.assertIn("technical_fact_placements", video_expectation)
self.assertIn("non_technical_comprehensibility", semantic_rubric)
```

- [ ] **Step 2: Run focused acceptance tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib.skills.leo-code-to-business.tests.test_business_knowledge_guard.BusinessKnowledgeGuardTests.test_real_repository_expectations_preserve_core_business_gates \
  lib.skills.leo-code-to-business.tests.test_v2_acceptance -v
```

Expected: FAIL because the new expectation fields do not exist.

- [ ] **Step 3: Update acceptance fixtures and validation**

Replace raw flow requirements such as `projectId+acceptanceNode` and "数据库更新后同步 ES" with
business-flow concepts:

```text
operator selects footage and acceptance node
rapid duplicate association is rejected
capture mode determines association scope
related footage from one capture session is grouped
acceptance staff can search and use associated footage
```

Keep raw technical facts required through `technical_fact_placements`, with allowed canonical
dimensions such as `decision_points`, `rejection_conditions`, `data_changes`, `external_effects`,
and `evidence`.

- [ ] **Step 4: Run focused acceptance tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/references/acceptance-scenarios.md \
  lib/skills/leo-code-to-business/tests/fixtures/expected/utopia-video-binding.json \
  lib/skills/leo-code-to-business/tests/fixtures/expected/semantic-rubric.json \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_v2_acceptance.py
git commit -m "test: require business-readable flows in acceptance"
```

### Task 5: Run Complete Skill Verification and Synchronize

**Files:**
- Modify only if verification reveals defects in Task 1-4 files.
- Synchronize managed files from `lib/skills/leo-code-to-business/` to `/Users/pa/.agents/skills/leo-code-to-business/`.

**Interfaces:**
- Consumes: Completed Guard, references, fixtures, and tests.
- Produces: A centrally installed skill byte-identical to the managed source, excluding runtime caches.

- [ ] **Step 1: Run the complete unit suite**

Run:

```bash
python3 -m unittest discover \
  -s lib/skills/leo-code-to-business/tests \
  -p 'test_*.py' -v
```

Expected: all tests pass.

- [ ] **Step 2: Run fixed real-Git acceptance**

Run:

```bash
python3 lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py \
  real-git-fixture \
  --output /tmp/leo-business-flow-real-git.json
```

Expected: `status = passed`.

- [ ] **Step 3: Run extended Java acceptance**

Run:

```bash
python3 lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py \
  extended-java \
  --repo /Users/pa/project/JZ/utopia-scs-recorder \
  --commit c6893715d0d52477849595e7ed7c8c5ec276f322 \
  --output /tmp/leo-business-flow-java.json
```

Expected: `status = passed` and all five scenario checks true.

- [ ] **Step 4: Run skill package validation**

Run:

```bash
python3 /Users/pa/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  lib/skills/leo-code-to-business
```

Expected: valid skill package.

- [ ] **Step 5: Synchronize managed files non-destructively**

Use `rsync` without deletion:

```bash
rsync -a \
  --exclude '__pycache__/' \
  lib/skills/leo-code-to-business/ \
  /Users/pa/.agents/skills/leo-code-to-business/
```

- [ ] **Step 6: Verify source/destination equality and Antigravity link**

Run:

```bash
diff -qr \
  --exclude='__pycache__' \
  lib/skills/leo-code-to-business \
  /Users/pa/.agents/skills/leo-code-to-business
realpath /Users/pa/.gemini/config/skills/leo-code-to-business
```

Expected: no diff; real path is `/Users/pa/.agents/skills/leo-code-to-business`.

### Task 6: Rebuild the Target Business Knowledge

**Files:**
- Create: `/Users/pa/project/JZ/utopia-scs-recorder/_leo_business/runs/<run-id>/staging-artifacts/`
- Create after successful immutable publication: `/Users/pa/project/JZ/utopia-scs-recorder/_leo_business/revisions/REV-<new-canonical-prefix>/`
- Modify only after validation: `/Users/pa/project/JZ/utopia-scs-recorder/_leo_business/current.json`
- Preserve target repository user changes.

**Interfaces:**
- Consumes: Synchronized Skill, frozen target snapshot, existing `REV-2fc38640940b9243` evidence and canonical artifacts.
- Produces: A new immutable revision with a new canonical hash, corrected flows, matching AI/HTML projections, and exact coverage status.

- [ ] **Step 1: Freeze and record target state**

Record:

```bash
git -C /Users/pa/project/JZ/utopia-scs-recorder status --short
sha256sum \
  /Users/pa/project/JZ/utopia-scs-recorder/_leo_business/current.json \
  /Users/pa/project/JZ/utopia-scs-recorder/_leo_business/revisions/REV-2fc38640940b9243/manifest.json
```

- [ ] **Step 2: Create a new staging run**

Copy the prior immutable revision to a new run staging directory, then revise canonical semantic
artifacts only in staging. Preserve IDs and evidence links where the business meaning is unchanged.

- [ ] **Step 3: Reconstruct all confirmed main flows**

At minimum correct `UC-relate-video-site` to describe:

```text
operator selects footage and acceptance node
system checks duplicate/eligibility
capture mode determines selected-only versus same-session scope
footage is assigned with project/site responsibility context
association becomes searchable and usable by acceptance staff
replacement/relink recovery remains explicit
```

Review every other confirmed use case with `validate_business_flows()` and revise any high-severity
step from current source evidence.

- [ ] **Step 4: Preserve technical facts in proper dimensions**

Verify tenant precedence, `projectId+acceptanceNode`, `LINJING`, field writes, and Elasticsearch
synchronization remain in decisions/rules/rejections/data/state/external effects/evidence.

- [ ] **Step 5: Recompute canonical hash and review artifacts**

Update the staging manifest, coverage, omission audit, and independent semantic review with the new
canonical hash. Do not copy the prior semantic score blindly; review the frozen canonical artifacts
again.

- [ ] **Step 6: Generate and validate projections**

Run:

```bash
python3 lib/skills/leo-code-to-business/scripts/render_business_site.py \
  --revision <staging-artifacts>
python3 lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  validate \
  --revision <staging-artifacts>
```

Expected:

```text
business_flow_diagnostics = []
canonical hash differs from 2fc38640940b9243...
projection hashes match generated files
status is the exact evidence-derived passed/partial result
```

- [ ] **Step 7: Publish immutably**

Use the existing `publish` command only after staging validation succeeds. Confirm the new revision
directory is derived from the new canonical hash and the old revision remains byte-identical.

- [ ] **Step 8: Verify target integrity**

Compare the recorded hashes and Git status. The old revision must be unchanged; only generated
`_leo_business` artifacts and the validated current pointer may differ.

- [ ] **Step 9: Open the result**

Open:

```text
<new-revision>/site/index.html
<new-revision>/ai-context.md
```

Verify the video-association business flow is understandable before expanding implementation
evidence.

