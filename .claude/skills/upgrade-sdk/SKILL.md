---
name: upgrade-sdk
description: "Upgrade fa-mcp-sdk in the current project end-to-end: analyze the version diff, present an actionable execution plan, get user confirmation, then apply the upgrade automatically (deps, configs, code) — asking the user inline for any choices or values it needs. Falls back to a manual checklist only for items the LLM genuinely cannot perform. Use when user asks to upgrade/update fa-mcp-sdk, mentions 'обновить sdk', 'upgrade sdk', 'обновление fa-mcp-sdk', 'обнови sdk', or supplies versions to upgrade between."
disable-model-invocation: true
allowed-tools: Bash(yarn *) Bash(npm *) Bash(node *) Bash(git *) Bash(cat *) Bash(diff *) Bash(ls *) Bash(find *) Bash(mkdir *) Bash(cp *) Bash(mv *) Bash(rm *) Read Write Edit MultiEdit Glob Grep WebFetch Agent
argument-hint: "[from-version] [to-version] [language hint]"
---

# FA-MCP-SDK Upgrader

Execute an end-to-end upgrade of the `fa-mcp-sdk` dependency in the current project: analyze the diff between two
versions, present an actionable execution plan, get user confirmation, apply the changes automatically (asking for any
inputs needed along the way), verify, and report.

## Operating principle

**Maximize automation.** Do as much as possible inside this skill. The only items that should end up on a "manual"
checklist are those the LLM genuinely cannot perform from within this session (e.g. they depend on production secrets it
has no way to obtain, or on coordination with humans in external systems). When the LLM **can** perform a step but needs
information from the user — a credential, a config value with no sensible default, a choice between alternatives,
confirmation about overwriting a locally-customized file — it must **ask the user inline** rather than punt the task
to the manual list.

The user expects: confirm the plan → upgrade is fully done by the time the skill finishes. Failures must be reported
with concrete next-step options (retry, fix, roll back, leave-as-is) — never silently swallowed.

## Workflow at a glance

```
1. Parse arguments           → resolve FROM/TO refs
2. Validate refs             → fail fast on bogus versions
3. Preflight safety          → branch + uncommitted-changes check
4. Install TO into project   → run `install-target-sdk.mjs` (yarn add + copy update-sdk.js + run it)
5. Analyze diff              → categorize every change as Auto / Needs-Input / Manual
6. Build execution plan
7. PRESENT PLAN + CONFIRM    ← blocking gate; nothing else mutates until user says go
8. Execute Auto items, ask user inline for Needs-Input items as we reach them
9. Verify (build, lint, typecheck, tests, clean startup)
10. Report (chat + claudedocs/upgrade-sdk-<FROM>-to-<TO>.md)
```

## Step 1: Argument parsing

Parse `$ARGUMENTS` to extract a target version and an optional language hint.

### Language detection

Look anywhere in the arguments for a natural-language phrase indicating the desired output language:
- "на русском", "по-русски", "in Russian", "ru" → Russian
- "in English", "en" → English
- Any similar phrase or ISO 639-1 code.

Strip the language hint from the arguments before parsing versions. **Default: English** if no hint is found.

The detected language controls ALL human-readable text in the plan and the report (headings, prose, recommendations).
Technical content (file paths, YAML keys, code snippets, shell commands) stays as-is regardless of language.

### Version/commit references

After stripping the language hint, the remaining arguments are version or commit references.

An argument is a **commit hash** if it contains 7+ hex characters and does not match a semver pattern. Otherwise it is
a **version** (with or without `v` prefix — `0.4.30` and `v0.4.30` are equivalent).

#### Scope of references: PROJECT (default) vs SDK

**By default, versions and commit hashes refer to THIS project** (the repository where the skill is invoked), NOT to
fa-mcp-sdk. A reference is SDK-scoped ONLY if the user's phrasing explicitly says so. Trigger phrases (case-insensitive,
English or Russian):
- "sdk", "fa-mcp-sdk", "of sdk", "sdk commit", "sdk version"
- "sdk", "fa-mcp-sdk", "версия sdk", "комит sdk", "коммит sdk", "хеш sdk"

