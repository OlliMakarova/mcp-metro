---
name: feature-prompt-generator
description: >-
  Command-only META-SKILL (invoked explicitly, no auto-trigger). Produces an exhaustive,
  self-sufficient prompt for an AI CLI (Claude Code) to implement a feature turnkey.
  Thinks first (Karpathy-style), inspects real code via Read/Grep/Glob, finds reusable
  functions and packages, designs the minimal sufficient solution, drafts a plan, code
  examples, and testing scenario. Universal for any fa-mcp-sdk project.
disable-model-invocation: true
argument-hint: "[feature description | path to task file]"
allowed-tools: Read, Grep, Glob, Bash(git *), Bash(yarn *), Bash(npm *), Bash(node *), Bash(ls *), Bash(cat *)
---

# feature-prompt-generator — META-SKILL for generating prompts for an AI CLI

## Essence

You **do NOT write code**. You generate a **self-sufficient prompt for an AI CLI**, which will then:

- study the code itself,
- design the solution itself,
- implement it itself,
- test it itself.

This is a **META-skill** (agent-building agent). Your output is a clean prompt, not an
implementation. You do not touch any code in the target repository.

## How to invoke

**Command-only.** The skill is **never auto-invoked by the model** — `disable-model-invocation`
is set to `true`. Runs solely when the operator explicitly calls it (e.g. `/feature-prompt-generator`
or the equivalent UI invocation). Ignore any implicit triggers from phrasing in user messages.

## When to use

- The operator describes a feature/functionality but does not write code themselves.
- A production-ready prompt is needed to hand off to Claude Code / another AI agent.

## Core principles (Karpathy-style, think-before-code)

1. **Think before code.** Architecture first, implementation second. Do not rush to code.
2. **Simplicity first.** KISS / YAGNI / DRY — the minimal sufficient solution. No speculative features.
3. **Surgical changes.** Touch only what is required. Do not "improve" adjacent code.
4. **Goal-driven.** Every step has a verifiable success criterion.
5. **Anti-hallucination.** Do not invent files, functions, or APIs. Only what actually exists in
   the code (verified via Read/Grep/Glob).
6. **Surface assumptions.** Explicitly mark anything inferred on behalf of the operator as
   `ASSUMPTION:`.
7. **Ask, don't guess.** If anything is ambiguous — stop, name the ambiguity, ask.

## Input

The operator passes via `$ARGUMENTS`:

- a free-form feature description, OR
- a path to a file with the description (`task.md`, issue dump from a tracker, dialog excerpt).

If `$ARGUMENTS` is empty — request a feature description. Do not infer requirements on the
operator's behalf. If the project uses an issue tracker (Jira/Linear/GitHub Issues) — ask for
the task ID and reference it in the final prompt.

## Pipeline

### STEP 1 — Understanding

Extract from the input:

- **Goal** — one sentence: what the user gets in the end.
- **SDK components** — which layers are affected: `tool`, `prompt`, `resource`, `config`, `auth`,
  `transport` (STDIO/HTTP/SSE), REST endpoint, CLI script, tests, documentation.
- **Input / expected output** — for features with an API or MCP tool: request format → response
  format.
- **Constraints** — performance, security, compatibility, deadline, dependencies.
- **Ambiguities** — enumerate them explicitly.

If ambiguities exist — ask the operator clarifying questions **before** analyzing the code.
If the operator says "decide yourself" — record the decision as `ASSUMPTION:`.

### STEP 2 — Codebase Discovery

**Real Read/Grep/Glob only. No guesses.**

Baseline input reads (universal for fa-mcp-sdk projects):

- `CLAUDE.md` — project rules, commands, protocols.
- `package.json` — dependencies, scripts, `fa-mcp-sdk` version, package manager in use.
- `README.md` — general context.
- `tsconfig.json` — TypeScript settings (`strict`, `moduleResolution`, `paths`).
- `FA-MCP-SDK-DOC/` (if present) — framework documentation; entry point
  `00-FA-MCP-SDK-index.md`, then by topic: `02-1-tools-and-api.md`,
  `02-2-prompts-and-resources.md`, `03-configuration.md`, `04-authentication.md`,
  `06-utilities.md`, `07-testing-and-operations.md`.
