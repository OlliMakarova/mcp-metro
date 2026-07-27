# Section Templates

Canonical blocks for the showcase-style documentation of an `fa-mcp-sdk`-based MCP server. Copy,
then adapt placeholders (`<NAME>`, `<PORT>`, `<prefix>`, `<upstream>`) to the actual project.

Four parts:

- **Part A** — the main `README.md` (the showcase page, incl. the two collapsed end sections)
- **Part B** — the mandatory satellite `readme-docs/getting-started.md`
- **Part C** — the mandatory satellite `readme-docs/tool-reference.md`
- **Part D** — the `<details>` pattern: where it is allowed and the required markup

---

# Part A — Main `README.md`

## A1. Title + hook

H1 is the project name only. The hook is 2–4 lines: a **bold claim** first, phrased around what the
user can ask or do — never around the implementation.

```markdown
# <Project Name>

**<What it gives the user, as a claim.>** Ask *"<a real question a user would type>"* — get
<the concrete, valuable answer>. <One more sentence with a distinguishing capability: languages,
live data, tolerance to typos — whatever is true and impressive.>
```

Example:

```markdown
# MCP METRO

**Moscow Metro for AI agents.** Ask *"how do I get from Khovrino to Sportivnaya?"* in plain
language — get real route variants with travel times, transfers, car-boarding hints and today's
closures. Works in Russian, English, Arabic and Chinese. Typos welcome.
```

---

## A2. Badges

Prefer shields.io. Include only badges that are meaningful (skip build status if no CI yet).

```markdown
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Server-DA7857)](https://modelcontextprotocol.io/)
[![fa-mcp-sdk](https://img.shields.io/badge/built%20with-fa--mcp--sdk-526CFE)](https://github.com/Bazilio-san/fa-mcp-sdk)
```

---

## A3. Screenshots

Immediately after the badges — the reader must *see* the server working before reading anything
else. Two-column HTML table; captions in `<sub>` under each image. Store the images in
`readme-docs/` so they travel with the satellites.

```markdown
<table>
  <tr>
    <td width="56%" valign="top"><img src="readme-docs/<shot-1>.png" alt="<what it shows, e.g. 'A Telegram bot answers a route question'>"></td>
    <td width="44%" valign="top"><img src="readme-docs/<shot-2>.png" alt="<what it shows, e.g. 'Interactive widget with route variants'>"></td>
  </tr>
  <tr>
    <td><sub><One sentence: what the left image demonstrates.></sub></td>
    <td><sub><One sentence: what the right image demonstrates.></sub></td>
  </tr>
</table>
```

Rules:

- Pick the column widths from the images' aspect ratios so the two images render at roughly the
  same height (a wide chat screenshot next to a tall widget → ~56% / 44%).
- `alt` text describes the content, never "screenshot 1".
- One image is fine too (single full-width `<img>` or a plain Markdown image).
- No images in the project yet → skip the block and tell the user that one or two screenshots
  (a real chat answer + the widget/UI, if any) would noticeably strengthen the page.

---

## A4. What it does

5–8 bullets, each ≤ 2 lines: emoji, **bold benefit**, then the mechanism that makes it true.
No invented superlatives — every strong claim names its mechanism.

```markdown
## What it does

- 🚇 **<Benefit as the user feels it>** — <the concrete capability behind it, with numbers>.
- 🚧 **<Benefit>** — <mechanism, e.g. "closures are applied to the graph *before* the search runs">.
- 🌍 **<Benefit>** — <mechanism>.
- ⚡ **<Benefit>** — <mechanism, e.g. "a disk cache means the server answers within a second of starting">.
- 🔌 **<Benefit>** — <mechanism, e.g. "MCP over STDIO / HTTP / SSE, a REST API with Swagger">.
```

Close the section with the tool-surface one-liner:

```markdown
One tool — `<tool_name>` — answers <the main question(s)>. Full parameter and response reference:
[Tool Reference](./readme-docs/tool-reference.md).
```

(or, for many tools: "N tools across M domains — <one clause on the split>." with the same link.)

---

## A5. Try it in 60 seconds