Examples:
- `/upgrade-sdk 1.2.3 1.2.7` → project versions (look up the SDK version pinned in each)
- `/upgrade-sdk от версии 0.2.3 SDK до 0.4.5 SDK` → SDK versions directly
- `/upgrade-sdk от комита sdk abc1234 до комита sdk def5678` → SDK commits directly
- `/upgrade-sdk abc1234 def5678` → project commits (look up the SDK version pinned in each)

#### Resolving PROJECT references to SDK versions

When a reference is PROJECT-scoped (the default), resolve it to an SDK version/commit before computing the diff:

1. **Project commit hash** — run `git show <hash>:package.json` and extract `fa-mcp-sdk` from `dependencies`.
2. **Project version** (e.g. `1.2.3`) — find the project git tag (`v1.2.3` or `1.2.3`), then `git show <tag>:package.json`.
3. If the dependency value is semver (`^0.4.30`, `~0.4.30`, `0.4.30`), strip range operators → exact SDK version.
4. If the dependency value is a git URL with a commit hash (e.g. `github:Bazilio-san/fa-mcp-sdk#abc1234`), extract the
   commit hash as the SDK ref.
5. If the project tag/commit cannot be found, report and stop.

Show the resolution result before proceeding:
```
Resolved project references to SDK:
  FROM: project <ref> → SDK <version-or-commit>
  TO:   project <ref> → SDK <version-or-commit>
```

#### Argument count

**Two arguments** — explicit FROM and TO (resolved per scope rules above).

**One argument** — it is treated as **FROM**; TO defaults to the **latest published fa-mcp-sdk** (fetched via
`yarn info fa-mcp-sdk version` or `npm view fa-mcp-sdk version`). Goal: upgrade to the newest existing release.

**Alternative TO=HEAD mode.** If the user explicitly says "to HEAD", "до HEAD", "до последнего коммита SDK",
"to latest commit", "до master", or supplies the literal `HEAD`/`master` as the second argument, TO becomes the
**tip of `master` on `Bazilio-san/fa-mcp-sdk`** (resolved via
`https://api.github.com/repos/Bazilio-san/fa-mcp-sdk/commits/master`) instead of the latest **published** version.
In this mode `yarn add` must use the git-URL form with the resolved commit hash (see Step 4).

**No arguments** — FROM is the currently installed SDK version (from the project's current `package.json`); TO is the
latest published SDK version.

## Step 2: Validate refs (fail fast)

Read the project's `package.json` for the default FROM, fetch the latest published version for the default TO, then
apply argument-parsing rules to determine FROM and TO. Before any analysis or mutation, **validate both SDK refs
actually exist** — fail fast with a clear message rather than letting a later GitHub API call return 404. For each ref:

- If it's a **version** (`0.4.30` / `v0.4.30`) — probe
  `https://api.github.com/repos/Bazilio-san/fa-mcp-sdk/git/refs/tags/v<version>` (also try without `v`).
  Fall back to `yarn info fa-mcp-sdk@<version> version` — if that also fails, report
  `Cannot resolve SDK version <X>: not found on GitHub or npm` and stop.
- If it's a **commit hash** — probe `https://api.github.com/repos/Bazilio-san/fa-mcp-sdk/commits/<hash>`.
  On 404, report `Cannot resolve SDK commit <hash>: not found in repo` and stop.
- If GitHub API is rate-limited, fall back to `git ls-remote https://github.com/Bazilio-san/fa-mcp-sdk.git` for
  tag/branch existence, and skip commit-hash validation with a warning.

If FROM == TO, inform the user (e.g. "Both project commits pin the same SDK version X.Y.Z — nothing to do") and stop.

Display:
```
From: <project or SDK ref> → SDK <version-or-commit>  ✓ validated
To:   <project or SDK ref> → SDK <version-or-commit>  ✓ validated
```

## Step 3: Preflight safety

This is the last point before mutating the project. Run these checks and **ask the user inline** when relevant:

1. **Branch check.** Run `git rev-parse --abbrev-ref HEAD`. If the user is on `main`/`master`/`prod`/`production`, ask:
   "You're on `<branch>`. I recommend creating `upgrade/sdk-<TO>` before mutating anything. Create it? (yes/no)"
   On yes, run `git checkout -b upgrade/sdk-<TO>`. On no, proceed but note it in the report so rollback expectations
   are clear.
2. **Uncommitted changes.** Run `git status --short`. If non-empty, ask:
   "I see N uncommitted changes. To stay safe I can: (1) stash them, (2) require you to commit first, (3) proceed
   anyway (rollback will affect your in-flight work). Pick one." Apply the user's choice.
3. **Capture rollback info.** Record:
   - current commit hash: `git rev-parse HEAD`
   - prior installed SDK version: from the current `package.json`

   These go into the final report's rollback section regardless of outcome.

## Step 4: Install the target SDK version

This is the first mutating action. From here on, we're committed to either finishing the upgrade or rolling back.

Run the bundled wrapper from the project root — it performs all three sub-steps in one go:

```bash
node .claude/skills/upgrade-sdk/scripts/install-target-sdk.mjs <TO>
```

where `<TO>` is either:
- a published version (e.g. `0.4.108`), or
- a git URL with a commit hash (e.g. `https://github.com/Bazilio-san/fa-mcp-sdk#<TO-commit>`).

The wrapper sequentially:
1. runs `yarn add fa-mcp-sdk@<TO>`;
2. copies `node_modules/fa-mcp-sdk/scripts/update-sdk.js` over the project's `scripts/update-sdk.js` (overwriting
   the existing file so the project always uses the updater shipped with the target SDK version);
