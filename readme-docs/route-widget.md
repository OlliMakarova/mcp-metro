# Route Widget (MCP Apps)

An interactive route view rendered inside hosts that support the MCP Apps UI extension
(`io.modelcontextprotocol/ui`, SEP-1865), with a plain-Markdown fallback everywhere else.

## What the tool returns, per host

The tool checks the host's advertised capabilities (`hostSupportsMcpApps()`), and a `search_route` answer takes one of
two shapes:

| Host                       | `structuredContent`                | `content`                        |
|----------------------------|------------------------------------|----------------------------------|
| Supports MCP Apps          | `{ widget: 'metro-routes', dataUrl }` | one short localized route summary |
| Text-only                  | absent                             | the full route Markdown           |

Station info and clarification answers are always Markdown, regardless of UI support.

In the widget branch the **full route Markdown is deliberately not returned**. The widget already shows the details, and
a long duplicate text would only be re-narrated by the model. But per the MCP Apps specification `structuredContent` is
UI-only and never enters the model context — so with an empty `content` the model would have no record of what the user
is looking at and would answer follow-up questions from guesswork. Hence the one short text block: fastest variant,
transfer count, main line, operating status, advisory count.

**Server convention.** Any future tool of this server that answers with a widget follows the same rule — one short text
block for the model next to the widget, never an empty `content` and never the full detail text.

## Model-context trace across turns

The same summary is produced once by `buildModelSummary()` and reused in two places, so the wording never drifts:

1. the tool's `content` block described above (this turn);
2. the `modelSummary` field of the `GET /api/widget-data` payload, which the widget — once its data has loaded — pushes
   to the host with the MCP Apps `ui/update-model-context` request.

That push is invisible in the chat but keeps the summary in the model context for later questions. It is sent only when
the host advertises the `updateModelContext` capability in its `ui/initialize` response; otherwise the widget silently
does nothing. Every load, including a press of "Refresh route", overwrites the previous summary.

## Cacheable UI, dynamic data

The design splits the two halves deliberately.

**UI** — a versioned resource, `ui://mos-metro/routes.<hash>.html`, where `<hash>` is the first 8 hex characters of the
widget HTML's SHA-256. Hosts that cache HTML by URI indefinitely re-read it only when the widget actually changes. The
HTML is read synchronously at module load, because the URI must exist before the tool definition that advertises it in
`_meta.ui.resourceUri` is built. The resource also declares `preferredFrameSize: ['100%', '520px']` and its own
`connect-src` CSP entry.

**Data** — the widget fetches its own route data from `dataUrl` (`GET /api/widget-data`). The link is
**self-describing**: it carries the departure and arrival platform ids, the language and the moment `at`, plus a
truncated HMAC-SHA256 signature over `from|to|lang`. The server rebuilds the route on every request, so:

- the link is **permanent** — no cache of issued payloads, no time-to-live, nothing lost on restart, as long as
  `widgetData.signSecret` is set to a fixed value;
- the signature deliberately does **not** cover `at`, so the widget's **"Refresh route"** button simply drops `at` and
  rebuilds the route for "now" without invalidating the signature;
- because refreshing is a plain `fetch` and never a `tools/call`, the button works in every channel, including a
  Telegram Mini App where no MCP session exists.

The signature's purpose is narrow but important: it keeps the endpoint serving only links the tool itself issued, rather
than turning into a public route-search API — the k-shortest-paths search is not free.

The signing core (`src/tools/widget/widget-data-sign.ts`) is pure and config-free, so it can be unit-tested in
isolation; the thin wrappers that read the secret and the base URL from config live in `widget-data-link.ts`.

## Compute cache

`src/tools/widget/widget-data-service.ts` keeps a small cache in front of the route search. This is a cache of
**computations**, not of issued links: repeated opens of the same widget, and the user tabbing between route variants,
hit the cache instead of re-running Yen's algorithm. The key includes the dataset version, so a metro-data refresh
invalidates stale entries naturally.

## Behind a reverse proxy

Set `webServer.publicBaseUrl` to the public URL, for example `https://mcp-metro.time-gold.com`. It is the single source
of the external address and feeds both the `dataUrl` in the tool response and the `connect-src` entry of the widget
resource's Content-Security-Policy. Empty means `http://localhost:<port>`, which is what local development and the Agent
Tester need.

The widget's data fetch is **cross-origin from a sandboxed iframe** whose `Origin` is either `null` (for `srcdoc`
sandboxes) or a dynamically generated host subdomain. Neither can be matched by an allow-list, so the SDK's CORS origin
guard is switched off here (`webServer.cors.enabled: false`); the SDK then answers preflight requests and adds
`Access-Control-Allow-Origin: *` to every response, and no per-route CORS handling is needed.

The consequence is explicit: `GET /api/widget-data` is a public, read-only, signature-gated route endpoint. Protect it
by network policy and by the reverse proxy, and set an explicit `widgetData.signSecret` so links survive restarts.

## Known limitation

If the host's sandbox forbids network access — a CSP that omits `connect-src`, or an offline channel — the widget cannot
load its data and shows an error asking the user to try again. There is **no** fallback that embeds the full route
payload inline. The user does not lose the answer, though: the short summary is in the conversation, and asking again in
a text-only client returns the complete Markdown.

## Related

- [REST API](./rest-api.md) — the `/api/widget-data` contract and its status codes.
- [Route Search](./route-search.md) — what the payload's variants contain.
- [Configuration](./configuration.md) — `webServer.publicBaseUrl`, `webServer.cors.enabled`, `widgetData.signSecret`.
