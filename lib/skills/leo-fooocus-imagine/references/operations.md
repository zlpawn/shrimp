# Fooocus operations

## Installation detection

Detection order:

1. `--fooocus-home`, `LEO_FOOOCUS_HOME`, then `FOOOCUS_HOME`.
2. Skill-managed installation state.
3. Common portable/source locations.
4. A running loopback service whose backend can be identified.

A Windows portable installation contains `Fooocus/launch.py` and `python_embeded/python.exe`. A source installation contains `launch.py` and a usable virtual-environment Python. Detection is read-only; never repair or update during detection.

## Lifecycle

- Launch original Fooocus through `launch.py`, not `entry_with_update.py`, so normal operation does not pull updates.
- Use `--disable-in-browser --listen 127.0.0.1` and a recorded port.
- Redirect stdout/stderr to the Skill state directory and wait for API health.
- Reuse a healthy service. A generation command never stops it afterward.
- Explicit stop verifies PID, executable and `launch.py` in the command line before terminating the process tree.

## Capability routing

| User intent | Capability/mode | Required inputs |
|---|---|---|
| Create a new image | `text-to-image` / `text` | prompt |
| Similar alternative | `vary` | input image, prompt |
| Increase resolution | `upscale` | input image |
| Change a local region | `inpaint` | input image, mask, prompt |
| Extend the canvas | `outpaint` | input image, directions, prompt |
| Preserve/reference identity or style | `image-prompt` | reference image, prompt |
| Improve detected faces/details | `enhance` | input image, detection target |
| Caption an image | `describe` | input image |

The current original-Gradio adapter implements text, vary, upscale, inpaint, outpaint, reference images, LoRA, ControlNet, image description, and first-stage Enhance. Capabilities reported by `doctor` are derived from the live Fooocus schema.

## Advanced image controls

- Repeat `--lora MODEL|WEIGHT` to fill available LoRA slots. Use `models --json` before choosing a filename; the adapter validates it against live choices.
- Repeat `--control IMAGE|TYPE|STOP_AT|WEIGHT` to fill available Fooocus control slots. Supported live types are `ImagePrompt`, `PyraCanny`, `CPDS`, and `FaceSwap`.
- `ImagePrompt` transfers broad visual identity or style, `PyraCanny` follows strong edges, `CPDS` follows depth/composition, and `FaceSwap` uses a face reference.
- `describe` returns a caption and suggested styles. Its first use may download the official BLIP caption model (about 855 MB).
- `enhance` detects a requested region and runs Fooocus enhancement on it. Its first use may download GroundingDINO and SAM-related models.
- The number of usable LoRAs and controls is limited by the slots exposed by the running Fooocus version. Do not silently discard excess requests.

## Models and downloads

- Check available checkpoint and LoRA filenames before selecting them.
- Treat `.aria2` as a resumable-download sidecar, not a model.
- Do not delete a partial download while an aria2 process is active.
- Do not download a missing multi-GB checkpoint merely because a preset is selected. Explain and obtain intent unless the user already asked to install/use that model.
- Validate completed checkpoints by nontrivial size and, when Fooocus reports `MetadataIncompleteBuffer` or `PytorchStreamReader`, quarantine the corrupt file before redownloading.

## Diagnostics

- **API unavailable:** inspect logs and verify process/port identity.
- **Unsupported proxy scheme:** remove `ALL_PROXY/all_proxy` only in Fooocus/client child environments; retain HTTP(S) proxy variables if usable and always set loopback `NO_PROXY`.
- **CUDA OOM:** reduce image count, avoid simultaneous models/refiner, use low-VRAM launch options, then retry once with the same prompt/seed.
- **Driver crash (`nvcuda64.dll`):** report the driver-level crash; API/UI changes will not fix it. Restart once only after preserving logs.
- **Schema drift:** fail with the discovered component/dependency summary and add/update an adapter; never guess `fn_index`.
- **No output after success:** treat as failure and inspect the configured output directory and generation log.

## Security

- Loopback is the default boundary.
- Do not enable `share=True` or bind `0.0.0.0` implicitly.
- Validate input paths, result paths and remote image URLs.
- When a future REST adapter is exposed beyond loopback, require authentication and restrict URL fetching to prevent SSRF.
