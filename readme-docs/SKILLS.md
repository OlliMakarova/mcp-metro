# Skills (Claude Code)

Skills are specialized instructions for Claude Code, located in `.claude/skills/`. They are invoked inside Claude Code
chat — either by a `/command` or automatically by trigger phrases.

## Available Skills

### `/gen-jwt` — JWT Token Generator

Generates JWT tokens for MCP server authentication via `scripts/generate-jwt.js`.

- **Launch**: by command `/gen-jwt` or by trigger phrases ("jwt", "token for user", "токен для", "сгенерируй токен")
- **Interactive**: asks for missing required params (username, TTL), then optional (request ID, IP restriction,
  service name, extra `key=value` pairs)
- **Parameters**:
  - `username` (REQUIRED) — user the token is issued to
  - `ttl` (REQUIRED) — lifetime in format `<N>s | <N>m | <N>d | <N>y`
  - `request` (optional) — ticket/issue ID (e.g. `REQ-123`, `JIRA-456`)
  - `ip` (optional) — allowed IPs / CIDR masks, comma-separated
  - `service` (optional) — service name, passed as `-s <name>` flag
  - any additional `key=value` pairs — appended to the token payload
- **Output**: token string, payload table, saved to `<YYYYMMDD-HHmmss>-jwt.txt` in the project root

**Examples:**

```
/gen-jwt admin 30d
/gen-jwt vpupkin 1y request=REQ-12345 ip=10.0.0.0/24,192.168.1.100
/gen-jwt svc-account 8d service=my-mcp
/gen-jwt sergey на год привязать к заявке REQ-555
```

---

### `/upgrade-guide` — FA-MCP-SDK Upgrade Guide

Generates a migration guide for upgrading the `fa-mcp-sdk` dependency in this project. Analyzes diffs in:

- `config/*.yaml` — new/removed/changed keys and defaults (correlates `default.yaml`, `_local.yaml`, `local.yaml`)
- `cli-template/` — `package.json` (new deps only), `tsconfig.json`, `.oxlintrc.json`, `.oxfmtrc.json`, `CLAUDE.md`, `deploy/`,
  `.claude/skills/`, `.run/` (from `r/`)
- `scripts/` — new or updated SDK utilities (excluding SDK-internal `copy-static.js`, `publish.js`, `scripts/publish-README.md`)
- `dist/core/index.js` — added/removed/renamed exports and breaking type changes
- project `src/` — imports and config keys affected by the upgrade

By default, versions and commit hashes refer to **this project** — the skill resolves them to the pinned SDK version
via `git show <ref>:package.json`. To reference SDK versions/commits directly, mention "SDK" explicitly.

- **Launch**: by command `/upgrade-guide` or by trigger phrases ("обновить sdk", "upgrade sdk", "migration guide",
  "обновление fa-mcp-sdk")
- **Output**: `upgrade-guide-<old>-to-<new>.md` in project root

**Examples:**

```
/upgrade-guide                                               # current SDK -> latest SDK
/upgrade-guide 1.2.3                                         # project version 1.2.3 -> latest SDK
/upgrade-guide 1.2.3 1.2.7                                   # project versions
/upgrade-guide abc1234 def5678                               # project commits
/upgrade-guide from SDK version 0.1.30                       # SDK versions directly -> latest SDK
/upgrade-guide from SDK version 0.1.30 to SDK version 0.5.0  # SDK versions directly
/upgrade-guide from SDK commit abc1234 to SDK commit def5678 # SDK commits directly
/upgrade-guide 1.2.3 1.2.7 in Russian                        # output guide in Russian
/upgrade-guide 1.2.3 1.2.7 на русском                        # same, via Russian phrasing
```

---

### `/feature-prompt-generator` — Feature Prompt Generator

A **META-skill**: turns a feature description into a self-sufficient prompt for an AI CLI (Claude Code or another
agent) to implement the feature turnkey. The skill itself does NOT write feature code — it produces the prompt.

What it does:

- Inspects real code via `Read` / `Grep` / `Glob` — **no guessing**
- Identifies reusable functions, classes, types, and existing npm dependencies (with `file:line` citations)
- Designs the minimal sufficient solution (KISS / YAGNI / DRY), applying multi-role review
  (Architect / Senior dev / QA)
- Drafts a change plan (file → action → what exactly), code examples with TypeScript typing,
  and a testing scenario
- Outputs a Part A brief summary + Part B self-sufficient 15-section prompt ready to hand off to an AI CLI

Characteristics:

- **Launch**: **command-only** via `/feature-prompt-generator`. Has `disable-model-invocation: true` — does NOT activate
  on trigger phrases or implicit mentions
- **Input**: free-form feature description OR path to a file with the description (e.g. `task.md`, ticket dump)
- **Output**: file `prop-<kebab-name>.md` in repository root. If the file already exists, a numeric suffix is
  appended (`-2`, `-3`, …) — the existing file is never overwritten

**Examples:**

```
/feature-prompt-generator Add a tool for batch-processing customer records across a project
/feature-prompt-generator task.md
/feature-prompt-generator REQ-1234: implement webhook callback receiver for external events
/feature-prompt-generator Add OAuth2 token refresh logic to the HTTP client
```

