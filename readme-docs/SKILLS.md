# Skills (Claude Code)

Skills are specialized instructions for Claude Code, located in `.claude/skills/`. They are invoked inside Claude Code
chat — either by a `/command` or automatically by trigger phrases. Skills marked **command-only** carry
`disable-model-invocation: true` and never activate on their own.

## Available Skills

| Command                        | Launch        | Purpose                                                        |
|--------------------------------|---------------|----------------------------------------------------------------|
| `/gen-jwt`                     | command or trigger | Issue a JWT for MCP server authentication                 |
| `/deploy-mcp-to-remote-server` | command-only  | Deploy, stop, restart, update, diagnose on a remote host        |
| `/upgrade-sdk`                 | command-only  | Upgrade `fa-mcp-sdk` end-to-end                                |
| `/change-log`                  | command-only  | Write the next CHANGELOG.md entry                              |
| `/readme-generator`            | command or trigger | Regenerate README.md and its `readme-docs/` satellites    |
| `/feature-prompt-generator`    | command-only  | Turn a feature description into a turnkey prompt               |
| `/create-mcp-wizard`           | command-only  | Implement an MCP server end-to-end                             |
| `/mcp-app-create`              | command or trigger | Scaffold a new MCP App (tool + UI resource)               |
| `/mcp-app-add-to-server`       | command or trigger | Add interactive UI to existing tools                      |
| `/edit-claude-files`           | command or trigger | The required protocol for editing anything under `.claude/` |

---

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

```text
/gen-jwt admin 30d
/gen-jwt vpupkin 1y request=REQ-12345 ip=10.0.0.0/24,192.168.1.100
/gen-jwt svc-account 8d service=mcp-metro
/gen-jwt sergey на год привязать к заявке REQ-555
```

See [Authentication](./authentication.md) for what the token is checked against.

---

### `/deploy-mcp-to-remote-server` — Remote Deployment and Operations

Runs the whole production lifecycle of this server on a remote host: a self-contained systemd Docker container behind a
reverse proxy (Caddy or nginx), with an in-container updater that rebuilds from the tracked branch once a minute. The
skill is project-agnostic — the service name comes from `package.json`, the Node version from `.envrc`, everything else
from its own `config/` files.

Everything runs through one orchestrator, `scripts/remote.cjs`, invoked with a subcommand:

| Intent                        | Subcommand        |
|-------------------------------|-------------------|
| Create a read-only deploy key | `keygen`          |
| Deploy / roll out             | `deploy`          |
| Status and diagnostics        | `status`          |
| Stop / start the container    | `stop` / `start`  |
| Restart the app only          | `restart`         |
| Apply a config change         | `push-config`     |
| Force an immediate update     | `update`          |
| App logs                      | `logs [N]`        |
| First-boot (clone/build) logs | `bootlog [N]`     |
| Update verdicts and errors    | `updatelog [N]`   |
| Shell or a command inside     | `shell`, `exec`   |
| Remove from the server        | `uninstall --yes` |

Characteristics:

- **Launch**: **command-only** via `/deploy-mcp-to-remote-server`, or by intent phrases the skill lists (deploy, stop,
  restart, update, diagnose the server)
- **Input**: three config files under the skill's `config/` folder — connection parameters, the app's `local.yaml`, and
  the container's `config.yml`. Each has an `*.example.*` template; the real files are gitignored and hold secrets
- **Ground rules**: never hand-craft SSH or Docker commands — the orchestrator encapsulates them; report exactly what
  the script printed rather than inventing results; a first boot that is still building is not a failure
- **Output**: a running container, a wired reverse-proxy vhost, and the printed diagnostics

**Examples:**

```text
/deploy-mcp-to-remote-server
/deploy-mcp-to-remote-server статус
/deploy-mcp-to-remote-server залей новый local.yaml на сервер и перезапусти
/deploy-mcp-to-remote-server logs 500
```

`push-config` is the fast path for a settings-only change: it copies the skill's `local.yaml` and
`config.yml` into the running container and restarts the app service, without a rebuild or any git
operation.

Full picture of what gets built and where: [Deployment](./deployment.md).

---

### `/upgrade-sdk` — FA-MCP-SDK Upgrader

Performs an end-to-end upgrade of the `fa-mcp-sdk` dependency: analyzes the diff between two versions, presents an
execution plan, waits for confirmation, then applies the changes — dependencies, configs and code — asking inline for
any value or choice it needs.