3. runs `node scripts/update-sdk.js` from the project root.

`update-sdk.js` then copies the latest `FA-MCP-SDK-DOC/` and `.claude/` content from the SDK into the project.
Pinned folders (any folder under the project's `.claude/` containing a direct file named `pin`) are preserved by
the script as-is.

If any sub-step fails, the wrapper exits non-zero with the error. Show it verbatim and ask the user how to proceed
(retry, switch to a different TO ref, or abort).

## Step 5: Analyze the diff

Use `https://github.com/Bazilio-san/fa-mcp-sdk` (public repo) to inspect what changed between FROM and TO. **Read
actual content — do not guess.**

### 5.1 Commit log

Fetch:
```
https://api.github.com/repos/Bazilio-san/fa-mcp-sdk/compare/<FROM-ref>...<TO-ref>
```
The `commits[]` array carries the **why** of each change (motivation, fixed issue) that file diffs alone don't show.
Extract `commit.message` (subject + body) for every commit. Use these to:
- Spot intent — flag any conventional-commit `BREAKING CHANGE:` markers prominently.
- Group related file changes under a single narrative.
- Note "rationale unclear — check commit `<hash>` directly" for non-obvious diffs with terse messages.

If the compare endpoint is rate-limited, fall back to paged commits:
`https://api.github.com/repos/Bazilio-san/fa-mcp-sdk/commits?sha=<TO>&since=<FROM-date>&until=<TO-date>`.

Include a "Changelog" list (short hash + first line) in the report.

### 5.2 Config files

These SDK config files may have changed and require corresponding updates in the project:

- `config/default.yaml` — main configuration defaults
- `config/_local.yaml` — template for the project's `config/_local.yaml` (CLI derives `config/local.yaml` from this
  with `{{param}}` substitutions)
