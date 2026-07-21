# Satellite Templates (`readme-docs/*.md`)

Skeletons for common satellite Markdown files referenced from the main README. Each skeleton ends
with the values a skill should fill in from the actual project. **Create a satellite only when the
feature is enabled in the project; do not emit stubs for disabled subsystems.**

All files live under `readme-docs/` in the project root. Naming: kebab-case by topic
(`authentication.md`, `active-directory.md`, `admin-panel.md`, …).

The folder name `readme-docs/` is **not arbitrary** — the fa-mcp-sdk `doc://readme` MCP resource
looks for exactly this folder and inlines every file linked from the main README. Any other name
(`docs/`, `readme-parts/`, etc.) will be ignored by the SDK and the content will not reach the RAG
index of the MCP registry.

---

## `readme-docs/authentication.md`

Use when auth is non-trivial (multiple methods, header-based override, impersonation, etc.).

```markdown
# Authentication

This document covers both the MCP server's own auth (who may call the server) and the upstream
auth (how the server authenticates to <upstream system>).

## MCP server auth

Configured under `webServer.auth` in `config/*.yaml`. Supported methods:

- **Permanent server tokens** — O(1) set lookup, for service-to-service callers
- **Basic** — `Authorization: Basic base64(user:pass)`
- **JWT** — `Authorization: Bearer <token>`; standard signed JWT (HS256); optional IP restriction
- **Custom validator** — project-defined fallback

JWT tokens can be minted via:

- `/admin` — web UI (requires `adminPanel.enabled: true`)
- `POST /gen-jwt` — HTTP endpoint (requires `webServer.genJwtApiEnable: true`)
- `node scripts/generate-jwt.js -u <username> -ttl <duration>` — CLI

## Per-request `x-<prefix>-*` headers

Callers can override server config with per-request headers:

| Header                   | Purpose                                  |
|--------------------------|------------------------------------------|
| `x-<prefix>-token`       | Personal Access Token (Bearer)           |
| `x-<prefix>-username`    | Basic auth username (pair with password) |
| `x-<prefix>-password`    | Basic auth password (pair with username) |
| `x-on-behalf-of-user`    | Impersonation proxy target (if enabled)  |

When `x-<prefix>-*` credentials are present, the server's own auth check is bypassed (callers
supply their own identity).

## Resolution order (outgoing request to <upstream>)

`authenticationHeaders()` picks the first matching rule:

| # | Source                                             | Condition                          | Outgoing `Authorization`                 |
|---|----------------------------------------------------|------------------------------------|------------------------------------------|
| 1 | Headers `x-<prefix>-username` + `x-<prefix>-password` | both present                    | `Basic base64(user:pass)` → `directApi`  |
| 2 | Header `x-<prefix>-token`                          | present                            | `Bearer <token>` → `directApi`           |
| 3 | Config `directApi.auth.basic`                      | `username` + `password` populated  | `Basic` from config → `directApi`        |
| 4 | Config `directApi.auth.pat`                        | non-empty                          | `Bearer <pat>` → `directApi`             |
| 5 | Config `directApi.auth.oauth2`                     | `accessToken` + client creds set   | `Bearer <accessToken>` → `directApi`     |
| 6 | Header `x-on-behalf-of-user`                       | present (impersonation enabled)    | Auth from `impersonalizationPlugin.auth` |

## Invariants

- `x-<prefix>-username` and `x-<prefix>-password` are honoured **only as a pair**.
- **Own credentials ⇒ no impersonation.** When `x-<prefix>-username/password` or
  `x-<prefix>-token` is present, the `x-on-behalf-of-user` header is stripped.
- The server attaches `x-<prefix>-actual-user` to outgoing requests to record the effective user.

## Related

- Admin panel for token generation: [Admin Panel](./admin-panel.md)
- `/gen-jwt` skill: [SKILLS](./SKILLS.md)
```

---

## `readme-docs/testing.md`

Use when `agentTester.enabled: true` or a Headless test skill is present.

```markdown
# Testing

Two ways to exercise the MCP server end-to-end with a real LLM:

1. **Agent Tester UI** — browser chat UI at `/agent-tester`
2. **Headless Agent Tester API** — curl-friendly HTTP endpoint at `/agent-tester/api/chat/test`

Both paths run the same agent pipeline: user message → LLM picks MCP tool → tool runs → LLM
formats response.

## Agent Tester UI

Open `http://<host>:<port>/agent-tester` in a browser. Supply credentials in the UI (Basic / PAT /
impersonation), then chat naturally — each tool invocation is shown with arguments and raw JSON
response.

Configuration under `agentTester.*`:

| Key                              | Description                                                  |
|----------------------------------|--------------------------------------------------------------|
| `agentTester.enabled`            | Master on/off                                                |
| `agentTester.useAuth`            | Require MCP-server auth to access the UI                     |
| `agentTester.sessionTtlMs`       | Chat session retention                                       |
| `agentTester.openAi.apiKey`      | LLM API key (OpenAI-compatible)                              |
| `agentTester.openAi.baseURL`     | LLM endpoint (set for Anthropic / local models)              |
| `agentTester.httpHeaders.*`      | Custom headers forwarded to MCP                              |

## Headless Agent Tester API

Run tests without a browser. POST a message, get the agent's full trace back as JSON.

```bash
curl -X POST http://<host>:<port>/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -H "x-<prefix>-token: <pat>" \
  -d '{"message": "List my open issues"}'
```

Response shape:

```json
{
  "messages": [ { "role": "assistant", "content": "..." } ],
  "toolCalls": [ { "tool": "<name>", "arguments": {}, "response": {} } ]
}
```

## `/headless-test` skill

Runs intelligent tests against all tools in a controlled scope (project / space / etc.) and writes
a Markdown report to `claudedocs/test-report-{RUN_ID}.md`. See [SKILLS](./SKILLS.md).
```

---

## `readme-docs/webhooks.md`

Use when the server uses `x-web-hook` or tool handlers return `hook`.

```markdown
# Webhook Callback (`x-web-hook`)

After every tool invocation the server can POST the result to an external URL. Useful for audit,
real-time dashboards, chaining MCP calls into pipelines.

## How to use

Pass `x-web-hook: <http(s) URL>` with any MCP tool call. After the tool finishes, the server fires
a fire-and-forget POST (10 s timeout; errors are logged but never fail the tool call).

## Request body

```json
{
  "mcpName": "<name>",
  "tool": "<tool_name>",
  "user": "<acting user or omitted>",
  "response": { "...": "..." }
}
```

| Field      | Description                                                                                   |
|------------|-----------------------------------------------------------------------------------------------|
| `mcpName`  | MCP server name from config (`name`)                                                          |
| `tool`     | Name of the tool that was invoked                                                             |
| `user`     | Acting <upstream> user (from `x-<prefix>-actual-user` logic). Omitted if not determinable.    |
| `response` | Full JSON result returned by the tool handler                                                 |

## Per-tool hooks

A tool handler may return `{ hook: "<url>" }` in its `IToolResponse`. That per-tool URL takes
precedence over the `x-web-hook` header. If neither is present, no webhook fires.

## Examples

```bash
# via HTTP MCP endpoint
curl -X POST http://<host>:<port>/mcp \
  -H "Content-Type: application/json" \
  -H "x-web-hook: https://hooks.my-ci.com/events" \
  -d '{"tool": "<tool_name>", "arguments": {...}}'

# via Headless Agent Tester
curl -X POST http://<host>:<port>/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -H "x-web-hook: https://log-collector.internal/mcp-events" \
  -d '{"message": "..."}'
```
```

---

## `readme-docs/consul.md`

Use when `consul.service.enable: true`.

```markdown
# Consul Service Discovery

Server registers itself on startup and deregisters on SIGTERM. Health check path: `/health`.

## Configuration

```yaml
consul:
  agent:
    prd:
      dc: <dc>
      host: <consul-host>
      port: 443
      secure: true
      token: <agent-token>
  service:
    enable: true
    name: <service-name>
    instance: ${SERVICE_INSTANCE}
    version: <version>
    tags: []
    meta:
      who: 'http://{address}:{port}/'
  check:
    interval: '10s'
    timeout: '5s'
    deregistercriticalserviceafter: '3m'
```

## Environment selection

`consul.envCode.*` picks which agent block is active. Typical values: `dev`, `prd`, `reg`.

## Access-point updater

`accessPointUpdater` (from `fa-mcp-sdk`) can periodically refresh service endpoints from Consul for
outbound calls. See `src/core/consul/access-points-updater.ts` for the contract.
```

---

## `readme-docs/active-directory.md`

Use when `ad.domains.*` is populated.

```markdown
# Active Directory

Tools can gate access by AD group membership via `group-checker` from `fa-mcp-sdk`.

## Configuration

```yaml
ad:
  domains:
    MYDOMAIN:
      default: true
      controllers:
        - ldap://dc1.mycorp.local
        - ldap://dc2.mycorp.local
      username: <service-account>
      password: <password>
```

## Usage in tools

```typescript
import { checkUserInGroup } from 'fa-mcp-sdk';

const allowed = await checkUserInGroup({
  username: ctx.user,
  group: 'mcp-admins',
  domain: 'MYDOMAIN',
});
```

Caching and group lookup semantics: see `src/core/ad/group-checker.ts`.
```

---

## `readme-docs/database.md`

Use when `db.*` is populated and `pg-db.js` helpers are imported.

```markdown
# Database (PostgreSQL)

The server uses `fa-mcp-sdk`'s PostgreSQL helpers for structured persistence. pgvector is supported
for embedding storage.

## Configuration

```yaml
db:
  MAIN:
    host: <host>
    port: 5432
    database: <db>
    user: <user>
    password: <password>
    schema: public
```

## Usage

```typescript
import { queryRsMAIN, oneRowMAIN, execMAIN } from 'fa-mcp-sdk';

const rows = await queryRsMAIN<MyRow>('SELECT * FROM t WHERE id = $1', [id]);
```

Connection pool and retry semantics: `src/core/db/pg-db.ts`.

## Health

The `/health` endpoint includes DB reachability when the `db` block is configured.
```

---

## `readme-docs/configuration.md`

Use when the config reference is > ~15 parameters or overlaps multiple subsystems.

```markdown
# Configuration

Priority: env vars > `config/local.yaml` > `config/{NODE_ENV}.yaml` > `config/default.yaml`.

## Global

| Key                                   | Description                             | Default   |
|---------------------------------------|-----------------------------------------|-----------|
| `name`                                | MCP server name                         | —         |
| `version`                             | Server version                          | —         |

## Web server

| Key                                   | Description                             | Default   |
|---------------------------------------|-----------------------------------------|-----------|
| `webServer.port`                      | HTTP listen port                        | `<PORT>`  |
| `webServer.host`                      | Bind host                               | `0.0.0.0` |
| `webServer.auth.enabled`              | Require MCP auth                        | `false`   |
| `webServer.auth.jwt.secret`           | JWT AES key                             | —         |
| `webServer.genJwtApiEnable`           | Expose `POST /gen-jwt`                  | `false`   |

## MCP

| Key                                   | Description                             | Default   |
|---------------------------------------|-----------------------------------------|-----------|
| `mcp.tools.answerAs`                  | Response format (`text` / `json`)       | `text`    |
| `mcp.name`                            | Name returned to MCP clients            | —         |

## Upstream `<prefix>`

| Key                                   | Description                             | Default   |
|---------------------------------------|-----------------------------------------|-----------|
| `<upstream>.url`                      | Upstream base URL                       | —         |
| `<upstream>.auth.pat`                 | Personal Access Token                   | —         |
| `<upstream>.auth.basic.username`      | Basic auth username                     | —         |
| `<upstream>.auth.basic.password`      | Basic auth password                     | —         |
| `<upstream>.usedInstruments.include`  | Allow-list (`ALL` or tool names)        | `ALL`     |
| `<upstream>.usedInstruments.exclude`  | Deny-list                               | `[]`      |

Fill in subsystem sections (`consul.*`, `ad.*`, `db.*`, `agentTester.*`, etc.) as needed.
```

---

## `readme-docs/admin-panel.md`

Use when `adminPanel.enabled: true` and the feature is worth a dedicated page (otherwise inline a
single paragraph in the main README).

```markdown
# Admin Panel

Web UI at `/admin` for generating and inspecting JWT tokens.

## Configuration

```yaml
adminPanel:
  enabled: true
  authType: basic
  username: <admin>
  password: <secret>
```

## What you can do

- Generate a JWT for a given username, TTL, optional `request` scope and IP allow-list
- Inspect the decoded payload
- Copy the generated token to clipboard

Tokens generated here are interchangeable with those produced by `scripts/generate-jwt.js` and the
`/gen-jwt` skill.
```

---

## `readme-docs/impersonation.md`

Use when `impersonalizationPlugin.*` is configured.

```markdown
# Impersonation (`x-on-behalf-of-user`)

When the server has access to a service account with elevated privileges, callers can request
actions on behalf of another user via the `x-on-behalf-of-user` header.

## How it works

1. Client sends the MCP request with `x-on-behalf-of-user: <target-username>` — and **no own
   credentials**.
2. The server authenticates to the impersonation proxy using
   `impersonalizationPlugin.auth` from config.
3. The proxy performs the upstream action as the target user.
4. The server tags the outbound request with `x-<prefix>-actual-user: <target-username>` for audit.

## Invariant

**Own credentials ⇒ no impersonation.** If any of `x-<prefix>-username/password` or
`x-<prefix>-token` is present in the request, `x-on-behalf-of-user` is stripped and the request
goes to `directApi.url` instead of the impersonation proxy.

## Configuration

```yaml
<upstream>:
  impersonalizationPlugin:
    url: https://impersonation-proxy.corp/api
    auth:
      basic:
        username: <service-account>
        password: <secret>
```
```

---

## `readme-docs/debugging.md`

Use when the server has namespace-based DEBUG logging (most fa-mcp-sdk projects do).

```markdown
# Debug Logging

Namespace-based logs via the `DEBUG` environment variable.

| Namespace                     | What it logs                                           |
|-------------------------------|--------------------------------------------------------|
| `<prefix>-api-request-curl`   | Outgoing HTTP requests to upstream as reproducible curl |
| `<prefix>-api-response-2-console` | Upstream API responses on console                  |
| `<prefix>-api-response-2-file`    | Upstream API responses to file                     |
| `tool-response`               | Final result of each MCP tool call                     |

Examples:

```bash
DEBUG=<prefix>-api-request-curl npm start
DEBUG=tool-response npm start
DEBUG=<prefix>-api-*,tool-response npm start
```

On upstream HTTP request errors, the reproducible curl is always printed to console (unsuppressable
safety net in `src/lib/axios-error-handler.ts`).
```

---

## `readme-docs/api.md`

Use only when the project ships a custom REST API beyond `/mcp`.

```markdown
# REST API

Base URL: `/api/v1/<scope>` · Auth: `Bearer <token>` · Envelope: `{ success, data, meta }`.

| Method | Path                                       | Description                      |
|--------|--------------------------------------------|----------------------------------|
| GET    | `/api/v1/<scope>/<resource>?...`           | <What it returns>                |
| POST   | `/api/v1/<scope>/<resource>`               | <What it creates>                |

Full OpenAPI spec: [`swagger/openapi.yaml`](../swagger/openapi.yaml). Also available on the running
server at `/docs` (Swagger UI), `/api/openapi.json`, `/api/openapi.yaml`.

## Error codes

`<CODE_1>`, `<CODE_2>`, `<CODE_3>`, `ACCESS_DENIED`, `INVALID_INPUT`, `INTERNAL_ERROR`.
```

---

## Project-specific satellite template

For capabilities unique to a project (fuzzy resolution, caching strategy, batch limits, content
conversion, etc.), compose a satellite with this shape:

```markdown
# <Feature Name>

<One-sentence summary — the feature opened standalone still makes sense.>

## Overview

<Why it exists. What problem it solves.>

## How it works

<Mechanism. Diagrams or pseudocode as needed. Reference the relevant `src/` path.>

## Configuration

```yaml
<subsystem>:
  <key>: <value>
```

## Examples

<One or two minimal, runnable examples.>

## Caveats

<Limits, failure modes, invariants.>
```
