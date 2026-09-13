---
name: xtea-ark-tts-skill
description: Convert text into spoken audio with Volcengine Ark / Doubao TTS over the official HTTP streaming API. Use when the user asks for text-to-speech, TTS, voiceover generation, narration, reading text aloud, turning copy into MP3/WAV, or creating spoken audio from a script, paragraph, subtitle text, or article excerpt.
---

# Xtea Ark TTS Skill

## Overview

Use this skill to synthesize Chinese or multilingual speech from plain text and save the result as a local audio file. It is optimized for fast single-request narration and voiceover tasks, and reads Ark API credentials from Hermes, Claude Code, OpenClaw, or an explicit `--api-key`.

## Quick Start

`{baseDir}` = this skill directory. Main script: `{baseDir}/scripts/tts.js`

```bash
node {baseDir}/scripts/tts.js \
  --text "你好，欢迎使用火山方舟语音合成服务。" \
  --voice zh_female_vv_uranus_bigtts \
  --format mp3
```

The script prints structured JSON including:
- `file`: absolute path of the saved audio file
- `format`, `voice`, `sample_rate`
- `bytes_written`, `chunks_received`
- `usage` when the API returns token/word usage

## Workflow

1. Collect the text to speak.
2. Choose a voice only when the user explicitly asks for a specific persona, accent, or timbre. Otherwise keep the default voice.
3. Prefer `mp3` unless the user explicitly wants `wav` or raw PCM.
4. Run the script and save the file locally.
5. Return the saved audio path and any important metadata.

## Common Invocations

### Simple narration

```bash
node {baseDir}/scripts/tts.js \
  --text "把这段文案念出来。" \
  --format mp3
```

### Read from a text file

```bash
node {baseDir}/scripts/tts.js \
  --text-file ./script.txt \
  --voice zh_female_vv_uranus_bigtts \
  --save-dir ./tts-out
```

### Override the API key for one run

```bash
node {baseDir}/scripts/tts.js \
  --text "只在本次使用这个 key。" \
  --api-key ark-xxxx
```

### Save a provided API key for later runs

```bash
node {baseDir}/scripts/tts.js \
  --text "以后都自动用这个 key。" \
  --api-key ark-xxxx \
  --save-api-key
```

## Defaults

- Voice: `zh_female_vv_uranus_bigtts`
- Format: `mp3`
- Sample rate: `24000`
- Endpoint: `https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`
- Resource id: `seed-tts-2.0`

## API Key Resolution

The script resolves credentials in this order:
1. `--api-key`
2. `~/.hermes/config.yaml` `model.api_key`
3. `~/.claude/settings.json` `env.ANTHROPIC_AUTH_TOKEN`
4. `~/.openclaw/openclaw.json` `models.providers.*.apiKey`
5. Common environment variables such as `ANTHROPIC_AUTH_TOKEN`, `API_KEY`, `api_key`, `apiKey`

Only `ark-` keys are accepted.

## When To Read References

Read [api-notes.md](./references/api-notes.md) when you need:
- the exact request shape and headers
- troubleshooting for API or stream parsing errors
- parameter details and format choices

## Output Handling

- Prefer `--output` when the user cares about the exact filename.
- Otherwise use `--save-dir` or let the script create a timestamped file.
- Treat the returned file path as the primary result; do not paste base64 audio into chat.
