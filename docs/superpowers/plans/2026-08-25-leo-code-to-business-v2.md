# Leo Code to Business v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `leo-code-to-business` into a deterministic, evidence-linked legacy-project business knowledge system that prevents silent use-case omission, renders a stable human site, and reconstructs verified business evolution from Git history.

**Architecture:** Keep the existing public CLI scripts as compatibility entry points, but extract shared v2 contracts into focused modules for canonical hashing and IDs, repository signal discovery, candidate/coverage validation, history analysis, migration, and site view-model generation. Models continue authoring business semantics; deterministic Python code owns discovery denominators, stable identities, conservation, hashes, release statuses, and projections.

**Tech Stack:** Python 3 standard library, JSON/JSONL schemas, `unittest`, Git CLI, Markdown skill references, inline offline HTML/CSS/classic JavaScript.

**Spec:** `docs/superpowers/specs/2026-08-25-leo-code-to-business-v2-design.md`

## Global Constraints

- Managed skill source is `lib/skills/leo-code-to-business`; do not edit the installed copy under `~/.agents/skills`.
- Preserve v1 revision validation, publication, query-gap, and benchmark behavior while adding schema-version routing.
- Current executable source, SQL, schema, and active configuration outrank tests, history, documents, commit messages, and inference.
- Commit messages never independently confirm a business change or business reason.
- No discovered observation, signal, candidate, critical write/state/effect/event, or omission-audit finding may disappear from its denominator.
- New v2 candidate identity is derived only from `repository_lineage_id + seed_signal_id`; later provenance and model wording must not change it.
- `coverage.json`, semantic review, omission audit, manifest, AI output, view model, and HTML are excluded from the canonical semantic hash.
- Input JSON/JSONL record order must not affect the v2 canonical hash, view-model bytes, or HTML bytes.
- The site remains a single file-protocol-safe HTML file with no modules, fetch/XHR, service worker, CDN, remote font, or network dependency.
- Current and history coverage statuses are independent; aggregate status follows the precedence defined in the spec.
- Reference and acceptance repositories are read-only evidence sources; all generated output goes to temporary external workspaces.
- Use TDD for every task and commit after each independently testable deliverable.

---

## File Structure

Create:

```text
lib/skills/leo-code-to-business/scripts/business_contract.py
lib/skills/leo-code-to-business/scripts/discover_repository_signals.py
lib/skills/leo-code-to-business/scripts/discovery/__init__.py
lib/skills/leo-code-to-business/scripts/discovery/core.py
lib/skills/leo-code-to-business/scripts/discovery/java_spring.py
lib/skills/leo-code-to-business/scripts/discovery/node_typescript.py
lib/skills/leo-code-to-business/scripts/site_view_model.py
lib/skills/leo-code-to-business/scripts/git_business_history.py
lib/skills/leo-code-to-business/scripts/migrate_business_revision.py
lib/skills/leo-code-to-business/scripts/task_context.py
lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py
lib/skills/leo-code-to-business/schemas/discovery-observation.schema.json
lib/skills/leo-code-to-business/schemas/use-case-candidate.schema.json
lib/skills/leo-code-to-business/schemas/legacy-signal-alias.schema.json
lib/skills/leo-code-to-business/schemas/historical-claim.schema.json
lib/skills/leo-code-to-business/schemas/git-commit.schema.json
lib/skills/leo-code-to-business/schemas/git-change-fact.schema.json
lib/skills/leo-code-to-business/schemas/business-evolution-event.schema.json
lib/skills/leo-code-to-business/schemas/lineage-link.schema.json
lib/skills/leo-code-to-business/schemas/omission-audit.schema.json
lib/skills/leo-code-to-business/schemas/site-view-model.schema.json
lib/skills/leo-code-to-business/tests/test_business_contract.py
lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py
lib/skills/leo-code-to-business/tests/test_site_view_model.py
lib/skills/leo-code-to-business/tests/test_git_business_history.py
lib/skills/leo-code-to-business/tests/test_migrate_business_revision.py
lib/skills/leo-code-to-business/tests/test_task_context.py
lib/skills/leo-code-to-business/tests/test_v2_acceptance.py
lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/package.json
lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/server.ts
lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/orders.ts
lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/jobs.ts
lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/events.ts
lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/cli.ts
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/pom.xml
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderController.java
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderService.java
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderRepository.java
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderEvents.java
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderRepairJob.java
lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/PaymentClient.java
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/manifest.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/ai-context.md
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/site-view-model.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/site/index.html
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/inventory.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/discovery-observations.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-candidates.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/legacy-signal-aliases.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/capabilities.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/actors.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-families.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-cases.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-rules.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/workflows.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/state-machines.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/domain-events.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/entities.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/glossary.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/aliases.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/relationships.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/investigations.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/evidence.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/conflicts.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/unknowns.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-commits.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-change-facts.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/historical-claims.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-evolution-events.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/lineage-links.jsonl
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/omission-audit.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/semantic-review.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/coverage.json
lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/change-impact.json
lib/skills/leo-code-to-business/tests/fixtures/real-git-history.bundle
lib/skills/leo-code-to-business/tests/fixtures/real-git-history-expected.json
```

Modify:

```text
lib/skills/leo-code-to-business/SKILL.md
lib/skills/leo-code-to-business/references/business-knowledge-model.md
lib/skills/leo-code-to-business/references/business-discovery.md
lib/skills/leo-code-to-business/references/repository-investigation.md
lib/skills/leo-code-to-business/references/coverage-and-completion.md
lib/skills/leo-code-to-business/references/evidence-and-confidence.md
lib/skills/leo-code-to-business/references/incremental-update.md
lib/skills/leo-code-to-business/references/html-projection.md
lib/skills/leo-code-to-business/references/java-spring-discovery.md
lib/skills/leo-code-to-business/references/acceptance-scenarios.md
lib/skills/leo-code-to-business/references/output-workspace.md
lib/skills/leo-code-to-business/scripts/repository_snapshot.py
lib/skills/leo-code-to-business/scripts/discover_entrypoints.py
lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py
lib/skills/leo-code-to-business/scripts/render_business_site.py
lib/skills/leo-code-to-business/schemas/inventory.schema.json
lib/skills/leo-code-to-business/schemas/use-case-family.schema.json
lib/skills/leo-code-to-business/schemas/relationship.schema.json
lib/skills/leo-code-to-business/schemas/coverage.schema.json
lib/skills/leo-code-to-business/schemas/change-impact.schema.json
lib/skills/leo-code-to-business/schemas/manifest.schema.json
lib/skills/leo-code-to-business/tests/test_repository_snapshot.py
lib/skills/leo-code-to-business/tests/test_discover_entrypoints.py
lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py
lib/skills/leo-code-to-business/tests/test_render_business_site.py
tests/unit/skills-library.test.mjs
```

Responsibility boundaries:

- `business_contract.py`: v1/v2 artifact names, canonical serialization, stable IDs, status aggregation, and schema-neutral read/write helpers.
- `discovery/core.py`: adapter protocol, language detection, observation/signal normalization, conservation, and seed-candidate creation.
- `discovery/java_spring.py` and `node_typescript.py`: language/framework-specific signal candidates only.
- `discover_repository_signals.py`: adapter orchestration and v2 discovery CLI.
- `discover_entrypoints.py`: backward-compatible trigger-entry wrapper.
- `business_knowledge_guard.py`: v1/v2 validation orchestration, business semantic gates, coverage, publication, and benchmarks.
- `site_view_model.py`: deterministic canonical-to-view-model transformation and stable ordering.
- `render_business_site.py`: AI and HTML rendering from the validated view model.
- `git_business_history.py`: Git indexing, historical claims, change facts, invariant comparison, event grouping, and history CLI.
- `migrate_business_revision.py`: deterministic v1-to-v2 staging migration.

---

### Task 1: Centralize v2 Contracts, Canonical Serialization, and Stable IDs

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/business_contract.py`
- Create: `lib/skills/leo-code-to-business/tests/test_business_contract.py`
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/scripts/render_business_site.py`

