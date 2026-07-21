---
name: change-log
description: "Generate a Keep a Changelog entry for this MCP server between the last version in CHANGELOG.md and the current package.json version (or an explicit TO version), keeping only substantial changes."
disable-model-invocation: true
argument-hint: "[to-version]"
allowed-tools: Bash(git *) Bash(node *) Bash(cat *) Bash(ls *) Read Write Edit Grep Glob
---

# CHANGELOG Generator

Generate a new CHANGELOG.md entry covering changes between the **last version recorded in
CHANGELOG.md** and either the **current package.json version** or an **explicitly-specified TO
version**. Only **substantial** changes are included; cosmetic/style/internal-tooling churn is
filtered out.

The CHANGELOG.md lives at the repo root and follows the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format with sections
`Breaking` / `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`.
`Breaking` is project-specific and takes precedence; the rest match Keep a Changelog verbatim.

## Argument Parsing

`$ARGUMENTS` is optional. If supplied, the first token must be a semver string `X.Y.Z` and is
treated as the **TO version**. Anything that doesn't match `^\d+\.\d+\.\d+$` is ignored.

| Args | FROM-VER | TO-VER |
|---|---|---|
| **none** | latest version in `CHANGELOG.md` | `package.json` `version` field |
| **one** `X.Y.Z` | latest version in `CHANGELOG.md` | `X.Y.Z` |

## Workflow

### Step 1: Resolve FROM-VER from CHANGELOG.md

Read `CHANGELOG.md` at repo root. Find all version headings matching the regex:

```
^##\s+\[?(\d+\.\d+\.\d+)\]?
```

The **first** match (top-most in the file) is the latest version recorded.

### Step 2: Resolve TO-VER

- If `$ARGUMENTS` contains a `X.Y.Z` token: `TO-VER` = that token.
- Otherwise: read `package.json` `version` field via
  `node -e "console.log(require('./package.json').version)"`.

If `FROM-VER == TO-VER`, stop with `No new version to record — CHANGELOG.md is up to date with v<VER>.`

### Step 3: Resolve commit hashes for FROM-VER and TO-VER

For each version, find the commit that **bumped** the project to it. The convention is that
version-bump commits have the version string as the entire commit subject (e.g. subject `1.2.3`).

```bash
git log --format="%H %s" | awk -v v="<VER>" '$2 == v { print $1; exit }'
```

Fallback if the above returns nothing — find the first commit where `package.json` `version` was
set to that value:

```bash
git log --reverse --format="%H" -S "\"version\": \"<VER>\"" -- package.json | head -1
```

If `FROM-VER` cannot be resolved to a commit (e.g. it's older than the repo's first commit),
use the repo's first commit (`git rev-list --max-parents=0 HEAD | head -1`) as `FROM-COMMIT` and
note this in the output.

If `TO-VER` equals current `package.json` version and no version-bump commit exists yet for it,
use `HEAD` as `TO-COMMIT`.

### Step 4: Gather diff data

Run in parallel:

```bash
git log --format="%H|%s|%b---END---" <FROM-COMMIT>..<TO-COMMIT>   # full commit messages
git diff --name-status <FROM-COMMIT> <TO-COMMIT>                  # changed files
git diff <FROM-COMMIT> <TO-COMMIT> -- config/                     # config diffs (always lives here)
git diff <FROM-COMMIT> <TO-COMMIT> -- src/                        # all source: tools, prompts, resources, REST, types
git diff <FROM-COMMIT> <TO-COMMIT> -- package.json                # detect runtime-dependency bumps
```

The project's MCP surface (tools, prompts, resources, REST endpoints) is defined wherever this
project happens to put them — file/folder layout and the chosen framework are not fixed. Read
the `name-status` listing first to understand the actual structure, then narrow `src/` further
if needed (e.g. `git diff <range> -- src/<your-tools-dir>/`). The stable anchors are **MCP
protocol concepts** (tool, prompt, resource), **REST endpoints**, **config keys**, and bumps of
**runtime dependencies** the project actually uses — not specific paths or framework names.

