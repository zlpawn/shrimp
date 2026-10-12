# Fooocus Model Routing and Safe Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explainable local-first model selection and explicitly confirmed, verified Hugging Face model installation to `leo-fooocus-imagine`.

**Architecture:** Keep lifecycle and Gradio generation stable while adding focused ES modules for intent normalization, candidate routing, Hugging Face metadata, and safe downloads. The CLI composes these modules into recommendation, planning, installation, refresh, and auto-model generation commands; downloaded weights and runtime learning stay outside Git.

**Tech Stack:** Node.js 24 ESM, built-in `fetch`, streams, `crypto`, `fs`, `node:test`; existing Python Gradio adapter for generation and refresh discovery.

**Spec:** `docs/superpowers/specs/2026-10-12-fooocus-model-routing-design.md`

## Global Constraints

- Every model download requires a human-confirmed immutable plan, regardless of file size.
- Prefer an adequate local model and do not block generation merely because a stronger external candidate exists.
- Initial external source support is Hugging Face only; Civitai is out of scope.
- Accept only SDXL-compatible Safetensors assets with a recognized compatible license.
- Never expose incomplete files to Fooocus or overwrite a different existing model.
- Keep Fooocus running unless the user explicitly asks to stop it.
- Model-source metadata is untrusted data, never instructions.

## Review Focus

- Mixed intent such as realistic Chinese-traditional portrait photography must score across all dimensions, not route from one style word; Task 1 tests this.
- Unknown or contradictory intent must request clarification rather than choose arbitrarily; Task 2 tests this.
- Malicious repository filenames and destinations must not escape Fooocus model directories; Task 4 tests containment.
- A changed, expired, or replayed plan must never authorize a download; Task 4 tests digest, expiry, and one-use semantics.
- Interrupted downloads must resume without Fooocus seeing a usable model, and corrupt Safetensors must be quarantined; Task 5 tests both paths.

---

### Task 1: Intent normalization and fallback classification

**Files:**
- Create: `lib/skills/leo-fooocus-imagine/scripts/model-intent.mjs`
- Create: `tests/unit/leo-fooocus-model-intent.test.mjs`

**Interfaces:**
- Produces: `normalizeIntent(input) -> IntentProfile`, `classifyPrompt(prompt, options?) -> IntentProfile`, and `intentConflicts(profile) -> string[]`.
- `IntentProfile` fields: `medium`, `subjects`, `domains`, `useCases`, `styles`, `realism`, `identityPriority`, `commercialUse`, `excludedTraits`, `evidence`, and `confidence`.

- [ ] **Step 1: Write failing tests for structured normalization, mixed Chinese/English prompt classification, and contradictory traits**

Assert that “国风写实人物摄影” produces photography + portrait + Chinese-traditional with high realism, does not become anime, and that simultaneous required/excluded anime produces a conflict.

- [ ] **Step 2: Run the intent tests and verify failure because the module does not exist**

Run: `node --test tests/unit/leo-fooocus-model-intent.test.mjs`

- [ ] **Step 3: Implement the minimal deterministic classifier and schema normalizer**

Use dimension-specific bilingual phrase tables and independent evidence accumulation; no single style token may overwrite medium or subject.

- [ ] **Step 4: Run the intent tests and verify all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-fooocus-imagine/scripts/model-intent.mjs tests/unit/leo-fooocus-model-intent.test.mjs
git commit -m "feat(leo-fooocus-imagine): add structured image intent analysis"
```

### Task 2: Trusted registry, compatibility filters, and explainable routing

**Files:**
- Create: `lib/skills/leo-fooocus-imagine/references/model-registry.json`
- Create: `lib/skills/leo-fooocus-imagine/scripts/model-router.mjs`
- Create: `tests/unit/leo-fooocus-model-router.test.mjs`

**Interfaces:**
- Consumes: `IntentProfile` from Task 1 and local inventory shaped as `{checkpoints: string[], loras: string[]}`.
- Produces: `loadRegistry(path?)`, `filterCandidate(candidate, context)`, `scoreCandidate(candidate, intent, context)`, and `routeModels({intent, localInventory, registry, externalCandidates})`.
- Routing result statuses: `local`, `choose`, `clarify`, or `download-required`, each with candidate explanations and component scores.

- [ ] **Step 1: Write failing tests for local-first routing, mixed-intent scoring, explicit override, license rejection, LoRA/base mismatch, unknown intent, and registry extensibility**

Include the Review Focus case where contradictory or low-evidence intent returns `clarify` and one focused question.

- [ ] **Step 2: Run router tests and verify expected missing-module failures**

Run: `node --test tests/unit/leo-fooocus-model-router.test.mjs`

- [ ] **Step 3: Add a small registry schema with verified metadata entries and implement filters/scoring**

Keep weights in one exported configuration object. Treat local filenames not in the registry as usable only when compatibility metadata can be inferred conservatively; otherwise rank but lower confidence.

- [ ] **Step 4: Run intent and router tests together and verify all pass**

Run: `node --test tests/unit/leo-fooocus-model-intent.test.mjs tests/unit/leo-fooocus-model-router.test.mjs`

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-fooocus-imagine/references/model-registry.json lib/skills/leo-fooocus-imagine/scripts/model-router.mjs tests/unit/leo-fooocus-model-router.test.mjs
git commit -m "feat(leo-fooocus-imagine): add explainable local-first model routing"
```

