# Output Workspace

## Purpose

Keep generated business knowledge separate from source evidence while giving AI and people one
stable way to find the latest published revision.

## Location Contract

For a normal writable primary repository, the default output root is:

```text
<repository-root>/_business_knowledge/
```

An explicitly requested output root takes precedence. It must be an absolute path.

Use an external output root when the analyzed repository is:

- a reference or acceptance repository;
- a detached worktree;
- read-only;
- otherwise unsuitable for generated files.

Reference and acceptance runs must not write generated knowledge into the analyzed repository.
Never write into a Reversa workspace or reuse Reversa output as canonical knowledge.

Resolve the path deterministically with `resolve_workspace_root(...)` from
`scripts/business_knowledge_guard.py`. The `publish` command accepts `--repo` and an optional
`--workspace`; without `--workspace`, it uses the default above.

## Directory Layout

```text
_business_knowledge/
├── current.json
├── runs/
│   └── <run-id>/
│       ├── repository-snapshot.json
│       ├── run-manifest.json
│       ├── staging-artifacts/
│       └── diagnostics/
└── revisions/
    └── <revision-id>/
        ├── manifest.json
        ├── ai-context.md
        ├── site/
        │   └── index.html
        ├── inventory.jsonl
        ├── capabilities.json
        ├── actors.json
        ├── use-case-families.json
        ├── use-cases.jsonl
        ├── business-rules.jsonl
        ├── workflows.jsonl
        ├── state-machines.json
        ├── domain-events.jsonl
        ├── entities.json
        ├── glossary.json
        ├── aliases.json
        ├── relationships.jsonl
        ├── investigations.jsonl
        ├── evidence.jsonl
        ├── conflicts.jsonl
        ├── unknowns.jsonl
        ├── semantic-review.json
        ├── coverage.json
        └── change-impact.json
```

Run artifacts are mutable working material. Published revisions are immutable.

## Current Revision

`current.json` is the only mutable publication pointer. It contains exact repository-relative paths:

```text
ai_path   -> revisions/<revision-id>/ai-context.md
html_path -> revisions/<revision-id>/site/index.html
```

AI reads `ai-context.md` first, then retrieves canonical JSON/JSONL records as needed. People open
`site/index.html` directly. Both projections must identify the same canonical revision hash.

## Snapshot Isolation

The output root must not enter the source evidence snapshot. The default
`_business_knowledge/**` exclusion is mandatory. When an explicit workspace is located inside the
repository, add its repository-relative path to snapshot exclusions before freezing scope.

Do not publish if the output location changed after the snapshot was frozen. Record the resolved
absolute workspace path in the run manifest.

## Publication Rules

1. Build and validate under `runs/<run-id>/staging-artifacts/`.
2. Copy a passing or useful partial revision to a new immutable `revisions/<revision-id>/`.
3. Never edit an existing published revision.
4. Atomically replace `current.json` only after the revision is complete.
5. A failed run remains under `runs/` and must not alter the current pointer.
