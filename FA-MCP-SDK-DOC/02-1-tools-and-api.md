# Tools and REST API

## Tool Development

### Tool Definition (`src/tools/tools.ts`)

```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [{
  name: 'my_custom_tool',
  title: 'My custom tool',                                  // SHOULD §9.1 — human-readable name
  description: 'Description of what this tool does',
  inputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema', // standard §9.2
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Input query' },
      options: { type: 'object', description: 'Optional config' },
    },
    required: ['query'],
    additionalProperties: false,                             // reject unknown fields
  },
}];
```

**Standard §9.1 (MUST) — tool name `name` MUST match `/^[a-z][a-z0-9_]{0,62}$/`** (ASCII
snake_case, 1..63 chars). The SDK validates names eagerly at `initMcpServer()` for static
tool arrays and lazily on the first `getTools()` call for dynamic (function-form) tools — a
violation throws with the offending name printed.

**Standard §9.2 — `inputSchema` SHOULD declare `$schema: '…/draft/2020-12/schema'` and
`additionalProperties: false`.** Both fields are recognised by the `IToolInputSchema` type.

**Standard §9.3 (MUST) — arguments are validated server-side.** Before `toolHandler` is
called, the SDK validates `request.params.arguments` against `inputSchema` via ajv (draft
2020-12). On failure the response is JSON-RPC `-32602` and the handler is **not** invoked.
This means tool code no longer needs to repeat shape checks — by the time the handler runs,
`args` already matches the schema.

The error carries a precise, English diagnostic. The `message` reads
`Invalid params: <field>: <reason>; …` and `error.data` lists every violation:

```jsonc
{
  "code": -32602,
  "message": "Invalid params: /amount: expected number, got string; root: missing required property \"currency\"",
  "data": {
    "field": "/amount",          // first offending location (JSON Pointer or property name)
    "reason": "type",            // stable ajv keyword: type | required | enum | pattern | …
    "errorCount": 2,             // total violations before truncation
    "errors": [                  // up to 8 individual failures
      { "field": "/amount",   "reason": "type",     "message": "/amount: expected number, got string" },
      { "field": "/currency", "reason": "required", "message": "root: missing required property \"currency\"" }
    ]
  }
}
```

Diagnostics name the field, the violated constraint, and (for type errors) the actual JS type — never
the offending value itself, so no caller-supplied data leaks outward (standard §13.3). At most 8
failures are reported; the remainder are summarised as `(+N more)` in `message` and counted in
`errorCount`.

Input validation is on by default. It can be disabled with `mcp.tools.validateInput: false`
(or the `MCP_TOOLS_VALIDATE_INPUT` environment variable) — useful when tools validate their own
arguments or in a trusted internal deployment. The toggle does not affect `outputSchema` validation.

### Output schema and `structuredContent` (standard §9.4 / §12.4)

A tool MAY declare `outputSchema` to describe its `structuredContent` payload. When set,
the SDK validates the handler's response against the schema — a violation raises JSON-RPC
`-32603` (internal error: the tool broke its own contract). Whenever a response includes
`structuredContent`, the SDK mirrors a serialised JSON copy into `content[0].text` so
legacy clients that only read `content` keep working without code changes.

```typescript
export const tools: Tool[] = [{
  name: 'search_docs',
  title: 'Search documents',
  description: 'Vector search over the knowledge base.',
  inputSchema: { /* …as above… */ },
  outputSchema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, score: { type: 'number' } },
          required: ['id'],
          additionalProperties: true,
        },
      },
      total: { type: 'number' },
    },
    required: ['results'],
    additionalProperties: true,
  },
}];
```

### Tool Handler (`src/tools/handle-tool-call.ts`)