**Interfaces:**
- Produces: `canonical_json_bytes(value: Any) -> bytes`
- Produces: `repository_lineage_id(root_commit_shas: list[str], file_map: dict[str, Any] | None = None) -> str`
- Produces: `signal_id(adapter_namespace: str, signal_kind: str, locator: str, framework_identity: str) -> str`
- Produces: `candidate_id(repository_lineage: str, seed_signal_id: str) -> str`
- Produces: `aggregate_status(current: str, history: str) -> str`
- Produces: `V1_CANONICAL_FILES`, `V2_CANONICAL_FILE_KINDS`, and `V2_HASH_EXCLUDED_FILES`

- [ ] **Step 1: Write failing contract tests**

```python
def test_candidate_id_ignores_later_provenance():
    first = contract.candidate_id("REPO-abc", "SIG-seed")
    second = contract.candidate_id("REPO-abc", "SIG-seed")
    self.assertEqual(first, second)

def test_repository_lineage_ignores_worktree_path():
    roots = ["b" * 40, "a" * 40]
    self.assertEqual(
        contract.repository_lineage_id(roots),
        contract.repository_lineage_id(list(reversed(roots))),
    )

def test_canonical_json_normalizes_unicode_and_record_order():
    left = [{"id": "B", "title": "e\u0301"}, {"id": "A", "title": "x"}]
    right = [{"title": "x", "id": "A"}, {"title": "é", "id": "B"}]
    self.assertEqual(
        contract.canonical_json_bytes(left, sort_records=True),
        contract.canonical_json_bytes(right, sort_records=True),
    )

def test_aggregate_status_precedence():
    self.assertEqual(contract.aggregate_status("passed", "not_requested"), "passed")
    self.assertEqual(contract.aggregate_status("passed", "partial"), "partial")
    self.assertEqual(contract.aggregate_status("partial", "passed"), "partial")
    self.assertEqual(contract.aggregate_status("passed", "blocked"), "blocked")
```

- [ ] **Step 2: Run the tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_contract.py -v
```

Expected: FAIL because `business_contract.py` does not exist.

- [ ] **Step 3: Implement the minimal shared contract**

```python
V1_SCHEMA_VERSION = "1.0"
V2_SCHEMA_VERSION = "2.0"

def candidate_id(repository_lineage: str, seed_signal_id: str) -> str:
    payload = f"{repository_lineage}\0{seed_signal_id}".encode("utf-8")
    return "UCC-" + hashlib.sha256(payload).hexdigest()[:20]

def aggregate_status(current: str, history: str) -> str:
    if current == "blocked" or history == "blocked":
        return "blocked"
    if current == "partial" or history == "partial":
        return "partial"
    if current == "passed" and history in {"passed", "not_requested"}:
        return "passed"
    raise ContractError(f"invalid status combination: {current}/{history}")
```

Implement canonical JSON with NFC normalization, lexicographic object keys, stable-ID sorting for
record arrays when requested, UTF-8 output, and no insignificant whitespace.

- [ ] **Step 4: Route existing canonical helpers through the contract without changing v1 behavior**

Replace duplicate hashing/serialization helpers in Guard and renderer with imports from
`business_contract.py`. Keep `guard.canonical_bytes()` and `guard.canonical_sha256()` as thin
compatibility wrappers so existing tests and external callers continue to work.

- [ ] **Step 5: Run focused and legacy tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_contract.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/business_contract.py \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/scripts/render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_business_contract.py
git commit -m "refactor: centralize business knowledge contracts"
```

---

### Task 2: Define v2 Schemas and a Valid Sample Revision

**Files:**
- Create: `lib/skills/leo-code-to-business/schemas/discovery-observation.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/use-case-candidate.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/legacy-signal-alias.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/historical-claim.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/git-commit.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/git-change-fact.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/business-evolution-event.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/lineage-link.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/omission-audit.schema.json`
- Create: `lib/skills/leo-code-to-business/schemas/site-view-model.schema.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/manifest.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/inventory.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/discovery-observations.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-candidates.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/legacy-signal-aliases.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/capabilities.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/actors.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-families.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-cases.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-rules.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/workflows.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/state-machines.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/domain-events.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/entities.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/glossary.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/aliases.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/relationships.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/investigations.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/evidence.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/conflicts.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/unknowns.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-commits.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-change-facts.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/historical-claims.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-evolution-events.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/lineage-links.jsonl`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/omission-audit.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/semantic-review.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/coverage.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/change-impact.json`
- Modify: `lib/skills/leo-code-to-business/schemas/inventory.schema.json`
- Modify: `lib/skills/leo-code-to-business/schemas/use-case-family.schema.json`
- Modify: `lib/skills/leo-code-to-business/schemas/relationship.schema.json`
- Modify: `lib/skills/leo-code-to-business/schemas/coverage.schema.json`
- Modify: `lib/skills/leo-code-to-business/schemas/change-impact.schema.json`
- Modify: `lib/skills/leo-code-to-business/schemas/manifest.schema.json`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_contract.py`

**Interfaces:**
- Produces: schema version `2.0` artifact contracts used by every later task.
- Produces: a minimal but complete `sample-revision-v2` fixture with one confirmed use case, one
  excluded signal, one historical claim, one change fact, one evolution event, and all projection
  inputs.

- [ ] **Step 1: Add failing schema-contract tests**

```python
def test_v2_schema_files_and_required_fields_exist():
    required = {
        "discovery-observation.schema.json": ["discovered_signal_ids", "rejected_findings"],
        "use-case-candidate.schema.json": ["seed_signal_id", "candidate_status"],
        "historical-claim.schema.json": ["verification_status"],
        "site-view-model.schema.json": ["view_schema_version", "use_case_details"],
    }
    for name, fields in required.items():
        schema = json.loads((SCHEMA_DIR / name).read_text())
        for field in fields:
            self.assertIn(field, schema["properties"])
```

Also assert that v2 manifest requires `current_coverage_status`, `history_coverage_status`, and
`aggregate_status`, while accepting v1 manifests through schema-version routing rather than one
mixed schema.

- [ ] **Step 2: Run the test and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_contract.py -v
```

Expected: FAIL with missing schema files.

- [ ] **Step 3: Write exact JSON Schema enums and cross-record fields**

Use `additionalProperties: false` for new deterministic ledgers. In
`use-case-candidate.schema.json`, require disposition-specific target fields at Guard time rather
than attempting conditional cross-file existence in JSON Schema.

```json
{
  "candidate_status": {
    "enum": [
      "confirmed",
      "variant",
      "supporting_behavior",
      "duplicate",
      "excluded",
      "unresolved"
    ]
  }
}
```

Define `coverage.json` as metric objects containing `numerator`, `denominator`, `ratio`,
`unresolved_ids`, and `excluded_ids`, plus the three status fields.

- [ ] **Step 4: Build the v2 sample revision**

Copy semantic content from `sample-revision` but assign v2 signals, observations, seed candidates,
history records, status fields, and empty-state metadata. Do not copy v1 projection hashes; later
tasks generate them.

- [ ] **Step 5: Run schema and legacy tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_contract.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS; v1 fixture remains valid.

- [ ] **Step 6: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/schemas \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2 \
  lib/skills/leo-code-to-business/tests/test_business_contract.py
git commit -m "feat: define business knowledge v2 schemas"
```

---

### Task 3: Add Path-Independent Repository Lineage to Snapshots

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/repository_snapshot.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_repository_snapshot.py`

**Interfaces:**
- Consumes: `business_contract.repository_lineage_id(root_commit_shas: list[str], file_map: dict[str, Any] | None = None) -> str`
- Produces: snapshot field `repository_lineage_id: str`
- Produces: snapshot field `git.root_commit_shas: list[str]`

- [ ] **Step 1: Add failing snapshot-lineage tests**

```python
def test_git_lineage_matches_across_two_worktrees(self):
    primary = snapshot.capture_snapshot(self.repo, exclusions=[])
    detached = self.root / "detached"
    subprocess.run(
        ["git", "-C", str(self.repo), "worktree", "add", "--detach", str(detached), "HEAD"],
        check=True,
        capture_output=True,
    )
    secondary = snapshot.capture_snapshot(detached, exclusions=[])
    self.assertEqual(primary["repository_lineage_id"], secondary["repository_lineage_id"])