---

### `/readme-generator` — MCP Server README Generator

Generates a structured, user-friendly `README.md` for an `fa-mcp-sdk`-based MCP server and a set
of satellite documents under `readme-docs/`. The main README stays scannable (what is this / what
tools / how to use); reference tables, priority rules, and long technical topics are moved into
`readme-docs/*.md` and linked from the main.

What it does:

- **Inventories** the project: `package.json`, `config/*.yaml`, `src/tools/`, `src/api/`,
  `src/prompts/`, `.claude/skills/`
- **Detects enabled SDK subsystems** (Consul, AD, Database, Admin Panel, Agent Tester, Swagger,
  Cache, Webhooks, Impersonation, JWT, configurable tool set) and project-specific capabilities
- **Classifies each finding** — drop / inline / satellite — and produces the satellite file set
  dynamically. No stubs for disabled features.
- **Always inlines** in the main README: the tool list, Quick Start, MCP Client Integration
  snippets (Claude Code / Desktop / Qwen — adapted to this server's custom header names), and
  Key Features
- **Always uses folder `readme-docs/`** — the SDK's `doc://readme` MCP resource automatically
  inlines every satellite linked from the main README, delivering the full document to the MCP
  registry's RAG index. Any other folder name would be ignored.

Characteristics:

- **Launch**: by command `/readme-generator` or by trigger phrases ("generate readme", "update
  readme", "обнови README", "сгенерируй README для MCP")
- **Input**: none required — reads the current project
- **Output**: `README.md` in project root, `readme-docs/*.md` (one per satellite topic), backup
  of the previous README as `README.backup.md` when rewriting

**Examples:**

```
/readme-generator
/readme-generator refresh the README after adding 3 new tools
/readme-generator обнови README с учётом того, что теперь подключён PostgreSQL
```

---

### `/mcp-app-create` — Scaffold a New MCP App

Comprehensive guidance for building **MCP Apps** — interactive UIs that render inside MCP-enabled hosts (Claude
Desktop, etc.) using the [`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps) SDK.
Every MCP App pairs an MCP **tool** (called by the LLM/host) with an HTML **resource** (the UI shown to the user);
the tool's `_meta.ui.resourceUri` links them.

What it does:

- Clones the upstream `ext-apps` repo into `./mcp-ext-apps/` (added to `.gitignore`) for working examples,
  JSDoc-annotated source, and the formal protocol spec (`specification/2026-01-26/apps.mdx`, SEP-1865)
- Walks through framework selection — React (with `useApp` hook), Vanilla JS, Vue, Svelte, Preact, Solid —
  using the matching `basic-server-{framework}/` template as a reference
- Sets up the build pipeline: `vite` + `vite-plugin-singlefile` to bundle UI into a single HTML file, plus
  `tsx` for running the TypeScript server (broader compatibility than `bun`)
- Generates `registerAppTool` + `registerAppResource` calls with the correct `_meta.ui.resourceUri` linking
- Implements lifecycle handlers (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`)
  — emphasising they MUST be registered BEFORE `app.connect()`
- Covers advanced patterns (`docs/patterns.md`): app-only tools, polling, chunked responses, binary resources,
  CSP/CORS, host context (theme/styles/fonts), fullscreen mode, streaming input, view state, visibility-pause

Characteristics:

- **Launch**: by command `/mcp-app-create` or by trigger phrases ("create an MCP App", "add a UI to an MCP tool",
  "build an interactive MCP View", "scaffold an MCP App")
- **Input**: project context (existing server vs new server) + UI requirements
- **Output**: working tool + resource pair, single-file HTML bundle, framework-specific entry point with
  registered handlers, `vite.config.ts`, updated `package.json` scripts

**Examples:**

```
/mcp-app-create
/mcp-app-create create an MCP App that shows search results as an interactive table (React)
/mcp-app-create scaffold a new MCP server with a map UI tool, vanilla JS
/mcp-app-create build a system-monitor App with a polling chart, use Vue
```

---

### `/mcp-app-add-to-server` — Add Interactive UI to Existing MCP Server

Analyses the tools already exposed by an existing MCP server and enriches the ones that benefit from UI with
inline rendering via the MCP Apps SDK. Tools that don't need UI stay untouched; the text fallback is preserved
for text-only clients, so adding UI is a strict enhancement.

What it does:

- **Inventories** the server's existing tools (reads source, lists every registered tool)
- **Classifies** each tool by UI benefit using a decision framework: structured data / metrics over time /
  media → high benefit; simple confirmations → text-only is fine; data feeds for other tools → app-only helper
- **Confirms** the analysis with the user before writing code
- Adds `@modelcontextprotocol/ext-apps` + `vite` + `vite-plugin-singlefile` (plus framework deps if needed)
  via `npm install` — never hardcoded versions
- Configures the build pipeline (`vite.config.ts`, `mcp-app.html` entry, `package.json` scripts: `build:ui`,
  `build:server`, `build`, `serve`) and links resources to tools via `_meta.ui.resourceUri`
- Converts plain `server.tool(...)` calls to `registerAppTool(...)` with `structuredContent` for the UI
  while keeping the `content` array as a text fallback
- Registers HTML resources via `registerAppResource(...)` reading the bundled `dist/mcp-app.html`
- Wires UI lifecycle handlers + applies host styling (`applyDocumentTheme`, `applyHostStyleVariables`,
  `applyHostFonts`, safe-area insets)
- Optional enhancements: app-only helper tools (`visibility: ["app"]`), CSP/CORS allow-lists
  (`connectDomains` / `resourceDomains` / `frameDomains`), streaming partial input (`ontoolinputpartial`),
  fullscreen mode (`requestDisplayMode`), graceful degradation via `getUiCapability()`

Characteristics:

- **Launch**: by command `/mcp-app-add-to-server` or by trigger phrases ("add an app to my MCP server",
  "add UI to my MCP server", "add a view to my MCP tool", "enrich MCP tools with UI", "add MCP Apps to
  my server")
- **Input**: none required — reads the project; user confirms which tools to enhance after the analysis
- **Output**: refactored `server.ts` (App tools + plain tools coexist), HTML entry + `vite.config.ts`,
  resource registration code, lifecycle handlers in the UI entry, updated `package.json` scripts

**Examples:**

```
/mcp-app-add-to-server
/mcp-app-add-to-server add UI to the search and analytics tools, leave the lookup tools as text-only
/mcp-app-add-to-server обогати UI инструмент get_dashboard, остальные оставь без изменений
/mcp-app-add-to-server add an interactive map view to the geo-search tool
```

---

### `/create-mcp-wizard` — End-to-End MCP Server Implementation

Orchestrates the full implementation workflow from feature brief to a live GitLab repo. The project
must already be scaffolded by the `fa-mcp` CLI — this skill picks up from `yarn install` onwards.

Pipeline (10 steps):

1. **Requirements scan** — extracts tools, source-of-truth refs, exclusions, and OpenAI creds from
   accompanying messages/files
2. **OpenAI pre-flight** — `scripts/check-openai.js` validates the key against `GET /v1/models`
   before anything touches `config/local.yaml`
3. **Dev secrets** — `scripts/gen-secrets.js` writes fresh `jwtToken.encryptKey`,
   `permanentServerTokens`, OpenAI creds, and lenient dev defaults into `config/local.yaml`
4. **Install & build** — `yarn install` + `yarn cb`
5. **First GitLab push** — ensures branch is clean (stashing what shouldn't ship), commits the
   scaffold, then either creates a new GitLab repo via `scripts/gitlab-push.js` OR pushes to an
   existing remote when instructed (text says "don't create" / `origin` is already configured)
6. **Plan** — writes `claudedocs/impl-plan.md` with tools / resources / prompts / REST / config /
   tests / Agent Tester scenarios / sign-off checklist
7. **Implementation** — edits `src/tools/*`, `src/prompts/*`, `src/custom-resources.ts`,
   `src/api/router.ts`, `config/default.yaml`, `tests/mcp/test-cases.js`; rebuilds after each change
8. **Agent Tester loop** — `yarn check-llm` → `yarn start` → `scripts/headless-test.js` /
   `scripts/headless-chat.js` against `/agent-tester/api/chat/test`; logs in `claudedocs/test-log.md`
9. **Quality gates** — `yarn lint:fix`, `yarn typecheck`, `yarn cb`, `yarn test:mcp[-http|-sse]`
10. **Second GitLab push** — commits implemented feature and `git push origin main` to the remote
    set up in step 5 (no re-creation, never `--force` without explicit approval)

Characteristics:

- **Launch**: **command-only** via `/create-mcp-wizard`. `disable-model-invocation: true` — does NOT
  trigger on implicit mentions
- **Input**: feature brief comes from the accompanying user message(s) and attached files. OpenAI
  and GitLab creds may be supplied inline or asked interactively
- **Ground rules**: every step explicit and verified; free-form inputs asked in plain prose (never
  predefined options); exclusions from the brief honoured; dev defaults intentionally lenient;
  `.claude/`, `deploy/`, `FA-MCP-SDK-DOC/` are NOT modified unless the brief explicitly says to
- **Reporting language**: all generated artifacts (`claudedocs/*.md`, commit messages, user-facing
  summaries) are written in a language resolved in this order: (1) explicit directive in the
  feature brief, else (2) contents of `preferred-language.txt` in the project root, else
  (3) English. Prose (headings + body) is translated; code, paths, YAML keys, and CLI commands
  stay as-is
- **Output**: implemented project + `claudedocs/{impl-plan,test-log,dev-report}.md`, GitLab repo
  with two commits on `main` (scaffold + feature)

**Examples:**

```
/create-mcp-wizard
/create-mcp-wizard реализуй инструменты из task.md, OpenAI key sk-..., GitLab group mcp-servers
/create-mcp-wizard implement tools from the message; repo уже существует, push to git@gitlab.example:ai/mcp-foo.git
```
