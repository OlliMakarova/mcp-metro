# Agent Tester and Headless API

## Overview

The Agent Tester is a built-in AI agent system for developing and refining MCP server tools. It goes beyond functional testing — it validates the **full agent experience**: how the LLM interprets tool descriptions, selects tools, passes arguments, and presents results.

The Headless API provides programmatic access to the Agent Tester without a browser. It enables CLI-based automated testing and returns structured trace data for every tool call, argument, result, and LLM decision.

## Developing MCP Servers as Agents

An MCP server is not just a set of tools — it is an **agent interface**. The LLM acts as the agent, deciding which tools to call, with what arguments, and how to interpret results. This means the quality of the agent experience depends on:

- **Tool descriptions** — the LLM reads them to decide when and why to call a tool
- **Parameter schemas** — names, types, required/optional flags, and default value documentation guide the LLM's argument construction
- **Response format** — `formatToolResult()` output must be structured so the LLM can interpret and relay it to the user
- **Agent prompt** — the system prompt shapes the LLM's conversation style, tool usage logic, and error handling behavior
- **Tool decomposition** — whether one tool should be split into two, or two merged into one

All of these aspects are **invisible to unit tests**. A tool can pass all unit tests and still produce a poor agent experience because the LLM misinterprets the description, sends wrong argument types, or doesn't understand the response format.

The Agent Tester closes this gap by running the **full agent loop**: user message → LLM reasoning → tool selection → tool execution → LLM interpretation → user response.

## Three-Phase Development Workflow

### Phase 1: Initial Architecture

Design tools, prompts, parameters, and handler logic based on task requirements. Implement a first working version:

```bash
npm run cb && npm start
```

### Phase 2: Basic Functionality

Verify compilation, server startup, tool registration, and basic calls. Fix crashes, connection errors, and missing tools.

### Phase 3: Iterative Refinement

This is the key phase. Send test messages through the Agent Tester, observe the agent's behavior, diagnose issues, and refine:

```
observe agent behavior → diagnose root cause → fix → rebuild → re-test
```

Root cause categories:
- **Tool description** — LLM picks wrong tool or misunderstands purpose
- **Parameter schema** — LLM sends wrong types or misses required params
- **Agent prompt** — LLM doesn't follow desired conversation style
- **Handler logic** — tool results confuse the LLM
- **Error messages** — failures produce unhelpful responses

## Authentication (`agentTester.useAuth`)

When `agentTester.useAuth` is `true`, the Agent Tester is protected by the full multi-auth middleware — the same authentication chain used for MCP endpoints (`permanentServerTokens` / `basic` / `jwtToken` / `custom`).

### How It Works

**Browser access:** When a user opens `/agent-tester` in a browser, the page loads normally (static assets are served without auth). The frontend checks `GET /api/auth/status` and displays a **login dialog** if the user is not authenticated. The dialog adapts to configured auth methods:

- If `permanentServerTokens` or `jwtToken` is configured — shows a "Token" input
- If `basic` auth is configured — shows "Username" + "Password" inputs
- If both are configured — shows tabs to switch between methods

