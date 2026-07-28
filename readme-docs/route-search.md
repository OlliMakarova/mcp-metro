# Route Search

How MCP METRO turns two station names into ranked route variants with realistic travel times. In short: Yen's
k-shortest-paths algorithm runs over a weighted graph rebuilt for the requested moment, closures active at that
moment are removed from the graph before the search, expected train waiting time is added at every boarding, and
variants more than 30% slower than the fastest one are dropped. The rest of this page explains each piece.

## The graph

`src/lib/routing/graph.ts` builds a weighted directed graph from the unified dataset, **for a specific moment** (the
`at` parameter, "now" by default):

- **Nodes** are stations of a specific line. One physical interchange hub is therefore several nodes — for example
  Komsomolskaya on the Sokolnicheskaya line and Komsomolskaya on the Koltsevaya line are two nodes joined by a transfer
  edge.
- **Edges** are ride segments along a line (`kind: 'ride'`) and walking transfers inside a hub (`kind: 'transfer'`).
- **Weights** are seconds. There is no separate "transfer penalty": the walking time is the transfer edge's own weight,
  and a ground transfer (out to the street and back in) is flagged as such.

The Moscow graph is roughly 450 nodes and 1200 edges; the Saint Petersburg one is an order of magnitude smaller, about
75 nodes. Either way a single search takes a fraction of a millisecond. The builder is city-agnostic — it is handed a
dataset and never asks which city it came from.

### Closures are baked into the graph, not filtered afterwards

Advisories active at the moment `at` (their `startDate <= at <= endDate`) are applied in this order:

1. select the active notifications;
2. remove every edge whose status is `CLOSED`;
3. add the official detour edges the notification supplies;
4. drop `CLOSED` stations as entry, exit and transfer points;
5. keep `EMERGENCY` and `INFO` statuses as station warnings.

`EMERGENCY` is deliberately only a warning badge — an escalator repair does not close a station, so it must not remove
it from the graph. The route response reports such warnings next to the affected station.

## Time model

The weight of a ride segment comes from the data source (seconds, verified against the official site's own
calculations). Two things are added on top.

**Expected waiting for a train.** `src/lib/routing/train-intervals.ts` holds an empirical interval model, because no
official "line × hour → interval" table is published. The expected wait is the interval multiplied by
`EXPECTED_WAIT_FACTOR = 0.75`, added once at the boarding station and once after every transfer. The theoretical average
would be 0.5 of the interval; 0.75 is a deliberately conservative value that absorbs walking along the platform, letting
an overcrowded train pass, and interval jitter.

Interval bands, by line kind and time of Moscow day:

| Line kind        | Peak                                        | Daytime      | Late evening / night |
|------------------|---------------------------------------------|--------------|----------------------|
| Metro            | ~2 min (07:30–10:00 and 17:30–20:00)         | ~3.5 min     | ~6 min               |
| MCC (МЦК)        | 4 min (weekdays 07:30–11:30, 16:00–21:00; weekends 12:30–18:00) | 8 min | 8 min |
| MCD (МЦД)        | ~6 min (07:00–10:00, 17:00–20:00 weekdays)   | ~12 min      | ~15 min              |

MCD figures are the roughest of the three: real intervals there depend on the individual train and its terminus
(express runs, short runs), which the public data does not expose.

The bands were calibrated on Moscow observations, and the metro row is reused as-is for Saint Petersburg — its service
pattern is close enough for an estimate, but the figures are not measured there. Both cities keep the same wall clock,
so "peak" and "late evening" mean the same hours in either.

**Door-to-door estimate.** When the data supplies street-to-platform enter and exit times, the response adds a
door-to-door figure next to the pure travel time. Moscow has them per station from the primary source; Saint Petersburg
uses one network-wide figure taken from the official route calculator. With Moscow backup-source data those fields are
simply absent. When the model was told how long the user walks to or from the metro, those minutes are added on top and
drawn as separate walking segments.

## k shortest paths and variant identity

`src/lib/routing/yen.ts` implements Yen's algorithm on top of Dijkstra: it bans, one by one, the edges the already-found
paths used, searches for spur paths from each branching point, and promotes the fastest candidate to the next variant.

Two refinements matter for the answer quality:

- **Over-fetching.** Yen returns near-duplicates that differ only by which walk inside a hub they take. The search
  therefore requests `max(k × 4, 12)` raw paths per station pair, so enough genuinely different routes survive
  deduplication.
- **Variant identity is the ride sequence only.** The deduplication key is the list of ride legs — which lines you take
  and between which stations. Transfer legs are walks *inside* a hub and never distinguish routes: two paths with the
  same rides but a different or extra hub walk are the same route. Because candidates are sorted by total time before
  deduplication, the survivor is the fastest one, which means "when a hub offers several transfers, only the quickest is
  kept".

When either endpoint is an interchange hub, the search runs over every departure × arrival platform pair and merges the
results. Pairs where a station is closed or no path exists are skipped silently; only if *no* pair produces a route does
the error surface.

## Ranking and cut-off

Variants are sorted by total time. Anything more than **30%** slower than the fastest is dropped
(`MAX_SLOWER_RATIO = 1.3`), and the fastest variant is always kept. Then the first `k` survive:

- the MCP tool asks for `k = 3` (`ROUTE_COUNT` in `src/tools/metro-info.ts`) to keep the answer compact;
- `GET /api/routes` accepts `k` between 1 and 4.

## Operating hours

`src/lib/routing/operating-hours.ts` computes the entry status of the departure hub in Moscow time — which is also
Petersburg time, so one clock serves both cities: whether at least one vestibule is open right now, the governing
window, minutes until entry closes, or when it opens next. In Moscow the check reads per-weekday vestibule hours from
the primary source; in Saint Petersburg the official source publishes no weekday split, so its single window is applied
to all seven days. When no vestibule of the hub has usable hours (the Moscow backup source has none), the typical
window **05:30–01:00** is assumed and the status is marked approximate.

Travel times are never adjusted by this — the status is informational and is rendered as a warning at the top of the
route answer. The status is computed across *all* vestibules of the departure hub, not just the platform the fastest
variant starts from.

## What a variant carries

- Ride legs: line (with kind, color and MCC/MCD flags) and the full ordered station list.
- Transfer legs: both stations, walking time, whether it goes via the street, which cars to board (Moscow primary source
  only), and whether the edge is a notification-supplied detour.
- Ground transport at the departure and arrival stations, derived from the exit descriptions (Moscow only).
- Station warnings collected along the route.
- Whether closure data was applied at all (`closuresApplied`) — false means the notifications file was unavailable.

## Related

- [Station Resolution](./station-resolution.md) — how the two names become platform ids.
- [Cities](./cities.md) — which of these fields each city actually fills.
- [Data Sources](./data-sources.md) — where segment times, vestibule hours and advisories come from.
- [Route Widget](./route-widget.md) — how variants are presented in MCP Apps hosts.