def test_non_git_lineage_uses_frozen_file_map(self):
    repo = self.root / "plain"
    repo.mkdir()
    (repo / "a.txt").write_text("one")
    first = snapshot.capture_snapshot(repo, exclusions=[])
    second = snapshot.capture_snapshot(repo, exclusions=[])
    self.assertEqual(first["repository_lineage_id"], second["repository_lineage_id"])
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_repository_snapshot.py -v
```

Expected: FAIL because snapshots lack lineage fields.

- [ ] **Step 3: Implement Git root discovery and non-Git fallback**

Use:

```bash
git -C <repo> rev-list --max-parents=0 --all
```

Sort root SHAs before hashing. For a non-Git directory, calculate lineage from the already frozen
`path -> sha256` map after exclusions. Do not include absolute paths, timestamps, branch, or HEAD.

- [ ] **Step 4: Preserve snapshot comparison behavior**

Add `repository_lineage_changed` to `compare_snapshot()`. A HEAD change within the same repository
must not change lineage; unrelated repositories with identical filenames but different Git roots
must differ.

- [ ] **Step 5: Run snapshot and full skill tests**

Run:

```bash
python3 -m unittest discover \
  -s lib/skills/leo-code-to-business/tests \
  -p 'test_*.py' -v
```

Expected: all current tests PASS.

- [ ] **Step 6: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/repository_snapshot.py \
  lib/skills/leo-code-to-business/tests/test_repository_snapshot.py
git commit -m "feat: add stable repository lineage snapshots"
```

---

### Task 4: Build the Discovery Core and Observation-to-Signal Conservation

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/discovery/__init__.py`
- Create: `lib/skills/leo-code-to-business/scripts/discovery/core.py`
- Create: `lib/skills/leo-code-to-business/scripts/discover_repository_signals.py`
- Create: `lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py`
- Modify: `lib/skills/leo-code-to-business/scripts/discover_entrypoints.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_discover_entrypoints.py`

**Interfaces:**
- Produces: `DiscoveryAdapter` protocol with `discover(context: DiscoveryContext) -> AdapterResult`
- Produces: `detect_repository_languages(repo_root: Path) -> dict[str, int]`
- Produces: `normalize_adapter_result(result: AdapterResult, snapshot: dict) -> tuple[list[dict], dict]`
- Produces: `seed_candidates(inventory: list[dict], repository_lineage: str) -> list[dict]`
- CLI: `discover_repository_signals.py --repo <path> --snapshot <json> --output-dir <dir>`
- Compatibility CLI: `discover_entrypoints.py --repo <path> --output <inventory.jsonl> [--json]`

- [ ] **Step 1: Add a framework-neutral fixture adapter and failing tests**

```python
class FakeAdapter:
    adapter_id = "fake"
    adapter_version = "1"
    claimed_languages = {"java"}

    def discover(self, context):
        return AdapterResult(
            findings=[RawFinding("http_entry", "src/A.java:A.go", "GET /a")],
            rejected=[RejectedFinding("src/B.java", "not externally reachable")],
            unsupported_constructs=[],
            truncated=False,
        )

def test_observation_and_inventory_are_bidirectionally_conserved():
    context = DiscoveryContext(
        repo_root=self.repo,
        snapshot=self.snapshot,
        repository_lineage_id="REPO-test",
    )
    inventory, observation = core.normalize_adapter_result(
        FakeAdapter().discover(context),
        context,
        adapter=FakeAdapter(),
    )
    self.assertEqual(observation["discovered_signal_ids"], [inventory[0]["id"]])
    self.assertEqual(inventory[0]["discovered_by"], [observation["id"]])
```

Add a test proving a detected unsupported language returns coverage `partial`, not an empty success.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py \
  lib/skills/leo-code-to-business/tests/test_discover_entrypoints.py -v
```

Expected: FAIL because discovery core and CLI do not exist.

- [ ] **Step 3: Implement dataclasses and normalization**

```python
@dataclass(frozen=True)
class RawFinding:
    signal_class: str
    kind: str
    locator: str
    name: str
    source_location: dict[str, Any]
    framework_identity: str

@dataclass
class AdapterResult:
    findings: list[RawFinding]
    rejected: list[RejectedFinding]
    unsupported_constructs: list[str]
    truncated: bool
    diagnostics: list[str] = field(default_factory=list)
```

Normalize paths to repository-relative POSIX form, create stable `SIG-*` IDs, create one observation
record per adapter invocation, and reject duplicate signal IDs with conflicting source locators.

- [ ] **Step 4: Implement deterministic seed-candidate creation**

Create seed candidates for critical/high non-infrastructure signals and for normal/low signals that
lack deterministic non-candidate dispositions. Set `seed_signal_id`, `candidate_basis_signal_ids`,
and the stable `UCC-*` ID. Leave semantic fields unknown rather than guessing them.

- [ ] **Step 5: Implement orchestration and the v1 wrapper**

The new CLI writes:

```text
inventory.jsonl
discovery-observations.jsonl
use-case-candidates.jsonl
discovery-summary.json
```

The old CLI calls the new orchestrator, filters `signal_class == trigger_entry`, and emits the legacy
field shape so current callers remain functional until migrated.

- [ ] **Step 6: Run focused tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py \
  lib/skills/leo-code-to-business/tests/test_discover_entrypoints.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/discovery \
  lib/skills/leo-code-to-business/scripts/discover_repository_signals.py \
  lib/skills/leo-code-to-business/scripts/discover_entrypoints.py \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py \
  lib/skills/leo-code-to-business/tests/test_discover_entrypoints.py
git commit -m "feat: add repository signal discovery core"
```

---

### Task 5: Implement the Java/Spring Multi-Signal Adapter

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/discovery/java_spring.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/pom.xml`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderController.java`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderService.java`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderRepository.java`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderEvents.java`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/OrderRepairJob.java`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo/src/main/java/example/PaymentClient.java`
- Modify: `lib/skills/leo-code-to-business/scripts/discover_repository_signals.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py`
- Modify: `lib/skills/leo-code-to-business/references/java-spring-discovery.md`

**Interfaces:**
- Produces: `JavaSpringAdapter.discover(context: DiscoveryContext) -> AdapterResult`
- Produces signal kinds: `http_entry`, `event_consumer`, `scheduled_job`, `command_entry`,
  `persistence_write`, `state_write`, `external_call`, `event_producer`, `repair_entry`.

- [ ] **Step 1: Create a fixture whose core behavior cannot be recovered from routes alone**

Use exact fixture behaviors:

```java
@PostMapping("/orders/{id}/cancel")
public void cancel(@PathVariable Long id) { service.cancel(id); }

public void cancel(Long id) {
    repository.updateStatus(id, OrderStatus.CANCELLED);
    paymentClient.refund(id);
    publisher.publishEvent(new OrderCancelled(id));
}

@EventListener
public void restoreStock(OrderCancelled event) { repository.restoreStock(event.id()); }

@Scheduled(cron = "0 */10 * * * *")
public void reconcileFailedRefunds() { repository.findRefundFailures(); }
```

Include one mapper/SQL-style update, one setter/update-wrapper state write, one Feign client, one
event producer, one Spring event listener, and one operational repair job.

- [ ] **Step 2: Add failing adapter tests**

```python
def test_java_adapter_discovers_all_signal_classes():
    result = run_discovery(self.fixtures / "multi-signal-java-repo")
    kinds = {item["kind"] for item in result.inventory}
    self.assertTrue({
        "http_entry",
        "persistence_write",
        "state_write",
        "external_call",
        "event_producer",
        "event_consumer",
        "scheduled_job",
        "repair_entry",
    }.issubset(kinds))

def test_java_event_listener_is_not_dropped_from_observation():
    result = run_discovery(self.fixtures / "multi-signal-java-repo")
    listener = next(x for x in result.inventory if x["kind"] == "event_consumer")
    observation = by_id(result.observations, listener["discovered_by"][0])
    self.assertIn(listener["id"], observation["discovered_signal_ids"])
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py -v
```

Expected: FAIL because no Java/Spring adapter is registered.

- [ ] **Step 4: Implement Java source candidate extraction**

Use balanced annotation/method scanning rather than line-only regex. Resolve class-level and
method-level mappings, record unresolved composed annotations in `unsupported_constructs`, and scan
current Java, XML mapper, and SQL files for evidence candidates. Do not classify a signal as a
business use case in the adapter.

