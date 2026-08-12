# Dream Skin Runtime Static Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve and accurately test the four CodexPlusPlus-compatible engine assets while isolating all Codex launch/CDP code from normal Shrimp execution and exposing only offline validation/build commands.

**Architecture:** Move asset compilation into pure `runtime/engine-assets.mjs`, protocol serialization/filtering into dependency-injected runtime modules, and process command construction into pure launcher helpers. The default entry point imports only offline builders; executable launch/connect functions have no server, HTTP, Web panel, package-script, or default CLI caller.

**Tech Stack:** Node.js 18+ ESM, `node:fs`, `node:path`, `node:vm`, `node:test`, `ws` behind dependency injection, MIT upstream renderer/CSS assets.

## Global Constraints

- Complete the domain/library, market/API, and Web panel plans first.
- Work only in `/Users/pa/project/AI/local-ai-gateway/.worktrees/dream-skin` on branch `codex/dream-skin`.
- Do not start, stop, restart, inspect, connect to, or inject Codex Desktop while implementing or testing this plan.
- Do not call `open`, `kill`, `pkill`, `pgrep`, `osascript`, real HTTP/CDP endpoints, real WebSockets, or real debug ports in tests.
- Keep the four engine renderer, CSS, and LICENSE files byte-for-byte aligned with the already confirmed MIT upstream copies.
- Preserve `THIRD_PARTY_NOTICES.md` and per-engine LICENSE files.
- The runtime is not imported by `server.js`, Web panel code, application service, HTTP routes, gateway startup, or normal package scripts.
- No HTTP route or Web UI action starts, applies, injects, cleans, or reconnects runtime behavior.
- Offline CLI commands are limited to `validate` and `build-script`.
- `build-script` writes JavaScript only to an explicitly supplied output path; it never evaluates it.
- All runtime network/process behavior uses injected adapters so unit tests cannot touch real Codex.
- Preserve unrelated uncommitted work already present in the worktree.

---

### Task 1: Freeze Engine Metadata, Assets, And Attribution

**Files:**
- Create: `lib/dream-skin/runtime/engine-assets.mjs`
- Modify: `lib/dream-skin/engines/index.mjs`
- Verify: `lib/dream-skin/engines/dream-skin/renderer-inject.js`
- Verify: `lib/dream-skin/engines/dream-skin/dream-skin.css`
- Verify: `lib/dream-skin/engines/dream-skin/LICENSE`
- Verify: `lib/dream-skin/engines/cidala-tiger/renderer-inject.js`
- Verify: `lib/dream-skin/engines/cidala-tiger/dream-skin.css`
- Verify: `lib/dream-skin/engines/cidala-tiger/LICENSE`
- Verify: `lib/dream-skin/engines/glass-vision/renderer-inject.js`
- Verify: `lib/dream-skin/engines/glass-vision/glass-vision.css`
- Verify: `lib/dream-skin/engines/glass-vision/LICENSE`
- Verify: `lib/dream-skin/engines/snow/renderer-inject.js`
- Verify: `lib/dream-skin/engines/snow/dream-skin.css`
- Verify: `lib/dream-skin/engines/snow/LICENSE`
- Modify: `lib/dream-skin/THIRD_PARTY_NOTICES.md`
- Modify: `tests/unit/dream-skin-engines.test.mjs`

**Interfaces:**
- Consumes: Plan 1 `assertValidTheme`, `inspectImage`, `imageDataUri`.
- Produces: `ENGINE_DEFINITIONS`.
- Produces: `resolveEngine(stylePreset) -> "dream-skin" | "cidala-tiger" | "glass-vision" | "snow"`.
- Produces: `loadEngineAssets(engineName) -> { name, renderer, css, version, placeholders, supportedPresets }`.
- Produces: `contentSignature(value) -> "<byte-length>-<lowercase-hex>"`.
- Produces: `buildEngineScript(engineName, { theme, artDataUri }) -> string`.
- Produces: `validateEngineAssets() -> Array<{ engine, scriptSignature, cssSignature }>` .

- [ ] **Step 1: Add failing complete-registry tests**

