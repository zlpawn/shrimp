# LangBot Command App Design

Date: 2026-09-04
Status: Approved for implementation

## Goal

Integrate LangBot into the gateway desktop's **Command Apps** tab as a managed, long-running local HTTP daemon. The gateway owns lifecycle control and connection metadata only. LangBot remains the owner of its application configuration, secrets, database, plugins, and runtime data.

## Source of truth split

| Concern | Owner | Location |
| --- | --- | --- |
| LangBot instance data | LangBot | `~/.langbot/data` |
| Static app defaults | Shrimp registry | In-code LangBot app definition |
| User-mutable control-plane state | Shrimp | `gateway.db` Command Apps store |
| Model endpoints and credentials | Shrimp | Existing gateway routing/secrets stores |
| LangBot provider and platform config | LangBot | LangBot database and `data/config.yaml` |

LangBot 4.10.9 resolves its data root in this priority order:

1. `LANGBOT_DATA_ROOT` environment variable
2. source-checkout `<repo>/data`
3. package-install `<cwd>/data`

The gateway will set both values explicitly to avoid mixed absolute/relative resolution:

```text
cwd = /Users/pa/.langbot
LANGBOT_DATA_ROOT = /Users/pa/.langbot/data
```

`cwd` and the environment override point to the same instance even though some legacy LangBot paths still use relative `data/...` references.

## Persistence design

Do not add LangBot control-plane settings to `gateway.config.json` and do not create a separate JSON settings file. Continue the existing Command Apps persistence boundary by extending `gateway.db`.

Add a daemon-instance table conceptually shaped as follows:

```sql
CREATE TABLE IF NOT EXISTS command_apps_daemons (
  instance_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  executable_path TEXT,
  cwd TEXT NOT NULL,
  data_root TEXT NOT NULL,
  port INTEGER NOT NULL,
  env_json TEXT NOT NULL DEFAULT '{}',
  llm_source_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
```

The exact implementation may normalize the schema to fit the current store, but it must preserve these rules:

- Static defaults stay in the app registry.
- Only discovered/manual paths and user-mutable settings are persisted.
- Values are normalized and validated before save.
- JSON fields must tolerate old rows with invalid JSON by falling back to defaults.
- LangBot secrets are not copied into Shrimp's database.

## App model

LangBot is registered as a cross-platform HTTP daemon:

```text
id: langbot
executableName: langbot
defaultPort: 5300
healthPath: /login
openUrl: http://127.0.0.1:5300
default cwd: ~/.langbot
default data root: ~/.langbot/data
```

The current `cli-daemon` type is Hindsight-specific in implementation. Refactor it into a generic `http-daemon` adapter while retaining a Hindsight adapter for its existing env-file, profile, lockfile, and daemon-command behavior. LangBot should not inherit Hindsight's LLM-env-file assumptions.

## Runtime behavior

- **Install:** expose a gateway action that runs `uv tool install langbot`; do not run a daemon via repeated `uvx` invocations.
- **Update:** stop the managed LangBot process, run `uv tool upgrade langbot`, rediscover the executable, report the installed version, and require a health check before the update is considered successful. Installation or update failures must never delete or reset `~/.langbot`.
- **Launch:** spawn the resolved `langbot` executable with the persisted instance `cwd` and environment. Strip SOCKS proxy variables in the same way other local daemons are sanitized, unless LangBot explicitly needs an outbound proxy later.
- **Status:** consider the process starting after spawn and running after an HTTP check to `/login` succeeds. Process existence with an unhealthy endpoint remains `starting` until a timeout, then `error`.
- **Open:** launch the browser or app link at the configured daemon URL.
- **Stop:** terminate the gateway-launched process tree. An externally launched LangBot is detected and reported but is not silently killed unless the user explicitly chooses stop and the adapter can safely identify its root process.
- **Conflicts:** a non-gateway process already listening on 5300 must produce a clear conflict/error state rather than a second launch attempt.

## LLM integration

Phase 1 (manual):

- The LangBot card exposes a gateway model-source selector equivalent in intent to the Hindsight source selector.
- It displays the recommended OpenAI-compatible base URL (normally `http://127.0.0.1:8787/v1`), selected model, and API-key strategy (`GATEWAY_API_KEY` or the supported `all` sentinel).
- The user copies or applies this into LangBot's existing model-provider UI. Shrimp does not directly edit LangBot's database.

Phase 2 (automated):

- Once provider creation/update endpoints are verified against LangBot's API/MCP surface, the card may create or update a LangBot custom OpenAI-compatible provider through that API.
- Automation must be additive and report whether the change succeeded; it must not delete or rewrite unrelated providers.

The gateway stores only the selected Shrimp source reference (client/endpoint/model). It does not persist the LangBot-side API key.

## API and UI

Existing Command Apps REST semantics remain authoritative:

- `GET /v1/command-apps/apps`
- `GET /v1/command-apps/apps/:id`
- `POST /v1/command-apps/apps/:id/discover`
- `POST /v1/command-apps/apps/:id/launch`
- `POST /v1/command-apps/apps/:id/stop`
- `PUT /v1/command-apps/apps/:id/config`

The desktop list gains a LangBot card. The card supports discovery/config, start/stop/restart, open URL, status, port, data root, executable path, and the phase-one LLM guidance. Hindsight-specific labels such as `hindsight-embed path` must not appear on the LangBot card.

## Error handling

- Missing executable: stopped/not-configured with an install hint.
- Missing instance directory: create `~/.langbot` and `~/.langbot/data` only on explicit user action or first launch.
- Port occupied by non-LangBot service: conflict state with the listener port.
- Health check fails after timeout: error state with the last process-exit signal if available.
- Invalid persisted settings: fall back to defaults and surface a validation error rather than preventing the full Command Apps list from rendering.

## Testing

Add unit tests for:

1. registry and normalization defaults;
2. discovery of a persistent `langbot` executable;
3. launch environment, `cwd`, and `LANGBOT_DATA_ROOT`;
4. HTTP health transitions and timeout states;
5. stop/process-tree behavior;
6. port-conflict handling;
7. persistence normalization, invalid JSON recovery, and upgrade from the existing schema;
8. REST routing and public status shape;
9. desktop rendering with no Hindsight-specific leakage;
10. phase-one LLM source status without secret persistence.

Verification must include the focused Command Apps unit suite and the desktop build.

## Non-goals

- No direct writes to LangBot's SQLite database.
- No mirroring of all LangBot settings in Shrimp.
- No multi-instance management in the first implementation.
- No Docker/Box runtime management.
- No source-tree development mode in the first implementation; the gateway manages the persistent package executable, not `uv run main.py`.

## Self-review note

The interactive reviewer subagent required by the repository's brainstorming skill is unavailable in this session. This document was reviewed directly against the existing Command Apps architecture, current LangBot 4.10.9 source behavior, and the user-approved decisions: `~/.langbot` ownership and `gateway.db` control-plane persistence.
