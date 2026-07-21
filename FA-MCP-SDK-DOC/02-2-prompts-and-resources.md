# Prompts and Resources

## Prompts

### Standard Prompts

#### Agent Brief (`src/prompts/agent-brief.ts`)

**Level 1**: Short description for agent selection. LLM doesn't see tools at this level.

```typescript
export const AGENT_BRIEF = 'Database management agent for PostgreSQL operations';
```

#### Agent Prompt (`src/prompts/agent-prompt.ts`)

**Level 2**: Full instructions shown after agent selection. LLM sees tools list.

```typescript
export const AGENT_PROMPT = `You are a database management assistant.
- Check table existence before operations
- Use transactions for multi-step operations
- Return results in JSON format`;
```

#### Tool Prompt (`toolPrompt` on `McpServerData`)

The standard `tool_prompt` prompt returns instructions scoped to a single MCP tool. It declares a
**required** `tool` argument (the tool name) and delegates the whole content logic to the child
project through the optional `toolPrompt` field on `McpServerData`. The function receives the tool
name in `args.tool` and returns the prompt for that tool. When `toolPrompt` is not supplied, a
built-in stub returns an empty string — the `tool_prompt` prompt is still advertised, it just
yields nothing.

```typescript
import { McpServerData, TPromptContentFunction } from 'fa-mcp-sdk';

const TOOL_PROMPTS: Record<string, string> = {
  run_query: 'Always wrap multi-statement SQL in a transaction. Return rows as JSON.',
  describe_table: 'List columns with types and nullability. Omit internal system columns.',
};

const toolPrompt: TPromptContentFunction = (_req, args) => {
  const tool = args?.tool;
  if (!tool) return '';
  return TOOL_PROMPTS[tool] ?? '';
};

const serverData: McpServerData = { ..., toolPrompt };
```

The values arrive via `request.params.arguments` on `prompts/get`, exactly like the parameterised
custom prompts below; `tool` is marked `required: true` in `prompts/list`.

### Custom Prompts

Add in `src/prompts/custom-prompts.ts`:

```typescript
import { IPromptData, IGetPromptRequest, IPromptArgument } from 'fa-mcp-sdk';

export const customPrompts: IPromptData[] = [
  { name: 'greeting', description: 'Greeting message', arguments: [],
    content: 'Hello! How can I help?' },

  // Standard §10.5 — parameterised prompt. The `arguments[]` array is advertised in
  // prompts/list; the values arrive as `request.params.arguments` (string map) on
  // prompts/get. The content function receives them as the second argument.
  {
    name: 'context_prompt',
    description: 'Context-aware prompt with explicit arguments',
    arguments: [
      { name: 'topic',    description: 'Subject area to focus on', required: true },
      { name: 'audience', description: 'Audience level (junior / senior)',     required: false },
    ] satisfies IPromptArgument[],
    content: (_req, args) =>
      `Focus on ${args?.topic ?? 'the codebase'} for a ${args?.audience ?? 'mixed'} audience.`,
  },

  { name: 'admin_only', description: 'Admin instructions', arguments: [],
    content: 'Admin-only content', requireAuth: true },

  // Standard §10.5 (MAY) — optional UI metadata. `title` is a human-facing label (falls back to
  // `name`); `icons` is an `IIcon[]` (`{ src; mimeType?; sizes? }`, `src` = absolute URL or data: URI).
  // Both only affect display in the client UI and pass through prompts/list unchanged.
  {
    name: 'release_notes',
    title: 'Release notes',
    icons: [{ src: 'https://cdn.example.com/notes.png', mimeType: 'image/png', sizes: '48x48' }],
    description: 'Release change summary',
    arguments: [],
    content: 'Summary of changes for the current release.',
  },
];
```

> **Compatibility.** The old single-argument signature
> `(req: IGetPromptRequest) => string` still works — the second `args` parameter is
> optional. Only update prompts that need access to the values.

Pass to server:
```typescript
const serverData: McpServerData = { ..., customPrompts };
```

### ITransportContext

Universal type for dynamic tools/prompts/resources functions:

```typescript
interface ITransportContext {
  transport: 'stdio' | 'sse' | 'http';
  headers?: Record<string, string>;            // HTTP headers (HTTP/SSE only)
  payload?: { user: string; [key: string]: any };  // Auth payload (if authenticated HTTP/SSE only)
  clientCapabilities?: IClientCapabilities;    // From MCP `initialize` handshake (see 10-mcp-apps.md)
}
```

Use for transport-based credential routing:
```typescript
function getApiKey(ctx: ITransportContext): string {
  if (ctx.transport === 'stdio') return process.env.API_KEY || '';
  return ctx.headers?.['x-api-key'] || '';
}
```

Use `clientCapabilities` to branch UI-augmented vs. text-only output (see
[10-mcp-apps.md → "Reading client capabilities from fa-mcp-sdk"](./10-mcp-apps.md)).