Pipeline (10 steps): parse arguments, validate the references, preflight safety checks on the branch and working tree,
install the target SDK, analyze the diff, categorize every change, present the plan and **block for confirmation**,
execute, verify (build, lint, typecheck, tests, clean startup), report.

What the diff analysis covers:

- `config/*.yaml` — new, removed and changed keys and defaults
- `cli-template/` — `package.json` (new dependencies only), `tsconfig.json`, linter and formatter configs, `deploy/`,
  `.claude/skills/`, `.run/`
- `scripts/` — new or updated SDK utilities
- the SDK's exported surface — added, removed and renamed exports, breaking type changes
- the project's own `src/` — imports and config keys the upgrade affects

Every change is categorized as **Auto** (applied silently), **Needs-Input** (applied after asking the user),
**Optional** (proposed per item), or **Manual** (genuinely impossible from the session, such as a production secret).

Characteristics:

- **Launch**: **command-only** via `/upgrade-sdk`
- **Input**: optional `from` and `to` versions or commits, plus an optional language hint. References default to **this
  project's** versions and are resolved to the pinned SDK version; say "SDK" explicitly to reference SDK versions
  directly
- **Output**: the upgraded project plus a report at `claudedocs/upgrade-sdk-<FROM>-to-<TO>.md`

**Examples:**

```text
/upgrade-sdk
/upgrade-sdk 0.12.54 0.13.0
/upgrade-sdk from SDK version 0.11.0 to SDK version 0.12.54
/upgrade-sdk на русском
```

---

### `/change-log` — CHANGELOG Generator

Writes the next `CHANGELOG.md` entry, covering changes between the last version recorded in the file and either the
current `package.json` version or an explicitly supplied target version. Only substantial changes make it in; cosmetic
edits, formatting passes and internal tooling churn are filtered out.

The file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) with sections `Breaking`, `Added`, `Changed`,
`Deprecated`, `Removed`, `Fixed`, `Security`. `Breaking` is project-specific and takes precedence over the rest, and it
matches the versioning policy in the public contract: removing a tool or an endpoint, or adding a required schema field,
is MAJOR; adding a tool or an optional field is MINOR.

Characteristics:

- **Launch**: **command-only** via `/change-log`
- **Input**: optional target version as `X.Y.Z`. Without it, the target is the `package.json` version; the starting
  point is always the newest version heading already in `CHANGELOG.md`. When the two match, the skill stops and says the
  file is already up to date
- **Output**: a new version section prepended to `CHANGELOG.md`

**Examples:**

```text
/change-log
/change-log 0.2.0
```

---

### `/readme-generator` — MCP Server README Generator

Generates a structured, user-friendly `README.md` for an `fa-mcp-sdk`-based MCP server and a set of satellite documents
under `readme-docs/`. The main README stays scannable (what is this / what tools / how to use); reference tables,
priority rules and long technical topics move into `readme-docs/*.md` and are linked from the main file.

What it does:

- **Inventories** the project: `package.json`, `config/*.yaml`, `src/tools/`, `src/api/`, `src/prompts/`,
  `.claude/skills/`
- **Detects enabled SDK subsystems** (Consul, Active Directory, database, admin panel, Agent Tester, Swagger, cache,
  webhooks, impersonation, JWT, configurable tool sets) and project-specific capabilities
- **Classifies each finding** — drop / inline / satellite — and produces the satellite set dynamically. No stubs for
  disabled features
