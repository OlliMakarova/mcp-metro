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
allowed-tools: Read, Grep, Glob, Bash(git *), Bash(yarn *), Bash(npm *), Bash(node *), Bash(ls *), Bash(cat *), Bash(curl *), WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
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

## Method — shared with the other skills

How you think, and how you study a source of truth, is defined once — in
`${CLAUDE_SKILL_DIR}/../_shared/source-research.md`. **Read that file before STEP 1 and follow it for
the whole run.** It carries the seven core principles (think before code, simplicity first, surgical
changes, goal-driven steps, anti-hallucination, surfaced assumptions, ask rather than guess), the
classification of source kinds, the baseline project reads, the inventory each kind of source demands,
the rules for mapping a source's operations onto an MCP surface, and the hard prohibitions.

The shape of the document you produce is defined once as well — in
`${CLAUDE_SKILL_DIR}/../_shared/prompt-plan-format.md`. Part B of your output is a prompt-plan and
obeys that format. Read it before writing Part B.

Neither file is optional, and neither is summarized into the output: this skill adds only what is
specific to turning research into a hand-off prompt.

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

### STEP 2 — Source and codebase discovery

Carry out the research described in `${CLAUDE_SKILL_DIR}/../_shared/source-research.md`: classify the
source, do the baseline project reads, inventory the source's operations with their inputs, outputs,
access rules and limits, map those operations onto an MCP surface, and list what is already reusable
here. **Real Read / Grep / Glob / WebFetch only. No guesses.**

On top of what that file requires, record these four things — the prompt you are about to write needs
them and they are specific to this SDK:

1. **SDK extension points** — which `fa-mcp-sdk` exports the implementation will use: `initMcpServer`,
   `appConfig`, `formatToolResult`, `ToolExecutionError`, and the types `ITemplateTool`,
   `IToolHandlerParams`, `TToolHandlerResponse`, `ITransportContext`.
2. **Configuration** — which new fields belong in `config/default.yaml`, whether a mapping in
   `config/custom-environment-variables.yaml` is required, and how they are typed in `CustomAppConfig`.
3. **Authentication / authorization** — when the feature introduces an endpoint or a tool that requires
   permissions, cross-check against `webServer.auth` and the validator patterns already in the project.
4. **Duplication risks** — where logic could get duplicated during implementation, and how that is
   avoided.

Every reusable artifact is cited with a `file:line` path and one line on what it does, e.g.
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
- SDK patterns: one tool per file, each exporting an `ITemplateTool` (`{ definition, handler }`) and
  listed in `src/tools/tools.ts`; the handler receives `IToolHandlerParams` (arguments, headers, JWT
  payload, transport); the response goes through `formatToolResult`; failures raise
  `ToolExecutionError`.

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

Group by layers in dependency order. These layers are also the stages of the checklist in the finished
prompt, so name them the same way in both places:

1. Types (`src/_types_/*.ts`)
2. Configuration (`config/*.yaml`)
3. Utilities / lib (`src/lib/*.ts`)
4. Tool / prompt / resource / REST handler — one tool per file in `src/tools/<tool-name>.ts`, each
   registered in the list in `src/tools/tools.ts`; prompts in `src/prompts/*`, resources in
   `src/custom-resources.ts`, REST endpoints in `src/api/router.ts`
5. Tests (`tests/mcp/**`)
6. Documentation (`README.md`, `readme-docs/*`, `AGENTS.md` where a rule actually changes) — this
   layer is the **last stage and it is mandatory**, never "only if the feature requires it"

For each "create", reference an **existing template file** (file:line) whose pattern must be
replicated. For each "modify" and "delete", verify via Read/Glob that the file actually exists.

### STEP 5 — Code Examples

Concrete TypeScript snippets:

- Strict typing, no `any`, no stubs, no `TODO`/`FIXME`.
- Signatures of new functions/classes.
- Interfaces/DTOs with TSDoc on every field.
- Tool skeleton following the project pattern — one tool per file, `src/tools/<tool-name>.ts`, the
  tool's `name` with every `_` replaced by `-`, definition and handler together in that one file:

  ```ts
  import { Tool } from '@modelcontextprotocol/sdk/types.js';
  import { formatToolResult, ToolExecutionError, IToolHandlerParams, TToolHandlerResponse } from 'fa-mcp-sdk';
  import { ITemplateTool } from './tool.js';

  const definition: Tool = {
    name: '<tool_name>',
    description: '...',
    inputSchema: { type: 'object', properties: { /* ... */ }, required: [/* ... */] },
    annotations: { title: '...', readOnlyHint: <bool>, destructiveHint: <bool> },
  };

  async function handler (params: IToolHandlerParams): Promise<TToolHandlerResponse> {
    const { arguments: args, headers, payload } = params;
    if (!args?.<required_field>) throw new ToolExecutionError('<tool_name>', '<field> is required');
    return formatToolResult({ /* ... */ });
  }

  export const <toolCamelCase>Tool: ITemplateTool = { definition, handler };
  ```

  Registration is a single line added to the list in `src/tools/tools.ts`; the dispatcher in
  `src/tools/handle-tool-call.ts` picks the tool up by name and is not edited.

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