Install / build / start, one verification command, one closing line naming what is *not* needed.
No open client JSON here — the configs sit collapsed in **Connect your client** at the end of the
page (block A6b); link to that section by anchor.

````markdown
## Try it in 60 seconds

```bash
npm install
npm run build
npm start            # HTTP mode → http://localhost:<PORT>
```

```bash
curl http://localhost:<PORT>/health
```

MCP endpoint: `http://localhost:<PORT>/mcp`. <What is NOT needed: "No database, no API keys, no
credentials — it just runs."> Client configs are one click away:
[Connect your client](#connect-your-client) below.
````

---

## A6. Documentation table

The navigation core of the main README — one row per satellite, one line per row. Every file in
`readme-docs/` must appear here: an unlinked satellite never reaches the `doc://readme` resource.

```markdown
## Documentation

| Topic                                                      | What's inside                                                |
|------------------------------------------------------------|---------------------------------------------------------------|
| [Getting Started](./readme-docs/getting-started.md)        | Install, run, connect MCP clients, transports, build commands |
| [Tool Reference](./readme-docs/tool-reference.md)          | Tool parameters and answers, MCP resources and prompts        |
| [Configuration](./readme-docs/configuration.md)            | Every setting, resolution order, environment variables        |
| [Authentication](./readme-docs/authentication.md)          | Token types, resolution order, issuing tokens                 |
| [Testing](./readme-docs/testing.md)                        | Unit tests, MCP protocol tests, Agent Tester and Headless API |
| [<Feature>](./readme-docs/<feature>.md)                    | <One line>                                                    |
| [Skills](./readme-docs/SKILLS.md)                          | Claude Code skills shipped with the project                   |
```

---

## A6a. The tool, up close (collapsed, end of page)

Sits right after the Documentation table. 1–3 *open* sentences name the tool(s), the actions and
the response format; the reference detail is collapsed. This is a condensed copy of
`tool-reference.md` — keep the two in sync.

**Single tool — no tools table.** The open sentences name the tool; the block holds its parameter
table and answer contents:

````markdown
## The tool, up close

One tool — `<tool_name>`, read-only. `action=<a>` <what it does>; `action=<b>` <what it does>.
<One sentence on response format and language handling.>

<details><summary><b>Parameters and what the answers contain</b></summary><br>

| Parameter | Required | Description                                     |
|-----------|----------|--------------------------------------------------|
| `<param>` | yes/no   | <What it means, defaults, constraints, examples> |

A `<action-a>` answer contains: <the pieces, comma-separated or as short bullets>.

A `<action-b>` answer contains: <the pieces>.

</details>

Full reference, including MCP resources and prompts: [Tool Reference](./readme-docs/tool-reference.md).
````

**Several tools** — the block opens with the grouped tool table instead:

````markdown
## The tools, up close

<N> tools across <M> domains. All names are prefixed with `<prefix>_`.

<details><summary><b>Expand the full tool list</b></summary><br>

### <Domain 1>

| Tool          | Description                                 |
|---------------|----------------------------------------------|
| `<tool_name>` | <Short description, verb-first, ≤ 80 chars>  |

### <Domain 2>

| Tool          | Description        |
|---------------|---------------------|
| `<tool_name>` | <Short description> |

</details>

Per-tool parameters and answers: [Tool Reference](./readme-docs/tool-reference.md).
````

---

## A6b. Connect your client (collapsed, end of page)

One `<details>` block per client; the summary line names the client and its config file. Condensed
copy of the integration section of `getting-started.md` — keep the two in sync. Adapt header names
to the server's actual scheme; when auth is off by default, say the header can be omitted.

````markdown
## Connect your client

<details><summary><b>Claude Code</b> — <code>~/.claude.json</code></summary><br>

```json
{
  "mcpServers": {
    "<name>": {
      "type": "http",
      "url": "http[s]://<host[:port]>/mcp",
      "headers": {
        "Authorization": "Bearer <jwt-token>"
      }
    }
  }
}
```

</details>

<details><summary><b>Claude Desktop</b> — <code>claude_desktop_config.json</code>, STDIO or remote HTTP</summary><br>

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
        "Authorization:Bearer <jwt-token>",
        "--allow-http",
        "--transport",
        "http-only"
      ]
    }
  }
}
```

Important: in `--header` values there must be **no space** after the `:`.
`"Authorization:Bearer abc"` is correct, `"Authorization: Bearer abc"` is not.

</details>

<details><summary><b>Qwen Code</b> — <code>~/.qwen/settings.json</code></summary><br>

<Same `mcp-remote` block as Claude Desktop Option 2, and the same no-space-after-`:` rule.>

</details>

<details><summary><b>OpenCode</b> — <code>opencode.json</code></summary><br>

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "<name>": {
      "type": "remote",
      "url": "http[s]://<host[:port]>/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer <jwt-token>"
      }
    }
  }
}
```