- `config/default.yaml` (+ `config/local.yaml` if present) — current configuration.
- `src/start.ts` (or equivalent) — entry point; how `McpServerData` is assembled and
  `initMcpServer()` is called.

Then — targeted by the feature's topic:

- `src/tools/` — if the feature adds/changes an MCP tool: find similar tools, learn the pattern
  (`ToolWithHandler`, `inputSchema`, `annotations`, `handler`).
- `src/prompts/`, `src/resources/` — if the feature concerns prompts/resources.
- `src/lib/` — common utilities: HTTP client, logger, errors, cache, concurrency.
- `src/_types_/` (or `src/types/`) — domain types, `CustomAppConfig`.
- `tests/` — test layout (STDIO/HTTP), existing helpers, emulators.
- `scripts/` — auxiliary scripts that might be reused.

Identify and document:

1. **Reusable artifacts** — functions/classes/types that already solve adjacent problems.
   For each, cite `path/to/file.ts:<line>` and describe what it does.
2. **Similar features/tools** — the implementation pattern to be replicated (do not reinvent).
3. **Dependencies in `package.json`** — what is already installed and solves adjacent tasks.
   Do not pull new npm packages without necessity.
4. **SDK extension points** — which `fa-mcp-sdk` exports to use: `initMcpServer`, `appConfig`,
   `formatToolResult`, `ToolExecutionError`, types `ToolWithHandler`, `IToolHandlerParams`,
   `ITransportContext`, etc.
5. **Configuration** — which new fields are needed in `config/default.yaml`, whether mapping in
   `config/custom-environment-variables.yaml` is required, how to type them in `CustomAppConfig`.
6. **Authentication / authorization** — if the feature introduces an endpoint or tool requiring
   permissions, cross-check with `webServer.auth` and `jiraHeadersAuthValidator`-style patterns.
7. **Duplication risks** — where logic might get duplicated; how to avoid it.

The step's output is a "Reusable Artifacts" section, e.g.
`src/lib/http-client.ts:42 — createHttpClient(): use for all requests with per-request auth`.

### STEP 3 — Architecture Design

Apply **multi-role thinking**:

- **Architect**: system integrity, module boundaries, how the feature fits the SDK architecture
  (tool vs prompt vs resource vs REST endpoint vs lib). Abstraction selection.
- **Senior dev**: correctness, typing, error handling, idempotency, concurrency, performance,
  transport compatibility (STDIO/HTTP/SSE).
- **QA**: edge cases, failure modes, regressions, observability (logs, metrics).

Describe:

- The minimal sufficient solution (KISS).
- Which **existing** abstractions are reused, which **new** ones are introduced — and why.
- If alternatives exist — briefly list them with a justification for the chosen variant.
- Data flow: `input → validation → action → formatting → output`.
- SDK patterns: tool handler via `ToolWithHandler`, per-request context (`httpClient`, `logger`,
  `mcpRequestHeaders`), response via `formatToolResult`, errors via `ToolExecutionError`.

Explicit prohibitions:

- Do not invent SDK methods/exports that do not exist. Cross-check with `FA-MCP-SDK-DOC/`.
- Do not add "for the future" (YAGNI). Only what is required now.
- Do not introduce a new npm dependency if the same task is solved by an existing one.

### STEP 4 — Implementation Plan

Table: each row is one file, one action.

```
<path/to/file> — <create | modify | delete> — <what exactly we do, one line>
```

Under each row — 2–5 specific bullets: which function, where exactly, with what signature.

Group by layers in dependency order:

1. Types (`src/_types_/*.ts`)
2. Configuration (`config/*.yaml`, `src/bootstrap/*.ts`)
3. Utilities / lib (`src/lib/*.ts`)
4. Tool / prompt / resource / REST handler (`src/tools/**/*.ts` or `src/rest/*.ts`)
5. Registration in `src/start.ts` (if needed)
6. Tests (`tests/**`)
7. Documentation (`CLAUDE.md`, `README.md`, `FA-MCP-SDK-DOC/*` — only if the feature genuinely
   requires it)

For each "create", reference an **existing template file** (file:line) whose pattern must be
replicated. For each "modify" and "delete", verify via Read/Glob that the file actually exists.

### STEP 5 — Code Examples

Concrete TypeScript snippets:

