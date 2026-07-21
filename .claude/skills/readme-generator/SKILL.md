---
name: readme-generator
description: Generates structured, user-friendly README.md for MCP servers built with fa-mcp-sdk. Detects which SDK subsystems are enabled (Consul, AD, DB, Admin Panel, Agent Tester, Webhooks, etc.) and which project-specific features exist, then decides which sections to inline vs. move to satellite readme-docs/*.md files. Use when creating or refreshing README for an fa-mcp-sdk-based MCP server project.
---

# MCP Server README Generator

Generates a `README.md` tailored to MCP servers built on `fa-mcp-sdk`. The README answers three
progressive questions — *what is this?*, *how do I use it?*, *how do I operate it?* — without
drowning casual readers in operational detail.

## Philosophy

Three-level information hierarchy:

**Level 1 — What & how to use it (first 30 seconds for the consumer)**

- What this MCP server is for
- What tools it exposes
- How to connect from Claude Code / Claude Desktop / Qwen Code (the simplest path)

**Level 2 — Features & basics (interested reader)**

- Enabled fa-mcp-sdk subsystems, project-specific capabilities, transports, essential config

**Level 3 — Operations (deployer / maintainer)**

- Build & run, full configuration, deep technical topics

Level 1 and 2 live in the main README. Level 3 content longer than ~15 lines moves to satellite
Markdown files under `readme-docs/`. The main README stays scannable; deep detail is one click away.

### Scannability devices: Quick Links + collapsible blocks

Two devices keep the main README scannable even when it carries substantial inline content:

- **Quick Links** — a short navigation block right after the badges, pointing to the *major* sections
  a reader is likely to jump to. Include only headline topics (Tools, Quick Start, MCP Client
  Integration, Key Features, Configuration, Build & Run, Authentication, and any enabled feature
  sections that have their own heading — Impersonation, Admin Panel, Webhooks, Agent Tester, Skills,
  etc.). Do **not** dump a full TOC: secondary headings such as Overview, Transports, Stack, License
  stay out; minor sub-subsections stay out. Rule of thumb: 8–14 links, never more.
- **Collapsible `<details>` blocks** — wrap content that *must* appear inline (so the `doc://readme`
  RAG pipeline picks it up as part of the main document) but whose volume would drown neighbouring
  sections on a casual scroll. The canonical case is the grouped Tools table (often 100+ rows across
  a dozen sub-tables). Use `<details>` when all three hold: (1) content belongs in this section,
  (2) it is long enough to push everything below off-screen, (3) a casual reader doesn't need every
  row right away. Do **not** use `<details>` for content readers need at a glance (Quick Start
  commands, Key Features bullets, the compact Configuration Basics table, Integration snippets).
  See `reference/templates.md` for the required markup (the `<br>` after `</summary>` is mandatory —
  GitHub won't render the first child block correctly without it).

## The `readme-docs/` folder is load-bearing

Satellite Markdown files **must** live in `readme-docs/` at the project root. The fa-mcp-sdk
`doc://readme` MCP resource looks for exactly that folder name: on server start it reads
`README.md`, finds every link pointing into `readme-docs/`, appends those satellite files (each
separated by `\n\n---\n\n`) and rewrites the in-text links to `See "<heading>" below` so the
assembled document reads naturally.

This means:

- The entire documentation is delivered through `doc://readme` as one searchable markdown
  document — essential for the MCP registry's RAG indexing.
- Any satellite file *not* linked from `README.md` is **not** included in the resource. If you
  add a new `readme-docs/*.md` file, link to it from the main README.
- Do not rename the folder. Any other name (`docs/`, `doc/`, `readme-parts/` etc.) will be
  ignored by the SDK and the satellite content will not reach RAG.

## Dynamic detection is mandatory

The set of satellite files is **not fixed**. The skill inventories the project, decides per feature
whether it is enabled, and only then produces the matching README sections and `readme-docs/*.md` files.
**Do not create a satellite file for a disabled feature.** Do not emit empty sections.

## Workflow

### Step 1 — Inventory the project

Collect, from the actual repository:

**Metadata**

- `package.json` → `name`, `version`, `description`, `dependencies`
- Git remote URL, license file

**Configuration** (merge `config/default.yaml` with `config/local.yaml` if present)

- `webServer.port` — default port for Quick Start commands
- Custom per-request header names (grep `x-<prefix>-` in `src/`)
- Enabled/disabled status for each optional subsystem (see table below)

**Code surface**

- `src/tools/` — tool list + each tool's domain group
- `src/start.ts` — transports registered, custom auth validators
- `src/api/` — existence + routes (custom REST API)
- `src/prompts/` — existence + prompt list
- `src/custom-resources.ts` — existence
- `.claude/skills/*/SKILL.md` — catalog of in-project skills

**Optional fa-mcp-sdk subsystems — detect each**

| Subsystem                        | Detect via                                           | Enabled marker          |
|----------------------------------|------------------------------------------------------|-------------------------|
| Consul (service discovery)       | `consul.service.enable`                              | `true`                  |
| Active Directory (group checks)  | `ad.domains.*`                                       | non-empty               |
| PostgreSQL (with pgvector)       | `db.*` + imports from `pg-db.js`                     | both present            |
| Custom REST API                  | `src/api/` + `webServer.customApi.*`                 | folder non-empty        |
| Prompts                          | `src/prompts/`                                       | folder non-empty        |
| Custom Resources                 | `src/custom-resources.ts`                            | file exists             |
| Admin Panel (token UI)           | `adminPanel.enabled`                                 | `true`                  |
| Agent Tester + Headless API      | `agentTester.enabled`                                | `true`                  |
| Swagger UI                       | `swagger.enabled`                                    | `true`                  |
| Cache (node-cache)               | `cache.*` referenced in `src/`                       | used                    |
| Webhook callback (`x-web-hook`)  | `x-web-hook` in `src/` OR tool handler returns `hook` | used                   |
| Impersonation (`x-on-behalf-of-user`) | `impersonalizationPlugin.*` in config          | present                 |
| JWT auth                         | `webServer.auth.jwt.*` or `webServer.genJwtApiEnable` | present/true           |
| Configurable tool set            | `<upstream>.usedInstruments`                         | present                 |

**Project-specific capabilities** — anything non-trivial not covered above:

- Fuzzy entity resolution, batch-operation limits, per-endpoint caching strategy,
  API-version auto-detection (Cloud vs Server), automatic labeling of created entities,
  required-fields pre-flight validation, content-format conversion (Markdown ↔ ADF / Storage
  Format), etc.
- Any tool-group-specific quirks worth highlighting.

Record all findings in a working note — they drive the decisions in the next step.

### Step 2 — Classify findings: drop / inline / satellite

For each finding, pick placement:

- **Drop** — feature not used; no section, no satellite file.
- **Inline** — description ≤ ~15 lines. Put a short subsection in the main README.
- **Satellite** — description > ~15 lines, OR the topic contains reference tables, priority rules,
  request/response schemas, long examples. Create `readme-docs/<kebab-name>.md` and link to it from the
  main README with a 2–3 sentence summary.

**Always satellite** (do not inline even if short):

- Authentication resolution order / priority tables
- Webhook body schema + per-tool hook priority rules
- Headless Agent Tester full argument list and scenario matrix
- Full configuration reference tables (> 15 parameters)
- Consul / AD / Database detailed setup

**Always inline in the main README** (never moved out):

- Tool list (grouped table) — users need to see the API surface
- Quick Start commands
- **MCP Client Integration** JSON snippets (Claude Code / Desktop / Qwen Code) — adapted to this
  server's actual custom header names
- Key Features bullet list

### Step 3 — Build main README section list

Canonical section order. Include only sections backed by actual findings; omit anything empty.

1. **Title + one-line description** (from `package.json`)
2. **Badges** — build, license, language, key stack badges via shields.io
3. **Quick Links** — 8–14 anchor links to the major sections only (see *Scannability devices*
   above for the inclusion rule and `reference/templates.md` for the canonical block)
4. **Overview** — 2–4 sentences. Answers: what is this, for whom, core value
5. **Tools** — grouped table, `## Tools (<count>)` with per-domain `###` subsections.
   Wrap the whole tool-group listing in a `<details>` block (see the *collapsible blocks* rule
   above). The `## Tools (<count>)` heading itself stays *outside* the block so it is visible on
   scroll and anchor-linkable from Quick Links
