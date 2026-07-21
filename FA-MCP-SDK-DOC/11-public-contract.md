# 11 — Public Contract

This document is the **formal public contract** of the `fa-mcp-sdk` package. Everything listed
here is part of the API surface that the SDK guarantees, and every change to it follows the
versioning policy at the bottom of this file (semver: MAJOR / MINOR / PATCH).

If a behaviour is **not** described here — even if it is currently observable in the source — it
is considered an implementation detail and may change in any release.

---

## 1. Transports

| Transport          | Standard | Status | Notes                                                       |
|--------------------|----------|--------|-------------------------------------------------------------|
| `stdio`            | §6       | MUST   | Single JSON-RPC stream over stdin/stdout                    |
| `streamable_http`  | §6       | MUST   | `POST/GET/DELETE /mcp` driven by the SDK transport          |
| `legacy_http_sse`  | §6       | SHOULD | `GET /sse` + `POST /messages` — kept for backwards-compat   |

All HTTP routes hosted by the SDK are listed in §2.

**SSE resumability (opt-in, §6 MAY).** With `mcp.sse.resumability: true` the Streamable HTTP transport
keeps recent SSE events in a per-process in-memory ring buffer (`mcp.sse.maxStoredEvents`, default 1000),
so a client reconnecting to `GET /mcp` with a `Last-Event-ID` header replays the events it missed. Off by
default. The buffer does not survive a restart and does not span multiple server instances — a persistent
store would be required for that.

---

## 2. HTTP endpoints

| Path                                              | Method | Auth | Level  | Purpose                                                       |
|---------------------------------------------------|--------|------|--------|---------------------------------------------------------------|
| `/mcp`                                            | POST   | Yes  | MUST   | JSON-RPC entry point (`initialize`, `tools/*`, …)             |
| `/mcp`                                            | GET    | Yes  | MUST   | Server-initiated SSE stream for the active session            |
| `/mcp`                                            | DELETE | Yes  | MUST   | Session teardown                                              |
| `/sse`                                            | GET    | Yes  | SHOULD | Legacy SSE connect                                            |
| `/sse`                                            | POST   | Yes  | SHOULD | Legacy direct JSON-RPC                                        |
| `/messages`                                       | POST   | Yes  | SHOULD | Legacy SSE message channel                                    |
| `/health`                                         | GET    | No   | MUST   | Liveness; returns `{status, version, uptime, details}`        |
| `/ready`                                          | GET    | No   | SHOULD | Readiness; `{status, checks}`                                 |
| `/metrics`                                        | GET    | No   | SHOULD | Prometheus exposition (opt-in via `webServer.metrics.enabled`) |
| `/`                                               | GET    | No   | MAY    | Static home page                                              |
| `/ct`                                             | POST   | No   | MUST   | Token validity check via JSON body                            |
| `/ct?t=…`                                         | GET    | No   | MAY    | Disabled by default (`webServer.tokenCheck.allowQueryToken`)  |
| `/used-http-headers`                              | GET    | No   | MAY    | Returns the project's `usedHttpHeaders` declaration           |
| `/.well-known/oauth-protected-resource`           | GET    | No   | MUST*  | Active in JWT modes `embedded` / `localKey` / `remoteJwks`    |
| `/.well-known/openid-configuration`               | GET    | No   | MUST*  | OIDC discovery                                                |
| `/.well-known/jwks.json`                          | GET    | No   | MUST*  | JWK Set with the active public key                            |
| `/oauth/token`                                    | POST   | No   | MUST*  | Embedded IdP — `grant_type=password`                          |
| `/gen-jwt`                                        | POST   | Yes  | MAY    | JWT issuance API (`webServer.genJwtApiEnable`)                |
| `/admin`                                          | GET    | Yes  | MAY    | Token Generator UI                                            |
| `/agent-tester`                                   | GET    | Yes? | MAY    | Built-in chat UI (`agentTester.enabled`)                      |
| `/api/openapi.json` / `/api/openapi.yaml` / `/docs` | GET  | -    | MAY    | OpenAPI when the project supplies `httpComponents.apiRouter`  |

`MUST*` rows are mandatory only when the corresponding feature is active.

---

## 3. Authentication

The SDK accepts the following `Authorization` schemes, picked by header format (not order):

- `Bearer <token>` — JWT (any of the four modes: `legacyAesCtr` / `embedded` / `localKey` /
  `remoteJwks`) or a permanent server token.