```typescript
import {
  formatToolResult, ToolExecutionError, logger,
  IToolHandlerParams, TToolHandlerResponse,
} from 'fa-mcp-sdk';

export const handleToolCall = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const { name, arguments: args, headers, payload, transport } = params;
  // payload: { user: string, ... } if JWT auth enabled
  // transport: 'stdio' | 'sse' | 'http'
  // headers: normalized lowercase keys

  try {
    switch (name) {
      case 'my_custom_tool':
        if (!args?.query) throw new ToolExecutionError(name, 'Query required');
        return formatToolResult({ message: `Processed: ${args.query}` });
      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Tool ${name} failed:`, error);
    throw error;
  }
};
```

The handler must return `TToolHandlerResponse` — a discriminated union of
`IToolHandlerTextResponse` (`{ content: [{ type: 'text', text }] }`) and
`IToolHandlerStructuredResponse<T>` (`{ structuredContent: T }`). The SDK forwards
the value as-is to the MCP client over STDIO, SSE, and HTTP. Use `formatToolResult()`
to pick the right shape based on `appConfig.mcp.tools.answerAs`.

### Returning errors — `isError: true` vs `throw`

The MCP spec distinguishes two error classes, and the LLM behaves very differently for each:

| Error class            | How to return                                            | What the LLM sees                                  |
|------------------------|----------------------------------------------------------|----------------------------------------------------|
| **Tool-level**         | `return formatToolError(msg)` (`isError: true` in result) | Error text inside the conversation — can self-correct, retry, ask the user |
| **Protocol-level**     | `throw new ToolExecutionError(name, msg)`                | JSON-RPC `error` envelope — most clients surface this as a hard sandbox failure the model cannot react to |

**Use `formatToolError()` for:**

- resource not found (`Issue AITECH-1 not found`)
- business validation (`Date must be in the past`)
- upstream API returned a recoverable error (404, 422, "rate limited, retry later")
- partial success the LLM should explain to the user

**Throw for:**

- unknown tool name (`switch` default branch)
- missing required transport feature (e.g. no `Mcp-Session-Id` for stateful clients)
- genuine infrastructure failure (DB connection dead, secret missing) that the LLM cannot work around

```typescript
import {
  formatToolResult, formatToolError, ToolExecutionError,
  IToolHandlerParams, TToolHandlerResponse,
} from 'fa-mcp-sdk';

export const handleToolCall = async (
  params: IToolHandlerParams,
): Promise<TToolHandlerResponse> => {
  const { name, arguments: args } = params;

  switch (name) {
    case 'get_issue': {
      const issue = await jira.findIssue(args.key);
      if (!issue) {
        // Tool-level: LLM sees "Issue X not found" and can ask the user to clarify.
        return formatToolError(`Issue ${args.key} not found`);
      }
      return formatToolResult(issue);
    }

    default:
      // Protocol-level: client routing problem, not something the LLM should retry.
      throw new ToolExecutionError(name, `Unknown tool: ${name}`);
  }
};
```

Direct-shape helpers (ignore `tools.answerAs`):

```typescript
import { asTextError, asJsonError } from 'fa-mcp-sdk';

asTextError('Not found');                      // { content: [{type:'text', text:'Not found'}], isError: true }
asJsonError({ code: 'NOT_FOUND', key: 'X' });  // { structuredContent: {...},                  isError: true }
```

> **Migration tip.** If your current handler does `throw new ToolExecutionError(name, 'Not found: ...')`
> for missing resources, convert those branches to `return formatToolError('Not found: ...')`. The
> LLM will start surfacing "Such an issue does not exist" to the user instead of failing the call.

### Normalizing upstream API errors

The `isError` vs `throw` decision above is easy when the handler discovers the problem itself (a `null`
issue). It is harder when the failure surfaces as a raw error thrown deep inside an HTTP client — a 404
from the upstream API arrives as an Axios/`fetch` rejection, not as a clean `formatToolError`. Catching
that in every handler is repetitive and easy to get wrong. The pattern below centralizes it in the single
`catch` of `handleToolCall`, and implements standard
[§13.4 "Mapping upstream errors"](./12-implementation-standard.md#134-mapping-upstream-downstream-api-errors).

It has three pure steps — translate, classify, surface:

```typescript
import {
  formatToolError, ToolExecutionError, ServerError, RateLimitedError,
  UpstreamUnavailableError, ValidationError, ConflictError, ResourceNotFoundError, toStr,
} from 'fa-mcp-sdk';

