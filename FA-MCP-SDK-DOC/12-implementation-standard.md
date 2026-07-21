# Corporate MCP Server Implementation Standard

| Parameter                  | Value                              |
|----------------------------|------------------------------------|
| Version                    | 1.3                                |
| Status                     | Active                             |
| Date                       | 2026-06-05                         |
| Scope                      | All internal company MCP servers   |
| Base MCP                   | MCP 2025-11-25                      |
| Starter SDK (optional)     | `fa-mcp-sdk`                       |
| Owner                      | AI/MCP Platform team               |

> This document is the English translation of the corporate implementation standard. It restates the
> explicit MCP 2025-11-25 requirements plus the corporate Avatar / AI Platform profile in a single
> self-contained document. Version 1.2 adds the side-effect tools and risk-level rules and fixes the
> `-32007` error-code inconsistency. Version 1.3 adds §13.4 on mapping upstream (downstream API) errors
> to typed error classes and the rule for surfacing model-correctable errors via `result.isError=true`.

## Table of Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Terminology and requirement levels](#2-terminology-and-requirement-levels)
3. [Compatibility with MCP 2025-11-25](#3-compatibility-with-mcp-2025-11-25)
4. [MCP protocol versioning](#4-mcp-protocol-versioning)
5. [Transports](#5-transports)
6. [HTTP interface](#6-http-interface)
7. [Authentication and authorization](#7-authentication-and-authorization)
8. [MCP methods and lifecycle](#8-mcp-methods-and-lifecycle)
9. [Tools: external contract](#9-tools-external-contract)
10. [Prompts: external contract](#10-prompts-external-contract)
11. [Resources: external contract](#11-resources-external-contract)
12. [Result format](#12-result-format)
13. [Error format](#13-error-format)
14. [Limits and protection](#14-limits-and-protection)
15. [Observability](#15-observability)
16. [Health and readiness](#16-health-and-readiness)
17. [Contract stability and deprecation](#17-contract-stability-and-deprecation)
18. [Compliance checklist](#18-compliance-checklist)
19. [Appendix A. Auth profile](#appendix-a-auth-profile)
20. [Appendix B. Error codes](#appendix-b-error-codes)
21. [Appendix C. Input / output summary table](#appendix-c-input--output-summary-table)

---

## 1. Purpose and scope

This document defines the corporate profile of an MCP server developed in-house. It builds on the common
MCP 2025-11-25 protocol and adds internal Avatar / AI Platform requirements for security, network
interface, naming, observability, and operational contracts.

The document covers:

- transport and network interface;
- authentication and authorization;
- the set of published tools, prompts, and resources;
- result and error formats;
- operational requirements (health, observability, limits);
- rules for evolving the public contract.

The internal implementation, language, framework, and architecture are **not regulated**. A server may be
built on any technology stack as long as it fully complies with the external requirements of this standard.
To speed up the start, a team MAY use `fa-mcp-sdk`, the official MCP SDK, or its own implementation.

The standard applies to servers exposed to:

- internal company AI agents;
- internal services via MCP clients;
- partner environments, if the server is published beyond the perimeter.

The standard **does not apply** to local experimental servers without external consumers.

## 2. Terminology and requirement levels

The RFC 2119 keywords are used:

| Term            | Meaning                                                   |
| --------------- | -------------------------------------------------------- |
| MUST            | Hard requirement. Non-compliance = acceptance blocker.   |
| SHOULD          | Recommended. A deviation requires a justification in the README. |
| MAY             | Allowed at the team's discretion.                        |

Other terms:

- **Public contract** — the set of all externally visible elements of the server, listed in §17.
- **Breaking change** — any change to the public contract that breaks existing clients.
- **Starter SDK** — one of the allowed ways to speed up the start of implementation; it is not part of the
  public contract and does not constrain the language or internal architecture of the server.
- **Corporate profile** — additional company requirements on top of common MCP. If a requirement is marked
  as corporate, it is not a universal MCP requirement, but it is mandatory for internal servers.

## 3. Compatibility with MCP 2025-11-25

This standard is compatible with MCP 2025-11-25 and must be treated as a corporate profile on top of the
common protocol.

Base MCP 2025-11-25 requirements:

- JSON-RPC 2.0 is used for all MCP messages;
- server and client go through the `initialize` / `initialized` lifecycle;
- both parties declare and respect negotiated capabilities;
- standard transports: `stdio` and Streamable HTTP;
- the HTTP transport uses a single MCP endpoint, usually `/mcp`, with `POST` and an optional `GET` for the
  SSE stream;
- `MCP-Protocol-Version` is sent on subsequent HTTP requests after negotiation;
- `MCP-Session-Id` is used only as a session identifier and does not replace authentication;
- `tools`, `prompts`, `resources`, `logging`, `completions`, `tasks` are used only if the capability has
  been declared and negotiated.

Corporate extensions of this standard:

- mandatory authentication for internal HTTP / Streamable HTTP MCP servers;
- a corporate JWT / opaque token profile for internal environments;
- preserving snake_case tool names;
- recommended prompts `agent_brief` and `agent_prompt` for Avatar routing;
- corporate URI schemes `use://`, `project://`, `doc://`;
- mandatory limits, observability, health/readiness, and CHANGELOG.

If a server is published for generic MCP clients beyond the internal perimeter, it SHOULD follow common
MCP 2025-11-25 for authorization discovery, Streamable HTTP, and the error model. If a server is available
only to internal Avatar clients, the corporate profile is allowed, provided it is explicitly documented in
the README and `use://auth`.

## 4. MCP protocol versioning

The server MUST:

- declare the supported MCP protocol version in the `initialize` response;
- support MCP 2025-11-25 for new HTTP / Streamable HTTP servers unless the README states another version;
- return a standard `initialize` error on version mismatch instead of crashing;
- for the HTTP transport, accept `MCP-Protocol-Version` on subsequent requests and return HTTP 400 for an
  explicitly unsupported version.

The server MUST maintain its own semver versioning:

| Change                                  | Version bump |
| --------------------------------------- | ------------ |
| Breaking change to the public contract  | MAJOR        |
| New tool / prompt / resource            | MINOR        |
| Bugfix without a contract change        | PATCH        |

The server version MUST be available through:

- the `/health` response (the `version` field);
- `serverInfo.version` in `initialize.result`;
- the `project://version` resource (SHOULD).

## 5. Transports

The server MUST support at least one transport. Allowed transports:

| Transport         | Purpose                                  | When mandatory |
| ----------------- | ---------------------------------------- | -------------- |
| `stdio`           | Local launch (Claude Desktop, etc.)      | if the server targets a desktop agent |
| `streamable_http` | Corporate network access per MCP 2025-11-25 | for all new network MCP servers (MUST) |
| `legacy_http_sse` | Compatibility with the old HTTP+SSE transport | MAY for existing clients |
| custom            | Specialized transport                    | MAY with explicit documentation |

The semantics of MCP calls MUST be identical across all declared transports.

For `stdio`:

- the server reads JSON-RPC messages from `stdin` and writes only valid MCP messages to `stdout`;
- logs are allowed only on `stderr`;
- messages are newline-delimited and MUST NOT contain an embedded newline.

For `streamable_http`:

- the server MUST expose a single MCP endpoint, usually `/mcp`;
- the client sends each JSON-RPC message as a separate `POST /mcp`;
- the server MAY use an SSE stream via `GET /mcp` or via a `POST /mcp` response with
  `Content-Type: text/event-stream`;
- a separate `/sse` endpoint is NOT the primary transport of MCP 2025-11-25 and is allowed only as a legacy
  compatibility path.

## 6. HTTP interface

For servers with Streamable HTTP:

| Endpoint   | Method | Level | Purpose                              |
| ---------- | ------ | ----- | ------------------------------------ |
| `/mcp`     | POST   | MUST  | Main MCP endpoint (JSON-RPC 2.0)     |
| `/mcp`     | GET    | MAY   | SSE stream from server to client; return 405 if not supported |
| `/mcp`     | DELETE | MAY   | Explicit MCP session termination     |
| `/health`  | GET    | MUST  | Liveness check                       |
| `/ready`   | GET    | SHOULD | Readiness check                     |
| `/sse`     | GET    | MAY, legacy only | Old HTTP+SSE transport for backward compatibility |
| `/`        | GET    | SHOULD | Service HTML page / redirect to documentation |

Requirements for `POST /mcp`:

- `Content-Type: application/json` on input;
- `Accept` MUST include `application/json` and `text/event-stream`;
- the body is a single valid JSON-RPC 2.0 request, notification, or response;
- if the input is a request, the server returns a single JSON response (`application/json`) or an SSE
  stream (`text/event-stream`);
- if the input is a notification or response and the server accepted the message, the server returns
  HTTP 202 with no body;
- the server MUST respond with a valid JSON-RPC error rather than HTML or plain text on a protocol-level
  failure.

Requirements for `GET /mcp`:

- `Accept` MUST include `text/event-stream`;
- if the SSE stream is supported, the server returns `Content-Type: text/event-stream`;
- if the SSE stream is not supported, the server returns HTTP 405 Method Not Allowed;
- the server MUST NOT send a JSON-RPC response on an independent GET stream, except for the resume scenario
  via `Last-Event-ID`.

MCP HTTP headers:

| Header | Level | Behavior |
| ------ | ----- | -------- |
| `MCP-Protocol-Version` | MUST for HTTP after `initialize` | The protocol version negotiated in the lifecycle, e.g. `2025-11-25` |
| `MCP-Session-Id` | MUST if the server issued a session id | Sent on all subsequent HTTP requests of this MCP session |
| `Accept` | MUST | `application/json, text/event-stream` for POST; `text/event-stream` for GET |
| `Content-Type` | MUST for POST | `application/json` |
| `Last-Event-ID` | MAY | Used by the client to resume an SSE stream |

Session management:

- the server MAY issue an `MCP-Session-Id` in the HTTP response to `initialize`;
- the session id MUST be globally unique, cryptographically strong, and contain only visible ASCII;
- if the server requires `MCP-Session-Id`, requests without it after initialization must receive HTTP 400;
- if the session has expired, a request with that session must receive HTTP 404;
- the session id MUST NOT be used as proof of identity or as a replacement for `Authorization`.

CORS / Origin:

- the server MUST explicitly configure the list of allowed origins;
- `*` is forbidden in production;
- preflight OPTIONS MUST be handled correctly;
- the server MUST validate `Origin` on HTTP / Streamable HTTP requests if the header is present;
- on an invalid `Origin`, the server MUST return HTTP 403;
- local HTTP MCP servers SHOULD bind to `127.0.0.1` rather than `0.0.0.0`.

## 7. Authentication and authorization

### 7.1. General rules

| Requirement                                               | Level |
| --------------------------------------------------------- | ----- |
| HTTP / Streamable HTTP without authentication             | FORBIDDEN for internal servers |
| Passing secrets in the query string                       | FORBIDDEN |
| Passing secrets in logs / traces                          | FORBIDDEN |
| Anonymous access to `tools/list`, `prompts/list`          | MAY (if explicitly decided) |
| Authentication on `tools/call`, `prompts/get`, `resources/read` | MUST |

### 7.2. Supported corporate schemes

| Scheme            | Use                                   | Level |
| ----------------- | ------------------------------------- | ----- |
| `Bearer` (JWT)    | Primary for service-to-service and user-context | MUST support |
| `Bearer` (opaque) | Long-lived server tokens from the secret manager | MAY |
| `Basic`           | Service scenarios and admin endpoints only | MAY |
| Custom            | Only with explicit documentation in the README + the `use://http-headers` resource | MAY |

Header:

```http
Authorization: Bearer <token>
```

The detailed corporate JWT profile is in [Appendix A](#appendix-a-auth-profile).

### 7.3. Compatibility with OAuth MCP authorization

If the MCP server is published for generic MCP clients and uses authorization, it SHOULD follow the common
MCP authorization profile:

- the MCP server acts as an OAuth 2.1 resource server;
- the server publishes OAuth 2.0 Protected Resource Metadata
  (`/.well-known/oauth-protected-resource`);
- the authorization server publishes OAuth 2.0 Authorization Server Metadata
  (`/.well-known/oauth-authorization-server`);
- the HTTP 401 response contains `WWW-Authenticate` pointing to the resource metadata;
- the client uses the `resource` parameter on authorization/token requests;
- the server validates that the access token was issued specifically for this MCP server audience;
- token passthrough is forbidden: the MCP server MUST NOT forward downstream the same access token it
  received from the MCP client if the downstream is a separate resource server.

Internal Avatar servers MAY use the corporate JWT / opaque token profile without full OAuth discovery if
this is explicitly stated in the README and `use://auth`.

### 7.4. Authentication responses

| Situation                          | HTTP | Header                                          |
| ---------------------------------- | ---- | ----------------------------------------------- |
| Token missing                      | 401  | `WWW-Authenticate: Bearer realm="<service>"` or an OAuth resource metadata challenge |
| Token invalid / expired            | 401  | `WWW-Authenticate: Bearer error="invalid_token"` |
| Token valid, no rights for operation | 403 | —                                               |

Authentication errors at the HTTP layer are returned as HTTP 401/403. If the error is already inside
JSON-RPC processing, the server MAY return a JSON-RPC error in the §13 format, but it must not override the
standard JSON-RPC codes for transport auth.

### 7.5. Authorization

The server MUST support at least **boolean authorization** ("allowed / not allowed"). Fine-grained
authorization (per-tool, per-resource) is SHOULD.

If the server uses roles / scopes from a JWT, the list of claims used MUST be documented in
`use://http-headers` or a separate `use://auth` resource.

## 8. MCP methods and lifecycle

### 8.1. Lifecycle

The MCP lifecycle MUST be executed in the following order:

1. The client sends `initialize` with `protocolVersion`, `capabilities`, `clientInfo`.
2. The server responds with `initialize.result` with `protocolVersion`, `capabilities`, `serverInfo`.
3. The client sends `notifications/initialized`.
4. After that, both parties exchange normal MCP requests/notifications only within the negotiated
   capabilities.

Until initialization completes, both client and server SHOULD NOT send normal requests, except `ping` and
allowed service notifications.

### 8.2. Capability negotiation

The server MUST declare the capabilities it actually supports:

| Capability | Level | Purpose |
| ---------- | ----- | ------- |
| `tools` | MUST if the server publishes tools | Callable tools |
| `prompts` | MAY | Prompt templates |
| `resources` | MAY | Readable resources |
| `logging` | SHOULD | Structured log messages |
| `completions` | MAY | Autocomplete for arguments |
| `tasks` | MAY | Task-augmented execution, MCP 2025-11-25 |
| `experimental` | MAY | Non-standard extensions |

If a capability is not declared and negotiated, the server MUST NOT require the client to support the
corresponding methods.

### 8.3. MCP methods

The server MUST accept the standard MCP methods within the declared capabilities:

| Method            | Level                            | Purpose                             |
| ----------------- | -------------------------------- | ----------------------------------- |
| `initialize`      | MUST                             | Handshake, version, capabilities    |
| `notifications/initialized` | MUST accept after `initialize` | Completes initialization |
| `tools/list`      | MUST if the server publishes tools | List of tools                     |
| `tools/call`      | MUST if the server publishes tools | Tool invocation                   |
| `prompts/list`    | MUST if the server publishes prompts | List of prompts                 |
| `prompts/get`     | MUST if the server publishes prompts | Get a prompt                    |
| `resources/list`  | MUST if the server publishes resources | List of resources             |
| `resources/read`  | MUST if the server publishes resources | Read a resource               |
| `resources/templates/list` | MAY if the server publishes template resources | List of resource templates |
| `resources/subscribe` | MAY if subscriptions are supported | Subscribe to resource changes |
| `ping`            | SHOULD                           | Keepalive                           |

The server MUST NOT:

- register custom method names instead of the standard MCP ones;
- silently ignore an unknown method — it must return `-32601 Method not found`;
- use capability-specific methods without declaring the corresponding capability.

### 8.4. Pagination

The `tools/list`, `prompts/list`, `resources/list`, and `resources/templates/list` methods MUST support MCP
pagination if the potential list can be large.

Rules:

- the request MAY contain `params.cursor`;
- the response MAY contain `nextCursor`;
- the client SHOULD keep reading while `nextCursor` is present;
- the server MUST NOT change the order of items between pages within a single listing without a reason.

### 8.5. Cancellation

MCP supports cancellation of in-progress requests via `notifications/cancelled`.

The server SHOULD:

- accept `notifications/cancelled` for long-running operations;
- stop executing the cancelled request when it is safe to do so;
- release resources;
- log the reason without user secrets;
- not send a response for a request whose processing was cancelled before completion.

The client MUST NOT cancel `initialize`.

### 8.6. Progress

For long-running operations, the server MAY send `notifications/progress` if the request contains
`_meta.progressToken`.

Rules:

- `progressToken` must reference only an active request;
- the `progress` value must increase monotonically;
- `total` and `message` are optional;
- progress notifications must stop after the request completes;
- the rate of progress events must be limited so as not to overload the client.

### 8.7. Tasks

MCP 2025-11-25 introduces task-augmented execution as an additional capability. The server MAY declare the
`tasks` capability and `execution.taskSupport` on individual tools if it supports long-lived or managed
tasks.

If tasks are not supported, the server MUST NOT declare the `tasks` capability and must use the regular
`tools/call` flow.

## 9. Tools: external contract

### 9.1. Tool declaration

Each tool in `tools/list` MUST contain:

| Field         | Type   | Level   | Requirement                             |
| ------------- | ------ | ------- | --------------------------------------- |
| `name`        | string | MUST    | `^[a-z][a-z0-9_]{1,63}$`, snake_case, English. This corporate constraint is stricter than common MCP. |
| `description` | string | MUST    | Concise description + constraints + side effects + dangerous actions |
| `inputSchema` | object | MUST    | Valid JSON Schema 2020-12 by default    |
| `title`       | string | SHOULD  | Human-readable tool name for UI         |
| `outputSchema` | object | SHOULD if the tool returns `structuredContent` | JSON Schema of the result |
| `annotations` | object | MAY     | Hints to the client (`readOnlyHint`, etc.) |
| `icons`       | array  | MAY     | Icons for UI                            |
| `execution`   | object | MAY     | Execution metadata, including `taskSupport` |

The snake_case corporate rule is preserved deliberately. It narrows common MCP 2025-11-25, which also
allows `-`, `.`, uppercase, and camelCase.

### 9.2. `inputSchema` requirements

- JSON Schema 2020-12 is used by default.
- If draft-07 is used, the `$schema` field MUST be specified explicitly.
- `inputSchema` MUST be a valid JSON Schema object, not `null`.
- `type: "object"` at the top level — SHOULD.
- explicit `properties` — SHOULD;
- explicit `required` — SHOULD, even if empty;
- `additionalProperties: false` — SHOULD;
- a `description` for each field — SHOULD.

Recommended schema for a tool without parameters:

```json
{
  "type": "object",
  "additionalProperties": false
}
```

### 9.3. Side effects and risk level

This section is a corporate requirement on top of common MCP.

| Requirement                                                            | Level |
| --------------------------------------------------------------------- | ----- |
| A mutating tool MUST explicitly state its side effects in `description`. | MUST |
| A mutating tool MUST declare a risk level (for example `low` / `medium` / `high`). | MUST |
| Domain errors that the model can correct are returned as `result.isError=true`. | SHOULD |

The risk level MAY be expressed through the standard `annotations` field (for example `readOnlyHint`,
`destructiveHint`, `idempotentHint`) and MUST additionally be stated in human-readable form in
`description` so that a routing agent can reason about it without parsing annotations.

For tools with external side effects, the following MUST also be documented (in `description`, the README,
or a dedicated resource):

- an idempotency key, or the reason idempotency is absent;
- the retry policy;
- the timeout behavior;
- the audit event emitted by the operation;
- the approval requirement for risky actions.

A read-only tool SHOULD set `readOnlyHint: true` so that clients can treat it as safe to call without
confirmation.

### 9.4. `tools/call` behavior

| Situation                               | Response                                     |
| --------------------------------------- | ------------------------------------------- |
| Malformed JSON-RPC or invalid `tools/call.params` structure | JSON-RPC error `-32602 Invalid params` |
| Unknown `params.name`                   | JSON-RPC error `-32602 Invalid params` with the safe message `Unknown tool` |
| Business logic / domain validation error the model can fix | `result.isError=true` with actionable `content` |
| Internal JSON-RPC layer error           | JSON-RPC error `-32603 Internal error` without a stacktrace |
| Success                                 | `result` with `content`, `structuredContent`, or both formats |

The server MUST validate `arguments` against `inputSchema` before reaching the domain. Errors that relate
to the shape of the JSON-RPC request are returned as a JSON-RPC error. Tool execution errors and domain
errors are returned as a tool execution result with `isError: true` if that helps the model adjust the
request.

A schema violation produces `-32602` with a precise diagnostic: `error.message` reads
`Invalid params: <field>: <reason>; …` and `error.data` carries `field`, `reason` (a stable ajv keyword
such as `type` / `required` / `enum`), `errorCount`, and an `errors[]` array of up to 8 individual
failures (`{ field, reason, message }`). Diagnostics report the field and the violated constraint, plus
the actual JS type for type mismatches, but never the offending value (§13.3). The SDK enforces this
validation by default; it MAY be disabled per deployment via `mcp.tools.validateInput: false` when tools
self-validate their arguments.

Example of a tool execution error:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      { "type": "text", "text": "Invalid date: value must be in the future." }
    ],
    "isError": true
  }
}
```

### 9.5. Structured output

If a tool declares `outputSchema`, the server MUST return `structuredContent` that conforms to that schema.

For backward compatibility, a tool returning `structuredContent` SHOULD also return the serialized JSON in
`content` as `TextContent`.

## 10. Prompts: external contract

### 10.1. Prompt support

Prompts are an optional MCP capability. The server MAY publish no prompts. If the server publishes prompts,
it MUST declare the `prompts` capability and implement `prompts/list` and `prompts/get`.

### 10.2. Recommended Avatar profile prompts

For servers that participate in agent routing, the following SHOULD be published:

| Name            | Level   | Purpose                                     |
| --------------- | ------- | ------------------------------------------- |
| `agent_brief`   | SHOULD  | Short description for agent routing (level 1) |
| `agent_prompt`  | SHOULD  | Full operating instructions (level 2)       |

These prompts are an Avatar-profile corporate recommendation and are not mandatory names of common MCP.

### 10.3. `agent_brief` content

SHOULD describe:

- the server's domain;
- when to select this server;
- when **not** to select it;
- key constraints (read-only, data domain, etc.).

Size — SHOULD NOT exceed 2 KB of text.

### 10.4. `agent_prompt` content

SHOULD contain:

- instructions for using each tool;
- domain and security constraints;
- the expected format of the agent's responses;
- examples (SHOULD).

### 10.5. Parameterized prompts

If a prompt accepts arguments, they MUST be described in `prompts/list` via the standard MCP `arguments`
field.

Important: `prompts/list.result.prompts[].arguments` is not a full JSON Schema. It is an array of
descriptors of the form:

```json
[
  {
    "name": "code",
    "description": "The code to review",
    "required": true
  }
]
```

Complex prompt-argument validation rules SHOULD be documented in `description`, the README, or a separate
resource.

A prompt definition MAY contain `title`, `description`, `icons`, and `arguments` per MCP 2025-11-25.

## 11. Resources: external contract

### 11.1. URI schemes

Two classes of schemes are used.

**1. Service-specific scheme (MUST).** For resources belonging to a specific server, a unique scheme is
used that matches the service name in the registry:

```
<service-name>://<path>
```

Example: `staff://agent/brief`. The server MUST respond only to its own scheme and MUST NOT register
others.

**2. Reserved cross-service schemes (standard for the Avatar profile).** This standard reserves the
following global schemes for uniform meta-information; their semantics are fixed and identical across
internal servers:

| Scheme       | Purpose                                                    |
| ------------ | --------------------------------------------------------- |
| `use://`     | Instructions for using the server (headers, auth, etc.)   |
| `project://` | Server meta-information (version, name, owner)            |
| `doc://`     | Server documentation (README, etc.)                       |

The server MUST implement those `use://` / `project://` / `doc://` resources required by §11.2. Inventing
your own paths under these schemes beyond this standard is FORBIDDEN.

### 11.2. Recommended minimum resources

| URI                              | Level   | Purpose                                       |
| -------------------------------- | ------- | --------------------------------------------- |
| `<service-name>://agent/brief`   | SHOULD  | Mirror of the `agent_brief` prompt            |
| `<service-name>://agent/prompt`  | SHOULD  | Mirror of the `agent_prompt` prompt           |
| `use://http-headers`             | MUST if there are non-standard headers | Description of all expected HTTP headers |
| `use://auth`                     | SHOULD  | Description of the authentication scheme and claims |
| `project://version`              | SHOULD  | Current server version                        |
| `doc://readme`                   | MAY     | Mirror of the README                          |

### 11.3. Resource definition format

An item in `resources/list.result.resources[]` SHOULD describe:

| Field | Level | Purpose |
| ----- | ----- | ------- |
| `uri` | MUST | Unique resource URI |
| `name` | MUST | Resource name |
| `title` | MAY | Human-readable title for UI |
| `description` | MAY | Description |
| `mimeType` | MAY | MIME type |
| `size` | MAY | Size in bytes |
| `icons` | MAY | Icons for UI |

### 11.4. `resources/read` format

`resources/read` MUST return content inside `result.contents[]`. Each content item MUST contain `uri`,
`mimeType`, and one of the fields `text` or `blob`.

Example:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "contents": [
      {
        "uri": "doc://readme",
        "mimeType": "text/markdown",
        "text": "# README"
      }
    ]
  }
}
```

### 11.5. Additional resource capabilities

The server MAY support resource templates:

- declare the `resources` capability;
- implement `resources/templates/list`;
- return `resourceTemplates[]` with `uriTemplate`, `name`, `title`, `description`, `mimeType`, `icons`.

The server MAY support subscriptions:

- declare `resources.subscribe=true`;
- accept `resources/subscribe`;
- send `notifications/resources/updated` when a resource changes;
- send `notifications/resources/list_changed` if `resources.listChanged=true` is declared.

## 12. Result format

### 12.1. Allowed tool result formats

A tool result MAY contain one or both formats:

| Format              | When to use                                 |
| ------------------- | ------------------------------------------- |
| `content`           | Human-readable responses, markdown, text, image/audio/resource content |
| `structuredContent` | Machine-readable JSON data with a fixed schema |

For a specific tool, the format must be deterministic and documented.

### 12.2. Requirements

- if the response is truncated by limits, the truncation flag MUST be visible to the client (as text in
  `content` or a field in `structuredContent`);
- personal / sensitive data MUST be protected per the domain policy (masking, filtering);
- binary data is transmitted as `blob` with the correct `mimeType`;
- if `structuredContent` and `outputSchema` are used, the result MUST conform to `outputSchema`;
- for backward compatibility, `structuredContent` SHOULD be duplicated in `content` as serialized JSON
  text.

### 12.3. Text response example

```json
{
  "content": [
    { "type": "text", "text": "..." }
  ]
}
```

### 12.4. Structured response example

```json
{
  "content": [
    { "type": "text", "text": "{\"rows\":[],\"truncated\":false,\"rowCount\":0}" }
  ],
  "structuredContent": {
    "rows": [],
    "truncated": false,
    "rowCount": 0
  }
}
```

## 13. Error format

### 13.1. Protocol errors and tool execution errors

MCP uses two types of errors:

| Type | When to use | Format |
| ---- | ----------- | ------ |
| Protocol error | Invalid JSON-RPC, unknown method, malformed params, transport/protocol layer error | JSON-RPC error object |
| Tool execution error | The tool was called correctly, but the domain operation failed or the input can be fixed | `result.isError=true` |

Protocol error example:

```json
{
  "jsonrpc": "2.0",
  "id": "<request-id>",
  "error": {
    "code": -32602,
    "message": "Invalid params: root: missing required property \"name\"",
    "data": {
      "field": "name",
      "reason": "required",
      "errorCount": 1,
      "errors": [{ "field": "name", "reason": "required", "message": "root: missing required property \"name\"" }]
    }
  }
}
```

### 13.2. Classes of protocol errors

The full list is in [Appendix B](#appendix-b-error-codes).

| Class                | JSON-RPC code     | HTTP   |
| -------------------- | ----------------- | ------ |
| Parse error          | -32700            | 400    |
| Invalid request      | -32600            | 400    |
| Method not found     | -32601            | 404    |
| Invalid params       | -32602            | 400    |
| Internal error       | -32603            | 500    |
| Server error         | -32000            | 500    |
| Resource not found   | -32002            | 404    |
| Rate limited         | -32003            | 429    |
| Timeout              | -32004            | 504    |
| Payload too large    | -32005            | 413    |
| Upstream unavailable | -32006            | 503    |
| Conflict             | -32007            | 409    |

Auth failures at the HTTP layer are returned via HTTP 401/403 and `WWW-Authenticate`, not by overriding the
standard JSON-RPC codes.

### 13.3. Prohibitions

An error returned externally MUST NOT contain:

- a stack trace;
- secrets, tokens, passwords, connection strings;
- internal filesystem paths;
- raw SQL/expression text with user data;
- internal service names that are not part of the public contract.

### 13.4. Mapping upstream (downstream API) errors

This section is a corporate recommendation for servers that proxy a downstream HTTP API (Jira, GitLab, an
internal microservice, etc.). It defines how a failed upstream call is translated into the two error types
of §13.1 so that the model receives an actionable reason instead of one opaque `-32603 Internal error`.

When a tool calls a downstream API, the server SHOULD translate the upstream HTTP status into the matching
typed error class from [Appendix B](#appendix-b-error-codes) rather than collapsing every failure into a
generic internal error. The recommended mapping is:

| Upstream HTTP                     | Typed error class      | JSON-RPC | Returned to the model |
| --------------------------------- | ---------------------- | -------- | --------------------- |
| 400                               | `ValidationError`      | -32602   | `isError=true`        |
| 401 / 403                         | `ServerError` (with upstream status in `data`) | -32000 | `isError=true` |
| 404                               | `ResourceNotFoundError`| -32002   | `isError=true`        |
| 409                               | `ConflictError`        | -32007   | `isError=true`        |
| 429                               | `RateLimitedError`     | -32003   | thrown (see below)    |
| 502 / 503 / 504 / no response     | `UpstreamUnavailableError` | -32006 | `isError=true`      |
| other 5xx                         | `ServerError`          | -32000   | thrown                |

The decision whether to surface an error to the model or to throw it follows three rules:

- An error whose message is **safe to expose and actionable** — built from the structured upstream error
  body, not from internal state — SHOULD be returned as a tool execution result with `result.isError=true`
  (§9.4, §13.1). The model reads the upstream reason (for example `Issue AITECH-123 does not exist`) and
  self-corrects instead of treating the call as a hard sandbox failure. A `404` raised by the downstream
  API is the canonical case: it MUST reach the model as `result.isError=true`, not as a thrown protocol
  error.
- `-32003 Rate limited` MUST remain a **thrown** protocol error and MUST carry the `Retry-After` header /
  `retryAfter` value (§14, Appendix B.3). It MUST NOT be flattened into an `isError` text result, because
  clients rely on the numeric code and the retry hint to schedule a retry.
- An internal failure with **no upstream status** (the catch-all wrapper around an unexpected exception)
  MUST stay a thrown protocol error and MUST be sanitized per §13.3 — typically `-32603 Internal error`
  with no stack trace and no secrets.

A reference implementation of this pattern — a pure `normalizeToolError()` that converts any thrown value
into a typed error without throwing, an `isLlmVisibleError()` predicate that applies the three rules above,
and the `formatToolError()` call that surfaces the message — is documented in
[02-1-tools-and-api.md → "Normalizing upstream API errors"](./02-1-tools-and-api.md).

Whatever message is exposed (via `isError=true` or a thrown error) MUST still satisfy the §13.3
prohibitions: the upstream error body is forwarded only after it has been reduced to its human-readable
text, never as a raw payload that could carry internal paths, tokens, or stack traces.

## 14. Limits and protection

Each server MUST document and enforce:

| Limit                       | Default       | Level |
| --------------------------- | ------------- | ----- |
| Input payload size          | 1 MB          | MUST  |
| Tool result size            | 10 MB         | MUST  |
| Tool call timeout           | 30 seconds    | MUST  |
| Rate limit per token        | service-defined | SHOULD |
| Max concurrent calls per token | service-defined | SHOULD |

On exceeding a limit:

- payload too large → `-32005` / HTTP 413;
- result too large → truncation with an explicit flag;
- timeout → `-32004` / HTTP 504;
- rate limit → `-32003` / HTTP 429 with the `Retry-After` header.

On timeout, the sender SHOULD send `notifications/cancelled` and stop waiting for the response if applicable
to the current transport/session.

## 15. Observability

### 15.1. Correlation

For servers with the HTTP / Streamable HTTP transport, the server MUST support propagating identifiers via
HTTP headers:

| Header           | Level | Behavior                                   |
| ---------------- | ----- | ------------------------------------------ |
| `X-Request-Id`   | MUST  | Accept; generate if absent; return in the response |
| `traceparent`    | SHOULD | Accept the W3C trace context              |
| `tracestate`     | MAY   | Propagate further                          |
| `MCP-Session-Id` | MAY   | Use to correlate MCP session events, but not as identity |

For the stdio transport, the server MUST generate its own request id per JSON-RPC call and use it in logs
for correlation.

### 15.2. Logging

The server MUST log:

- the fact of a tool call: name, request id, duration, status (ok / error class);
- auth-failure facts: reason, request id;
- internal errors with full context — **only to internal logs**, never externally.

The server MUST NOT log:

- `arguments` values containing personal data, without masking;
- tokens, passwords, `Authorization` headers.

### 15.3. Metrics

SHOULD expose:

- a call counter by tool and status;
- a call-duration histogram;
- an auth-failures counter;
- a rate-limit events counter.

## 16. Health and readiness

### 16.1. `/health` (liveness)

| Property          | Requirement                         |
| ----------------- | ----------------------------------- |
| Method            | GET                                 |
| Authentication    | NOT required                        |
| Body              | JSON                                |
| HTTP 200          | service is alive                    |
| HTTP 503          | service cannot serve requests       |

Minimal body:

```json
{
  "status": "ok",
  "version": "1.2.3",
  "uptime": 3600
}
```

### 16.2. `/ready` (readiness)

SHOULD. Returns 200 only when the server is ready to accept `tools/call` (including dependency readiness:
DB, secret store, JWKS).

```json
{
  "status": "ready",
  "checks": {
    "db": "ok",
    "jwks": "ok"
  }
}
```

### 16.3. Prohibitions

The `/health` and `/ready` responses MUST NOT include:

- secrets;
- connection strings;
- full dependency error messages (status only).

## 17. Contract stability and deprecation

### 17.1. What is part of the public contract

| Element                          | Stability     |
| -------------------------------- | ------------- |
| Supported transports             | MAJOR         |
| HTTP endpoints (`/mcp`, `/health`, legacy `/sse`) | MAJOR |
| Authentication scheme            | MAJOR         |
| List of tools (names)            | MAJOR         |
| Tool `inputSchema` (required fields) | MAJOR     |
| Tool `outputSchema`              | MAJOR if published |
| Result format of each tool       | MAJOR         |
| Prompt names                     | MAJOR         |
| URI scheme and base resources    | MAJOR         |
| Error codes                      | MAJOR         |
| Adding a new tool / prompt / resource | MINOR    |
| Adding an optional field         | MINOR         |
| Extending a `description`        | PATCH         |

### 17.2. Deprecation process

1. The `description` of the tool/prompt/resource gets a `[DEPRECATED]` prefix and a support deadline.
2. It is announced in the server's CHANGELOG.
3. The minimum period before removal is **2 MINOR versions** or **3 months**, whichever is longer.
4. Known consumers are notified (via the owner team).
5. After the deadline, removal happens in the next MAJOR.

### 17.3. CHANGELOG

The server MUST maintain a `CHANGELOG.md` in the Keep a Changelog format.

## 18. Compliance checklist

Minimal acceptance checklist. All MUST items are mandatory to pass review.

### Transport and HTTP

- [ ] at least one transport from {stdio, streamable_http, legacy_http_sse} is supported
- [ ] for Streamable HTTP, `POST /mcp` is implemented
- [ ] `POST /mcp` accepts `Accept: application/json, text/event-stream`
- [ ] `MCP-Protocol-Version` is supported after initialization
- [ ] if sessions are used, `MCP-Session-Id` is supported
- [ ] `GET /health` is implemented for HTTP
- [ ] CORS is configured explicitly, without `*` in production
- [ ] `Origin` is validated; an invalid origin returns 403
- [ ] the maximum payload size is documented

### Authentication

- [ ] HTTP / Streamable HTTP requires authentication on `tools/call`
- [ ] `Authorization: Bearer <token>` is supported
- [ ] JWT is validated by issuer / audience / exp (see Appendix A)
- [ ] 401 contains a correct `WWW-Authenticate`
- [ ] for generic MCP clients, OAuth discovery is described, or the server is explicitly marked internal-only
- [ ] token passthrough is forbidden
- [ ] secrets are not passed in the query / logs

### MCP lifecycle and methods

- [ ] `initialize` responds with the protocol version, capabilities, and `serverInfo`
- [ ] the server accepts `notifications/initialized`
- [ ] only negotiated capabilities are used
- [ ] `tools/list` and `tools/call` work if the `tools` capability is declared
- [ ] `prompts/list` and `prompts/get` work if the `prompts` capability is declared
- [ ] `resources/list` and `resources/read` work if the `resources` capability is declared
- [ ] an unknown method → `-32601`

### Tools

- [ ] all tools have `name`, `description`, `inputSchema`
- [ ] names are snake_case and English
- [ ] `inputSchema` is compatible with JSON Schema 2020-12 or explicitly specifies `$schema`
- [ ] `arguments` are validated against the schema
- [ ] mutating tools state their side effects and risk level
- [ ] tools with external side effects document idempotency, retry, timeout, audit, and approval
- [ ] business/tool execution errors are returned via `result.isError=true`
- [ ] the result format is deterministic

### Prompts

- [ ] prompts are declared only if the `prompts` capability exists
- [ ] if the server participates in agent routing, `agent_brief` and `agent_prompt` are published, or the deviation is explained in the README
- [ ] prompt arguments are described via the standard MCP `arguments[]`, not as an `inputSchema`

### Resources

- [ ] if there are non-standard headers, `use://http-headers` is published
- [ ] URIs use scheme = service name or the corporate schemes `use://`, `project://`, `doc://`
- [ ] `resources/read` returns `result.contents[]` with `uri`, `mimeType`, `text` or `blob`
- [ ] `resources/templates/list` and subscriptions are implemented only if the corresponding capabilities are declared

### Errors and limits

- [ ] protocol errors are returned in the JSON-RPC format
- [ ] tool execution errors are returned via `isError=true`
- [ ] error codes match Appendix B
- [ ] timeout, rate limit, payload limit are implemented and documented
- [ ] errors do not contain a stacktrace or secrets

### Observability

- [ ] `X-Request-Id` is supported
- [ ] `traceparent` is accepted if the W3C trace context is used
- [ ] there is structured logging of calls
- [ ] logs do not contain tokens and PII without masking

### Documentation and contract

- [ ] there is a README describing the public contract
- [ ] there is a CHANGELOG.md
- [ ] semver is followed
- [ ] the version is available in `/health` and `initialize.result.serverInfo.version`
- [ ] the `project://version` resource is implemented, or it is explicitly acknowledged as optional for the server

---

## Appendix A. Auth profile

### A.1. JWT — the mandatory profile for internal servers

| Parameter         | Requirement                                       |
| ----------------- | ------------------------------------------------ |
| Signing algorithm | RS256 or ES256 (HS256 — local development only)   |
| Key source        | Corporate JWKS endpoint                           |
| JWKS cache        | TTL ≤ 10 minutes                                  |
| `exp` validation  | MUST                                              |
| `nbf` validation  | MUST if present                                   |
| `iss` validation  | MUST, value from config                           |
| `aud` validation  | MUST, value = server identifier                   |
| Allowed clock skew | ≤ 60 seconds                                     |

### A.2. Minimal set of claims

| Claim   | Type   | Purpose                                 |
| ------- | ------ | --------------------------------------- |
| `iss`   | string | Issuer (corporate IdP)                  |
| `aud`   | string | Target server identifier                |
| `sub`   | string | Subject identifier (user / service)     |
| `exp`   | number | Expiration                              |
| `iat`   | number | Issued-at time                          |
| `scope` | string | Space-separated list of scopes (if used) |

### A.3. Opaque tokens

Allowed only if:

- stored in the corporate secret store;
- rotated per company policy;
- verified via an introspection endpoint or a built-in whitelist.

### A.4. Basic Auth

- HTTPS only;
- admin/service endpoints only;
- credentials taken from the secret store, not from code.

### A.5. Header examples

```http
Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
MCP-Protocol-Version: 2025-11-25
MCP-Session-Id: 1868a90c-7c1e-4f8c-9c19-2d28d9e4f1aa
Accept: application/json, text/event-stream
X-Request-Id: 6f1c4f0e-2b7a-4f3e-8b7e-1a9b5c2d3e4f
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
```

---

## Appendix B. Error codes

### B.1. JSON-RPC codes

| Code     | Name               | HTTP | When                                        |
| -------- | ------------------ | ---- | ------------------------------------------- |
| -32700   | Parse error        | 400  | Invalid JSON                                |
| -32600   | Invalid Request    | 400  | Does not conform to JSON-RPC                |
| -32601   | Method not found   | 404  | Unknown MCP method                          |
| -32602   | Invalid params     | 400  | Invalid params structure / unknown tool name |
| -32603   | Internal error     | 500  | Internal error of the JSON-RPC layer        |

### B.2. Server codes (range -32000…-32099)

| Code     | Name               | HTTP | When                                        |
| -------- | ------------------ | ---- | ------------------------------------------- |
| -32000   | Server error       | 500  | Internal server error not related to tool execution |
| -32002   | Resource not found | 404  | Resource not found                          |
| -32003   | Rate limited       | 429  | Rate limit exceeded; include `Retry-After`  |
| -32004   | Timeout            | 504  | Call timeout exceeded                       |
| -32005   | Payload too large  | 413  | Size limit exceeded                         |
| -32006   | Upstream unavailable | 503 | A dependency is unavailable (DB, etc.)     |
| -32007   | Conflict           | 409  | State conflict (if applicable)              |

Auth failures are returned via HTTP 401/403. For insufficient scope/resource access, the server SHOULD use
HTTP 403 at the transport layer; if the error relates to a specific resource inside MCP, use a safe
protocol error or a tool/resource-specific response without disclosing secrets.

### B.3. `error.data` structure

`error.data` SHOULD contain the fields:

| Field      | Type   | Purpose                                     |
| ---------- | ------ | ------------------------------------------- |
| `requestId`| string | Request correlation id                      |
| `field`    | string | Field name for validation errors            |
| `reason`   | string | Machine-readable reason (`required`, `format`, `range`, etc.) |
| `retryAfter` | number | Seconds until retry (for -32003)          |

### B.4. Forbidden content

In `message` and `data`, the following is FORBIDDEN:

- stack traces;
- internal paths;
- secrets of any kind;
- raw user input text with potential PII.

---

## Appendix C. Input / output summary table

### C.1. What the server accepts

| Source                  | What                                 | Level   |
| ----------------------- | ------------------------------------ | ------- |
| Transport               | stdio / streamable_http / legacy_http_sse | at least one MUST |
| HTTP                    | `POST /mcp`, `GET /health`           | MUST for a streamable_http server |
| HTTP                    | `GET /mcp`                           | MAY for the SSE stream |
| HTTP                    | `GET /sse`                           | MAY, legacy only |
| Header                  | `Authorization: Bearer <token>`      | MUST for HTTP / Streamable HTTP |
| Header                  | `MCP-Protocol-Version`               | MUST after `initialize` for HTTP |
| Header                  | `MCP-Session-Id`                     | MUST if the server issued a session id |
| Header                  | `Accept: application/json, text/event-stream` | MUST for `POST /mcp` |
| Header                  | `X-Request-Id`                       | MUST accept |
| Header                  | `traceparent`                        | SHOULD  |
| MCP method              | `initialize`                         | MUST    |
| MCP notification        | `notifications/initialized`          | MUST accept |
| MCP method              | `tools/list`, `tools/call`           | MUST if the `tools` capability exists |
| MCP method              | `prompts/list`, `prompts/get`        | MUST if the `prompts` capability exists |
| MCP method              | `resources/list`, `resources/read`   | MUST if the `resources` capability exists |
| MCP method              | `resources/templates/list`           | MAY     |
| MCP method              | `resources/subscribe`                | MAY     |
| MCP notification        | `notifications/cancelled`            | SHOULD for long-running operations |
| `tools/call.params`     | `name`, `arguments`                  | MUST    |
| `prompts/get.params`    | `name`, `arguments?`                 | MUST    |
| `resources/read.params` | `uri`                                | MUST    |

### C.2. What the server returns

| Where                   | What                                 | Level   |
| ----------------------- | ------------------------------------ | ------- |
| `initialize.result`     | `protocolVersion`, `capabilities`, `serverInfo` | MUST |
| `tools/list.result`     | tools with `name`, `description`, `inputSchema`; SHOULD `title`, MAY `icons`, `outputSchema`, `execution` | MUST if tools exist |
| `tools/call.result`     | `content`, `structuredContent`, `isError?` | MUST if tools exist |
| `prompts/list.result`   | prompts; `agent_brief` / `agent_prompt` SHOULD for Avatar routing | MUST if prompts exist |
| `prompts/get.result`    | `description?`, `messages[]`         | MUST if prompts exist |
| `resources/list.result` | list of resources with `uri`, `name`, optional `title`, `mimeType`, `icons` | MUST if resources exist |
| `resources/read.result` | `contents[]` with `uri`, `mimeType`, `text` or `blob` | MUST if resources exist |
| `GET /health`           | JSON with `status`, `version`, `uptime` | MUST for HTTP |
| `GET /ready`            | JSON with `status`, `checks`         | SHOULD  |
| Response header         | `X-Request-Id`                       | MUST    |
| Response header         | `MCP-Session-Id`                     | MAY on `initialize` |
| Response header (401)   | `WWW-Authenticate: Bearer ...` or an OAuth resource metadata challenge | MUST |
| Response header (429)   | `Retry-After`                        | MUST    |
| Protocol error          | JSON-RPC error object without secrets and stacktraces | MUST |
| Tool execution error    | `result.isError=true`                | MUST for tool domain errors |

### C.3. What the server MUST NOT return externally

- stack traces;
- secrets, tokens, passwords, connection strings;
- internal paths and service names;
- raw SQL / DSL queries with user data;
- personal data beyond what the domain allows.
