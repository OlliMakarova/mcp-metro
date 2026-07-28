# Station Resolution

How free-form text like `hovrino`, `до Чеховской` or `基辅站` becomes a concrete set of platform ids — or an honest
request for clarification.

## Three possible outcomes

`resolveStation()` in `src/lib/station-search/resolve-station.ts` always reduces a query to one of three results:

| Outcome     | Meaning                                                                    | What the tool does                                     |
|-------------|----------------------------------------------------------------------------|--------------------------------------------------------|
| `resolved`  | Exactly one physical station (interchange hub) identified                    | Uses its platform ids as route endpoints                |
| `ambiguous` | Several different hubs match                                                | Returns a numbered list, up to 6 options, to choose from |
| `not_found` | Nothing similar enough                                                      | Asks the user to refine the name                        |

For a route request where both names are ambiguous, both lists are returned in one answer, so the user clarifies
everything in a single turn.

## Why interchange hubs matter

In the dataset a graph node is a station *on a line*. One physical station that serves several lines is therefore
several nodes joined by transfer edges. Two situations look identical to a naive name search but must behave
differently:

- **Komsomolskaya** on the Sokolnicheskaya and Koltsevaya lines — one hub, connected by a transfer. There is nothing to
  clarify: it is one station, and all its platform ids become route endpoints.
- **Smolenskaya** on the Arbatsko-Pokrovskaya and Filyovskaya lines — two different stations with no transfer between
  them. Here clarification is required, because the answer genuinely depends on which one the user means.

`src/lib/station-search/station-clusters.ts` distinguishes the two with a union-find (disjoint-set) pass over the
transfer edges: everything reachable through a chain of transfers lands in one cluster. The result is memoized by
dataset object identity in a `WeakMap`, so the daily data refresh — which produces a new dataset object — recomputes
clusters automatically without any invalidation logic.

## Name index

`src/lib/station-search/search-index.ts` builds, for every station, a list of normalized spelling variants:

- every language the data has for that station — Russian, English, Arabic and Chinese in Moscow, Russian in Saint
  Petersburg;
- transliteration of the Russian name into Latin (`Ховрино` → `khovrino`);
- reverse transliteration of the English name back into Cyrillic, which catches sources that spell a name differently;
- search aliases — the "second" names of interchange hubs, added when running on backup-source data;
- **Russian case forms** kept in a separate list.

Case forms (`чеховской`, `октябрьского поля`) are generated heuristically by
`src/lib/station-search/russian-declension.ts` from the common declension patterns of Russian adjectives and nouns.
They are matched **only exactly**, never fuzzily: comparing similarity against declensions adds noise that lets junk
queries cross the threshold, while a typo in an oblique-case query is already caught by fuzzy matching against the
nominative. An occasionally wrong generated form is harmless — it just sits in the index as a variant nobody types.

Like the clusters, the index is memoized per dataset object — and since each city has its own dataset, each city gets
its own index and its own clusters, with no name ever leaking across the city boundary. The variants that matter most in
practice — transliteration and case forms — are generated from the Russian name rather than read from the data, so they
work in Saint Petersburg exactly as they do in Moscow even though its data carries Russian names only.

## Similarity metric

`src/lib/station-search/string-similarity.ts` combines two measures, both tolerant of the mistakes people actually make:

- **OSA distance** (Optimal String Alignment) — Levenshtein edit distance extended with transposition of adjacent
  characters, which is exactly the shape of a typical typo (`Ховирно`).
- **Weighted token LCS** — a phrase-level measure that survives word reordering and joined or split spelling
  (`октябрьскоеполе`).

Both run on text normalized to lowercase without diacritics, with `ё` folded to `е`. Distance results are cached with a
100 000-entry ceiling so a stream of requests cannot grow memory without bound.

## Search rules

`fuzzySearchStations()` applies these rules in order:

1. If the best similarity is below the threshold (**0.5** by default), return nothing — that becomes `not_found`.
2. If an exact match exists (similarity 1), return only exact matches. Same-named stations on different lines are all
   returned; the line tells them apart.
3. Otherwise return the best candidates in descending similarity, up to the limit (default 5; the resolver asks for 8,
   the REST endpoint accepts 1–50).

The resolver then groups the surviving candidates by cluster, keeps the highest similarity per cluster along with all
its platform ids and lines, and sorts clusters by score with the Russian name as a tie-breaker. One cluster means
`resolved`; more than one means `ambiguous`.

## Inspecting decisions

`DEBUG=fuzzy-search` prints an aligned console table of the alternatives a response is about to return — name, cluster
id, platform ids and similarity — plus a line when nothing matched. This is the fastest way to see why a particular
query produced a clarification list instead of a direct answer.

```bash
DEBUG=fuzzy-search npm start
```

The same data is available over HTTP without the tool layer: `GET /api/stations/search?q=<name>` returns the scores. See
[REST API](./rest-api.md).

## Related

- [Route Search](./route-search.md) — what happens once both names resolve.
- [Cities](./cities.md) — which languages exist in each city's data.
- [Data Sources](./data-sources.md) — which languages and aliases each source provides.