Assert all four definitions contain:

```js
{
  name,
  rendererFile,
  cssFile,
  version,
  placeholders,
  supportedPresets
}
```

Assert preset mapping exactly matches:

```text
codex-snow -> snow
glass-vision -> glass-vision
midnight-aurora, amber-dusk, forest-mist, cyber-neon, sakura-dawn -> cidala-tiger
empty -> dream-skin
```

Unknown presets must throw `invalid_theme`, not silently fall back.

- [ ] **Step 2: Add failing attribution and byte-integrity tests**

Compute SHA-256 for each existing asset and record the expected digest in the test. Assert each engine has LICENSE and `THIRD_PARTY_NOTICES.md` names CodexPlusPlus, the source repository, the asset paths, and MIT.

Compare and pin these exact source mappings:

```text
engines/dream-skin/renderer-inject.js
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/dream-skin/macos/renderer-inject.js
engines/dream-skin/dream-skin.css
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/dream-skin/macos/dream-skin.css
engines/dream-skin/LICENSE
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/dream-skin/LICENSE

engines/cidala-tiger/renderer-inject.js
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/cidala-tiger/macos/renderer-inject.js
engines/cidala-tiger/dream-skin.css
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/cidala-tiger/macos/dream-skin.css
engines/cidala-tiger/LICENSE
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/cidala-tiger/LICENSE

engines/glass-vision/renderer-inject.js
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/glass-vision/renderer-inject.js
engines/glass-vision/glass-vision.css
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/glass-vision/glass-vision.css
engines/glass-vision/LICENSE
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/glass-vision/LICENSE

engines/snow/renderer-inject.js
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/snow-skin/renderer-inject.js
engines/snow/dream-skin.css
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/snow-skin/dream-skin.css
engines/snow/LICENSE
  <- /Users/pa/project/AI/CodexPlusPlus/assets/inject/upstream/snow-skin/LICENSE
```

Record these current SHA-256 digests in the test:

```text
dream-skin renderer 2704c39506c66554c3529bf0d15b876b4aec2dd9a36b1796ab43e19c33a046fc
dream-skin CSS      ec3c3bc5f6e10e20a3f2307796bd1e1350e80e5d23d37318ee5468833c95a6df
dream-skin LICENSE  18f8478d0f9efd45307e5f17790194593b116658145c758ced3166398eb05b21
cidala renderer     21faf1dc0a3ebe78d8d972182cace62bd93d5d0e5841725398a4a524ef2bc20b
cidala CSS          5e149e9a13985961c5f3125296178acb2abf0b528974f1e616aa625970430562
cidala LICENSE      7b0f1855e7e716bdb2069b9c8b834f8d07430e748a4abec9534b6bec48e61a98
glass renderer      d14943e95db62db81bf29d9cf14fcaf1dd1ea9a9625245c020865127eea295a2
glass CSS           4c37c53544ee4f1cd93ba5d0dc3e174b05d4cb84ec9a436295d11d19f0bb04f1
glass LICENSE       26595abd1084ebbd7173a93998b5293bcf3647a22ccc1ac424c54be5d260ff57
snow renderer       0fcdff4aecd03eab2ca4ee923ccd20cb97eb5460f7c9f07351a2003ffa76e6fa
snow CSS            0af2d20fbe3e3dd13f0be7f1e5a90366e1501084827b22c1d4815a421bfce823
snow LICENSE        714d6a902a51867b0706f62ed2467d4332f787891c04a6bdfe660b1221643b86
```

- [ ] **Step 3: Add failing script-build tests**

For each engine:

1. Build with a normalized theme and PNG data URI.
2. Assert every declared placeholder was replaced.
3. Assert runtime globals such as `__CODEX_DREAM_SKIN_STATE__` remain.
4. Parse with `new vm.Script(script)`.
5. Build twice and assert identical output/signature.

Retain:

```js
assert.equal(contentSignature(""), "0-811c9dc5");
assert.equal(contentSignature("hello"), "5-4f9f2cab");
```

- [ ] **Step 4: Run and verify failure**

