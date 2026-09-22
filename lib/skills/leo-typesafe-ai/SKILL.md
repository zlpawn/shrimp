---
name: leo-typesafe-ai
license: MIT
description: Build provider-neutral TypeSafe/System One AI decisions with typed Choice, Noul, and Score judgments. Use when designing or calling TypeSafe-compatible decision APIs for routing, classification, scoring, extraction, verification, or confidence-gated workflows through OpenRouter, TypeSafe official, or a custom compatible provider.
---

# Leo TypeSafe AI

Build small, typed AI judgments that application code can compose. This is a standalone, multi-provider extension derived from TypeSafe's MIT-licensed official agent skill; it is not maintained by TypeSafe.

## Required reading

Before designing or implementing a TypeSafe workflow, read [references/official-typesafe-ai.md](references/official-typesafe-ai.md) completely. It is an unmodified snapshot of the official skill and defines the programming model, question design, confidence handling, and verification practices.

Then read only the provider material needed for the task:

- For API calls, credentials, provider selection, curl diagnostics, or custom endpoints, read [references/providers.md](references/providers.md).
- For updating the embedded official snapshot, use `scripts/sync-official.mjs`; do not edit the snapshot by hand.

## Provider policy

Preserve the user's explicit provider, endpoint, model, and credential choice. Provider selection changes transport and billing, not the meaning of `state`, `questions`, or typed answers.

When the user does not choose a provider, use OpenRouter's TypeSafe SDK-compatible System One endpoint. This local default is a convenience, not a claim that OpenRouter is part of TypeSafe.

The normal setup requires one environment variable only:

```text
LEO_TYPESAFE_API_KEY
```

It means “the API key for the provider selected for this invocation.” The script also recognizes `OPENROUTER_API_KEY` and `TYPESAFE_API_KEY` as compatibility fallbacks. Do not require users to configure all of them.

Provider is normally selected with a command argument rather than another environment variable:

```bash
node scripts/decide.mjs --provider openrouter --input request.json
node scripts/decide.mjs --provider typesafe --input request.json
node scripts/decide.mjs --provider custom --url https://example.com/v1/systemone --input request.json
```

For custom providers, prefer `LEO_TYPESAFE_API_KEY`. Use `--api-key-env NAME` only when the caller already has a differently named secret and explicitly wants to reuse it. Never put a secret directly in a command-line argument, request file, skill document, or source file.

## Calling decisions

Use `scripts/decide.mjs` for repeatable API calls. It uses Node's native HTTP support, has no SDK dependency, keeps credentials in environment variables, validates the request shape, applies a bounded retry for transient overloads, and emits the raw JSON response.

```bash
node scripts/decide.mjs --input request.json
```

The default invocation uses:

```text
provider: openrouter
endpoint: https://openrouter.ai/api/v1/systemone
model: jev-latest
key: LEO_TYPESAFE_API_KEY, then OPENROUTER_API_KEY as fallback
```

Use `--dry-run` to inspect the resolved provider, endpoint, model, and payload without sending a request or exposing the credential.

Use curl only for manual diagnosis or reproducing a raw HTTP exchange. Prefer the script for agent and application workflows because it handles cross-platform JSON input, HTTP errors, timeouts, and retries consistently.

## Keep code in control

Use the model for narrow semantic judgments. Keep deterministic rules, permissions, calculations, data access, execution, retry policy, and escalation behavior in code. Treat typed output as an interface guarantee, not a truth guarantee. Calibrate thresholds on representative data and make uncertain or high-consequence actions fall back safely.

## Updating from the official skill

The embedded official snapshot is deliberately isolated from Leo-specific instructions and provider support. This makes future updates repeatable:

```bash
node scripts/sync-official.mjs --check
node scripts/sync-official.mjs --diff
node scripts/sync-official.mjs --apply
```

`--apply` replaces only `references/official-typesafe-ai.md` and updates `official-source.json`. After applying, review semantic changes affecting APIs, authentication, models, primitives, confidence, migration, or deprecations, then run the skill tests. A successful file copy does not by itself prove provider compatibility.