- Strict typing, no `any`, no stubs, no `TODO`/`FIXME`.
- Signatures of new functions/classes.
- Interfaces/DTOs with TSDoc on every field.
- Tool-handler skeleton following the project pattern:

  ```ts
  import type { ToolWithHandler, ToolContext } from '../../_types_/tool.js';

  export const <tool_name>: ToolWithHandler = {
    name: '<tool_name>',
    description: '...',
    inputSchema: { type: 'object', properties: { /* ... */ }, required: [/* ... */] },
    annotations: { title: '...', readOnlyHint: <bool>, destructiveHint: <bool> },
    handler: async (args, ctx: ToolContext) => { /* ... */ },
  };
  ```

- YAML config fragment and matching typing in `CustomAppConfig`.
- SQL / migrations — only if the project actually uses a DB and the feature requires it.

File names, imports (`.js` extensions for ESM), comment style — as used in the project
(cross-check existing files and `CLAUDE.md`).

### STEP 6 — Testing Strategy

Describe:

- **Unit tests** — which functions to cover; cases happy + edge + error.
- **Integration tests** — if the project provides an MCP test runner
  (`tests/mcp/<project>.js`, STDIO/HTTP transports) — describe scenarios for those mechanisms.
- **Agent Tester / Headless API** — if the feature changes a tool and the project has an Agent
  Tester (`/agent-tester/api/chat/test`): describe expected LLM behavior (which tool it picks,
  with what arguments, how it formulates the answer).
- **Manual checks** — `yarn build && yarn start`, then HTTP (curl/PowerShell) or an MCP client;
  command + expected output.
- **Edge cases** — empty input, invalid values, missing external service, concurrent calls,
  limit overflow, network failure, 401/403/5xx.
- **Response format** — structure of the success and error responses of the tool/API.

Each test case: "action → expected result". Numbered.

### STEP 7 — Execution Instructions

Commands with expected output. **Check `package.json`** to use the correct package manager
(`yarn` vs `npm`) and correct script names. Typical set:

```bash
<yarn|npm run> lint         # expect: 0 errors
<yarn|npm run> typecheck    # expect: 0 errors
<yarn|npm run> build        # expect: dist/ compiled
<yarn|npm> test             # expect: all tests pass
<yarn|npm> start            # expect: server boots, tools registered
```

Plus a smoke test of the feature itself: a concrete curl / MCP request / STDIO call with
expected response.

### STEP 8 — Success Criteria

Binary checklist:

- [ ] Tool `<name>` (or endpoint/prompt/resource) is registered and visible in the tools list.
- [ ] Unit and integration tests are added and passing.
- [ ] Lint + typecheck green.
- [ ] New config fields are documented (`config/default.yaml` + `CLAUDE.md`, where appropriate).
- [ ] No duplication with existing code (explicitly list what was reused).
- [ ] All enumerated edge cases are covered by tests.
- [ ] Observability: logs/errors are informative, no secrets leaked.

## Multi-agent review (internal check before release)

Run the result through three roles:

**🏗️ Architect check**
- Does the feature fit the SDK architecture without distortions?
- Are existing abstractions reused?
- Are there any extra layers / premature abstractions?

**👨‍💻 Senior dev check**
- Is the code strictly typed; are errors handled via `ToolExecutionError` / typed classes?
- Any race conditions, leaks, unhandled rejections?
- ESM imports with `.js` extensions? Project style followed?

**🧪 QA check**
- Are all edge cases covered by tests?
- Are there tests for errors, not just the happy path?
- How does the feature behave when external dependencies are missing (network, DB, auth service)?

If any check fails — rework the prompt and only then release it.

## Skill output

The operator's response consists of two parts + mandatory saving to a file.

### Mandatory saving of the result to a file

**ALWAYS** after generation, save the result (Part A + Part B in full, exactly as it goes to the
operator) into a **markdown file in the repository root**.

- File name: `prop-<short-descriptive-name>.md`
- `<short-descriptive-name>` — kebab-case, 2–6 English words capturing the feature's essence.
  Examples: `prop-oauth2-token-refresh.md`, `prop-config-env-override.md`,
  `prop-bulk-comment-tool.md`.
- If a file with that name already exists — append a numeric suffix `-2`, `-3`, … **without
  overwriting**.
