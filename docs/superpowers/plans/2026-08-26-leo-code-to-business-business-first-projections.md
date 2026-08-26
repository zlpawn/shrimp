# Leo Code to Business Business-First Projections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the offline HTML and `ai-context.md` business-first entry points while preserving deterministic output, technical traceability, canonical schema compatibility and the existing task-context contract.

**Architecture:** Keep canonical schema `2.0` and `site-view-model.json` fixed views as the single source contract. Reorganize only the renderer's human and AI projections: HTML derives business portal helpers from existing view data, and AI context derives compact actor/use-case summaries directly from canonical records. Technical metadata and evidence remain available in lower disclosure layers.

**Tech Stack:** Python 3 standard library, `unittest`, inline HTML/CSS/classic JavaScript, existing business knowledge guard and fixed v2 acceptance runner.

**Spec:** `docs/superpowers/specs/2026-08-26-leo-code-to-business-business-first-projections-design.md`

## Global Constraints

- Do not change canonical schema `2.0` or canonical artifact formats.
- Do not substantially restructure `task_context.py` output.
- Keep one offline `site/index.html` with inline CSS and classic JavaScript only.
- Do not add modules, fetch/XHR, service workers, CDNs, remote fonts or network dependencies.
- Keep `site-view-model.json` view schema `2.0`, all fixed view IDs and the exact existing use-case section order.
- Technical evidence and analysis notes must be closed by default.
- Do not call the four modeled use cases the system's four core scenarios or imply complete coverage.
- Preserve canonical hash equality, projection hashes, deterministic output and immutable publication.
- Preserve unrelated working-tree changes in `/Users/pa/project/JZ/utopia-scs-recorder`.

---

### Task 1: Lock Business-First Projection and Compatibility Tests

**Files:**
- Modify: `lib/skills/leo-code-to-business/tests/test_render_business_site.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_site_view_model.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_task_context.py`

**Interfaces:**
- Consumes: `renderer.write_projections(revision_dir)`, `renderer.render_html_site(model)`, `view_model.build_site_view_model(revision)`, `task_context.build_task_context_pack(question, revision)`.
- Produces: failing regression tests that define HTML hierarchy, AI context ordering and compatibility boundaries.

- [ ] **Step 1: Add failing HTML business-portal assertions**

Add tests that assert:

```python
self.assertIn("当前已整理", html)
self.assertIn("业务场景", html)
self.assertIn("查看场景详情", html)
self.assertIn('href="#use-case-UC-create-work-order"', html)
self.assertIn("业务流程", html)
self.assertIn("异常与恢复", html)
self.assertIn("待确认事项", html)
self.assertIn("分析说明", html)
self.assertNotIn("<details open>", html)
self.assertLess(html.index("当前已整理"), html.index("Canonical revision"))
```

Also assert the raw aggregate status is not emitted as the topbar label, and that repository/hash text appears inside the analysis section rather than the overview.

- [ ] **Step 2: Add failing AI business-orientation assertions**

Add tests that assert `ai-context.md` contains and orders:

```python
business_orientation = ai_context.index("## 项目业务定位")
organized_scope = ai_context.index("## 当前已整理范围")
scenarios = ai_context.index("## 已确认业务场景")
development_policy = ai_context.index("## 新需求开发工作法")
file_routing = ai_context.index("## 检索与核验指南")
revision_metadata = ai_context.index("## 修订信息")
self.assertLess(business_orientation, file_routing)
self.assertLess(scenarios, development_policy)
self.assertLess(development_policy, revision_metadata)
self.assertIn("先分析业务影响，再进入代码实现", ai_context)
self.assertIn("不代表系统完整业务全貌", ai_context)
self.assertIn("UC-create-work-order", ai_context)
self.assertLess(len(ai_context), 8000)
```

- [ ] **Step 3: Add compatibility regressions**

Keep and strengthen assertions that:

```python
self.assertEqual(model["view_schema_version"], "2.0")
self.assertEqual(list(model["views"]), list(view_model.FIXED_VIEW_IDS))
self.assertEqual(
    [item["id"] for item in model["views"]["use_case_details"][0]["sections"]],
    list(view_model.USE_CASE_SECTION_IDS),
)
```

