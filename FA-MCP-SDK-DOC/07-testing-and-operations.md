# Testing and Operations

## Test Clients

### STDIO Transport

```typescript
import { McpStdioClient } from 'fa-mcp-sdk';
import { spawn } from 'child_process';

const proc = spawn('node', ['dist/start.js', 'stdio'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: 'test' },
});

const client = new McpStdioClient(proc);
const result = await client.callTool('my_tool', { query: 'test' });
const prompt = await client.getPrompt('agent_brief');
```

### HTTP Transport

> **Deprecated:** `McpHttpClient` is now a thin alias of `McpStreamableHttpClient` (see below). The
> server's `/mcp` endpoint runs the SDK `StreamableHTTPServerTransport`, so the old plain-POST client
> no longer applies — both names speak the same Streamable HTTP protocol. Prefer
> `McpStreamableHttpClient` in new code.

```typescript
import { McpHttpClient } from 'fa-mcp-sdk';

// Auth headers go in the constructor (not as a per-call argument).
const client = new McpHttpClient('http://localhost:3000', {
  headers: { Authorization: 'Bearer token' },
});
await client.initialize();
const result = await client.callTool('my_tool', { query: 'test' });
```

### SSE Transport

```typescript
import { McpSseClient } from 'fa-mcp-sdk';

const client = new McpSseClient('http://localhost:3000');
const result = await client.callTool('my_tool', { query: 'test' });
```

### Streamable HTTP (MCP 2025-11-25)

Wraps the official `@modelcontextprotocol/sdk` `Client` + `StreamableHTTPClientTransport`. The SDK
transport sets `Accept: application/json, text/event-stream`, captures/resends `Mcp-Session-Id`,
negotiates the protocol version, and sends `DELETE /mcp` on `close()`.

```typescript
import { McpStreamableHttpClient } from 'fa-mcp-sdk';

const client = new McpStreamableHttpClient('http://localhost:3000', {
  headers: { Authorization: 'Bearer token' },
  requestTimeoutMs: 60000,
});

// `initialize()` runs the full handshake; the server answers the negotiated version (2025-11-25).
await client.initialize();

const result = await client.callTool('my_tool', { query: 'test' });
const prompt = await client.getPrompt('agent_brief');
const resources = await client.listResources();
const content = await client.readResource('custom://data');

await client.close();
```

**Methods:** `initialize`, `close`, `callTool`, `getPrompt`, `listResources`, `readResource`,
`listTools`, `listPrompts`. After `initialize()`, `client.serverInfo`, `client.capabilities` and
`client.protocolVersion` are populated.

## Transport Types

| Transport | Config | Use Case |
|-----------|--------|----------|
| STDIO | `mcp.transportType: "stdio"` | CLI, local dev |
| HTTP (Streamable HTTP) | `mcp.transportType: "http"` | Web integrations, REST API |
| SSE (legacy) | HTTP transport | Long-running ops, streaming; older clients |

The HTTP transport is **Streamable HTTP** (SDK `StreamableHTTPServerTransport`), stateful per session:

| Method `/mcp` | Behaviour |
|---------------|-----------|
| `POST` | `initialize` opens a session (server returns `Mcp-Session-Id`); subsequent calls must echo it. Notifications → **202**. No session + not `initialize` → **400**. |
| `GET` | Server→client SSE stream for the session. |
| `DELETE` | Tears down the session. |

## Running Tests

```bash
npm test                               # All tests (Jest)
npx jest tests/path/file.test.ts       # Single file
npx jest --testNamePattern="pattern"   # Filter by test name
npm run test:mcp                       # STDIO transport tests
npm run test:mcp-http                  # HTTP transport tests
npm run test:mcp-sse                   # SSE transport tests
```

### Auth Headers for Tests

```typescript
import { getAuthHeadersForTests } from 'fa-mcp-sdk';

const headers = getAuthHeadersForTests(); // Uses config auth settings
const result = await client.callTool('my_tool', { query: 'test' }, headers);
```

### What to Test

- **Happy path** — tool returns expected result for valid input
- **Error cases** — invalid params, missing required fields, service errors
- **Auth flows** — authenticated vs unauthenticated, different auth methods
- **Transport parity** — same behavior across STDIO, HTTP, SSE
- **Edge cases** — empty strings, large payloads, special characters