// 1. TRANSLATE — convert a raw upstream HTTP error into a typed error class (no throw here).
//    Map the upstream status onto the Appendix B error set instead of one opaque ServerError.
function handleAxiosError(error: any, toolName: string): never {
  const status = error?.response?.status;
  const msg = extractUpstreamMessage(error?.response?.data) ?? error?.message ?? 'Unknown error';
  const data = { toolName, status };                       // safe: no body, no headers, no stack

  if (!status || status >= 502) throw new UpstreamUnavailableError(`Upstream unavailable: ${msg}`, data);
  if (status === 400)           throw new ValidationError(`Invalid request: ${msg}`);
  if (status === 404)           throw new ResourceNotFoundError(msg, data);
  if (status === 409)           throw new ConflictError(`State conflict: ${msg}`, data);
  if (status === 429) {
    const retryAfter = parseInt(error?.response?.headers?.['retry-after'], 10) || 60;
    throw new RateLimitedError(`Rate limited: ${msg}`, retryAfter);
  }
  // 401/403 and other 5xx — keep the upstream status in `data.status` so step 2 can recognize it.
  throw new ServerError(`Upstream error (HTTP ${status}): ${msg}`, data);
}

// 2. NORMALIZE — turn ANY thrown value into a concrete Error, still WITHOUT throwing.
//    A pure function lets the MCP path (may surface to the LLM) and a REST path (always throws)
//    share one step.
export function normalizeToolError(error: any, toolName: string): Error {
  if (error instanceof ToolExecutionError || error instanceof ServerError ||
      typeof error?.jsonRpcCode === 'number') {
    return error;                                          // already a domain error
  }
  if (isAxiosError(error)) {
    try { handleAxiosError(error, toolName); } catch (converted) { return converted as Error; }
  }
  return new ServerError(toStr(error), { toolName }, true); // catch-all, sanitized (no upstream status)
}

