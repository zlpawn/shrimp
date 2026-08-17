# Leo Code to Business Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the repository-managed `leo-code-to-business` Skill that turns current local source code into evidence-linked business knowledge for AI retrieval and a human-readable offline HTML site.

**Architecture:** The analysis model is the investigator and business translator. Deterministic Python scripts freeze repository snapshots, validate canonical artifacts, enforce coverage and evidence gates, publish immutable revisions, and render AI/HTML projections. `codebase-memory-mcp` and other graph tools are optional accelerators: when present they must be refreshed and checked, and their accepted results must be verified against current source.

**Tech Stack:** Markdown Skill instructions, YAML agent metadata, Python 3 standard library, JSON/JSONL contracts, `unittest`, Git CLI, local repository tools, optional `codebase-memory-mcp`, single-file offline HTML/CSS/JavaScript.

## Global Constraints

- Managed Skill source is `lib/skills/leo-code-to-business`; do not install it into `~/.agents/skills` during implementation.
- Do not modify `gateway.config.json` or any existing Reversa artifacts.
- Current executable source, SQL, schema, and active configuration outrank documents and Git history for current behavior.
- The model-led portable path must pass without `codebase-memory-mcp`; provider absence must not lower completion status.
- When `codebase-memory-mcp` is available, refresh/check it before graph use and verify accepted paths against current source.
- AI and HTML outputs must be generated from the same immutable canonical revision hash.
- Unknown business dimensions are first-class records with completed search envelopes; they may not be silently omitted.
- A controller/service call-chain summary is not sufficient business knowledge.
- The initial realistic benchmark is `/Users/pa/project/JZ/utopia-scs-recorder` at commit `c6893715d0d52477849595e7ed7c8c5ec276f322`.
- Reference-repository tests must use a detached temporary worktree or `git show` materialization and write only to a temporary output root.

---

## File Structure

Create:

```text
lib/skills/leo-code-to-business/
├── SKILL.md
├── agents/openai.yaml
├── references/
│   ├── business-knowledge-model.md
│   ├── business-discovery.md
│   ├── repository-investigation.md
│   ├── optional-code-tools.md
│   ├── java-spring-discovery.md
│   ├── evidence-and-confidence.md
│   ├── coverage-and-completion.md
│   ├── incremental-update.md
│   ├── html-projection.md
│   └── acceptance-scenarios.md
├── schemas/
│   ├── manifest.schema.json
│   ├── common-node.schema.json
│   ├── relationship.schema.json
│   ├── inventory.schema.json
│   ├── capability.schema.json
│   ├── actor.schema.json
│   ├── use-case.schema.json
│   ├── use-case-family.schema.json
│   ├── business-rule.schema.json
│   ├── evidence.schema.json
│   ├── workflow.schema.json
│   ├── state-machine.schema.json
│   ├── domain-event.schema.json
│   ├── entity.schema.json
│   ├── glossary.schema.json
│   ├── alias.schema.json
│   ├── conflict.schema.json
│   ├── unknown.schema.json
│   ├── investigation.schema.json
│   ├── semantic-review.schema.json
│   ├── change-impact.schema.json
│   └── coverage.schema.json
├── scripts/
│   ├── repository_snapshot.py
│   ├── business_knowledge_guard.py
│   └── render_business_site.py
└── tests/
    ├── fixtures/
    │   ├── minimal-repo/
    │   ├── ambiguous-java-repo/
    │   ├── expected/
    │   └── sample-revision/
    ├── test_repository_snapshot.py
    ├── test_business_knowledge_guard.py
    └── test_render_business_site.py
```

Modify:

```text
lib/skills/managed-catalog.json
tests/unit/skills-library.test.mjs
```

Responsibility boundaries:

- `SKILL.md`: concise trigger, modes, workflow, hard gates, and conditional reference loading.
- `references/*.md`: model investigation and business-translation protocol.
- `schemas/*.json`: stable machine-readable artifact contracts.
- `repository_snapshot.py`: current repository identity and file-level freshness.
- `business_knowledge_guard.py`: validation, revision hashing, publication, impact propagation, and status calculation.
- `render_business_site.py`: projections only; it never authors canonical business knowledge.
- `tests/fixtures`: deterministic mechanics and behavioral calibration anchors.

---

### Task 1: Skill Shell, Triggering, and Managed Catalog

**Files:**
- Create: `lib/skills/leo-code-to-business/SKILL.md`
- Create: `lib/skills/leo-code-to-business/agents/openai.yaml`
- Modify: `lib/skills/managed-catalog.json`
- Modify: `tests/unit/skills-library.test.mjs`

**Interfaces:**
- Consumes: gateway managed-skill discovery through `SkillInstaller`.
- Produces: a discoverable managed Skill named exactly `leo-code-to-business`.
- Produces: `SKILL.md` links to every reference using one-level relative paths.

- [ ] **Step 1: Add a failing managed-library test**

