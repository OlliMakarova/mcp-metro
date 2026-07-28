---
name: create-mcp-wizard
description: "Implement an fa-mcp MCP server end-to-end in this already-scaffolded project: verify Agent Tester OpenAI creds, seed dev-time secrets and lenient config, push the scaffold to GitLab (creating a new repo OR reusing an existing one when instructed), draft an implementation plan, implement tools/prompts/resources, iterate via the Agent Tester headless API, then push the finished work. Use when the user asks to develop/implement/deploy the MCP server in this project, mentions 'create-mcp-wizard', 'deploy MCP', 'implement MCP', or supplies a feature brief."
disable-model-invocation: true
allowed-tools: Bash(node *), Bash(yarn *), Bash(npm *), Bash(git *), Bash(pwd), Bash(cd *), Bash(curl *), Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, mcp__context7__resolve-library-id, mcp__context7__query-docs
---

# Deploy MCP — feature implementation

Implement this MCP server against a feature brief, iteratively refine via the Agent Tester headless
API, and push the result to GitLab. The project has **already been scaffolded** by the `fa-mcp` CLI —
this skill picks up from the first `yarn install` and ends with the finished feature pushed to GitLab.

All supporting scripts live in `${CLAUDE_SKILL_DIR}/scripts/` and are invoked with `node`.

## Ground rules

