# leo-lantern

Standalone stdio MCP server for Leo Lantern.

```bash
node ./mcps/leo-lantern/index.mjs
```

## Stable browser targets

Use `browser_state` to obtain a document generation and numeric element refs, then `browser_find` to locate CSS/semantic targets. `browser_click` and `browser_fill` accept the same target union:

```json
{ "kind": "ref", "ref": 12, "generation": "GEN" }
{ "kind": "css", "selector": "button.primary" }
{ "kind": "semantic", "role": "button", "name": "Sign in" }
```

Responses preserve `ref`, `generation`, `matches_n`, and `match_level`; failures preserve Lantern structured error objects.