// 3. CLASSIFY — decide whether the model should SEE the message (isError) or get a thrown protocol error.
export function isLlmVisibleError(error: any): boolean {
  if (error instanceof RateLimitedError) return false;     // retry contract — keep -32003 thrown
  if (error instanceof ToolExecutionError) return true;    // JQL/validation written for the model
  if (typeof error?.jsonRpcCode === 'number') return true; // ValidationError/NotFound/Conflict/Upstream
  if (error instanceof ServerError && error?.details?.status != null) return true; // upstream 401/403/5xx
  return false;                                            // catch-all ServerError → "Internal error"
}
```

Wire all three into the single `catch`, so every handler benefits without its own try/catch:

```typescript
} catch (error: any) {
  const normalized = normalizeToolError(error, toolName);
  if (isLlmVisibleError(normalized)) {
    // The model reads the upstream reason ("Issue AITECH-123 does not exist") and self-corrects.
    return formatToolError(normalized.message);
  }
  throw normalized;                                        // RateLimitedError / internal → protocol error
}
```

Why this split matters:

- A **404 raised by the upstream API** becomes `ResourceNotFoundError` (numeric `jsonRpcCode`), so
  `isLlmVisibleError` returns `true` and the model gets `result.isError=true` — exactly like the manual
  `formatToolError` branch in the previous section, but for an error it never saw directly.
- **`RateLimitedError` stays thrown** as `-32003` with `retryAfter` — clients depend on that contract, so
  it must not collapse into an `isError` text result.
- A **catch-all `ServerError`** (no `details.status`) stays thrown and is sanitized by the SDK to
  `Internal error` — its text may carry internal detail and MUST NOT reach the model (standard §13.3).

> Keep `normalizeToolError` **pure** (never throws). A throwing normalizer forces every call site into its
> own try/catch and defeats the point of centralizing the logic.

### Headers Access

Headers are normalized to lowercase. Available in HTTP/SSE transports:

```typescript
const authHeader = headers?.authorization;
const userAgent = headers?.['user-agent'];
const clientIP = headers?.['x-real-ip'] || headers?.['x-forwarded-for'];
```

### Transport-Based Credentials

`IToolHandlerParams` includes `ITransportContext` fields (`transport`, `headers`, `payload`,
`clientCapabilities`). See
[ITransportContext](./02-2-prompts-and-resources.md#itransportcontext).

### Cancellation (`signal`) — standard §8.5

`IToolHandlerParams.signal?: AbortSignal` is flipped when the client sends
`notifications/cancelled` for the current request. Pass it straight to any downstream
`AbortSignal`-aware API (`fetch`, `pg`, `axios` ≥ 0.22, …) — they will abort their work and
let the rejection propagate. Tool handlers MUST stop work once the signal aborts; the SDK
then suppresses the JSON-RPC response per §8.5.

```typescript
export const handleToolCall = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const { name, arguments: args, signal } = params;

  switch (name) {
    case 'search_documents': {
      // Native AbortSignal forwarding — fetch will throw AbortError when the client cancels.
      const res = await fetch(`https://docs.example.com/search?q=${encodeURIComponent(args.q)}`, {
        signal,
      });
      const items = await res.json();
      return formatToolResult({ items });
    }
  }
};
```

For libraries that do not understand `AbortSignal` natively, gate the work with
`signal.aborted` checks at safe seams (between DB pages, loop iterations, retry attempts):

```typescript
case 'long_running': {
  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('cancelled');
    }
    await process(chunk);
  }
  return formatToolResult({ ok: true });
}
```

When `signal` is `undefined` (legacy transports or older SDK consumers), behave as if it were
never aborted — handlers should remain forward-compatible.

### Progress (`sendProgress`) — standard §8.6

`IToolHandlerParams.sendProgress?` emits `notifications/progress` whenever the request
carried `_meta.progressToken`. When the client did not request progress, the SDK passes a
no-op so the handler can call it unconditionally — no `if` guard needed.

Rules enforced server-side:

- progress values MUST be monotonically non-decreasing (smaller values are silently dropped);
- emissions are throttled by `mcp.progress.throttleMs` (default 100 ms → max 10 events/s).

```typescript
case 'bulk_import': {
  const rows = await loadRows(args.source);
  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error('cancelled');
    }
    await importRow(rows[i]);
    sendProgress?.(i + 1, rows.length, `imported ${rows[i].id}`);
  }
  return formatToolResult({ inserted: rows.length });
}
```

The client receives:

```json
{
  "method": "notifications/progress",
  "params": {
    "progressToken": "abc-123",
    "progress": 42,
    "total": 100,
    "message": "imported acct-42"
  }
}
```

Choose `total` only when the upper bound is known up-front; otherwise omit it and the client
will render an indeterminate spinner.

### Task-augmented execution (long-running tools) — standard §8.7

A normal `tools/call` is synchronous: the client holds the connection open until the tool returns,
and the call is bound by the tool timeout (`mcp.limits.toolTimeoutMs`, 30 seconds by default). For
operations that legitimately take minutes — bulk exports, report generation, long searches — the
SDK supports **task-augmented execution**: the server returns a task identifier immediately and runs
the tool in the background; the client then polls for status and fetches the result when ready.

This feature is **opt-in and off by default**. To enable it:

1. Set `mcp.tasks.enabled: true` in the configuration. The server then advertises the `tasks`
   capability and accepts the lifecycle methods `tasks/list`, `tasks/get`, `tasks/result` and
   `tasks/cancel`.
2. Mark the long-running tool with `execution.taskSupport` in its declaration:

```typescript
{
  name: 'generate_report',
  title: 'Generate a large report',
  description: 'Builds a multi-page report. Long-running — call it as a task.',
  inputSchema: { /* … */ },
  // 'optional' — the client MAY ask for a task but can still call synchronously.
  // 'required' — the tool runs only as a task (a synchronous call is rejected with -32602).
  // 'forbidden' / omitted — synchronous only.
  execution: { taskSupport: 'optional' },
}
```

The same handler runs whether the tool is invoked synchronously or as a task — the SDK always
supplies `signal` and `sendProgress`. When the tool runs as a task, `signal` is flipped by
`tasks/cancel`, progress is delivered through `notifications/progress`, and the SDK emits a
`notifications/tasks/status` on every status change. On completion the task transitions to
`completed` (carrying the same result a synchronous call would return); on a thrown error it
transitions to `failed` with a sanitized message; on cancellation it transitions to `cancelled`.

The client drives the lifecycle by sending a `task` parameter on `tools/call` and then polling:

```jsonc
// 1. Create — returns immediately with { task: { taskId, status: "working", … } }
{ "method": "tools/call", "params": { "name": "generate_report", "arguments": {}, "task": {} } }