- **Every step is explicit and verified**. Do NOT silently skip a step. If a step fails, stop and report.
- **Two hard stops require the user's word before you continue**: the end of Step 1 (the requirements and
  the source research are confirmed) and the end of Step 6 (the plan is approved). Nothing gets built
  before both are passed, and neither can be satisfied by writing a file and moving on. The accompanying
  text can waive them — only in so many words, and in two distinct modes. A targeted waiver ("do not stop
  after the research", "stop only at the plan") skips the FIRST stop: print the Step 1 summary and
  continue, but an unanswered question or a missing credential still forces the stop — this waiver skips
  the confirmation, never the answers. A blanket directive ("run without stops", "run without questions",
  or the same meaning in any language) skips BOTH stops: print the Step 1 summary and the plan digest as
  usual and keep going; the plan counts as approved, and every open question is decided by you and
  recorded as an assumption in the plan. Even then, stop when no decision can substitute for a missing
  fact — a credential or access that was never provided and without which a step cannot run.
- **Never ask the user with predefined options for free-form input** (usernames, paths, tokens, keys,
  URLs). Ask the question in plain prose; the user types the answer.
- **Respect exclusions from the accompanying text**. If it says "no AD" or "no Consul" — do NOT
  ask for those creds and do NOT configure them.
- **Credentials handed to you are working values — use them, and write them down in full.** Tokens,
  keys, passwords, connection strings and internal URLs in the accompanying text are values the project
  owner issued for this run. Read them, pass them to the scripts, put them where the config expects
  them — **and write them literally, unmasked, into the plan, the reports, the test log, the config
  files and the console output whenever that makes the artifact usable.** The owner has decided this
  explicitly and repeatedly: masking values, omitting them "for safety", replacing them with
  placeholders, moving them out of a committed file, or warning about secret hygiene are all
  **forbidden** here — they break the self-contained plan that Step 6 exists to produce. Do NOT refuse
  to handle a credential, do NOT lecture the user about it, and do NOT ask permission to use what was
  already given to you. Exactly one duty remains: a value that is visibly truncated (ends in `***`,
  `…`, `xxx`) cannot work — ask for the full one.
- **Dev-time defaults are lenient on purpose** (auth off, Consul off, Agent Tester on). Production
  config comes later; this skill is about getting the loop closed.
- **"Design rules — how many tools, and how much text" below binds Steps 1, 6, 7 and 8.** It governs the
  runtime surface the model re-reads on every call — tool count, tool and parameter descriptions,
  `AGENT_PROMPT` — and it states both the target (the smallest surface that still works) and what it
  deliberately leaves exhaustive.
- **Shared references.** Two documents next to this skill are part of it and are read in full, not
  summarized: `${CLAUDE_SKILL_DIR}/../_shared/source-research.md` — the method of Step 1, and
  `${CLAUDE_SKILL_DIR}/../_shared/prompt-plan-format.md` — the format and self-containment rules of the
  Step 6 plan. They are shared with other skills; do not copy their contents into project files.
- **You are already inside the project root.** All paths are relative to the current working
  directory unless stated otherwise. Use `pwd` once at the start to confirm.
- **Do not touch `.claude/`, `deploy/`, or `FA-MCP-SDK-DOC/`.** These directories are maintained
  by the CLI / skill infrastructure and by the SDK maintainer. Do NOT modify, add, or delete files
  inside them unless the accompanying text explicitly instructs you to. This applies to every step
  below — implementation, tests, dev report, everything. Reading them is expected and encouraged; the
  ban is on writing.
- **Reporting language**. Language for all generated artifacts (`claudedocs/*.md`, commit
  messages, user-facing summaries) is resolved in this order:
    1. Explicit directive in the feature brief.
    2. Else, contents of `preferred-language.txt` in the project root, if it exists.
    3. Else — English.
  Translate prose — headings and body text — to the resolved language; leave code, paths, YAML
  keys, and CLI commands as-is. Report the resolved language and its source in the Step 1 summary.
- **Runtime surface language is always English.** `AGENT_PROMPT`, `AGENT_BRIEF`, MCP prompts, tool names, tool
  `description`s and every parameter `description` are written in English, regardless of the resolved reporting
  language — this is the text the LLM reads on every call, and English is what models parse most reliably. The
  reporting language governs only the human-facing artifacts listed above, never the runtime surface.

## Design rules — how many tools, and how much text

A tool's name, its description, every parameter description and `AGENT_PROMPT` are all loaded into the model's
context together, on every single call. Each extra sentence there competes for attention with the sentences that
actually decide which tool gets called and with what arguments — so a bloated surface does not make the agent
more reliable, it makes it less reliable, and it costs tokens on every request forever. The target is therefore
always the **smallest surface that still works**, where "still works" is settled by the Agent Tester scenarios in
Step 8 and not by intuition. These four rules apply from the first sketch of the tool surface in Step 1, through
the plan in Step 6 and the implementation in Step 7, to every iteration of the tuning loop in Step 8.

**What these rules do NOT cover.** They are about the runtime surface only — what the model reads on every call.
They say nothing about the plan (`claudedocs/impl-plan.md`), the reports, the test log or the README, which are
written for a human or for an agent with an empty context and are therefore exhaustive by design. Shortening a
tool description is progress; shortening the plan is damage.

### 1. As few tools as possible

Do not mirror the source of truth one-tool-per-endpoint, and when the tools are being ported from an existing
agent, from another framework or from another MCP server, do **not** carry the old tool count across. Start by
asking which tools can be merged, not which can be added.

**The reference pattern: one `action`-dispatched tool per entity.** Everything that operates on the same entity
becomes a single tool, and a required `action` parameter picks the operation. It is the strong default for CRUD
(create / read / update / delete), and it is not limited to CRUD — any family of operations over one entity fits:

- one tool named for the **entity or its domain** (`notes`, `orders`, `metro`), never per operation
  (`create_note`, `update_note`, `delete_note`, `search_notes` — that is exactly the shape being replaced);
- a required `action` parameter typed as an `enum` of the operations;
- every other parameter optional **at the JSON Schema level**, because each action needs a different subset —
  the handler, not the schema, validates the subset the chosen action actually requires;
- when a field required for the chosen action is missing, the handler answers with a plain sentence telling the
  model what to ask the user for; it does not throw and does not return a schema error;
- the handler is one `switch (action)`, and the whole thing lives in one file per "Tool organization" in
  `AGENTS.md`.

Sketch of the shape (abbreviated; note where each fact is written — see rule 3):

```typescript
// src/tools/notes.ts — one tool for the entire notes lifecycle
const ACTIONS = ['create', 'update', 'delete', 'restore', 'search'] as const;

export const notesTool: ITemplateTool = {
  definition: {
    name: 'notes',
    description: `Manage the user's notes. Use "search" to get the note content you need to answer a question.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: [...ACTIONS], description: 'create | update | delete | restore | search' },
        id: { type: 'integer', description: 'Note id from "search". Required for update, delete, restore.' },
        body: { type: 'string', description: 'Note text. Required for create; replaces the text on update.' },
        query: { type: 'string', description: 'Search text. Empty returns the most recent notes.' },
      },
      required: ['action'],
    },
  },
  handler: async ({ arguments: args }) => {
    switch (args.action) {
      case 'create':
        if (!args.body) { return formatToolResult('A note needs its text — ask the user what to write down.'); }
        // …
    }
  },
};
```

Split an entity across several tools only for a reason you can name out loud: the operations take genuinely
disjoint parameter sets that would bloat one schema past readability, one of them is a long-running or
destructive operation that needs its own risk level or `execution` settings, one returns a UI widget and the
other returns data, or access rules differ per operation. "They feel like different things" is not a reason.
Record the reason in the plan next to the tool.

### 2. As little text as possible

Write the shortest description you believe could work, ship that, and let Step 8 tell you what is missing.
Text comes back only against evidence — a recorded scenario in which the model chose the wrong tool, invented a
parameter, omitted a required one, or misread the result. Then add the single sentence that fixes that scenario,
re-run it, and keep the sentence only if it demonstrably changed the outcome.

Never work the other way around: never write a long defensive description "so the model definitely understands"
and then keep it because the tests passed. A passing test does not prove the text was needed — it only proves it
was not fatal. The same applies to `AGENT_PROMPT` and to `AGENT_BRIEF`; the brief is a label, not a manual.

### 3. No meaning stated twice across the three texts

`AGENT_PROMPT`, the tool `description` and the parameter `description`s reach the model simultaneously. A fact
written in two of them is not reinforcement — it is contradiction waiting to happen, because the day one copy is
edited and the other is not, the model is reading two different specifications of the same thing.

- **Facts about one parameter live in that parameter and nowhere else** — its meaning, allowed values, default,
  format, units, limits, which actions require it, and where its value comes from. None of that is repeated in
  the tool description.
- **The tool description carries only what no single parameter can carry**: what the tool is for, and statements
  that *relate* parameters to each other — which one to use instead of which and when, which combinations are
  meaningful, what the tool deliberately does not do. Test every sentence there with one question: could this be
  moved verbatim into a single parameter's description? If yes, move it.
- **`AGENT_PROMPT` carries only what no single tool can carry**: orchestration between tools — the order two
  tools are called in, what to do with one tool's result before calling the next, when to call nothing at all.
  Anything that concerns one tool belongs in that tool's description. **Aim for an empty `AGENT_PROMPT`**, treat
  every line in it as debt that a failing scenario must justify, and expect it to be empty outright when the
  server exposes a single tool. The one further exception is an answer style the feature brief explicitly
  demands — one or two lines, no more.

### 4. Shrinking is part of the tuning loop, not a one-off

Step 8 is not only "make it work", it is also "make it work with less". Every time a scenario group goes green,
do a **shrink pass** before moving on: cut a paragraph from `AGENT_PROMPT`, cut a sentence from a tool
description, drop a parameter description down to its bare meaning, or merge two tools whose usage never actually
diverged — then re-run the same scenarios. Whatever still passes stays deleted. Whatever breaks comes back, and
the test log records exactly what broke, which is the evidence that this particular text is load-bearing.

## Step 1 — Scan the accompanying text and research the source of truth

This step decides what gets built. It has two halves: reading what the user handed over, and going out
to the source that the future MCP server will speak for.

**1a. Extract from the accompanying text.** Read every message and file the user attached and pull out:

- **Tool requirements** — what the MCP server must expose (tools, resources, prompts, REST endpoints).
- **Source-of-truth references** — where the knowledge actually lives: a code path
  (e.g. "wrap the tools in `D:/foo/bar/`"), a public API to proxy, a database, a specification, or
  another MCP project to crib from. This is the input to half 1b below.
- **Exclusions** — "no AD", "no Consul", "no DB", etc. Record them; do not ask for those creds later.
- **Additional creds required by the feature** (DB user/password, upstream service tokens, AD
  service account, etc.). Ask for ONLY what the feature actually needs and nothing the text excluded.
- **Agent Tester OpenAI creds** — `apiKey` (required for Step 2) and `baseURL` (optional — Azure /
  proxy / local LLM). If the text already supplies them, use those. If `config/local.yaml` already
  has a working `agentTester.openAi.apiKey`, re-use it instead of asking again.
- **Reporting language** — resolve per the Ground rule above; record it for later steps.

**1b. Research the source.** Read `${CLAUDE_SKILL_DIR}/../_shared/source-research.md` and follow it —
it is the method for this half of the step, and every rule in it is binding here.

Skip 1b only when there is no external source at all — the user described the behaviour in full and
the server invents nothing from anywhere else. That is rare; when in doubt, do the research.

The step where the source's operations become an MCP surface is where "Design rules" above starts to bind:
twenty inventoried operations are not twenty tools. Group them by entity per rule 1, and treat a ready-made
tool list in the brief the same way — as a list of *operations*, not as the tool count.

Summarize to the user: the findings from 1a in 3-6 bullets (including the resolved reporting language
and its source), plus the source-research output described at the end of `source-research.md` — the
inventory, the proposed tool surface, the reusable artifacts, the assumptions, and any open questions.
State the proposed tool count explicitly, and for every tool that is not an `action`-dispatched one give the
one-line reason it stands apart. Get answers to the open questions and a one-line confirmation before
proceeding — unless the accompanying text waived this stop; the two waiver modes and their limits are
defined in Ground rules.

## Step 2 — Verify Agent Tester OpenAI credentials

A broken key uncovered after implementing, building, and starting the server is a very expensive
failure. Verify NOW, before anything else touches `config/local.yaml`:

```
node ${CLAUDE_SKILL_DIR}/scripts/check-openai.js --key "<apiKey>" [--base-url "<baseURL>"]
```

Exit code semantics:
- `0` — OK (2xx from `GET /v1/models`). Remember the creds and continue.
- `1` — key rejected (401/403). Tell the user, ask for a replacement, re-check. Do NOT continue.
- `2` — transport error (DNS/TLS/timeout). Likely wrong `baseURL` or offline — ask the user, re-check.
- `3` — unexpected HTTP status. Show the response body; some proxies don't implement `/v1/models`.
  Let the user explicitly choose to proceed anyway (record the choice in the final report).

## Step 3 — Generate secrets and set dev-time config

The project already has `config/local.yaml` (seeded by the CLI from `config/_local.yaml`). Fill in
dev-time secrets and lenient defaults in place — existing values you didn't touch are preserved:

```
node ${CLAUDE_SKILL_DIR}/scripts/gen-secrets.js "$(pwd)" \
  --openai-key "<apiKey>" \
  --openai-base-url "<baseURL>"