6. **Quick Start** — install, run, minimal verification (3 short steps)
7. **MCP Client Integration** — Claude Code (HTTP), Claude Desktop (STDIO + `mcp-remote` /
   direct STDIO), Qwen Code. Use the server's actual custom header names
   (e.g. `x-jira-token`, `x-wiki-username`)
8. **Key Features** — 5–8 bullets. Include enabled SDK subsystems and project-specific capabilities
9. **Transports** — short bulleted list with endpoints (`/mcp`, `/api/*`, `/docs`, `/health`,
   `/admin`, `/agent-tester`, STDIO for Claude Desktop)
10. **Configuration Basics** — 5–10 most important keys in a compact table; link to
    `readme-docs/configuration.md` when the full reference is long
11. **Build & Run / Deployment** — minimal commands, environment variables
12. **Authentication** — 2–4 sentences + link to `readme-docs/authentication.md` (satellite is mandatory
    when non-trivial auth is present)
13. **Feature sections (dynamic)** — one short subsection per enabled optional subsystem and per
    notable project-specific capability. Each: 2–3 sentences + link to its `readme-docs/*.md` when a
    satellite is warranted. Typical candidates:
    - Consul service discovery → `readme-docs/consul.md`
    - Active Directory integration → `readme-docs/active-directory.md`
    - PostgreSQL / pgvector → `readme-docs/database.md`
    - Custom REST API → link to Swagger UI (`/docs`) and/or `readme-docs/api.md`
    - Admin panel → inline or `readme-docs/admin-panel.md`
    - Agent Tester + Headless API → `readme-docs/testing.md`
    - Webhook callback → `readme-docs/webhooks.md`
    - Impersonation → `readme-docs/impersonation.md`
    - Project-specific: fuzzy resolution, caching strategy, API version detection, batch limits,
      content-format conversion, etc. → `readme-docs/<topic>.md` as appropriate

   Anchor rule: any feature section that is referenced from **Quick Links** must live at `##` level
   (not `###`), so the anchor resolves from the top of the document.