Append a test that requires the new Skill to be managed, installable into a temporary home, categorized as research, searchable by Chinese and English business-analysis terms, and complete enough to include its agent metadata and core references:

```js
test("Leo code to business is a managed business-knowledge skill", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "leo-code-business-"));
  try {
    SkillInstaller.ensureManagedSkills(tmpHome);
    const snapshot = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome });
    const skill = snapshot.allSkills.find((item) => item.name === "leo-code-to-business");

    assert.ok(skill);
    assert.equal(skill.managed, true);
    assert.equal(skill.installed, true);
    assert.equal(skill.category, "research");

    for (const query of ["业务知识", "代码转业务", "business knowledge"]) {
      const result = SkillInstaller.buildLibrarySnapshot({ homeDir: tmpHome, query });
      assert.equal(
        result.skills.some((item) => item.name === "leo-code-to-business"),
        true,
        query,
      );
    }

    const installed = path.join(
      tmpHome,
      ".agents",
      "skills",
      "leo-code-to-business",
    );
    for (const relativePath of [
      "SKILL.md",
      "agents/openai.yaml",
      "references/business-knowledge-model.md",
      "references/repository-investigation.md",
      "references/optional-code-tools.md",
    ]) {
      assert.equal(fs.existsSync(path.join(installed, relativePath)), true, relativePath);
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
node --test tests/unit/skills-library.test.mjs
```

Expected: FAIL because `leo-code-to-business` is absent from the managed catalog/source tree.

- [ ] **Step 3: Create the thin Skill contract**

Keep `SKILL.md` between 120 and 180 lines. Its frontmatter must be:

```yaml
---
name: leo-code-to-business
description: Use when a user wants to translate a local code repository into current, evidence-linked business knowledge for AI retrieval and a human-readable offline HTML knowledge site. Reconstruct actors, goals, use-case families, workflows, rules, states, data meaning, external effects, failures, recovery, permissions, unknowns, and conflicts from current source. Trigger for questions such as "工单怎么创建", "工地和视频怎么绑定", "把代码翻译成业务知识", "生成业务知识库", or "code to business". Do not use for a shallow architecture summary, API list, ordinary code review, or interview-only project storytelling.
---
```

The body must contain:

```text
Core objective
Non-negotiable business-first rules
Build / update / query / audit modes
Snapshot-before-analysis rule
Five independent discovery passes
Forward and backward tracing
Use-case-family search
Unknown and conflict discipline
Optional-provider policy
Canonical model before projections
Validation and completion gates
Conditional reference-loading table
```

The optional-provider rule must say:

```text
If codebase-memory-mcp or another code graph is available, use it for discovery after freshness
checks. If unavailable, continue with ordinary local tools. Never confirm a load-bearing business
claim from provider output without reopening current source.
```

- [ ] **Step 4: Create agent metadata**

Use:

```yaml
interface:
  display_name: "Leo 代码转业务知识"
  short_description: "从当前代码还原可追溯业务知识，并生成 AI 与离线 HTML 知识库"
  default_prompt: "Use $leo-code-to-business to reconstruct the current repository's business knowledge from source evidence and publish both AI-readable artifacts and a human-readable offline HTML site."

policy:
  allow_implicit_invocation: true
```

- [ ] **Step 5: Register the Skill in the managed catalog**

Add an entry with:

```json
{
  "id": "leo-code-to-business",
  "name": "leo-code-to-business",
  "title": "Leo 代码转业务知识",
  "summary": "从当前代码、配置、测试、SQL 与 Git 证据中还原角色、业务用例族、流程、规则、状态、数据含义、异常、补偿和未知项，并生成 AI 可读知识与离线 HTML 站点。",
  "category": "research",
  "categoryLabel": "研究与知识",
  "icon": "🧩",
  "featured": false,
  "tags": [
    "business knowledge",
    "code to business",
    "业务知识",
    "代码转业务",
    "业务规则"
  ],
  "requiresDaemon": false,
  "promoted": true,
  "managed": true
}
```

Preserve every existing catalog entry and update only the catalog timestamp plus the new entry.

- [ ] **Step 6: Create the referenced files as real non-empty contracts**

Create each reference with a title, purpose, mandatory outputs, and completion gate. Do not leave
empty placeholders. Detailed content is filled in Task 4.

- [ ] **Step 7: Validate and rerun the managed-library test**

Run:

```bash
python3 /Users/pa/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  lib/skills/leo-code-to-business
node --test tests/unit/skills-library.test.mjs
```

Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/SKILL.md \
  lib/skills/leo-code-to-business/agents/openai.yaml \
  lib/skills/leo-code-to-business/references \
  lib/skills/managed-catalog.json \
  tests/unit/skills-library.test.mjs
