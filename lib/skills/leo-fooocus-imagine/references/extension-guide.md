# Extension guide

This Skill is a stable façade over evolving Fooocus runtimes. Extend behind the CLI contract rather than adding version-specific steps to `SKILL.md`.

## Layers

1. **Lifecycle** — installation discovery, idempotent install, process state, logs, health and explicit stop.
2. **Capability model** — stable operation names such as `text-to-image`, `vary`, `upscale`, `inpaint`, `outpaint`, `image-prompt`, `enhance`, and `describe`.
3. **Backend adapters** — translate the capability request to original Gradio, Fooocus-API/FastAPI, or a future official API.
4. **Model facts** — expose local inventory and verify exact external files while leaving creative selection to the calling model.
5. **Artifacts** — normalize generated images, seeds, metadata and diagnostics into one result shape.

## Stable result contract

Every successful image operation should return JSON shaped like:

```json
{
  "status": "success",
  "backend": "official-gradio",
  "capability": "text-to-image",
  "images": ["C:/absolute/output.png"],
  "seed": 123,
  "metadata": {}
}
```

Add fields without renaming or removing existing ones. Put backend-specific details under `metadata`.

## Adding an adapter

- Probe with a cheap, read-only endpoint.
- Publish a capability set; never claim unsupported operations.
- Translate the stable request into the backend payload.
- Validate returned paths or URLs and normalize them to local artifacts.
- Add fixtures and contract tests before registering the adapter.
- Prefer explicit schema/version checks. Fail closed when required fields disappear.

For original Gradio, derive the preparation dependency, state component, generator dependency and semantic input IDs from `/config`. Labels and `elem_id` are stronger signals than numeric component IDs. Component defaults are the source of truth for unspecified advanced parameters.

For a FastAPI adapter, discover from `/openapi.json`, prefer asynchronous jobs, poll with bounded backoff, and support cancellation when the server exposes it. Keep its process and port state separate from original Fooocus.

## Adding a capability

1. Add the stable operation name and request fields.
2. Add tests for parsing, adapter mapping, missing prerequisites and result normalization.
3. Implement it in each compatible adapter or leave it absent from that adapter's capability report.
4. Add one concise example to `SKILL.md` only when users/agents need a new invocation pattern; keep detailed schemas here.

The original-Gradio adapter currently supports multiple LoRA and ControlNet slots, image description, and first-stage face/detail enhancement. The CLI also exposes local model inventory and confirmation-gated Hugging Face Safetensors installation without embedding a fixed recommendation catalog. Good future additions include mask generation, metadata replay, job cancellation, queued generation, additional Enhance stages, and versioned update/rollback.

## Updating Fooocus

Ordinary startup never updates an existing installation. A future `update` capability should:

- check without mutation;
- refuse in-place update of a dirty Git tree;
- build a versioned candidate installation;
- reuse model/output directories through configuration rather than copying large files;
- run import, health, API-contract and one-image smoke tests;
- switch only after success and retain the previous working version for rollback.

Record an API schema fingerprint and a tested adapter version with every supported Fooocus release.