- `Basic <base64>` — HTTP Basic auth.
- Optional `customAuthValidator` — last fallback for project-specific schemes.

JWT modes are documented in [04-authentication](04-authentication.md). Public contract:

| Claim       | Required | Notes                                                                    |
|-------------|----------|--------------------------------------------------------------------------|
| `sub`       | MUST     | Subject — drives rate-limit bucket and concurrency cap                   |
| `exp`       | MUST     | Expiration; SDK enforces with `clockSkew` (default 30 s, max 60 s)       |
| `aud`       | SHOULD   | Defaults to `appConfig.name`; configurable via `expectedAudience`        |
| `iss`       | SHOULD*  | Required in modes `embedded` / `localKey` / `remoteJwks`                 |
| `scope`     | MAY      | Space-separated scopes; matched against `requiredScopes` per §7.5        |
| `ip`        | MAY      | When set + `isCheckIP=true`, client IP must match                        |
| `service`   | MAY      | When set + `checkMCPName=true`, must contain `appConfig.name`            |
| `jti`       | MAY      | Used by the revocation list                                              |

Scopes are matched against `requiredScopes` on tools, prompts, and resources (§7.5).

`WWW-Authenticate: Bearer realm="<name>" resource_metadata="<url>"` is emitted on every 401
from MCP endpoints per §7.4. 403 responses (authenticated but forbidden) carry NO
`WWW-Authenticate` header.

---

## 4. MCP methods

| Method                                | Status | Notes                                                     |
|---------------------------------------|--------|-----------------------------------------------------------|
| `initialize`                          | MUST   |                                                           |
| `notifications/initialized`           | MUST   |                                                           |
| `tools/list`                          | MUST   | Server-side pagination via `mcp.pagination.pageSize`      |
| `tools/call`                          | MUST   | Honours `signal`, `_meta.progressToken`, `requiredScopes` |
| `prompts/list`                        | MUST   | Capability advertised only when the server has prompts (§8.2) |
| `prompts/get`                         | MUST   | Returns `-32601` when no prompts are configured           |
| `resources/list`                      | MUST   | Same pagination contract                                  |
| `resources/read`                      | MUST   | Returns `text` or base64 `blob` per entry (§11.4)         |
| `resources/templates/list`            | MAY    | `mcp.resources.templatesEnabled`                          |
| `resources/subscribe` / `unsubscribe` | MAY    | `mcp.resources.subscribeEnabled`                          |
| `completion/complete`                 | MAY    | `mcp.completions.enabled` + `completionProvider` (§8.2)   |
| `tasks/list`                          | MAY    | `mcp.tasks.enabled`; caller's own tasks, newest first, paginated (§8.7) |
| `tasks/get`                           | MAY    | `mcp.tasks.enabled`; current task metadata (§8.7)        |
| `tasks/result`                        | MAY    | `mcp.tasks.enabled`; the `tools/call` result once completed (§8.7) |
| `tasks/cancel`                        | MAY    | `mcp.tasks.enabled`; aborts a running task, idempotent (§8.7) |
| `logging/setLevel`                    | SHOULD | Capability `logging: {}` (default ON)                     |
| `notifications/message`               | SHOULD | Emitted by `sendLoggingMessage()`                         |
| `notifications/progress`              | SHOULD | Emitted by `IToolHandlerParams.sendProgress()` (§8.6)     |
| `notifications/cancelled`             | SHOULD | Aborts `IToolHandlerParams.signal` (§8.5)                 |
| `notifications/tasks/status`          | MAY    | Emitted on every task status transition (§8.7)           |

When `mcp.tasks.enabled` is `true`, the server advertises the `tasks` capability
(`{ list, cancel, requests: { tools: { call } } }`) and a `tools/call` carrying a `task` parameter
is executed as a task: the server returns a `CreateTaskResult` (`{ task: { taskId, status, … } }`)
immediately and runs the tool in the background. A tool opts in via `execution.taskSupport`
(`optional` / `required` / `forbidden`, see §5) — sending `task` to a tool that does not support it,
or omitting `task` for a `required` tool, returns `-32602`. The default task store keeps records in
process memory only; it does **not** survive a restart. When `mcp.tasks.enabled` is `false` (the
default) the capability is not advertised and all four `tasks/*` methods return `-32601`.

---