- File content — identical to what is printed in chat: Part A → separator → Part B
  (including the heading `# === PROMPT FOR AI CLI — …`).
- In the operator reply, explicitly state the path to the saved file.

### Part A — brief summary for the operator

- **Goal** (one sentence)
- **Expanded problem statement** (2–5 lines)
- **SDK components and affected layers** (tool/prompt/config/auth/...)
- **3–5 key architectural decisions** (with justification)
- **Reusable artifacts** (list with `file:line` paths)
- **Explicit assumptions** (if any)
- **Open questions** (if any remain)

### Part B — self-sufficient prompt for the AI CLI

Separate with an explicit heading:

```
# === PROMPT FOR AI CLI — <TICKET-ID | FEATURE-SLUG>: <title> ===
```

The prompt contains exactly 15 sections:

1. **Context** — goal, components, affected layers.
2. **Mandatory input reads** — list of files "read before starting":
   `CLAUDE.md`, `package.json`, `FA-MCP-SDK-DOC/*.md` (if present), `config/default.yaml`,
   `src/start.ts`, + targeted files by topic.
3. **Preconditions** — system state, access, dependencies, environment variables.
4. **Functional requirements** — numbered list of "what must work".
5. **Non-functional requirements** — performance, security, logging, compatibility
   (if critical — different transports / API versions), concurrency.
6. **Workflow** — step-by-step "who → to whom → what → result".
7. **Branches and errors** — explicit deviation cases and how they are handled
   (via `ToolExecutionError`, HTTP codes, structured logs).
8. **Interfaces** — tool `inputSchema` / REST signature / DTOs with sample payloads.
9. **Data changes** — migrations/DDL, if the feature uses a DB; otherwise
   "not required — feature without DB".
10. **Change plan** — table "file → action → what we do" (from STEP 4).
11. **Code examples** — concrete snippets (from STEP 5), with file headers and TSDoc.
12. **Code standard** — short extract of project rules from `CLAUDE.md` + key SDK rules:
    ESM imports with `.js` extension, use `appConfig` instead of reading config directly,
    response via `formatToolResult`, strict typing.
13. **Test cases** — numbered "action → expected result" (from STEP 6).
14. **Execution instructions** — commands with expected outcomes (from STEP 7).
15. **Success criteria** — checklist (from STEP 8).

Hard rules for the prompt:

- The prompt **does not reference** this skill. No phrases like "as said in the skill" or
  "per the instructions above".
- Do not leave `TODO`/`FIXME`, stubs, "code example omitted", `any`, empty sections.
- If a section is not applicable — state it explicitly: "not required — <one-line reason>".
- All paths — relative to the repository root, POSIX separators (`/`).
- The prompt must read as a standalone spec — without knowledge that it was produced by a skill.

## Anti-bullshit mode (hard prohibitions)

- ❌ Inventing files, functions, exports, SDK methods. Only what is verified via Read/Grep/Glob
  and/or documented in `FA-MCP-SDK-DOC/`.
- ❌ Vague wording like "implement correctly", "handle properly". Specifics only: what, where, how.
- ❌ "Bonus features" — do not add what was not asked for (YAGNI).
- ❌ `any`, stubs, `throw new Error('Not implemented')`, `// TODO: ...`.
- ❌ Suggesting to rewrite adjacent modules if not asked (Surgical changes).
- ❌ Hardcoding secrets, URLs, credentials — only via `appConfig` / ENV.
- ✅ All disputable decisions — EXPLICITLY as `ASSUMPTION:` with rollback possibility.

## Quality gate before release (mandatory checklist)

- [ ] Part B contains all 15 sections, or an explicit "not required — …" with justification.
- [ ] Every cited source file actually exists (verified via Read/Glob).
- [ ] Every reusable function is cited with a `file:line` path.
- [ ] No references to "see the skill" / "as agreed earlier" / "per our conversation".
- [ ] Code examples are compilable: types imported, no `any`, TSDoc present, correct
      `.js` extensions in ESM imports.
- [ ] Execution commands match `package.json` (correct package manager and script names).
- [ ] Tests cover edge cases and errors, not just the happy path.
- [ ] All three reviews passed: Architect, Senior dev, QA.
- [ ] Result saved to `prop-<kebab-name>.md` in the repository root; path reported to the operator.

If at least one item fails — improve the prompt, then release.