## Universal `debug-tool` for Integration Tests

When the system-under-test is a **client** (Agent Tester, custom MCP host, CI smoke test) rather
than the server, you usually need a server that produces every kind of `CallToolResult` on demand —
text, image, audio, embedded resources, mixed blocks, `isError: true`, slow responses, large
payloads. The SDK ships a single parameterised fixture so test code never has to roll its own
fake server.

Enable it together with the other built-ins ([06-utilities](06-utilities.md) → "Built-in Debug
Tools"):

```yaml
mcp:
  debug:
    builtinTools: true
```

This appends a tool named `debug-tool` to the server's `tools/list`, hidden from the LLM via
`_meta.ui.visibility: ['app']`.

### Input Schema

| Argument                   | Type / values                                                 | Default | Purpose                              |
|----------------------------|---------------------------------------------------------------|---------|--------------------------------------|
| `contentType`              | `text` \| `image` \| `audio` \| `resource` \| `resourceLink` \| `mixed` | `text`  | Which content-block type to emit. `mixed` returns one of each (ignores `multipleBlocks`) |
| `multipleBlocks`           | `boolean`                                                     | `true`  | Emit 3 blocks of the chosen type vs. 1 |
| `includeStructuredContent` | `boolean`                                                     | `true`  | Include `result.structuredContent` with `{ config, timestamp, counter, largeInputLength? }` |
| `includeMeta`              | `boolean`                                                     | `true`  | Include `result._meta.debugInfo`     |
| `simulateError`            | `boolean`                                                     | `false` | Set `result.isError = true` (call still resolves) |
| `delayMs`                  | `number` ≥ 0                                                  | none    | Artificial latency for timeout / loading-state tests |
| `largeInput`               | `string`                                                      | none    | Large payload — echoed back as `structuredContent.largeInputLength` |

### Example: Single Server, Every Variation

```typescript
// tests/agent-tester/content-types.test.ts
import { McpHttpClient } from 'fa-mcp-sdk';

const client = new McpHttpClient('http://localhost:9876');

test('renders mixed text + image + audio', async () => {
  const result = await client.callTool('debug-tool', { contentType: 'mixed' });
  expect(result.content).toHaveLength(3);
  expect(result.content.map((b: any) => b.type)).toEqual(['text', 'image', 'audio']);
});

test('isError: true is surfaced', async () => {
  const result = await client.callTool('debug-tool', {
    contentType: 'text',
    simulateError: true,
  });
  expect((result as any).isError).toBe(true);
});

test('respects delayMs for loading-state tests', async () => {
  const t0 = Date.now();
  await client.callTool('debug-tool', { contentType: 'text', delayMs: 800 });
  expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
});

test('large payload survives the round trip', async () => {
  const big = 'x'.repeat(200_000);
  const result = await client.callTool('debug-tool', { contentType: 'text', largeInput: big });
  expect((result as any).structuredContent.largeInputLength).toBe(200_000);
});
```

### Standalone Test Server

If you need a throw-away server outside `initMcpServer` (e.g. spinning up a bare
`@modelcontextprotocol/sdk` `McpServer` for an in-process test), use `registerDebugTool` directly:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerDebugTool, DEBUG_TOOL_NAME } from 'fa-mcp-sdk';

const server = new McpServer({ name: 'test-fixture', version: '0.0.0' });
registerDebugTool(server);
// → callTool(DEBUG_TOOL_NAME, { contentType: 'mixed' }) works against this server.
```

The helper accepts any object with `registerTool(name, def, handler)` — structurally compatible
with the high-level SDK API — so the SDK does not pull in a hard dependency on
`@modelcontextprotocol/sdk/server/mcp.js`.

## Best Practices

### Project Organization
- One responsibility per tool
- Use TypeScript throughout
- Separate configs for dev/prod

### Tool Development
- Validate all inputs
- Use `formatToolResult()` for responses
- Use error classes for failures
- Log operations with `logger`

### Testing
- Test all transport types
- Include error cases
- Use provided test clients

### Security
- Environment variables for secrets
- Enable auth for production
- Validate all user inputs
- Don't leak sensitive info in errors