// 2. Poll status until terminal
{ "method": "tasks/get",    "params": { "taskId": "…" } }   // → { status: "working" | "completed" | … }

// 3. Fetch the result once completed (same shape a synchronous tools/call returns)
{ "method": "tasks/result", "params": { "taskId": "…" } }

// Optional — abort a running task
{ "method": "tasks/cancel", "params": { "taskId": "…" } }
```

The default task store keeps records **in process memory only** — it does not survive a server
restart, and it is scoped to a single instance (no shared store across a cluster). Retention,
poll interval and the retained-task cap are configured under `mcp.tasks.*` (see
[03-configuration.md](./03-configuration.md)); the full method contract is in
[11-public-contract.md](./11-public-contract.md) §4.

### MCP Apps — Reading Client Capabilities

`params.clientCapabilities` carries the client's `initialize`-time capabilities (including the
open-ended `extensions` map). Use it to branch a tool between UI-augmented and text-only
output. See [10-mcp-apps.md → "Reading client capabilities from fa-mcp-sdk"](./10-mcp-apps.md)
for the full helper surface (`getUiCapability`, `hostSupportsMcpApps`,
`MCP_APPS_EXTENSION_ID`, `MCP_APPS_RESOURCE_MIME_TYPE`).

### Outbound Webhooks (`x-web-hook`)

Handler-level pattern. The SDK does **not** ship a built-in webhook dispatcher — it exposes
everything you need (`params.headers`, `appConfig`, `logger`) and leaves the policy to the project.
This section is the **canonical recipe**: implement it as written so every fa-mcp-sdk-based MCP
server behaves the same way for clients and downstream collectors.

**What it is:** after every tool invocation the server can `POST` the tool result to an external
URL. Useful for audit trails, real-time dashboards, chaining MCP calls into CI/automation pipelines.
Opt-in per request (via header) and optionally per tool (via the response object). A failing webhook
**must never** fail the tool call.

#### Contract (stable across all MCPs)

**Inbound — precedence:**

| Source              | Form                                                    | Precedence |
|---------------------|---------------------------------------------------------|------------|
| Per-tool override   | `IToolResponse.hook: string` returned by the handler    | wins       |
| Per-request header  | `x-web-hook: <http(s) URL>`                             | fallback   |

If neither is present, no webhook fires.

**Outbound request:**

- Method: `POST`, `Content-Type: application/json`, timeout ≤ 10 000 ms
- Body:

```json
{
  "mcpName": "<appConfig.name>",
  "tool": "<tool_name>",
  "user": "<caller-id-or-omitted>",
  "response": { "...": "tool's full JSON result" }
}
```

| Field      | Description                                                                  |
|------------|------------------------------------------------------------------------------|
| `mcpName`  | `appConfig.name` — identifies which MCP sent the callback                    |
| `tool`     | Name of the invoked tool                                                     |
| `user`     | Best-effort caller identity (see *User resolution*); **omit** if unresolved  |
| `response` | Full JSON returned by the tool handler (same payload sent to the client)     |

Do **not** add ad-hoc fields on a per-project basis without versioning the body — downstream
collectors rely on this exact shape.

#### Implementation recipe

**1. Declare the header** so `use://http-headers`, Agent Tester, and tool-call introspection
advertise it:

```typescript
// src/start.ts
usedHttpHeaders.push({
  name: 'x-web-hook',
  description:
    'Optional URL called via POST after each tool invocation. '
    + 'Body: { mcpName, tool, user, response }. Fire-and-forget; failures are logged only.',
  isOptional: true,
});
```

**2. Add `hook?` to the internal tool-response type** (lets a handler override the URL per tool):

```typescript
// src/_types_/tool.ts
export interface IToolResponse {
  text: string;
  json: Record<string, any>;
  hook?: string; // per-tool URL override; takes precedence over x-web-hook header
}
```

**3. Dispatcher — fire-and-forget, never throws:**

```typescript
// src/tools/tools-manager.ts
import axios from 'axios';
import { appConfig, logger as lgr, toStr } from 'fa-mcp-sdk';

const logger = lgr.getSubLogger({ name: 'tools' });
const URL_REGEX = /^https?:\/\/[^\s]+$/i;

const callWebHook = (
  url: string,
  toolName: string,
  json: Record<string, any>,
  user?: string,
): void => {
  if (!URL_REGEX.test(url)) { return; }                 // silently drop garbage URLs
  const body = { mcpName: appConfig.name, tool: toolName, response: json, user };
  axios.post(url, body, { timeout: 10_000 })
    .catch((err) => logger.warn(`Web-hook POST ${url} failed: ${toStr(err?.message || err)}`));
};
```

Rules:

- **No `await`.** The webhook must not delay the MCP response.
- **No re-throws.** A 5xx, timeout, or DNS failure is a `warn` log, nothing more.
- **URL allow-list.** At minimum, require `http(s)://`. Add an internal-net allow-list via config
  (e.g. `webhook.allowedHosts`) if the threat model requires it (see *Security*).

**4. Wire it into the tool-call entry point** — dispatch after the handler resolves and before
the result is returned:

```typescript
export const handleToolCall = async (
  params: IToolHandlerParams,
): Promise<TToolHandlerResponse> => {
  const { name: toolName, arguments: args, headers: mcpRequestHeaders = {} } = params;

  const tool = (await getTools(mcpRequestHeaders)).get(toolName);
  if (!tool?.handler) { throw new ToolExecutionError(toolName, `Unknown tool: ${toolName}`); }

  const ctx: ToolContext = {
    httpClient: createHttpClient(mcpRequestHeaders),
    logger: logger.getSubLogger({ name: toolName }),
    mcpRequestHeaders,
  };

  const toolResponse: IToolResponse = await tool.handler(args, ctx);

  // ─── webhook dispatch (fire-and-forget) ─────────────────────────────────────
  const hookUrl = (toolResponse?.hook || mcpRequestHeaders['x-web-hook'] || '').trim();
  if (hookUrl) {
    const syncUser = resolveActualUser(mcpRequestHeaders);     // see step 5
    if (syncUser) {
      callWebHook(hookUrl, toolName, toolResponse.json, syncUser);
    } else {
      // Async user resolution — still fire-and-forget; do not block the tool response.
      getCachedSelfUser(ctx.httpClient, mcpRequestHeaders)
        .then((u) => callWebHook(hookUrl, toolName, toolResponse.json, u));
    }
  }
  // ────────────────────────────────────────────────────────────────────────────

  return formatToolResult(toolResponse);
};
```

