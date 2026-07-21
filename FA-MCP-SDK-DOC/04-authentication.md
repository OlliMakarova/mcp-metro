# Authentication

## Auth Types

```typescript
type TTokenType = 'permanent' | 'JWT';

interface AuthResult {
  success: boolean;
  error?: string;
  authType?: 'permanentServerTokens' | 'jwtToken' | 'basic' | 'custom';
  username?: string;
  isTokenDecrypted?: boolean;
  payload?: any;
  /**
   * Standard §7.4 — authenticated but not authorized. Triggers HTTP 403
   * (NO WWW-Authenticate challenge). Set by custom validators or scope checks.
   */
  forbidden?: boolean;
}
```

## JWT Modes (since SDK 0.7.0)

`webServer.auth.jwtToken.mode` selects the JWT engine:

| Mode | Algorithm | Issues tokens | Verifies tokens | Discovery | Use case |
|------|-----------|---------------|-----------------|-----------|----------|
| `legacyAesCtr` (default) | HS256 + legacy AES-CTR | yes (HS256) | yes | — | Backward-compatible / 0.6.x parity |
| `embedded` | ES256 / RS256 | yes (autogen keys) | yes | full OIDC + JWKS + `/oauth/token` | Dev / demo |
| `localKey` | ES256 / RS256 | when `privateKeyPath` set | yes | OIDC + JWKS | Isolated server with PEM keys |
| `remoteJwks` | ES256 / RS256 | NO (`501`) | yes (remote JWKS) | protected-resource only | Corporate IdP (Keycloak, Okta, Azure AD, …) |

Pre-flight checks (`init-mcp-server.ts`) reject misconfigured non-legacy modes at start:

- `remoteJwks` without `jwksUri` → throws
- `localKey` without `publicKeyPath` → throws
- non-legacy without `expectedIssuer` → throws (standard §7.2)
- `clockSkew > 60s` → throws (standard Прил. A.1)
- `production` + `legacyAesCtr` + `auth.enabled=true` → warn (asymmetric required by standard)

```yaml
# config/local.yaml — corporate IdP
webServer:
  trustProxy: true   # behind HTTPS reverse proxy
  auth:
    enabled: true
    jwtToken:
      mode: remoteJwks
      jwksUri: 'https://idp.corp/.well-known/jwks.json'
      expectedIssuer: 'https://idp.corp'
      expectedAudience: '${SERVICE_NAME}'
      jwksCacheTtl: 600
      jwksCooldown: 30
      clockSkew: 30
```

Discovery endpoints mounted automatically when `mode != 'legacyAesCtr'`:

- `GET /.well-known/oauth-protected-resource` (any non-legacy)
- `GET /.well-known/openid-configuration` (`embedded` / `localKey`)
- `GET /.well-known/jwks.json` (`embedded` / `localKey`)
- `POST /oauth/token` (`embedded` + `localKey` with private key, `grant_type=password`)

On every 401 the server sets:

```
WWW-Authenticate: Bearer realm="<appConfig.name>",
                  resource_metadata="<base>/.well-known/oauth-protected-resource"
```

If the token was decoded but rejected (expired, bad scope), the header additionally carries
`error="invalid_token", error_description="…"` per RFC 6750.

## Token Operations

```typescript
import { generateToken, checkJwtToken } from 'fa-mcp-sdk';

// Since 0.7.0 — generateToken / checkJwtToken are async (dispatch by jwtToken.mode).
const token = await generateToken('john_doe', 3600, { role: 'admin' }); // 1 hour
const r = await checkJwtToken({ token });
```

Synchronous fallbacks (legacy mode only — never throw on `mode = legacyAesCtr`):

```typescript
import { generateTokenLegacy, checkJwtTokenLegacy } from 'fa-mcp-sdk';

const token = generateTokenLegacy('john_doe', 3600, { role: 'admin' });
const r = checkJwtTokenLegacy({ token });
```

## Test Authentication

