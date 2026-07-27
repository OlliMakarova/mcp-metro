# Configuration

Every setting MCP METRO reads, grouped by section, with the value the project ships with. In short: settings are
resolved as environment variables > `config/local.yaml` > `config/{NODE_ENV}.yaml` > `config/default.yaml`;
secrets belong in the gitignored `config/local.yaml`; the defaults run out of the box — the only keys a real
deployment must set are `webServer.publicBaseUrl` and, once auth is on, the token secrets.

## How settings are resolved

Later sources win over earlier ones:

```text
config/default.yaml  →  config/{NODE_ENV}.yaml  →  config/local.yaml  →  environment variables
```

- `config/default.yaml` — the documented baseline; every key lives here with an inline comment.
- `config/development.yaml`, `config/production.yaml` — environment overlays, both empty in this project.
- `config/local.yaml` — machine-local values and secrets. Gitignored; `config/_local.yaml` is the template to copy.
- `config/custom-environment-variables.yaml` — the map from environment variable names to config paths, so anything can
  be overridden without editing a file (for example `WS_PORT` sets `webServer.port`, `WS_GEN_JWT_API_ENABLE` sets
  `webServer.genJwtApiEnable`).

Typed access in code goes through `appConfig` from `fa-mcp-sdk`, cast to `CustomAppConfig` from
`src/_types_/custom-config.ts` when project-specific sections are involved.

## Project sections

### `metro` — the data layer

| Key                      | Description                                                | Default |
|--------------------------|------------------------------------------------------------|---------|
| `refreshIntervalHours`   | Interval of the scheduled refresh from the network          | `24`    |
| `notificationsTtlHours`  | How long a cached closures file stays usable                | `24`    |
| `requestTimeoutMs`       | Timeout of a single HTTP request to a source                | `30000` |

The disk-cache folder (`data-cache/`) and the source URLs are deliberately **not** configurable — they are constants in
`src/lib/metro-data/metro-config.ts`. See [Data Sources](./data-sources.md).

### `telegram` — alerts on data-source state changes

| Key         | Description                                                        | Default |
|-------------|--------------------------------------------------------------------|---------|
| `enabled`   | Master switch; anything false or empty silently skips sending        | `false` |
| `botToken`  | Bot token from @BotFather — a secret, keep it in `local.yaml` or ENV | —       |
| `chatId`    | Target chat: a private chat, a group, or a channel with the bot      | —       |

### `restApi.rateLimit` — REST throttling

| Key           | Description                                        | Default |
|---------------|----------------------------------------------------|---------|
| `maxRequests` | Requests allowed per window, counted per client IP  | `60`    |
| `windowSec`   | Window length in seconds                            | `60`    |

Applies to all five `/api/*` routes. A token-authorized route recompute passes a second, stricter limiter on top —
one request per 2 seconds per IP, not configurable. See [REST API](./rest-api.md).

### `widgetData` — signed widget links

| Key          | Description                                                                                         | Default |
|--------------|-----------------------------------------------------------------------------------------------------|---------|
| `signSecret` | HMAC-SHA256 secret signing widget-data links and the widget's recompute tokens. Empty means a fresh random secret on every start, so links issued before a restart stop verifying. Set it explicitly in production. | —       |

## SDK sections in use

### `webServer`

| Key                     | Description                                                                     | Default       |
|-------------------------|---------------------------------------------------------------------------------|---------------|
| `host`                  | Bind address                                                                    | `127.0.0.1`   |
| `port`                  | HTTP port                                                                       | `9049`        |
| `publicBaseUrl`         | Externally reachable base URL; empty falls back to `http://localhost:<port>`      | —             |
| `cors.enabled`          | CORS origin guard. `false` here so the sandboxed widget can fetch its data        | `false`       |
| `originHosts`           | Allow-list used when the origin guard is on                                      | `localhost`, `0.0.0.0` |
| `trustProxy`            | Trust `X-Forwarded-*`; required behind a reverse proxy for correct client IPs      | `false`       |
| `auth.enabled`          | Authorization on/off                                                            | `false`       |
| `genJwtApiEnable`       | Mount `POST /gen-jwt`                                                           | `false`       |
| `tokenCheck.allowQueryToken` | Allow the legacy `GET /ct?t=` form (never in production)                    | `false`       |
| `metrics.enabled`       | Prometheus metrics at `metrics.path`                                            | `false`       |

