# FA-MCP-SDK Documentation Index

TypeScript framework for building MCP servers.

## Quick Start

```bash
npm install fa-mcp-sdk
```

## Documentation Structure

| File | Content | Read When |
|------|---------|-----------|
| [01-getting-started](01-getting-started.md) | `initMcpServer()`, `McpServerData`, `IPromptData`, `IResourceData`, `AppConfig` | Starting new project |
| [02-1-tools-and-api](02-1-tools-and-api.md) | Tool definitions, **snake_case name validation**, **`$schema` 2020-12 + `additionalProperties:false`**, **server-side `arguments` validation**, **`outputSchema` + `structuredContent` mirror**, `toolHandler`, outbound webhooks, REST API with tsoa, OpenAPI/Swagger | Creating tools, REST endpoints, webhook callbacks |
| [02-2-prompts-and-resources](02-2-prompts-and-resources.md) | Standard/custom prompts, **parameterised prompts (`IPromptArgument[]`)**, resources, **built-in `project://version`, `use://auth`, `<name>://agent/brief\|prompt`**, **opt-in `resources/templates/list` + `resources/subscribe`**, `requireAuth` | Configuring prompts/resources |
| [03-configuration](03-configuration.md) | `appConfig`, YAML config, access points, cache, **`mcp.limits` (payload/result/timeout)**, **`mcp.pagination`**, **`mcp.resources` (MAY)**, **`mcp.rateLimit.scope` + `maxConcurrentPerSubject` (§14)**, **`webServer.trustProxy`**, **`webServer.tokenCheck.allowQueryToken` (§7.1)**, **/health & /ready**, **CORS hardening**, **MCP error codes** (`-32002…-32005`) | Server configuration, external services, transport-level hardening |
| [04-authentication](04-authentication.md) | JWT (**4 modes: legacyAesCtr / embedded / localKey / remoteJwks**), Basic auth, server tokens, **OAuth discovery + `/oauth/token` + JWKS**, **`requiredScopes` enforcement (§7.5)**, **`WWW-Authenticate` realm + invalid_token (§7.4)**, **HTTP 403 `forbidden` flag**, `createAuthMW()`, Token Generator, CLI Token Generator (mode-aware), JWT Generation API | Authentication setup |
| [05-ad-authorization](05-ad-authorization.md) | AD group authorization at HTTP/tool levels | AD group restrictions |
| [06-utilities](06-utilities.md) | `ServerError`, `normalizeHeaders`, logging, MCP debug switches (`DEBUG=mcp:*`), **HTTP connection & RPC tracing (`DEBUG=mcp-handshake` / `mcp-rpc`, always-on session-lifecycle + `-32600` + error logging)**, JSON-lines sink (`mcp.debug.logFile` → `emitTrace`), built-in debug tools (`mcp.debug.builtinTools`), Consul, graceful shutdown | Error handling, utilities, request tracing, post-mortem analysis |
| [07-testing-and-operations](07-testing-and-operations.md) | Test clients (STDIO, HTTP, SSE, Streamable HTTP); universal `debug-tool` fixture covering every `CallToolResult` shape | Testing, deployment, exercising client code against image/audio/resource/error/delay variants |
| [08-agent-tester-and-headless-api](08-agent-tester-and-headless-api.md) | Agent Tester, Headless API, structured logging, automated testing, UI `data-testid` reference. **MCP Apps mode**: capability negotiation, `appCalls[]` / `app_calls[]`, widget iframe bridge, App Inspector tab | Agent-driven tool development, CLI automation, UI E2E tests, MCP Apps host for development |
| [09-database](09-database.md) | PostgreSQL sugar layer (`queryMAIN`, `execMAIN`, `getInsertSqlMAIN`, `getMergeSqlMAIN`, `mergeByBatch`), `pgvector`, secondary DBs | Database access, upserts, batching |
| [10-mcp-apps](10-mcp-apps.md) | Self-contained digest of the MCP Apps protocol + SDK pinned to `@modelcontextprotocol/ext-apps v1.7.2` (spec 2026-01-26): `ui://` resources, `_meta.ui`, JSON-RPC messages, `App` class, host context, patterns, pitfalls. **Canonical example** (`examples/mcp-apps-canonical/`, `npm run example:mcp-apps`) and widget-side debug helpers (`mcp-debug-log`, `mcp-debug-refresh`). Cross-links to Agent Tester as a dev-host (doc 08) | Building / extending MCP Apps (UI-augmented tools) |
| [11-public-contract](11-public-contract.md) | Formal public-contract surface of `fa-mcp-sdk`: transports, HTTP endpoints, JWT claims, tool/prompt/resource shape, error mapping, limits & headers (`X-Request-Id`, `traceparent`, `Retry-After`, `WWW-Authenticate`, `MCP-Session-Id`), semver policy, deprecation process | Pinning SDK version, planning a SDK upgrade, drafting CHANGELOG entries, deciding MAJOR vs MINOR vs PATCH |
| [12-implementation-standard](12-implementation-standard.md) | Corporate MCP server implementation standard (Avatar profile on top of MCP 2025-11-25): transports, HTTP interface, auth/JWT profile, lifecycle, **tool side-effects & risk level**, error codes (`-32002…-32007`), limits, observability, health/readiness, deprecation, compliance checklist | Auditing a server against the corporate profile, drafting acceptance review, aligning a new server with company-wide MCP rules |

