# leo-lantern

Standalone CLI for the local Leo Lantern control port.

```bash
node ./clis/leo-lantern/index.mjs health
node ./clis/leo-lantern/index.mjs tabs
node ./clis/leo-lantern/index.mjs click --text "登录"
```

## Stable browser targets

```bash
node ./clis/leo-lantern/index.mjs state
node ./clis/leo-lantern/index.mjs find --target '{"kind":"semantic","role":"button","name":"Sign in"}'
node ./clis/leo-lantern/index.mjs click --target '{"kind":"ref","ref":12,"generation":"GEN"}'
node ./clis/leo-lantern/index.mjs fill --target '{"kind":"css","selector":"#email"}' --value user@example.com
```

`state` returns a document `generation` and bounded element refs. `find` returns `matches_n` and refs for a CSS or semantic target. Ref actions require both the integer `ref` and matching `generation`; successful locator actions report `match_level: located`, while refs report `exact`, `stable`, or `reidentified`.