</details>

<details><summary><b>Codex</b> — <code>~/.codex/config.toml</code></summary><br>

```toml
[mcp_servers.<name>]
url = "http[s]://<host[:port]>/mcp"
http_headers = { "Authorization" = "Bearer <jwt-token>" }
```

</details>

Transports, endpoints and STDIO mode: [Getting Started](./readme-docs/getting-started.md).
````

---

## A7. Under the hood

2–4 sentences: language, framework, the key algorithmic or data decisions. This replaces the old
"Stack" bullet list.

```markdown
## Under the hood

TypeScript (ESM) on Node.js ≥ <N>, built on [fa-mcp-sdk](https://github.com/Bazilio-san/fa-mcp-sdk) —
server core, transports, auth, Swagger and Agent Tester come from the SDK. <One sentence on the key
algorithm or data decision, e.g. "Routing is Yen's k-shortest-paths over a weighted graph rebuilt
for the requested moment. Data lives in JSON on disk — no database.">
```

---

## A8. License

```markdown
## License

<License name> © <Owner>. See [LICENSE](./LICENSE).
```

---

# Part B — `readme-docs/getting-started.md`

The *full* version of getting up and running: quick start with verification, client integration,
transports, build & test commands. The main README's **Connect your client** section (A6b) is a
condensed copy — keep them in sync. Opens with a lead (2–4 sentences, the lead rule).

## B1. Lead + Quick Start

````markdown
# Getting Started

From `npm install` to a connected AI client in a few minutes. The server needs <what it does NOT
need: "no database, no API keys and no credentials to start — authentication is off by default">.
This page covers running the server, wiring it into MCP clients (Claude Code, Claude Desktop,
Qwen Code, OpenCode, Codex), the available transports, and the build and test commands.

## Quick Start

```bash
npm install
npm run build
npm start                       # HTTP mode, port <PORT>
```

Verify the server is up:

```bash
curl http://localhost:<PORT>/health
<one more curl that proves the domain data/upstream connection works>
```

For STDIO mode (Claude Desktop spawns the process directly):

```bash
node dist/src/start.js stdio
```
````

## B2. MCP Client Integration

Adapt custom header names (`x-<prefix>-*`) to this server's actual scheme; if the server only uses
the standard `Authorization` header, say so and drop the custom-header rows.

````markdown
## MCP Client Integration

The HTTP MCP endpoint is `http[s]://<host[:port]>/mcp`.

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "<name>": {
      "type": "http",
      "url": "http[s]://<host[:port]>/mcp",
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

Add to `~/.qwen/settings.json` — same `mcp-remote` block as Claude Desktop Option 2.

Important: in `--header` values there must be **no space** after the `:`.
`"Authorization:Bearer abc"` is correct, `"Authorization: Bearer abc"` is not. This applies to both
Claude Desktop Option 2 and Qwen Code.

### OpenCode

Add to `opencode.json` in the project root (or the global OpenCode config); documentation:
https://opencode.ai/docs/en/mcp-servers/

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "<name>": {
      "type": "remote",
      "url": "http[s]://<host[:port]>/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer <jwt-token>"
      }
    }
  }
}
```

### Codex

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.<name>]
url = "http[s]://<host[:port]>/mcp"
http_headers = { "Authorization" = "Bearer <jwt-token>" }
```
````

## B3. Transports + Build & Run

````markdown
## Transports