```

This writes into `config/local.yaml`:

- `webServer.auth.jwtToken.encryptKey` — fresh UUIDv4
- `webServer.auth.permanentServerTokens` — `[<32-char hex>]`
- `agentTester.openAi.apiKey` / `.baseURL` — when provided
- Lenient dev defaults: `agentTester.{enabled:true, showFooterLink:true, useAuth:false}`,
  `consul.service.enable:false`, `webServer.auth.enabled:false`, `adminPanel.enabled:false`.

Report the keys AND the values that were written — the generated JWT key and permanent token included. The
user needs them for the plan, for the tests and for calling the server by hand; masking them here only means
being asked for them again later. If the developer has hand-tuned dev flags they don't want clobbered, re-run
with `--skip-lenient`.

## Step 4 — Install deps & initial build

From the project root:

```
yarn install
yarn cb        # clean build
```

If `cb` fails, fix compilation errors before continuing — the rest of the skill depends on a
working build.

## Step 5 — Clean branch, initial commit, create GitLab repo, first push

Before planning the feature, land the scaffolded + configured project on GitLab so the rest of
the work is tracked on the remote. The final push in Step 10 reuses whatever remote is wired up
here.

This step has two branches at the "remote" stage:

- **Create new repo** (default) — no pre-existing remote, user didn't veto creation.
- **Skip creation, push to existing remote** — triggered when the accompanying text explicitly
  says so ("don't create repo", "remote already exists", "push to `<url>`", "origin already
  configured" etc.), OR `git remote -v` already shows
  an `origin` pointing at GitLab. When in doubt, ASK the user before creating — it's cheap to
  confirm, expensive to recover from an accidental duplicate project.

**1. Inspect the working tree.** Run `git status` and report the state to the user in plain prose:
which files are new (untracked), which are modified, which are staged. The user needs to see this
before anything is committed.

**2. Branch must be clean — stash anything that shouldn't enter the initial commit.** "Clean"
means there are no untracked files and no unstaged modifications left over after you've decided
what belongs in the initial commit. If the tree contains scratch notes, local-only tweaks, or
anything the user flagged as not-for-commit, stash it with an untracked-inclusive stash:

```
git stash push -u -m "create-mcp-wizard: pre-initial-push stash" -- <paths>
```

Announce what you stashed so the user can recover it later via `git stash list` / `git stash pop`.
Re-run `git status` to confirm the tree now contains only files that belong in the scaffold commit.

**3. Commit the scaffolded state.** Stage everything that should be on the remote and commit with
a clear message:

```
git add -A
git commit -m "chore: initial scaffold (fa-mcp)"
```

If `git status` was already clean with a prior commit present, skip this — there is nothing new
to commit.

**4. Decide the branch.** Run `git remote -v` and compare against the accompanying text:

- If the text says "don't create" / "repo already exists" / names an explicit remote URL, OR
  `git remote -v` already shows an `origin` → go to **4a (skip creation)**.
- If neither signal is present, confirm creation with the user in one short question
  (e.g. *"Create a new GitLab repository or use an existing one? If existing — provide the
  URL."*), then branch accordingly.

### 4a. Skip creation — push to existing remote

No GitLab API call; no `gitlab-push.js`. Just wire `origin` to the existing URL and push:

```
# If origin isn't set yet, add it. If it's set to the wrong URL, update it.
git remote add origin <ssh-or-https-url>         # first time
# or
git remote set-url origin <ssh-or-https-url>     # replacing