### Dynamic Prompts (Function)

For dynamic prompt lists based on transport type, headers, or user:

```typescript
import { IPromptData, ITransportContext } from 'fa-mcp-sdk';

export const customPrompts = async (ctx: ITransportContext): Promise<IPromptData[]> => {
  const { transport, headers, payload } = ctx;

  const prompts: IPromptData[] = [
    { name: 'greeting', description: 'Greeting message', arguments: [],
      content: 'Hello! How can I help?' },
  ];

  // Add user-specific prompts
  if (payload?.user) {
    prompts.push({
      name: 'user_context',
      description: `Context for ${payload.user}`,
      arguments: [],
      content: `You are assisting user: ${payload.user}`,
    });
  }

  // Add transport-specific prompts
  if (transport === 'http') {
    prompts.push({
      name: 'http_mode',
      description: 'HTTP-specific instructions',
      arguments: [],
      content: 'Respond in JSON format for HTTP clients',
    });
  }

  return prompts;
};
```

## Resources

### Standard Resources

| URI | MIME | Description |
|-----|------|-------------|
| `project://id` | `text/plain` | Service identifier (`appConfig.name`) |
| `project://name` | `text/plain` | Display name (`appConfig.productName`) |
| `project://version` | `text/plain` | Server version (`appConfig.version`) — mirror of `GET /health.version` and `serverInfo.version` (standard §4 SHOULD) |
| `doc://readme` | `text/markdown` | README.md content |
| `use://http-headers` | `application/json` | Used HTTP headers (from `usedHttpHeaders`) |
| `use://auth` | `application/json` | Enabled auth schemes / methods / expected JWT claims (standard §11.2 SHOULD) |
| `<appConfig.name>://agent/brief` | `text/markdown` | Mirror of `agent_brief` prompt (Avatar profile §11.2) |
| `<appConfig.name>://agent/prompt` | `text/markdown` | Mirror of `agent_prompt` prompt (Avatar profile §11.2) |

> The `<appConfig.name>://agent/*` URIs are built automatically from `appConfig.name`
> (e.g. `mcp-jira://agent/brief`). If a project's `customResources` list contains a
> resource with the same URI, the project-supplied entry wins — handy when the service
> needs to publish a different brief through the resources endpoint than through prompts.

### Custom Resources

Add in `src/custom-resources.ts`:

```typescript
import { IResourceData } from 'fa-mcp-sdk';

export const customResources: IResourceData[] = [
  { uri: 'custom://config', name: 'Config', description: 'Server config',
    mimeType: 'text/plain', content: 'Version: 1.0.0' },

  { uri: 'custom://schema', name: 'API Schema', description: 'API schema',
    mimeType: 'application/json',
    content: { version: '1.0', endpoints: ['/api/users'] } },

  { uri: 'custom://status', name: 'Status', description: 'Live status',
    mimeType: 'application/json',
    content: async (uri) => JSON.stringify(await getStatus()) },

  { uri: 'custom://secrets', name: 'Secrets', description: 'Protected',
    mimeType: 'application/json', content: {}, requireAuth: true },

  // Standard §11.3 (MAY) — optional UI metadata. `title` is a human-facing label; `icons` is an
  // `IIcon[]` (same shape as prompts). `size` (bytes) is optional: on resources/list the SDK
  // computes it from the content (UTF-8 byte length for text/objects, buffer length for blobs) when
  // not set; lazy (function) content omits `size`. An author-supplied `size` is preserved.
  { uri: 'custom://logo', name: 'logo', title: 'Brand logo', description: 'SVG logo',
    mimeType: 'image/svg+xml', size: 1234,
    icons: [{ src: 'https://cdn.example.com/logo.svg', mimeType: 'image/svg+xml' }],
    content: '<svg …>' },
];
```

Pass to server:
```typescript
const serverData: McpServerData = { ..., customResources };
```

### Binary Resources (`blob`)