```typescript
import { getAuthHeadersForTests, McpHttpClient, appConfig } from 'fa-mcp-sdk';

// Since 0.7.0 — getAuthHeadersForTests is async. Uses canLocallyIssueJwt() so JWT-based
// headers work in every mode that can sign locally (legacy / embedded / localKey).
const headers = await getAuthHeadersForTests();

// Usage
const response = await fetch(`http://localhost:${appConfig.webServer.port}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: {...}, id: 1 })
});

// With test client
const client = new McpHttpClient('http://localhost:3000');
const result = await client.callTool('tool', args, await getAuthHeadersForTests());
```

## Scope Enforcement (since SDK 0.7.0)

Standard §7.5 — protect specific tools / prompts / resources with `requiredScopes`. The auth
middleware checks the token's `scope` claim (space-separated) against the declared list and
returns HTTP 403 (or JSON-RPC `-32004` for tools) when scopes are missing.

```typescript
// Resource with required scope
{
  uri: 'admin://users',
  name: 'users',
  description: 'Admin user list',
  mimeType: 'application/json',
  requireAuth: true,
  requiredScopes: ['mcp:admin'],
  content: async () => ({ ... }),
}

// Prompt with required scope
{
  name: 'admin_brief',
  description: 'Privileged brief',
  arguments: [],
  content: '…',
  requiredScopes: ['mcp:admin'],
}

// Tool with required scope (via _meta — SDK Tool type has no native scope field)
{
  name: 'delete_user',
  description: 'Delete a user account',
  inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  _meta: { requiredScopes: ['mcp:admin'] },
}
```

A token issued via `POST /oauth/token` with `scope=mcp:admin` (or any IdP token carrying that
scope) passes; everything else hits 403. The full server-side scope map is published via the
built-in `use://auth` resource — clients can introspect it programmatically.

## Forbidden vs Unauthorized

Custom validators can now signal 403 explicitly via `AuthResult.forbidden`:

```typescript
const validator: CustomAuthValidator = async (req) => {
  const token = req.headers['x-api-key'];
  if (!token) return { success: false, error: 'No API key' };               // → 401
  if (await tokenIsRevoked(token)) {
    return { success: false, forbidden: true, error: 'Token revoked' };     // → 403, no challenge
  }
  return { success: true, authType: 'custom' };
};
```

## Admin Panel Authentication

The admin panel (`/admin`) supports 4 authentication types and can be configured with a single type or multiple types:

```yaml
# config/default.yaml
adminPanel:
  enabled: true
  # Single type (string)
  authType: 'basic'
  # Or multiple types (array) — login page shows tabs to choose
  authType: ['jwtToken', 'basic']
  # 'none' / null / empty array / not set — panel opens WITHOUT authentication
  # (convenience for local development; do NOT use in production).
  authType: 'none'
```

**Supported types:** `permanentServerTokens`, `basic`, `jwtToken`, `ntlm`, `none` (= open access)

When multiple types are configured (e.g. `['jwtToken', 'basic']`), the login page shows tabs:
- **Token** tab — for `permanentServerTokens` and `jwtToken` authentication
- **Login** tab — for `basic` (username/password) authentication

For `permanentServerTokens`, `basic`, `jwtToken` — credentials are taken from `webServer.auth` section.
For `ntlm` — uses AD configuration from `ad.domains` section.

### JWT Admin Requirement: `payload.allow === 'gen-token'`

When `jwtToken` is used to authenticate into the admin panel (`/admin`), the decoded
payload **must** contain `allow: 'gen-token'`. Any JWT without this claim is rejected
with `401` even if its signature verifies and it is not expired. This prevents short-lived
JWTs issued for other purposes (e.g. the Agent Tester page auto-fills a JWT into its
`Authorization` header — TTL is configurable via `agentTester.tokenTTLSec`, default
30 min) from being replayed against `/admin` to mint arbitrary long-lived tokens.

