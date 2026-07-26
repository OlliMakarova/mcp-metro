# MCP METRO

MCP server for the Moscow Metro — finds the shortest routes between two stations and returns exhaustive station
details, including the Moscow Central Circle (MCC / МЦК) and the Moscow Central Diameters (MCD / МЦД).

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-DA7857)](https://modelcontextprotocol.io/)
[![MCP Apps](https://img.shields.io/badge/MCP%20Apps-SEP--1865-8A63D2)](https://modelcontextprotocol.io/)
[![fa-mcp-sdk](https://img.shields.io/badge/built%20with-fa--mcp--sdk-526CFE)](https://github.com/Bazilio-san/fa-mcp-sdk)

## Quick Links

- [Tools](#tools-1)
- [Quick Start](#quick-start)
- [MCP Client Integration](#mcp-client-integration)
- [Key Features](#key-features)
- [Configuration](#configuration-basics)
- [Build & Run](#build--run)
- [Authentication](#authentication)
- [Route Widget (MCP Apps)](#route-widget-mcp-apps)
- [Route Search & Station Matching](#route-search--station-matching)
- [Data Sources](#data-sources)
- [REST API](#rest-api)
- [Agent Tester](#agent-tester)
- [Deployment](#deployment)
- [Claude Code Skills](#claude-code-skills)

## Overview

MCP METRO gives AI agents a single tool for two questions a passenger actually asks: *how do I get from A to B* and
*what is there at station X*. Routes come with travel time, the full station sequence, transfers (including which train
car to board), ground transport at both ends, and the closures and repairs active right now. Station names are matched
fuzzily in four languages — Russian, English, Arabic and Chinese — so typos, transliteration and Russian oblique cases
all resolve to the right station. Hosts that support MCP Apps get an interactive route widget instead of a wall of text.

Use it when an assistant needs trustworthy Moscow transit answers without scraping a website on every request: the
server keeps its own daily-refreshed copy of the metro graph on disk and serves everything from memory.

## Tools (1)

One universal tool, `metro_info`, covers both scenarios through its `action` argument. The identifier is lowercase
snake_case, as the MCP tool-naming standard requires.

<details><summary>Expand to view detailed list of tools</summary><br>


### Routes and stations

| Tool         | Description                                                                          |
|--------------|--------------------------------------------------------------------------------------|
| `metro_info` | Shortest routes between two stations (`search_route`) or full station details (`get_station_info`) |

Input parameters:

| Parameter              | Required   | Description                                                                                                                                              |
|------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `first_metro_station`  | yes        | Departure station (for a route) or the station to describe. Any of the four languages, typos allowed — resolved by fuzzy search.                           |
| `second_metro_station` | for routes | Arrival station. Required for `action=search_route`, unused for `get_station_info`.                                                                        |
| `action`               | yes        | `search_route` — build routes between two stations; `get_station_info` — describe `first_metro_station`.                                                   |
| `city`                 | no         | `Moscow` (default) or `StPetersburg`. St. Petersburg data is not wired in yet: for now every value falls back to the Moscow dataset.                       |
| `language`             | no         | Language the user communicates in: `en` (default), `ru`, `ar` or `cn`. Station and line names are localized to it; all other response text is English.     |

What a `search_route` answer contains:

- up to 3 route variants, each with total travel time (transfer walking included) and a door-to-door estimate that
  adds street-to-platform enter/exit time;
- the full station sequence of every ride leg;
- transfers, with a hint on which train car to board for a faster interchange (primary data source only);
- which legs run on MCD / MCC lines;
- ground transport (buses, trolleybuses, trams) at the departure and arrival stations;
- advisories along the route: escalator and elevator repairs, closed exits, closed stations;
- entry status of the departure hub by Moscow time — whether vestibules are open and when they close or open next.

What a `get_station_info` answer contains: lines at the station, city exits with nearby ground transport, on-station
services, first and last train times per direction, available interchanges, and current advisories.

The tool is read-only (`readOnlyHint: true`, `openWorldHint: false`) and never modifies anything. Responses are
English Markdown — lists and tables. When a name is ambiguous the answer is a numbered list to choose from; for a
route request with two ambiguous names, both lists come at once.

</details>

## MCP Resources & Prompts

| URI                                     | MIME                        | Description                                                                     |
|-----------------------------------------|-----------------------------|---------------------------------------------------------------------------------|
| `metro://lines`                         | text/markdown               | All metro / MCC / MCD lines with name, kind and color.                          |
| `metro://status`                        | text/markdown               | Loaded-data summary: station, line, segment and active-advisory counts.         |
| `ui://mos-metro/routes.<hash>.html`     | text/html;profile=mcp-app   | Route widget for MCP Apps hosts; the URI is versioned by the widget content hash. |
| `doc://readme`                          | text/markdown               | This README with every `readme-docs/*.md` satellite appended (served by the SDK). |

| Prompt         | Description                                                            |
|----------------|------------------------------------------------------------------------|
| `agent_brief`  | Short agent description, used when a router picks an agent for a request. |
| `agent_prompt` | Full system prompt telling the model how and when to call `metro_info`. |

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
```

For STDIO mode (Claude Desktop spawns the process directly):

```bash
node dist/src/start.js stdio
```

No credentials are needed to start: authentication is off by default and the metro data sources require none.

## MCP Client Integration

The HTTP MCP endpoint is `http[s]://<host[:port]>/mcp`. This server takes no custom per-request headers — the only
header that matters is the standard `Authorization`, and only when `webServer.auth.enabled` is `true` (see
[Authentication](#authentication)). Omit it entirely while auth is off.

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

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.mcp-metro]
url = "https://mcp-metro.time-gold.com/mcp"
http_headers = { "Authorization" = "Bearer <jwt-token>" }
```

## Key Features

- **Route search with real travel times** — Yen's k-shortest-paths over a weighted graph, expected train wait added
  per boarding, transfer walking time baked into the edges.
- **Live closures applied to the graph** — advisories active at the requested moment remove segments, add official
  detours and exclude closed stations before the search runs.
- **Four-language fuzzy station matching** — Russian, English, Arabic, Chinese, plus transliteration and Russian case
  forms; interchange hubs are unified, genuinely different same-named stations trigger a clarification list.
- **Interactive route widget (MCP Apps, SEP-1865)** — a versioned `ui://` resource that loads its data from a signed
  REST link, with a working "Refresh route" button in any channel.
- **Two-tier data sourcing with disk fallback** — a full primary source, a graph-only backup, and an atomic on-disk
  cache so a restart never depends on the network.
- **Telegram alerts on source-state changes** — one message per transition, on degradation and on recovery alike.
- **Rate-limited REST API** — three read-only endpoints over the same data layer, documented in Swagger UI at `/docs`.
- **Agent Tester with Headless API** — drive the tool through a real LLM over plain HTTP, no browser needed.

## Transports

- **HTTP** — endpoints:
  - `/mcp` — MCP protocol (JSON-RPC 2.0, Streamable HTTP)
  - `/sse` — MCP over Server-Sent Events (legacy transport)
  - `/api/*` — REST API (see [REST API](#rest-api))
  - `/docs` — Swagger UI; raw spec at `/api/openapi.json`
  - `/health` — healthcheck
  - `/agent-tester` — Agent Tester web UI and Headless API
  - `/` — home page with the server's diagnostic summary
- **STDIO** — direct stdin/stdout, no network port; the mode Claude Desktop uses.

Port comes from `config/default.yaml` → `webServer.port` (default `9049`). The `/admin` token-generator UI is mounted
only when `adminPanel.enabled` is `true` — it is off in this project.

## Configuration Basics

Priority: environment variables > `config/local.yaml` > `config/{NODE_ENV}.yaml` > `config/default.yaml`. Secrets
belong in `config/local.yaml` (gitignored) or in environment variables.

| Key                            | Description                                                                    | Default   |
|--------------------------------|--------------------------------------------------------------------------------|-----------|
| `webServer.port`               | HTTP server port                                                               | `9049`    |
| `webServer.publicBaseUrl`      | Externally reachable base URL; drives the widget's `dataUrl` and its CSP        | —         |
| `webServer.auth.enabled`       | MCP and REST authorization on/off                                              | `false`   |
| `metro.refreshIntervalHours`   | Scheduled metro-data refresh interval                                          | `24`      |
| `metro.notificationsTtlHours`  | Lifetime of the cached closure notifications file                              | `24`      |
| `restApi.rateLimit.maxRequests`| REST requests allowed per window, per client IP                                 | `60`      |
| `widgetData.signSecret`        | HMAC secret signing widget-data links; empty means a new random one per restart | —         |
| `telegram.enabled`             | Telegram alerts on data-source state changes                                   | `false`   |
| `agentTester.enabled`          | Agent Tester UI and Headless API                                               | `true`    |
| `mcp.tools.answerAs`           | Tool response shape (`text` / `json`)                                          | `text`    |

Full reference, including every SDK section this project relies on: [Configuration](./readme-docs/configuration.md).

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

Details on testing and the Headless API: [Testing](./readme-docs/testing.md).

## Authentication

Authentication is **disabled by default** (`webServer.auth.enabled: false`) — the server answers `/mcp` and `/api/*`
without credentials, which is convenient locally and unacceptable on a public address. When you switch it on, the SDK
resolves the `Authorization` header in a fixed order: permanent server tokens, then Basic, then JWT, then a custom
validator. Tokens are issued by `node scripts/generate-jwt.js` or the `/gen-jwt` skill.

Resolution order, JWT modes, admin-panel specifics and the token-generation API:
[Authentication](./readme-docs/authentication.md).

## Route Widget (MCP Apps)

When the connected host advertises the MCP Apps UI extension (`io.modelcontextprotocol/ui`, SEP-1865), a
`search_route` answer returns `structuredContent = { widget, dataUrl }` for the widget plus one short text block that
keeps the model aware of what the user is looking at. The widget itself is a versioned `ui://` resource and fetches its
route data from a self-describing, HMAC-signed REST link, so its "Refresh route" button works even where `tools/call`
is unavailable. Text-only hosts keep receiving the full route Markdown.

Protocol contract, caching, the reverse-proxy and CORS setup, and the known sandbox limitation:
[Route Widget](./readme-docs/route-widget.md).

## Route Search & Station Matching

Routes are computed by Yen's k-shortest-paths algorithm on a graph rebuilt for the requested moment, with expected
train waiting time added at every boarding and transfer, and variants more than 30% slower than the fastest one
dropped. Station names arrive as free-form text and are reduced to one of three outcomes — one station, a
clarification list, or "not found" — by a fuzzy index that knows four languages, transliteration and Russian case
forms.

- Graph construction, time model, variant filtering and operating hours: [Route Search](./readme-docs/route-search.md).
- Name normalization, similarity metric, interchange-hub clustering: [Station
  Resolution](./readme-docs/station-resolution.md).

## Data Sources

The metro dataset is refreshed on a schedule (daily by default) from a full primary source, with a graph-only backup
source and an atomic on-disk cache in `data-cache/` behind it. Startup reads the disk copy first, so the server is
answering within a second and the network refresh happens in the background. Source names are treated as confidential
and are scrubbed from every outward-facing response, including error texts.

Source cascade, notification time-to-live, disk layout and Telegram alerting: [Data
Sources](./readme-docs/data-sources.md).

## REST API

Four read-only `GET` endpoints under `/api`, each rate-limited per client IP (60 requests per 60 seconds by default);
exceeding the limit yields `HTTP 429` with a `Retry-After` header. Cyrillic query values must be URL-encoded.

| Method & path                                   | Description                                                                |
|-------------------------------------------------|----------------------------------------------------------------------------|
| `GET /api/stations/search?q=&limit=`            | Fuzzy station search with id, name, line, cluster id and similarity score.  |
| `GET /api/stations/info?q=`                     | Station details; `300` with options when the name is ambiguous.             |
| `GET /api/routes?from=&to=&k=`                  | Up to `k` route variants with full details.                                |
| `GET /api/widget-data?from=&to=&lang=&at=&sig=` | Route data for the widget; public but signature-gated.                     |

Parameters, status codes, response shapes and rate-limit behavior: [REST API](./readme-docs/rest-api.md).
Interactive documentation: Swagger UI at `/docs`.

## Agent Tester

The built-in Agent Tester (`agentTester.enabled: true`) runs the tool through a real LLM: a web UI at
`/agent-tester` and a Headless API at `/agent-tester/api/chat/test` that returns the full trace — which tool was
called, with which arguments, and the exact system prompt sent to the model. It needs an OpenAI-compatible API key;
`npm run check-llm` verifies the key before you rely on it.

Headless recipes, trace fields, prompt overrides and the test log convention: [Testing](./readme-docs/testing.md).

## Deployment

Production runs as a self-contained systemd Docker container behind a reverse proxy (Caddy or nginx), driven by the
`/deploy-mcp-to-remote-server` skill; `deploy/` also carries a PM2 variant and ready proxy configs. An in-container
updater checks the tracked branch once a minute and rebuilds when it moves, reporting the verdict to Telegram.

Server layout, proxy configuration, `publicBaseUrl` and the update loop: [Deployment](./readme-docs/deployment.md).

## Claude Code Skills

The project ships custom skills in `.claude/skills/`:

| Command                        | Description                                                              |
|--------------------------------|--------------------------------------------------------------------------|
| `/gen-jwt`                     | Generate JWT tokens for MCP server authentication                        |
| `/deploy-mcp-to-remote-server` | Deploy, stop, restart, update and diagnose the server on a remote host   |
| `/upgrade-sdk`                 | Upgrade `fa-mcp-sdk` end-to-end: analyze the diff, plan, apply           |
| `/change-log`                  | Generate a Keep a Changelog entry between two versions                   |
| `/readme-generator`            | Regenerate this README and its `readme-docs/` satellites                 |
| `/feature-prompt-generator`    | Turn a feature description into a turnkey implementation prompt          |
| `/create-mcp-wizard`           | Implement an MCP server end-to-end, with Agent Tester iterations         |
| `/mcp-app-create`              | Scaffold a new MCP App (tool + UI resource)                             |
| `/mcp-app-add-to-server`       | Add interactive UI to the tools of an existing server                    |
| `/edit-claude-files`           | The required protocol for editing anything under `.claude/`              |

Launch modes, arguments and examples: [SKILLS](./readme-docs/SKILLS.md).

## Stack

- **Framework**: [fa-mcp-sdk](https://github.com/Bazilio-san/fa-mcp-sdk) (server core, transports, auth, Swagger,
  Agent Tester)
- **Protocol**: MCP over STDIO, Streamable HTTP and SSE; MCP Apps UI extension (SEP-1865)
- **Language**: TypeScript (ESM), Node.js ≥ 20
- **HTTP layer**: Express (via the SDK), `rate-limiter-flexible` for REST rate limiting
- **Data**: undocumented public transit APIs plus HTML parsing, cached on disk as JSON — no database
- **Tooling**: oxlint, oxfmt, jest, tsx

## License

MIT © Michael Makarova. See [LICENSE](./LICENSE).

The runtime contract — transports, HTTP endpoints, JWT claims, tool and resource shapes, error mapping, headers,
semver and deprecation policy — is documented in
[FA-MCP-SDK-DOC/11-public-contract.md](FA-MCP-SDK-DOC/11-public-contract.md).