```python
class JavaSpringAdapter:
    adapter_id = "java-spring"
    adapter_version = "2.0"
    claimed_languages = {"java"}

    def discover(self, context: DiscoveryContext) -> AdapterResult:
        findings = []
        findings.extend(self._http_entries(context))
        findings.extend(self._events_and_jobs(context))
        findings.extend(self._writes_and_states(context))
        findings.extend(self._external_effects(context))
        return AdapterResult(
            findings=findings,
            rejected=[],
            unsupported_constructs=[],
            truncated=False,
            diagnostics=[],
        )
```

Attach deterministic importance hints: payment calls, terminal-state writes, compensation/reconcile
entries, and high-fan-in writes are `high` candidates; the core later recalculates or validates the
hint.

- [ ] **Step 5: Register the adapter and update the Java reference**

Document exactly which constructs are supported, which remain candidates, and how composed
annotations, AOP, reflection, dynamic SQL, generated code, and runtime bean selection become
explicit limitations.

- [ ] **Step 6: Run focused tests and the existing Java compatibility test**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py \
  lib/skills/leo-code-to-business/tests/test_discover_entrypoints.py -v
```

Expected: PASS; legacy `discover_entrypoints` still finds the ambiguous Java fixture entries.

- [ ] **Step 7: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/discovery/java_spring.py \
  lib/skills/leo-code-to-business/scripts/discover_repository_signals.py \
  lib/skills/leo-code-to-business/tests/fixtures/multi-signal-java-repo \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py \
  lib/skills/leo-code-to-business/references/java-spring-discovery.md
git commit -m "feat: discover Java Spring business signals"
```

---

### Task 6: Implement the Node/TypeScript Multi-Signal Adapter

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/discovery/node_typescript.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/package.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/server.ts`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/orders.ts`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/jobs.ts`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/events.ts`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo/src/cli.ts`
- Modify: `lib/skills/leo-code-to-business/scripts/discover_repository_signals.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py`
- Modify: `lib/skills/leo-code-to-business/references/repository-investigation.md`

**Interfaces:**
- Produces: `NodeTypeScriptAdapter.discover(context: DiscoveryContext) -> AdapterResult`
- Supports `.js`, `.cjs`, `.mjs`, `.jsx`, `.ts`, `.tsx` source roots while excluding build output.

- [ ] **Step 1: Create a representative Node/TypeScript fixture**

Include:

```typescript
router.post('/orders/:id/cancel', cancelOrder);
await db.order.update({ where: { id }, data: { status: 'cancelled' } });
await fetch(`${paymentBase}/refund`, { method: 'POST', body: JSON.stringify({ id }) });
events.emit('order.cancelled', { id });
events.on('order.cancelled', restoreStock);
cron.schedule('*/10 * * * *', reconcileRefunds);
program.command('repair-refund').action(repairRefund);
```

Use at least one Express-style route, direct `http.createServer` handler, Prisma/ORM write, `fetch`
call, event producer/consumer, schedule, and CLI command.

- [ ] **Step 2: Add failing Node discovery tests**

```python
def test_node_adapter_prevents_false_empty_success():
    result = run_discovery(self.fixtures / "node-typescript-repo")
    self.assertEqual(result.summary["language_adapter_coverage"]["typescript"], "covered")
    self.assertGreaterEqual(len(result.inventory), 7)

def test_node_adapter_discovers_reverse_effect_anchors():
    result = run_discovery(self.fixtures / "node-typescript-repo")
    signal_classes = {x["signal_class"] for x in result.inventory}
    self.assertIn("mutation_anchor", signal_classes)
    self.assertIn("external_effect_anchor", signal_classes)
    self.assertIn("event_anchor", signal_classes)
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py -v
```

Expected: FAIL because TypeScript is detected but unsupported.

- [ ] **Step 4: Implement Node/TypeScript extraction**

Recognize common patterns without claiming full AST certainty. Use package metadata and imports to
select framework scanners. Record dynamic route construction, decorators from unknown frameworks,
computed event names, and generated clients as limitations.

```python
ROUTE_PATTERNS = (
    r"\b(?:app|router)\.(get|post|put|patch|delete|all)\s*\(",
    r"\bserver\.route\s*\(",
)
WRITE_PATTERNS = (
    r"\b(?:create|insert|update|upsert|delete|save|execute)\s*\(",
)
```

Treat patterns as findings to investigate, not confirmed business semantics.

- [ ] **Step 5: Register the adapter and document provider-neutral limitations**

Update `repository-investigation.md` with the supported Node constructs and the rule that detected
unsupported languages make coverage partial.

- [ ] **Step 6: Run discovery tests and practice against the gateway**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py -v

tmp_workspace="$(mktemp -d)"
python3 lib/skills/leo-code-to-business/scripts/repository_snapshot.py \
  capture \
  --repo /Users/pa/project/AI/local-ai-gateway \
  --exclude '_leo_business/**' \
  --output "$tmp_workspace/snapshot.json"
python3 lib/skills/leo-code-to-business/scripts/discover_repository_signals.py \
  --repo /Users/pa/project/AI/local-ai-gateway \
  --snapshot "$tmp_workspace/snapshot.json" \
  --output-dir "$tmp_workspace/discovery"
```

Expected: tests PASS; practice summary reports TypeScript/JavaScript covered and materially more than
the previous two entries. Do not encode the mutable count as a permanent assertion.

- [ ] **Step 7: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/discovery/node_typescript.py \
  lib/skills/leo-code-to-business/scripts/discover_repository_signals.py \
  lib/skills/leo-code-to-business/tests/fixtures/node-typescript-repo \
  lib/skills/leo-code-to-business/tests/test_discover_repository_signals.py \
  lib/skills/leo-code-to-business/references/repository-investigation.md
git commit -m "feat: discover Node TypeScript business signals"
```

---

### Task 7: Enforce Signal, Candidate, Family, and Omission Conservation

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/inventory.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-candidates.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-families.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/investigations.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/omission-audit.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/coverage.json`

**Interfaces:**
- Produces: `validate_discovery_observations(records, inventory_by_id, snapshot_id) -> dict`
- Produces: `validate_candidates(records, inventory_by_id, node_ids, investigations) -> dict`
- Produces: `validate_family_closure(families, candidates, investigations) -> dict`
- Produces: `validate_omission_audit(audit, inventory_by_id, candidate_by_id) -> dict`
- Produces: `calculate_v2_coverage(inventory_summary: dict, candidate_summary: dict, family_summary: dict, investigation_summary: dict, omission_summary: dict, history_summary: dict) -> dict`
- Produces: `validate_revision_v2(root: Path) -> dict`

- [ ] **Step 1: Add omission mutation tests**

```python
def test_v2_rejects_signal_missing_from_candidate_or_non_candidate_disposition(self):
    inventory = self.read_v2_jsonl("inventory.jsonl")
    target = next(x for x in inventory if x["signal_class"] == "mutation_anchor")
    candidates = self.read_v2_jsonl("use-case-candidates.jsonl")
    for item in candidates:
        item["candidate_basis_signal_ids"] = [
            value for value in item["candidate_basis_signal_ids"] if value != target["id"]
        ]
    target.pop("non_candidate_status", None)
    self.write_v2_jsonl("inventory.jsonl", inventory)
    self.write_v2_jsonl("use-case-candidates.jsonl", candidates)
    self.assert_guard_error("unaccounted inventory signal", target["id"])

def test_v2_rejects_unresolved_high_candidate(self):
    candidate = self.first_v2_candidate()
    candidate["structural_importance"] = "high"
    candidate["candidate_status"] = "unresolved"
    self.assert_guard_status("partial", unresolved_id=candidate["id"])

def test_v2_rejects_missing_family_closure_cell(self):
    family = self.first_v2_family()
    del family["closure_matrix"]["cancel"]["operations"]
    self.assert_guard_error("missing family closure disposition", family["id"])

def test_v2_rejects_unresolved_high_omission_finding(self):
    audit = self.read_v2_json("omission-audit.json")
    audit["findings"].append({
        "id": "OMIT-high",
        "severity": "high",
        "status": "unresolved",
        "signal_ids": [self.first_v2_signal()["id"]],
        "candidate_ids": [],
        "evidence_ids": [],
        "statement": "reverse writer has no use case",
    })
    self.assert_guard_status("partial", unresolved_id="OMIT-high")
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: FAIL because the Guard ignores v2 ledgers.

- [ ] **Step 3: Add schema-version routing**

```python
def validate_revision(revision_dir):
    manifest = read_json(Path(revision_dir) / "manifest.json")
    if manifest.get("schema_version") == "2.0":
        return validate_revision_v2(Path(revision_dir))
    return validate_revision_v1(Path(revision_dir))
