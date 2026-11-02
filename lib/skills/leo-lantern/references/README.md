# leo-lantern

Standalone CLI for the local Leo Lantern control port.

```bash
node <skillDir>/scripts/cli/index.mjs health
node <skillDir>/scripts/cli/index.mjs tabs
node <skillDir>/scripts/cli/index.mjs click --text "登录"
```

## Stable browser targets

```bash
node <skillDir>/scripts/cli/index.mjs state
node <skillDir>/scripts/cli/index.mjs find --target '{"kind":"semantic","role":"button","name":"Sign in"}'
node <skillDir>/scripts/cli/index.mjs click --ref 12
node <skillDir>/scripts/cli/index.mjs fill --sel "#email" --val user@example.com
```

`state` returns a document `generation` and bounded element refs. `find` returns `matches_n` and refs for a CSS or semantic target. Ref actions require both the integer `ref` and matching `generation`; successful locator actions report `match_level: located`, while refs report `exact`, `stable`, or `reidentified`.