```bash
node --test tests/unit/dream-skin-engines.test.mjs
```

Expected: FAIL because definitions lack full metadata, unknown presets fall back, and runtime engine module does not exist.

- [ ] **Step 5: Move build ownership into `runtime/engine-assets.mjs`**

Keep `lib/dream-skin/engines/index.mjs` as a compatibility re-export only:

```js
export {
  ENGINE_DEFINITIONS,
  buildEngineScript,
  contentSignature,
  loadEngineAssets,
  resolveEngine,
  validateEngineAssets,
} from "../runtime/engine-assets.mjs";
```

Use `Math.imul` and unsigned `>>> 0` for FNV-1a. Replace only declared placeholders and report unresolved declared tokens with engine name.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/unit/dream-skin-engines.test.mjs
git diff --check
git add lib/dream-skin/runtime/engine-assets.mjs lib/dream-skin/engines/index.mjs lib/dream-skin/engines lib/dream-skin/THIRD_PARTY_NOTICES.md tests/unit/dream-skin-engines.test.mjs
git commit -m "feat: validate dream skin engine assets"
```

Expected: engine and attribution tests PASS; copied asset bytes remain unchanged.

---

### Task 2: Build Injection And Cleanup Scripts As Pure Values

**Files:**
- Create: `lib/dream-skin/runtime/injector.mjs`
- Remove: `lib/dream-skin/injector.mjs`
- Modify: `tests/unit/dream-skin-injector.test.mjs`

**Interfaces:**
- Consumes: `assertValidTheme`, `inspectImage`, `imageDataUri`, `resolveEngine`, `buildEngineScript`, `contentSignature`.
- Produces:

```js
loadRuntimeTheme({ themeJsonBytes, imageBytes }) -> {
  theme,
  imageFormat,
  backgroundDataUri
}
buildInjectionScript({ theme, backgroundDataUri }) -> string
buildCleanupScript() -> string
buildRuntimeEvaluateParams(expression, { awaitPromise? }?) -> object
buildAddScriptParams(source) -> object
```

- [ ] **Step 1: Replace path-based loader tests with byte-based tests**

Delete tests that permit an absolute image path or trust an extension. Add tests that pass JSON/image bytes from a Plan 1 library result and validate aliases through `assertValidTheme`.

- [ ] **Step 2: Add failing wrapper and cleanup tests**

Assert the injection script:

```text
sets __CODEX_PLUS_EXTERNAL_DREAM_SKIN_RUNTIME__
calls existing clear function first
contains the selected engine output
sets a codex-plus:macos:<engine>:r<signature> version
parses with vm.Script
```

Assert cleanup removes known classes/elements/data attributes, calls registered cleanup, resets installed flags, and parses with `vm.Script`.

- [ ] **Step 3: Add failing CDP-param tests**

Expected evaluation params:

```js
{
  expression,
  awaitPromise: false,
  allowUnsafeEvalBlockedByCSP: true,
  returnByValue: true,
}
```

Expected new-document params:

```js
{ source }
```

- [ ] **Step 4: Run and verify failure**

```bash
node --test tests/unit/dream-skin-injector.test.mjs
```

Expected: FAIL because the current loader is path-based and the runtime module path does not exist.

- [ ] **Step 5: Implement pure byte-based loading**

Limit JSON bytes to 256 KiB, parse, normalize, inspect the actual image bytes, require `theme.image` extension to match, and create the data URI. Do not call `readFile`, accept filesystem paths, or resolve absolute image paths.

- [ ] **Step 6: Implement deterministic script wrappers**

Use JSON serialization for all inserted data. Build parameters in exported pure functions so CDP tests never call `Runtime.evaluate`.

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/unit/dream-skin-engines.test.mjs tests/unit/dream-skin-injector.test.mjs
git diff --check
git add lib/dream-skin/runtime/injector.mjs lib/dream-skin/injector.mjs tests/unit/dream-skin-injector.test.mjs
git commit -m "refactor: isolate dream skin script builder"
```

Expected: tests PASS and the old path-based injector is removed.