In `test_task_context.py`, compare the pack's existing top-level keys against the pre-change contract:

```python
expected = {
    "question", "node_ids", "node_count", "primary_use_case_ids",
    "related_use_case_ids", "rule_ids", "state_ids", "entity_ids",
    "evolution_ids", "evidence_ids", "unknown_ids", "coverage_warnings",
    "retrieval_reasons",
}
self.assertEqual(set(pack), expected)
```

- [ ] **Step 4: Run focused tests and verify expected failure**

Run:

```bash
python3 -m unittest \
  lib.skills.leo-code-to-business.tests.test_render_business_site \
  lib.skills.leo-code-to-business.tests.test_site_view_model \
  lib.skills.leo-code-to-business.tests.test_task_context -v
```

Because the hyphenated package path is not importable as a module, if discovery fails, run:

```bash
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_render_business_site.py' -v
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_site_view_model.py' -v
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_task_context.py' -v
```

Expected: new business-first projection assertions fail against the old renderer; compatibility assertions pass.

- [ ] **Step 5: Commit test contract**

```bash
git add lib/skills/leo-code-to-business/tests/test_render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_site_view_model.py \
  lib/skills/leo-code-to-business/tests/test_task_context.py
git commit -m "test: define business-first projection contract"
```

### Task 2: Render the Offline Business Portal

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/render_business_site.py`
- Test: `lib/skills/leo-code-to-business/tests/test_render_business_site.py`
- Test: `lib/skills/leo-code-to-business/tests/test_site_view_model.py`

**Interfaces:**
- Consumes: unchanged `site_view_model.build_site_view_model(revision)` structure.
- Produces: `render_html_site(model: dict[str, Any]) -> str` with business overview, scenario cards, business-ordered use-case details and collapsed implementation/analysis layers.

- [ ] **Step 1: Add deterministic renderer helpers**

Add small pure helpers in `render_business_site.py`:

```python
def section_by_id(detail: dict[str, Any], section_id: str) -> dict[str, Any]: ...
def section_statements(detail: dict[str, Any], section_id: str) -> list[dict[str, Any]]: ...
def use_case_title_map(views: dict[str, Any]) -> dict[str, str]: ...
def render_statement_list(items: list[dict[str, Any]], empty_state: str = "not_investigated") -> str: ...
```

Helpers preserve input order from the deterministic view model and never heuristically rewrite technical statements.

- [ ] **Step 2: Replace canonical-view navigation with business navigation**

Render fixed links:

```html
<a href="#overview">业务全景</a>
<a href="#business_scenarios">业务场景</a>
<a href="#key_rules">关键规则</a>
<a href="#open_questions">待确认事项</a>
<a href="#analysis_notes">分析说明</a>
```

Keep existing fixed views in `site-view-model.json`; this is only HTML presentation.

- [ ] **Step 3: Build the overview and scenario cards**

The overview must render:

```html
<p class="scope-note">当前已整理 N 个业务场景……本页面不代表系统完整业务全貌。</p>
```

Render capability cards from `views["capability_tree"]`, actor names from use-case summary items, and scenario cards linked to `#use-case-<id>`. Each card displays summary, participants, goal, first available initiation statement and first successful outcome. Missing dimensions use the existing precise empty-state meanings.

- [ ] **Step 4: Regroup use-case detail for business reading**

For each existing `use_case_details` record, render this fixed presentation order without changing the underlying view model:

```text
业务场景与目标       <- summary
参与者与发起条件     <- summary actors + trigger_preconditions
业务流程             <- main_flow
关键规则             <- rules_decisions
业务结果             <- effects + success
异常与恢复           <- rejection_failure + recovery
待确认事项           <- permissions + variants + gaps + evolution where non-empty
实现依据 (closed)    <- evidence plus technical-only statements
```

Do not include `<details open>`.

- [ ] **Step 5: Build aggregate key-rule and open-question sections**

Render deterministic cross-scenario lists from `rule_catalog` and `gap_views`. When a rule or unknown has a related use case discoverable from the current records, link to it; otherwise render the item without inventing a relation.