- `config/custom-environment-variables.yaml` — env var mappings
- `config/development.yaml`, `config/production.yaml` — env overrides
- `config/local.yaml` (SDK's own) — reference only, not shipped

For each, compare the SDK's version (`node_modules/fa-mcp-sdk/config/<file>`) with the project's version
(`config/<file>`). Identify: new keys, removed keys, changed defaults, new sections.

**Correlate `default.yaml` ⇄ `_local.yaml`.** When `default.yaml` has structural changes (new keys, restructured
sections, changed defaults), also check `_local.yaml` for analogous changes — `_local.yaml` mirrors `default.yaml`'s
structure with override values. If `default.yaml` changed but `_local.yaml` did NOT, flag this: the project's
`config/_local.yaml` may need manual updates to stay consistent.

**Config file mapping (SDK source → project destination):**

| SDK source (in `config/`)                  | Project destination                          | Action |
|--------------------------------------------|----------------------------------------------|--------|
| `config/default.yaml`                      | `config/default.yaml`                        | Add new keys; do NOT remove existing keys the project may have customized |
| `config/_local.yaml`                       | `config/_local.yaml`                         | Update to match SDK — this is the template `local.yaml` is derived from |
| `config/_local.yaml` (via CLI)             | `config/local.yaml`                          | Derived by CLI from `_local.yaml` with `{{param}}` substitutions |
| `config/custom-environment-variables.yaml` | `config/custom-environment-variables.yaml`   | Add new env var mappings |
| `config/local.yaml` (SDK's own)            | *(not shipped — reference only)*             | Use as reference for what the SDK itself overrides locally |

### 5.3 cli-template files

After `yarn add fa-mcp-sdk@<TO>`, the SDK ships its template at `node_modules/fa-mcp-sdk/cli-template/`. This is the
canonical source for any template files in the project.

**Scope:** the table below lists ONLY files that `scripts/update-sdk.js` (already executed in Step 4) does NOT
copy. Anything inside `cli-template/FA-MCP-SDK-DOC/`, `cli-template/.claude/`, and the individual scripts under
`node_modules/fa-mcp-sdk/scripts/` is refreshed by `update-sdk.js` automatically — do NOT re-process it here.

| Template (source of truth)                                       | Project (destination)         | Notes |
|------------------------------------------------------------------|-------------------------------|-------|
| `node_modules/fa-mcp-sdk/cli-template/package.json`              | `package.json`                | **Merge carefully** — see rule below |
| `node_modules/fa-mcp-sdk/cli-template/tsconfig.json`             | `tsconfig.json`               | Overwrite unless customized |
| `node_modules/fa-mcp-sdk/cli-template/.oxlintrc.json`            | `.oxlintrc.json`              | Overwrite unless customized |
| `node_modules/fa-mcp-sdk/cli-template/.oxfmtrc.json`             | `.oxfmtrc.json`               | Overwrite unless customized |
| `node_modules/fa-mcp-sdk/cli-template/CLAUDE.md`                 | `CLAUDE.md`                   | Merge — project may add custom sections |
| `node_modules/fa-mcp-sdk/cli-template/jest.config.js`            | `jest.config.js`              | Overwrite unless customized |
| `node_modules/fa-mcp-sdk/cli-template/deploy/`                   | `deploy/`                     | Merge per file |
| `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`              | `.run/<name>.run.xml`         | **Renamed** — see rule below |
| `node_modules/fa-mcp-sdk/cli-template/gitignore`                 | `.gitignore`                  | Source has no leading dot |

#### Rule: `package.json` — ADD ONLY new dependencies

The project's `package.json` has evolved since generation (project-specific name, version, scripts, team-added deps).
When the SDK's template `package.json` changes:

1. Diff `node_modules/fa-mcp-sdk/cli-template/package.json` (TO) against the same file at the FROM version.
2. Identify ONLY dependencies/devDependencies that were **added** (not version-changed, not removed).
3. Apply additions to the project's `package.json` under the matching section.
4. Do NOT touch `name`, `version`, `scripts`, `engines`, `type`, or any other field.
5. If a dep was **removed** from the template, mention it in the report as informational only — do not delete it from
   the project (it may still be in use).

#### Rule: `r/` → `.run/` with filename transformation

The project has no `r/` directory — it was renamed to `.run/` at generation, and each `<name>.xml` was renamed to
`<name>.run.xml`. For new or changed files in `cli-template/r/`:
- Source: `node_modules/fa-mcp-sdk/cli-template/r/<name>.xml`
- Destination: `.run/<name>.run.xml`
- NEW file → copy with rename.
- CHANGED file → if the project's existing `.run.xml` is untouched (matches the FROM template), overwrite. If it has
  local customizations, treat as Needs-Input (ask the user: overwrite / merge / skip).
- REMOVED file → informational only; do not delete the project's `.run/<name>.run.xml`.

#### Editing `.claude/` files outside the auto-refresh

If during Step 8 you need to write or merge an individual file under the project's `.claude/` (e.g. a custom
non-template skill that `update-sdk.js` does NOT touch because its folder contains a `pin` marker), direct
`Write`/`Edit` is denied by the project's `settings.json`. Use the project's `scripts/fcp.js` workflow described in
the `edit-claude-files` skill: write the new content to a temp file, then
`node scripts/fcp.js .claude/<path> <temp-file>` to install it atomically.

For any other changed template file: source path under `node_modules/fa-mcp-sdk/cli-template/...`, destination in the
project, action = overwrite or merge (depending on local customization).

### 5.4 Core library exports

**Prefer the TypeScript source over compiled output.** Fetch `src/core/index.ts` (and any re-exported `_types_/`
files it references) at both FROM and TO via GitHub raw:
```
https://raw.githubusercontent.com/Bazilio-san/fa-mcp-sdk/<FROM-ref>/src/core/index.ts
https://raw.githubusercontent.com/Bazilio-san/fa-mcp-sdk/<TO-ref>/src/core/index.ts
```
Compare to identify: new exports, removed/renamed exports, changed type signatures, type-level changes (generics,
conditional types, union narrowing) that don't survive `.d.ts` emission cleanly.

Why source over `dist/`:
- Original JSDoc comments and inline rationale preserved in `.ts`, stripped/compressed in `dist/*.js`.
- Renames visible as renames in source diff; in `dist/` they may appear as unrelated add+remove pairs.
- `export *` chains resolve naturally in source; in `.d.ts` they may be flattened.

**Fallback** — if GitHub raw is unavailable, use `node_modules/fa-mcp-sdk/dist/core/index.js` and the matching `.d.ts`.
State explicitly in the report that analysis was made from compiled artifacts and double-check via the GitHub source
viewer for any flagged change.

#### Type / interface changes (not just renames)

Renaming an export is the obvious case — the harder one is a **shape change** to a type/interface the project
consumes. These break compilation in ways that don't show up as "removed export":

- A new **required** field added to an interface (e.g. `IToolHandlerParams`) — every place that constructs or
  destructures that interface needs the new field.
- A previously required field made optional, OR an optional field made required.
- A field's **type** changed (e.g. `string` → `string | undefined`, `Foo` → `Foo[]`, a string-union narrowed).
- Generic signatures changed (added/removed type parameters, added constraints).
- Return-type changes on a function/method the project imports.
- Function parameters reordered, added, removed, or changed type.

For each such change, classify per consumer:
1. **Project does NOT consume the changed type/symbol** → informational only, no action.
2. **Project consumes it AND the migration is mechanical** (one obvious code edit, e.g. add a field with a known
   default, rename a parameter) → Auto in Step 6.
3. **Project consumes it AND the migration requires a judgment call** (where does the new required value come from?
   how should the new generic be parameterized? does the narrower type still cover the project's usage?) →
   Needs-Input in Step 6.

For every consumer site, capture file:line and the exact migration plan. This list is the primary reference when
`tsc` fails in Step 9 — consult it before debugging blindly.

#### Optional new features

Not every SDK change is a breaking one. The TO version may add **new** exports, methods, hook params, config
options, or capabilities the project could adopt but isn't forced to:

- New helper functions / utilities re-exported from `fa-mcp-sdk`.
- New optional parameters on existing handlers (existing call sites keep working).
- New `appConfig` sections / options with sensible defaults.
- New transport / auth / DB capabilities the project's domain might benefit from.

These do NOT break the build, so they go on a separate **Optional improvements** list (see Step 6). The skill
should surface them, but never apply them silently — the user decides per item whether they're relevant.

### 5.5 Project code scan

Scan the project's `src/`, `config/`, and `tests/` for:
- Imports from `fa-mcp-sdk` referencing removed/renamed exports
- Consumers of types/interfaces whose **shape** changed in 5.4 (added required field, changed field type,
  changed generic signature, changed function parameter/return type) — even if the import path is unchanged
- Usage of deprecated APIs
- Config keys that were renamed or restructured

For each hit, capture file:line and the exact replacement plan — needed for Step 6 categorization.

## Step 6: Categorize and build the execution plan

For every change found in Step 5, assign one of four categories:

### Auto — LLM applies without asking
- `node .claude/skills/upgrade-sdk/scripts/install-target-sdk.mjs <TO>` (already done in Step 4 — installs SDK,
  refreshes `scripts/update-sdk.js`, and runs it)
- Adding a brand-new config key to `config/default.yaml` when the project doesn't override it
- Adding new env var mappings to `config/custom-environment-variables.yaml`
- Adding a missing dependency to `package.json` under `dependencies`/`devDependencies`
- Copying a new template file the project doesn't have yet (`.run/` entries from `cli-template/r/`, etc. — note that
  `FA-MCP-SDK-DOC/`, `.claude/`, and individual SDK scripts are refreshed automatically by `update-sdk.js`, not here)
- Applying a mechanical rename of a renamed SDK export across the project's `src/` when there's exactly one
  unambiguous replacement
- Applying a mechanical type/interface migration when the fix is unambiguous (e.g. a newly required field has a
  single obvious source, a renamed parameter where call sites use the same value)

### Needs-Input — LLM applies, but needs user input
- A locally-customized file conflicts with the new template — ask: overwrite / merge / skip
- A new config key has no sensible default — ask for the value
- A breaking change has multiple plausible API replacements — ask which one fits the project's intent
- A `BREAKING CHANGE:` marker that the LLM can apply mechanically but wants explicit confirmation
- The project's `config/local.yaml` has stale overrides for keys that changed structure — ask whether to drop them,
  port to the new structure, or leave them and warn
- A type/interface shape change where the project's consumer needs a non-obvious value (where does the new required
  field come from? how should a new generic be parameterized?)