Generate an admin-capable JWT by including `allow=gen-token` in the payload:

```bash
node scripts/generate-jwt.js -u admin -ttl 30d -p "allow=gen-token"
```

`permanentServerTokens` and `basic` admin auth are unaffected — this check applies
only to the `jwtToken` admin path.

## Token Generator Authorization

Protect `/admin/` page with custom authorization:

```typescript
import { TokenGenAuthHandler, initADGroupChecker } from 'fa-mcp-sdk';

const { isUserInGroup } = initADGroupChecker();

const tokenGenAuthHandler: TokenGenAuthHandler = async (input) => {
  // input: { user, domain?, payload?, authType }
  if (input.authType === 'ntlm') {
    const isAdmin = await isUserInGroup(input.user, 'TokenGeneratorAdmins');
    if (!isAdmin) return { success: false, error: `User not authorized` };
  }
  return { success: true, username: input.user };
};

const serverData: McpServerData = { ..., tokenGenAuthHandler };
```

## Multi-Authentication System

### createAuthMW()

Universal middleware supporting all auth methods:

```typescript
import { createAuthMW } from 'fa-mcp-sdk';

const authMW = createAuthMW();
app.use('/api', authMW);

app.get('/api/protected', (req, res) => {
  const authInfo = (req as any).authInfo;
  res.json({ authType: authInfo?.authType, username: authInfo?.username });
});

// Advanced options
const authMW = createAuthMW({
  mcpPaths: ['/mcp', '/messages', '/sse'],  // Paths with public resource access
  logConfig: true,                           // Log config on first request
});
```

### getMultiAuthError()

Programmatic auth checking:

```typescript
import { getMultiAuthError } from 'fa-mcp-sdk';

const authError = await getMultiAuthError(req);
if (authError) {
  return res.status(authError.code).send(authError.message);
}
```

### Custom Authentication

`customAuthValidator` runs **before** standard auth (`Authorization` header check).

**Execution order:**
1. `customAuthValidator` is called first
2. If `success: true` → request is allowed, standard auth is **skipped**
3. If `success: false` → falls through to standard auth (`permanentServerTokens` / `basic` / `jwtToken`)
4. If standard auth also fails → 401

This allows using service-specific credentials (e.g. `x-api-key`, `x-service-token`) as an alternative
to the MCP `Authorization` header, without disabling standard auth entirely.

```typescript
import { CustomAuthValidator, AuthResult } from 'fa-mcp-sdk';

// Example: bypass MCP auth if service-specific header is present
const customValidator: CustomAuthValidator = async (req): Promise<AuthResult> => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && await validateApiKey(apiKey)) {
    return { success: true, authType: 'custom', username: 'api-user' };
  }
  // Return false → falls through to standard Authorization header check
  return { success: false, error: 'No valid API key' };
};

const serverData: McpServerData = { ..., customAuthValidator: customValidator };
```

**Example: allow requests with upstream service headers to bypass MCP auth**

```typescript
// Clients that pass x-service-token OR x-username+x-password are allowed in
// without an MCP Authorization token. Clients without these headers still
// need a valid Authorization header (permanentToken / basic / JWT).
const serviceHeadersValidator: CustomAuthValidator = (req) => {
  const h = req.headers as Record<string, string>;
  if (h['x-service-token'] || (h['x-username'] && h['x-password'])) {
    return { success: true, authType: 'custom' };
  }
  return { success: false, error: 'No service credentials and no MCP Authorization token' };
};
```

> **Note:** `customAuthValidator` receives a request with **normalized** (lowercased) header names.
> `authInfo` is **not** set on `req` when the validator runs — it is set by the middleware only after
> successful authentication completes.

## Agent Tester Authentication

Protect the Agent Tester (`/agent-tester/*`) with `agentTester.useAuth`:

```yaml
agentTester:
  useAuth: true   # Require authentication for Agent Tester
webServer:
  auth:
    enabled: true
    permanentServerTokens: ['my-secret-token']
```