### Step 5: Filter to substantial changes

Walk the commit list and classify each commit. **Drop** a commit entirely if **all** of the
following hold:

- Its subject matches one of these patterns (case-insensitive):
  - `^chore: format`, `^chore: lint`, `^style:`, `^chore: prettier`, `printWidth`
  - `^chore: typo`, `^docs: typo`, `^chore: whitespace`, `^chore: comments?`
  - `^chore: rename .* (variable|local)`, `^chore: reorder imports`
  - bare version-bump subjects: `^\d+\.\d+\.\d+$`
  - `^chore: bump`, `^chore: release`
- Its diff touches **only** files that are themselves cosmetic-only:
  - Whitespace / formatting changes (no logic delta)
  - Comment-only edits
  - `*.md` files that are not user-facing docs (e.g. internal notes)

If in doubt, **keep** the commit — readers can skim past a borderline entry, but a missing real
change is harder to recover.

Additionally drop these path classes from consideration entirely (their changes don't go into
the changelog regardless of commit grouping):

- `package-lock.json`, `yarn.lock`, `tsconfig.json` (unless it affects emitted types),
  `.gitignore`, `.editorconfig`, `.prettierrc*`, `.oxlintrc*`, `.oxfmtrc*`
- `CHANGELOG.md` itself, `claudedocs/**`, generated SDK-doc directories
- `tests/**`, `src/tests/**` (test-only changes — internal quality, not user-visible)
- Root `package.json` if its only diff is the `version` field. A bump of any **runtime**
  dependency (MCP framework / SDK, DB driver, auth library, HTTP framework, …) IS user-visible
  and should be recorded under **Changed** — and under **Breaking** if the upgrade renames a
  config key, removes a previously-used exported API, or changes default behavior. Bumps of
  **devDependencies** (linters, formatters, test frameworks, build tools) stay out.

### Step 6: Classify remaining commits into sections

For each surviving commit, decide which CHANGELOG section it belongs to:

Signals are described in terms of **MCP protocol concepts** (tool, prompt, resource), **REST
endpoints**, **config keys**, and **runtime-dependency** changes — never in terms of specific
framework APIs or file paths. The operator-impact lens: ask *"does this commit force someone
running an existing deployment to edit their config, redeploy, change client code, or relearn
an API?"* If yes, it belongs in the log. If no, it probably doesn't. Two categories deserve
extra vigilance because they silently break deployments otherwise:

- **Config changes** — added/removed/renamed/redefaulted keys in `config/*` or env-var bindings,
  because operators must update the deployed server's config file or environment.
- **Public-API changes in any SDK / framework the project depends on** — renamed/removed/changed
  function signatures from the MCP SDK, HTTP framework, DB driver, etc., because the project's
  own code may need to be touched on upgrade.

| Section | Signals |
|---|---|
| **Breaking** | Removed/renamed MCP tool, prompt, or resource; removed/renamed REST endpoint; removed/renamed config key (forces operator to edit deployed config); runtime-dependency upgrade that drops or renames an API or config key the project relies on; commit message contains `BREAKING CHANGE`, `BREAKING:`, or starts with `feat!:` / `fix!:` |
| **Added** | New MCP tool, prompt, resource, REST endpoint, or config key; commit subject starts with `feat:` / `feat(...)` / `add:` |
| **Changed** | Behavior change without API removal; modified tool description/inputSchema; modified config key default (operators may want to review their overrides); runtime-dependency bump with observable effect; commit subject starts with `refactor:`, `perf:`, `change:`, or describes a behavior change |
| **Deprecated** | Tool / endpoint / prompt / resource / config marked deprecated but still functional (e.g. JSDoc `@deprecated`, soft-removal notice). The actual removal lands later under **Removed** + **Breaking**. |
| **Removed** | Deleted tool / REST endpoint / prompt / resource / config key (also goes under Breaking) |
| **Fixed** | Commit subject starts with `fix:` / `fix(...)`, or describes a bug fix |
| **Security** | Vulnerability patch in auth, JWT, NTLM, AD, rate limiting, CORS, or token handling; commit references CVE, advisory, or "security" / "vuln" / "CVE-" keywords. Include severity and CVE ID when available, e.g. `Fix JWT signature bypass in /api endpoint (HIGH, CVE-2026-XXXXX)`. |