```

Extract the current function body to `validate_revision_v1` without changing results.

- [ ] **Step 4: Implement observation and inventory conservation**

Validate both directions, duplicate observations, snapshot match, truncation, adapter coverage, and
non-candidate evidence. Return raw numerator, denominator, unresolved IDs, and exclusions for every
signal class.

- [ ] **Step 5: Implement candidate target and stable-ID validation**

Recalculate each v2 candidate ID from manifest snapshot lineage and `seed_signal_id`. Enforce exact
target rules for `confirmed`, `variant`, `supporting_behavior`, `duplicate`, `excluded`, and
`unresolved`. Validate every basis signal and every target ID.

- [ ] **Step 6: Implement family closure and omission-audit gates**

Require every declared applicable action/channel cell to have a disposition and investigation.
Reject or downgrade unresolved critical/high audit findings. Preserve medium/low findings in
coverage unresolved IDs.

- [ ] **Step 7: Implement v2 coverage metric objects**

```python
def metric(numerator, denominator, unresolved_ids=(), excluded_ids=()):
    return {
        "numerator": numerator,
        "denominator": denominator,
        "ratio": numerator / denominator if denominator else 1.0,
        "unresolved_ids": sorted(unresolved_ids),
        "excluded_ids": sorted(excluded_ids),
    }
```

Calculate all required current metrics from the spec. Do not use confirmed-use-case count as the
candidate denominator.

- [ ] **Step 8: Run Guard and legacy regression tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: all v1 and new v2 Guard tests PASS.

- [ ] **Step 9: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2
git commit -m "feat: enforce business knowledge completeness gates"
```

---

### Task 8: Implement v2 Canonical Hashing and Publication Statuses

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/business_contract.py`
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_contract.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/manifest.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/coverage.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/semantic-review.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/change-impact.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-change-facts.jsonl`

**Interfaces:**
- Produces: `canonical_revision_sha256_v2(revision_dir: Path) -> str`
- Produces: `semantic_change_impact_payload(change_impact: dict) -> dict`
- Produces: manifest fields `current_coverage_status`, `history_coverage_status`,
  `aggregate_status`, and compatibility `coverage_status`.

- [ ] **Step 1: Add failing hash-cycle and status tests**

```python
def test_v2_canonical_hash_ignores_coverage_review_and_projection_changes(self):
    before = guard.canonical_revision_sha256_v2(self.v2_revision)
    self.write_v2_json("coverage.json", {"changed": True})
    self.write_v2_json("semantic-review.json", {"changed": True})
    (self.v2_revision / "ai-context.md").write_text("changed")
    after = guard.canonical_revision_sha256_v2(self.v2_revision)
    self.assertEqual(before, after)

def test_v2_canonical_hash_changes_for_semantic_history_fact(self):
    before = guard.canonical_revision_sha256_v2(self.v2_revision)
    facts = self.read_v2_jsonl("git-change-facts.jsonl")
    facts[0]["after_summary"] = "different verified behavior"
    self.write_v2_jsonl("git-change-facts.jsonl", facts)
    self.assertNotEqual(before, guard.canonical_revision_sha256_v2(self.v2_revision))

def test_partial_history_does_not_stale_current_claims(self):
    result = guard.validate_revision(self.v2_revision)
    self.assertEqual(result["current_coverage_status"], "passed")
    self.assertEqual(result["history_coverage_status"], "partial")
    self.assertEqual(result["aggregate_status"], "partial")
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_contract.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: FAIL because v2 hashing and three statuses are absent.

- [ ] **Step 3: Implement the exact v2 hash input map**

Represent file kinds explicitly:

```python
V2_CANONICAL_FILE_KINDS = {
    "inventory.jsonl": "jsonl",
    "discovery-observations.jsonl": "jsonl",
    "use-case-candidates.jsonl": "jsonl",
    "legacy-signal-aliases.jsonl": "jsonl",
    # every semantic file from the spec, no review/projection files
}
```

For `change-impact.json`, hash only `semantic_inputs`. Raise a named error when a required semantic
file is missing rather than treating it as empty.

- [ ] **Step 4: Implement three-status validation and compatibility output**

Set current/history statuses from their independent gates, derive aggregate with
`business_contract.aggregate_status`, and require manifest fields to match calculated values.
Compatibility `coverage_status` must equal aggregate.

- [ ] **Step 5: Update publication without changing v1 pointer behavior**

For v2, write:

```json
{
  "schema_version": "2.0",
  "current_coverage_status": "passed",
  "history_coverage_status": "partial",
  "aggregate_status": "partial",
  "coverage_status": "partial",
  "ai_path": "revisions/REV-v2-sample/ai-context.md",
  "html_path": "revisions/REV-v2-sample/site/index.html"
}
```

Do not replace `current.json` unless all required canonical and projection files validate.

- [ ] **Step 6: Run Guard, publication, and renderer tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_contract.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/business_contract.py \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_business_contract.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2
git commit -m "feat: add acyclic v2 hashes and publication statuses"
```

---

### Task 9: Build the Deterministic Site View Model and Fixed HTML Contract

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/site_view_model.py`
- Create: `lib/skills/leo-code-to-business/tests/test_site_view_model.py`
- Modify: `lib/skills/leo-code-to-business/scripts/render_business_site.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_render_business_site.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/ai-context.md`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/site-view-model.json`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/site/index.html`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/manifest.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-cases.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-families.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-rules.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/workflows.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/state-machines.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/domain-events.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/entities.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/relationships.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/unknowns.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/conflicts.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-evolution-events.jsonl`

**Interfaces:**
- Produces: `build_site_view_model(revision: dict[str, Any]) -> dict[str, Any]`
- Produces: `write_site_view_model(revision_dir: Path) -> dict[str, Any]`
- Produces: `render_html_site(view_model: dict[str, Any]) -> str`
- Produces: manifest projection hashes `view_model.sha256` and `html.sha256`.

- [ ] **Step 1: Add failing determinism and information-architecture tests**

```python
def test_shuffled_canonical_records_produce_identical_view_model_and_html(self):
    first = view_model.build_site_view_model(load_revision(self.revision))
    shuffle_every_collection(self.revision, seed=42)
    second = view_model.build_site_view_model(load_revision(self.revision))
    self.assertEqual(contract.canonical_json_bytes(first), contract.canonical_json_bytes(second))
    self.assertEqual(renderer.render_html_site(first), renderer.render_html_site(second))

def test_view_model_always_contains_fixed_views(self):
    model = view_model.build_site_view_model(load_revision(self.revision))
    self.assertEqual(list(model["views"]), [
        "overview", "capability_tree", "use_case_catalog", "use_case_details",
        "workflow_views", "state_views", "rule_catalog", "effect_catalog",
        "actor_permission_views", "evolution_views", "gap_views",
        "coverage_dashboard",
    ])

def test_empty_states_remain_distinct(self):
    model = view_model.build_site_view_model(load_revision(self.revision))
    rendered = renderer.render_html_site(model)
    for state in ["confirmed_empty", "searched_not_found", "not_investigated", "not_applicable"]:
        self.assertIn(f'data-empty-state="{state}"', rendered)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_site_view_model.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py -v
```

Expected: FAIL because renderer accepts canonical revision directly and has no view model.

- [ ] **Step 3: Implement explicit stable sort tuples**

```python
IMPORTANCE_RANK = {"critical": 0, "high": 1, "normal": 2, "low": 3, None: 4}
CLAIM_RANK = {"confirmed": 0, "inferred": 1, "conflicted": 2, "unknown": 3}

def use_case_sort_key(item):
    return (
        business_priority_rank(item.get("business_priority")),
        IMPORTANCE_RANK.get(item.get("structural_importance"), 4),
        item.get("capability_sort_key") or "",
        item.get("family_sort_key") or "",
        lifecycle_rank(item.get("lifecycle_stage")),
        normalize_sort_text(item.get("title")),
        item["id"],
    )
```