## 5. Tool / Prompt / Resource format

### Tool (`Tool` from `@modelcontextprotocol/sdk`)

- `name` — MUST be `snake_case` and unique (validated at boot via
  `validate-tool-names.ts`).
- `description` — MUST be non-empty. Deprecation prefix `[DEPRECATED until …]` is added
  automatically when `_meta.deprecated` is set.
- `inputSchema` — MUST declare `$schema: 'https://json-schema.org/draft/2020-12/schema'` and
  `additionalProperties: false`.
- `outputSchema` — MAY; when present, the SDK validates `structuredContent` against it and
  mirrors the value into `content[0]` as JSON text (§12.4).
- `title` — SHOULD; user-facing label.
- `execution.taskSupport` — MAY; one of `optional` / `required` / `forbidden` (default — absence is
  treated as `forbidden`, i.e. synchronous only). Controls task-augmented execution (§8.7); passed
  through verbatim in `tools/list`. Effective only when `mcp.tasks.enabled` is `true`.
- `annotations` — MAY; may be hidden via `mcp.tools.hideAnnotations`.
- `_meta._meta.requiredScopes` (or top-level `requiredScopes`) — MAY; OAuth scopes enforced
  before dispatch.
- `_meta.deprecated` — MAY; structured `IDeprecationInfo`.
- `_meta.ui` — MAY; MCP Apps widget metadata.

### Prompt (`IPromptData`)

`name`, `description`, `arguments[]` (each `IPromptArgument`), `content` (string or function),
`requireAuth`, `requiredScopes`, `deprecated`. Optional UI metadata (§10.5, MAY): `title` (human-facing
label, falls back to `name`) and `icons` (`IIcon[]` — `{ src; mimeType?; sizes? }`). Both pass through
`prompts/list` unchanged; built-in `agent_brief` / `agent_prompt` carry a `title`. The built-in
`tool_prompt` prompt is also guaranteed: it has a required `tool` argument (the MCP tool name) and
returns the tool-specific prompt supplied by the project through `McpServerData.toolPrompt`; without
that field a stub returns an empty string.

### Resource (`IResourceData` / `IResourceInfo`)

`uri`, `name`, `description`, `mimeType`, optional `title`, `size` (bytes, §11.3 MAY),
`icons` (`IIcon[]`, §11.3 MAY), `requireAuth`, `requiredScopes`, `_meta`, `deprecated`. On
`resources/list` the SDK computes `size` from the content (UTF-8 byte length for text/objects, buffer
length for blobs) when the author did not set it; lazy (function) content omits `size`. `content` is a
string / object / function for text resources, or
`IResourceBinaryContent` (`{ blob: Buffer | base64-string, base64?: boolean }`) for binary
resources — `resources/read` then returns base64 `contents[0].blob` (no `text`) with the
resource's `mimeType` (§11.4 / §12.2). Built-in URI schemes are guaranteed by the SDK:

| URI                                        | Purpose                                        |
|--------------------------------------------|------------------------------------------------|
| `project://version`                        | Returns `appConfig.version`                    |
| `use://auth`                               | Authentication self-description                |
| `<service>://agent/brief`                  | Mirrors `agent_brief` prompt                   |
| `<service>://agent/prompt`                 | Mirrors `agent_prompt` prompt                  |
| `doc://...`                                | Application docs                               |

### Sensitive data masking (`maskSensitive`, §12.2)

Masking personal / sensitive data in tool results is the server's responsibility — the SDK never masks
automatically. The optional helper `maskSensitive(value, rules)` (exported from the barrel, with the
`IMaskRules` type) is a reusable building block: it walks an object / array / string and applies explicit
rules — `fieldNames` (case-insensitive field-name match) and `patterns` (regular expressions on string
values at any depth) — replacing matches with `replacement` (a string, default `'***'`, or a function for
partial masking like `4111********1111`). It returns a new value and never mutates the input. Call it
inside a tool handler before returning the result; choosing the rules and where to apply them stays with
the server.

---

## 6. Error format

JSON-RPC errors follow Appendix B of the standard. Mapping (JSON-RPC → HTTP):