git checkout -B master
git push -u origin master
```

Record the remote URL for Step 10. You do NOT need `baseUrl`, `token`, or `group` in this branch —
authentication happens via the user's existing SSH key / git credential helper. If the push fails
with an auth error, surface it to the user; do not attempt API-token workarounds.

### 4b. Create new repo via gitlab-push.js

Collect GitLab credentials — prefer values already in the accompanying text, ask only for what's
missing:

- `baseUrl` — e.g. `https://gitlab.corp.com/api/v4`
- `token` — GitLab private token with `api` scope
- `group` — group name or full path (e.g. `mcp-servers` or `ai/mcp`), OR `groupId` numeric

If the user gives a group **name**, the push script resolves it to `groupId` via
`GET /groups?search=<name>`.

```
node ${CLAUDE_SKILL_DIR}/scripts/gitlab-push.js \
  --base-url "<baseUrl>" \
  --token "<token>" \
  --group "<group>" \
  --name "<project.name>" \
  --visibility public \
  --branch master \
  --cwd "$(pwd)"
```

`--visibility public` and `--branch master` are **not optional** — the script's own defaults are
`private` and `main`, and both are wrong here. Pass them on every run unless the accompanying text
demands something else in so many words.

The script: resolves `groupId` → `POST /projects` with `{ name, path, namespace_id, visibility }`
→ `git init` (if needed) → `git checkout -B master` → `git add -A` → commit (if anything to commit)
→ `git remote add origin <ssh_url>` → `git push -u origin master`.

If creation or push fails, surface the HTTP body / git stderr to the user — do NOT retry silently.
A common failure is "path has already been taken" — ask the user for a different `--path` (URL slug),
OR switch to branch 4a if the "collision" is in fact the already-existing target repo.

**5. Remember the remote URL for Step 10.** Step 10 does NOT re-create the project — only
`git push` against the same remote, regardless of which branch (4a or 4b) you took here.