Define and test separate keys for capabilities, families, rules, evidence, unknowns, conflicts,
states, events, entities, and evolution events. Null ranks after known enum values; stable ID is the
last tie breaker.

- [ ] **Step 4: Build all fixed views**

The `use_case_details` record must contain ordered section objects with these exact IDs:

```python
USE_CASE_SECTION_IDS = (
    "summary", "trigger_preconditions", "main_flow", "rules_decisions",
    "effects", "success", "rejection_failure", "recovery",
    "permissions", "variants", "gaps", "evolution", "evidence",
)
```

Build state/event/entity/actor/history views from real canonical records, not placeholder copy.
Create compact evolution summaries with latest important active change, count, confidence summary,
and timeline route.

- [ ] **Step 5: Refactor the renderer to consume only the view model**

Keep `render_html_site()` as the public name but change its input contract to the validated view
model. `write_projections()` loads canonical knowledge, builds and writes the view model, renders AI
context and HTML, calculates hashes in the spec order, then updates the manifest.

- [ ] **Step 6: Preserve offline and no-JavaScript readability**

Assert fixed Chinese navigation labels, inline search data, `<noscript>` use-case index, coverage
denominators, unknown IDs, and evidence paths. Do not add external assets or runtime fetches.

- [ ] **Step 7: Run projection and full regression tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_site_view_model.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS; the shuffle test produces byte-identical HTML.

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/site_view_model.py \
  lib/skills/leo-code-to-business/scripts/render_business_site.py \
  lib/skills/leo-code-to-business/tests/test_site_view_model.py \
  lib/skills/leo-code-to-business/tests/test_render_business_site.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2
git commit -m "feat: render deterministic business knowledge views"
```

---

### Task 10: Index Git History and Separate Historical Claims from Observed Changes

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/git_business_history.py`
- Create: `lib/skills/leo-code-to-business/tests/test_git_business_history.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/real-git-history-expected.json`

**Interfaces:**
- Produces: `index_commits(repo_root: Path, refs: str = "--all") -> list[dict[str, Any]]`
- Produces: `extract_historical_claim(commit: dict[str, Any]) -> dict[str, Any]`
- Produces: `screen_deep_analysis(commit: dict, changed_files: list[dict]) -> dict[str, Any]`
- CLI: `git_business_history.py index --repo <path> --output-dir <dir>`

- [ ] **Step 1: Add failing tests using a temporary real Git repository**

```python
def test_commit_message_is_stored_as_claim_not_change_fact(self):
    repo = self.make_git_repo()
    self.commit(repo, "feat: added refund", {"README.md": "rename only"})
    history = git_history.index_commits(repo)
    claim = git_history.extract_historical_claim(history[-1])
    self.assertEqual(claim["source_kind"], "commit_message")
    self.assertEqual(claim["verification_status"], "unverifiable")
    self.assertEqual(git_history.extract_change_facts(repo, history[-1]), [])

def test_all_reachable_commits_are_indexed_with_parents_and_renames(self):
    repo = self.make_git_repo_with_branch_and_merge()
    commits = git_history.index_commits(repo)
    self.assertEqual({x["commit_sha"] for x in commits}, self.git_all_shas(repo))
    self.assertTrue(any(x["is_merge"] for x in commits))
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_git_business_history.py -v
```

Expected: FAIL because history module does not exist.

- [ ] **Step 3: Implement NUL-safe Git indexing**

Use Git CLI with explicit formats and parse NUL-delimited paths:

```bash
git -C <repo> log --all --topo-order --reverse --format=<record-format> --name-status -z -M
```

Record commit SHA, parents, author/commit times, author identity, subject, refs, merge status,
changed paths, renames, and change statistics. Record shallow/missing-object diagnostics.

- [ ] **Step 4: Implement historical claim records**

Create one immutable `commit_message` claim per indexed commit. Set verification status to
`unverifiable` until change-fact comparison updates it. Do not interpret generic messages into
business meaning.

- [ ] **Step 5: Implement deterministic deep-analysis screening**

Screen by changed signal-sensitive paths and syntactic facts from discovery adapters. A generic or
misleading subject may increase search priority but cannot set the final classification.

- [ ] **Step 6: Add CLI output and tests**

Write `git-commits.jsonl`, `historical-claims.jsonl`, and `history-index-summary.json`. Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_git_business_history.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/git_business_history.py \
  lib/skills/leo-code-to-business/tests/test_git_business_history.py \
  lib/skills/leo-code-to-business/tests/fixtures/real-git-history-expected.json
git commit -m "feat: index Git business history claims"
```

---

### Task 11: Extract Verified Change Facts and Business Evolution Events

**Files:**
- Modify: `lib/skills/leo-code-to-business/scripts/git_business_history.py`
- Modify: `lib/skills/leo-code-to-business/tests/test_git_business_history.py`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-commits.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/git-change-facts.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/historical-claims.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-evolution-events.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/lineage-links.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-cases.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-rules.jsonl`

**Interfaces:**
- Produces: `extract_change_facts(repo_root: Path, commit: dict[str, Any]) -> list[dict[str, Any]]`
- Produces: `compare_business_invariants(before: dict, after: dict) -> dict[str, Any]`
- Produces: `group_evolution_events(commits, facts, claims, lineage) -> list[dict[str, Any]]`
- Produces: `check_current_effectiveness(event, current_revision) -> str`
- CLI: `git_business_history.py analyze --repo <path> --index-dir <dir> --output-dir <dir>`

- [ ] **Step 1: Add failing behavior-difference tests**

```python
def test_rename_only_commit_produces_no_business_event(self):
    repo, commit = self.fixture_commit("rename-only")
    facts = git_history.extract_change_facts(repo, commit)
    self.assertTrue(any(x["fact_type"] == "symbol_renamed" for x in facts))
    self.assertEqual(git_history.group_evolution_events([commit], facts, [], []), [])

def test_rule_change_produces_before_after_fact_without_message_support(self):
    repo, commit = self.fixture_commit("cancel-rule-change", subject="fix")
    facts = git_history.extract_change_facts(repo, commit)
    changed = next(x for x in facts if x["fact_type"] == "condition_changed")
    self.assertEqual(changed["before_summary"], "PREPARING orders may be cancelled")
    self.assertEqual(changed["after_summary"], "PREPARING orders require manual cancellation")
    self.assertTrue(changed["before_evidence_ids"])
    self.assertTrue(changed["after_evidence_ids"])

def test_revert_marks_prior_event_reverted(self):
    events = self.analyze_fixture("revert")
    prior = next(x for x in events if x["title"] == "Tighten cancellation rule")
    self.assertEqual(prior["current_effectiveness"], "reverted")
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_git_business_history.py -v
```

Expected: FAIL because change facts and events are not implemented.

- [ ] **Step 3: Implement before/after source materialization**

Use `git show <parent>:<path>` and `git show <commit>:<path>` into memory or temporary external
files. Reuse discovery adapter fact extraction on both snapshots. Never checkout or modify the
analyzed repository.

- [ ] **Step 4: Implement normalized invariant comparison**

Compare trigger, precondition, decision, state/data change, external effect, outcome, failure,
compensation, and permission facts. Emit technical facts for moves/renames but only create business
events when a business invariant changes.

- [ ] **Step 5: Implement conservative event grouping**

Group commits only when they share affected stable business nodes/signals, direct ancestry, a bounded
time window, and compatible outcomes. Otherwise retain `independent_commit` or `grouping_unknown`.
Commit-message similarity is supporting evidence only.

- [ ] **Step 6: Implement claim verification and current effectiveness**

Update claim status by comparing the declared statement with verified facts. Determine `active`,
`superseded`, `reverted`, `partially_active`, `historical_only`, or `unknown` against the current
canonical revision.

- [ ] **Step 7: Run history and Guard tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_git_business_history.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS; history coverage and reason discipline validate.

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/git_business_history.py \
  lib/skills/leo-code-to-business/tests/test_git_business_history.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2
