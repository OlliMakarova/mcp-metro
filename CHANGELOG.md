# Changelog

All notable changes to this MCP server are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Every breaking change
MUST be tagged with `[BREAKING]`. See
[FA-MCP-SDK-DOC/11-public-contract.md](FA-MCP-SDK-DOC/11-public-contract.md#8-versioning-policy-171)
for the MAJOR / MINOR / PATCH rules.

## Versioning policy (summary)

| Change                                                          | Bump  |
|-----------------------------------------------------------------|-------|
| Removing a tool / prompt / resource                             | MAJOR |
| Adding a `required` field to an `inputSchema`                   | MAJOR |
| Removing a field from an `outputSchema`                         | MAJOR |
| Renaming or removing an HTTP endpoint                           | MAJOR |
| Adding a new tool / prompt / resource                           | MINOR |
| Adding an optional field to a schema                            | MINOR |
| Bug-fix without contract impact                                 | PATCH |

## [Unreleased]

### Added

- New tool `<name>` — short description (MINOR).
- New optional argument `<arg>` on tool `<name>` (MINOR).

### Changed

- `<tool_name>` description clarified to mention the default value of `<arg>` (PATCH).

### Deprecated

- Tool `<old_name>` — replaced by `<new_name>`. Removal scheduled for 2026-08-28
  (≥ 2 MINOR releases or 3 months — whichever comes later, per the public contract). The
  SDK now emits `[DEPRECATED until 2026-08-28, use <new_name>]` on `tools/list` and a
  `logger.warn` the first time per hour an old call lands.

### Removed [BREAKING]

- Removed deprecated tool `<old_old_name>` (MAJOR). Migration window closed on 2026-05-01.

### Fixed

- Race condition in `<tool>` when called concurrently from multiple sessions (PATCH).

### Security

- Bumped `fa-mcp-sdk` to `^0.8.0` for `X-Request-Id` correlation and `traceparent` propagation.

---

## [0.1.0] - YYYY-MM-DD

Initial release.

### Added

- MCP server scaffolded from `fa-mcp-sdk`.
- Tools: `<tool>` …
- Prompts: `agent_brief`, `agent_prompt`.
- Resources: `project://version`, `use://auth`.