Part B is a **prompt-plan**, so its shape comes from
`${CLAUDE_SKILL_DIR}/../_shared/prompt-plan-format.md` — read that file before writing it. The two
opening sections are prescribed there and come first; the sections below fill in everything after
them. Eighteen sections in total:

1. **Essence** — the plain-language opening block required by the format file: what this changes and
   why, written for a non-programmer, with no path, identifier, protocol name, or unexpanded
   abbreviation in it. Nothing goes above this section.
2. **Note to the executor** — the standing instructions for the whole run, including the rule that
   every checklist box is ticked in this same file the moment the item is genuinely done.
3. **Context** — goal, components, affected layers.
4. **Mandatory input reads** — list of files "read before starting":
   `AGENTS.md`, `package.json`, `FA-MCP-SDK-DOC/*.md` (if present), `config/default.yaml`,
   `src/start.ts`, + targeted files by topic.
5. **Source of truth** — what the feature's knowledge is drawn from and how it was verified: paths,
   URLs, documentation sections. Anything that could not be opened is named here as a blocker.
6. **Preconditions** — system state, access, dependencies, environment variables.
7. **Functional requirements** — numbered list of "what must work".
8. **Non-functional requirements** — performance, security, logging, compatibility
   (if critical — different transports / API versions), concurrency.
9. **Workflow** — step-by-step "who → to whom → what → result".
10. **Branches and errors** — explicit deviation cases and how they are handled
    (via `ToolExecutionError`, HTTP codes, structured logs).
11. **Interfaces** — tool `inputSchema` / REST signature / DTOs with sample payloads.
12. **Data changes** — migrations/DDL, if the feature uses a DB; otherwise
    "not required — feature without DB".
13. **Change plan** — table "file → action → what we do" (from STEP 4).
14. **Code examples** — concrete snippets (from STEP 5), with file headers and TSDoc.
15. **Code standard** — short extract of project rules from `AGENTS.md` + key SDK rules:
    one tool per file exporting an `ITemplateTool`, ESM imports with `.js` extension, configuration
    read through `appConfig`, responses through `formatToolResult`, strict typing.
16. **Test cases** — numbered "action → expected result" (from STEP 6).
17. **Execution instructions** — commands with expected outcomes (from STEP 7).
18. **Implementation checklist** — the stages from STEP 4, each item a `- [ ]` checkbox grouped by
    stage, with the documentation update as the last stage. The success criteria from STEP 8 close the
    document as a sign-off block.

Hard rules for the prompt:

- The prompt **does not reference** this skill. No phrases like "as said in the skill" or
  "per the instructions above". The same applies to the two shared reference files: their rules are
  obeyed, their names never appear in the output.
- Everything is stated **in the target state** — decisions, not transitions. No "was replaced by",
  no "moved from X to Y", no before/after wording anywhere in the document.
- Do not leave `TODO`/`FIXME`, stubs, "code example omitted", `any`, empty sections.
- If a section is not applicable — state it explicitly: "not required — <one-line reason>".
- All paths — relative to the repository root, POSIX separators (`/`).
- The prompt must read as a standalone spec — without knowledge that it was produced by a skill.

## Anti-bullshit mode (hard prohibitions)

- ❌ Inventing files, functions, exports, endpoints, SDK methods. Only what is verified via
  Read/Grep/Glob/WebFetch and/or documented in `FA-MCP-SDK-DOC/` or the source's own documentation.
- ❌ Vague wording like "implement correctly", "handle properly". Specifics only: what, where, how.
- ❌ "Bonus features" — do not add what was not asked for (YAGNI).
- ❌ `any`, stubs, `throw new Error('Not implemented')`, `// TODO: ...`.
- ❌ Suggesting to rewrite adjacent modules if not asked (Surgical changes).
- ❌ Hardcoding secrets, URLs, credentials — only via `appConfig` / ENV.
- ✅ All disputable decisions — EXPLICITLY as `ASSUMPTION:` with rollback possibility.

## Quality gate before release (mandatory checklist)

- [ ] Part B contains all 18 sections, or an explicit "not required — …" with justification.
- [ ] Part B obeys the prompt-plan format: the plain-language block opens it with nothing above it and
      carries no path, identifier, protocol name, or unexpanded abbreviation; the note to the executor
      is second and states the tick-the-boxes rule; the stage checklist is grouped and its last stage
      is the documentation update; nowhere does the text describe a transition from old to new.
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