14. **Skills** — short paragraph linking to `readme-docs/SKILLS.md` (kept under `readme-docs/`
    so it is picked up as a satellite and assembled into the `doc://readme` resource)
15. **Stack** — 4–7 bullets: framework (`fa-mcp-sdk`), transport, language, key libs
16. **License**

### Step 4 — Generate `README.md`

Apply the canonical section order from Step 3. Respect these rules:

- H1 is the project name only — no duplicate title in the next line.
- Tool table column widths consistent within the file. Tool names as inline code.
- Every code fence has a language specifier (` ```bash `, ` ```json `, ` ```yaml `, ` ```typescript `).
- `webServer.port` in commands matches the actual value from `config/default.yaml`.
- Custom header names in Client Integration snippets match what the server actually reads.
- Relative links for internal references: `[…](./readme-docs/authentication.md)`.
- Line length ≤ 120 chars where practical. Exceptions: URLs, code blocks, tables.
- No marketing superlatives. Active voice. Short paragraphs (2–4 sentences).

See `reference/templates.md` for canonical blocks.

### Step 5 — Generate satellite `readme-docs/*.md` files

For each finding classified as *satellite* in Step 2, create a Markdown file under `readme-docs/` (create
the folder if missing). Use `reference/satellite-templates.md` as a starting point — skeletons are
provided for common topics (authentication, testing, webhooks, consul, active-directory, database,
configuration). **Adapt every skeleton to actual values from the project.**

For project-specific capabilities (fuzzy resolution, custom endpoints, etc.) compose a new
`readme-docs/<kebab-name>.md` with sections: *Overview*, *How it works*, *Configuration*, *Examples*.

Every satellite MD begins with a 1-sentence summary so it stands alone when opened directly.

### Step 6 — Update `readme-docs/SKILLS.md`

If `.claude/skills/` is non-empty, regenerate `readme-docs/SKILLS.md`. Keep the existing format
(per-skill sections with command, launch mode, arguments table, examples). The file lives under
`readme-docs/` so it is included as a satellite in the `doc://readme` assembled document — link
to it from the main README's **Skills** section.

### Step 7 — Validate

Run through this checklist before declaring done:

- [ ] Canonical section order followed; no empty headings
- [ ] **Quick Links** block is present, sits right after the badges, has 8–14 entries covering
      only major sections, and every anchor resolves to an existing `##` heading in the file
- [ ] **Tools** section is wrapped in `<details><summary>Expand to view ...</summary><br>` with
      the heading `## Tools (<count>)` kept *outside* the block
- [ ] No `<details>` used to hide content readers need at a glance (Quick Start commands,
      Key Features, Configuration Basics table, Integration snippets)
- [ ] Every section in the main README is ≤ ~40 lines (or wrapped in `<details>`, or split into
      a satellite)
- [ ] Tool count in the `## Tools (<count>)` heading matches the table
- [ ] Every satellite link resolves to an existing file in `readme-docs/`
- [ ] No satellite file for a disabled feature
- [ ] `webServer.port` in all commands matches `config/default.yaml`
- [ ] Custom header names in Client Integration match those the server parses
- [ ] JSON snippets are valid JSON; YAML snippets are valid YAML
- [ ] Every code fence has a language tag
- [ ] Relative links use `./readme-docs/...` form
- [ ] Line length ≤ 120 chars outside URLs / code / tables
- [ ] Previous README backed up to `README.backup.md` when rewriting

## Output

1. `README.md` — restructured per canonical order
2. `readme-docs/<topic>.md` — one per satellite topic, only those the project needs
3. `readme-docs/SKILLS.md` — regenerated if `.claude/skills/` is present
4. `README.backup.md` — backup of previous README when rewriting

## References

- `reference/templates.md` — canonical section blocks for the main README
- `reference/satellite-templates.md` — skeletons for common `readme-docs/*.md` files
- `reference/best-practices.md` — writing style and formatting guidelines