| JSON-RPC code | HTTP | Class                | Trigger                                       |
|---------------|------|----------------------|-----------------------------------------------|
| `-32600`      | 400  | (none)               | Invalid Request                               |
| `-32601`      | 404  | `ResourceNotFoundError` (when applicable) | Method/resource not found  |
| `-32602`      | 400  | `ValidationError`    | Invalid params (input schema, unknown tool)   |
| `-32603`      | 500  | `ServerError`        | Internal error                                |
| `-32000`      | varies | `BaseMcpError`     | Generic SDK error                             |
| `-32002`      | 404  | `ResourceNotFoundError` | Resource lookup failed                     |
| `-32003`      | 429  | `RateLimitedError`   | Rate limit / concurrent-call cap (+ `Retry-After`) |
| `-32004`      | 504  | `TimeoutError`       | `mcp.limits.toolTimeoutMs` exceeded           |
| `-32005`      | 413  | `PayloadTooLargeError` | `mcp.limits.maxPayloadBytes` exceeded       |
| `-32006`      | 503  | `UpstreamUnavailableError` | Dependency (DB / downstream) unreachable  |
| `-32007`      | 409  | `ConflictError`      | State conflict (duplicate / optimistic lock)  |

Unrecognized internal errors are sanitized (§13.3 / Appendix C.3): the outward `error.message`
collapses to `Internal error`, the full text is written to the internal log keyed by `requestId`,
and absolute filesystem paths are scrubbed from any outward message. Recognized domain errors (any
class above) keep their message verbatim.

`error.data` is structured per Appendix B.3:

```jsonc
{
  "requestId": "uuid…",         // §15.1, always set by the SDK if absent
  "field": "name",              // first offending field (input validation diagnostics)
  "reason": "required",         // machine-readable hint — stable ajv keyword for schema violations
  "retryAfter": 12,             // seconds, for -32003
  // input-schema violations (-32602) additionally include (implementation-specific, not contractual):
  "errorCount": 2,              // total violations before truncation
  "errors": [                   // up to 8 per-field failures: { field, reason, message }
    { "field": "name", "reason": "required", "message": "root: missing required property \"name\"" }
  ]
  // …implementation-specific keys are allowed but not part of the contract
}
```

Input-argument validation against `inputSchema` is on by default and can be disabled per deployment
via `mcp.tools.validateInput: false` (env `MCP_TOOLS_VALIDATE_INPUT`). When off, malformed arguments
reach the tool handler unchecked — only the JSON-RPC envelope shape is still enforced.

---

## 7. Limits and headers

| Limit / Header               | Source / Default                                                        |
|------------------------------|-------------------------------------------------------------------------|
| `mcp.limits.maxPayloadBytes` | 1 MiB                                                                   |
| `mcp.limits.maxToolResultBytes` | 10 MiB                                                                |
| `mcp.limits.toolTimeoutMs`   | 30 000 ms                                                               |
| `mcp.rateLimit.maxRequests`  | 100 / window                                                            |
| `mcp.rateLimit.windowMs`     | 60 000 ms                                                               |
| `mcp.rateLimit.maxConcurrentPerSubject` | 16                                                            |
| `mcp.pagination.pageSize`    | 100                                                                     |
| `mcp.logging.defaultLevel`   | `info` (Syslog ladder)                                                  |
| `mcp.progress.throttleMs`    | 100 (10 events/s/token)                                                 |
| `mcp.completions.enabled`    | `false` (opt-in; needs `completionProvider`)                            |
| `mcp.tasks.enabled`          | `false` (opt-in; advertises `tasks` capability)                        |
| `mcp.tasks.defaultTtlMs`     | 3 600 000 ms (finished-task retention; clamped to `[minTtlMs, maxTtlMs]`) |
| `mcp.tasks.maxTtlMs`         | 86 400 000 ms (hard retention ceiling)                                  |
| `mcp.tasks.pollIntervalMs`   | 1000 ms (suggested to client in every task object)                     |
| `mcp.tasks.maxTasks`         | 1000 (retained tasks; oldest finished evicted first)                   |
| `webServer.metrics.enabled`  | `false` (opt-in)                                                        |
| `X-Request-Id` (response)    | Always present — generated when client did not supply one (§15.1)       |
| `tracestate` (response)      | Echoed back unchanged when client supplied a valid value                |
| `WWW-Authenticate`           | On every 401 from MCP endpoints (§7.4)                                  |
| `Retry-After`                | On every 429 (§14)                                                      |
| `MCP-Session-Id`             | Set by SDK on `initialize`; subsequent requests MUST echo it            |
| `MCP-Protocol-Version`       | Negotiated by the SDK transport                                         |

