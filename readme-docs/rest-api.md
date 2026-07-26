# REST API

Four read-only `GET` endpoints over the same data layer the MCP tool uses, for callers that want the data without the
MCP protocol.

Interactive documentation is served at `/docs` (Swagger UI); the raw OpenAPI specification is at `/api/openapi.json`.

## Common behavior

- **Method** — `GET` only. Nothing in this API modifies state.
- **Encoding** — Cyrillic query values must be URL-encoded (`%D0%9A%D0%B8%D0%B5%D0%B2%D1%81%D0%BA%D0%B0%D1%8F` for
  `Киевская`).
- **Authentication** — the first three routes go through the SDK auth middleware, so they require an `Authorization`
  header exactly when `webServer.auth.enabled` is `true`. `/api/widget-data` is intentionally exempt; see
  [Route Widget](./route-widget.md).
- **Rate limiting** — every route, including `/api/widget-data`, consumes one point per request from a per-client-IP
  bucket. Defaults are 60 requests per 60 seconds (`restApi.rateLimit`), backed by `RateLimiterMemory` from
  `rate-limiter-flexible` — the same limiter the SDK uses for `/mcp`. Exceeding it yields:

  ```json
  { "success": false, "error": "Rate limit exceeded. Please retry later.", "retryAfterSec": 42 }
  ```

  with HTTP `429` and a `Retry-After` header. The bucket is in-process, so each server instance counts separately.
- **Data availability** — when no dataset is loaded at all, every route answers `503` with
  `{ "success": false, "error": "Metro data is temporarily unavailable." }`.
- **Errors** — unexpected failures return `500` with a message that has been scrubbed of data-source names (see
  [Data Sources](./data-sources.md)). The original text goes to the log.

## `GET /api/stations/search`

Fuzzy station search — the raw output of the matcher, useful for debugging why a name resolves the way it does.

| Parameter | Required | Range        | Default | Description                     |
|-----------|----------|--------------|---------|---------------------------------|
| `q`       | yes      | —            | —       | Station name in any of the four languages |
| `limit`   | no       | 1–50         | `8`     | Maximum number of matches       |

```bash
curl "http://localhost:9049/api/stations/search?q=hovrino&limit=3"
```

```json
{
  "success": true,
  "query": "hovrino",
  "count": 1,
  "results": [
    {
      "id": 218,
      "name": "Ховрино",
      "nameEn": "Khovrino",
      "lineId": 10,
      "lineName": "Замоскворецкая",
      "lineKind": "metro",
      "clusterId": 218,
      "score": 1
    }
  ]
}
```

Status codes: `200` always when the query is present (an empty `results` array is a valid answer), `400` when `q` is
missing.

## `GET /api/stations/info`

Full station details for a resolved name.

| Parameter | Required | Description                       |
|-----------|----------|-----------------------------------|
| `q`       | yes      | Station name to describe          |

| Status | Body                                                                                  |
|--------|---------------------------------------------------------------------------------------|
| `200`  | `{ success: true, resolved: true, station: { … } }` — lines, exits with ground transport, services, first/last trains, interchanges, advisories |
| `300`  | `{ success: false, resolved: false, reason: 'ambiguous', options: [ … ] }` — several hubs match |
| `404`  | `{ success: false, resolved: false, reason: 'not_found' }`                              |
| `400`  | `q` missing                                                                            |

`300 Multiple Choices` is used literally here: the request is valid, but the caller must pick one of the returned
options.

## `GET /api/routes`

Route variants between two stations.

| Parameter | Required | Range | Default | Description                       |
|-----------|----------|-------|---------|-----------------------------------|
| `from`    | yes      | —     | —       | Departure station name            |
| `to`      | yes      | —     | —       | Arrival station name               |
| `k`       | no       | 1–4   | `4`     | Maximum number of route variants   |

```bash
curl "http://localhost:9049/api/routes?from=hovrino&to=kievskaya&k=2"
```

A successful answer carries the resolved endpoint names plus the search result: `variants` (see
[Route Search](./route-search.md) for what a variant contains), the entry status of the departure hub, and whether
closure data was applied.

| Status | Meaning                                                                                                       |
|--------|---------------------------------------------------------------------------------------------------------------|
| `200`  | Routes found                                                                                                  |
| `300`  | `reason: 'clarification_required'` — one or both names are ambiguous or unknown; per-endpoint detail is returned |
| `400`  | `from` or `to` missing, or both names resolve to the same interchange hub                                       |

## `GET /api/widget-data`

The data endpoint for the MCP Apps route widget. It is not meant to be called by hand — the tool issues the complete
signed link — but the contract is documented for debugging.

| Parameter | Required | Description                                                     |
|-----------|----------|-----------------------------------------------------------------|
| `from`    | yes      | Departure platform ids                                          |
| `to`      | yes      | Arrival platform ids                                            |
| `lang`    | yes      | Response language: `en`, `ru`, `ar`, `cn`                       |
| `at`      | no       | ISO moment to build the route for; absent means "now"            |
| `sig`     | yes      | Truncated HMAC-SHA256 over `from` + `to` + `lang`                |

| Status | Meaning                                                                        |
|--------|--------------------------------------------------------------------------------|
| `200`  | Route payload, including the `modelSummary` the widget pushes to the model context |
| `400`  | Malformed parameters or a signature mismatch (checked before touching the data)   |
| `404`  | The requested platform ids are absent from the current dataset, or no route can be produced at that moment |
| `503`  | No dataset loaded                                                              |

This route skips authentication and is CORS-open by design. See [Route Widget](./route-widget.md) for the reasoning and
the security implications.

## Related

- [Authentication](./authentication.md) — what protects these routes when auth is on.
- [Configuration](./configuration.md) — `restApi.rateLimit`, `webServer.cors.enabled`.
