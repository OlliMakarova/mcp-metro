# Data Sources

How the metro dataset is obtained, cached, refreshed and monitored — and why the sources are never named in anything the
server sends out.

## Source confidentiality

The real names of the data sources are confidential. They are allowed in logs and in code comments, but they must never
appear in outward-facing output: MCP tool responses, MCP resources, or REST responses — neither on success nor in error
texts. This document is served to clients as part of the `doc://readme` MCP resource, so it too refers to the sources
only as **primary** and **backup**.

Enforcement is a single choke point, `hideSourceNames()` in `src/lib/metro-data/public-source.ts`, applied to every
error message on its way out of the tool dispatcher and out of each REST route. It replaces any source host name — with
any subdomain and any top-level zone — with the literal `[data source]`. Nothing about a source (name, kind, fetch time)
is exposed to clients at all; even `metro://status` reports only counts.

## Two sources, different richness

| Source      | What it provides                                                                                                             | Limitations                                                        |
|-------------|------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|
| **Primary** | Stations, lines, ride segments and transfers with names in four languages, plus city exits, on-station services, first/last train times, vestibule hours, train-car hints and the live closure/repair feed | Undocumented API, so every response is validated for plausibility   |
| **Backup**  | The complete weighted graph — vertices, ride segments, transfer times, line kinds                                             | Russian names only, one label per hub, no closures, no car hints, no coordinates, no enter/exit times, one-minute time precision |

The backup source publishes its graph inside the HTML of a single page, so acquiring it means parsing that markup. Some
of its gaps are filled by enriching it with the primary source's schema when a cached copy of the latter is available.

One detail worth knowing about the primary source: its segment `pathLength` field is **time in seconds**, not distance.
That was established by cross-checking computed durations against the site's own results, and it is what makes the ride
weights trustworthy.

Because the primary API is undocumented and can change without notice, every response passes a structural validation
step. A response that fails validation is treated exactly like an unreachable source — better to fall back than to build
routes on a shape the code no longer understands.

## Refresh cascade

`src/lib/metro-data/refresh.ts` tries, in order, and stops at the first success:

1. Fresh primary data (schema plus notifications) — the full dataset.
2. Fresh backup data — the reduced dataset (graph core only).
3. Disk copy of the primary data — notifications only if the cached file is younger than
   `metro.notificationsTtlHours` (24 by default).
4. Disk copy of the backup data.
5. Nothing available — the dataset is `null` and route building returns "metro data is temporarily unavailable".

The notifications time-to-live rule is deliberately harsh: if closures could not be fetched during a refresh, their
cached file is **deleted**. Stale closure information is worse than none — it would route passengers around a segment
that reopened last week, or through one that closed yesterday. The schema file, by contrast, is never deleted: stations
and ride segments do not go stale on a 24-hour scale.

A failed refresh never clears the in-memory dataset. Data from the last successful refresh keeps serving requests.

The refresh module touches neither `appConfig` nor the SDK: storage, URLs, `fetch`, clock and logger all arrive as
parameters, which is what makes the cascade testable with substituted sources (`tests/lib/refresh.test.ts`).

## Startup and scheduling

`initMetroData()` in `src/lib/metro-data/init.ts` runs three things at server start:

1. **Instant disk load** — the newest cached copy is read before the HTTP server begins listening, so the server answers
   correctly within a second of starting, with no network dependency.
2. **Background refresh** — a network refresh fires immediately after startup but is not awaited, so a slow or dead
   source cannot delay the server coming up.
3. **Scheduler** — a repeating refresh every `metro.refreshIntervalHours` (24 by default). The timer is `unref`'d, so it
   never keeps the process alive on shutdown.

## Disk cache

The cache lives in `data-cache/` in the project root (not under version control, and not configurable — it is a constant
in `src/lib/metro-data/metro-config.ts`). It holds four JSON files: the primary schema, the primary notifications, the
normalized backup graph, and a `meta.json` recording, per file, when it was fetched, its size and its SHA-256 hash.

Writes are atomic — first to a temporary file, then a rename — so a crash mid-write can never leave half-written JSON
behind for the next start to choke on.

## Source-state alerting

`src/lib/metro-data/source-state.ts` maps each refresh result to one of four levels:

| Level    | Meaning                                                        | Consequence for answers                                                   |
|----------|----------------------------------------------------------------|---------------------------------------------------------------------------|
| `ok`     | Fresh full data from the primary source                          | Everything available                                                       |
| `backup` | Primary unavailable, fresh backup data in use                    | Routes work; closures, car hints and ground transport are missing           |
| `disk`   | Both sources unavailable, running on a disk copy                 | Routes work; stale closure data has been removed                            |
| `none`   | No data at all                                                  | Route building returns an error until a source recovers                     |

Alerting is **edge-triggered**: a Telegram message is sent only when the level *changes*, in both directions —
degradation and recovery alike. A source that stays down produces one message, not one per refresh. The initial level is
assumed to be `ok`, so the first successful refresh after a restart is silent while the first degraded one alerts
immediately.

Configure it in `config/local.yaml`:

```yaml
telegram:
  enabled: true
  botToken: '<token from @BotFather>'
  chatId: '<chat, group or channel id>'
```

Sending is one plain Bot API request with no external library, and it can never break the refresh: a network failure, a
timeout or a rejection is logged and the function returns `false`. See `src/lib/telegram-notify.ts`.

## Related

- [Configuration](./configuration.md) — the `metro` and `telegram` sections.
- [Route Search](./route-search.md) — which route fields depend on which source.
- [Deployment](./deployment.md) — the deploy pipeline has its own, separate Telegram channel.