`publicBaseUrl` is the single source of the external address: it builds the widget's `dataUrl` and the `connect-src`
entry in the widget resource's Content-Security-Policy. Behind a proxy it must be the public URL, for example
`https://mcp-metro.time-gold.com`. Authentication keys are covered in [Authentication](./authentication.md).

### `mcp`

| Key                             | Description                                                           | Default   |
|---------------------------------|-----------------------------------------------------------------------|-----------|
| `transportType`                 | Transport chosen when no CLI argument is given                         | `http`    |
| `tools.answerAs`                | Tool response shape: `text` or `json`                                 | `text`    |
| `tools.validateInput`           | Validate `tools/call` arguments against `inputSchema`                  | `true`    |
| `rateLimit.maxRequests`         | MCP requests per window, per subject                                  | `100`     |
| `rateLimit.windowMs`            | MCP rate-limit window, milliseconds                                   | `60000`   |
| `rateLimit.maxConcurrentPerSubject` | Concurrent in-flight calls per subject                            | `16`      |
| `limits.maxPayloadBytes`        | Largest accepted request body                                         | `1048576` |
| `limits.maxToolResultBytes`     | Largest tool result returned                                          | `10485760`|
| `limits.toolTimeoutMs`          | Tool execution timeout                                                | `30000`   |
| `pagination.pageSize`           | Page size for paginated protocol lists                                | `100`     |
| `logging.enabled`               | MCP protocol-level logging                                            | `true`    |
| `sse.resumability`              | Replay of missed SSE events                                           | `false`   |

### `agentTester`

| Key                  | Description                                                              | Default                 |
|----------------------|--------------------------------------------------------------------------|-------------------------|
| `enabled`            | Mount `/agent-tester` and its Headless API; `false` makes them return 404  | `true`                  |
| `useAuth`            | Require an `Authorization` header for the tester                          | `true`                  |
| `toolCallTimeoutMs`  | Timeout of a tool call made from the tester                               | `60000`                 |
| `openAi.apiKey`      | OpenAI-compatible API key — a secret                                     | —                       |
| `openAi.baseURL`     | Alternative OpenAI-compatible gateway                                    | —                       |
| `openAi.defaultModel`| Model preselected in the UI                                              | `openai/gpt-5.4-nano`   |
| `openAi.models`      | Model list offered in the UI                                             | five `gpt-5.4` / `gpt-4.1` variants |
| `logJson`            | Emit structured JSON events on stdout                                    | `false`                 |

`headlessTester.defaultModel` (`openai/gpt-5.4`) is the model the Headless API uses when a request names none. See
[Testing](./testing.md).

### Other SDK sections

| Section      | State in this project                                                                                        |
|--------------|--------------------------------------------------------------------------------------------------------------|
| `swagger`    | Active. `servers` lists the production URL shown in Swagger UI at `/docs`.                                     |
| `logger`     | `level: info`, console only (`useFileLogger: false`), masking of sensitive values disabled.                     |
| `cache`      | The SDK's in-memory cache: `ttlSeconds: 300`, `maxItems: 1000`. The metro layer keeps its own caches instead.   |
| `homePage`   | Optional help and support links on the `/` diagnostic page; empty here.                                        |
| `uiColor`    | Accent color of the built-in pages (`#ff0013`).                                                               |
| `adminPanel` | Disabled — `/admin` is not mounted.                                                                            |
| `consul`     | Disabled — `consul.service.enable: false`; no service registration.                                            |
| `accessPoints` | Not used — this server calls no Consul-registered upstream service.                                          |

Active Directory authorization and PostgreSQL are not configured and not used.

## Environment variables

| Variable                        | Effect                                                          |
|---------------------------------|-----------------------------------------------------------------|
| `NODE_ENV`                      | Selects the `config/{NODE_ENV}.yaml` overlay                     |
| `WS_PORT`, `WS_HOST`            | Override `webServer.port` / `webServer.host`                     |
| `WS_GEN_JWT_API_ENABLE`         | Override `webServer.genJwtApiEnable`                             |
| `AGENT_TESTER_ENABLED`          | Override `agentTester.enabled`                                   |
| `AGENT_TESTER_OPENAI_API_KEY`   | Override `agentTester.openAi.apiKey`                             |
| `DEBUG`                         | Namespace logging: `mcp:tool`, `fuzzy-search`, `config-info`      |

`config/custom-environment-variables.yaml` holds the complete mapping — anything in the YAML tree can be driven from the
environment, which is how the Docker deployment injects values.