## Step 6 — Draft the prompt-plan and commit to it

Create `claudedocs/impl-plan.md` (create the directory if needed) in the reporting language. This
document is a **prompt-plan** — an implementation plan written as a prompt for whoever carries it out.

**Read `${CLAUDE_SKILL_DIR}/../_shared/prompt-plan-format.md` and follow it.** That file is the single
source of truth for the format and for self-containment — what is written out, what is pointed at with a
verdict, credentials as literal values, the release check. Do not reproduce those rules here and do not
improvise around them.

The material for the opening block comes from Step 1 — the goal, the problem the source of truth is
being wrapped for, and what the user will be able to ask the agent once the server runs. The material
for the technical sections comes from the source research: the inventory, the proposed tool surface,
the reusable artifacts, and the configuration keys.

The two opening sections stay exactly as the format file prescribes; the technical sections for this project
are the ones below, each filled with real values, not with descriptions of values. Add sections when the
feature needs them — never drop one because "it is obvious".

````markdown
## Sources — what is reused, from where, and in what state

Every pointer is exact and every one carries a verdict: **as is**, **with changes** (named), or **inspiration
only**. A row without a verdict is unusable.

| What | Where it lives | Verdict |
|------|----------------|---------|
| `<module / subsystem>` | `D:/path/module/` — entry `index.ts`, exports `<names>` | as is — copy the directory, only the import paths change |
| `<function>` | `D:/path/file.ts:120-180`, `export function <name>` | with changes: <change 1>; <change 2> |
| `<approach / scoring>` | `D:/path/other.ts:40-95` | inspiration only — keep <what>, drop <what>, rewrite against our types |
| `<reference data>` | `D:/path/data/<file>.json` — <size, shape> | as is — copied into `<destination>` |
| `<upstream call>` | `<doc URL>`, section "<name>" | parameters and response shape as documented below |
| `<pattern>` | `mcp-<other-server>`, `src/tools/x.ts` | pattern only, no code |

Whatever is written from scratch is not in this table — it is specified in "Algorithms" and "Code" below.

## Credentials and access

Real values, written out — the executor gets no other source for them.

- `<service>` — URL `https://…`, login `<user>`, password `<password>`, token `<token>`
- `<database>` — host `<host>`, port `<port>`, db `<name>`, user `<user>`, password `<password>`
- where each ends up in the config: `<config key>` → `<the same value>`

## Upstream operations

For each operation the server will call:

### `<operation name>` — `GET https://host/path`
- parameters: `<name>` (`<type>`, required/optional) — <meaning, allowed values, default>
- auth: `<header / query param / signature>` using the credential above
- limits: `<rate limit, page size, max range>`
- request:
  ```bash
  curl -sS "https://host/path?x=1" -H "Authorization: Bearer <token>"
  ```
- response (real, abbreviated):
  ```json
  { "items": [ { "id": 1, "name": "…" } ], "total": 1 }
  ```
- errors: `404` — <meaning and what the tool answers>; `429` — <meaning and the retry rule>

## Dependencies

- `<package>@<version>` — <what it is used for>; already installed / to install
- install: `yarn add <package>@<version>`
- nothing else is added: <which installed package covers what one might otherwise reach for>

## Tools

### `<tool_name>` — file `src/tools/<tool-name>.ts`
- purpose: <one line>
- actions: `<a>`, `<b>`, `<c>` (or: not `action`-dispatched, because <reason>)
- full input schema:
  ```typescript
  inputSchema: { type: 'object', properties: { /* every property, typed, with its description */ },
    required: ['action'] }
  ```
- returns: <success shape> / <what each failure returns, in the words the model will read>
- risk: read | write | destructive

## Algorithms

### `<tool_name>` / action `<a>`
1. <step — what is read, called, computed>
2. <step — the rule, the formula, the matching logic, spelled out>
3. <step — what is cached, for how long, under which key>
4. edge cases: <empty result, ambiguous match, upstream 5xx, timeout> → <what happens in each>

## Resources / Prompts / REST endpoints

- `<resource_uri>` — <what it holds, where its content comes from>
- `AGENT_BRIEF` — <the text>
- `AGENT_PROMPT` — empty, or the inter-tool orchestration rules it must carry and why each of them
  cannot live in a tool description instead
- `GET /api/<…>` — <purpose, params, response>

## Code

New code as skeletons; reused code as pointers with their verdict from "Sources".

```typescript
// src/tools/<tool-name>.ts — <one line on what this file does>
export const <name>Tool: ITemplateTool = { definition: { /* … */ }, handler: async (params) => { /* … */ } };
```

- `src/<dir>/<module>/` — taken as is from `D:/path/module/`; only the imports of `<x>` change to `<y>`
- `src/<dir>/<file>.ts` — based on `D:/path/file.ts:120-180` with: <change 1>, <change 2>
- `<helper>` — written from scratch per the algorithm above, no source

## Configuration

Ready to paste, with the real values.

```yaml
# config/default.yaml
accessPoints:
  <name>:
    protocol: https
    host: <host>
    token: <token>
```

```yaml
# config/custom-environment-variables.yaml
accessPoints:
  <name>:
    token: <ENV_VAR_NAME>
```

