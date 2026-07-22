# MCP METRO — Moscow metro routes & station info

MCP server for the **Moscow Metro** (including the Moscow Central Circle **MCC / МЦК** and the Moscow Central
Diameters **MCD / МЦД**). It builds the shortest routes between two stations and returns exhaustive information
about any station. Station names are matched fuzzily in **four languages** — Russian, English, Arabic and
Chinese — tolerating typos and transliteration. All tool answers are formatted as **Markdown** (lists and tables).

Built on the `fa-mcp-sdk` framework. Exposes one MCP tool, two MCP resources, the built-in agent prompts, and a
rate-limited REST API. Works over STDIO (Claude Desktop) or HTTP/SSE.

## What it can do

- **Route search** — from 1 to 4 shortest route variants between two stations, each with:
  - total travel time (including transfer walking time) plus a door-to-door estimate with street-to-platform
    enter/exit time;
  - the full station sequence of every ride leg;
  - transfers, with a recommendation of which train car to board for a faster interchange;
  - which legs run on МЦД / МЦК lines;
  - ground transport (buses, trolleybuses, trams) at the departure and arrival stations;
  - active advisories along the route: escalator/elevator repairs, closed exits, station closures.
- **Station info** — lines at the station, city exits with nearby ground transport, on-station services,
  first/last train times per direction, available interchanges, and current advisories.
- **Fuzzy station resolution** — recognizes a name across four languages with typos. When a single physical
  station (interchange hub) is matched, it is used directly. When several different stations match, the tool
  asks the user to choose from a list; if nothing matches, it asks to refine the name. For a route request where
  both stations are ambiguous, it asks about both at once.

## Data sources

Metro data is refreshed daily from the primary source **mosmetro.ru** (full dataset: exits, services, schedule,
advisories, car hints), with a fallback to **metrobook.ru** (graph core only) and a local disk cache in
`data-cache/`. If both sources are unreachable and no disk copy exists, the tool reports that data is temporarily
unavailable. Optional Telegram notifications report source state changes. See `config/default.yaml` → `metro`
and `telegram`.

## MCP Tool

### `mos_metro_info`

Universal tool. The identifier is lowercase snake_case, as required by the MCP tool-naming standard.

| Parameter | Required | Description |
|-----------|----------|-------------|
| `first_metro_station` | yes | Departure station (for a route) or the station to describe. Any of the four languages, typos allowed — resolved by fuzzy search. |
| `second_metro_station` | for routes | Arrival station. Required for `action=search_route`, unused for `get_station_info`. |
| `action` | yes | `search_route` — build routes between two stations; `get_station_info` — describe `first_metro_station`. |
| `language` | no | Language the user communicates in: `en` (default), `ru`, `ar` or `cn`. Station and line names in the response are given in this language; all other response text is English. |

The response is English Markdown. On ambiguity it contains a numbered list (or two lists, one per station) to choose from.

## REST API

Three read-only endpoints under `/api`, each protected by per-client (by IP) rate limiting. On exceeding the
limit the server replies `HTTP 429` with a `Retry-After` header. Limits are configured in `config/default.yaml`
→ `restApi.rateLimit` (default 60 requests / 60 seconds). Cyrillic query values must be URL-encoded.

| Method & path | Description |
|---------------|-------------|
| `GET /api/stations/search?q=<name>&limit=<1..50>` | Fuzzy station search. Returns matches with id, name, line, cluster id and similarity score. |
| `GET /api/stations/info?q=<name>` | Station info. `200` when resolved; `300` with `options` when ambiguous; `404` when not found. |
| `GET /api/routes?from=<name>&to=<name>&k=<1..4>` | Up to `k` route variants with full details. `300` when a station needs clarification. |

OpenAPI/Swagger UI is served at `/docs`; the raw spec at `/api/openapi.json`.

## MCP Resources

| URI | MIME | Description |
|-----|------|-------------|
| `metro://lines` | text/markdown | All metro / МЦК / МЦД lines with name, type and color. |
| `metro://status` | text/markdown | Data source and freshness: schema date, station/line counts, active advisory count. |

## MCP Prompts

| Name | Description |
|------|-------------|
| `agent_brief` | Short agent description used for agent selection. |
| `agent_prompt` | Full system prompt instructing the LLM how to use the tool. |

## Install & Run

```bash
npm install
npm run build

# HTTP mode (default), server on config webServer.port (9049 by default)
npm start

# STDIO mode (Claude Desktop)
node dist/src/start.js stdio
```

### Tests

```bash
npm test               # unit tests (jest): data layer, routing, search
npm run test:mcp       # MCP protocol tests over STDIO (spawns the server)
npm run test:mcp-http  # MCP protocol tests over HTTP  (needs a running server)
npm run test:mcp-sse   # MCP protocol tests over SSE   (needs a running server)
```

The HTTP and SSE test runners connect to an already-running server (`npm start` first).

## Transports

- **STDIO** — direct stdin/stdout, no network port; ideal for Claude Desktop.
- **HTTP / SSE** — home page at `http://localhost:9049/`, health at `/health`, JSON-RPC MCP endpoint at `/mcp`,
  SSE at `/sse`, Agent Tester at `/agent-tester`, Swagger at `/docs`.

## Usage with AI CLIs

The server exposes an HTTP MCP endpoint at `http[s]://<host[:port]>/mcp`. Authentication (when enabled in
`config/default.yaml` → `webServer.auth`) is passed via the standard `Authorization` header — most commonly a
JWT Bearer token generated by the `/gen-jwt` skill or by `node scripts/generate-jwt.js`.

### With Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "mcp-metro": {
      "type": "http",
      "url": "http[s]://<host[:port]>/mcp",
      "headers": { "Authorization": "Bearer <jwt-token>" }
    }
  }
}
```

### With Claude Desktop

```json
{
  "mcpServers": {
    "mcp-metro": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote@latest", "http[s]://<host[:port]>/mcp",
        "--header", "Authorization: Bearer <jwt-token>",
        "--allow-http", "--transport", "http-only"
      ]
    }
  }
}
```

> For local STDIO integration without an HTTP server, run `node <path-to-project>/dist/src/start.js stdio`.

## Configuration

Priority: environment variables > `local.yaml` > `{NODE_ENV}.yaml` > `default.yaml`. Key project sections in
`config/default.yaml`:

- `metro` — daily refresh period, advisory time-to-live, per-request HTTP timeout.
- `restApi.rateLimit` — REST API rate limit (`maxRequests`, `windowSec`).
- `telegram` — optional source-state notifications (`enabled`, `botToken`, `chatId`; secrets belong in
  `config/local.yaml` or ENV).
- `mcp` — MCP transport, tool result format, MCP endpoint rate limit and limits.
- `webServer` — bind host/port and authentication.

## Security

When `adminPanel.authType` includes `jwtToken`, the admin panel (`/admin`) accepts a JWT **only if its payload
contains `allow: 'gen-token'`**. Generate an admin-capable JWT:

```bash
node scripts/generate-jwt.js -u admin -ttl 30d -p "allow=gen-token"
```

## Public Contract

The runtime contract (transports, HTTP endpoints, JWT claims, tool/prompt/resource shape, error mapping,
headers, semver and deprecation policy) is documented in
[FA-MCP-SDK-DOC/11-public-contract.md](FA-MCP-SDK-DOC/11-public-contract.md).
