# Testing

Three layers, from fastest to most realistic: unit tests over the pure logic, MCP protocol tests per transport, and the
Agent Tester, which drives the tool through a real LLM.

## Unit tests

```bash
npm test                                  # everything
npx jest tests/lib/routing.test.ts        # one file
```

`tests/lib/` covers the parts that carry the domain logic, using fixtures in `tests/fixtures/` instead of the network:

| File                        | What it checks                                                             |
|-----------------------------|----------------------------------------------------------------------------|
| `routing.test.ts`           | Graph construction, Dijkstra, Yen's variants, deduplication, closures        |
| `search.test.ts`            | Fuzzy matching, transliteration, case forms, hub clustering                 |
| `operating-hours.test.ts`   | Vestibule windows, the midnight-crossing case, the approximate fallback     |
| `train-intervals.test.ts`   | Interval bands per line kind, weekday versus weekend, expected wait          |
| `refresh.test.ts`           | The source cascade, notification time-to-live, deletion of stale closures    |
| `public-source.test.ts`     | Scrubbing of source names from outward-facing text                          |
| the backup-source test      | Parsing of the backup source's embedded graph and its enrichment            |
| `widget-data.test.ts`       | Link signing and parsing, recompute tokens, payload assembly                |
| `widget-stations.test.ts`   | The hub list behind the widget's selects: clustering, badges, sort order    |
| `widget-uri-history.test.ts`| That no widget address ever published has been dropped (derived from git)   |
| `model-summary.test.ts`     | The localized one-line summary in all four languages                        |
| `telegram-notify.test.ts`   | Send success, failure isolation, the disabled state                         |

The data layer is written so this is possible: `refresh.ts`, the signing core and the notifier take `fetch`, the clock
and the logger as parameters and never touch `appConfig` or the SDK.

## MCP protocol tests

```bash
npm run test:mcp        # STDIO — spawns the server itself
npm start               # ... in another terminal, for the two below
npm run test:mcp-http   # Streamable HTTP
npm run test:mcp-sse    # SSE
npm run test:mcp-widget # the two widget endpoints end to end
```

The shared cases live in `tests/mcp/test-cases.js` — tool names, arguments and expected results. That is the file to
edit when adding a tool or a scenario; the three transport runners consume it. HTTP and SSE runners connect to an
already-running server, STDIO spawns its own.

`test:mcp-widget` walks the whole widget data path against a running server: the signed link and its "Refresh" variant,
a tampered signature, the recompute token every response carries, the station list behind that token, a recompute for
another pair of stations, the one-per-2-seconds limiter, and the rejections for a missing, forged or expired token. It
also reads the current widget address and every address earlier builds were published under — dropping one of those
breaks every route card already in a user's chat history (see [Route Widget](./route-widget.md)). It pauses two
seconds between successive recomputes on purpose, so the run takes about ten seconds. Two checks — the `404`
for non-existent ids and the expired-token `403` — need to forge a valid signature and are skipped unless
`WIDGET_DATA_SIGN_SECRET` is set to the same secret the server runs with:

```bash
WIDGET_DATA_SIGN_SECRET=my-secret npm start          # in one terminal
WIDGET_DATA_SIGN_SECRET=my-secret npm run test:mcp-widget
```

## Agent Tester

`agentTester.enabled` is `true` in this project, so the tester is mounted at `/agent-tester` (web UI) together with its
Headless API. It answers the question unit tests cannot: does a real model *understand* the tool — pick it, fill the
arguments, and present the answer sensibly.

### Prerequisites

The tester needs an OpenAI-compatible API key. Verify it before relying on the tester:

```bash
npm run check-llm
```

Exit code `1` means the key is missing, `2` means it is invalid or the API rejected the call. Configure it either in
`config/local.yaml`:

```yaml
agentTester:
  enabled: true
  openAi:
    apiKey: sk-...
    baseURL: https://<your-openai-compatible-gateway>/v1
```

or through the environment: `AGENT_TESTER_ENABLED=true`, `AGENT_TESTER_OPENAI_API_KEY=sk-...`.

When `agentTester.enabled` is `false`, every `/agent-tester/*` request returns HTTP 404 — including the Headless API.

### Headless API — the primary method

No browser needed, and the response includes a structured trace.

```bash
# 1. confirm the server sees its own tools
curl http://localhost:9049/agent-tester/api/mcp/status

# 2. send a message and read the trace
curl -X POST http://localhost:9049/agent-tester/api/chat/test \
  -H 'Content-Type: application/json' \
  -d '{
    "message": "How do I get from Khovrino to Kievskaya?",
    "mcpConfig": { "url": "http://localhost:9049/mcp", "transport": "http" }
  }'
```

Useful query parameters:

| Parameter          | Default | Purpose                                                        |
|--------------------|---------|----------------------------------------------------------------|
| `verbose=true`     | `false` | Per-turn LLM details; use when a brief trace does not explain the behavior |
| `maxResultChars`   | `4000`  | Cap on characters per tool result inside the trace              |
| `maxTraceChars`    | `50000` | Cap on total trace size; older turns collapse to summaries      |

Fields worth reading in the answer: which tool was called and with which arguments, the tool's result, the final
assistant message, and `system_prompt_sent` — the exact system prompt the model received.

### Iterating on the agent prompt

Two request fields control the prompt:

- `agentPrompt` **replaces** the server's built-in `agent_prompt` for that request;
- `customPrompt` is appended after the resolved prompt, for per-request modifiers.

The workflow is: read the current prompt from `src/prompts/agent-prompt.ts`, send variations as `agentPrompt`, compare
the answers and `system_prompt_sent`, then write the winner back into the source. Omitting `agentPrompt` tests the
currently deployed prompt as-is.

The model comes from `agentTester.openAi.defaultModel` (`openai/gpt-5.4-nano`) for the UI and
`headlessTester.defaultModel` (`openai/gpt-5.4`) for headless requests unless a request names one. For tool-calling
accuracy during development, prefer `gpt-5.4`.

### Structured logging

```bash
npm start --log-json
# or
AGENT_TESTER_LOG_JSON=true npm start
```

Emits one JSON object per event on stdout, which is convenient when a script drives the tester and parses the outcome.

### Web UI and Playwright

The UI at `/agent-tester` is the same engine with a chat front end, plus an App Inspector for the route widget. Reach
for Playwright only when the question is about the page itself — layout, DOM interaction, widget rendering. For tool
behavior the Headless API gives more, faster.

## Test log convention

Automated test sessions are recorded in `claudedocs/test-log.md` as a chronological narrative: what was sent, what was
expected, what came back, and — when something failed — the diagnosis and the fix that followed. It doubles as an audit
trail, a decision record and a handoff document if a session is interrupted.

## Related

- [Configuration](./configuration.md) — the `agentTester` section in full.
- [Authentication](./authentication.md) — `agentTester.useAuth` and what the tester needs when auth is on.
