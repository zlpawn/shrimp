# Architecture

leo-capcut is one Skill with layered templates, not a family of scene skills.

```text
SKILL.md routes the run
assets/templates/{scenarios,styles,platforms} hold system templates
scripts/leo_capcut holds brief, timeline, presets, and the Jianying adapter
```

Runtime composition:

```text
request > project settings > user preset > platform > scenario > system defaults
```

The Jianying adapter is a module, not a skill. Scene templates must not mention DLL paths, homepage indexes, or host-specific draft folders.

Windows: implemented and locally verified against Jianying 11.4 draft encryption/registration.
macOS: same interface, planned until native verification of app bundle, draft directory, homepage index, and encryption.

## Speech & Audio Delegation (Skill-to-Skill)

`leo-capcut` delegates speech synthesis and transcription to dedicated speech skills:
- **Primary (Local & Cloned Voices)**: `omnivoice` (`~/.agents/skills/omnivoice`) via VoiceStudio at `http://localhost:3900/v1`. Free, offline, zero cloud leakage, supports user cloned voices and Whisper subtitle timing.
- The pipeline passes script text to `omnivoice`, receives audio file paths and subtitle timings, and embeds them into Timeline IR tracks.