### 💡 Optional improvements — LLM proposes per item, applies only on per-item confirmation
Non-breaking SDK additions the project COULD adopt but isn't forced to. List each as a discrete `yes/no` question
in Step 7. Examples:
- A new helper now exported from `fa-mcp-sdk` that could replace a hand-rolled utility in the project
- A new optional parameter on an existing API that would let the project remove a workaround
- A new `appConfig` section that enables a capability the project may want (caching, AD auth, Consul, etc.)
- A new transport option / DB feature relevant to the project's domain

Default for every Optional item is **NO** — the user must explicitly opt in per item. Skipped items go to the
final report under "Optional improvements not adopted (FYI)".

### Manual — LLM cannot perform
Reserve this only for things the LLM truly cannot do in this session. Examples:
- Rotating production secrets in a secrets manager outside this repo
- Deploying to staging/production environments
- Communicating with third-party services or teammates

**If a step could be automated in principle but requires human judgment, prefer Needs-Input over Manual.**

Build the plan as four lists (Auto / Needs-Input / Optional / Manual) with item counts and concrete actions.

## Step 7: Present the plan and ASK FOR CONFIRMATION

Render the plan in the conversation in the detected language:

```markdown
## Upgrade plan: fa-mcp-sdk v<FROM> → v<TO>

### 🤖 I will do automatically (N items)
1. ✅ node .claude/skills/upgrade-sdk/scripts/install-target-sdk.mjs <TO>   [already done]
   (yarn add + refresh `scripts/update-sdk.js` + run `node scripts/update-sdk.js`)
2. Add new key `webServer.foo` (default `bar`) to `config/default.yaml`
3. Copy new template file `.run/new-task.run.xml` (renamed from `r/new-task.xml`)
4. Add dep `some-pkg@^1.2.3` to package.json `dependencies`
5. Apply rename `oldFn` → `newFn` in src/foo.ts:42, src/bar.ts:17, src/baz.ts:55
6. Run verification: `oxlint --fix . && oxfmt . && rimraf dist && tsc` + project tests + clean startup

### ❓ I need your input on (M items)
1. `config/local.yaml` overrides `webServer.auth` which restructured in v<TO>. Options:
   (a) port overrides to new structure  (b) drop overrides  (c) leave + warn
2. New config key `someService.apiKey` has no default. What value should I set?
3. Project's `.claude/skills/upgrade-sdk/SKILL.md` is locally customized. Overwrite with new template,
   merge non-conflicting parts only, or skip?
4. `IToolHandlerParams` gained required field `transport`. Project consumers at src/tools/handle-tool-call.ts:12
   need it — should I derive it from `params.transport ?? 'http'` or expose it as a new tool argument?

### 💡 Optional improvements available (L items) — default NO per item
1. v<TO> adds `appConfig.cache.redis` — project currently uses in-memory cache. Adopt Redis cache? (no/yes)
2. v<TO> exports `mergeByBatch()` helper — project has a hand-rolled batch-merge in src/db/repo.ts:88. Replace? (no/yes)
3. v<TO> adds optional `agentTester.openAi.proxy` — project doesn't need a proxy today. Add scaffolding? (no/yes)

### 👋 You'll need to do manually (K items)
- [empty if everything is in Auto / Needs-Input / Optional]

### Rollback info
- Pre-upgrade commit: <hash>
- Prior SDK version: v<FROM>
- Branch: <branch>
```