## Key Exports

```typescript
// Core
import { initMcpServer, McpServerData, appConfig, getProjectData, getSafeAppConfig, ROOT_PROJECT_DIR } from 'fa-mcp-sdk';

// Auth
import { createAuthMW, generateToken, getAuthHeadersForTests, TTokenType, generateTokenApp } from 'fa-mcp-sdk';

// Tools & Errors
import {
  formatToolResult, formatToolError,                  // formatToolError → sets isError: true
  asTextContent, asTextError, asJson, asJsonError,    // direct-shape helpers (text + structured, ok + error)
  getJsonFromResult,
  TToolHandlerResponse, IToolHandlerTextResponse, IToolHandlerStructuredResponse,
  ToolExecutionError, ServerError, BaseMcpError, ValidationError, getTools,
  // Appendix B errors — emitted by the SDK transport; re-throwable from tool / API code
  PayloadTooLargeError, TimeoutError, RateLimitedError, ResourceNotFoundError,
  MCP_ERROR_CODES, IMcpErrorData, createJsonRpcErrorResponse,
} from 'fa-mcp-sdk';

// Prompts (parameterised — standard §10.5) & Resources (templates/subscribe — §11.5)
import {
  IPromptArgument, IPromptData,
  IIcon,                                              // §10.5/§11.3 — optional title/icons UI metadata
  IResourceTemplateInfo,
  notifyResourceUpdated,                              // call to broadcast `notifications/resources/updated`
} from 'fa-mcp-sdk';

// SSE resumability (standard §6) — opt-in via mcp.sse.resumability; maskSensitive (§12.2) — opt-in
// result masking, applied by the server inside a tool handler.
import { InMemoryEventStore, maskSensitive, IMaskRules } from 'fa-mcp-sdk';

// Task-augmented execution (standard §8.7) — opt-in via mcp.tasks.enabled; declare a long-running
// tool with execution.taskSupport. Storage is pluggable (default: in-memory, per-process).
import {
  getTaskStore, resetTaskStore, InMemoryTaskStore, toTaskDto, isTerminalTaskStatus,
  ITaskStore, ITaskRecord, ITaskCreateInput, ITaskStoreOptions, TTaskStatus, TTaskPatch,
} from 'fa-mcp-sdk';

// Database & Cache
import {
  queryMAIN, queryRsMAIN, oneRowMAIN, execMAIN,
  getInsertSqlMAIN, getMergeSqlMAIN, mergeByBatch,
  checkMainDB, getMainDBConnectionStatus,
  IQueryPgArgsCOptional,
  getCache,
} from 'fa-mcp-sdk';

// Utilities
import { logger, fileLogger, Logger, applyLoggerSettings, trim, ppj, toError, toStr, normalizeHeaders } from 'fa-mcp-sdk';

// MCP debug switches (DEBUG=mcp:tool|mcp:resource|mcp:prompt|mcp:notification or DEBUG=mcp:*)
import { debugMcpTool, debugMcpResource, debugMcpPrompt, debugMcpNotification, debugTokenAuth } from 'fa-mcp-sdk';

// JSON-lines debug sink (mcp.debug.logFile) — see 06-utilities → "JSON-lines Sink"
import { emitTrace, configureDebugSink, initDebugTraceFromConfig } from 'fa-mcp-sdk';

// Built-in debug tools (enabled by mcp.debug.builtinTools=true)
// — see 06-utilities → "Built-in Debug Tools", 07-testing → "Universal debug-tool", 10-mcp-apps § 8.14
import {
  BUILTIN_MCP_DEBUG_TOOLS, BUILTIN_MCP_DEBUG_TOOL_NAMES,
  MCP_DEBUG_LOG_TOOL_NAME, MCP_DEBUG_REFRESH_TOOL_NAME,
  isBuiltinDebugTool, handleBuiltinDebugTool,
  DEBUG_TOOL, DEBUG_TOOL_NAME, handleDebugTool, registerDebugTool,
} from 'fa-mcp-sdk';

// Test Clients
import { McpHttpClient, McpStdioClient, McpSseClient, McpStreamableHttpClient } from 'fa-mcp-sdk';

// AD Groups
import { initADGroupChecker, IADConfig, IDcConfig } from 'fa-mcp-sdk';

// OpenAPI
import { configureOpenAPI, OpenAPISpecResponse, SwaggerUIConfig } from 'fa-mcp-sdk';

// MCP Apps (SEP-1865) — read client capabilities, decide UI vs. text
import {
  getUiCapability, hostSupportsMcpApps,
  MCP_APPS_EXTENSION_ID, MCP_APPS_RESOURCE_MIME_TYPE,
  IClientCapabilities, IMcpUiClientCapabilities,
} from 'fa-mcp-sdk';
```