---

### Task 3: Separate CDP Target Rules From Transport

**Files:**
- Create: `lib/dream-skin/runtime/cdp-client.mjs`
- Remove: `lib/dream-skin/cdp-client.mjs`
- Create: `tests/unit/dream-skin-cdp.test.mjs`

**Interfaces:**
- Produces pure functions:

```js
parseInitialRoute(pageUrl) -> string | null
isLoopbackWebSocketUrl(wsUrl) -> boolean
isInjectableCodexPage(target) -> boolean
rankCodexTargets(targets) -> target[]
buildCdpCommand(id, method, params) -> string
parseCdpMessage(data) -> object | null
```

- Produces adapters:

```js
createTargetClient({ requestJson, sleep, clock })
createCdpSession({ createWebSocket, wsUrl, commandTimeoutMs? })
```

Target client methods:

```js
listTargets(debugPort, { timeoutMs? })
waitForDebugEndpoint(debugPort, { maxWaitMs? })
pickPrimaryTarget(debugPort)
```

Session methods:

```js
connect()
send(method, params)
enableRuntime()
evaluate(expression, options)
addScriptToNewDocuments(source)
on(event, handler)
close()
```

- [ ] **Step 1: Write failing pure target tests**

Cover:

```text
app://-/index.html accepted
ChatGPT title plus https://chatgpt.com accepted
avatar-overlay rejected
/chatgpt/quick-chat rejected
non-page rejected
missing WebSocket rejected
non-loopback hostname rejected
missing/invalid port rejected
main surface ranks first
```

- [ ] **Step 2: Write failing protocol correlation tests**

Use a fake WebSocket implementation. Assert incremental IDs, `Runtime.enable` occurs once before first evaluate/add-script, response IDs resolve the correct pending promise, CDP errors reject, close rejects all pending commands, malformed events are ignored, and timeouts delete pending entries.

- [ ] **Step 3: Write failing fake HTTP polling tests**

Inject `requestJson`, fake `sleep`, and fake `clock`. Assert list URL is `http://127.0.0.1:<port>/json`, invalid ports reject, polling stops at deadline, parse failures are retried, and no real socket is opened.

- [ ] **Step 4: Run and verify failure**

```bash
node --test tests/unit/dream-skin-cdp.test.mjs
```

Expected: FAIL because dependency-injected runtime CDP module does not exist.

- [ ] **Step 5: Implement strict loopback and port validation**

Allow `127.0.0.1`, `localhost`, and `::1`; require integer ports `1..65535`. Reject credentials, paths that do not identify a devtools endpoint, and non-`ws:`/`wss:` protocols.

- [ ] **Step 6: Implement transport factories without top-level effects**

The module may import the `ws` constructor only for a default `createWebSocket` value, but importing it must not instantiate a connection. `createTargetClient` performs requests only when a method is explicitly called.

- [ ] **Step 7: Run tests and commit**

```bash
node --test tests/unit/dream-skin-cdp.test.mjs
git diff --check
git add lib/dream-skin/runtime/cdp-client.mjs lib/dream-skin/cdp-client.mjs tests/unit/dream-skin-cdp.test.mjs
git commit -m "refactor: isolate dream skin CDP client"
```

Expected: all CDP tests PASS using fakes only.

---

### Task 4: Make Launcher Behavior Dependency-Injected And Uncallable By Default

**Files:**
- Create: `lib/dream-skin/runtime/launcher.mjs`
- Remove: `lib/dream-skin/launcher.mjs`
- Create: `tests/unit/dream-skin-launcher.test.mjs`

**Interfaces:**
- Produces pure functions:

```js
resolveCodexAppCandidates(homeDir) -> string[]
buildMacOSOpenCommand({ appPath, debugPort, extraArgs? }) -> {
  executable: "open",
  args: string[]
}
buildMacOSQuitCommand(appPath) -> {
  executable: "osascript",
  args: string[]
}
buildMacOSProcessQuery(appPath) -> {
  executable: "pgrep",
  args: string[]
}
```