- [ ] **Step 6: Move analysis metadata to a closed section**

Render snapshot ID, canonical hash, repository path, coverage metrics and empty-state definitions inside:

```html
<section class="analysis" id="analysis_notes">
  <details>
    <summary>查看分析范围与证据说明</summary>
    ...
  </details>
</section>
```

Translate aggregate status into scope language. Do not display raw `partial` as a primary status badge.

- [ ] **Step 7: Replace CSS with the business-portal visual system**

Use a restrained construction/field-document palette and system fonts only:

```css
:root {
  --ink:#18211c; --muted:#667168; --paper:#f3f5f1; --panel:#ffffff;
  --forest:#234d37; --leaf:#4f765d; --clay:#b7653b; --line:#d9dfd8;
  --soft:#e9efe9; --warning:#8a6117;
}
```

The signature element is the business-chain rail: a quiet horizontal/vertical sequence connecting initiation, system action and outcome. Keep the rest visually restrained. Include responsive layout, `:focus-visible`, and reduced-motion behavior.

- [ ] **Step 8: Preserve search and no-script behavior**

Search results display business title and summary first; status/confidence are omitted from visible result copy. Keep implementation aliases in the embedded search index. The `<noscript>` block contains the scenario index and analysis-scope link/content, not a duplicate coverage dashboard as the primary fallback.

- [ ] **Step 9: Run focused tests**

```bash
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_render_business_site.py' -v
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_site_view_model.py' -v
```

Expected: PASS.

- [ ] **Step 10: Commit HTML projection**

```bash
git add lib/skills/leo-code-to-business/scripts/render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_site_view_model.py
git commit -m "feat: render business-first knowledge portal"
```