Then ask **explicitly**:

> "Confirm — apply the Auto items now and prompt you inline for the Needs-Input + Optional items as I reach them?
> (yes/no)"

Wait for explicit confirmation. If the user declines, stop and leave the project as it is after Step 4 (note this in
the final report). If the user confirms, proceed to Step 8.

## Step 8: Execute

Apply each Auto item in order. For each Needs-Input item, ask the user **at the moment you reach it** (one question
at a time so the user can reason — don't batch). Apply with the answer, then move on. After Auto + Needs-Input,
walk through Optional items one-by-one (default NO) — apply only those the user explicitly accepts.

Be transparent about state — after each item is applied, output a one-line acknowledgment so the user can follow
along, e.g. `✓ Added webServer.foo to config/default.yaml`.

When touching files under `.claude/` that `update-sdk.js` did not just refresh (e.g. pinned custom skills), always
use the project's `scripts/fcp.js` workflow — see Step 5.3 → "Editing `.claude/` files outside the auto-refresh"
and the project's `edit-claude-files` skill.

Maintain an in-memory execution log so the final report can list exactly what was done and what required input.

## Step 9: Verify

After all items are applied, run the verification chain in this exact order. Record pass/fail for each step.

### 9.1 Lint + format + clean build (fixed chain)

Run this single command chain — same shape regardless of project:

```bash
npx oxlint --fix . && npx oxfmt . && npx rimraf dist && npx tsc
```

(Use `npx` to invoke the tools directly so the chain doesn't depend on yarn script wrappers, which may differ between
projects. If the project clearly pins these tools as direct `node_modules/.bin/` binaries, those work too.)

- `oxlint --fix .` — auto-fix lint issues across the whole project
- `oxfmt .` — format the whole project
- `rimraf dist` — wipe stale build output
- `tsc` — typecheck + compile

If any step fails, stop the chain and trigger the failure-handling flow below.

### 9.2 Project tests (whatever is wired in `package.json`)

**Do not hard-code a test command.** Read the project's `package.json` `scripts` section and run whatever test scripts
the project actually defines. Common patterns to look for, in order of preference:

1. `test:mcp`, `test:mcp-http`, `test:mcp-sse`, `test:mcp-streamable` — MCP transport tests (run all that exist)
2. `test` — top-level test runner (usually `jest`)
3. Any other script whose name starts with `test:` or contains `test`

Run all relevant test scripts; the project may need just one of them or several. Record pass/fail per script.

If no test scripts are defined, note it in the report ("project has no test scripts — verification skipped tests").

### 9.3 Clean startup

Briefly start the server, confirm it boots without errors, then stop it:

```bash
yarn start &              # or `npm start` — match the project
# wait ~3-5s for startup logs
node scripts/kill-port.js <port>   # port from config/default.yaml → webServer.port
```

A "clean startup" means: no exceptions in logs, server reports it's listening on the configured port. If startup
fails, treat it as a verification failure.

### On verification failure

Do NOT silently proceed and do NOT silently roll back. Present the failing step, the error output, and the diff of
the likely-causing file(s), then ask the user to choose:

> "Verification failed at <step>. Options:
>  - **fix**: I diagnose the root cause and fix it (may need more input from you)
>  - **retry**: just rerun the verification step (useful for flaky tests)
>  - **rollback**: revert to the pre-upgrade state (commit `<hash>`, SDK v`<FROM>`) and stop
>  - **leave-as-is**: keep current state, surface the failure in the final report, and stop
>  Pick one."

Apply the user's choice:
- **fix** → diagnose, apply a fix (asking inline for any info needed), re-run verification. Loop if it fails again.
  **When `tsc` is the failing step, consult Step 5.4 (Core library exports → Type / interface changes) FIRST**
  — most TS errors after an SDK upgrade trace back to a shape change you already cataloged there. Match the error
  to the relevant 5.4 entry and apply the migration plan, instead of debugging the error in isolation.
- **retry** → rerun the failing step once. If it fails again, present the same four options.
- **rollback** → re-run the wrapper with the previous ref:
  `node .claude/skills/upgrade-sdk/scripts/install-target-sdk.mjs <FROM>` (uses a git URL form for commit hashes,
  e.g. `https://github.com/Bazilio-san/fa-mcp-sdk#<FROM-commit>`), then `git checkout <pre-upgrade-hash> -- .`.
  If the user stashed changes in Step 3, restore them with `git stash pop`. Report what was rolled back.
- **leave-as-is** → no further changes. Final report will clearly mark the failure and what remains unverified.

## Step 10: Report

Produce a final report in **two places**:
1. **In the chat**, immediately at the end of the skill run.
2. **In a file** at `claudedocs/upgrade-sdk-<FROM>-to-<TO>.md` (overwrite if it exists from a previous run).

Both copies use this structure (in the detected language):

```markdown
# Upgrade report: fa-mcp-sdk v<FROM> → v<TO>

Generated: <ISO timestamp>
Branch: <branch>
Pre-upgrade commit: <hash>

## Outcome

<one of: ✅ completed | ⚠️ completed with issues | ❌ rolled back | ⏸ stopped at user request>

## Changelog (commits between FROM and TO)

- `<short-hash>` <first line>
- ...

## ✓ Done automatically

- Item 1
- Item 2
- ...

## ✓ Done with your input

- `config/local.yaml`: chose (a) port to new structure — applied N keys
- `someService.apiKey`: set to `<value-you-provided>`
- `oldFn` → `newFn` rename: applied to src/foo.ts:42, src/bar.ts:17, src/baz.ts:55
- `IToolHandlerParams.transport`: derived from `params.transport ?? 'http'` per your choice — applied at
  src/tools/handle-tool-call.ts:12
- ...

## 💡 Optional improvements adopted

- Redis cache: enabled (`appConfig.cache.redis` populated, dep `ioredis@^5.4.1` added)
- ...
- [empty if user declined all Optional items]

## 💡 Optional improvements NOT adopted (FYI)

- `mergeByBatch()` helper now available — project keeps hand-rolled version in src/db/repo.ts:88
- `agentTester.openAi.proxy` option available — not adopted (project doesn't need a proxy)
- ...
- [empty if no Optional items existed, or all were adopted]

## 👋 Still on your plate

- [empty if nothing manual remains]

## Verification

- `oxlint --fix .`:            ✅ / ❌ (<error excerpt>)
- `oxfmt .`:                   ✅ / ❌
- `rimraf dist`:               ✅ / ❌
- `tsc`:                       ✅ / ❌ (<error excerpt>)
- tests (<list scripts run>):  ✅ / ❌ (<n>/<m> passed)
- clean startup:               ✅ / ❌

## Rollback info

- Pre-upgrade commit: `<hash>`
- Prior SDK version: `v<FROM>`
- To roll back manually:
  ```bash
  node .claude/skills/upgrade-sdk/scripts/install-target-sdk.mjs <FROM>
  git checkout <hash> -- .
  ```

## Notes

<anything noteworthy: rate limits hit, fallbacks used, files with rationale-unclear diffs flagged for review, etc.>
```

Make sure `claudedocs/` exists (`mkdir -p claudedocs`) before writing.

## Important rules

- Always read actual files; never guess what changed.
- Treat user customizations as inviolable unless the user explicitly says "overwrite" in response to a Needs-Input
  prompt.
- Never modify `package.json` other than to ADD new deps; do not change `name`, `version`, `scripts`, `engines`,
  `type`, or any other field.
- Don't skip verification. If it fails, surface it via the 4-option prompt — don't smuggle failures past the user.
- All `.claude/` writes go through `scripts/fcp.js` (per the `edit-claude-files` protocol).
- Write all human-readable text in the detected language (default: English). Keep paths, YAML keys, and shell
  commands in English regardless.
- Correlate config files: when `default.yaml` changes, always check `_local.yaml` for analogous changes and flag
  stale `local.yaml` overrides explicitly.
- If GitHub API is unavailable or rate-limited, fall back to comparing files directly from `node_modules/fa-mcp-sdk/`
  against project files, and note the fallback in the report.
