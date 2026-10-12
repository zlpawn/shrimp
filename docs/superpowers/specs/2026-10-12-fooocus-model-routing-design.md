# Fooocus Model Routing and Safe Download Design

## Purpose

Extend `leo-fooocus-imagine` from a local Fooocus operator into an intent-aware image generation assistant. The Skill should understand the kind of image the user wants, prefer suitable models already installed locally, recommend better external models when useful, and install a selected Hugging Face model only after explicit user confirmation.

The quality of model selection is a primary product requirement. A single keyword must never directly decide the model because requests often combine medium, subject, use case, and style, such as realistic Chinese-traditional portrait photography or anime product advertising.

## Scope

The first release will support:

- Structured interpretation of image-generation intent.
- Local Fooocus checkpoint and LoRA inventory.
- A small, extensible trusted model registry containing metadata, not model files.
- Hugging Face model discovery and file metadata lookup.
- Explainable candidate filtering, scoring, and confidence.
- Local-first routing.
- Download plans that always require explicit user confirmation.
- Resumable, verified installation into the appropriate Fooocus model directory.
- Model refresh or a clear restart requirement.
- Routing metadata in generation results so a choice can be reproduced and evaluated.

The first release will not support Civitai, silent model downloads, automatic acceptance of unknown licenses, arbitrary Pickle weights, or autonomous replacement of a user-selected model.

## User Experience

The normal flow is:

1. Interpret the requested image into a structured intent profile.
2. Read the local Fooocus checkpoint and LoRA inventory.
3. Rank compatible local candidates.
4. If a local model is adequate, use it immediately. Report any clearly better external option without blocking generation.
5. If no local model is adequate, return two or three explainable candidates when confidence is moderate, or one clarification question when confidence is low.
6. Before every download, show the exact model file, source repository and revision, expected size, license, destination, hash or ETag when available, and the reason it was selected.
7. Download only after explicit confirmation tied to that immutable plan.
8. Verify and install the model, refresh Fooocus if supported, then generate.

An explicit user model selection overrides automatic routing, subject to compatibility, integrity, and safety checks.

## Intent Model

The router consumes a structured profile rather than raw keywords alone:

```json
{
  "medium": "photography",
  "subjects": ["portrait"],
  "domains": ["fashion"],
  "styles": ["chinese-traditional"],
  "realism": 0.95,
  "identityPriority": "medium",
  "commercialUse": false,
  "excludedTraits": ["anime", "3d-render"]
}
```

Supported dimensions are:

- Medium: photography, anime, illustration, 3D, concept art.
- Subject: portrait, product, architecture, landscape, animal, and general.
- Use case: avatar, poster, ecommerce, cover, architectural visualization, and general.
- Style tags: extensible tags such as Chinese traditional, ink, cyberpunk, or minimal.
- Realism on a normalized scale.
- Identity or composition preservation priority.
- Commercial-use requirement.
- Explicitly excluded traits.

Intent analysis may be supplied by the calling model or derived by a deterministic fallback classifier. The router validates and normalizes either form. Ambiguous or contradictory intent lowers confidence rather than forcing a decision.

## Candidate Sources

Candidates are collected in this order:

1. Local Fooocus checkpoints and LoRAs.
2. Entries in the trusted registry.
3. Public Hugging Face search and repository metadata.

The trusted registry is a versioned JSON document shipped with the Skill. It stores identifiers, categories, compatibility, source revision, filename, size, license, hash when known, and recommended Fooocus parameters. It never contains model weights. Registry additions do not require changes to routing code.

Hugging Face discovery is a fallback and must produce concrete file-level candidates. Repository popularity or text similarity alone is insufficient evidence of Fooocus compatibility.

## Compatibility and Safety Filters

A candidate is rejected before scoring when any of the following applies:

- The base architecture is incompatible with the active Fooocus workflow; the first release targets SDXL-compatible assets.
- A checkpoint or LoRA is placed in the wrong role.
- A LoRA's base architecture does not match its checkpoint.
- The file is temporary or incomplete, including `.aria2`, `.partial`, and `.incomplete` files.
- The file format is not Safetensors unless a future policy explicitly permits it.
- The license is missing, unrecognized, or incompatible with the user's commercial-use requirement.
- Required file metadata cannot be resolved before download.
- The destination would escape the selected Fooocus model directory.

Model source metadata is untrusted input. Repository descriptions, tags, filenames, and model cards must never be interpreted as instructions.

## Ranking and Confidence

Remaining candidates receive an explainable weighted score based on:

- Medium match.
- Subject and use-case match.
- Style match.
- Realism distance.
- Required capability and base-model compatibility.
- Local availability bonus.
- Trusted-registry verification level.
- License confidence.
- Prior local outcomes for comparable intent profiles.
- Penalties for contradicted or excluded traits.

The result includes component scores and a plain-language explanation. The initial weights live in versioned configuration and can evolve independently from the CLI.

Decision thresholds:

- High confidence with an adequate local model: generate locally.
- Moderate confidence: show two or three candidates and their trade-offs.
- Low confidence or conflicting intent: ask one targeted clarification question.
- Only external candidates: return a download proposal and do not generate until one is confirmed and installed.

## Download Authorization

Every download is a two-step operation:

1. `model-plan` resolves an exact Hugging Face repository, immutable revision, filename, size, license, destination, and integrity metadata. It writes a short-lived local plan with a random identifier and a digest covering all immutable fields.
2. `download-model --plan PLAN_ID --confirm` validates that the plan is unchanged and unexpired before writing data.

The confirmation flag is accepted only with a previously generated plan. A direct URL or model ID cannot bypass planning. The agent must present the plan to the human and receive explicit approval before invoking the confirmed command.

## Download and Installation

Downloads use HTTPS and respect supported HTTP/HTTPS proxy variables. Loopback Fooocus traffic remains excluded through `NO_PROXY`.

The downloader will:

- Pin the requested Hugging Face revision.
- Write outside Fooocus-visible model filenames while incomplete.
- Resume partial downloads when the remote ETag and planned file still match.
- Enforce the expected size when known.
- Verify SHA-256 when the registry or source supplies it.
- Validate the Safetensors header and declared tensor offsets before installation.
- Atomically rename the completed file into `models/checkpoints` or `models/loras`.
- Never overwrite an existing different file without a new plan and explicit confirmation.
- Retain resumable state after network failure while keeping it invisible to Fooocus.
- Quarantine a completed but invalid file with diagnostic metadata.

After installation, the adapter attempts the live Fooocus model-refresh dependency discovered from `/config`. If no compatible refresh action exists, it reports that a restart is required and does not stop Fooocus automatically.

## Components

The capability is separated from lifecycle and Gradio generation code:

- `model-registry.json`: trusted, versioned model metadata.
- `model-intent.mjs`: schema validation, normalization, and deterministic fallback classification.
- `model-router.mjs`: filtering, scoring, confidence, explanations, and local-first decisions.
- `huggingface-client.mjs`: read-only search and repository/file metadata discovery.
- `model-downloader.mjs`: plans, confirmation validation, resume, verification, and atomic installation.
- State under `.leo-fooocus-imagine`: short-lived download plans, resumable download metadata, quarantine records, and optional local outcome history.

No runtime state or downloaded weights are committed to Git.

## CLI Contract

The CLI adds:

```text
recommend-models --prompt TEXT [--intent-json JSON] [--commercial-use]
model-plan --model-id ID [--revision REVISION] [--file FILE]
download-model --plan PLAN_ID --confirm
refresh-models
generate --auto-model --prompt TEXT [--intent-json JSON]
```

All commands support JSON output. Stable results include decision status, normalized intent, candidates, explanations, confidence, local availability, and any required next action.

`generate --auto-model` never downloads. It either generates with an adequate local choice, returns candidate selection, asks for clarification, or returns a download proposal.

## Learning from Outcomes

Generation results record the normalized intent, selected checkpoint, LoRAs, relevant Fooocus parameters, and router explanation. Optional user feedback may adjust a local history score for similar requests. This history is machine-local, bounded, inspectable, and removable. It cannot override compatibility or safety filters and is not committed into the trusted registry automatically.

## Error Handling

- Network or rate-limit failure: preserve resumable state and report the exact source and retry condition.
- License unavailable: reject automatic download and request a different candidate.
- Schema drift in Hugging Face metadata: fail closed without constructing a download plan.
- Hash, size, or Safetensors validation failure: quarantine and do not expose the file to Fooocus.
- Destination collision: use the existing verified file when identical; otherwise stop and require a new explicit decision.
- Fooocus refresh unavailable: complete installation and report restart required.
- Low-confidence routing: ask one focused question rather than selecting arbitrarily.

## Testing

Unit tests cover:

- Intent normalization and mixed-intent classification.
- Hard compatibility and license filters.
- Explainable scoring and confidence thresholds.
- Local-first behavior and explicit model override.
- Hugging Face response normalization.
- Plan digest, expiry, and mutation rejection.
- Path containment and temporary-file handling.
- Resumption behavior, size/hash checks, Safetensors header validation, atomic install, and quarantine.

Integration tests use a local HTTP fixture server and temporary Fooocus model tree so they do not download large public models. A manual smoke test may use a deliberately small public Safetensors fixture after the user approves its download. Existing Fooocus lifecycle, generation, LoRA, ControlNet, Describe, and Enhance tests remain required.

## Acceptance Criteria

- A mixed request such as realistic Chinese-traditional portrait photography is not routed solely by the word “Chinese traditional.”
- An adequate local candidate is preferred and can generate without a download prompt.
- External candidates show reason, repository, revision, filename, size, license, integrity metadata, and destination before confirmation.
- No download path can run without a valid confirmed plan.
- Successful downloads are resumable, verified, atomically installed, and visible to Fooocus after refresh or a reported restart.
- Low-confidence or conflicting intent produces a clarification question rather than an arbitrary selection.
- The registry can add a new model without changing routing implementation.