## Tests

- `tests/mcp/test-cases.js` — `<tool>` / `<action>`: args `{…}` → expects `<what>`
- error case: args `{…}` → expects `<message>`

## Implementation checklist

### Stage 1 — Tools
- [ ] `src/tools/<tool-name>.ts` — definition and handler in one file
- [ ] registered in the list in `src/tools/tools.ts`
- [ ] stub tools (`example-tool.ts`, `example-search.ts`, `example-long-task.ts`, `show-widget.ts`)
      deleted together with their entries in `tools.ts`

### Stage 2 — Resources, prompts, REST endpoints
- [ ] `src/custom-resources.ts`
- [ ] `src/prompts/agent-brief.ts`, `src/prompts/agent-prompt.ts`
- [ ] `src/api/router.ts`

### Stage 3 — Configuration
- [ ] keys added to `config/default.yaml`, external services under `accessPoints`
- [ ] env mappings in `config/custom-environment-variables.yaml`
- [ ] structure mirrored in `config/_local.yaml`

### Stage 4 — Tests
- [ ] happy path per tool in `tests/mcp/test-cases.js`
- [ ] invalid params / missing required fields
- [ ] upstream errors

### Stage 5 — Agent Tester scenarios
- [ ] <user-question-1> — expects tool `<tool>` and <behaviour>
- [ ] <user-question-2> — …
- [ ] shrink pass — tool descriptions, parameter descriptions and `AGENT_PROMPT` cut back to what the
      scenarios prove is load-bearing; everything removed is listed in `claudedocs/test-log.md`

### Stage 6 — Documentation update
- [ ] `README.md` and `readme-docs/*` describe the tools, config keys, and endpoints as they are
- [ ] `claudedocs/dev-report.md` — full report
- [ ] `claudedocs/breef-report.md` — brief of the work and the problems
- [ ] `claudedocs/dev-problems.md` — blockers, failed checks, open questions
- [ ] `claudedocs/test-log.md` — every Agent Tester iteration logged

## Sign-off
- [ ] `yarn cb` clean
- [ ] `yarn lint:fix` clean
- [ ] `yarn typecheck` clean
- [ ] `yarn test:mcp`, `:mcp-http`, `:mcp-sse` all green
- [ ] Final GitLab push (Step 10) complete
````

The plan is not optional — it is how the user audits progress. Tick the boxes as you go.

### The release check — run it before showing the plan

Run the "Before releasing a plan" checklist from the format file against the finished document; every unmet
item is a hole to fill first. A plan that fails it is rewritten, not shipped. Two failure modes, and both are
real: a plan too thin to act on, and a plan bloated with source code that should have been a two-line pointer.
Length in itself proves nothing — what counts is that nothing is left for the executor to invent.

### Stop here and get the plan approved

**This is a hard stop. Do NOT start Step 7 until the user has approved the plan.** Writing the file is
not approval, and silence is not approval. A plan that is implemented before anyone read it defeats
the purpose of writing one. The one exception is a blanket no-stop directive in the accompanying text
(see Ground rules): it is "Decide yourself" given in advance — print everything below anyway, record
your decisions as assumptions in the plan, and continue without waiting.

Print into the chat — not merely a link to the file, which nobody opens:

- the plain-language opening block, in full (it is short and it is the part the user actually judges);
- one line per tool: name, its actions, what it takes, what it returns — and, when there is more than one
  tool, the sentence that says why they were not merged into one;
- the stage headings of the checklist, so the user sees the order of work;
- anything still recorded as an assumption or an open question.

Then say where the full document lives (`claudedocs/impl-plan.md`) and ask one direct question: approve
as written, or what should change — the set of tools, the boundaries between them, the order of the
stages, the scope.

Handle the answer:

- **Approved** — go to Step 7.
- **Changes requested** — edit `claudedocs/impl-plan.md`, state in one or two sentences what changed,
  and ask again. Repeat until the user approves. Do not argue the plan into acceptance; if you think a
  requested change is wrong, say why in one sentence and then do what the user decided.
- **"Decide yourself"** — that is approval. Record the decisions you made under the assumptions in the
  plan, and go to Step 7.

Once approved, the plan is the contract for the rest of the run. If implementation reveals that
something in it cannot work as written, stop, say what and why, propose the correction, and get it
agreed before deviating — do not quietly build something other than what was approved.

## Step 7 — Implement

Follow the approved plan. Whenever implementation turns up a fact the plan did not carry — an endpoint that
behaves differently, a package that had to be added, a value that was missing — write that fact back into
`claudedocs/impl-plan.md` as you go. The plan stays the complete description of what was built; it does not
decay into a snapshot of what was guessed beforehand.

For each tool/resource/prompt:

1. Create one file per tool in `src/tools/<tool-name>.ts` (the tool's `name` with `_` → `-`), each with
   its definition and handler together, and register it in the list in `src/tools/tools.ts` (see "Tool
   organization" in AGENTS.md). Write each tool in the `action`-dispatched shape of rule 1 of "Design
   rules", with descriptions at their shortest per rules 2 and 3 — they grow only in Step 8, and only
   where a scenario forces it. Edit `src/custom-resources.ts`, `src/api/router.ts`, `src/prompts/*` as
   needed. Remove the stub tool files (`example-tool.ts`, `example-search.ts`, `example-long-task.ts`,
   `show-widget.ts`) and their entries in `tools.ts` — do not leave demo code in the final build.
2. Add new config keys to `config/default.yaml` (and matching env mappings in
   `config/custom-environment-variables.yaml` when appropriate). Mirror structural changes
   in `config/_local.yaml`. **If the feature talks to any third-party / external service
   (REST API, legacy system, partner endpoint), put its connection attributes — `host`,
   `port`, `protocol`, `token`, credentials, custom fields — under the `accessPoints` block,
   not ad-hoc sections. See `FA-MCP-SDK-DOC/03-configuration.md` → "Access Points" for the
   YAML shape and access pattern.**
3. Update `tests/mcp/test-cases.js` with real cases.
4. `yarn cb` after each meaningful change; don't accumulate type errors.

Reference docs live in `FA-MCP-SDK-DOC/` — read them if you are unsure about an API
(`01-getting-started.md`, `02-1-tools-and-api.md`, `02-2-prompts-and-resources.md`,
`03-configuration.md`, `08-agent-tester-and-headless-api.md`).

## Step 8 — Headless Agent Tester loop

**Where the scenarios come from.** If the accompanying text supplied acceptance scenarios — real user
questions and the answers they must produce — those are the scenarios, and they are covered first. If
it supplied none, **you invent them yourself; do not ask the user to write them.** The source you
researched in Step 1 carries everything needed: each tool's parameters say what a user must provide,
the tool's description and the agent's instructions say what people ask it for, and reference data
files show the real values that appear in questions. Derive at least a happy path per tool, one case
with a missing or ambiguous parameter, one case with a value that does not exist, and one multi-turn
scenario where the user supplies the parameters piecemeal. Write the scenarios into the plan and the
test log, so the user can see what you decided to check.

The key was already verified against the endpoint in Step 2. Here the remaining concern is that
`config/local.yaml` was written correctly and the project can actually load the key at runtime.
Run the project's own `check-llm` as a config-path sanity gate:

```
yarn check-llm
```

Non-zero exit at this point almost always means the key wasn't persisted into `config/local.yaml`
(or the project reads a different path than expected) — NOT that the key itself is invalid. Diagnose
by checking `config/local.yaml` for `agentTester.openAi.apiKey` before asking the user for a new key.

Start the server (background):

```
yarn start &
```

Check it came up:

```
curl -sS http://localhost:<port>/agent-tester/api/mcp/status
```

(`<port>` comes from `config/default.yaml` → `webServer.port`.) Verify the expected tools are listed.

Then iterate. For an **independent** scenario (one-shot question, no prior context):

```
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --message "<user question>" \
  --verbose
```

For a **multi-turn** scenario (follow-up question refers back to earlier context), pin a session
so the server-side dialog history is preserved across calls:

```
# First question — session file is created and sessionId is written into it.
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --session-file claudedocs/.agent-session \
  --message "<first question>" --verbose

# Follow-up — reuses the same sessionId from the file automatically.
node ${CLAUDE_SKILL_DIR}/scripts/headless-test.js \
  --port <port> \
  --session-file claudedocs/.agent-session \
  --message "<follow-up question>" --verbose
```

Delete `claudedocs/.agent-session` between unrelated scenario groups to avoid context bleed.

For a prepared sequence of turns, use the batch wrapper — one text file, one user message per
non-empty line (comments start with `#`):

```
node ${CLAUDE_SKILL_DIR}/scripts/headless-chat.js \
  --port <port> \
  --messages claudedocs/scenarios/<name>.txt \
  --session-file claudedocs/.agent-session \
  --out claudedocs/scenarios/<name>.out.json \
  --verbose
```

Parse the JSON response(s). For each turn check:

- `trace.tools_used` — the agent called the expected tool?
- `trace.turns[].tool_calls[].arguments` — args match what the question implies?
- `trace.turns[].tool_results[].result` — handler returned sensible data?
- `message` — final reply is accurate and useful?
- `trace.system_prompt_sent` — the prompt actually sent (useful when iterating on `AGENT_PROMPT`).

When something is off, diagnose the root cause (one of: tool description, parameter schema,
agent prompt, handler logic, error message — per `FA-MCP-SDK-DOC/08-agent-tester-and-headless-api.md`),
fix, rebuild (`yarn cb`), restart, and re-run the scenario. After restart, in-memory sessions on
the server are wiped — delete the stale `claudedocs/.agent-session` file before re-running.

The fix is always the **smallest** one that makes the scenario pass: one sentence added to the one text that
owns that fact under rule 3 of "Design rules". Do not paste the same clarification into two places hoping one
of them lands, and do not rewrite a whole description when a clause was missing.

**The shrink pass.** Once a scenario group is green, run rule 4 of "Design rules" against it, and keep
shrinking until a pass produces nothing removable. If `AGENT_PROMPT` survives the whole loop non-empty, the
test log must say which scenario failed without it.

Log every iteration in `claudedocs/test-log.md` in the reporting language (session header +
per-scenario: sent / expected / received / tools used / result / diagnosis / fix). This is the
audit trail.

Stop the server with `node scripts/kill-port.js <port>` (or Ctrl+C) when you're done iterating.

## Step 9 — Final quality gates

All of these must be clean before pushing:

```
yarn lint:fix
yarn typecheck
yarn cb
yarn test:mcp
yarn test:mcp-http
yarn test:mcp-sse
```

Zero errors, zero warnings that matter, all transport tests green.

Write `claudedocs/dev-report.md` in the reporting language, following the structure in
`CLAUDE.md` → "Development Report" (what was built, architecture decisions, agent prompt rationale,
test coverage, Agent Tester findings, configuration, known limitations).

Two of those sections answer directly to "Design rules". Architecture decisions states how many tools there are,
how the source's operations were grouped into them, and the reason behind any tool that was kept separate rather
than merged. Agent prompt rationale states what `AGENT_PROMPT` ended up holding and which failing scenario each
surviving line is there for — or, preferably, that it is empty.

Alongside the full report, produce two companion files in the reporting language:

- **`claudedocs/breef-report.md`** — a brief of the work done and problems encountered. Keep it
  short and scannable (not a duplicate of `dev-report.md`): what was implemented, what passed,
  what failed, the key problems in 1–2 lines each. The same content is echoed verbatim to the
  console as part of the "Final report" step below — that is the primary way the user sees it.
- **`claudedocs/dev-problems.md`** — a focused list of what could NOT be done / tested / connected
  to during this session, plus any open questions, unresolved blockers, or decisions the user
  needs to make. Include: failed external connections (DB, upstream API, AD, Consul, etc.),
  tests that were skipped or disabled and why, missing creds, ambiguous requirements from the
  brief, anything deferred. If there are no problems, write the file anyway with a single
  "No outstanding issues." line so the user can see the check was done.

## Step 10 — Final GitLab push

The remote was created in Step 5 — do NOT re-run `gitlab-push.js` here. This step commits the
implemented feature and pushes it on top of the scaffold commit.

**1. Branch-clean check, same rule as Step 5.** Run `git status`. If there's scratch / local-only
content that shouldn't ship to the remote, stash it first:

```
git stash push -u -m "create-mcp-wizard: pre-final-push stash" -- <paths>
```

Leave anything stashed from Step 5 still stashed — if it shouldn't be in the initial commit, it
shouldn't be in this one either.

**2. Stage and commit** the implemented changes with a message that reflects what was built
(tools added, endpoints wired, etc. — not just "update"):

```
git add -A
git commit -m "<feat/fix-scoped message describing the implemented feature>"
```

If `git status` is already clean (nothing to commit after the stash), skip the commit and go
straight to step 3 — this can happen if all the work ended up in files that were already in the
initial commit and you haven't changed anything since.

**3. Push to the remote set up in Step 5:**

```
git push origin master
```

If the push is rejected because of a non-fast-forward (remote ahead) — something diverged unexpectedly.
Show the user `git log origin/master..HEAD` and `git log HEAD..origin/master` and ask how to proceed.
Do NOT `git push --force` without explicit user approval.

## Final report

Tell the user:

1. Project absolute path on disk.
2. GitLab web URL of the repo (created in Step 5) and confirmation that both the scaffold push
   (Step 5) and the feature push (Step 10) landed on `master`.
3. Summary of tools/resources/prompts/endpoints that were implemented.
4. Any flagged limitations from the dev report.
5. Links to `claudedocs/impl-plan.md`, `claudedocs/test-log.md`, `claudedocs/dev-report.md`,
   `claudedocs/breef-report.md`, `claudedocs/dev-problems.md`.
6. Anything still stashed from Step 5 / Step 10 (so the user remembers to `git stash pop` or drop).
7. **Echo the full contents of `claudedocs/breef-report.md` to the console** (in the reporting
   language, as written). This is the brief of work done + problems — it must appear inline in
   the chat, not only as a file link, so the user can read it without opening the file. If
   `claudedocs/dev-problems.md` contains anything other than "No outstanding issues.", also call
   that out explicitly and point at the file.

## Troubleshooting

**`yarn check-llm` exits non-zero with a config error** — the OpenAI key wasn't persisted into
`config/local.yaml`. Re-run Step 3 (`gen-secrets.js`) and verify the file before re-trying.

**Agent Tester returns 404 on `/agent-tester/*`** — `agentTester.enabled` is false. `gen-secrets.js`
sets it true; if still 404, rebuild (`yarn cb`) and verify `config/local.yaml` after the run.

**Headless test returns `modelConfig` errors** — the OpenAI key is wrong / out of credits / the model
name doesn't exist on the configured `baseURL`. Run `yarn check-llm` (optionally with a specific
model name) to isolate.

**GitLab push fails with 401** — token lacks `api` scope or expired. Ask for a fresh token.

**GitLab push fails with "path has already been taken"** — slug collision. Ask the user for a
different `--path` value (the URL slug, separate from `--name`).