- **Always inlines** in the main README: the tool list, Quick Start, the client-integration snippets (Claude Code,
  Claude Desktop, Qwen Code, Codex — adapted to this server's actual headers), and Key Features
- **Always uses the folder `readme-docs/`** — the SDK's `doc://readme` MCP resource inlines every satellite linked from
  the main README, delivering the whole document to the MCP registry's RAG index. Any other folder name is ignored

Characteristics:

- **Launch**: by command `/readme-generator` or by trigger phrases ("generate readme", "update readme", "обнови README")
- **Input**: none required — reads the current project
- **Output**: `README.md`, `readme-docs/*.md` (one per satellite topic), and `README.backup.md` when rewriting

**Examples:**

```text
/readme-generator
/readme-generator refresh the README after adding 3 new tools
/readme-generator обнови README с учётом того, что теперь подключён PostgreSQL
```

---

### `/feature-prompt-generator` — Feature Prompt Generator

A **META-skill**: turns a feature description into a self-sufficient prompt for an AI CLI (Claude Code or another agent)
to implement the feature turnkey. The skill itself does NOT write feature code — it produces the prompt.

What it does:

- Inspects real code via `Read` / `Grep` / `Glob` — **no guessing**
- Identifies reusable functions, classes, types and existing npm dependencies (with `file:line` citations)
- Designs the minimal sufficient solution (KISS / YAGNI / DRY), applying multi-role review
  (Architect / Senior dev / QA)
- Drafts a change plan (file → action → what exactly), code examples with TypeScript typing, and a testing scenario
- Outputs a Part A brief summary plus a Part B self-sufficient 15-section prompt ready to hand off

Characteristics:

- **Launch**: **command-only** via `/feature-prompt-generator`
- **Input**: free-form feature description OR a path to a file with the description (`task.md`, a ticket dump)
- **Output**: `prop-<kebab-name>.md` in the repository root. An existing file is never overwritten — a numeric suffix is
  appended instead

**Examples:**

```text
/feature-prompt-generator Add a tool that returns the fare and ticket options for a route
/feature-prompt-generator task.md
/feature-prompt-generator Wire in the St. Petersburg metro dataset behind the existing city parameter
```

---

### `/create-mcp-wizard` — End-to-End MCP Server Implementation

Orchestrates the full implementation workflow from feature brief to a live GitLab repo. The project must already be
scaffolded by the `fa-mcp` CLI — this skill picks up from `yarn install` onwards.

Pipeline (10 steps):

1. **Requirements scan** — extracts tools, source-of-truth references, exclusions and OpenAI credentials from the
   accompanying messages and files
2. **OpenAI pre-flight** — validates the key against `GET /v1/models` before anything touches `config/local.yaml`
3. **Dev secrets** — writes fresh `jwtToken.encryptKey`, permanent tokens, OpenAI credentials and lenient dev defaults
4. **Install and build** — `yarn install` plus a clean build
5. **First GitLab push** — cleans the branch, commits the scaffold, then creates a repo or pushes to an existing remote
6. **Plan** — writes `claudedocs/impl-plan.md` with tools, resources, prompts, REST, config, tests and sign-off
   checklist
7. **Implementation** — edits tools, prompts, resources, the REST router, config and test cases, rebuilding as it goes
8. **Agent Tester loop** — `check-llm`, start, then headless test scripts against `/agent-tester/api/chat/test`, logging
   into `claudedocs/test-log.md`
9. **Quality gates** — lint, typecheck, clean build, MCP tests on all transports
10. **Second GitLab push** — commits the implemented feature to the remote set up in step 5

Characteristics:

- **Launch**: **command-only** via `/create-mcp-wizard`
- **Input**: the feature brief from the accompanying messages and files; credentials inline or asked interactively
- **Ground rules**: every step explicit and verified; exclusions from the brief honoured; `.claude/`, `deploy/` and
  `FA-MCP-SDK-DOC/` untouched unless the brief says otherwise
- **Reporting language**: an explicit directive in the brief wins, then `preferred-language.txt` in the project root,
  then English. Prose is translated; code, paths, YAML keys and commands stay as-is
- **Output**: the implemented project plus `claudedocs/{impl-plan,test-log,dev-report}.md`

**Examples:**

```text
/create-mcp-wizard
/create-mcp-wizard реализуй инструменты из task.md, OpenAI key sk-..., GitLab group mcp-servers
/create-mcp-wizard implement tools from the message; repo already exists, push to git@gitlab.example:ai/mcp-foo.git
```

---

### `/mcp-app-create` — Scaffold a New MCP App

Guidance for building **MCP Apps** — interactive UIs that render inside MCP-enabled hosts using the
[`@modelcontextprotocol/ext-apps`](https://github.com/modelcontextprotocol/ext-apps) SDK. Every MCP App pairs an MCP
**tool** (called by the model) with an HTML **resource** (the UI the user sees); `_meta.ui.resourceUri` links them — the
same pattern the route widget of this project uses.

What it does:

- Clones the upstream `ext-apps` repository into `./mcp-ext-apps/` (gitignored) for working examples, annotated sources
  and the formal protocol specification (SEP-1865)
- Walks through framework selection — React (with the `useApp` hook), vanilla JS, Vue, Svelte, Preact, Solid — using the
  matching template as a reference
- Sets up the build pipeline: `vite` plus `vite-plugin-singlefile` to bundle the UI into one HTML file, and `tsx` for
  running the TypeScript server
- Generates the tool and resource registration with correct `_meta.ui.resourceUri` linking
- Implements the lifecycle handlers (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`), stressing
  that they MUST be registered before `app.connect()`
- Covers the advanced patterns: app-only tools, polling, chunked responses, binary resources, CSP and CORS, host context
  (theme, styles, fonts), fullscreen mode, streaming input, view state, visibility pause

Characteristics:

- **Launch**: by command `/mcp-app-create` or by trigger phrases ("create an MCP App", "add a UI to an MCP tool")
- **Input**: project context (existing versus new server) plus the UI requirements
- **Output**: a working tool and resource pair, a single-file HTML bundle, a framework-specific entry point with
  registered handlers, `vite.config.ts`, updated `package.json` scripts

**Examples:**

```text
/mcp-app-create
/mcp-app-create create an MCP App that shows search results as an interactive table (React)
/mcp-app-create build a system-monitor App with a polling chart, use Vue
```

---

### `/mcp-app-add-to-server` — Add Interactive UI to Existing MCP Server

Analyses the tools an existing MCP server already exposes and enriches the ones that benefit from UI with inline
rendering. Tools that do not need UI stay untouched and the text fallback is preserved, so adding UI is a strict
enhancement.

What it does:

- **Inventories** the server's existing tools by reading the source
- **Classifies** each tool by UI benefit: structured data, metrics over time and media score high; simple confirmations
  stay text-only; pure data feeds become app-only helpers
- **Confirms** the analysis with the user before writing code
- Installs `@modelcontextprotocol/ext-apps`, `vite` and `vite-plugin-singlefile` (plus framework dependencies) without
  hardcoding versions
- Configures the build pipeline and links resources to tools via `_meta.ui.resourceUri`
- Converts plain tool registrations into App tools with `structuredContent` for the UI while keeping `content` as the
  text fallback
- Wires the UI lifecycle handlers and applies host styling (theme, style variables, fonts, safe-area insets)
- Optional extras: app-only helper tools, CSP and CORS allow-lists, streaming partial input, fullscreen mode, graceful
  degradation when the host advertises no UI capability

Characteristics:

- **Launch**: by command `/mcp-app-add-to-server` or by trigger phrases ("add UI to my MCP server", "add a view to my
  MCP tool")
- **Input**: none required — reads the project; the user confirms which tools to enhance after the analysis
- **Output**: refactored tool registrations, an HTML entry point and `vite.config.ts`, resource registration, lifecycle
  handlers, updated `package.json` scripts

**Examples:**

```text
/mcp-app-add-to-server
/mcp-app-add-to-server add UI to the search tool, leave the lookup tools as text-only
/mcp-app-add-to-server обогати UI инструмент get_dashboard, остальные оставь без изменений
```

---

### `/edit-claude-files` — Protocol for Editing `.claude/`

Not a generator — a mandatory protocol. `settings.json` denies the `Write` and `Edit` tools on `.claude/**` outright, so
a direct edit fails the permission check by design. That covers **every** file under the folder: `SKILL.md` files,
scripts, hooks, agents, reference files and `settings.json` itself, because Claude Code watches the whole tree and
reloads on change — a direct write risks a partial read and inconsistent state mid-session.

The required workflow, every file, every time:

```bash
# 1. copy out to a temp file outside .claude/
node scripts/fcp.js tmp-edit.md .claude/skills/<skill-name>/SKILL.md

# 2. make ALL edits in the temp file

# 3. save back atomically (same command, arguments reversed)
node scripts/fcp.js .claude/skills/<skill-name>/SKILL.md tmp-edit.md

# 4. remove the temp file
rm tmp-edit.md
```

Creating a new file works the same way — write it outside `.claude/` first, then copy it in.

Characteristics:

- **Launch**: by command `/edit-claude-files`, or automatically whenever a target path starts with `.claude/`
- **Input**: the file to change and the changes themselves
- **Output**: the updated file inside `.claude/`, with no temp files left behind