git commit -m "feat: reconstruct verified business evolution"
```

---

### Task 12: Implement Deterministic v1-to-v2 Migration

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/migrate_business_revision.py`
- Create: `lib/skills/leo-code-to-business/tests/test_migrate_business_revision.py`
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`

**Interfaces:**
- Produces: `detect_revision_schema(revision_dir: Path) -> str`
- Produces: `migrate_v1_to_v2(source_revision: Path, target_run: Path) -> Path`
- CLI: `migrate_business_revision.py --source <v1-revision> --target-run <dir>`

- [ ] **Step 1: Add failing migration tests**

```python
def test_migration_preserves_v1_ids_and_marks_legacy_inventory(self):
    migrated = migrator.migrate_v1_to_v2(self.v1_revision, self.target_run)
    before = read_jsonl(self.v1_revision / "inventory.jsonl")
    after = read_jsonl(migrated / "inventory.jsonl")
    self.assertEqual([x["id"] for x in before], [x["id"] for x in after])
    self.assertTrue(all(x["id_scheme"] == "legacy_v1" for x in after))

def test_migration_is_partial_until_v2_discovery_runs(self):
    migrated = migrator.migrate_v1_to_v2(self.v1_revision, self.target_run)
    result = guard.validate_revision(migrated)
    self.assertEqual(result["current_coverage_status"], "partial")
    self.assertIn("v2 discovery required", result["coverage"]["migration_gaps"])

def test_invalid_unversioned_revision_is_rejected(self):
    del_required_v1_file(self.v1_revision)
    with self.assertRaisesRegex(migrator.MigrationError, "not a complete v1 revision"):
        migrator.detect_revision_schema(self.v1_revision)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_migrate_business_revision.py -v
```

Expected: FAIL because migration module does not exist.

- [ ] **Step 3: Implement strict version detection and copying**

Validate the complete v1 required-file set before treating a missing schema version as v1. Copy to
a new staging directory, never edit the source revision, preserve IDs/statuses, add
`migrated_from_revision`, and generate empty schema-valid v2 ledgers.

- [ ] **Step 4: Implement legacy signal aliases**

Do not fabricate aliases during initial migration. Provide:

```python
def build_legacy_signal_aliases(legacy_inventory, current_v2_inventory):
    # Match canonical locator + kind; emit only exact deterministic matches.
```

Legacy inventory does not satisfy current adapter coverage until an exact v2 signal exists.

- [ ] **Step 5: Recompute v2 canonical hash and verify pointer isolation**

The migration CLI writes only to the supplied target run. It must not change the source workspace's
`current.json`. Publishing later performs the normal atomic pointer replacement.

- [ ] **Step 6: Run migration, Guard, and publication tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_migrate_business_revision.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/migrate_business_revision.py \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_migrate_business_revision.py
git commit -m "feat: migrate legacy business knowledge revisions"
```

---

### Task 13: Generate AI Task Context Packs and Business Impact Results

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/task_context.py`
- Create: `lib/skills/leo-code-to-business/tests/test_task_context.py`
- Modify: `lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-cases.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/use-case-families.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-rules.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/workflows.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/state-machines.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/entities.json`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/relationships.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/unknowns.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/conflicts.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/business-evolution-events.jsonl`
- Modify: `lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2/change-impact.json`

**Interfaces:**
- Produces: `retrieve_candidate_nodes(question: str, revision: dict) -> list[str]`
- Produces: `expand_business_context(node_ids: list[str], revision: dict, max_nodes: int = 80) -> dict`
- Produces: `build_task_context_pack(question: str, revision: dict) -> dict`
- Produces: `analyze_business_impact(changed_semantic_ids: list[str], revision: dict) -> list[dict]`
- CLI: `task_context.py build --revision <dir> --question <text> --output <json>`

- [ ] **Step 1: Add failing multi-path retrieval tests**

```python
def test_cancel_question_retrieves_refund_repair_and_same_family_variants(self):
    pack = task_context.build_task_context_pack(
        "允许备货订单由客户取消",
        load_revision(self.v2_revision),
    )
    self.assertIn("UC-order-cancel", pack["primary_use_case_ids"])
    self.assertIn("UC-order-refund", pack["related_use_case_ids"])
    self.assertIn("UC-refund-repair", pack["related_use_case_ids"])
    self.assertIn("RULE-order-cancel-window", pack["rule_ids"])
    self.assertIn("STATE-order-preparing", pack["state_ids"])

def test_context_pack_exposes_unknowns_and_coverage_warnings(self):
    pack = task_context.build_task_context_pack(
        "修改取消规则",
        load_revision(self.v2_revision),
    )
    self.assertTrue(pack["unknown_ids"])
    self.assertTrue(pack["coverage_warnings"])
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_task_context.py -v
```

Expected: FAIL because `task_context.py` does not exist.

- [ ] **Step 3: Implement multi-path retrieval**

Retrieve by aliases, normalized titles/summaries, actors, goals, entities, rules, states, signal
locators, external effects, historical events, and code symbols. Rank exact aliases and stable IDs
above text matches. Keep the algorithm deterministic and return scored reasons for each primary node.

- [ ] **Step 4: Implement bounded relationship expansion**

Use a fixed relationship whitelist and depth:

```python
EXPANSION_RULES = {
    "variant_of": 1,
    "uses_rule": 1,
    "writes": 1,
    "transitions": 1,
    "emits": 1,
    "consumes": 1,
    "calls_external": 1,
    "fails_to": 1,
    "compensates": 1,
    "evolved_by": 1,
}
```

Include reverse writers for important entities and explicit failure/repair paths. Stop at `max_nodes`
and emit a truncation warning rather than silently dropping context.

- [ ] **Step 5: Implement evidence-qualified impact analysis**

Classify impacts as `confirmed`, `probable`, `possible`, or `unknown` based on relationship type,
distance, source evidence, and unresolved dynamic behavior. Call adjacency alone may produce at most
`possible` without a business relationship.

- [ ] **Step 6: Write task packs as run artifacts**

The CLI writes the pack atomically to the explicit output path. It never mutates canonical revision
files. Add a Guard query-gap integration test showing stale or missing dimensions request targeted
investigations before a final answer.

- [ ] **Step 7: Run task-context and Guard tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_task_context.py \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/task_context.py \
  lib/skills/leo-code-to-business/scripts/business_knowledge_guard.py \
  lib/skills/leo-code-to-business/tests/test_task_context.py \
  lib/skills/leo-code-to-business/tests/fixtures/sample-revision-v2
git commit -m "feat: build business task context packs"
```

---

### Task 14: Add Mandatory Real-Git and Extended Acceptance Harnesses

**Files:**
- Create: `lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py`
- Create: `lib/skills/leo-code-to-business/tests/test_v2_acceptance.py`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/real-git-history.bundle`
- Create: `lib/skills/leo-code-to-business/tests/fixtures/real-git-history-expected.json`
- Modify: `lib/skills/leo-code-to-business/references/acceptance-scenarios.md`

**Interfaces:**
- Produces: `run_real_git_fixture(skill_dir: Path, output_dir: Path) -> dict`
- Produces: `run_extended_java(repo_path: Path, commit_sha: str, output_dir: Path) -> dict`
- Produces: `compare_cross_model_runs(run_a: Path, run_b: Path) -> dict`
- CLI commands: `real-git-fixture`, `extended-java`, and `compare-model-runs`.

- [ ] **Step 1: Create the real Git bundle deterministically**

Build a temporary repository with this exact history, then create a bundle checked into fixtures:

```text
1. initial order cancellation rule
2. rename-only refactor with message "feat: add refund"
3. actual cancellation condition change with message "fix"
4. second commit completing the same business event
5. revert of the condition change
6. history claim whose business reason remains unknown
```

Record expected SHAs, parents, fact types, event grouping, claim verification, and current
effectiveness in `real-git-history-expected.json`. The test must consume the bundle, not recreate
expected behavior from mocks.

- [ ] **Step 2: Add failing mandatory bundle tests**

```python
def test_real_git_fixture_is_not_skippable_and_matches_expected(self):
    result = acceptance.run_real_git_fixture(SKILL_DIR, self.output)
    self.assertEqual(result["status"], "passed")
    self.assertEqual(result["commit_count"], EXPECTED["commit_count"])
    self.assertEqual(result["business_event_ids"], EXPECTED["business_event_ids"])
    self.assertEqual(result["reverted_event_ids"], EXPECTED["reverted_event_ids"])

def test_cross_model_comparison_rejects_missing_high_seed_candidate(self):
    result = acceptance.compare_cross_model_runs(self.run_a, self.run_b_missing_high)
    self.assertEqual(result["status"], "failed")
    self.assertIn("missing critical/high candidate", result["errors"][0])
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_v2_acceptance.py -v
```

