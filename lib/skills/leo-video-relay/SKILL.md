---
name: leo-video-relay
description: Use when the user gives a video link or local video file and wants it watched, understood, summarized, turned into technical or architecture notes, saved to Craft, or used as source material for Xiaohongshu or short videos. Also use when asked to do more with a video processed before. 视频理解、视频笔记、视频转知识、视频素材、二创。
---

# Leo Video Relay

Understand one video once, keep what it really says and shows as a fact pack, then build whatever the user asks for from that pack.

All commands: `node <skillDir>/scripts/relay.mjs <command>`. `<skillDir>` is this file's directory. Add `--help` for every flag.

## 1. Start

```bash
relay.mjs init <链接或视频路径>
```

| `status` | Next step |
|---|---|
| `exists` | The fact pack is at `dir`. Skip to step 5, unless the user asks to redo it (`init --force`). |
| `new` / `resume` | Continue with `run_dir`. |
| `choose_video` | A directory was given. Show `videos` and ask which one. |

For a web video, follow the `leo-yt-dlp` skill to download with exactly the `yt_dlp_args` that `init` returned, adding only what that skill needs for login or errors (such as `--cookies`). If that skill is missing, ask the user to install it.

## 2. Prepare

```bash
relay.mjs prepare <run_dir>
```

This covers metadata, subtitles, audio and frames, and can take a while on long videos, so run it in the background. If it stops, run it again and it continues. If a tool is missing, run `relay.mjs doctor`.

If `audio.status` is `skipped`, the video has uploaded subtitles in its own language, so there is no transcription. Tell the user in your next reply: `audio.reason`. Run `prepare <run_dir> --redo asr` if they want it transcribed anyway.

If the output has `transcribe`, use the `omnivoice` skill (VoiceStudio) to transcribe `transcribe.audio`, passing its `response_format` and `language`, and save the response to `transcribe.save_to`. Long audio can take a while, so run that in the background too. Then:

```bash
relay.mjs transcript <run_dir> --from <save_to>
```

For choosing or installing the model, and for timeouts, see [references/voicestudio-asr.md](references/voicestudio-asr.md).

If omnivoice still can't transcribe, tell the user why. Go on without a transcript only if the user agrees: `relay.mjs transcript <run_dir> --failed "<原因>"`.

Read the files named in `read_these`.

## 3. Watch

Repeat until every sheet is done:

1. `relay.mjs review <run_dir> --next` gives one contact sheet and which frame is in each cell.
2. Read the image.
3. `relay.mjs review <run_dir> --sheet <ID> --note "<看到了什么>"`
4. For anything worth citing or hard to see in the sheet (text, code, diagrams, whiteboards, key moments), read `<run_dir>/frames/<FRAME-ID>.jpg`, then `relay.mjs review <run_dir> --detail <ID,ID> --note "<读到了什么>"`.

Notes are saved in `frames/notes.md`, so work done survives a long session.

If you can't read images at all, run `relay.mjs review <run_dir> --blocked "<原因>"` and continue. The pack will be `partial`, and every fact must come from speech.

## 4. Record facts and publish

Write `<run_dir>/facts.draft.json` following [references/facts-schema.md](references/facts-schema.md), then:

```bash
relay.mjs check <run_dir>
```

Fix what it reports and rerun. `check` decides the final status. A `partial` status and its reasons go in your reply to the user.

`type` is the video's category for routing. Run `relay.mjs route list`, pick the closest configured type, or propose a short new name if none fits.

```bash
relay.mjs publish <run_dir>
```

Tell the user: 判定为 X，写到 Y，语音来源是 `speech_source`. If it returns `need_route`, ask once which directory this type should use, then run `relay.mjs route set <类型> [--workspace <目录>]` (without `--workspace` it uses the default) and publish again. If the user named a directory for this video, pass `--workspace <目录>` instead. For a local video the user wants archived, add `--copy-source`.

## 5. Do what the user asked

If the user named a goal, do it now. If not, stop here, summarize `facts.md` in a few lines, and ask what they want from it.

`relay.mjs scenes` lists the scenes. Read the matching file and follow it. For a goal with no matching scene, write to `产出/<目标名>/`.

Every output follows these rules:

- Build from `facts.json`. Go back to the transcript or frames only to verify.
- Label anything beyond the facts as inference or extension.
- Keep `unconfirmed` items visibly uncertain.
- Leave `facts.json` and `audit.json` unchanged.

To add a scene, drop a Markdown file with `name`, `when` and `output` frontmatter into `references/scenes/`.