After successful login via `POST /api/auth/login`, the server issues an httpOnly session cookie (`__at_sid`). All subsequent API requests from the browser include this cookie automatically. The session is valid for the configured TTL (default: 8 hours — see [Session Lifetime](#session-lifetime) below). A logout button appears in the header.

**Headless / CLI access:** Headless API consumers (curl, scripts, Claude Code) bypass the login dialog entirely. They pass an `Authorization` header with each request, which is validated by the standard `authMW`. No session cookie is needed.

### Configuration

```yaml
agentTester:
  useAuth: true              # Show login screen for browser, require auth for API
  sessionTtlMs: 28800000     # Browser session lifetime in ms (default: 8h)
  tokenTTLSec: 1800          # TTL of JWTs auto-issued for the chat UI / headless clients (default: 30 min)

webServer:
  auth:
    enabled: true
    permanentServerTokens: ['my-secret-token']
    # and/or basic, jwtToken — any configured method will be available
```

Environment variables:

- `AGENT_TESTER_USE_AUTH=true`
- `AGENT_TESTER_SESSION_TTL_MS=28800000`
- `AGENT_TESTER_TOKEN_TTL_SEC=1800`

When `useAuth` is `false` (default), the Agent Tester is accessible without any authentication and `sessionTtlMs` has no effect.

### Session Lifetime

When `useAuth` is `true`, a successful browser login creates a server-side session and sets an httpOnly cookie (`__at_sid`) scoped to `/agent-tester`. Both the in-memory entry and the cookie's `Max-Age` use the same TTL from `agentTester.sessionTtlMs`.

**Where sessions live**: an in-memory `Map` inside the server process (`src/core/auth/agent-tester-auth.ts`). There is no disk or Redis persistence — this is intentional because Agent Tester is a development tool, not a production auth system.

**Default TTL**: 8 hours (`28_800_000` ms). Override by setting `agentTester.sessionTtlMs` in `config/default.yaml` (or any environment-specific override file), or via `AGENT_TESTER_SESSION_TTL_MS`. Values are in milliseconds; any non-positive or non-finite value falls back to the 8h default.

**Cleanup**: a background sweep runs every 30 minutes and drops expired entries from the map. Expired entries are also evicted lazily on access.

**Impact of closing the browser or restarting the server**:

| Scenario | Re-login required? |
|---|---|
| Close tab, reopen within TTL | No — cookie is persistent, server session still live |
| Close entire browser, reopen within TTL | No — cookie is persistent, server session still live |
| TTL elapsed since last login | Yes — server drops the entry, responds 401 |
| Server restart (Ctrl+C, deploy, crash) | Yes — in-memory map is cleared; browser presents an unknown `__at_sid` and the login overlay reappears |
| User clicks the Logout button | Yes — `POST /api/auth/logout` deletes the entry and clears the cookie |

**Tuning guidance**:

- **Shorter TTL (e.g. 1 hour = `3600000`)**: more frequent logins, smaller exposure if a workstation is left unlocked.
- **Longer TTL (e.g. 24 hours = `86400000`)**: fewer interruptions during long development sessions.
- **Do not set TTL to 0 or a negative value** — the server will silently fall back to the 8h default.

> **Note**: the TTL only affects the browser login flow. Headless API access via `Authorization` header is stateless and completely bypasses sessions; it is unaffected by `sessionTtlMs`.

### Auth API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/status` | GET | Returns `{ authRequired, authenticated, methods }` |
| `/api/auth/login` | POST | Validates credentials, sets session cookie |
| `/api/auth/logout` | POST | Destroys session, clears cookie |
| `/api/auth-token` | GET | Returns a ready-to-use `Authorization` header value for the configured MCP auth method (used by the chat UI to auto-fill the header). Response: `{ authType, token, ttlSec? }`. |
| `/api/auth-token/refresh` | POST | Re-issues a fresh JWT (only when `webServer.auth.jwtToken.encryptKey` is configured). Response: `{ authType: 'jwtToken', token, ttlSec }`. |

### Auto-filled Authorization Header

When the MCP server requires authentication (`webServer.auth.enabled: true`) and the chat UI is configured to send the `Authorization` header, the page does **not** ask the user to type a token — it issues one for itself by calling `GET /api/auth-token` on load. The endpoint returns a header value derived from the configured method, in priority order:

1. **`jwtToken`** — `Bearer <standard signed JWT>` issued by the server with `sub: 'agentTester'`, `aud: <appConfig.name>`, and TTL = `agentTester.tokenTTLSec` (default 1800 sec / 30 min). The response also includes `ttlSec` so the client can plan refresh.
2. **`basic`** — `Basic <base64(user:password)>` from `webServer.auth.basic`.
3. **`permanentServerTokens`** — `Bearer <first configured token>`.

For **JWT only**, the page periodically refreshes the token on its own via `POST /api/auth-token/refresh`. The refresh cadence is approximately `max(30, ttlSec/3 - 60)` seconds (≈ once per 1/3 of TTL, with a 60-second safety lead and a 30-second floor). At the default `tokenTTLSec: 1800`, this means a refresh roughly every **9 minutes**. The page additionally triggers an immediate refresh when the tab regains focus or `visibilitychange` fires `'visible'`, to recover from background-tab timer throttling.

If the MCP call still fails with HTTP 401 — for example, the cached token expired in the brief window between the last refresh and the request — the server transparently re-issues a JWT and retries the call **once**, but only when the target URL points to the same server (host/port match `webServer.{host,port}`, with `localhost`/`127.0.0.1`/`::1`/`0.0.0.0` treated as equivalent) and the cached header was a `Bearer …` token. This means the user typically does not see a 401 even if a request races against TTL expiry.

**Tuning**:
- Shorter `tokenTTLSec` → more frequent refresh requests but smaller window of exposure if a token leaks.
- Longer `tokenTTLSec` → fewer refreshes; useful for very long-running sessions.
- Headless clients (the `headless-chat.js` wrapper, custom curl scripts) may either rely on the 401-retry path or, for long-running scripts, mint their own JWT via `node scripts/generate-jwt.js` with an appropriate TTL — Agent Tester does not refresh tokens on behalf of headless clients.

**Login request body:**

```json
// Token-based (permanent token or JWT)
{ "token": "my-secret-token" }

// Basic auth
{ "username": "admin", "password": "secret" }
```

### Headless Client Example

```bash
# Access Agent Tester API with token (no login needed)
curl -H "Authorization: Bearer my-secret-token" http://localhost:9876/agent-tester/api/mcp/status

# Headless test with token
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Authorization: Bearer my-secret-token" \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}'
```

### Windows Encoding Note (curl + Cyrillic / Non-ASCII)

On Windows, curl's `-d` flag may corrupt non-ASCII characters (e.g. Cyrillic) because the shell passes bytes in the system codepage (CP1251), not UTF-8. The LLM then receives garbled text and propagates it into tool arguments.

**Symptom:** tool call arguments contain mojibake like `п�?п�?п�?п�?п�?` instead of readable Russian text.

**Fix:** write the JSON body to a file (UTF-8) and use `--data-binary @file`:

```bash
# 1. Write request JSON to a file (editor must save as UTF-8)
cat > tmp-request.json << 'EOF'
{"message":"Отправь письмо на user@example.com с темой \"Тест\"","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}
EOF

# 2. Send with --data-binary to preserve UTF-8 encoding
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @tmp-request.json
```

This is only needed when running curl from a Windows shell with non-ASCII text. Linux/macOS terminals use UTF-8 by default and are not affected.

## Disabled State

When `agentTester.enabled` is `false` (or not set), all `/agent-tester/*` endpoints — including the Headless API — return HTTP 404:

```json
{
  "error": "Not found"
}
```

This prevents disclosing the existence of the Agent Tester to external users.

To enable, developer can use one of:

- **ENV**: `AGENT_TESTER_ENABLED=true`
- **Config file** `config/local.yaml`:
  ```yaml
  agentTester:
    enabled: true
  ```

### Hiding Footer Link Without Disabling Tester

To keep the Agent Tester functional (accessible directly by URL) but hide the link from the home page footer, use `showFooterLink: false`:

```yaml
agentTester:
  enabled: true
  showFooterLink: false   # Tester works, but footer link is hidden
```

When `showFooterLink` is omitted or `true` (default), the footer link is shown as usual.

**For Claude Code**: When you receive a 404 response on `/agent-tester/*`, the Agent Tester may be disabled. Inform the developer and suggest enabling it via `agentTester.enabled: true` in `config/local.yaml` or ENV `AGENT_TESTER_ENABLED=true`. The developer decides whether to turn it on. If the developer's prompt or instructions explicitly say not to mention Agent Tester enablement, respect that and stay silent.

## LLM Availability Check

Before using the Agent Tester or Headless API, verify that the OpenAI API key is configured and works:

```bash
npm run check-llm
```

The script checks that `agentTester.openAi.apiKey` is set and makes a minimal `chat.completions.create` request (max_tokens: 1) to verify the key works. Prints `OK` on success, `FAIL: <reason>` on failure. Exit code `0` = success, `1` = failure.

For custom OpenAI-compatible endpoints where `gpt-4o-mini` doesn't exist, pass the model name:

```bash
npm run check-llm -- my-custom-model
```

**For Claude Code**: When the development prompt or instructions mention testing with the Headless API or Agent Tester, run `npm run check-llm` before starting any Agent Tester work. If the script exits with a non-zero code, inform the developer about the issue and ask them to fix the configuration before proceeding.

## Headless API Reference

### Connection Verification

```
GET /agent-tester/api/mcp/status
```

Returns connection state and all available tools without going through the UI:

```json
{
  "connected": true,
  "servers": [
    {
      "name": "localhost9876",
      "url": "http://localhost:9876/mcp",
      "transport": "http",
      "tools": [
        { "name": "get_currency_rate", "description": "Get current cross-rate...", "inputSchema": {} }
      ],
      "toolCount": 1
    }
  ],
  "totalTools": 1
}
```

### Headless Chat Test

```
POST /agent-tester/api/chat/test
```

Same request body as `POST /api/chat/message`, but returns a **structured trace** of all intermediate steps.

#### Request Body

```json
{
  "message": "What is the exchange rate of EUR to USD?",
  "mcpConfig": {
    "url": "http://localhost:9876/mcp",
    "transport": "http",
    "headers": { "Authorization": "Bearer <token>" }
  },
  "sessionId": "optional-session-id",
  "agentPrompt": "optional agent prompt override",
  "customPrompt": "optional additional instructions appended after agentPrompt",
  "modelConfig": {
    "model": "gpt-4o",
    "temperature": 0.3,
    "maxTokens": 4096,
    "maxTurns": 10
  }
}
```

Only `message` is required. `mcpConfig` is required for tool calls.

| Field | Required | Description |
|-------|----------|-------------|
| `message` | yes | User message to send to the agent |
| `mcpConfig` | no | MCP server connection config (required for tool calls) |
| `sessionId` | no | Session ID for multi-turn conversations; omit to start fresh |
| `agentPrompt` | no | Agent prompt to send to the LLM as the system prompt. When provided, **replaces** the MCP server's `agent_prompt`. When omitted, the MCP server's `agent_prompt` is used (if available), otherwise a built-in default |
| `customPrompt` | no | Additional instructions appended after `agentPrompt`. Use for per-request modifiers without replacing the main prompt |
| `modelConfig` | no | LLM model settings (model name, temperature, maxTokens, maxTurns) |
| `appMode` | no | Boolean. When `true`, advertises MCP Apps UI capability on the MCP `initialize` handshake (so the server returns UI-augmented tool variants), appends an MCP-Apps-aware system prompt, and records the would-be-rendered UI resource for each tool call in `trace.turns[].app_calls[]`. Default `false` — text-only behavior. See [MCP Apps Mode](#mcp-apps-mode) |

#### Brief Response (default)

```json
{
  "message": "The EUR/USD rate is 1.0847",
  "sessionId": "abc-123",
  "trace": {
    "system_prompt_sent": "You are a currency assistant...\n\nBe concise.",
    "turns": [
      {
        "turn": 1,
        "tool_calls": [
          { "name": "get_currency_rate", "arguments": { "quoteCurrency": "EUR", "baseCurrency": "USD" } }
        ],
        "tool_results": [
          { "name": "get_currency_rate", "result": { "symbol": "EURUSD", "rate": 1.0847 }, "duration_ms": 230 }
        ]
      }
    ],
    "total_turns": 2,
    "total_duration_ms": 1850,
    "tools_used": ["get_currency_rate"]
  }
}
```

The `system_prompt_sent` field contains the **final system prompt** that was sent to the LLM. Use it to verify exactly what the LLM received — especially when iterating on agent prompt variations.

Brief mode shows the tool interaction chain: which tools were called, with what arguments, and what they returned. No LLM internals.

#### Verbose Response

```
POST /agent-tester/api/chat/test?verbose=true
```

Adds per-turn LLM request/response details:

```json
{
  "turns": [
    {
      "turn": 1,
      "llm_request": { "model": "gpt-4o", "messages_count": 3 },
      "llm_response": {
        "finish_reason": "tool_calls",
        "content": null,
        "usage": { "prompt_tokens": 450, "completion_tokens": 32, "total_tokens": 482 }
      },
      "tool_calls": [...],
      "tool_results": [...]
    }
  ]
}
```

Use verbose mode when:
- The agent doesn't call the expected tool and the brief trace doesn't explain why
- The agent loops without resolving (check `finish_reason`)
- Token usage is unexpectedly high
- The response is empty or unexpected

#### Size Limit Overrides

```
POST /agent-tester/api/chat/test?maxResultChars=8000&maxTraceChars=100000
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `maxResultChars` | 4000 | Max characters per tool result in trace |
| `maxTraceChars` | 50000 | Max total trace size; older turns are collapsed to summaries when exceeded |

### Prompt Assembly

The system prompt sent to the LLM is resolved by priority — the first available value wins:

```
request.agentPrompt  →  session.agentPrompt  →  MCP server's agent_prompt  →  built-in default
```

If `customPrompt` is provided, it is appended after the resolved prompt.

The final result is sent as `{ role: "system" }` to the LLM and returned in the trace as `system_prompt_sent`.

**Key principle:** when `agentPrompt` is passed in the request, it **replaces** the MCP server's `agent_prompt` entirely. This enables the iterative prompt refinement workflow:

1. Read the current `AGENT_PROMPT` from `src/prompts/agent-prompt.ts`
2. Send it as `agentPrompt` in the headless request
3. Evaluate the agent's response and trace
4. Modify the prompt, send again
5. When satisfied, write the best variant back to `src/prompts/agent-prompt.ts`

```bash
# Test current prompt
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -d '{"message":"Get EUR/USD rate","agentPrompt":"You are a concise currency assistant. Use tools, reply in one sentence.","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}'

# Try a different variation
curl -X POST http://localhost:9876/agent-tester/api/chat/test \
  -H "Content-Type: application/json" \
  -d '{"message":"Get EUR/USD rate","agentPrompt":"You are a financial analyst. Explain rates with market context and trends.","mcpConfig":{"url":"http://localhost:9876/mcp","transport":"http"}}'
```

Compare `system_prompt_sent` and agent responses between variations to find the optimal prompt. When omitting `agentPrompt`, the MCP server's own `agent_prompt` is used automatically — this tests the currently deployed prompt as-is.

### Sessions

The headless API shares sessions with the chat UI. To start a fresh conversation, omit `sessionId`. To continue an existing conversation, pass `sessionId` from a previous response.

## MCP Apps Mode

Agent Tester doubles as a developer-grade MCP Apps host. When activated, it advertises UI capability
on the MCP `initialize` handshake so the connected server can branch between text-only and
UI-augmented tool variants, renders returned UI resources inside sandboxed iframes alongside chat
messages, and exposes the same wire-level events to headless tests. The mode is **fully optional**
and orthogonal to existing features — when off, Agent Tester behaves exactly as before.

### Toggling MCP Apps mode

The header carries a global `Apps` checkbox (test-id `at-app-mode-toggle`) visible on every tab.
Toggling it:

1. Persists the choice in `localStorage['agentTesterAppMode']`.
2. Reconnects the MCP client with the new capability set. The capability sent on `initialize` is:
   ```json
   { "capabilities": { "extensions": { "io.modelcontextprotocol/ui": { "mimeTypes": ["text/html;profile=mcp-app"] } } } }
   ```
3. Clears all currently mounted widget iframes (their capability context just changed).
4. Updates the Tool Tester dropdown — tools with `_meta.ui.resourceUri` get a 🖼 marker.

The same `appMode: true` flag travels through the request body of `POST /api/chat/test`, so
headless tests can exercise both transports of the same tool from a single suite.

### Capability negotiation

Servers MUST gate UI-only behavior on `getUiCapability(clientCapabilities)` per the MCP Apps spec
(`fa-mcp-sdk` re-exports `getUiCapability`, `hostSupportsMcpApps`, `MCP_APPS_EXTENSION_ID`,
`MCP_APPS_RESOURCE_MIME_TYPE` — see [10-mcp-apps.md](10-mcp-apps.md) §6.1.1). With Agent Tester:

| Toggle state | Sent on `initialize` | Server expected to |
|---|---|---|
| OFF (default) | no `extensions["io.modelcontextprotocol/ui"]` | return text-only `content[]`, ignore `_meta.ui.*` |
| ON | `extensions["io.modelcontextprotocol/ui"]: { mimeTypes: ["text/html;profile=mcp-app"] }` | return text fallback **and** UI resource (embedded `content[]` entry or via tool's `_meta.ui.resourceUri`) |

Connection caching in the agent-tester service keys on `appMode`, so flipping the toggle always
forces a fresh `Client` — old text-only handles are never reused for an app-mode session.

### `appCalls[]` in `/api/chat/message` responses

When `appMode` is on, every tool invocation made during the turn produces an `appCalls[]` entry on
the chat response. Each entry pairs the OpenAI `tool_call_id` with the **untruncated**
`CallToolResult` and, when available, the UI resource the host would render:

```json
{
  "id": "msg-…",
  "message": "Here are the results — see the chart below.",
  "sessionId": "abc",
  "metadata": { "response_time": 1842, "tools_used": ["get_weather"] },
  "appCalls": [
    {
      "callId": "call_abc123",
      "toolName": "get_weather",
      "arguments": { "location": "London" },
      "result": { "content": [{ "type": "text", "text": "{...}" }], "structuredContent": { /* ... */ } },
      "uiResource": {
        "uri": "ui://weather/view.html",
        "mimeType": "text/html;profile=mcp-app",
        "text": "<!DOCTYPE html>...",
        "meta": { "csp": { "connectDomains": ["https://api.openweathermap.org"] }, "prefersBorder": true }
      }
    }
  ]
}
```

The LLM context still receives the truncated tool result (the standard `agentTester.modelConfig
.toolResultLimitChars` truncation continues to apply); `appCalls[]` carries the full payload for
the UI bridge so the widget sees what the server actually returned.

Two extraction paths are supported in priority order:

1. **Embedded resource** — a `content[]` block of type `resource` whose `mimeType` is
   `text/html;profile=mcp-app`. Used as-is.
2. **`_meta.ui.resourceUri`** — when the tool definition (preserved via `tools/list`) carries this
   field, Agent Tester issues `resources/read` against the URI and uses the returned
   `mcp-app`-typed content.

When neither path yields a UI resource, `uiResource` is omitted but the `appCall` entry is still
present — useful for tests that assert "this app-mode call did **not** return a widget".

### `app_calls[]` in `/api/chat/test` traces

The headless API exposes the same information on `trace.turns[].app_calls[]`:

```json
{
  "trace": {
    "turns": [
      {
        "turn": 1,
        "tool_calls": [{ "name": "get_weather", "arguments": { "location": "London" } }],
        "tool_results": [{ "name": "get_weather", "result": { "...": "..." }, "duration_ms": 230 }],
        "app_calls": [
          {
            "callId": "call_abc123",
            "toolName": "get_weather",
            "arguments": { "location": "London" },
            "result": { "...": "full untruncated result..." },
            "uiResource": { "uri": "ui://weather/view.html", "mimeType": "text/html;profile=mcp-app", "text": "<!DOCTYPE html>..." }
          }
        ]
      }
    ]
  }
}
```

Headless never mounts an iframe — `app_calls[]` is the **trace** of what would have been
delivered to a real host. This lets test authors assert that a tool correctly ships both
representations (text and UI) without needing a browser.

### Writing automated tests for both modes

Pattern: assert that a single tool behaves correctly under both capability sets in one suite. The
text-only branch verifies fallback contract; the app-mode branch verifies the UI delivery path.

```typescript
import { describe, expect, test } from '@jest/globals';

const baseUrl = process.env.MCP_BASE_URL ?? 'http://localhost:9876';
const mcpConfig = { url: `${baseUrl}/mcp`, transport: 'http' as const };

async function run(message: string, appMode: boolean) {
  const r = await fetch(`${baseUrl}/agent-tester/api/chat/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, mcpConfig, appMode }),
  });
  return r.json();
}

describe('get_weather honors host capabilities', () => {
  test('text-only host gets text response', async () => {
    const r = await run('What is the weather in London?', false);
    const firstTool = r.trace.turns[0].tool_results[0];
    expect(firstTool.result.content[0].type).toBe('text');
    expect(r.trace.turns[0].app_calls).toBeUndefined();
  });

  test('app-mode host gets UI resource', async () => {
    const r = await run('What is the weather in London?', true);
    const apps = r.trace.turns[0].app_calls;
    expect(apps).toHaveLength(1);
    expect(apps[0].uiResource.mimeType).toBe('text/html;profile=mcp-app');
    expect(apps[0].uiResource.text).toMatch(/<html|<body|<div/);
  });

  test('text fallback still present in app-mode (spec compliance)', async () => {
    // Per MCP Apps spec, content[] MUST contain a meaningful text representation
    // even when UI is supported. This catches servers that drop text in app-mode.
    const r = await run('What is the weather in London?', true);
    const fullResult = r.trace.turns[0].app_calls[0].result;
    expect(fullResult.content?.some((c: any) => c.type === 'text' && c.text)).toBe(true);
  });
});
```

Pair this with `data-testid`-based Playwright tests that mount the actual iframe (see
[UI Test Selectors](#ui-test-selectors-data-testid) below) for full end-to-end coverage.

### `uiResource` in `/api/mcp/call-tool` (Tool Tester support)

When the active MCP session is in app-mode, the direct invocation endpoint also extracts and
returns the UI resource:

```
POST /agent-tester/api/mcp/call-tool
```

Request:
```json
{ "serverName": "my-mcp", "toolName": "get_weather", "parameters": { "location": "London" } }
```

Response (with appMode active on the connected server):
```json
{
  "success": true,
  "durationMs": 230,
  "result": { "content": [...], "structuredContent": {...} },
  "uiResource": { "uri": "ui://...", "mimeType": "text/html;profile=mcp-app", "text": "<!DOCTYPE...", "meta": {...} }
}
```

The Tool Tester tab uses this to render a split-view: raw JSON on the left, mounted widget on the
right. The widget runs the full handshake (`ui/initialize` → `tool-input` → `tool-result`) the
same way it would inside a chat message, so you can iterate on widget HTML without a chat agent
in the loop.

### `GET /api/mcp/ui-resources`

Lists all UI resources advertised by a connected server. Used by the App Inspector tab; available
for headless inventory checks.

```
GET /agent-tester/api/mcp/ui-resources?serverName=<name>
```

Response:
```json
{
  "resources": [
    {
      "uri": "ui://weather/view.html",
      "name": "Weather View",
      "mimeType": "text/html;profile=mcp-app",
      "description": "Interactive weather display"
    }
  ]
}
```

Filter logic: keeps resources whose `mimeType` is `text/html;profile=mcp-app` **or** whose `uri`
starts with `ui://`. Returns `404` when the named server is not connected.

### App Inspector tab

A third tab (test-id `at-tab-inspector`) appears next to Chat / Tool Tester. It surfaces:

- **App Tools** — every tool from the connected server with a `🖼 UI` flag for those that carry
  `_meta.ui.resourceUri`. Each app-tool gets a "Launch widget" button that runs the tool with an
  arguments JSON (prompted) and mounts the returned widget in a modal — useful for iterating on a
  widget without going through chat or Tool Tester.
- **UI Resources** — output of `GET /api/mcp/ui-resources` for the connected server.
- **UI Message Log** — live capture of every JSON-RPC frame passing through the iframe bridges
  (host→view, view→host, View-initiated tool calls, log notifications). Filterable by direction.
  Last 500 entries kept in memory.

The Inspector is the recommended surface for debugging widget protocol issues — handshake
failures, missing `tool-input` notifications, unhandled View requests all surface here.

### Sandbox & security model (developer-mode trade-offs)

Agent Tester implements the **desktop-style** host pattern from the spec (§6.1 of the original
proposal): a single iframe on the same origin as the host page, with CSP applied via
`<meta http-equiv="Content-Security-Policy">` inside `srcdoc`. The directive list is built from
`_meta.ui.csp` (`connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains`) — same
mapping as the canonical web hosts. Permission Policy comes from `_meta.ui.permissions` and is
attached to the iframe's `allow=` attribute.

Notable developer-mode trade-offs (accepted because this is a dev tool, not a production host):

- **Meta-CSP is theoretically bypassable** (a malicious View could try to inject another `<meta>`
  before the host's, though Agent Tester injects the CSP meta as the first child of `<head>` so
  this is unlikely in practice). Production hosts SHOULD use HTTP headers from a separate
  sandbox origin — see the spec digest for guidance.
- **View → Host `tools/call`** is proxied to the agent-tester's own `/api/mcp/call-tool` endpoint
  using whatever auth the user already configured. The first such call within a session shows a
  confirm modal ("Widget for tool X wants to call tool Y — Allow? / Deny?") with an opt-in
  "don't ask again in this session" checkbox (stored in `sessionStorage`).
- **Live-widget cap**: up to 5 mounted iframes at once. Older widgets demote to a "poster" with a
  reload hint to bound memory in long chat sessions.

### Configuration

No new top-level config keys. App-mode behavior is purely runtime — controlled by the user toggle
or the `appMode` request flag. The existing `agentTester.*` options still apply.

## Structured JSON Logging (`agentTester.logJson`)

When `agentTester.logJson` is `true`, each agent event is emitted as a single-line JSON object on stdout — useful for real-time monitoring, debugging, and log aggregation.

Enable via config, CLI flag, or environment variable:

```yaml
# config/local.yaml
agentTester:
  logJson: true
```

```bash
npm start -- --log-json
# or
AGENT_TESTER_LOG_JSON=true npm start
```

Event types emitted:

```
{"event":"tool_call","name":"get_currency_rate","arguments":{"quoteCurrency":"EUR"},"timestamp":"2025-08-15T14:32:00.000Z"}
{"event":"tool_result","name":"get_currency_rate","result":{"rate":1.0847},"duration_ms":230,"timestamp":"2025-08-15T14:32:00.230Z"}
{"event":"llm_response","turn":2,"finish_reason":"stop","tool_calls":[],"has_content":true,"timestamp":"2025-08-15T14:32:01.500Z"}
{"event":"response","message":"The EUR/USD rate is 1.0847","tools_used":["get_currency_rate"],"duration_ms":1850}
```

**Default mode** (without `--log-json`) keeps the colored text logs for human debugging. The flag affects only agent tester events — other server logs (startup, auth, MCP protocol) continue in their normal format.

## Automated Testing with Claude Code

The Headless API is designed for CLI automation tools like Claude Code. The typical automated testing workflow:

0. Verify LLM availability: `npm run check-llm` (exit 0 = ready, non-zero = fix config first)
1. Build and start the server: `npm run cb && npm start`
2. Verify tools: `GET /agent-tester/api/mcp/status`
3. Send test messages: `POST /agent-tester/api/chat/test`
4. Analyze trace: correct tool? correct args? expected result?
5. If unclear: retry with `?verbose=true`
6. If issue found: fix code, rebuild, restart, re-test
7. Maintain a testing log at `claudedocs/test-log.md`

### Brief vs Verbose Strategy

**Default to brief mode.** The brief trace covers most debugging scenarios:
- Was the correct tool called?
- Were the arguments correct?
- Did the tool return the expected result?
- How many turns did the agent take?

**Switch to verbose** only when the brief trace doesn't explain the behavior:
- Tool was never called (check `finish_reason` — was it `stop` instead of `tool_calls`?)
- Wrong tool was called (check if the tool description is ambiguous)
- Agent loops (check per-turn `finish_reason` and token usage)
- Empty response (check if `content` is null across all turns)

## Agent Tester Chat UI

The Agent Tester also provides a web UI at `/agent-tester` for interactive testing. The UI auto-connects to the local MCP server and auto-fills auth headers if configured.

The chat UI uses `POST /api/chat/message` (which returns only the final response). The headless API uses `POST /api/chat/test` (which returns the response plus full trace data). Both share the same underlying agent logic and session storage.

## UI Test Selectors (`data-testid`)

For UI automation (Playwright, Cypress, Selenium) the Agent Tester page is annotated with stable `data-testid` attributes. Prefer these over CSS classes, DOM IDs, or label text — they are the documented contract and won't change with styling or copy edits.

### Naming Convention

All selectors use the `at-` prefix (short for "agent tester") in kebab-case:

```
at-<area>-<element>[-<modifier>]
```

Example: `at-auth-token-input`, `at-server-url`, `at-message-user`, `at-toast-success`.

Dynamic elements that map 1:1 to runtime data append the runtime key:

```
at-header-row-<headerName>     e.g. at-header-row-Authorization
at-header-input-<headerName>   e.g. at-header-input-X-Session-Id
at-message-<sender>            e.g. at-message-user, at-message-assistant
at-toast-<type>                e.g. at-toast-success, at-toast-error
```

### Selector Reference

**Auth overlay (shown when `agentTester.useAuth: true`)**

| testid | Element |
|---|---|
| `at-auth-overlay` | Root login overlay container |
| `at-auth-tabs` | Tab switcher (only rendered when multiple methods configured) |
| `at-auth-tab-token` | "Token" tab button |
| `at-auth-tab-basic` | "Login" tab button |
| `at-auth-token-form` | Token login form |
| `at-auth-token-input` | Token input field |
| `at-auth-token-submit` | Token submit button |
| `at-auth-basic-form` | Basic auth form |
| `at-auth-username` | Username input |
| `at-auth-password` | Password input |
| `at-auth-basic-submit` | Basic submit button |
| `at-auth-error` | Error message container |

**App shell**

| testid | Element |
|---|---|
| `at-app` | Root app container (hidden until authenticated) |
| `at-sidebar` | Sidebar (configuration panel) |
| `at-main` | Main chat area |
| `at-chat-header` | Chat header bar |

**Sidebar — connection form**

| testid | Element |
|---|---|
| `at-connection-form` | MCP connection form |
| `at-server-url` | MCP server URL input |
| `at-server-url-dropdown` | Saved URLs dropdown toggle |
| `at-server-url-dropdown-list` | Saved URLs dropdown panel |
| `at-server-url-add-new` | "Add new URL" menu item |
| `at-saved-urls-list` | Container for saved URL items |
| `at-saved-url-item` | Each saved URL row (dynamic) |
| `at-saved-url-text` | Clickable URL text within a row |
| `at-saved-url-delete` | Delete button for a saved URL |
| `at-transport` | Transport `<select>` (http / sse) |
| `at-connect-btn` | Connect button |
| `at-connected-servers` | Connection status bar container |
| `at-server-status-row` | Status row (dynamic, rendered after connect attempt) |
| `at-server-status-connected` | "X tools connected" badge |
| `at-server-status-disconnected` | "Disconnected" badge |
| `at-disconnect-btn` | Disconnect button |
| `at-reconnect-btn` | Reconnect button |

**Sidebar — HTTP headers section**

| testid | Element |
|---|---|
| `at-headers-section` | Headers section container |
| `at-dynamic-headers` | Headers list container |
| `at-header-row-<name>` | Row for a specific header (e.g. `at-header-row-Authorization`) |
| `at-header-input-<name>` | Input for a specific header value |

**Sidebar — LLM settings**

The sidebar shows only the current model name (read-only) and a gear button. All LLM parameters (Base URL, API Key, Model Name, Temperature, Max Tokens, Max Turns, Limit (chars)) are edited in the LLM Settings modal opened via that button. Settings are persisted in `localStorage['mcpAgentLlmSettings']`. If `agentTester.openAi.exposeToClient` is `true` in config, the server sends `baseURL` and `apiKey` via `GET /agent-tester/api/config` → `llmDefaults` and the UI pre-fills them into localStorage on first open (security note: only enable `exposeToClient` when the tester is protected by `useAuth: true` or deployed in a trusted network). When the effective `apiKey` is empty, a red "API Key is not set" warning is shown below the model name.

| testid | Element |
|---|---|
| `at-model-section` | Model section container |
| `at-model-display` | Read-only current model name |
| `at-llm-settings-btn` | Gear button that opens the LLM Settings modal |
| `at-api-key-warning` | "API Key is not set" warning (visible only when `apiKey` is empty) |
| `at-llm-modal` | LLM Settings modal overlay |
| `at-llm-modal-close` | Modal close (×) button |
| `at-llm-modal-cancel` | Modal Cancel button |
| `at-llm-modal-save` | Modal Save button |
| `at-llm-base-url` | Base URL input (optional — empty means OpenAI default) |
| `at-llm-api-key` | API Key input (password field) |
| `at-llm-api-key-toggle` | Show/hide API key visibility toggle |
| `at-llm-model-name` | Model Name input (editable combobox) |
| `at-llm-model-dropdown-toggle` | Model dropdown arrow button |
| `at-llm-model-dropdown-list` | Model dropdown list (preset models) |
| `at-llm-model-option-<name>` | Individual model option inside the list |
| `at-llm-temperature` | Temperature input |
| `at-llm-max-tokens` | Max tokens input |
| `at-llm-max-turns` | Max turns input |
| `at-llm-limit-chars` | Tool result char limit input |

**Sidebar — prompts**

| testid | Element |
|---|---|
| `at-system-prompt` | Agent (system) prompt `<textarea>` |
| `at-system-prompt-enlarge` | Enlarge button for agent prompt |
| `at-custom-prompt` | Custom prompt `<textarea>` |
| `at-custom-prompt-enlarge` | Enlarge button for custom prompt |

**Chat header**

| testid | Element |
|---|---|
| `at-sidebar-toggle-mobile` | Mobile sidebar toggle |
| `at-tab-chat` / `at-tab-tool-tester` / `at-tab-inspector` | Tab switcher buttons (Chat / Tool Tester / App Inspector) |
| `at-app-mode-toggle` | MCP Apps mode checkbox — toggles app-mode capability and widget rendering |
| `at-app-mode-toggle-label` | Wrapping `<label>` of the checkbox (carries `is-disabled` class when transport is unsupported) |
| `at-default-format` | Default display format `<select>` (HTML / MD) |
| `at-theme-toggle` | Light/dark theme toggle |
| `at-clear-chat` | Clear chat button |
| `at-logout-btn` | Logout button (visible only when `useAuth` is true) |

**Tool Tester — MCP Apps split-view (only when app-mode is on AND the response carries a `uiResource`)**

| testid | Element |
|---|---|
| `at-tt-ui-panel` | Third panel mounted next to Request/Response when a UI widget is rendered |

**App Inspector tab**

| testid | Element |
|---|---|
| `at-tab-pane-inspector` | Inspector pane container |
| `at-inspector-tools-panel` | Left column: tools + resources |
| `at-inspector-tools-list` | App Tools list container; each tool item carries `has-ui` class when it ships a UI resource |
| `at-inspector-resources-list` | UI Resources list container |
| `at-inspector-refresh` | Refresh button (re-queries `/api/mcp/ui-resources` and re-renders tools) |
| `at-inspector-log-panel` | Right column: live `ui/*` JSON-RPC log |
| `at-inspector-log` | Log `<pre>` (newest entry at bottom; capped at 500) |
| `at-inspector-log-filter` | Direction filter `<select>` (All / view→host / host→view / view→host tool-call) |
| `at-inspector-log-clear` | Clear log button |

**Chat area**

| testid | Element |
|---|---|
| `at-chat-messages` | Messages scroll container |
| `at-welcome-message` | Initial welcome card |
| `at-message-user` | User message bubble (one per message) |
| `at-message-assistant` | Assistant message bubble |
| `at-message-text-user` | Inner text element of a user message |
| `at-message-text-assistant` | Inner text element of an assistant message |
| `at-message-format-toggle` | HTML/MD format toggle on an assistant message |
| `at-typing-indicator` | Typing indicator (shown during LLM response) |
| `at-message-input` | Chat input `<textarea>` |
| `at-char-count` | Character counter span |
| `at-send-btn` | Send button |

**Modals and overlays**

| testid | Element |
|---|---|
| `at-prompt-modal` | Prompt enlarge modal overlay |
| `at-prompt-modal-title` | Modal title |
| `at-prompt-modal-textarea` | Modal text area |
| `at-prompt-modal-save` | Apply button |
| `at-prompt-modal-close` | Close button |
| `at-loading-overlay` | Global loading overlay |
| `at-header-tooltip` | Floating header description tooltip |
| `at-toast-container` | Toast notifications container |
| `at-toast-success` / `at-toast-error` / `at-toast-warning` / `at-toast-info` | Individual toast (dynamic) |

### Usage Examples

**Playwright**

```js
await page.goto('http://localhost:9876/agent-tester');

// Login when useAuth is enabled
await page.getByTestId('at-auth-token-input').fill(process.env.MCP_TOKEN);
await page.getByTestId('at-auth-token-submit').click();

// Wait for main app
await page.getByTestId('at-app').waitFor();

// Send a chat message
await page.getByTestId('at-message-input').fill('List all tools');
await page.getByTestId('at-send-btn').click();

// Assert an assistant reply appeared
await page.getByTestId('at-message-assistant').first().waitFor();
```

**Cypress**

```js
cy.visit('/agent-tester');
cy.get('[data-testid=at-auth-token-input]').type(Cypress.env('MCP_TOKEN'));
cy.get('[data-testid=at-auth-token-submit]').click();
cy.get('[data-testid=at-server-status-connected]').should('be.visible');
```

### Stability Guarantee

These test-ids are part of the public contract of the Agent Tester UI. Once added, a given id is not renamed or removed without a changelog entry. New elements are added with new ids as the UI grows. When authoring tests, prefer `data-testid` over:

- DOM `id` (may be shared with form `<label for>` pairs and collide across scopes)
- CSS class names (used for styling — may be renamed or removed during refactors)
- Visible text (localized / editable copy — changes break tests)
- XPath or positional selectors (brittle to layout changes)