- Produces: `createCodexLauncher({ platform, homeDir, exists, spawn, spawnSync, sleep, waitForDebugEndpoint, logger })`.
- Returned methods:

```js
resolveCodexAppPath(configuredPath?)
isRunning(appPath)
quit(appPath)
launchWithDebugPort({ appPath?, debugPort?, extraArgs?, maxWaitMs? })
```

- [ ] **Step 1: Write failing pure command tests**

Assert default candidate order, configured-path validation, port range checks, and exact command arrays. Extra args remain distinct array elements and cannot alter executable selection.

- [ ] **Step 2: Write failing fake-process tests**

Use spies that throw if a real process adapter is absent. Cover unsupported platform, app already running, quit polling, spawn error, debug endpoint timeout, and successful launch return value.

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/dream-skin-launcher.test.mjs
```

Expected: FAIL because the dependency-injected launcher does not exist.

- [ ] **Step 4: Implement the launcher factory**

Do not perform process inspection or spawn at module import. `launchWithDebugPort` calls only injected adapters. Keep `DEFAULT_DEBUG_PORT = 19222`, but validate it before building a command.

- [ ] **Step 5: Run tests and commit**

```bash
node --test tests/unit/dream-skin-launcher.test.mjs
git diff --check
git add lib/dream-skin/runtime/launcher.mjs lib/dream-skin/launcher.mjs tests/unit/dream-skin-launcher.test.mjs
git commit -m "refactor: isolate dream skin launcher"
```

Expected: launcher tests PASS and no child process runs.

---

### Task 5: Replace The Executable Prototype With Offline Commands

**Files:**
- Modify: `lib/dream-skin/index.mjs`
- Create: `tests/unit/dream-skin-cli.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Plan 1 library validation plus runtime engine/injector pure functions.
- Produces:

```text
node lib/dream-skin/index.mjs validate --theme <theme.json> --image <background.ext>
node lib/dream-skin/index.mjs validate-engines
node lib/dream-skin/index.mjs build-script --theme <theme.json> --image <background.ext> --output <script.js>
```

- [ ] **Step 1: Write failing CLI parser tests**

Export:

```js
parseArgs(argv) -> command object
runCli(args, deps) -> Promise<number>
```

Assert `inject`, `launch`, `cleanup`, `remove`, `--port`, and `--app` are rejected as unknown commands/options. Assert `build-script` requires an explicit output file.

- [ ] **Step 2: Write failing offline execution tests**

Use temporary theme/image files and injected `readFile`/`writeFile`. Assert:

```text
validate parses and validates but writes nothing
validate-engines returns four engine summaries
build-script writes parseable JavaScript
no launcher/CDP module is imported
```

- [ ] **Step 3: Run and verify failure**

```bash
node --test tests/unit/dream-skin-cli.test.mjs
```

Expected: FAIL because the current CLI launches and injects Codex.

- [ ] **Step 4: Rewrite the entry point**

The top-level imports may include only:

```js
node:fs/promises
node:path
./runtime/engine-assets.mjs
./runtime/injector.mjs
```

Do not import launcher or CDP modules, even lazily. Validate that output is not the theme/image input, write with mode `0o600`, and print a concise offline-only help message.

- [ ] **Step 5: Keep package scripts non-executable**

Do not add injection scripts. Add only:

```json
"dream-skin:validate-engines": "node lib/dream-skin/index.mjs validate-engines"
```

The existing `test:dream-skin` remains the test entry.

- [ ] **Step 6: Run tests and commit**

```bash
node --test tests/unit/dream-skin-cli.test.mjs
npm run dream-skin:validate-engines
git diff --check
git add lib/dream-skin/index.mjs tests/unit/dream-skin-cli.test.mjs package.json
git commit -m "refactor: make dream skin CLI offline only"
```

Expected: no Codex process, network connection, or CDP call occurs.

---

### Task 6: Add Static Isolation Regression Tests

