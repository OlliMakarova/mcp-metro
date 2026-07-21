# Section Templates (Main README)

Canonical blocks for the main `README.md` of an `fa-mcp-sdk`-based MCP server. Copy, then adapt
placeholders (`<NAME>`, `<PORT>`, `<prefix>`, `<upstream>`) to the actual project.

---

## 1. Title + one-liner

```markdown
# <Project Name>

<One-sentence description: "MCP server for <Upstream System> — lets AI agents <primary action>.">
```

Example:

```markdown
# MCP Wiki

MCP server for Atlassian Confluence. Lets AI agents search, read, create, and edit wiki pages via
the Model Context Protocol.
```

---

## 2. Badges

Prefer shields.io. Include only badges that are meaningful (skip build status if no CI yet).

```markdown
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-DA7857)](https://modelcontextprotocol.io/)
[![fa-mcp-sdk](https://img.shields.io/badge/built%20with-fa--mcp--sdk-526CFE)](https://github.com/Bazilio-san/fa-mcp-sdk)
```

---

## 2a. Quick Links

Navigation block for the main README. Sits immediately after the badges, before **Overview**. Lists
only the major sections a reader is likely to jump to — never a full TOC.

**Inclusion rule.** Include a link for every `##` section that is either (a) one of the headline
topics below, or (b) a dynamic feature section produced in Step 3 of the workflow (Impersonation,
Admin Panel, Webhooks, Agent Tester, Consul, Active Directory, Database, …). Exclude Overview,
Transports, Stack, License, and every `###` sub-subsection. Target 8–14 entries.

```markdown
## Quick Links

- [Tools](#tools)
- [Quick Start](#quick-start)
- [MCP Client Integration](#mcp-client-integration)
- [Key Features](#key-features)
- [Configuration](#configuration-basics)
- [Build & Run](#build--run)
- [Authentication](#authentication)
- [Impersonation](#impersonation)
- [Admin Panel](#admin-panel)
- [Webhooks](#webhooks)
- [Agent Tester + Headless Agent Tester API](#agent-tester)
- [Claude Code Skills](#claude-code-skills)
```

**Anchor-slug rules (GitHub Markdown).**