**5. User resolution — best-effort, two-step.** The `user` field is what makes the webhook useful
for audit. Resolve carefully, but never let resolution fail the call.

- **Step A — Sync (preferred):** derive from headers / JWT payload / config without I/O
  (e.g. JWT `payload.user`, a custom `x-actual-user` header your auth layer stamps, etc.).
- **Step B — Async fallback (only when sync returns nothing):** call the upstream "who am I"
  endpoint with the same auth, **cache the result** (recommended TTL: 1 h, key by hashed
  `Authorization`), and dedupe in-flight requests (thundering-herd protection).
- If both steps fail → **omit** the `user` field. Never invent a placeholder like `"unknown"`.

```typescript
export function resolveActualUser (headers: Record<string, string>): string | undefined { /* … */ }

export const getCachedSelfUser = async (
  httpClient: AxiosInstance,
  headers: Record<string, string>,
): Promise<string | undefined> => { /* GET /me, cache by hashed Authorization, dedupe */ };
```

#### Per-tool override — when to use

A handler may force a specific webhook URL:

```typescript
return { text, json, hook: 'https://collector.internal/special' };
```

Use sparingly. Legitimate cases:

- a long-running tool whose result feeds a fixed pipeline regardless of the client;
- a tool that should **never** webhook (e.g. read of a secret) — return `hook: ''` only if the
  dispatcher treats empty string as "skip even if header is set". With the snippet above this works
  naturally because `(toolResponse?.hook || header)` short-circuits on any truthy `hook`; to force
  skip, have the handler strip the header from `ctx` or short-circuit `hookUrl` explicitly.

If neither applies, do not set `hook` — let the client decide.

#### Security

- **URL validation** — reject anything that does not match `http(s)://…`. For public-facing MCPs,
  restrict to a configured allow-list (`webhook.allowedHosts` in `config/default.yaml`).
- **SSRF surface** — the webhook is a server-side `POST` to a client-supplied URL. Acceptable for
  trusted MCP clients; not acceptable open on the internet without an allow-list.
- **No secrets in the body** — `response` is the same JSON the client already received. Do **not**
  add credentials, raw tokens, or PII not present in the response.
- **No retries** — duplicate POSTs to a flaky collector are worse than a missed event. If the
  collector needs guarantees, let it poll.
- **Logging** — log `tool`, target host, and outcome at `warn`/`debug`; **never** log the full body
  at `info` level (audit log noise + potential PII).

#### Testing checklist

- [ ] Header declared in `usedHttpHeaders` and visible at `/use://http-headers`.
- [ ] Tool call **without** `x-web-hook` → no outbound POST.
- [ ] Tool call **with** valid `x-web-hook` → exactly one POST, body matches the contract above.
- [ ] Collector returns 500 → tool response still succeeds; one `warn` line in the log.
- [ ] Collector hangs → tool response returns within normal latency; POST aborts at 10 s.
- [ ] Malformed URL (`javascript:…`, missing scheme) → no POST, no error to client.
- [ ] Per-tool `hook` set → wins over the header.
- [ ] Sync user resolution hits → `user` populated immediately, no extra HTTP call.
- [ ] Sync empty, async succeeds → POST fires after `/me` resolves; tool response was not delayed.
- [ ] Both user paths fail → POST fires with `user` **field omitted** (not `null`, not `"unknown"`).


## REST API Endpoints

