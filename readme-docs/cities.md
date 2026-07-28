# Cities

MCP METRO serves two networks — Moscow and Saint Petersburg — through the same tool, the same routing algorithms and
the same fuzzy name resolution. In short: the city is chosen by one argument (`city`, Moscow by default), each city has
its own dataset built from its own sources, and the two differ in richness rather than in behavior — Moscow answers add
ground transport, on-station services and train-car hints, while Saint Petersburg answers stay with lines, official
vestibule hours, first and last trains and closures. This page states exactly what each city carries, so nothing in an
answer comes as a surprise.

## Choosing the city

| Interface                                  | How the city is passed                                                     |
|--------------------------------------------|----------------------------------------------------------------------------|
| MCP tool `metro_info`                      | `city`: `Moscow` (default) or `StPetersburg`                                 |
| REST `/api/stations/search`, `/stations/info`, `/routes` | `city=spb` (or `city=stpetersburg`); anything else means Moscow |
| Route widget                               | The city is baked into the signed data link and never changes inside a card  |

An unrecognized value always falls back to Moscow rather than failing — a request is answered, not rejected. The two
datasets are independent: they are loaded, refreshed and monitored separately, so an outage on one city's sources leaves
the other city answering normally.

## What each network contains

Counts from the current data copy; they move when a line opens or a station is added.

| Property                             | Moscow                                  | Saint Petersburg          |
|--------------------------------------|-----------------------------------------|---------------------------|
| Lines                                | 21 — metro plus MCC (МЦК) and MCD (МЦД) | 6 — metro only            |
| Physical stations (interchange hubs) | 308                                     | 66                        |
| Platform nodes in the graph          | 443                                     | 75                        |
| Ride segments and transfers          | 608                                     | 88                        |

## What differs in the answers

| Answer element                                    | Moscow | Saint Petersburg                                  |
|---------------------------------------------------|--------|----------------------------------------------------|
| Route variants, travel time, full station sequence | yes    | yes                                                |
| Transfers with walking time                       | yes    | yes                                                |
| Which train car to board for a faster interchange | yes    | no                                                 |
| Door-to-door estimate (street to platform)        | yes    | yes — one network-wide value, not per station      |
| Vestibule opening hours and entry status          | yes — per weekday | yes — one window applied to all seven days |
| First and last trains per direction               | yes    | yes — with separate odd-day / even-day timetables  |
| Closures, repairs and official detours            | yes — live feed with detour edges | yes — closed stations and closed transfers |
| Ground transport (buses, trolleybuses, trams)     | yes    | no                                                 |
| On-station services                               | yes    | no                                                 |
| City exits                                        | all stations | only where the official source names them    |
| Station and line names                            | Russian, English, Arabic, Chinese | Russian                  |

## Names and languages

The `language` argument works for both cities, but it can only pick a name the data actually has. Moscow names exist in
four languages, so `language=cn` returns Chinese station names. Saint Petersburg names exist in Russian only, so its
answers name stations in Russian whatever the language — everything around them (headings, labels, explanations) is
still English, and the model retells the answer in the user's language as usual.

Recognizing what the user typed is a separate matter and works the same in both cities: Latin transliteration
(`devyatkino`), Russian case forms (`до Технологического института`) and typos all resolve, because those
variants are generated from the Russian name rather than read from the data. See
[Station Resolution](./station-resolution.md).

## Shared machinery, one honest caveat

Graph construction, Yen's k-shortest-paths search, closure handling, hub clustering and the widget are city-agnostic —
they receive a dataset and do not care which city produced it. Both cities also live in the same time zone, so the
operating-hours math needs no per-city clock.

One piece is genuinely shared rather than city-specific: the empirical train-interval model, which was calibrated on
Moscow observations and is reused for Saint Petersburg. Its metro bands (roughly two minutes at peak, three and a half
during the day, six late in the evening) match the Saint Petersburg pattern closely enough for an estimate, but they are
not measured there. See [Route Search](./route-search.md).

## Saint Petersburg specifics

- **The newest line is supplemented.** The graph source lags behind the network: it does not yet know line 6
  (Krasnoselsko-Kalininskaya, open since 2024). Its two stations, the ride between them and the transfer to
  Kirovsky Zavod are added from the official data at assembly time. The supplement switches itself off automatically as
  soon as the graph source starts listing Yugo-Zapadnaya on its own — there is no flag to flip.
- **Transfer times come from the official route calculator**, a uniform 235 seconds that includes the walk and the wait
  for the next train. The graph source's own uniform 60 seconds is unrealistically low and is replaced everywhere.
- **The door-to-door estimate uses one network-wide entrance figure** — the mean of the official calculator's
  170–230 second range — because no per-station values are published. Moscow, by contrast, has them per station.
- **Closures arrive from two directions** and are deduplicated: stations marked closed on the official operating-hours
  page, and stations commented out of the official interactive scheme's picker. Announced transfer closures become
  notifications that remove exactly those transfer edges from the graph, so routes are rebuilt around them.
- **Closure notices carry a long validity window** (400 days) because the source states no end date. A station closed
  for reconstruction stays flagged until the source stops saying so, which is the correct behavior for multi-year
  reconstructions.

## Related

- [Tool Reference](./tool-reference.md) — the `city` argument and what each answer contains.
- [Data Sources](./data-sources.md) — the per-city source cascade, the disk cache and the alerting.
- [Route Search](./route-search.md) — the graph, the time model and the ranking, identical for both cities.
