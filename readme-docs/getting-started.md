# Getting Started

From `npm install` to a connected AI client in a few minutes. The server needs no database, no API keys and no
credentials to start — authentication is off by default and the metro data sources require none. Both cities, Moscow
and Saint Petersburg, are loaded at startup with no extra setup. This page covers running the server, wiring it into
MCP clients (Claude Code, Claude Desktop, Qwen Code, OpenCode, Codex), the available transports, and the build and
test commands.

## Quick Start

```bash
npm install
npm run build
npm start                       # HTTP mode, port 9049
```

Verify the server is up and the data layer loaded:

```bash
curl http://localhost:9049/health
curl "http://localhost:9049/api/stations/info?q=%D0%9A%D0%B8%D0%B5%D0%B2%D1%81%D0%BA%D0%B0%D1%8F"
curl "http://localhost:9049/api/routes?from=devyatkino&to=kupchino&city=spb"   # the second city
```

For STDIO mode (Claude Desktop spawns the process directly):

```bash
node dist/src/start.js stdio
```

## MCP Client Integration

The HTTP MCP endpoint is `http[s]://<host[:port]>/mcp`. This server takes no custom per-request headers — the only
header that matters is the standard `Authorization`, and only when `webServer.auth.enabled` is `true` (see
[Authentication](./authentication.md)). Omit it entirely while auth is off.

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "mcp-metro": {
      "type": "http",
      "url": "http://localhost:9049/mcp",
      "headers": {
        "Authorization": "Bearer <jwt-token>"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`.

**Option 1 — STDIO (local build, direct spawn):**

```json
{
  "mcpServers": {
    "mcp-metro": {
      "command": "node",
      "args": ["<path-to-project>/dist/src/start.js", "stdio"],
      "env": {}
    }
  }
}
```

**Option 2 — HTTP (remote server via `mcp-remote`):**

```json
{
  "mcpServers": {
    "mcp-metro": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://mcp-metro.time-gold.com/mcp",
        "--header",
        "Authorization:Bearer <jwt-token>",
        "--allow-http",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

### Qwen Code

Add to `~/.qwen/settings.json`:

```json
{
  "mcpServers": {
    "mcp-metro": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "https://mcp-metro.time-gold.com/mcp",
        "--header",
        "Authorization:Bearer <jwt-token>",
        "--allow-http",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

Important: in `--header` values there must be **no space** after the `:`. `"Authorization:Bearer abc"` is correct,
`"Authorization: Bearer abc"` is not. This applies to both Claude Desktop Option 2 and Qwen Code.

### OpenCode

Add to `opencode.json` in the project root (or the global OpenCode config); documentation:
https://opencode.ai/docs/en/mcp-servers/

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "mcp-metro": {
      "type": "remote",
      "url": "http://localhost:9049/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer <jwt-token>"
      }
    }
  }
}
```

Omit the `headers` block entirely while authentication is off (the default).

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.mcp-metro]
url = "https://mcp-metro.time-gold.com/mcp"
http_headers = { "Authorization" = "Bearer <jwt-token>" }
```

## Transports

- **HTTP** — endpoints:
  - `/mcp` — MCP protocol (JSON-RPC 2.0, Streamable HTTP)
  - `/sse` — MCP over Server-Sent Events (legacy transport)
  - `/api/*` — REST API (see [REST API](./rest-api.md))
  - `/docs` — Swagger UI; raw spec at `/api/openapi.json`
  - `/health` — healthcheck
  - `/agent-tester` — Agent Tester web UI and Headless API
  - `/` — home page with the server's diagnostic summary
- **STDIO** — direct stdin/stdout, no network port; the mode Claude Desktop uses.

Port comes from `config/default.yaml` → `webServer.port` (default `9049`). The `/admin` token-generator UI is mounted
only when `adminPanel.enabled` is `true` — it is off in this project.

## Build & Run

```bash
npm run build        # tsc + copy static assets (the widget HTML, the logo)
npm run cb           # clean dist/ + build
npm start            # HTTP server on webServer.port
npm run typecheck    # tsc --noEmit
npm run quality:fix  # oxlint --fix + oxfmt
```

Tests:

```bash
npm test               # jest unit tests: data layer, routing, search, widget data
npm run test:mcp       # MCP protocol tests over STDIO (spawns the server itself)
npm run test:mcp-http  # MCP protocol tests over HTTP (needs a running server)
npm run test:mcp-sse   # MCP protocol tests over SSE (needs a running server)
```

Environment variables:

- `NODE_ENV` — selects the `config/{NODE_ENV}.yaml` overlay.
- `DEBUG` — namespace logging. `DEBUG=mcp:tool` prints every tool request and response (SDK);
  `DEBUG=fuzzy-search` prints the clarification alternatives a response is about to return;
  `DEBUG=config-info` prints the resolved configuration at startup.

## Where to go next

- What each of the two cities carries in its answers: [Cities](./cities.md).
- Every setting the server reads: [Configuration](./configuration.md).
- Locking the server down for a public address: [Authentication](./authentication.md).
- Testing, including the Agent Tester and its Headless API: [Testing](./testing.md).
- The formal runtime contract — transports, endpoints, JWT claims, error mapping, semver policy:
  [FA-MCP-SDK-DOC/11-public-contract.md](../FA-MCP-SDK-DOC/11-public-contract.md).