Define REST endpoints in `src/api/router.ts` using [tsoa](https://tsoa-community.github.io/docs/) decorators.

### OpenAPI Generation

- **Auto-generated** on startup if `swagger/openapi.yaml` missing
- **Swagger UI**: `/docs`
- **Spec**: `/api/openapi.json`, `/api/openapi.yaml`
- Regenerate: delete `swagger/openapi.yaml` and restart

### Controller Example

```typescript
import { Router } from 'express';
import { Route, Get, Post, Body, Tags, Query } from 'tsoa';
import { logger } from 'fa-mcp-sdk';

export const apiRouter: Router = Router();

interface UserResponse { id: string; name: string; email: string; }
interface CreateUserRequest { name: string; email: string; }

@Route('api')
export class UserController {
  @Get('users/{userId}')
  @Tags('Users')
  public async getUser(userId: string): Promise<UserResponse> {
    return { id: userId, name: 'John', email: 'john@example.com' };
  }

  @Post('users')
  @Tags('Users')
  public async createUser(@Body() body: CreateUserRequest): Promise<UserResponse> {
    return { id: 'new-id', name: body.name, email: body.email };
  }

  @Get('users')
  @Tags('Users')
  public async searchUsers(@Query() query?: string, @Query() limit?: number): Promise<UserResponse[]> {
    return [];
  }
}
```

### tsoa Decorators

| Decorator | Example |
|-----------|---------|
| `@Route('prefix')` | `@Route('api')` |
| `@Get('path')` | `@Get('users/{id}')` |
| `@Post('path')` | `@Post('users')` |
| `@Put('path')` | `@Put('users/{id}')` |
| `@Delete('path')` | `@Delete('users/{id}')` |
| `@Tags('name')` | `@Tags('Users')` |
| `@Body()` | `@Body() data: Request` |
| `@Query()` | `@Query() search?: string` |
| `@Path()` | `@Path() id: string` |
| `@Header()` | `@Header('x-api-key') key: string` |
| `@Security('bearerAuth')` | Mark endpoint as requiring auth |

**Note**: Apply `@Tags()` to methods, not class.

### Manual Routes

For routes without OpenAPI docs:

```typescript
import { createAuthMW } from 'fa-mcp-sdk';

const authMW = createAuthMW();
apiRouter.get('/internal/status', authMW, (req, res) => {
  res.json({ status: 'ok' });
});
```

## OpenAPI Types

```typescript
import { configureOpenAPI, OpenAPISpecResponse, SwaggerUIConfig } from 'fa-mcp-sdk';

interface OpenAPISpecResponse {
  openapi: string;                  // '3.0.0'
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description: string }>;
  paths: Record<string, any>;
  components?: { schemas?: Record<string, any>; securitySchemes?: Record<string, any> };
  tags?: Array<{ name: string; description: string }>;
}

interface SwaggerUIConfig {
  customCss?: string;
  customSiteTitle?: string;
  customfavIcon?: string;
  swaggerOptions?: {
    persistAuthorization?: boolean;
    displayRequestDuration?: boolean;
    docExpansion?: 'none' | 'list' | 'full';
    defaultModelsExpandDepth?: number;
  };
}
```

### Swagger Config

```yaml
# config/default.yaml
swagger:
  servers:
    - url: 'https://api.example.com'
      description: 'Production'

webServer:
  auth:
    enabled: true  # Adds Bearer auth to spec
```


### Example: Complete API Setup

```typescript
// src/api/router.ts
import { Router } from 'express';
import { Route, Get, Post, Body, Tags, Security } from 'tsoa';

export const apiRouter: Router = Router();

interface DataResponse {
  id: string;
  value: string;
}

@Route('api')
export class DataController {
  /**
   * Get data by ID
   * @param id Unique identifier
   */
  @Get('data/{id}')
  @Tags('Data')
  @Security('bearerAuth')
  public async getData(id: string): Promise<DataResponse> {
    return { id, value: 'example' };
  }

  /**
   * Create new data entry
   */
  @Post('data')
  @Tags('Data')
  @Security('bearerAuth')
  public async createData(
    @Body() body: { value: string }
  ): Promise<DataResponse> {
    return { id: 'new-id', value: body.value };
  }
}
```

After starting the server with this controller:
- Swagger UI available at `/docs`
- Endpoints documented with authentication requirements
- Request/response schemas generated from TypeScript types
