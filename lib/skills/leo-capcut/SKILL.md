---
name: leo-capcut
description: "Use when the user wants to make a CapCut/Jianying video from natural language, generate an editable Jianying draft, publish a timeline to Jianying, save a personal video template, or continue AI video editing without clicking the Jianying UI. Supports Windows now and macOS as a planned adapter. Do not use for Remotion/HyperFrames rendering or generic ffmpeg-only cuts."
---

# Leo CapCut

Turn natural language into an editable Jianying draft. Do not click the Jianying UI. Generate Timeline IR, then let the Jianying adapter publish the draft, or headlessly export to MP4 via FFmpeg.

## When to use

- The user wants a short video, talking-head, promo, or tutorial as a Jianying project.
- The user asks to write into Jianying, generate a Jianying draft, or register it on the homepage.
- The user explicitly says they want to save a personal template.
- The user wants speech/talking-head video cutting (speech-cut) with silence removal, filler removal, and synchronized subtitles.
- The user wants to inspect or surgically modify an existing Jianying draft (inspect-draft / modify-draft) without GUI clicks.
- The user wants headless MP4 export directly from Timeline IR or existing drafts via FFmpeg.
- The user wants custom fonts embedded into drafts.

Do not use this skill to reverse Jianying account APIs, read cookies/tokens, or GUI-click the editor.

## Pipeline

```text
natural language / media + transcript
-> Creative Brief / Speech Planner
-> Script
-> Storyboard
-> Timeline IR
-> Jianying Adapter / FFmpeg Renderer
-> editable Jianying draft / MP4
```

Done when the Timeline IR validates. If the user asked to write into Jianying, also produce an encrypted draft, copy media into the draft, and register the homepage only while Jianying is not running.

## Voiceover & Speech Collaboration Protocol

When a video requires speech synthesis, voiceover narration, or subtitle alignment:
1. Do not hardcode custom TTS synthesis engines into `leo-capcut`.
2. Awaken and invoke the peer `omnivoice` skill (`~/.agents/skills/omnivoice`):
   - Check backend health at `http://localhost:3900/health` (VoiceStudio).
   - Synthesize narration via `http://localhost:3900/v1/audio/speech` (prioritizing user cloned voice profiles discovered via `/v1/audio/voices`).
   - Extract millisecond-precision subtitles via `http://localhost:3900/v1/audio/transcriptions` (model `whisper-1`, `response_format=srt`).
3. Return the generated `.wav`/`.mp3` and `.srt` to `leo-capcut`:
   - Map narration into `tracks[type=audio]`.
   - Map synchronized subtitles into `tracks[type=text]`.
   - Align camera zoom keyframes, kinetic flower text, and shot cuts to speech cadence and word timing.

Resolve SKILL.md as SKILL_ROOT and run:

```text
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" <command>
```

## Hard rules

1. Keep one skill. Scene differences live in templates, not extra skills.
2. Never assemble Jianying JSON directly. Validate Timeline IR first.
3. Create or update a personal template only when the user explicitly says "保存为模板", "把这套风格存下来", "更新我的产品宣传模板", or "另存为一个新模板".
4. A normal project edit is not a template change.
5. Templates and export packs use logical URIs such as asset://my-tech-promo/brand-logo. No Windows/macOS absolute paths.
6. Do not modify the homepage index while Jianying is running. Do not overwrite an existing draft. Always mint a new project ID. Backup root_meta_info.json before register and roll back on failure.
7. Do not read or expose cookies, tokens, or account credentials. Do not upload media unless asked.
8. Windows status is implemented and locally verified. macOS status is planned and requires native verification.
9. Never modify existing drafts in-place: always clone a clean copy with a new project ID for declarative patches.
10. Speech cuts must apply 20ms crossfade at cut boundaries to prevent audio pops; subtitle timestamps must be strictly monotonic.
11. Headless MP4 export must perform ffprobe duration and quality assertions before declaring completion.

## Merge order

```text
this request
> project settings
> user preset
> platform template
> scenario template
> system defaults
```

Load only the current scenario file when needed:

- [knowledge-talk](references/scenarios/knowledge-talk.md)
- [product-promo](references/scenarios/product-promo.md)
- [tutorial](references/scenarios/tutorial.md)
- [generic](references/scenarios/generic.md)

Also see [architecture.md](references/architecture.md), [timeline-ir.md](references/timeline-ir.md), and [safety.md](references/safety.md).

## Commands

```text
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" doctor
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" plan --text "做一条 12 秒知识口播" --media <video>
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" publish --text "做一条 12 秒知识口播" --media <video> --register
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" speech-cut --media <video> --transcript <transcript.json> --remove-silence-over 0.6 --remove-fillers "呃,啊,然后" --bgm <bgm.mp3> --out-draft <draft_path> --export <out.mp4>
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" inspect-draft --draft <draft_dir>
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" modify-draft --draft <draft_dir> --patch '<patch_ops_json>' --out-name <new_name>
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" export --timeline <timeline.json> --out <out.mp4> [--font <font_path>]
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" export --draft <draft_dir> --out <out.mp4> [--font <font_path>]
<PYTHON> "<SKILL_ROOT>/scripts/leo_capcut_cli.py" save-preset --intent "保存为模板" --id my-tech-promo --scenario knowledge-talk
```

## Completion Gates

- [ ] Scenario/style/platform selected; the current request overrides template defaults.
- [ ] Timeline IR validates: assets exist, tracks do not overlap, clips stay in range.
- [ ] No personal template was created without an explicit save request.
- [ ] Jianying was not running before homepage registration; backup exists; failure can roll back.
- [ ] Existing drafts are never overwritten in-place; modified drafts use newly minted project IDs and independent copies.
- [ ] Speech cuts apply 20ms crossfade at cut seams and maintain monotonic subtitle synchronization.
- [ ] Headless MP4 export passes ffprobe duration and quality integrity checks.
- [ ] Windows drafts are encrypted and media lives in agent_media.
- [ ] macOS reports planned unless native verification exists.