### Task 3: Render the AI Business Orientation

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/render_business_site.py`
- Test: `lib/skills/leo-code-to-business/tests/test_render_business_site.py`

**Interfaces:**
- Consumes: canonical revision returned by `load_canonical_revision` and existing relationship indexes.
- Produces: `render_ai_context(revision: dict[str, Any]) -> str` ordered around business orientation, modeled scenarios, unknowns, development policy, retrieval guide and final revision metadata.

- [ ] **Step 1: Add compact canonical summary helpers**

Add deterministic helpers for:

```python
def statement_texts(values: Any, limit: int) -> list[str]: ...
def actors_for_use_case(revision: dict[str, Any], use_case_id: str) -> list[str]: ...
def rules_for_use_case(revision: dict[str, Any], use_case_id: str) -> list[dict[str, Any]]: ...
def format_compact_items(values: list[str], fallback: str) -> str: ...
```

Limit each dimension to the minimum useful statements so the representative context remains under 8,000 characters.

- [ ] **Step 2: Rewrite the AI context hierarchy**

Generate headings in this order:

```markdown
# 项目业务导览
## 项目业务定位
## 当前已整理范围
## 参与者与业务目标
## 业务能力地图
## 已确认业务场景
## 跨场景关键规则与生命周期
## 重要待确认事项
## 新需求开发工作法
## 检索与核验指南
## 修订信息
```

Use current canonical facts only. Scope language must explicitly say the current set is not the complete business picture.

- [ ] **Step 3: Add actionable use-case summaries**

For each use case render available participants, goal, initiation, flow, rules, outcome, failure/recovery, unknowns and a stable-ID drill-down line. Omit empty dimensions rather than serializing raw empty arrays.

- [ ] **Step 4: Add the business-impact-first development policy**

Include the exact principle:

```text
先分析业务影响，再进入代码实现。
```

Then list the approved sequence: restate requirement, assess coverage, identify affected business dimensions, preserve current behavior, investigate unknowns, retrieve evidence, plan/implement, derive tests, reassess knowledge updates.

- [ ] **Step 5: Move routing and revision metadata to the end**

Keep canonical files, aliases, IDs, snapshot, repository, status and canonical hash in the final two sections. Preserve enough routing information for AI to retrieve detailed records and source evidence.

- [ ] **Step 6: Run focused tests**

```bash
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_render_business_site.py' -v
```

Expected: PASS and generated fixture `ai-context.md` length below 8,000 characters.

- [ ] **Step 7: Commit AI projection**

```bash
git add lib/skills/leo-code-to-business/scripts/render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py
git commit -m "feat: orient AI context around business behavior"
```

### Task 4: Document, Validate, Synchronize and Republish

**Files:**
- Modify: `lib/skills/leo-code-to-business/references/html-projection.md`
- Modify if required by test wording only: `lib/skills/leo-code-to-business/SKILL.md`
- Create: a new immutable revision under `/Users/pa/project/JZ/utopia-scs-recorder/_leo_business/revisions/`
- Update after validation: `/Users/pa/project/JZ/utopia-scs-recorder/_leo_business/current.json`

**Interfaces:**
- Consumes: completed managed renderer and all existing canonical artifacts from `REV-2fc38640940b9243`.
- Produces: tested managed skill, synchronized central skill and a validated new projection revision with unchanged canonical business facts.

- [ ] **Step 1: Update projection documentation**

Document the two entry points and progressive disclosure contract:

```text
HTML: business overview -> scenario -> use-case detail -> implementation evidence
AI: business orientation -> impact-first requirement analysis -> canonical retrieval -> source evidence
```

State explicitly that the task-context protocol remains unchanged in this iteration.

- [ ] **Step 2: Run the complete skill test suite**

```bash
python3 -m unittest discover -s lib/skills/leo-code-to-business/tests -p 'test_*.py' -v
```

Expected: all tests PASS.

- [ ] **Step 3: Run fixed v2 acceptance**

Use the existing acceptance command documented by `run_v2_acceptance.py`, with its managed fixture/workspace and no changes to the user's target repository. Expected: all fixed acceptance checks PASS and projection hashes validate.

- [ ] **Step 4: Verify deterministic regeneration**

Render the same representative fixture twice and compare SHA-256 of `site-view-model.json`, `site/index.html` and `ai-context.md`. Expected: byte-identical outputs.

- [ ] **Step 5: Commit managed skill changes**

```bash
git add lib/skills/leo-code-to-business
git commit -m "docs: define business-first projection contract"
```

- [ ] **Step 6: Synchronize the central skill**

Use a non-destructive file sync from:

```text
/Users/pa/project/AI/local-ai-gateway/lib/skills/leo-code-to-business/
```

to:

```text
/Users/pa/.agents/skills/leo-code-to-business/
```

Verify file checksums for all managed skill files. Do not delete unrelated central files without first proving they are managed duplicates.

- [ ] **Step 7: Verify Antigravity symlink resolution**

Resolve the Antigravity skill path with `readlink`/`realpath` and verify it reaches `/Users/pa/.agents/skills/leo-code-to-business` or its containing skills directory. Confirm the synchronized renderer checksum is visible through that path.

- [ ] **Step 8: Create a new immutable target revision**

Inspect `/Users/pa/project/JZ/utopia-scs-recorder/_leo_business/current.json` and existing revision naming rules. Copy the existing canonical revision into a newly named revision directory without modifying `REV-2fc38640940b9243`. Remove only copied projection files whose hashes will be regenerated if the guard requires it; preserve canonical artifacts byte-for-byte.

- [ ] **Step 9: Regenerate and validate target projections**

Run the synchronized renderer against the new revision. Validate:

- canonical hash matches the old canonical hash;
- HTML and AI projection hashes are new and recorded;
- guard validation succeeds;
- old revision files and hashes are unchanged;
- target repository's unrelated working-tree files remain unchanged.

- [ ] **Step 10: Update `current.json` atomically after validation**

Point `current.json` to the new validated immutable revision using its existing schema. Do this only after all projection checks pass.

- [ ] **Step 11: Compare old and new projections**

Confirm the new HTML no longer leads with snapshot/hash/status and the new AI context leads with business orientation and development policy. Confirm canonical business records are byte-identical between old and new revisions.

- [ ] **Step 12: Final status and artifact handoff**

Report:

- managed repository commits;
- central skill synchronization result;
- Antigravity symlink verification;
- full test and acceptance results;
- old and new revision IDs and canonical hash;
- new HTML and AI context paths;
- confirmation that unrelated target-repository changes were preserved.
