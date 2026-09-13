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