A single commit may legitimately appear in more than one section if it does multiple things;
prefer placing it in the **most impactful** section
(Breaking > Removed > Deprecated > Security > Added > Changed > Fixed).

### Step 7: Format the new entry

Use this template. Omit any section whose body would be empty.

```markdown
## [<TO-VER>] - <YYYY-MM-DD>

### Breaking

- <one-line description, imperative voice, addressed to a user/operator of this MCP server>

### Added

- <one-line description>

### Changed

- <one-line description>

### Deprecated

- <one-line description, naming the tool/endpoint/config still functional but marked for future removal>

### Removed

- <one-line description>

### Fixed

- <one-line description>

### Security

- <one-line description; include severity (LOW/MEDIUM/HIGH/CRITICAL) and CVE ID if assigned>
```

Rules for bullets:

- One sentence per bullet, ≤ 120 chars.
- Imperative or declarative voice, no marketing language ("blazingly fast", "magnificent", etc.).
- No commit hashes in bullets — the section heading and date locate them in git history.
- Group related commits into a single bullet when they form one logical change.
- Reference user-visible names verbatim — tool names, REST routes (e.g. `GET /api/foo`), config
  keys (e.g. `appConfig.webServer.genJwtApiEnable`) — so that operators and downstream agents
  grep for them.
- For config changes, write `config.path.to.key` style references.

### Step 8: Write the entry into CHANGELOG.md

Insert `<NEW-ENTRY>` **immediately above the first existing `## [` heading**, preserving the
file's existing header and trailing entries. If no existing `## [` heading is present, append
after the existing header (separated by one blank line).

Use `Edit` on CHANGELOG.md (the file is at repo root, not under `.claude/`, so direct editing is
allowed).

### Step 9: Report

Output to the user:

- The version range covered: `<FROM-VER> → <TO-VER>`.
- The commit range: `<FROM-COMMIT-SHORT>..<TO-COMMIT-SHORT>`.
- A summary line: `<N> commits considered, <M> substantial entries recorded across
  <K> sections`.
- Path of the modified file: `CHANGELOG.md`.

## Important Rules

- **Substantial only**: cosmetic, formatting, linting, test-only, and packaging churn never
  appear in the changelog. When unsure, keep — but a long list of "Fixed: typo" entries is a
  signal the filter is too lenient.
- **MCP-server-operator perspective**: the audience is operators of this MCP server and the AI
  agents / API clients that talk to it. Frame entries as what they must do or observe after
  upgrading: edit a config key, redeploy, update client code, call new tools, stop calling
  removed ones. Internal refactors with no operator-visible effect stay out; performance gains
  do belong (phrase as observable effect — e.g. *"p99 latency on /search dropped from 800 ms to
  150 ms"*). **Config key changes** and **runtime-SDK API changes** are the two highest-signal
  categories — never silently drop them.
- **Filename references stay in English**: paths, config keys, tool names, REST routes, commit
  hashes are always in English regardless of any prose language preference.
- **Do not modify any file other than `CHANGELOG.md`**.
- **Do not delete or rewrite existing CHANGELOG.md entries** — only insert the new one.
- **FROM is always derived from CHANGELOG.md**, never from arguments. The TO version is the only
  user-controllable input.
- **Idempotency**: if invoked twice in a row with no new commits between, Step 2's
  `FROM-VER == TO-VER` check stops the run cleanly. Never write a duplicate header for the same
  version.