- **HTTP** — endpoints:
  - `/mcp` — MCP protocol (JSON-RPC 2.0, Streamable HTTP)
  - `/sse` — MCP over Server-Sent Events (legacy transport)
  - `/api/*` — REST API (if present)
  - `/docs` — Swagger UI
  - `/health` — healthcheck
  - `/agent-tester` — Agent Tester web UI and Headless API
- **STDIO** — direct stdin/stdout, no network port; the mode Claude Desktop uses.

Port comes from `config/default.yaml` → `webServer.port` (default `<PORT>`).

## Build & Run

```bash
npm run build        # tsc + copy static assets
npm run cb           # clean dist/ + build
npm start            # HTTP server on webServer.port
npm run typecheck    # tsc --noEmit
```

Tests:

```bash
npm test               # jest unit tests
npm run test:mcp       # MCP protocol tests over STDIO
npm run test:mcp-http  # MCP protocol tests over HTTP (needs a running server)
npm run test:mcp-sse   # MCP protocol tests over SSE (needs a running server)
```

Environment variables:

- `NODE_ENV` — selects the `config/{NODE_ENV}.yaml` overlay.
- `DEBUG` — namespace logging (`DEBUG=mcp:tool` prints every tool request and response).

## Where to go next

- Every setting the server reads: [Configuration](./configuration.md).
- Locking the server down for a public address: [Authentication](./authentication.md).
````

Keep endpoints and commands that actually exist; drop the rest.

---

# Part C — `readme-docs/tool-reference.md`

The *full* tool surface: grouped table, per-tool parameters, answer contents, MCP resources and
prompts. The main README's **The tool, up close** section (A6a) is a condensed copy — keep them in
sync. Opens with a lead naming the tool count and the main question(s) the tools answer.

````markdown
# Tool Reference

<Project> exposes <N> tool(s): <one sentence per major group — what question it answers>. <One
sentence on conventions: read-only or not, response format, language handling.> This page lists
the parameters, what each answer contains, and the MCP resources and prompts published alongside.

## Tools

All tool names are prefixed with `<prefix>_`. <If applicable: "Tools can be selectively enabled
via `<upstream>.usedInstruments` — see [Configuration](./configuration.md)."> 

### <Domain 1>

| Tool          | Description                                 |
|---------------|----------------------------------------------|
| `<tool_name>` | <Short description, verb-first, ≤ 80 chars>  |

### Input parameters — `<tool_name>`

| Parameter | Required | Description                                        |
|-----------|----------|-----------------------------------------------------|
| `<param>` | yes/no   | <What it means, defaults, constraints, examples>    |

### What a `<tool_name>` answer contains

- <the pieces of the response, one bullet each>

## MCP Resources & Prompts

| URI              | MIME            | Description  |
|------------------|-----------------|---------------|
| `<scheme>://<x>` | `text/markdown` | <One line>    |

| Prompt         | Description |
|----------------|--------------|
| `agent_brief`  | <One line>   |
| `agent_prompt` | <One line>   |
````

Formatting rules: tool names always inline-code; column widths consistent within the file; with a
**single tool** skip the one-row tools table — name the tool in the lead and go straight to its
parameters. A tool caveat (e.g. server vs. cloud behaviour) gets a footnote `*` explained below
the table.

---

# Part D — Collapsible `<details>` blocks: where and how

In the **main README** `<details>` appears in exactly two places — the end sections **The tool, up
close** (A6a) and **Connect your client** (A6b). Nowhere else: not around Quick Start, not around
feature bullets, not around screenshots.

Inside **satellites**, use the pattern for genuinely bulky matrices (100+ line tool tables,
exhaustive request/response examples, per-endpoint catalogues) so the file stays scannable:

```markdown
## <Section heading stays outside>

<1–3 sentence intro stays outside too — gives readers enough to decide whether to expand.>

<details><summary>Expand to view <what is inside></summary><br>


<bulky content: tables, code blocks, nested subsections>

</details>
```

The `<br>` immediately after `</summary>` is **mandatory** — without it GitHub collapses the first
child block against the summary line. Keep one blank line before `</details>`.
