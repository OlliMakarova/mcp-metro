# Data Sources

How the metro datasets are obtained, cached, refreshed and monitored — and why the sources are never named in anything
the server sends out. Each city has its own set of sources and its own cascade; they are refreshed on the same schedule
but fail independently, so an outage in one city never affects the other.

## Source confidentiality

The real names of the data sources are confidential. They are allowed in logs and in code comments, but they must never
appear in outward-facing output: MCP tool responses, MCP resources, or REST responses — neither on success nor in error
texts. This document is served to clients as part of the `doc://readme` MCP resource, so it too refers to the sources
only as **primary** and **backup**.

Enforcement is a single choke point, `hideSourceNames()` in `src/lib/metro-data/public-source.ts`, applied to every
error message on its way out of the tool dispatcher and out of each REST route. It replaces any source host name — with
any subdomain and any top-level zone — with the literal `[data source]`. Nothing about a source (name, kind, fetch time)
is exposed to clients at all; even `metro://status` reports only counts.

## Moscow: two sources, different richness

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

## Saint Petersburg: one graph core plus three enrichments

The Saint Petersburg dataset is assembled rather than downloaded. One source carries the **graph core** — stations per
line, ride segments and transfers in seconds — in the same page-embedded format the Moscow backup uses, so the parser is
shared. Three further sources layer detail on top, and each of them is optional: when one is missing the dataset simply
carries less, and the refresh still succeeds.

| Role                | What it contributes                                                                                        | If it is missing                              |
|---------------------|------------------------------------------------------------------------------------------------------------|-----------------------------------------------|
| **Graph core**      | Stations, lines, ride segments, transfers — everything routing needs                                        | The core is rebuilt from the route calculator  |
| **Route calculator**| Realistic transfer time (235 s), street entrance/exit time, closed stations, announced transfer closures     | Transfers keep the core's optimistic 60 s      |
| **Reference source**| Station coordinates, line names, line colors and display order                                              | Lines lose names and colors, stations coordinates |
| **Official hours**  | Vestibule opening hours, first/last trains per direction with odd/even-day timetables, exits, closure notes  | No hours, no train timetables, fewer notices   |

The route calculator plays two roles at once: normally it is an enrichment, but if both the graph core and its disk copy
are gone, the same file is converted into a full graph and becomes the backup core — with ride times derived from the
scheme's own geometry, which is why that state is reported as degraded rather than normal.

Two assembly steps are worth knowing about. The newest line is **supplemented** from the official data, because the
graph source has not caught up with it yet, and the supplement disables itself automatically once the source does. And
the core's uniform 60-second transfer is **replaced everywhere** by the calculator's 235 seconds, which includes walking
plus waiting for the next train. Both are covered in [Cities](./cities.md).

## Refresh cascade — Moscow

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

## Refresh cascade — Saint Petersburg

`src/lib/metro-data/refresh-spb.ts` follows the same idea with a different shape, because three of its four sources are
optional. The graph core decides whether there is a dataset at all:

1. Fresh graph core — the best case.
2. Its disk copy — when the source is unreachable.
3. The route calculator, fresh or from disk, converted into a graph — a working network with approximate ride times.
4. Nothing available — the dataset is `null` and Saint Petersburg route building returns the unavailability message.

Each enrichment is fetched independently and falls back to its own disk copy without affecting the others. None of the
Saint Petersburg files has a time-to-live: stations, ride times and opening hours do not go stale within a day the way a
live closure feed does, and the closure notes synthesized here carry their own validity window instead.

## Startup and scheduling

`initMetroData()` in `src/lib/metro-data/init.ts` runs three things at server start, for both cities:

1. **Instant disk load** — the newest cached copy of each city is read before the HTTP server begins listening, so the
   server answers correctly within a second of starting, with no network dependency.
2. **Background refresh** — a network refresh fires immediately after startup but is not awaited, so a slow or dead
   source cannot delay the server coming up.
3. **Scheduler** — a repeating refresh every `metro.refreshIntervalHours` (24 by default). The timer is `unref`'d, so it
   never keeps the process alive on shutdown.

## Disk cache

The cache lives in `data-cache/` in the project root (not under version control, and not configurable — it is a constant
in `src/lib/metro-data/metro-config.ts`). It holds one JSON file per source — for Moscow the primary schema, the primary
notifications and the normalized backup graph; for Saint Petersburg the graph core and its three enrichments — plus a
`meta.json` recording, per file, when it was fetched, its size and its SHA-256 hash.

Writes are atomic — first to a temporary file, then a rename — so a crash mid-write can never leave half-written JSON
behind for the next start to choke on.

## Source-state alerting

`src/lib/metro-data/source-state.ts` maps each refresh result to one of four levels, **per city**:

| Level    | Meaning                                                        | Consequence for answers                                                   |
|----------|----------------------------------------------------------------|---------------------------------------------------------------------------|
| `ok`     | Fresh full data from the primary source                          | Everything available                                                       |
| `backup` | Primary unavailable, fresh backup data in use                    | Moscow: routes work, closures, car hints and ground transport are missing. Saint Petersburg: routes work, ride times are approximate |
| `disk`   | Sources unavailable, running on a disk copy                      | Routes work; in Moscow stale closure data has been removed                  |
| `none`   | No data at all                                                  | Route building in that city returns an error until a source recovers        |

Alerting is **edge-triggered**: a Telegram message is sent only when the level *changes*, in both directions —
degradation and recovery alike. A source that stays down produces one message, not one per refresh. The initial level is
assumed to be `ok`, so the first successful refresh after a restart is silent while the first degraded one alerts
immediately. Each city is tracked separately and its messages name the city, so a Petersburg outage and a Moscow one are
never confused with each other.

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

- [Cities](./cities.md) — what the assembled data of each city actually contains.
- [Configuration](./configuration.md) — the `metro` and `telegram` sections.
- [Route Search](./route-search.md) — which route fields depend on which source.
- [Deployment](./deployment.md) — the deploy pipeline has its own, separate Telegram channel.
