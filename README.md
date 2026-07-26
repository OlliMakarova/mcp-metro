# MCP METRO

**Moscow Metro for AI agents.** Ask *"how do I get from Khovrino to Sportivnaya?"* in plain language — get real
route variants with travel times, transfers, car-boarding hints and today's closures. Works in Russian, English,
Arabic and Chinese. Typos welcome.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-DA7857)](https://modelcontextprotocol.io/)
[![MCP Apps](https://img.shields.io/badge/MCP%20Apps-SEP--1865-8A63D2)](https://modelcontextprotocol.io/)
[![fa-mcp-sdk](https://img.shields.io/badge/built%20with-fa--mcp--sdk-526CFE)](https://github.com/Bazilio-san/fa-mcp-sdk)

<table>
  <tr>
    <td width="56%" valign="top"><img src="readme-docs/img.png" alt="A Telegram bot answers a route question via MCP METRO"></td>
    <td width="44%" valign="top"><img src="readme-docs/img_1.png" alt="Interactive route widget: variants, timeline, transfer hints"></td>
  </tr>
  <tr>
    <td><sub>In any chat the agent calls one tool and retells the route in the user's language.</sub></td>
    <td><sub>Hosts with MCP Apps render a live widget instead of text — route cards, a timeline, a working
    "Refresh route" button.</sub></td>
  </tr>
</table>

## What it does

- 🚇 **Routes people can actually follow** — up to 3 variants with travel time, every station on the way, transfer
  walks, a door-to-door estimate and "board the first car" hints for faster interchanges.
- 🚧 **Knows what's closed today** — escalator repairs, closed stations and official detours are applied to the
  route graph *before* the search runs, not footnoted after.
- 🌍 **Understands humans, not codes** — fuzzy station matching in four languages; typos, transliteration
  (`hovrino`) and Russian case forms (`до Чеховской`) all resolve to the right station.
- 🖼 **Interactive widget (MCP Apps)** — SEP-1865 hosts get clickable route cards; text-only hosts get clean
  Markdown. Nobody gets a wall of JSON.
- 🚈 **The whole network** — Metro, MCC and MCD, plus ground transport at both ends, station services and
  vestibule opening hours.
- ⚡ **Never hostage to the network** — a primary source, a backup source and an atomic disk cache, refreshed
  daily; the server answers within a second of starting.
- 🔌 **Every way in** — MCP over STDIO / HTTP / SSE, a rate-limited REST API with Swagger at `/docs`, and a
  built-in Agent Tester that drives the tool through a real LLM.

One tool — `metro_info` — answers the two questions a passenger asks: *how do I get from A to B*
(`search_route`) and *what is there at station X* (`get_station_info`).

## Try it in 60 seconds

```bash
npm install
npm run build
npm start            # HTTP mode → http://localhost:9049
```

```bash
curl http://localhost:9049/health
```

MCP endpoint: `http://localhost:9049/mcp`. No database, no API keys, no credentials — it just runs.
Connecting Claude Desktop, Claude Code, Codex or Qwen: [Getting Started](./readme-docs/getting-started.md).

## Documentation

| Topic                                                          | What's inside                                                                  |
|----------------------------------------------------------------|--------------------------------------------------------------------------------|
| [Getting Started](./readme-docs/getting-started.md)            | Install, run, connect MCP clients, transports, build & test commands           |
| [Tool Reference](./readme-docs/tool-reference.md)              | `metro_info` parameters and answers, MCP resources and prompts                 |
| [Route Search](./readme-docs/route-search.md)                  | The graph, Yen's algorithm, the time model, closures, operating hours          |
| [Station Resolution](./readme-docs/station-resolution.md)      | Fuzzy matching in four languages, interchange-hub clustering, clarifications   |
| [Route Widget](./readme-docs/route-widget.md)                  | MCP Apps contract, signed data links, caching, reverse-proxy and CORS setup    |
| [Data Sources](./readme-docs/data-sources.md)                  | Primary/backup cascade, disk cache, refresh schedule, Telegram alerts          |
| [REST API](./readme-docs/rest-api.md)                          | Four read-only endpoints, rate limits, status codes, response shapes           |
| [Configuration](./readme-docs/configuration.md)                | Every setting, resolution order, environment variables                         |
| [Authentication](./readme-docs/authentication.md)              | JWT / Basic / permanent tokens, issuing tokens, what stays open                |
| [Testing](./readme-docs/testing.md)                            | Unit tests, MCP protocol tests, Agent Tester and the Headless API              |
| [Deployment](./readme-docs/deployment.md)                      | Docker + systemd, reverse proxy, the self-update loop                          |
| [Skills](./readme-docs/SKILLS.md)                              | Claude Code skills shipped with the project                                    |

## Under the hood

TypeScript (ESM) on Node.js ≥ 20, built on [fa-mcp-sdk](https://github.com/Bazilio-san/fa-mcp-sdk) — server core,
transports, auth, Swagger and Agent Tester come from the SDK. Routing is Yen's k-shortest-paths over a weighted
graph rebuilt for the requested moment. Data lives in JSON on disk — no database.

## License

MIT © Michael Makarova. See [LICENSE](./LICENSE).
