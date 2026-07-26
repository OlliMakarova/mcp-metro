import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { asTextContent, asTextError, hostSupportsMcpApps, IToolHandlerParams, TToolHandlerResponse } from 'fa-mcp-sdk';

import { debugFuzzySearch } from '../debug.js';
import { getMetroDatasetOrNull } from '../lib/metro-data/cache.js';
import { pickName, toLang } from '../lib/metro-data/localized-name.js';
import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { findBestRoutes } from '../lib/routing/find-routes.js';
import { buildStationInfo } from '../lib/station-info.js';
import { IStationOption, resolveStation, TStationResolution } from '../lib/station-search/resolve-station.js';
import { renderResolutionAsk, renderRoutes, renderStationInfo } from './lib/render.js';
import { buildModelSummary } from './widget/model-summary.js';
import { buildWidgetDataUrl } from './widget/widget-data-link.js';
import { ROUTES_WIDGET_URI } from './widget/widget-resource.js';

/** How many route variants to request (capped at 3 to keep the tool response compact) */
export const ROUTE_COUNT = 3;

/** Single "metro data unavailable" error text in markdown (without real source names) */
const DATA_UNAVAILABLE_MD = `## Metro data is temporarily unavailable. Please retry later.`;

/**
 * Tool definition.
 *
 * The schema conforms to JSON Schema draft 2020-12 and forbids unknown fields
 * (`additionalProperties: false`) — a requirement of the standard, §9.2.
 */
export const metroInfoTool: Tool = {
  name: 'metro_info',
  title: 'Metro: routes and station details',
  description: `Finds the shortest routes between two stations in the Moscow or Saint Petersburg Metro, 
including the MCC (МЦК) and MCD (МЦД), in search_route mode, or provides details for a single station in get_station_info mode.

Returns:
- total travel time
- stations
- transfers
- surface transport at the route endpoints
- restrictions, repairs, and closures
- lines
- exits
- services
- first and last train schedules

Pass station names exactly as the user writes them.`,
  inputSchema: {
    type: 'object',
    properties: {
      first_metro_station: {
        type: 'string',
        description: `Name of the departure station (for search_route) or of the station to describe (for get_station_info).`,
      },
      second_metro_station: {
        type: 'string',
        description: `Name of the arrival station. Required only for action=search_route.`,
      },
      action: {
        type: 'string',
        enum: ['search_route', 'get_station_info'],
        description: `Action type: "search_route" — build the shortest routes between two stations;
"get_station_info" — return details of the first_metro_station station.`,
      },
      city: {
        type: 'string',
        enum: ['Moscow', 'StPetersburg'],
        default: 'Moscow',
        description: `City whose metro to query. Defaults to Moscow.`,
      },
      language: {
        type: 'string',
        enum: ['en', 'ru', 'ar', 'cn'],
        default: 'en',
        description: `Language the user communicates in, when it is clear from the conversation context`,
      },
      walk_to_metro_minutes: {
        type: 'integer',
        minimum: 1,
        maximum: 600,
        description: `Walk time in minutes from the user's starting point to the departure metro station.
Set it ONLY when the conversation context explicitly states this time; NEVER guess or estimate it yourself — omit the parameter when
the context says nothing. When set, it is added to the total travel time and shown as a walking segment.
Used only with action=search_route.`,
      },
      walk_from_metro_minutes: {
        type: 'integer',
        minimum: 1,
        maximum: 600,
        description: `Walk time in minutes from the arrival metro station to the user's destination.
Set it ONLY when the conversation context explicitly states this time; NEVER guess or estimate it yourself — omit the parameter when
the context says nothing. When set, it is added to the total travel time and shown as a walking segment.
Used only with action=search_route.`,
      },
    },
    required: ['first_metro_station', 'action'],
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
  },
  // MCP Apps (SEP-1865): hosts that support UI widgets fetch this ui:// resource and render
  // tool responses in an iframe. Text-only hosts ignore the meta and keep the markdown answer.
  _meta: {
    ui: { resourceUri: ROUTES_WIDGET_URI },
  },
};

/** Walk-minutes tool argument → integer 1..600, or undefined when absent or not a sane number */
const sanitizeWalkMinutes = (value: unknown): number | undefined => {
  const raw = Number(value);
  return Number.isFinite(raw) && raw >= 1 && raw <= 600 ? Math.round(raw) : undefined;
};

// ─── DEBUG=fuzzy-search: console tables of clarification alternatives ────────

/** Aligned text table of station alternatives: name, cluster id, platform ids, similarity */
const optionsTable = (options: IStationOption[]): string => {
  const header = ['#', 'Station', 'Cluster', 'Station ids', 'Score'];
  const rows = options.map((o, i) => [
    String(i + 1),
    o.name.en && o.name.en !== o.name.ru ? `${o.name.ru} / ${o.name.en}` : o.name.ru,
    String(o.clusterId),
    o.ids.join(', '),
    o.score.toFixed(4),
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, c) => Math.max(...all.map((r) => r[c]!.length)));
  return all.map((r) => r.map((cell, c) => cell.padEnd(widths[c]!)).join('  ')).join('\n');
};

/**
 * DEBUG=fuzzy-search: prints the clarification alternatives the tool is about to return
 * (ambiguous resolution), or a note that nothing matched (not_found).
 */
const debugStationResolution = (query: string, resolution: TStationResolution): void => {
  if (!debugFuzzySearch.enabled) {
    return;
  }
  if (resolution.kind === 'ambiguous') {
    debugFuzzySearch(
      `Ambiguous «${query}» — ${resolution.options.length} alternatives:\n${optionsTable(resolution.options)}`,
    );
  } else if (resolution.kind === 'not_found') {
    debugFuzzySearch(`Not found: «${query}» — no sufficiently similar station names`);
  }
};