git commit -m "feat: add leo code to business skill shell"
```

---

### Task 2: Repository Snapshot and Freshness

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/repository_snapshot.py`
- Create: `lib/skills/leo-code-to-business/tests/test_repository_snapshot.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/minimal-repo/README.md`
- Create: `lib/skills/leo-code-to-business/schemas/manifest.schema.json`

**Interfaces:**
- Produces: `capture_snapshot(repo_root: Path, exclusions: list[str]) -> dict`.
- Produces: `compare_snapshot(previous: dict, current: dict) -> dict`.
- CLI:

```text
repository_snapshot.py capture --repo <path> --output <snapshot.json> [--exclude <glob>...]
repository_snapshot.py compare --before <snapshot.json> --repo <path> --output <change.json>
```

- Snapshot fields:

```text
schema_version
snapshot_id
captured_at
repository_root
canonical_root
git.is_repository
git.branch
git.head_sha
git.base_sha
git.is_detached
git.status_porcelain
working_tree_dirty
files[path, sha256, size, mtime_ns]
exclusions
snapshot_sha256
```

- [ ] **Step 1: Write failing snapshot tests**

Cover clean capture, uncommitted changes, content changes that keep the same Git HEAD, added/deleted
files, exclusions, stable canonical hashes, and no writes into the analyzed repository:

```python
def test_dirty_file_changes_snapshot_without_head_change(self):
    before = snapshot.capture_snapshot(self.repo, exclusions=[])
    (self.repo / "src" / "Order.java").write_text("class Order { int v = 2; }\n")
    after = snapshot.capture_snapshot(self.repo, exclusions=[])

    self.assertEqual(before["git"]["head_sha"], after["git"]["head_sha"])
    self.assertNotEqual(before["snapshot_sha256"], after["snapshot_sha256"])
    diff = snapshot.compare_snapshot(before, after)
    self.assertEqual(diff["modified"], ["src/Order.java"])
```

```python
def test_excluded_business_output_is_not_hashed(self):
    (self.repo / "_leo_business").mkdir()
    (self.repo / "_leo_business" / "current.json").write_text("{}")
    result = snapshot.capture_snapshot(
        self.repo,
        exclusions=["_leo_business/**"],
    )
    self.assertNotIn("_leo_business/current.json", result["files"])
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_repository_snapshot.py -v
```

Expected: FAIL because the snapshot module does not exist.

- [ ] **Step 3: Implement deterministic snapshot capture**

Implementation rules:

- use `git -C <repo> rev-parse`, `symbolic-ref`, and `status --porcelain=v1 -z`;
- hash regular files with SHA-256;
- skip `.git/**`, `_leo_business/**`, configured exclusions, symlinks escaping the root, and
  unreadable files while recording diagnostics;
- sort paths before canonical serialization;
- compute `snapshot_sha256` without `captured_at` and `mtime_ns`;
- write output atomically using `os.replace`;
- never run a build or modify target files.

- [ ] **Step 4: Define the manifest schema**

Require:

```json
{
  "schema_version": "1.0",
  "run_id": "RUN-...",
  "mode": "build",
  "status": "initialized",
  "repository_snapshot": {},
  "canonical_revision_sha256": null,
  "projection_hashes": {},
  "provider_observations": [],
  "coverage_status": "partial"
}
```

Allowed modes: `build`, `update`, `query`, `audit`.

Allowed terminal statuses: `passed`, `partial`, `blocked`, plus the stage states defined by the
design.

- [ ] **Step 5: Add CLI tests and pass the suite**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_repository_snapshot.py -v
python3 lib/skills/leo-code-to-business/scripts/repository_snapshot.py \
  capture \
  --repo /Users/pa/project/AI/local-ai-gateway \
  --exclude "_leo_business/**" \
  --output /tmp/leo-code-to-business-snapshot.json
```

Expected: tests PASS and the output contains the current repository HEAD plus a non-empty file map.

- [ ] **Step 6: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/repository_snapshot.py \
  lib/skills/leo-code-to-business/tests/test_repository_snapshot.py \
  lib/skills/leo-code-to-business/tests/fixtures/minimal-repo \
  lib/skills/leo-code-to-business/schemas/manifest.schema.json
git commit -m "feat: add repository freshness snapshots"
```

---

### Task 3: Canonical Knowledge Contracts and Deterministic Guard

