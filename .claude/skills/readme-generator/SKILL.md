---
name: readme-generator
description: Generates a showcase-style README.md plus readme-docs/*.md satellites for MCP servers built with fa-mcp-sdk. The main README is a short landing page — hook, screenshots, feature bullets, a minimal quick start, a documentation TOC, and two collapsed reference sections at the end (tool close-up, client configs); every deep technical detail lives in satellite files that each open with a substantive lead. Detects which SDK subsystems are enabled and emits satellites only for features that exist. Use when creating or refreshing README for an fa-mcp-sdk-based MCP server project.
---

# MCP Server README Generator

Generates a `README.md` and its `readme-docs/*.md` satellites for an MCP server built on `fa-mcp-sdk`.
The main README is a **showcase page**: it hooks the reader with what the server can do and shows it
working; deep technical detail is one click away — in a satellite file, or in one of the two
collapsed reference sections at the end of the page.

## Philosophy — showcase, not manual

Three reader roles, three destinations:

| Reader                 | Question                          | Where it's answered                              |
|------------------------|-----------------------------------|---------------------------------------------------|
| Visitor (30 seconds)   | What is this? Does it look alive? | Hook paragraph, screenshots, feature bullets       |
| Evaluator (5 minutes)  | Can I run it right now?           | "Try it in 60 seconds", "Connect your client"      |
| Integrator / operator  | How exactly does X work?          | The Documentation table → `readme-docs/*.md`       |

**Hard rule — no *open* reference material in the main README.** No open parameter tables, no open
client-config JSON, no config-key tables, no endpoint lists, no auth priority orders, no Quick
Links block. Exactly two reference sections are allowed, both **at the end of the page** (after the
Documentation table) and both collapsed into `<details>` blocks:

- **The tool, up close** — parameters and answer contents, collapsed;
- **Connect your client** — one collapsed config block per MCP client.

Everything else that wants a reference table or a second code fence belongs in a satellite. Target:
the *collapsed* view of the README stays around one–two screens (~100 visible lines); the raw file
is longer because of the collapsed content, and that is fine.

**Tone.** Punchy but factual. Lead every feature bullet with the benefit, use concrete numbers
(languages, route variants, endpoints), and never invent superlatives — "blazingly fast" and friends
are banned. "Answers within a second of starting, thanks to the disk cache" is the register to hit:
a strong claim, backed by a mechanism.

## The `readme-docs/` folder is load-bearing

Satellite Markdown files **must** live in `readme-docs/` at the project root. The fa-mcp-sdk
`doc://readme` MCP resource looks for exactly that folder name: on server start it reads
`README.md`, finds every link pointing into `readme-docs/`, appends those satellite files (each
separated by `\n\n---\n\n`) and rewrites the in-text links to `See "<heading>" below` so the
assembled document reads naturally.

This means:

- Moving content out of the main README loses **nothing** for RAG — the resource reassembles the
  README and every linked satellite into one searchable document for the MCP registry's indexing.
- Any satellite file *not* linked from `README.md` is **not** included in the resource. The
  **Documentation table** in the main README links every satellite, which is exactly what makes the
  showcase layout safe. If you add a new `readme-docs/*.md` file, add its row to that table.
- Do not rename the folder. Any other name (`docs/`, `doc/`, `readme-parts/` etc.) will be ignored
  by the SDK and the satellite content will not reach RAG.

## Dynamic detection is mandatory

The set of satellite files is **not fixed**. The skill inventories the project, decides per feature
whether it is enabled, and only then produces the matching feature bullets and `readme-docs/*.md`
files. **Do not create a satellite file for a disabled feature.** Do not emit empty sections.

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

**Visuals**

- Screenshots and demo images already in `readme-docs/` (`*.png`, `*.jpg`, `*.gif`, `*.webp`) — a
  chat answer, a widget, an admin UI. If none exist, skip the screenshot block and tell the user
  that one or two screenshots (a real chat answer plus the widget/UI, if the server has one) would
  noticeably strengthen the page.

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

### Step 2 — Classify findings: drop / bullet / satellite

For each finding, pick placement:

- **Drop** — feature not used; no bullet, no satellite file.
- **Feature bullet** — every enabled subsystem or capability worth showing earns *at most one*
  bullet in **What it does** (or one clause in **Under the hood**). A bullet states the benefit and
  the mechanism in ≤ 2 lines; it never carries a table or a code fence.
- **Satellite** — any explanation longer than a bullet. Create `readme-docs/<kebab-name>.md`, add
  its row to the Documentation table.

**Two satellites are mandatory for every project** — they hold the *full* version of what the main
README's collapsed end sections show in condensed form:

- `readme-docs/getting-started.md` — quick start with verification, MCP client integration
  (Claude Code, Claude Desktop, Qwen Code, Codex), transports and endpoints, build & test
  commands, environment variables.
- `readme-docs/tool-reference.md` — the grouped tool table, per-tool input parameters, what each
  answer contains, MCP resources and prompts.

The two end sections of the main README (Step 3, items 8–9) carry a **condensed copy** of this
content inside collapsed blocks. The duplication is intentional — the reader gets the essentials
without leaving the page, RAG gets the full version through the satellites. Whenever one side
changes, update the other.

**Always satellite** (never a bullet alone, never in the main README):

- Authentication resolution order / priority tables
- Webhook body schema + per-tool hook priority rules
- Headless Agent Tester full argument list and scenario matrix
- Full configuration reference tables
- Consul / AD / Database detailed setup

### Step 3 — Main README structure

Canonical order. Omit only what the project genuinely lacks (e.g. no screenshots exist yet).

1. **Title + hook** — H1 is the project name only. Then a 2–4 line paragraph that opens with a
   **bold claim** and is phrased around what the user can *ask or do* — never around the
   implementation. Good: "Ask *'how do I get from A to B?'* in plain language — get real routes
   with times, transfers and today's closures." Bad: "An MCP server exposing one tool via STDIO."
2. **Badges** — license, Node, TypeScript, MCP, fa-mcp-sdk; only meaningful ones.
3. **Screenshots** — a two-column HTML table with `<sub>` captions, immediately after the badges.
   Only when images exist (see Step 1 → Visuals).
4. **What it does** — 5–8 bullets, each ≤ 2 lines, emoji-led, benefit first, mechanism second.
5. **Tool surface one-liner** — one paragraph: "One tool — `<name>` — answers …" or "N tools across
   M domains — …", linking to [Tool Reference](./readme-docs/tool-reference.md).
6. **Try it in 60 seconds** — install / build / start, one verification command, one closing line
   naming what is *not* needed ("no database, no API keys"), and an anchor link to the
   **Connect your client** section below. No open client JSON here.
7. **Documentation** — a table with one row per satellite: link + one-line "what's inside".
   This is the only navigation device; there is no Quick Links block.
8. **The tool, up close** — 1–3 *open* sentences naming the tool(s), the actions and the response
   format, then a `<details>` block with the parameters and what the answers contain.
   **If the server has exactly one tool, do not build a tools table** — the open sentences name it
   and the block holds its parameter table and answer contents. With several tools, the block
   opens with the grouped tool table (domain `###` subsections). Close the section with a link to
   [Tool Reference](./readme-docs/tool-reference.md).
9. **Connect your client** — one `<details>` block per client: Claude Code, Claude Desktop
   (STDIO + `mcp-remote`), Qwen Code, Codex. Summary lines name the client and its config file.
   Close the section with a link to [Getting Started](./readme-docs/getting-started.md).
10. **Under the hood** — 2–4 sentences: language, framework, the key algorithmic or data decisions.
11. **License**

### Step 4 — Generate `README.md`

Apply the structure from Step 3. Respect these rules:

- H1 is the project name only — no duplicate title in the next line.
- Every code fence has a language specifier (` ```bash `, ` ```json `, ` ```yaml `).
- `webServer.port` in commands matches the actual value from `config/default.yaml`.
- Screenshot `alt` texts describe what the image shows, not "screenshot 1".
- `<details>` markup: `<br>` immediately after `</summary>` is **mandatory** (GitHub collapses the
  first child block without it); one blank line before `</details>`.
- Relative links for internal references: `[…](./readme-docs/getting-started.md)`.
- Line length ≤ 120 chars where practical. Exceptions: URLs, code blocks, tables.
- No marketing superlatives; every strong claim names its mechanism. Active voice.

See `reference/templates.md` for canonical blocks, including the screenshot table and the two
collapsed end sections.

### Step 5 — Generate satellite `readme-docs/*.md` files

**The lead rule.** Every satellite opens with a lead of 2–4 full sentences that delivers the
essentials of its topic — a reader who stops after the lead already knows the key facts: what this
is, the default state, the one order or number that matters. "In short: …" after the first sentence
is a good pattern. A bare one-liner such as "How X works." is **not** enough. Details follow below,
under headings.

Create the two mandatory satellites first — `getting-started.md` and `tool-reference.md` — from the
blocks in `reference/templates.md`, filling in the project's actual port, header names and tool
list. Then create one file per finding classified as *satellite* in Step 2, using
`reference/satellite-templates.md` skeletons where one exists (authentication, testing, webhooks,
consul, active-directory, database, configuration). **Adapt every skeleton to actual values from
the project.**

For project-specific capabilities (fuzzy resolution, custom endpoints, etc.) compose a new
`readme-docs/<kebab-name>.md` with sections: *lead paragraph*, *How it works*, *Configuration*,
*Examples*.

`<details>` collapsible blocks: in the main README they appear **only** in the two end sections
(Step 3, items 8–9); inside satellites use them for genuinely bulky matrices (100+ lines).
Required markup is in `reference/templates.md`.

### Step 6 — Update `readme-docs/SKILLS.md`

If `.claude/skills/` is non-empty, regenerate `readme-docs/SKILLS.md`. Keep the existing format
(per-skill sections with command, launch mode, arguments table, examples). Link it from the
Documentation table so it is included in the `doc://readme` assembled document.

### Step 7 — Validate

Run through this checklist before declaring done:

- [ ] The collapsed view of the main README is ≈ one–two screens; **no open** parameter tables,
      config tables, client JSON, endpoint lists; no Quick Links block
- [ ] `<details>` blocks in the main README appear **only** in **The tool, up close** and
      **Connect your client**, both placed after the Documentation table
- [ ] Single tool → no tools table (open sentences + parameter table inside the block); several
      tools → grouped table inside the block
- [ ] Every `<details>` has `<br>` immediately after `</summary>` and a blank line before
      `</details>`
- [ ] The two end sections stay in sync with `tool-reference.md` and `getting-started.md`
      (condensed vs. full versions of the same facts)
- [ ] The first screen — title, hook, badges, screenshots — contains no commands and no config keys
- [ ] Screenshot block present when images exist in `readme-docs/`; `alt` texts are descriptive
- [ ] **What it does** has 5–8 bullets, each ≤ 2 lines, benefit first, no invented superlatives
- [ ] **Try it in 60 seconds** runs top-to-bottom on a clean checkout; port matches
      `config/default.yaml`
- [ ] The Documentation table has one row per satellite file, and **every** file in `readme-docs/`
      is linked from the main README (unlinked satellites never reach `doc://readme`)
- [ ] `readme-docs/getting-started.md` and `readme-docs/tool-reference.md` exist and carry the
      full client-integration snippets, transports, build commands and the full tool table
- [ ] Every satellite opens with a 2–4 sentence substantive lead (the lead rule, Step 5)
- [ ] Tool counts and feature claims match `src/tools/` and the config
- [ ] Custom header names in the client configs match those the server actually parses
- [ ] JSON snippets are valid JSON; YAML snippets are valid YAML; every code fence has a language tag
- [ ] Relative links use `./readme-docs/...` form (from the README) / `./<file>.md` (between satellites)
- [ ] Line length ≤ 120 chars outside URLs / code / tables
- [ ] No satellite file for a disabled feature
- [ ] Previous README backed up to `README.backup.md` when rewriting

## Output

1. `README.md` — the showcase page, restructured per Step 3
2. `readme-docs/getting-started.md` and `readme-docs/tool-reference.md` — always
3. `readme-docs/<topic>.md` — one per enabled feature that warrants a satellite
4. `readme-docs/SKILLS.md` — regenerated if `.claude/skills/` is present
5. `README.backup.md` — backup of previous README when rewriting

## References

- `reference/templates.md` — canonical blocks: main README (incl. the two collapsed end sections)
  + the two mandatory satellites
- `reference/satellite-templates.md` — skeletons for feature satellites
- `reference/best-practices.md` — writing style and formatting guidelines