Expected: FAIL because bundle and harness do not exist.

- [ ] **Step 4: Implement real-Git fixture execution**

Clone the bundle into a temporary directory, run snapshot, discovery, history index, change-fact
analysis, evolution grouping, Guard, view-model, and HTML checks. Return a machine-readable result
with exact hashes and failures. Any missing bundle is a hard test failure.

- [ ] **Step 5: Implement fixed Java extended acceptance**

Materialize commit `c6893715d0d52477849595e7ed7c8c5ec276f322` in a detached temporary worktree and external output
root. Verify work-order creation, the video-binding family, a reverse-writer use case, a repair path,
and a stratified history sample. If repo/commit is absent, exit with code `2` and a named unavailable
diagnostic; release evidence cannot mark the candidate accepted until a code-0 result is stored.

- [ ] **Step 6: Implement cross-model deterministic comparison**

Compare observation and inventory ID sets exactly, critical/high seed candidate union recall at
100%, dispositions and family membership for critical/high candidates, view structural paths, and
semantic rubric thresholds. Preserve adjudication output for normal/low disagreements.

- [ ] **Step 7: Run mandatory fixture tests**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_v2_acceptance.py -v
```

Expected: PASS without network or external repository access.

- [ ] **Step 8: Run the extended Java suite when available**

Run:

```bash
python3 lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py \
  extended-java \
  --repo /Users/pa/project/JZ/utopia-scs-recorder \
  --commit c6893715d0d52477849595e7ed7c8c5ec276f322 \
  --output /tmp/leo-business-v2-extended-java.json
```

Expected: exit `0` and result status `passed` when available; exit `2` only for the documented
unavailable condition. Do not weaken the mandatory bundle suite based on this result.

- [ ] **Step 9: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py \
  lib/skills/leo-code-to-business/tests/test_v2_acceptance.py \
  lib/skills/leo-code-to-business/tests/fixtures/real-git-history.bundle \
  lib/skills/leo-code-to-business/tests/fixtures/real-git-history-expected.json \
  lib/skills/leo-code-to-business/references/acceptance-scenarios.md
git commit -m "test: add real Git business knowledge acceptance"
```

---

### Task 15: Update the Skill Workflow and Run Final Integrated Validation

**Files:**
- Modify: `lib/skills/leo-code-to-business/SKILL.md`
- Modify: `lib/skills/leo-code-to-business/references/business-knowledge-model.md`
- Modify: `lib/skills/leo-code-to-business/references/business-discovery.md`
- Modify: `lib/skills/leo-code-to-business/references/evidence-and-confidence.md`
- Modify: `lib/skills/leo-code-to-business/references/coverage-and-completion.md`
- Modify: `lib/skills/leo-code-to-business/references/repository-investigation.md`
- Modify: `lib/skills/leo-code-to-business/references/incremental-update.md`
- Modify: `lib/skills/leo-code-to-business/references/html-projection.md`
- Modify: `lib/skills/leo-code-to-business/references/output-workspace.md`
- Modify: `tests/unit/skills-library.test.mjs`

**Interfaces:**
- Produces: the final user-facing v2 workflow contract and installable managed-skill package.
- Consumes: every CLI and artifact contract from Tasks 1-14.

- [ ] **Step 1: Add failing documentation-contract tests**

Extend `test_skill_requires_bidirectional_business_investigation` and the managed-library test to
require these exact v2 concepts:

```python
for required in [
    "discover_repository_signals.py",
    "use-case-candidates.jsonl",
    "candidate conservation",
    "independent omission audit",
    "site-view-model.json",
    "historical-claims.jsonl",
    "commit message",
    "current_coverage_status",
    "history_coverage_status",
    "task context",
]:
    self.assertIn(required, skill_text)
```

Also assert every new referenced file exists in the installed managed skill.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_business_knowledge_guard.py -v
node --test tests/unit/skills-library.test.mjs
```

Expected: FAIL because skill/reference text still describes v1.

- [ ] **Step 3: Rewrite the thin workflow contract**

Keep `SKILL.md` concise. Required execution order:

```text
freeze snapshot and lineage
→ detect languages and run all applicable discovery adapters
→ validate observations and inventory denominator
→ create and investigate seed candidates in capability waves
→ close use-case families and reverse writers
→ validate current canonical knowledge
→ index/analyze requested Git history without trusting messages
→ run independent omission and semantic reviews
→ build task retrieval data, view model, AI context, and HTML
→ validate hashes/statuses and publish immutable revision
```

State explicitly that unsupported detected languages force partial coverage and that projections
cannot be generated before canonical validation.

- [ ] **Step 4: Update references with normative artifact and evidence rules**

Keep schemas and implementation detail in their files; references explain model behavior. Include
candidate disposition rules, family matrix investigation, history claim separation, current/history
status behavior, deterministic HTML sections, migration, and real acceptance.

- [ ] **Step 5: Run quick validation and the complete portable suite**

Run:

```bash
python3 /Users/pa/.codex/skills/.system/skill-creator/scripts/quick_validate.py \
  lib/skills/leo-code-to-business

python3 -m unittest discover \
  -s lib/skills/leo-code-to-business/tests \
  -p 'test_*.py' -v

node --test tests/unit/skills-library.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Run order-invariance and mandatory real-Git acceptance twice**

Run:

```bash
python3 -m unittest \
  lib/skills/leo-code-to-business/tests/test_site_view_model.py \
  lib/skills/leo-code-to-business/tests/test_v2_acceptance.py -v

python3 lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py \
  real-git-fixture \
  --output /tmp/leo-business-v2-real-git-1.json
python3 lib/skills/leo-code-to-business/scripts/run_v2_acceptance.py \
  real-git-fixture \
  --output /tmp/leo-business-v2-real-git-2.json
cmp /tmp/leo-business-v2-real-git-1.json /tmp/leo-business-v2-real-git-2.json
```

Expected: both runs PASS and result bytes are identical after excluding any explicitly documented
run timestamp. Prefer omitting timestamps from the acceptance result rather than post-processing.

- [ ] **Step 7: Run non-mutating practice against both local repositories**

Use external temporary workspaces. For the gateway, require covered Node/TypeScript language status,
non-empty multi-signal inventory, and no writes to the repository. For the Java repository, run the
fixed commit extended suite and store its result under `/tmp` or another explicit external path.

- [ ] **Step 8: Verify repository cleanliness and review the diff**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~15..HEAD
```

Expected: no generated `_leo_business` output, temporary worktrees, caches, or acceptance artifacts
inside analyzed repositories. Only intended skill, fixture, test, reference, schema, and plan changes
remain.

- [ ] **Step 9: Commit**

```bash
git add \
  lib/skills/leo-code-to-business/SKILL.md \
  lib/skills/leo-code-to-business/references \
  tests/unit/skills-library.test.mjs
git commit -m "docs: update leo business knowledge v2 workflow"
```

---

## Final Verification Checklist

- [ ] Existing v1 sample revision still validates and renders.
- [ ] V2 observations and inventory conserve both directions.
- [ ] Every v2 signal supports a candidate or has an evidence-linked non-candidate disposition.
- [ ] Critical/high seed candidates cannot disappear, remain unresolved in passed output, or change ID after added provenance.
- [ ] Family closure and reverse-writer omissions are named in Guard errors.
- [ ] Unsupported detected languages produce partial coverage.
- [ ] Canonical hash is stable under record shuffling and ignores reviews/projections/statuses.
- [ ] View-model and HTML bytes are stable under record shuffling.
- [ ] All fixed human views and empty-state meanings render.
- [ ] Commit messages create claims, not confirmed change facts or reasons.
- [ ] Rename-only refactors do not create business events.
- [ ] Verified rule/state/effect changes create before/after business evolution.
- [ ] Current and history statuses remain independently visible.
- [ ] V1 migration preserves IDs and remains partial until v2 discovery.
- [ ] Task context packs retrieve variants, reverse writers, failures, repairs, history, and gaps.
- [ ] Mandatory real Git bundle tests pass without external dependencies.
- [ ] Fixed Java extended acceptance and cross-model evidence exist for release acceptance.
- [ ] AI and HTML projections share the same canonical revision.
- [ ] Full Python and managed-skill test suites pass.
