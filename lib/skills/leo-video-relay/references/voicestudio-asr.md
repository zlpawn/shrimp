# VoiceStudio ASR model

Read this the first time you transcribe on a machine, when omnivoice reports a missing model, when a transcript reads badly, or when a transcription times out.

All routes are on VoiceStudio's local server, the same host omnivoice uses.

## Check what is active

- `GET /engines/asr`: `active` is the current engine, and `backends` shows which are available.
- `GET /models`: entries with `role` of `ASR`, with `installed` and `size_gb`.

## Use the best model

| Machine | `repo_id` | `backend_id` |
|---|---|---|
| Apple Silicon | `mlx-community/whisper-large-v3-mlx` | `mlx-whisper` |
| Other | `Systran/faster-whisper-large-v3` | `faster-whisper` |

These handle Chinese and mixed-language audio. If `GET /models` lists a newer flagship, prefer it.

If the active engine and model already match, change nothing. Otherwise:

1. Tell the user the model name and download size.
2. `POST /models/install` with `{"repo_id": "<repo_id>"}`. It downloads in the background, so poll `GET /models` until `installed` is true.
3. `POST /engines/select` with `{"family": "asr", "backend_id": "<backend_id>", "model_id": "<repo_id>"}`.

If the download fails with an SSL or connection error and a system proxy is on, ask the user to route `hf-mirror.com` directly, then retry.

## When a transcription times out

VoiceStudio abandons a transcription after 300 seconds and returns HTTP 504. The abandoned call keeps its capacity until it exits, so a retry right away can time out too. Save nothing from a 504: `transcript --from` rejects the error body.

1. Show the user the error text.
2. `POST /system/flush-memory`, wait a few minutes, then retry once.
3. If it times out again, offer the user these two fixes, and do both if the audio is long:
   - Raise `OMNIVOICE_ASR_TRANSCRIBE_TIMEOUT_S` and restart VoiceStudio. On a machine that transcribes near real time, audio over about five minutes can't finish within the default limit.
   - Switch to the engine VoiceStudio recommends when MLX hangs: install `Systran/faster-whisper-large-v3`, then select `backend_id` `faster-whisper-isolated`. It runs on the CPU on a Mac, so it may be slower.