**Files:**
- Create: all remaining files under `lib/skills/leo-code-to-business/schemas/`
- Create: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Create: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision/`

**Interfaces:**
- Produces:

```python
canonical_sha256(value: Any) -> str
validate_revision(revision_dir: Path) -> dict
calculate_coverage(revision_dir: Path) -> dict
calculate_status(validation: dict, semantic_review: dict) -> str
mark_change_impact(revision_dir: Path, change_set: dict) -> dict
publish_revision(run_dir: Path, workspace_root: Path) -> dict
```

- CLI:

```text
business_knowledge_guard.py init
business_knowledge_guard.py validate-inventory
business_knowledge_guard.py validate-model
business_knowledge_guard.py validate-evidence
business_knowledge_guard.py validate-investigations
business_knowledge_guard.py validate-semantic-review
business_knowledge_guard.py validate-coverage
business_knowledge_guard.py mark-impact
business_knowledge_guard.py validate-projections
business_knowledge_guard.py publish
business_knowledge_guard.py audit
```

- [ ] **Step 1: Write failing contract tests**

Tests must reject:

```text
inventory items without exactly one classification
relationships to missing IDs
semantic nodes containing duplicate foreign-ID fields
confirmed/E3 claims without current-source evidence
unknowns without searched evidence
investigation records without queries or inspected files/symbols
truncated investigation results marked complete
confirmed use cases without actor, goal, trigger, flow, outcome, and evidence
missing required semantic dimension without a has_unknown relationship
HTML/AI projections with a different canonical hash
semantic review performed against an older revision hash
current.json updates before validation succeeds
```

Example:

```python
def test_confirmed_rule_requires_verified_current_source(self):
    revision = self.copy_fixture("sample-revision")
    rule = self.read_jsonl(revision / "business-rules.jsonl")[0]
    rule["claim_status"] = "confirmed"
    rule["confidence"] = "E3"
    self.write_jsonl(revision / "business-rules.jsonl", [rule])
    self.remove_relationship(
        revision,
        from_id=rule["id"],
        relationship_type="evidenced_by",
    )

    with self.assertRaisesRegex(guard.ValidationError, "confirmed rule.*evidence"):
        guard.validate_revision(revision)
```

Example unknown search gate:

```python
def test_unknown_requires_completed_search_envelope(self):
    unknown = self.read_jsonl(self.revision / "unknowns.jsonl")[0]
    unknown["searched_evidence"] = []
    unknown["search_status"] = "not_started"
    self.write_jsonl(self.revision / "unknowns.jsonl", [unknown])

    with self.assertRaisesRegex(guard.ValidationError, "unknown.*search"):
        guard.validate_revision(self.revision)
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: FAIL because guard and schemas are absent.

- [ ] **Step 3: Implement common contracts**

Every semantic node requires:

```text
id
title
summary
claim_status
lifecycle_status
confidence
source_snapshot
semantic_revision
created_at
updated_at
```

Use exactly:

```text
claim_status:
confirmed | inferred | document_claim | historical | conflicted | unknown

lifecycle_status:
active | conditional | stale | invalidated | expired

confidence:
E3 | E2 | E1 | E0
```

`relationships.jsonl` is the only authoritative cross-node relationship source. Reject duplicated
fields such as `actor_ids`, `rule_ids`, `evidence_ids`, `capability_id`, and
`related_use_case_ids`.

- [ ] **Step 4: Implement evidence, investigation, unknown, and use-case gates**

Evidence records require:

```text
id
source_kind
repository_relative_path
symbol
start_line
end_line
content_sha256
snapshot_id
observation
provider
source_verified
```

Investigation records require:

```text
id
question_or_node_id
investigation_kind
provider
provider_version
queries
scope
files_and_symbols_inspected
candidate_results
accepted_results
rejected_results_and_reason
truncated
source_verified
repository_snapshot
completed_at
```

Required investigation kinds for a confirmed use case:

```text
vocabulary_expansion
entry_search
forward_trace
backward_trace
alternate_entry_search
rule_search
contradiction_search
source_verification
```

Unknowns require `question`, `importance`, `reason`, `search_status=completed`,
`searched_evidence`, and a `has_unknown` relationship from the exact missing semantic dimension.

- [ ] **Step 5: Implement coverage and status calculation**

Calculate independent denominators for:

```text
entry classification
business entry mapping
investigation signals
rule evidence
mutation/state/external-effect anchors
condition and branch anchors
scenario coverage
state transition coverage
projection integrity
```

`passed` requires:

```text
all mechanical validation passes
entry classification == 1.0
business entry mapping == 1.0
discovered anchor mapping == 1.0
required investigations == 1.0
no unexplained business entry
no invalid confirmed/E3 claim
semantic review hashes match
no required semantic dimension is absent without a searched unknown
```

Otherwise return `partial` when useful validated artifacts exist, or `blocked` when snapshot,
canonical integrity, or publication prerequisites fail.

- [ ] **Step 6: Implement immutable publication**

Publication sequence:

```text
runs/<run-id>/staging-artifacts
-> validate canonical artifacts
-> calculate canonical revision hash
-> write manifest and projection expectations
-> atomically move to revisions/<revision-id>
-> atomically replace current.json
```

Never mutate a published revision. Refuse publication if `current.json` would point to an invalid or
missing revision.

