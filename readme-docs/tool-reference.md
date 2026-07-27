# Tool Reference

MCP METRO exposes a single tool, `metro_info`, that covers both passenger questions through its `action` argument:
`search_route` builds up to three route variants between two stations, `get_station_info` describes one station.
The tool is read-only, accepts station names in four languages with typos, and answers in English Markdown. This
page lists the parameters, what each answer contains, and the MCP resources and prompts published alongside.

## `metro_info`

| Tool         | Description                                                                                        |
|--------------|-----------------------------------------------------------------------------------------------------|
| `metro_info` | Shortest routes between two stations (`search_route`) or full station details (`get_station_info`)  |

The identifier is lowercase snake_case, as the MCP tool-naming standard requires.

### Input parameters

| Parameter              | Required   | Description                                                                                                                                              |
|------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `first_metro_station`  | yes        | Departure station (for a route) or the station to describe. Any of the four languages, typos allowed — resolved by fuzzy search.                           |
| `second_metro_station` | for routes | Arrival station. Required for `action=search_route`, unused for `get_station_info`.                                                                        |
| `action`               | yes        | `search_route` — build routes between two stations; `get_station_info` — describe `first_metro_station`.                                                   |
| `city`                 | no         | `Moscow` (default) or `StPetersburg`. St. Petersburg data is not wired in yet: for now every value falls back to the Moscow dataset.                       |
| `language`             | no         | Language the user communicates in: `en` (default), `ru`, `ar` or `cn`. Station and line names are localized to it; all other response text is English.     |

### What a `search_route` answer contains

- up to 3 route variants, each with total travel time (transfer walking included) and a door-to-door estimate that
  adds street-to-platform enter/exit time;
- the full station sequence of every ride leg;
- transfers, with a hint on which train car to board for a faster interchange (primary data source only);
- which legs run on MCD / MCC lines;
- ground transport (buses, trolleybuses, trams) at the departure and arrival stations;
- advisories along the route: escalator and elevator repairs, closed exits, closed stations;
- entry status of the departure hub by Moscow time — whether vestibules are open and when they close or open next.

### What a `get_station_info` answer contains

Lines at the station, city exits with nearby ground transport, on-station services, first and last train times per
direction, available interchanges, and current advisories.

### Behavior notes

The tool is read-only (`readOnlyHint: true`, `openWorldHint: false`) and never modifies anything. Responses are
English Markdown — lists and tables. When a name is ambiguous the answer is a numbered list to choose from; for a
route request with two ambiguous names, both lists come at once. On hosts that support MCP Apps a `search_route`
answer carries an interactive widget instead of the full Markdown — see [Route Widget](./route-widget.md).

## MCP Resources & Prompts

| URI                                     | MIME                        | Description                                                                     |
|-----------------------------------------|-----------------------------|---------------------------------------------------------------------------------|
| `metro://lines`                         | text/markdown               | All metro / MCC / MCD lines with name, kind and color.                          |
| `metro://status`                        | text/markdown               | Loaded-data summary: station, line, segment and active-advisory counts.         |
| `ui://metro/routes.<hash>.html`         | text/html;profile=mcp-app   | Route widget for MCP Apps hosts; the URI is versioned by the widget content hash. |
| `doc://readme`                          | text/markdown               | The README with every `readme-docs/*.md` satellite appended (served by the SDK). |

| Prompt         | Description                                                            |
|----------------|------------------------------------------------------------------------|
| `agent_brief`  | Short agent description, used when a router picks an agent for a request. |
| `agent_prompt` | Full system prompt telling the model how and when to call `metro_info`. |