## Project Structure

```
my-mcp-server/
├── config/
│   ├── default.yaml        # Base configuration
│   ├── development.yaml    # Dev overrides
│   ├── local.yaml          # Local secrets (gitignored)
│   └── production.yaml     # Prod overrides
├── src/
│   ├── _types_/
│   │   └── custom-config.ts    # Custom config interface
│   ├── api/
│   │   └── router.ts           # REST endpoints (tsoa)
│   ├── prompts/
│   │   ├── agent-brief.ts      # Short agent description
│   │   ├── agent-prompt.ts     # Full agent prompt
│   │   └── custom-prompts.ts   # Additional prompts
│   ├── tools/
│   │   ├── handle-tool-call.ts # Tool execution
│   │   └── tools.ts            # Tool definitions
│   ├── custom-resources.ts     # Custom MCP resources
│   └── start.ts                # Entry point
└── tests/
```

## Minimal Example

**`src/start.ts`:**
```typescript
import { initMcpServer, McpServerData } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: 'My MCP Server',
  agentPrompt: 'You are a helpful assistant.',
};

await initMcpServer(serverData);
```

**`src/tools/tools.ts`:**
```typescript
import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const tools: Tool[] = [{
  name: 'hello',
  description: 'Say hello',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Name to greet' } },
    required: ['name']
  }
}];
```

**`src/tools/handle-tool-call.ts`:**
```typescript
import { formatToolResult, ToolExecutionError, TToolHandlerResponse } from 'fa-mcp-sdk';

export const handleToolCall = async (
  params: { name: string; arguments?: any },
): Promise<TToolHandlerResponse> => {
  const { name, arguments: args } = params;
  switch (name) {
    case 'hello':
      return formatToolResult({ message: `Hello, ${args.name}!` });
    default:
      throw new ToolExecutionError(name, `Unknown tool: ${name}`);
  }
};
```