- [ ] **Step 7: Run all guard tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/schemas \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision
git commit -m "feat: enforce business knowledge contracts"
```

---

### Task 4: Model Investigation and Business Translation References

**Files:**
- Modify: `lib/skills/leo-code-to-business/SKILL.md`
- Modify: every file under `lib/skills/leo-code-to-business/references/`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/ambiguous-java-repo/`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/expected/investigation-requirements.json`

**Interfaces:**
- Consumes: repository snapshot and canonical schemas.
- Produces: exact model procedure for creating `inventory.jsonl`, `investigations.jsonl`, business
  nodes, relationships, evidence, unknowns, conflicts, and semantic review.
- Produces: provider-neutral tool policy and a concrete `codebase-memory-mcp` freshness protocol.

- [ ] **Step 1: Write a failing static Skill-contract test**

Add tests to `test_business_knowledge_guard.py` that read `SKILL.md` and references and require:

```python
def test_skill_requires_bidirectional_business_investigation(self):
    text = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    for required in [
        "business knowledge",
        "forward trace",
        "backward trace",
        "use-case family",
        "unknown",
        "current source",
        "codebase-memory-mcp",
    ]:
        self.assertIn(required, text.lower())

def test_optional_tool_reference_never_makes_mcp_required(self):
    text = (SKILL_DIR / "references" / "optional-code-tools.md").read_text()
    self.assertIn("optional", text.lower())
    self.assertIn("index_status", text)
    self.assertIn("index_repository", text)
    self.assertIn("working-tree", text.lower())
    self.assertIn("source verification", text.lower())
    self.assertNotIn("cannot pass without codebase-memory-mcp", text.lower())
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: FAIL until references contain the full contracts.

- [ ] **Step 3: Complete `repository-investigation.md`**

Define the eight mandatory investigation kinds and exact completion evidence. Include tool-neutral
examples:

```text
entry search:
route annotations, consumers, listeners, schedulers, callbacks, CLI, batch, operations

forward trace:
trigger -> validation -> decision -> orchestration -> mutation -> external effect
-> success/failure -> retry/compensation

backward trace:
table/entity/state write, external API, event, index sync, terminal result -> all reachable entries

alternate-entry search:
shared noun, identifier, table/entity, state, external operation, event, error, or business goal
```

Require the model to log exact search queries, inspected files/symbols, rejected candidates, and
truncation handling. A search with truncated results is incomplete until narrowed or marked partial.

- [ ] **Step 4: Complete `optional-code-tools.md`**

Define provider order as:

```text
1. Use available graph/MCP/LSP tools for discovery.
2. Use ordinary local search and direct file reads for independent investigation.
3. Verify every accepted load-bearing path and rule in current source.
4. Record provider disagreements as conflicts or investigation tasks.
```

For `codebase-memory-mcp`, require:

```text
discover availability
read index_status
compare canonical path, ready status, branch, HEAD/base SHA
run index_repository before substantial graph use
wait for ready
record observable watch state without trusting it as freshness proof
use search_graph / trace_path / get_code_snippet for candidates
reopen current source
recheck HEAD and working-tree fingerprint before publication
fallback when provider refresh fails
```

Make explicit that near-real-time watching is eventual consistency and that a matching HEAD does not
cover uncommitted changes.

- [ ] **Step 5: Complete `business-discovery.md` and `business-knowledge-model.md`**

Require every confirmed use case to answer:

```text
who acts
what goal is pursued
what triggers it
what preconditions apply
what the main business stages are
which decisions and rules change behavior
what data and state change
what external effects occur
what success means
why it is rejected or fails
how retry, compensation, cancellation, or manual repair works
which role/tenant/ownership boundary applies
what remains unknown
```

Ban:

```text
method-name translation presented as business knowledge
framework/component inventories presented as capabilities
one-controller answers where alternate entries or reverse writers exist
document claims promoted over current code
generic permissions, idempotency, validation, or failure behavior invented from convention
```

- [ ] **Step 6: Complete Java/Spring calibration**

`java-spring-discovery.md` must teach search locations without becoming a parser dependency:

```text
mapping annotations and class/method route composition
custom composed annotations
controllers, services, providers, handlers, strategies
Feign/HTTP clients and SDKs
mapper/repository interfaces, XML/SQL, update wrappers
status writes, constants, enums, guards, validation
events, schedules, listeners, consumers
profiles, properties, tenant and role context
tests, mocks, assertions, expected failures
operations, repair, relink, migration, and batch code
```

Reflection, AOP, dynamic proxies, generated code, remote config, dynamic SQL, and runtime-created
routes must become explicit limitations when unresolved.

- [ ] **Step 7: Complete evidence, coverage, update, HTML, and acceptance references**

Keep each reference focused:

```text
evidence-and-confidence.md:
source authority, E0-E3, current-source hashes, conflict handling

coverage-and-completion.md:
independent denominators, partial/blocked rules, semantic rubric

incremental-update.md:
snapshot comparison, impact propagation, stale invalidation, targeted reanalysis

html-projection.md:
single file, file://, no network, business-first navigation, embedded evidence

acceptance-scenarios.md:
work-order creation and construction-site/video binding benchmark expectations
```