A resource whose payload is not text (image, PDF, archive, …) declares `content` as
`IResourceBinaryContent` instead of a string. `resources/read` then returns the bytes as base64
`contents[0].blob` (with the resource's `mimeType`) and omits `text` — exactly one of `text` /
`blob` is present per standard §11.4 / §12.2.

```typescript
import { readFileSync } from 'node:fs';
import { IResourceData } from 'fa-mcp-sdk';

export const customResources: IResourceData[] = [
  // Raw bytes — the SDK base64-encodes the Buffer for you:
  { uri: 'custom://logo.png', name: 'Logo', description: 'Brand logo',
    mimeType: 'image/png', content: { blob: readFileSync('assets/logo.png') } },

  // Already-base64 string — pass it through with base64: true:
  { uri: 'custom://icon.png', name: 'Icon', description: 'App icon',
    mimeType: 'image/png', content: { blob: PNG_BASE64, base64: true } },

  // A function may return binary content too (sync or async):
  { uri: 'custom://report.pdf', name: 'Report', description: 'Generated PDF',
    mimeType: 'application/pdf', content: async () => ({ blob: await buildPdf() }) },
];
```

`{ blob: string }` is assumed to be base64 unless you set `base64: false` (then the SDK encodes the
string's raw bytes). Clients decode `contents[0].blob` from base64 to recover the original file.

### Dynamic Resources (Function)

For dynamic resource lists based on transport type, headers, or user:

```typescript
import { IResourceData, ITransportContext } from 'fa-mcp-sdk';

export const customResources = async (ctx: ITransportContext): Promise<IResourceData[]> => {
  const { transport, headers, payload } = ctx;

  const resources: IResourceData[] = [
    { uri: 'custom://config', name: 'Config', description: 'Server config',
      mimeType: 'text/plain', content: 'Version: 1.0.0' },
  ];

  // Add user-specific resources
  if (payload?.user) {
    resources.push({
      uri: `user://${payload.user}/preferences`,
      name: 'User Preferences',
      description: `Preferences for ${payload.user}`,
      mimeType: 'application/json',
      content: await getUserPreferences(payload.user),
    });
  }

  return resources;
};
```

### Used HTTP Headers

Define required client headers:

```typescript
const serverData: McpServerData = {
  ...,
  usedHttpHeaders: [
    { name: 'Authorization', description: 'JWT token in Bearer format' },
    { name: 'X-Request-ID', description: 'Request tracking ID', isOptional: true },
  ],
};
```

Exposed via `use://http-headers` resource.

## requireAuth

Both prompts and resources support `requireAuth: true`:

- Requires valid authentication to access
- Unauthenticated requests get error
- Works with any configured auth method (JWT, Basic, etc.)

## Optional MAY capabilities — templates & subscribe (standard §11.5)

Disabled by default. Opt-in via `config/default.yaml`:

```yaml
mcp:
  resources:
    subscribeEnabled: false   # MAY §11.5 — turn on only when resources change at runtime
    templatesEnabled: false   # MAY §11.5 — turn on when you publish customResourceTemplates
```

### `resources/templates/list`

When `templatesEnabled: true`, register `customResourceTemplates` on `McpServerData`:

```typescript
import { IResourceTemplateInfo, McpServerData } from 'fa-mcp-sdk';

const customResourceTemplates: IResourceTemplateInfo[] = [
  {
    uriTemplate: 'issue://{key}',                         // RFC 6570
    name: 'jira-issue',
    title: 'Jira issue by key',
    description: 'Single Jira issue addressable by ticket key.',
    mimeType: 'application/json',
  },
];

const serverData: McpServerData = { ..., customResourceTemplates };
```

If you do not register any templates the server still answers `resources/templates/list`
with an empty array — clients can probe the capability safely.

### `resources/subscribe` + change notifications

When `subscribeEnabled: true`, the server advertises `subscribe` and `listChanged` in its
`resources` capability. To notify subscribers when content changes call
`notifyResourceUpdated(server, uri)`:

```typescript
import { notifyResourceUpdated } from 'fa-mcp-sdk';

// Each HTTP session owns its own Server instance — track the server reference at the
// point where you have it (e.g. inside a custom-resources content function).
await notifyResourceUpdated(server, 'project://version');
```

The helper emits `notifications/resources/updated` only to clients that previously called
`resources/subscribe` for the given URI on that `Server`.

## Optional MAY capability — argument completion (standard §8.2)

`completion/complete` lets a client ask the server to suggest values for a prompt or resource
argument (for example, the valid project ids for a `project` argument). Disabled by default; the
capability is advertised only when **both** the config flag is on **and** a `completionProvider`
is supplied on `McpServerData` — otherwise `completion/complete` returns `-32601`.

```yaml
mcp:
  completions:
    enabled: true   # MAY §8.2 — also requires a completionProvider (see below)
```

```typescript
import { McpServerData } from 'fa-mcp-sdk';

const completionProvider: McpServerData['completionProvider'] = async ({ ref, argument }) => {
  // ref: { type: 'ref/prompt' | 'ref/resource'; name?; uri? }
  // argument: { name; value }  — value is what the user has typed so far
  if (ref.type === 'ref/prompt' && argument.name === 'project') {
    const all = await listProjectIds();
    return all.filter((id) => id.startsWith(argument.value));
  }
  return [];
};

const serverData: McpServerData = { ..., completionProvider };
```

The SDK caps the response at 100 values and sets `completion.hasMore` / `completion.total`
accordingly.

## Pagination (standard §8.4)

`prompts/list` and `resources/list` use the same cursor-based pagination as `tools/list`:
opaque base64(offset), stable sort by `name` / `uri`. The page size comes from
`mcp.pagination.pageSize` (default 100). See [03-configuration → "Pagination"](./03-configuration.md#pagination).
