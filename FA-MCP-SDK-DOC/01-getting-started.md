# Getting Started

## initMcpServer(data: McpServerData): Promise<void>

Primary function for starting your MCP server.

```typescript
import { initMcpServer, McpServerData, CustomAuthValidator } from 'fa-mcp-sdk';
import { tools } from './tools/tools.js';
import { handleToolCall } from './tools/handle-tool-call.js';

const serverData: McpServerData = {
  tools,
  toolHandler: handleToolCall,
  agentBrief: 'My agent description',
  agentPrompt: 'Full agent instructions',
  customAuthValidator: async (req) => { /* custom auth logic */ },
};

await initMcpServer(serverData);
```

## Core Types

### McpServerData

```typescript
interface McpServerData {
  tools: Tool[] | (() => Promise<Tool[]>);           // Tool definitions
  toolHandler: <T = unknown>(params: IToolHandlerParams) => Promise<TToolHandlerResponse<T>>;
  agentBrief: string;                                 // Brief description
  agentPrompt: string;                                // System prompt
  toolPrompt?: TPromptContentFunction;                // tool_prompt content (args.tool); default → ''
  customPrompts?: IPromptData[];                      // Additional prompts
  usedHttpHeaders?: IUsedHttpHeader[] | null;         // HTTP headers for auth
  customResources?: IResourceData[] | null;           // Custom resources
  customAuthValidator?: CustomAuthValidator;          // Runs FIRST: bypass or fallback to standard auth
  tokenGenAuthHandler?: TokenGenAuthHandler;          // Token Generator auth
  httpComponents?: { apiRouter?: Router | null };     // Express router
  assets?: { logoSvg?: string };
  getConsulUIAddress?: (serviceId: string) => string;
  customStartupInfo?: [string, string][];             // Extra [key, value] rows in startup banner
  loggerSettings?: Partial<ILoggerSettings>;          // Override af-logger-ts settings (shallow merge over defaults)
}

interface IToolHandlerParams {
  name: string;
  arguments?: any;
  headers?: Record<string, string>;
  payload?: { user: string; [key: string]: any };     // JWT payload if authenticated
  transport?: 'stdio' | 'sse' | 'http';
  clientCapabilities?: IClientCapabilities;           // From MCP `initialize` handshake; see 10-mcp-apps.md
}

// Client capabilities reported during initialize, extended with the open-ended
// `extensions` map MCP Apps and future SEPs publish.
type IClientCapabilities = ClientCapabilities & { extensions?: Record<string, unknown> };

// Tool handler response — discriminated union, MCP SDK accepts either shape
interface IToolHandlerTextResponse {
  content: { type: 'text'; text: string }[];
}
interface IToolHandlerStructuredResponse<T = any> {
  structuredContent: T;
}
type TToolHandlerResponse<T = any> = IToolHandlerTextResponse | IToolHandlerStructuredResponse<T>;
```

The handler must return one of the two shapes above. The choice is controlled globally
by `appConfig.mcp.tools.answerAs` (`text` | `structuredContent`); use the
`formatToolResult()` helper to produce the correct shape automatically. STDIO, SSE,
and HTTP transports all forward the handler's return value to the MCP client without
re-wrapping, so `structuredContent` is preserved end-to-end.

### IPromptData

For custom prompts in `src/prompts/custom-prompts.ts`:

```typescript
interface IPromptData {
  name: string;
  description: string;
  arguments: [];
  content: string | ((request: IGetPromptRequest) => string | Promise<string>);
  requireAuth?: boolean;
}

// Example:
export const customPrompts: IPromptData[] = [{
  name: 'custom_prompt',
  description: 'A custom prompt',
  arguments: [],
  content: (request) => `Content with param: ${request.params.arguments?.sample}`,
}];
```

### IResourceData

For custom resources in `src/custom-resources.ts`:

```typescript
interface IResourceData {
  uri: string;            // e.g., "custom-resource://data1"
  name: string;
  title?: string;
  description: string;
  mimeType: string;       // e.g., "text/plain", "application/json"
  content: string | object | ((uri: string) => string | Promise<string>);
  requireAuth?: boolean;
}

// Example:
export const customResources: IResourceData[] = [{
  uri: 'custom-resource://resource1',
  name: 'resource1',
  description: 'Dynamic content example',
  mimeType: 'text/plain',
  content: (uri) => `Dynamic content for ${uri}`,
}];
```

## Configuration API

### appConfig

Singleton with merged configuration from YAML files and environment variables:

```typescript
import { appConfig, AppConfig } from 'fa-mcp-sdk';

const port = appConfig.webServer.port;
const serviceName = appConfig.name;
const isAuthEnabled = appConfig.webServer.auth.enabled;

// Nested config access
const dbHost = appConfig.db.postgres.dbs.main.host;
const rateLimit = appConfig.mcp.rateLimit.maxRequests;
const dbEnabled = appConfig.isMainDBUsed;
```

| Property | Description |
|----------|-------------|
| `name` | Package name from package.json |
| `shortName` | Name without 'mcp' suffix |
| `version` | Package version |
| `webServer` | HTTP server config (host, port, auth) |
| `mcp` | MCP settings (transportType, rateLimit, tools.answerAs, tools.hideAnnotations) |
| `logger` | Logging config |
| `ad` | Active Directory config |
| `consul` | Service discovery settings |
| `homePage` | Home page footer settings (help link) |

### getProjectData(): McpServerData

Returns the data passed to `initMcpServer()`.

```typescript
const projectData = getProjectData();
console.log(projectData.agentBrief, projectData.tools.length);
```

### getSafeAppConfig(): any

Returns config clone with sensitive data masked. Use for logging:

```typescript
const safeConfig = getSafeAppConfig();
console.log(JSON.stringify(safeConfig, null, 2)); // passwords masked
```
