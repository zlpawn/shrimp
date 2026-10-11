---
name: leo-fooocus-imagine
description: Use when the user wants to install, start, diagnose, or use local Fooocus for text-to-image, variations, upscaling, inpainting, outpainting, reference-image generation, or iterative image refinement. Reuse an existing installation and keep Fooocus running in the background unless the user explicitly asks to close it.
---

# Leo Fooocus Imagine

Operate Fooocus as a persistent local image engine through one stable CLI. The CLI owns installation discovery, background lifecycle, API adaptation, output discovery, and future capability routing; do not reproduce Fooocus's Gradio parameter list manually.

## Core contract

- Run the bundled CLI for every lifecycle or image operation:
  `node <skill-dir>/scripts/leo_fooocus_imagine.mjs ...`
- Prefer the original Fooocus installation already on the machine. `install` is idempotent and returns `reused` when one is available.
- `generate` calls `ensure-running` internally. Starting Fooocus is an ordinary implementation step and should normally happen in the background.
- Leave Fooocus running after generation and across iterations. Run `stop` only when the user explicitly asks to close, stop, or shut down Fooocus.
- Bind the service to loopback. Do not expose Gradio or a REST adapter to the LAN or Internet unless the user explicitly asks and appropriate authentication is configured.
- Never update, reset, overwrite, or clean an existing Fooocus tree merely to make the Skill work. Existing models, presets, outputs, local Git changes, and configuration belong to the user.
- A model download can be several GB. If a requested preset or model is absent, explain the expected download before initiating it unless the user already requested that installation/download.

## Workflow

1. Run `doctor --json`. It reports detected installations, runtime health, backend type, and capabilities.
2. When no installation exists, run `install`. On Windows this downloads the official portable build into an empty target. If extraction support is unavailable, report the exact blocker and official URL; never pretend installation succeeded.
3. Run the requested `generate` mode. Use the user's requested model or style; otherwise preserve the installation defaults.
4. Return every absolute image path emitted by the CLI and render the result when the host supports local images.
5. For iteration, use the previous result as `--input`, preserve the successful seed/model when consistency matters, and change only the attributes requested by the user.

Completion means the CLI reports `status: success`, every returned file exists, and the resulting image is shown or linked to the user.

## Commands

```bash
# Inspect installation and runtime
node <skill-dir>/scripts/leo_fooocus_imagine.mjs doctor --json

# Idempotent install/reuse
node <skill-dir>/scripts/leo_fooocus_imagine.mjs install --json

# Explicit background start (generate also does this)
node <skill-dir>/scripts/leo_fooocus_imagine.mjs start --json

# Text to image
node <skill-dir>/scripts/leo_fooocus_imagine.mjs generate \
  --prompt "cinematic portrait, soft window light" \
  --negative "text, watermark, distorted hands" \
  --aspect-ratio "3:2" --count 1 --json

# Variation or upscale
node <skill-dir>/scripts/leo_fooocus_imagine.mjs generate \
  --mode vary --input "/absolute/source.png" \
  --prompt "keep the composition, warmer evening light" --json

# Inpaint (mask is white where Fooocus should edit)
node <skill-dir>/scripts/leo_fooocus_imagine.mjs generate \
  --mode inpaint --input "/absolute/source.png" --mask "/absolute/mask.png" \
  --prompt "replace the cup with a small vase" --json

# Outpaint
node <skill-dir>/scripts/leo_fooocus_imagine.mjs generate \
  --mode outpaint --input "/absolute/source.png" --outpaint "Left,Right" \
  --prompt "continue the scene naturally" --json

# Reference image / image prompt
node <skill-dir>/scripts/leo_fooocus_imagine.mjs generate \
  --mode image-prompt --input "/absolute/reference.png" \
  --prompt "same visual identity, winter clothing" --json

# Only after an explicit user request to close Fooocus
node <skill-dir>/scripts/leo_fooocus_imagine.mjs stop --json
```

Useful options: `--fooocus-home`, `--port`, `--model`, `--refiner`, `--styles`, `--performance`, `--seed`, `--output-format`, and `--output-dir`.

## Backend and compatibility rules

The default adapter targets original Fooocus's Gradio server. It fetches `/config`, discovers the preparation and generator dependencies from component semantics, builds arguments from live defaults, and overrides only requested fields. Do not hard-code `fn_index` values: Fooocus 2.5.5 often uses 67 and 68, but UI changes can move them.

When the runtime exposes a structured Fooocus REST API instead, add or select a REST adapter behind the same CLI contract. Read [references/extension-guide.md](references/extension-guide.md) before changing adapters, adding commands, or supporting a new Fooocus version.

For image modes, model management, update policy, failure recovery, and capability maturity, read [references/operations.md](references/operations.md).

## Output and iteration

- Default outputs remain in the installation's configured Fooocus output directory. `--output-dir` copies final results to a caller-selected directory.
- Keep the full prompt, negative prompt, model, seed, styles, mode, and source image path in the work summary so the next iteration is reproducible.
- When the user asks for an adjustment, inspect the generated image when possible. Do not assume the prompt succeeded merely because a file exists.
- Preserve identity/composition by using `vary` or `image-prompt`; use `inpaint` for a localized change; use `outpaint` for canvas expansion; use `upscale` only when the requested change is resolution/detail rather than content.

## Failure handling

- A port owned by an unknown process is not permission to kill it. Choose another port or ask the user.
- Stop only the PID recorded by this Skill after its executable and command line still match Fooocus.
- Proxy environment variables using unsupported schemes can break old Fooocus/httpx. The CLI removes `ALL_PROXY` only from its child processes and sets loopback `NO_PROXY`; it never changes global user settings.
- On CUDA OOM or driver crashes, retain the prompt/seed, report the actual diagnostic, and prefer a smaller count, lower-memory launch option, or known-working model. Do not silently change the user's creative request.
- If the live API schema cannot be discovered, stop with an adapter mismatch. Do not guess indexes or submit a partially mapped request.