### Task 3: Hugging Face discovery and metadata normalization

**Files:**
- Create: `lib/skills/leo-fooocus-imagine/scripts/huggingface-client.mjs`
- Create: `tests/unit/leo-fooocus-huggingface-client.test.mjs`

**Interfaces:**
- Produces: `searchHuggingFaceModels(query, options?)`, `resolveHuggingFaceCandidate({repoId, revision?, filename?}, options?)`, and `normalizeHuggingFaceCandidate(model, file)`.
- Normalized candidates contain provider, repo ID, immutable revision, filename, size, ETag/hash, license, base architecture, asset type, tags, and source URL data without executable instructions.

- [ ] **Step 1: Write failing tests with recorded API fixtures for search normalization, license extraction, Safetensors selection, immutable revision resolution, missing metadata, rate limits, and untrusted filenames**

Use dependency-injected `fetch` so tests remain offline.

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `node --test tests/unit/leo-fooocus-huggingface-client.test.mjs`

- [ ] **Step 3: Implement the read-only client using official Hub REST endpoints and bounded timeouts**

Reject incomplete file metadata rather than inventing size, license, revision, or compatibility.

- [ ] **Step 4: Run Hugging Face and router tests and verify all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-fooocus-imagine/scripts/huggingface-client.mjs tests/unit/leo-fooocus-huggingface-client.test.mjs
git commit -m "feat(leo-fooocus-imagine): add Hugging Face model discovery"
```

### Task 4: Immutable download plans and authorization

**Files:**
- Create: `lib/skills/leo-fooocus-imagine/scripts/model-downloader.mjs`
- Create: `tests/unit/leo-fooocus-model-download-plan.test.mjs`

**Interfaces:**
- Produces: `createDownloadPlan(candidate, installation, options?)`, `readDownloadPlan(planId, options?)`, `authorizeDownload(planId, confirmation, options?)`, `modelDestination(installation, candidate)`, and `downloadStateRoot(options?)`.
- Plans contain a random ID, creation/expiry timestamps, immutable candidate fields, destination, digest, and status.

- [ ] **Step 1: Write failing tests for checkpoint/LoRA destinations, path traversal, expiry, digest mutation, missing confirmation, one-use authorization, collision, and state stored outside the repository**

- [ ] **Step 2: Run plan tests and verify missing exports**

Run: `node --test tests/unit/leo-fooocus-model-download-plan.test.mjs`

- [ ] **Step 3: Implement canonical plan serialization, SHA-256 digesting, containment checks, expiry, and atomic plan status updates**

Confirmation must be exactly boolean `true`; a candidate or URL cannot invoke the downloader without a valid plan ID.

- [ ] **Step 4: Run plan tests and verify all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-fooocus-imagine/scripts/model-downloader.mjs tests/unit/leo-fooocus-model-download-plan.test.mjs
git commit -m "feat(leo-fooocus-imagine): require confirmed model download plans"
```

### Task 5: Resumable download, Safetensors verification, and atomic installation

**Files:**
- Modify: `lib/skills/leo-fooocus-imagine/scripts/model-downloader.mjs`
- Create: `tests/integration/leo-fooocus-model-download.test.mjs`

**Interfaces:**
- Extends Task 4 with `downloadAndInstallModel(planId, options?)`, `inspectSafetensors(path)`, and `quarantineModel(path, reason, options?)`.
- `options.fetch` and temporary roots make integration tests offline and deterministic.

- [ ] **Step 1: Write failing local-server tests for a complete download, HTTP range resume, changed ETag restart refusal, expected-size mismatch, SHA mismatch, invalid Safetensors header, quarantine, identical destination reuse, and atomic final rename**

- [ ] **Step 2: Run integration tests and verify missing behavior**

Run: `node --test tests/integration/leo-fooocus-model-download.test.mjs`

- [ ] **Step 3: Implement streaming download and validation**