/**
 * Universal tool: station details or shortest routes between two stations.
 * All responses are returned as ready-made English markdown text (lists and tables);
 * station and line names are localized to the requested `language`.
 *
 * When the client advertises MCP Apps support, a route response carries ONLY a compact
 * `structuredContent = { widget, dataUrl }` and no text — the widget (loaded from the versioned
 * ui:// resource) fetches its route data from that self-describing, signed link over REST and is the
 * sole route output. Text-only hosts (no MCP Apps support) receive the full route markdown instead.
 * Non-route responses (station info, clarifications) are always markdown, regardless of UI support.
 */
export const handleMetroInfo = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const args = params.arguments;
  const first = String(args?.first_metro_station ?? '').trim();
  const second = String(args?.second_metro_station ?? '').trim();
  const action = args?.action;
  const lang = toLang(args?.language);
  // Walk times to the departure station and from the arrival station: taken into account only when
  // the model passed a sane positive number (the model is instructed to set them only when the
  // context mentions them).
  const walkToMin = sanitizeWalkMinutes(args?.walk_to_metro_minutes);
  const walkFromMin = sanitizeWalkMinutes(args?.walk_from_metro_minutes);
  // The city parameter is accepted for forward compatibility: St. Petersburg metro data is not
  // wired in yet, so 'StPetersburg' currently falls back to the Moscow dataset like any other value.

  if (!first) {
    return asTextError('The first_metro_station parameter is not specified.');
  }
  if (action !== 'search_route' && action !== 'get_station_info') {
    return asTextError('The action parameter must be "search_route" or "get_station_info".');
  }

  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return asTextError(DATA_UNAVAILABLE_MD);
  }

  // ── Station details ─────────────────────────────────────────────────────────
  if (action === 'get_station_info') {
    const resolution = resolveStation(dataset, first);
    if (resolution.kind !== 'resolved') {
      debugStationResolution(first, resolution);
      return asTextContent(renderResolutionAsk('the station', first, resolution, lang));
    }
    const info = buildStationInfo(dataset, resolution.option.ids);
    return asTextContent(renderStationInfo(info, lang));
  }

  // ── Route search ────────────────────────────────────────────────────────────
  if (!second) {
    return asTextError('To build a route, specify the arrival station in second_metro_station.');
  }

  const r1 = resolveStation(dataset, first);
  const r2 = resolveStation(dataset, second);
  const need1 = r1.kind !== 'resolved';
  const need2 = r2.kind !== 'resolved';

  // If at least one station needs clarification — ask to clarify all such stations at once
  if (need1 || need2) {
    const blocks: string[] = [];
    if (need1) {
      debugStationResolution(first, r1);
      blocks.push(renderResolutionAsk('the departure station', first, r1, lang));
    }
    if (need2) {
      debugStationResolution(second, r2);
      blocks.push(renderResolutionAsk('the arrival station', second, r2, lang));
    }
    return asTextContent(`# Station clarification needed\n\n${blocks.join('\n\n')}`);
  }

  // Both stations resolved
  const fromOpt = (r1 as Extract<typeof r1, { kind: 'resolved' }>).option;
  const toOpt = (r2 as Extract<typeof r2, { kind: 'resolved' }>).option;
  const fromName = pickName(fromOpt.name, lang);
  const toName = pickName(toOpt.name, lang);

  if (fromOpt.clusterId === toOpt.clusterId) {
    return asTextContent(
      `# No route needed

The departure and arrival stations are the same: **${fromName}**. They belong to the same interchange hub.`,
    );
  }

  try {
    const result = findBestRoutes(dataset, fromOpt.ids, toOpt.ids, { k: ROUTE_COUNT });
    // MCP Apps host: the widget (from structuredContent) is the human-facing route output, so we do
    // NOT return the full route markdown (the widget would just be duplicated in words). But the
    // model still needs a trace of what the user sees on THIS turn — the MCP Apps spec keeps
    // structuredContent out of the model context — so we return ONE short text block: the same
    // summary the widget later pushes via ui/update-model-context. Both come from buildModelSummary
    // with the same arguments, so the wording is identical across the first and later turns. The
    // link records the moment of this call; the widget's "Refresh route" button drops `at`.
    if (hostSupportsMcpApps(params.clientCapabilities)) {
      const summary = buildModelSummary(result, fromName, toName, lang, walkToMin, walkFromMin);
      // No usable summary (no route variants) — fall back to the plain text answer, exactly as for a
      // text-only host, so the model is never left with an empty result.
      if (!summary) {
        return asTextContent(renderRoutes(result, fromName, toName, lang, walkToMin, walkFromMin));
      }
      const dataUrl = buildWidgetDataUrl({
        fromIds: fromOpt.ids,
        toIds: toOpt.ids,
        lang,
        at: new Date(),
        ...(walkToMin !== undefined ? { walkToMin } : {}),
        ...(walkFromMin !== undefined ? { walkFromMin } : {}),
      });
      return {
        content: [{ type: 'text', text: summary }],
        structuredContent: { widget: 'metro-routes', dataUrl },
      };
    }
    // Text-only host: the full route markdown is the answer.
    return asTextContent(renderRoutes(result, fromName, toName, lang, walkToMin, walkFromMin));
  } catch (e) {
    const msg = hideSourceNames(e instanceof Error ? e.message : String(e));
    return asTextError(`Failed to build a route ${fromName} → ${toName}: ${msg}`);
  }
};