- Lowercase the heading, replace spaces with `-`, strip punctuation (`,`, `.`, `:`, `?`, `!`, `()`).
- `&` is dropped entirely and produces a double dash — `Build & Run` → `#build--run`.
- `+` is dropped — `Agent Tester + Headless API` → `#agent-tester--headless-api`.
- If the Quick Links label diverges from the exact heading text, anchor to the heading, not the
  label (label is for humans, anchor must match the section's slug).
- When two headings collide (e.g. two `## Configuration`), GitHub appends `-1`, `-2`; avoid that by
  using distinct headings.

Verify every anchor resolves after assembly — dead Quick Links are worse than no Quick Links.

---

## 3. Overview

2–4 sentences. Answer: *what is this / for whom / core value*. Active voice. No marketing fluff.

```markdown
## Overview

<Project> provides comprehensive <upstream> integration for AI agents via the Model Context Protocol.
It exposes <N> tools covering <main domains>, supports <auth methods>, and ships with <one or two
distinguishing features>. Use it when you need <primary use case>.
```

---

## 4. Tools

Group by domain. Keep rows short — one-line descriptions only.

The full grouped listing is wrapped in a `<details>` block so it doesn't dominate the page on first
scroll. The `## Tools (<N>)` heading itself stays *outside* the block — it must remain visible and
anchor-linkable from **Quick Links**.

````markdown
## Tools (<N>)

<details><summary>Expand to view detailed list of tools</summary><br>


All tool names are prefixed with `<prefix>_`. Tools can be selectively enabled via
`<upstream>.usedInstruments` — see [Configuration](./readme-docs/configuration.md).

### <Domain 1>

| Tool                  | Description                                        |
|-----------------------|----------------------------------------------------|
| `<tool_name>`         | <Short description, verb-first, ≤ 80 chars>        |
| `<tool_name>`         | <Short description>                                |

### <Domain 2>

| Tool                  | Description                                        |
|-----------------------|----------------------------------------------------|
| `<tool_name>`         | <Short description>                                |

</details>
````

Formatting rules specific to this block:

- `<br>` immediately after `</summary>` is **mandatory** — without it GitHub collapses the first
  child block against the summary line.
- Keep one blank line between `<summary>` and the first `###` subsection, and one blank line
  before `</details>`.
- Column widths consistent within the file.
- Tool names always inline-code.
- If a tool has a caveat (e.g. server vs. cloud behaviour), use a footnote `*` and explain below
  the table.

---

## 5. Quick Start

Three steps. Target: a user running the server in under 2 minutes.

```markdown
## Quick Start

```bash
npm install
cp config/_local.yaml config/local.yaml   # configure <upstream> credentials
npm run build
npm start                                 # HTTP mode, port <PORT>
```

For STDIO mode (Claude Desktop direct spawn):

```bash
node dist/src/start.js stdio
```
```

---

## 6. MCP Client Integration

Always in main README. Adapt custom header names (`x-<prefix>-*`) to this server's actual scheme.

```markdown
## MCP Client Integration

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "<name>": {
      "type": "http",
      "url": "http[s]://<host[:port]>/mcp",
      "headers": {
        "x-<prefix>-username": "<your username>",
        "x-<prefix>-password": "<your password>"
      }
    }
  }
}
```

Alternatively, use a Personal Access Token:

```json
"headers": {
  "x-<prefix>-token": "<your PAT>"
}
```

### Claude Desktop

Add to `claude_desktop_config.json`.

**Option 1 — STDIO (local build, direct spawn):**

```json
{
  "mcpServers": {
    "<name>": {
      "command": "node",
      "args": ["<path>/<project>/dist/src/start.js", "stdio"],
      "env": {}
    }
  }
}
```

**Option 2 — HTTP (remote server via `mcp-remote`):**

```json
{
  "mcpServers": {
    "<name>": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "http[s]://<host[:port]>/mcp",
        "--header",
        "x-<prefix>-username:<your username>",
        "--header",
        "x-<prefix>-password:<your password>",
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
    "<name>": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@latest",
        "http[s]://<host[:port]>/mcp",
        "--header",
        "x-<prefix>-username:<your_username>",
        "--header",
        "x-<prefix>-password:<your_password>",
        "--allow-http",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

Important!: In `--header` values, there must be **no space** after the `:`.  
`"x-<prefix>-username:<your_username>"` is correct.  
`"x-<prefix>-username: <your_username>"` is incorrect.  
Applies to both Claude Desktop Option 2 (HTTP via `mcp-remote`) and Qwen Code.

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.<name>]
url = "http[s]://<host[:port]>/mcp"
http_headers = { "x-<prefix>-username" = "<your_username>", "x-<prefix>-password" = "<your_password>" }
```

```

---

## 7. Key Features

5–8 bullets. Include enabled SDK subsystems and project-specific capabilities. One line each.

```markdown
## Key Features

- **Multi-auth**: Basic, PAT, OAuth 2.0 with automatic token refresh
- **Per-request credentials**: override server config via `x-<prefix>-*` headers
- **Batch operations** for high-throughput scenarios
- **Fuzzy entity resolution** via external microservice
- **Aggressive caching** with thundering-herd protection
- **Webhook callbacks** for audit / chaining (`x-web-hook`)
- **Agent Tester UI + Headless API** for end-to-end testing
```

---

## 8. Transports

```markdown
## Transports

- **HTTP** — web integrations. Endpoints:
  - `/mcp` — MCP protocol (JSON-RPC 2.0)
  - `/api/*` — REST API (if custom API is present)
  - `/docs` — Swagger UI
  - `/health` — healthcheck
  - `/admin` — token generator UI
  - `/agent-tester` — Agent Tester web UI
- **STDIO** — for Claude Desktop direct spawn (no network)

Port is set in `config/default.yaml` → `webServer.port` (default <PORT>).
```

Keep endpoints that actually exist; drop the rest.

---

## 9. Configuration Basics

Compact table with 5–10 most important keys. Link to full reference when the list grows.

```markdown
## Configuration Basics

Priority: env vars > `config/local.yaml` > `config/{NODE_ENV}.yaml` > `config/default.yaml`.

| Key                              | Description                         | Default   |
|----------------------------------|-------------------------------------|-----------|
| `<upstream>.url`                 | <Upstream> base URL                 | —         |
| `<upstream>.auth.pat`            | Personal Access Token               | —         |
| `<upstream>.auth.basic.username` | Basic auth username                 | —         |
| `<upstream>.auth.basic.password` | Basic auth password                 | —         |
| `webServer.port`                 | HTTP server port                    | `<PORT>`  |
| `webServer.auth.enabled`         | MCP server authorization on/off     | `false`   |
| `mcp.tools.answerAs`             | Response format (`text` / `json`)   | `text`    |

Full reference: [Configuration](./readme-docs/configuration.md).
```

---

## 10. Build & Run

```markdown
## Build & Run

```bash
npm run build        # tsc + copy static assets
npm start            # HTTP server
npm run dev          # tsc --watch
```

Lint / typecheck / test:

```bash
npm run lint:fix
npm run typecheck
npm test
```

Environment variables:

- `NODE_ENV` — picks `config/{NODE_ENV}.yaml` overlay
- `DEBUG` — namespace-based logging (see [Debug Logging](./readme-docs/debugging.md))
```

---

## 11. Authentication (summary + link)

Keep this short. Push tables and invariants into `readme-docs/authentication.md`.

```markdown
## Authentication

The server supports per-request credentials via `x-<prefix>-*` headers (Basic, PAT) and
config-level defaults with OAuth 2.0 token refresh. When `x-on-behalf-of-user` is set, the request
is routed through the impersonation proxy.

Priority rules, resolution order, and invariants: [Authentication](./readme-docs/authentication.md).
```

---

## 12. Dynamic feature sections

One short subsection per enabled optional subsystem. 2–3 sentences each, with a link to the
satellite file when details warrant one.

```markdown
### Consul service discovery

Server registers itself on startup and deregisters on SIGTERM; health check path is `/health`.
Setup: [Consul](./readme-docs/consul.md).

### Active Directory

Tools can gate access by AD group membership. Configuration and per-domain setup:
[Active Directory](./readme-docs/active-directory.md).

### Webhooks

After every tool invocation the server can POST the result to an external URL via the `x-web-hook`
header or a per-tool `hook` return value. Body schema and priority:
[Webhooks](./readme-docs/webhooks.md).

### Agent Tester

Built-in web UI (`/agent-tester`) and Headless API (`/agent-tester/api/chat/test`) for end-to-end
testing with a real LLM. Full guide: [Testing](./readme-docs/testing.md).
```

---

## 13. Skills

```markdown
## Claude Code Skills

The project ships with custom skills in `.claude/skills/`:

| Command             | Description                                         |
|---------------------|-----------------------------------------------------|
| `/gen-jwt`          | Generate JWT tokens for MCP server authentication   |
| `/headless-test`    | Run headless tests for all MCP tools via curl API   |
| `/upgrade-guide`    | Generate migration guide for fa-mcp-sdk upgrades    |

Details, launch modes, and examples: [SKILLS](./readme-docs/SKILLS.md).
```

---

## 14. Stack

```markdown
## Stack

- **Framework**: [fa-mcp-sdk](https://github.com/Bazilio-san/fa-mcp-sdk)
- **Transport**: MCP (STDIO, HTTP, SSE)
- **Language**: TypeScript (ESM)
- **HTTP client**: Axios
- **Key libs**: <fill in the notable dependencies>
```

---

## 15. License

```markdown
## License

<License name> © <Owner>. See [LICENSE](./LICENSE).
```

---

## 16. Collapsible `<details>` block (generic pattern)

Use this pattern for any section where the content is important enough to stay inline (so the
`doc://readme` RAG pipeline captures it) but bulky enough to drown neighbouring sections on a
casual scroll. Canonical use: the Tools listing (see section 4). Other legitimate uses: long
example request/response matrices, exhaustive troubleshooting tables, verbose per-endpoint
catalogues.

**Checklist before reaching for `<details>`:**

1. The content must appear *in this section* (cannot be moved to a satellite file without
   losing context).
2. It spans enough lines that a reader scrolling past this section loses sight of the next
   section on a standard screen.
3. A casual first-time reader does not need every line immediately — the summary label alone
   tells them what's hidden.

If any of the three fails, either inline it normally or move it to `readme-docs/`.

```markdown
## <Section heading stays outside>

<Optional 1–3 sentence intro stays outside too — gives readers enough to decide whether to expand.>

<details><summary>Expand to view <what is inside>: <e.g. "detailed list of tools" /
"full request/response schema" / "per-endpoint example matrix"></summary><br>


<bulky content: tables, code blocks, nested subsections — anything markdown supports>

</details>
```

**Do NOT wrap in `<details>`:**

- Quick Start commands
- Key Features bullet list
- Configuration Basics table (short by design)
- MCP Client Integration JSON snippets
- Transports listing
- Anything under ~20 lines