---

## 8. Versioning policy (§17.1)

| Change                                                          | Bump  |
|-----------------------------------------------------------------|-------|
| Removing a tool / prompt / resource                             | MAJOR |
| Adding a `required` field to an `inputSchema`                   | MAJOR |
| Removing a field from an `outputSchema`                         | MAJOR |
| Changing the default JWT algorithm / mode                       | MAJOR |
| Renaming or removing an HTTP endpoint                           | MAJOR |
| Removing a configuration key (`mcp.*`, `webServer.*`, …)        | MAJOR |
| Backwards-incompatible change to `error.data` shape             | MAJOR |
| Adding a new tool / prompt / resource                           | MINOR |
| Adding an optional field to any schema                          | MINOR |
| Adding a new capability or behaviour gated by an opt-in flag    | MINOR |
| Adding a new optional configuration key (with safe default)     | MINOR |
| Extending `description` or `title`                              | PATCH |
| Bug-fix without changing the contract                           | PATCH |
| Documentation-only change                                       | PATCH |

`[BREAKING]` is the required marker in `CHANGELOG.md` for any MAJOR entry.

### Historical examples

| Release | Bump  | Driver                                                                 |
|---------|-------|------------------------------------------------------------------------|
| 0.4.145 | MINOR | MCP 2025-11-25 via SDK Streamable HTTP                                 |
| 0.5.0   | MAJOR | HTTP hardening (default bind `127.0.0.1`, error codes, rate-limit)     |
| 0.6.0   | MAJOR | Tools/Prompts/Resources contract (`additionalProperties:false`, mirror)|
| 0.7.0   | MAJOR | RS256/ES256 JWT runtime, OAuth/OIDC discovery, scope enforcement       |
| 0.8.x   | MINOR | Observability (X-Request-Id, traceparent, logging, metrics, progress)  |
| 0.9.1   | MINOR | Conditional capabilities, `-32006`/`-32007`, binary `blob`, error sanitization, opt-in completions |
| 0.10.0  | MINOR | Opt-in `tasks` capability (task-augmented execution), `execution.taskSupport`, in-memory task store |

---

## 9. Deprecation process (§17.2)

Authors declare deprecation in a structured shape (no free-form `[DEPRECATED]` in descriptions):

```typescript
// tools.ts
const myTool: Tool = {
  name: 'old_tool',
  description: 'Returns the rate.',
  _meta: {
    deprecated: { until: '2026-08-28', replacedBy: 'new_tool', note: 'See migration guide' },
  },
  // …
};

// prompts / resources
const myPrompt: IPromptData = {
  name: 'old_prompt',
  description: '…',
  deprecated: { until: '2026-08-28', replacedBy: 'new_prompt' },
  // …
};
```

The SDK then:

1. mutates `description` on list responses to include
   `[DEPRECATED until YYYY-MM-DD, use <replacedBy>]`;
2. logs a `logger.warn` the first time per hour each `(kind, name)` is invoked;
3. logs a `logger.error` at registration time if `until` is already in the past — the entry
   should be removed instead of shipped.

**Window**: minimum `2 MINOR releases OR 3 months` from announcement to removal (per §17.2),
whichever is longer.

---

## 10. Public contract source list

The runtime sources of the contract above are:

- `src/core/_types_/types.ts` — `IToolHandlerParams`, `IPromptData`, `IResourceInfo`,
  `IDeprecationInfo`, `McpServerData`.
- `src/core/_types_/config.ts` — `AppConfig` (every documented configuration key).
- `src/core/errors/BaseMcpError.ts` + `src/core/errors/specific-errors.ts` — error codes.
- `src/core/mcp/create-mcp-server.ts` — handler contract.
- `src/core/mcp/task-store.ts` — `ITaskStore` / `InMemoryTaskStore`, task lifecycle (§8.7).
- `src/core/web/server-http.ts` — HTTP endpoints, headers, response shape.
- `src/core/web/request-id.ts` — `X-Request-Id` + W3C trace context middleware.
- `src/core/mcp/mcp-logging.ts` — `logging` capability.
- `src/core/metrics/metrics.ts` — Prometheus series.
- `src/core/mcp/deprecation.ts` — deprecation lifecycle.

Anything that lives outside this list (file names, internal helpers, log line formats, etc.) is
**not** part of the contract and may change without notice.
