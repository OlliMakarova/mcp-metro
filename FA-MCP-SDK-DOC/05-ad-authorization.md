# AD Group Authorization

Authorization by AD group membership. Assumes JWT auth is configured.

## AD Configuration Types

```typescript
interface IADConfig {
  ad: {
    domains: { [domainName: string]: IDcConfig };
    tlsOptions?: ConnectionOptions;
    groupCacheTtlMs?: number;  // Default: 10 min
    dnCacheTtlMs?: number;     // Default: 24 hours
  };
}

interface IDcConfig {
  controllers: string[];  // ['ldap://dc1.corp.com']
  username: string;
  password: string;
  baseDn?: string;        // Auto-derived if omitted
  default?: boolean;
}
```

```yaml
# config/default.yaml
ad:
  groupCacheTtlMs: 600000
  domains:
    CORP:
      default: true
      controllers: ['ldap://dc1.corp.com']
      username: 'svc_mcp@corp.com'
      password: '${AD_SERVICE_PASSWORD}'
```

## Custom Config Extension

```typescript
// src/_types_/custom-config.ts
import { AppConfig } from 'fa-mcp-sdk';

interface IGroupAccessConfig {
  groupAccess: { requiredGroup: string; bypassGroupCheck?: boolean };
}
export interface CustomAppConfig extends AppConfig, IGroupAccessConfig {}
```

```yaml
# config/default.yaml
groupAccess:
  requiredGroup: "DOMAIN\\MCP-Users"
  bypassGroupCheck: false
```

## Example 1: HTTP Level Restriction

Block unauthorized users at HTTP level (403 before MCP processing).

> **Important:** `customAuthValidator` runs **before** standard auth and before `authInfo` is set on
> the request. It cannot read `(req as any).authInfo` — that value is populated by the middleware
> only after successful authentication. Use `httpComponents.apiRouter` to add a post-auth middleware
> if you need to check group membership after the user has been authenticated.

```typescript
// src/start.ts
import { Router } from 'express';
import { appConfig, initMcpServer, getMultiAuthError, initADGroupChecker } from 'fa-mcp-sdk';
import { CustomAppConfig } from './_types_/custom-config.js';

const config = appConfig as CustomAppConfig;
const { isUserInGroup } = initADGroupChecker();

// Post-auth AD group check: runs after standard auth has verified the token
// and set authInfo on the request.
const groupCheckRouter = Router();
groupCheckRouter.use(async (req, res, next) => {
  // Verify standard auth first (sets authInfo on req)
  const authError = await getMultiAuthError(req);
  if (authError) return res.status(authError.code).send(authError.message);

  if (config.groupAccess.bypassGroupCheck) return next();

  const authInfo = (req as any).authInfo;
  const username = authInfo?.username || authInfo?.payload?.user;
  if (!username) return res.status(403).send('Forbidden: User info unavailable');

  const isInGroup = await isUserInGroup(username, config.groupAccess.requiredGroup);
  if (!isInGroup) return res.status(403).send(`Forbidden: Not in group '${config.groupAccess.requiredGroup}'`);

  next();
});

await initMcpServer({
  ...,
  httpComponents: { apiRouter: groupCheckRouter },
});
```

## Example 2: All Tools Restriction

Check in `toolHandler` (MCP error response):

```typescript
// src/tools/handle-tool-call.ts
import { ToolExecutionError, appConfig, initADGroupChecker, IToolHandlerParams } from 'fa-mcp-sdk';
import { CustomAppConfig } from '../_types_/custom-config.js';

const config = appConfig as CustomAppConfig;
const { isUserInGroup } = initADGroupChecker();

async function checkToolAccess(payload: IToolHandlerParams['payload']) {
  if (config.groupAccess.bypassGroupCheck) return;
  if (!payload?.user) throw new ToolExecutionError('auth', 'User info unavailable');

  const isInGroup = await isUserInGroup(payload.user, config.groupAccess.requiredGroup);
  if (!isInGroup) {
    throw new ToolExecutionError('auth', `Forbidden: User not in '${config.groupAccess.requiredGroup}'`);
  }
}

export const handleToolCall = async (params: IToolHandlerParams) => {
  await checkToolAccess(params.payload);  // Check ALL tools
  // ... tool switch logic
};
```

## Example 3: Per-Tool Restriction

Different groups for different tools:

```typescript
// src/_types_/custom-config.ts
interface IToolGroupAccessConfig {
  toolGroupAccess: {
    defaultGroup?: string;
    tools: Record<string, { requiredGroup?: string; public?: boolean }>;
    bypassGroupCheck?: boolean;
  };
}
```

```yaml
# config/default.yaml
toolGroupAccess:
  defaultGroup: "DOMAIN\\MCP-Users"
  bypassGroupCheck: false
  tools:
    get_public_data:
      public: true
    get_user_data:
      requiredGroup: "DOMAIN\\MCP-Users"
    admin_operation:
      requiredGroup: "DOMAIN\\MCP-Admins"
```

```typescript
// src/tools/handle-tool-call.ts
async function checkToolAccess(toolName: string, payload: IToolHandlerParams['payload']) {
  const toolAccess = config.toolGroupAccess;
  if (toolAccess.bypassGroupCheck) return;

  const toolConfig = toolAccess.tools[toolName];
  if (toolConfig?.public) return;

  if (!payload?.user) throw new ToolExecutionError(toolName, 'User info unavailable');

  const requiredGroup = toolConfig?.requiredGroup || toolAccess.defaultGroup;
  if (!requiredGroup) return;

  const isInGroup = await isUserInGroup(payload.user, requiredGroup);
  if (!isInGroup) {
    throw new ToolExecutionError(toolName, `Forbidden: User not in '${requiredGroup}'`);
  }
}

export const handleToolCall = async (params: IToolHandlerParams) => {
  await checkToolAccess(params.name, params.payload);
  // ... tool switch logic
};
```

## Authorization Levels Summary

| Level | Location | Error Type | Use Case |
|-------|----------|------------|----------|
| Pre-auth bypass | `customAuthValidator` | HTTP 401 | Allow alternative credentials (no `Authorization` header) |
| HTTP Server (post-auth) | `httpComponents.apiRouter` + `getMultiAuthError` | HTTP 403 | Block completely after identity is known |
| All Tools | `toolHandler` (global) | MCP Error | Allow HTTP, restrict tools |
| Per Tool | `toolHandler` (per-tool) | MCP Error | Fine-grained permissions |

> `customAuthValidator` is a **pre-auth** hook — it runs before standard auth and before `authInfo`
> is available. Use it to allow alternative credentials, not to check group membership.
> For group checks that require a verified username, use `httpComponents.apiRouter` (post-auth)
> or `toolHandler` (per-call).