Or via ENV: `AGENT_TESTER_USE_AUTH=true`

When `useAuth` is `true`, the full multi-auth middleware is applied to Agent Tester routes — the same authentication used for MCP endpoints (`permanentServerTokens` / `basic` / `jwtToken` / `custom`). Browser users see a login dialog; headless clients pass `Authorization` header directly.

See [Agent Tester docs](08-agent-tester-and-headless-api.md#authentication-agenttesteruseauth) for details on the login flow, session management, and API endpoints.

## AD Group Checking

### Configuration

```yaml
# config/local.yaml
ad:
  domains:
    MYDOMAIN:
      default: true
      controllers: ['ldap://dc1.corp.com']
      username: 'svc_account@corp.com'
      password: '***'
```

### Usage

```typescript
import { initADGroupChecker } from 'fa-mcp-sdk';

const { isUserInGroup, groupChecker } = initADGroupChecker();

const isAdmin = await isUserInGroup('john.doe', 'Admins');
groupChecker.clearCache();  // Clear if needed
```

## JWT IP Restriction

When `webServer.auth.jwtToken.isCheckIP` is `true`, JWT tokens can include an `ip` field in their payload to restrict which client IPs may use the token.

### Configuration

```yaml
# config/default.yaml
webServer:
  auth:
    jwtToken:
      isCheckIP: true  # Enable IP checking
```

### Token Generation

When generating a token (via admin UI or `generateToken()`), include the `ip` field in the payload:

```typescript
const token = generateToken('john_doe', 3600, {
  service: 'my-mcp-server',
  ip: '192.168.1.100, 10.0.0.0/24',
});
```

The `ip` field is a string of IP addresses and/or CIDR masks, separated by commas, semicolons, or spaces.

In the admin UI (`/admin`), there is a dedicated "Allowed IP addresses" field for entering these values.

### Behavior

| `isCheckIP` | `payload.ip` | Client IP | Result |
|-------------|-------------|-----------|--------|
| `false` | any | any | IP not checked |
| `true` | empty/missing | any | IP not checked (pass-through) |
| `true` | `10.0.0.0/24` | `10.0.0.5` | Allowed |
| `true` | `10.0.0.0/24` | `192.168.1.1` | Denied |
| `true` | `192.168.1.1, 10.0.0.0/8` | `10.5.5.5` | Allowed (covered by /8) |

Supported formats: IPv4, IPv6, CIDR notation (e.g., `10.0.0.0/24`, `fe80::/10`), IPv4-mapped IPv6 (`::ffff:192.168.1.1`).

## Client Examples

```bash
# Permanent token
curl -H "Authorization: Bearer server-token-1" http://localhost:3000/mcp

# JWT
curl -H "Authorization: Bearer eyJ..." http://localhost:3000/mcp

# Basic Auth
curl -H "Authorization: Basic $(echo -n 'admin:password' | base64)" http://localhost:3000/mcp

# Custom headers
curl -H "X-API-Key: custom-key" http://localhost:3000/mcp
```

## Token Check Endpoint (`/ct`)

Standard §7.1 forbids secrets in URL query strings. Since SDK 0.7.0 `GET /ct?t=<token>` is
disabled by default and returns HTTP 405. Use `POST /ct` with JSON body instead:

```bash
curl -X POST http://localhost:3000/ct \
  -H "Content-Type: application/json" \
  -d '{"t": "<your-token>"}'
```

Opt-in for the legacy form (non-production only — flag is ignored when `NODE_ENV=production`):

```yaml
webServer:
  tokenCheck:
    allowQueryToken: true
```

## CLI Token Generator

Generate JWT tokens from the command line without starting the server:

```bash
node scripts/generate-jwt.js -u <username> -ttl <duration> [-s <service>] [-p <params>] [--key <path>]
```

| Option | ENV | Description |
|--------|-----|-------------|
| `-u`, `--username` | `JWT_PAYLOAD_USERNAME` | Username (required) |
| `-ttl` | `JWT_TTL` | Token lifetime: `<N>s` \| `<N>m` \| `<N>d` \| `<N>y` (required) |
| `-s`, `--service-name` | `JWT_PAYLOAD_SERVICE_NAME` | Service name (optional) |
| `-p`, `--params` | `JWT_PAYLOAD_PARAMS` | Extra payload `key=value;key=value` (optional) |
| `--key`, `--private-key` | — | Override private key path (only for embedded / localKey modes) |

Behaviour by `webServer.auth.jwtToken.mode`:

| Mode | What the script does |
|------|----------------------|
| `legacyAesCtr` | HS256 with `encryptKey` (legacy). |
| `embedded` | ES256/RS256 with keys from `keyStoragePath/private.pem`. |
| `localKey` | ES256/RS256 with `privateKeyPath` (must be configured or passed via `--key`). |
| `remoteJwks` | Exits with error — tokens must be obtained from the external IdP. |

**Examples:**

```bash
# 30-day token with service name
node scripts/generate-jwt.js -u admin -ttl 30d -s my-mcp-server

# 1-year token with extra payload fields
node scripts/generate-jwt.js -u svc-account -ttl 1y -p "role=admin;team=backend"

# Via environment variables
JWT_PAYLOAD_USERNAME=admin JWT_TTL=8d node scripts/generate-jwt.js
```

## Claude Code Skill: `/gen-jwt`

Interactive JWT token generation via Claude Code. Invoke with `/gen-jwt` or natural language (e.g. "сгенерируй токен для vpupkin на 1 год").

The skill parses your request for `username`, `ttl`, `service`, `request` (ticket ID), `ip`, and extra key=value params. If required params (`username`, `ttl`) are missing, it asks interactively. Optional params (`request`, `ip`) are prompted once with an option to skip.

Runs `node scripts/generate-jwt.js` under the hood.

**Example:**
```
/gen-jwt для vpupkin, по заявке REQ-12345, на 1 год, role=admin, IP 10.0.0.0/24
```

Skill location: `.claude/skills/gen-jwt/SKILL.md`

## JWT Generation API

HTTP endpoint for programmatic JWT token generation. Disabled by default.

### Configuration

```yaml
# config/default.yaml
webServer:
  genJwtApiEnable: true   # Enable POST /gen-jwt endpoint
  auth:
    enabled: true          # Auth must be enabled — endpoint requires valid credentials
    jwtToken:
      encryptKey: 'your-secret-key-here'
```

Or via ENV: `WS_GEN_JWT_API_ENABLE=true`

### Usage

```bash
# POST /gen-jwt with any configured auth method
curl -X POST http://localhost:3000/gen-jwt \
  -H "Content-Type: application/json" \
  -u "admin:password" \
  -d '{
    "username": "testuser",
    "ttl": "30d",
    "service": "my-mcp-server",
    "params": "role=admin;team=backend"
  }'
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `username` | string | yes | Username for the token |
| `ttl` | string | yes | Token lifetime: `<N>s` \| `<N>m` \| `<N>d` \| `<N>y` |
| `service` | string | no | Service name |
| `params` | string \| object | no | Extra payload. String: `"key=value;key=value"`. Object: `{"key": "value"}` |

### Response

```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0dXNlciJ9.signature",
  "user": "testuser",
  "expire": "2025-07-10T12:00:00.000Z",
  "ttlSeconds": 2592000
}
```

## Token Generator App

```typescript
import { generateTokenApp } from 'fa-mcp-sdk';

generateTokenApp();      // Port 3030
generateTokenApp(1234);  // Custom port
```

**Endpoints:**
- `/` - Web UI
- `/admin/api/generate-token` - POST: Generate token
- `/admin/api/validate-token` - POST: Validate token
- `/admin/api/service-info` - GET: Service info
- `/admin/api/auth-status` - GET: Auth status