- [ ] **Step 8: Add ambiguous investigation fixtures**

Create a small Java fixture with:

```text
one route
an interface with two implementations
one exact injected implementation
one unresolved dynamic dispatch
one persistence write
one reverse-only operational entry
one state guard
one external client
one misleading stale document
```

`investigation-requirements.json` must state which facts can be confirmed and which must remain
inferred/unknown. It must not encode a specific provider or search command.

- [ ] **Step 9: Validate references and tests**

Run:

```bash
python3 /Users/pa/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  lib/skills/leo-code-to-business
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/SKILL.md \
  lib/skills/leo-code-to-business/references \
  lib/skills/leo-code-to-business/tests/fixtures/ambiguous-java-repo \
  lib/skills/leo-code-to-business/tests/fixtures/expected/investigation-requirements.json \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py
git commit -m "feat: define evidence driven business investigation"
```

---

### Task 5: AI and Single-File HTML Projections

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/render_business_site.py`
- Create: `lib/skills/leo-code-to-business/tests/test_render_business_site.py`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision/`

**Interfaces:**
- Produces:

```python
load_canonical_revision(revision_dir: Path) -> dict
render_ai_context(revision: dict) -> str
render_html_site(revision: dict) -> str
write_projections(revision_dir: Path) -> dict
```

- CLI:

```text
render_business_site.py render --revision <revision-dir>
```

- Output:

```text
<revision>/ai-context.md
<revision>/site/index.html
```

- [ ] **Step 1: Write failing projection tests**

Require:

```python
def test_ai_and_html_share_canonical_hash(self):
    result = renderer.write_projections(self.revision)
    self.assertEqual(result["ai"]["canonical_sha256"], result["html"]["canonical_sha256"])

def test_html_is_file_protocol_safe(self):
    html = (self.revision / "site" / "index.html").read_text()
    self.assertNotIn('type="module"', html)
    self.assertNotRegex(html, r"\bfetch\s*\(")
    self.assertNotIn("http://", html)
    self.assertNotIn("https://", html)
    self.assertIn('<script id="business-knowledge-data" type="application/json">', html)
    self.assertIn("<noscript>", html)
```

Also require HTML escaping of `</script>`, search aliases, unknown display, evidence expansion,
hash-route targets, and business-first headings.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py -v
```

Expected: FAIL because renderer is absent.

- [ ] **Step 3: Implement canonical loading**

Read only validated canonical files. Build in-memory indexes for relationships, aliases, evidence,
unknowns, and use-case-family members. Refuse to render when guard validation fails.

- [ ] **Step 4: Render compact AI context**

`ai-context.md` must contain:

```text
snapshot and revision status
capability index
which canonical files answer which question types
alias resolution guidance
evidence/confidence policy
unknown/conflict policy
recommended business-answer shape
```

Do not duplicate every use case or rule.

- [ ] **Step 5: Render the offline HTML site**

Required views:

```text
Overview
Capabilities
Use cases
Rules
States
Events
Glossary
Unknowns and conflicts
Coverage
Evidence
```

Use case details must lead with actor, goal, trigger, workflow, decisions, outcomes, failures,
variants, and unknowns. Technical traces are expandable supporting evidence.

The generated document must:

```text
work from file://
use hash navigation
embed escaped canonical search data
use inline CSS and classic JavaScript
contain no fetch/XHR/service worker/CDN/remote font
preserve overview, coverage, and use-case index under noscript
```

- [ ] **Step 6: Add projection integrity to the guard**

`validate-projections` must compare:

```text
canonical revision hash
AI projection hash
HTML projection hash
referenced node IDs
embedded search-record count
current.json projection paths
```

- [ ] **Step 7: Run tests and open the fixture site**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py -v
python3 lib/skills/leo-code-to-business/scripts/render_business_site.py \
  render \
  --revision lib/skills/leo-code-to-business/tests/fixtures/sample-revision
```

Then open the absolute `file://` path in Chromium using the available browser-control tool and verify:

```text
search works
hash deep links work after refresh
unknowns are visible
evidence expands
no network request is attempted
mobile and desktop layouts do not overlap
```

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/render_business_site.py \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision
git commit -m "feat: render business knowledge for ai and people"
```

---

### Task 6: Update, Query, Audit, and Optional MCP Freshness Behavior

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/scripts/repository_snapshot.py`
- Modify: `lib/skills/leo-code-to-business/references/incremental-update.md`
- Modify: `lib/skills/leo-code-to-business/references/optional-code-tools.md`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_repository_snapshot.py`

**Interfaces:**
- Produces:

```python
compute_direct_impacts(change_set: dict, evidence_index: dict) -> set[str]
propagate_impacts(node_ids: set[str], relationships: list[dict]) -> set[str]
invalidate_stale_claims(revision: dict, impacted_ids: set[str]) -> dict
build_query_gap(question: str, revision: dict) -> dict
```

- Provider observation shape:

```text
provider
available
version
project
canonical_root
status
indexed_branch
indexed_head_sha
indexed_base_sha
watch_state
refresh_requested
refresh_result
checked_at
source_verification_required
```

- [ ] **Step 1: Write failing update and provider-policy tests**

Cover:

```text
same HEAD but changed working-tree file invalidates evidence
deleted evidence makes dependent confirmed claims stale
impact propagation reaches use case, family, capability, projections, and acceptance answer
cycles terminate
query with insufficient knowledge creates targeted investigation requirements
provider unavailable does not block
provider stale requires refresh before use
provider ready still requires source verification
repository changes during analysis invalidate the frozen review
```

Example:

```python
def test_missing_optional_provider_does_not_block(self):
    observation = {
        "provider": "codebase-memory-mcp",
        "available": False,
        "source_verification_required": True,
    }
    status = guard.provider_readiness([observation])
    self.assertEqual(status["portable_baseline_allowed"], True)
    self.assertEqual(status["blocking_errors"], [])
```

```python
def test_matching_head_does_not_hide_dirty_worktree(self):
    before = self.snapshot()
    self.edit_tracked_source_without_commit()
    after = self.snapshot()
    self.assertEqual(before["git"]["head_sha"], after["git"]["head_sha"])
    self.assertNotEqual(before["snapshot_sha256"], after["snapshot_sha256"])
    self.assertTrue(guard.review_is_stale(before, after))
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_repository_snapshot.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: FAIL for missing impact/provider behavior.

- [ ] **Step 3: Implement fixed-point impact propagation**

Use the relationship impact policy from the design. Visit each node once and continue until no new
impacted nodes are found. Shared route prefixes, state enums, schemas, authorization/configuration,
and cross-cutting clients force capability-level reanalysis.

- [ ] **Step 4: Implement stale-claim invalidation**

Changed or deleted evidence must prevent `confirmed/E3`. Preserve the old claim in the new revision
with `lifecycle_status=stale` or `invalidated` until the model reanalyzes it.

- [ ] **Step 5: Implement query-gap records**

A query that canonical artifacts cannot answer must return a machine-readable gap:

```json
{
  "question": "工地和视频还有哪些绑定入口？",
  "missing_dimensions": ["variants", "backward_trace"],
  "required_investigations": [
    "alternate_entry_search",
    "backward_trace",
    "source_verification"
  ],
  "status": "reanalyze_before_answer"
}
```

The Skill instructions must require targeted reanalysis before final prose.

- [ ] **Step 6: Implement provider freshness recording**

The deterministic scripts do not call MCP directly. They validate and persist observations supplied
by the model/tool layer. A provider may be used only when:

```text
available == true
status == ready
canonical_root matches
refresh_requested == true for this run
refresh_result == ready
```

Even then, `source_verification_required` remains true. If these fields fail, ignore provider edges
and continue with the portable baseline.

- [ ] **Step 7: Run tests**

Run:

```bash
python3 -m unittest discover \
  -s lib/skills/leo-code-to-business/tests \
  -p "test_*.py" \
  -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts \
  lib/skills/leo-code-to-business/references/incremental-update.md \
  lib/skills/leo-code-to-business/references/optional-code-tools.md \
  lib/skills/leo-code-to-business/tests
git commit -m "feat: add business knowledge update and audit gates"
```

---

### Task 7: Behavioral Calibration and Real Repository Acceptance

**Files:**
- Modify: `lib/skills/leo-code-to-business/references/acceptance-scenarios.md`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/expected/utopia-work-order.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/expected/utopia-video-binding.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/expected/semantic-rubric.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/expected/prohibited-claims.json`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`

**Interfaces:**
- Consumes: a canonical revision generated by running the Skill against the pinned repository.
- Produces: deterministic benchmark validation plus independent semantic-review records.
- Benchmark CLI:

```text
business_knowledge_guard.py benchmark \
  --revision <revision-dir> \
  --expectations <expected-dir> \
  --scenario <work-order|video-binding>
```

- [ ] **Step 1: Encode benchmark expectations outside model output**

For work-order creation require stable semantic keys for:

```text
POST /construction/site/work-order/add
ConstructionSiteController.addWorkOrder
ConstructionSiteRectificationService.addWorkOrder
ArtisanWorkOrderProvider.addWorkOrder
workOrderApi.addWorkOrder2
projectId identifies target project order
publisher/operator derive from the construction-site inspector
project order type HOME2
work-order type TODO
images joined with commas
planned completion from input
external work-order system performs creation
empty/failed external response returns false and records error
```

Require searched unknowns unless new current-source evidence proves:

```text
authorization
missing-site behavior
duplicate prevention
image constraints
plan-time validation
```

For video binding require:

```text
POST /app/video/relate
explicit tenant overrides context tenant
dedup key projectId + acceptanceNode
rapid duplicate rejected
LINJING selects 3D/head-mounted branch
other devices select normal/ear-mounted branch
folder-wide expansion in the evidenced branch
binding writes project, node, address, foreman, inspector, operator, status, time
database update followed by ES/index synchronization
```

Require all family candidates represented as confirmed, inferred, or unresolved:

```text
normal application binding
3D binding
uploaded-video binding
pending-upload binding
WXON binding
precheck/status check
unbind
operational relink
```

- [ ] **Step 2: Add failing benchmark tests**

Tests must reject:

```text
one-controller-only video answer
missing use-case-family candidates
invented prohibited work-order claims
technical call chain without actor/goal/outcome
confirmed rule without source evidence
semantic review total below 13/16
any semantic dimension scored 0
```

- [ ] **Step 3: Run the portable baseline in an isolated repository snapshot**

Create a detached temporary worktree:

```bash
SOURCE=/Users/pa/project/JZ/utopia-scs-recorder
WORKTREE=$(mktemp -d /tmp/leo-c2b-utopia.XXXXXX)
OUTPUT=$(mktemp -d /tmp/leo-c2b-output.XXXXXX)
git -C "$SOURCE" worktree add --detach "$WORKTREE" \
  c6893715d0d52477849595e7ed7c8c5ec276f322
```

Run the Skill with optional providers disabled. The model must:

```text
capture the snapshot
create inventory and investigation ledgers
reconstruct both acceptance domains
generate canonical artifacts
run guard validation
render AI and HTML projections
run the semantic rubric in a fresh review context
publish only into "$OUTPUT"
```

Do not write `_leo_business/` into the reference worktree.

- [ ] **Step 4: Validate the portable baseline**

Run:

```bash
python3 lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  benchmark \
  --revision "$OUTPUT/current-revision" \
  --expectations lib/skills/leo-code-to-business/tests/fixtures/expected \
  --scenario work-order

python3 lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  benchmark \
  --revision "$OUTPUT/current-revision" \
  --expectations lib/skills/leo-code-to-business/tests/fixtures/expected \
  --scenario video-binding
```

Expected: both PASS. If either fails, revise the Skill/reference protocol rather than adding the
missing business answer directly to `SKILL.md`.

- [ ] **Step 5: Run the optional MCP path**

Only when `codebase-memory-mcp` is available:

```text
record index_status
request index_repository refresh
wait for ready
use graph search/trace for candidates
verify accepted paths in the detached current source
record provider observation and disagreements
rerun benchmark
```

Expected:

```text
same business acceptance result
provider absence remains non-blocking
provider use does not create unsupported E3 claims
freshness fields are present
source_verified is true for accepted load-bearing paths
```

- [ ] **Step 6: Test incremental change behavior**

In the temporary worktree, edit one source rule without committing. Run update mode and verify:

```text
Git HEAD is unchanged
snapshot hash changes
dependent rule/use case becomes stale or is reanalyzed
old semantic review becomes invalid
new AI and HTML projections share the new canonical hash
```

- [ ] **Step 7: Run full verification**

Run:

```bash
python3 /Users/pa/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  lib/skills/leo-code-to-business

python3 -m unittest discover \
  -s lib/skills/leo-code-to-business/tests \
  -p "test_*.py" \
  -v

node --test tests/unit/skills-library.test.mjs

git diff --check
git status --short
```

Expected:

```text
all tests pass
only intended Skill/catalog/test files are changed
gateway.config.json remains untouched and unstaged
reference repository contains no new or modified files after worktree removal
```

- [ ] **Step 8: Remove temporary worktrees and outputs**

```bash
git -C /Users/pa/project/JZ/utopia-scs-recorder worktree remove "$WORKTREE" --force
rm -rf "$OUTPUT"
```

Confirm the original reference repository status is unchanged.

- [ ] **Step 9: Commit**

```bash
git add \
  lib/skills/leo-code-to-business \
  lib/skills/managed-catalog.json \
  tests/unit/skills-library.test.mjs
git commit -m "test: calibrate code to business knowledge extraction"
```

---

## Final Verification Checklist

- [ ] `SKILL.md` remains 120-180 lines and contains no large schema/example dump.
- [ ] The portable model-led path passes without `codebase-memory-mcp`.
- [ ] The optional MCP path refreshes, records freshness, and reopens current source.
- [ ] Work-order creation is explained as business behavior, not only a four-method call chain.
- [ ] Video binding includes the complete use-case family or explicit searched unresolved members.
- [ ] Every confirmed rule and load-bearing path resolves to current-source evidence.
- [ ] Every missing business dimension has a searched unknown.
- [ ] AI and HTML projections share one canonical revision hash.
- [ ] The generated HTML works from `file://` with no network dependency.
- [ ] Dirty-working-tree changes invalidate stale reviews even when Git HEAD is unchanged.
- [ ] Existing Reversa artifacts and `gateway.config.json` remain untouched.