**Files:**
- Modify: `tests/unit/dream-skin-server-isolation.test.mjs`
- Create: `tests/unit/dream-skin-runtime-isolation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: source and import-graph guards preventing accidental runtime activation.

- [ ] **Step 1: Write failing source-graph tests**

Recursively read `.mjs`, `.js`, and `.ts` source outside `lib/dream-skin/runtime/` and assert none import:

```text
lib/dream-skin/runtime/cdp-client.mjs
lib/dream-skin/runtime/launcher.mjs
ws for Dream Skin behavior
child_process for Dream Skin behavior
```

Permit the offline entry to import only engine-assets/injector.

- [ ] **Step 2: Add server/package/UI prohibition tests**

Assert:

```text
server.js has no runtime imports/routes
package.json has no inject/launch/cleanup Dream Skin script
desktop has no runtime action copy or route
application service has no runtime method
```

- [ ] **Step 3: Add import side-effect tests**

Spawn a child Node process that imports each runtime module with monkey-patched process/network adapters which fail on use. Import must exit `0`, proving no top-level spawn/request/WebSocket activity.

- [ ] **Step 4: Run and verify failure**

```bash
node --test tests/unit/dream-skin-server-isolation.test.mjs tests/unit/dream-skin-runtime-isolation.test.mjs
```

Expected: initially FAIL while legacy paths/executable entry remain.

- [ ] **Step 5: Remove all legacy references and update the focused suite**

Make `test:dream-skin` include:

```text
dream-skin-engines
dream-skin-injector
dream-skin-cdp
dream-skin-launcher
dream-skin-cli
dream-skin-runtime-isolation
all domain/library/market/service/http/API tests
```

- [ ] **Step 6: Run tests and commit**

```bash
npm run test:dream-skin
npm run check
git diff --check
git add tests/unit/dream-skin-server-isolation.test.mjs tests/unit/dream-skin-runtime-isolation.test.mjs package.json
git commit -m "test: enforce dream skin runtime isolation"
```

Expected: all tests PASS and no prohibited adapter is called.

---

### Task 7: Final Static Verification Without Codex

**Files:**
- Verify: `lib/dream-skin/runtime/`
- Verify: `lib/dream-skin/engines/`
- Verify: `lib/dream-skin/index.mjs`
- Verify: `server.js`
- Verify: `desktop/`
- Verify: `package.json`

**Interfaces:**
- Produces: the first-phase static runtime boundary and four verified engine builds.

- [ ] **Step 1: Run all Dream Skin and panel tests**

```bash
npm run test:dream-skin
npm run test:config-panel
npm run build:panel
npm run check
```

Expected: all commands exit `0`.

- [ ] **Step 2: Run offline asset validation**

```bash
npm run dream-skin:validate-engines
```

Expected: exactly four engine names and stable signatures; no process/network activity.

- [ ] **Step 3: Build one script offline and parse it**

Use a temporary copy of the built-in normalized theme plus a minimal valid PNG:

```bash
node lib/dream-skin/index.mjs build-script --theme /tmp/dream-skin-theme.json --image /tmp/dream-skin-background.png --output /tmp/dream-skin-script.js
node --check /tmp/dream-skin-script.js
rm -f /tmp/dream-skin-theme.json /tmp/dream-skin-background.png /tmp/dream-skin-script.js
```

Expected: parse succeeds; the script is never evaluated.

- [ ] **Step 4: Scan every activation surface**

```bash
rg -n 'Runtime\.evaluate|Page\.addScriptToEvaluateOnNewDocument|launchWithDebugPort|launchCodex|quitCodex|open -a|osascript|pgrep' server.js desktop package.json lib/dream-skin --glob '!lib/dream-skin/runtime/**' --glob '!lib/dream-skin/engines/**'
rg -n '/v1/dream-skin/(apply|launch|inject|runtime|community|packages)' server.js desktop lib/dream-skin/http
git diff --check
```

Expected: first command has no product-call-chain matches; second shows only explicit 404 handling/tests; diff check passes.

- [ ] **Step 5: Inspect commit boundaries**

```bash
git status --short
git log --oneline --decorate -12
```

Expected: runtime work is split into reviewable commits, unrelated pre-existing changes were not reverted, and no test ever interacted with Codex Desktop.