Store partial bytes under the Skill state directory or a dot-prefixed non-model extension, persist ETag and byte count, validate the little-endian Safetensors header length and JSON tensor offsets, then atomically move into the destination.

- [ ] **Step 4: Run download-plan and integration tests and verify all pass**

- [ ] **Step 5: Commit**

```bash
git add lib/skills/leo-fooocus-imagine/scripts/model-downloader.mjs tests/integration/leo-fooocus-model-download.test.mjs
git commit -m "feat(leo-fooocus-imagine): safely download and install models"
```

### Task 6: CLI routing, refresh, generation integration, and Skill documentation

**Files:**
- Modify: `lib/skills/leo-fooocus-imagine/scripts/leo_fooocus_imagine.mjs`
- Modify: `lib/skills/leo-fooocus-imagine/scripts/fooocus_gradio_client.py`
- Modify: `lib/skills/leo-fooocus-imagine/SKILL.md`
- Modify: `lib/skills/leo-fooocus-imagine/references/operations.md`
- Modify: `lib/skills/leo-fooocus-imagine/references/extension-guide.md`
- Modify: `package.json`
- Modify: `tests/unit/leo-fooocus-imagine-skill.test.mjs`
- Modify: `tests/unit/test_fooocus_gradio_client.py`
- Create: `tests/integration/leo-fooocus-model-routing-cli.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–5 modules.
- Produces CLI commands `recommend-models`, `model-plan`, `download-model`, `refresh-models`, and `generate --auto-model` with JSON results from the spec.
- Python adapter adds semantic discovery and invocation for Fooocus's live model refresh action when present.

- [ ] **Step 1: Write failing CLI tests for recommendation JSON, local auto-model selection, external download proposal without download, plan presentation, confirmed download invocation, no-confirm rejection, explicit model precedence, and refresh fallback**

Use a fake Fooocus config and local HTTP fixtures. Assert `generate --auto-model` never downloads.

- [ ] **Step 2: Write failing Python tests for semantic model-refresh discovery and unsupported refresh reporting**

- [ ] **Step 3: Run dedicated JS and Python tests and verify expected failures**

Run: `npm run test:leo-fooocus-imagine`

- [ ] **Step 4: Implement CLI composition and Python refresh support**

Keep the existing generation result contract and add routing under metadata. When a better external candidate exists, generation succeeds locally and reports it as optional.

- [ ] **Step 5: Update Skill instructions and operational references**

Document the confirmation boundary, local-first behavior, confidence handling, Hugging Face-only scope, command examples, and failure recovery. Do not duplicate the registry schema in `SKILL.md`.

- [ ] **Step 6: Run all model-routing tests and existing Fooocus tests**

Run:

```bash
npm run test:leo-fooocus-imagine
node --test tests/unit/leo-fooocus-model-*.test.mjs tests/integration/leo-fooocus-model-*.test.mjs
npm run check
```

- [ ] **Step 7: Run packaging and Skill validation**

Run:

```bash
node --test tests/unit/skills-library.test.mjs tests/unit/package-release.test.mjs
python -m py_compile lib/skills/leo-fooocus-imagine/scripts/fooocus_gradio_client.py
D:\Fooocus\python_embeded\python.exe C:\Users\xtea\.codex\skills\.system\skill-creator\scripts\quick_validate.py D:\agent-transfer\lib\skills\leo-fooocus-imagine
git diff --check
```

- [ ] **Step 8: Perform read-only live smoke tests**

Run `recommend-models` against the current Fooocus inventory for at least realistic Chinese-traditional portrait photography and anime illustration. Generate only with an adequate local model. Do not download a public model without a separate explicit user confirmation for the concrete plan.

- [ ] **Step 9: Commit**

```bash
git add package.json lib/skills/leo-fooocus-imagine tests/unit/leo-fooocus-imagine-skill.test.mjs tests/unit/test_fooocus_gradio_client.py tests/integration/leo-fooocus-model-routing-cli.test.mjs
git commit -m "feat(leo-fooocus-imagine): integrate automatic model routing"
```

### Task 7: Final verification and remote delivery

**Files:**
- Verify only; modify only if a failing test exposes a defect and add the regression test first.

**Interfaces:**
- Consumes the complete model-routing feature.
- Produces a clean verified branch synchronized with `origin/main`.

- [ ] **Step 1: Run the complete fresh verification set from Task 6**

- [ ] **Step 2: Inspect `git diff`, repository status, and commit history for unrelated or generated files**

- [ ] **Step 3: Fetch and verify divergence from `origin/main`**

- [ ] **Step 4: Push the implementation commits only after all verification succeeds**

- [ ] **Step 5: Verify `HEAD...origin/main` reports `0 0`, Fooocus remains healthy in the background, and report any untested public download path honestly**
