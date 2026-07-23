import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { asTextContent, asTextError, hostSupportsMcpApps, IToolHandlerParams, TToolHandlerResponse } from 'fa-mcp-sdk';

import { debugFuzzySearch } from '../debug.js';
import { getMetroDatasetOrNull } from '../lib/metro-data/cache.js';
import { pickName, toLang } from '../lib/metro-data/localized-name.js';
import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { findBestRoutes } from '../lib/routing/find-routes.js';
import { buildStationInfo } from '../lib/station-info.js';
import { IStationOption, resolveStation, TStationResolution } from '../lib/station-search/resolve-station.js';
import { renderResolutionAsk, renderRoutes, renderStationInfo } from './metro/render.js';
import { buildRoutesWidgetData } from './metro/widget-data.js';
import { ROUTES_WIDGET_URI } from './metro/widget-resource.js';

/** How many route variants to request (capped at 3 to keep the tool response compact) */
const ROUTE_COUNT = 3;

/** Single "metro data unavailable" error text in markdown (without real source names) */
const DATA_UNAVAILABLE_MD = `## Moscow Metro data is temporarily unavailable. Please retry later.`;

/**
 * Tool definition.
 *
 * The schema conforms to JSON Schema draft 2020-12 and forbids unknown fields
 * (`additionalProperties: false`) — a requirement of the standard, §9.2.
 */
export const mosMetroInfoTool: Tool = {
  name: 'mos_metro_info',
  title: 'Moscow Metro: routes and station details',
  description: `Finds routes between two stations of the Moscow Metro (including the MCC and MCD) and returns station details.
In search_route mode it builds 1 to 3 shortest routes between two stations with the total travel time, stations, transfers, car recommendations, surface transport at the endpoint stations, and active restrictions (repairs, closures).
In get_station_info mode it returns station details: lines, exits, surface transport, services, first/last train schedule, transfers and warnings.

Pass station names exactly as the user writes them.
`,
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
      language: {
        type: 'string',
        enum: ['en', 'ru', 'ar', 'cn'],
        default: 'en',
        description: `Language the user communicates in, when it is clear from the conversation context`,
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
 * When the client advertises MCP Apps support, route responses additionally carry
 * `structuredContent` with the widget payload — the host renders it via the
 * ui://mos-metro/routes.html resource; the markdown text stays as the model-facing fallback.
 */
export const handleMosMetroInfo = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const args = params.arguments;
  const first = String(args?.first_metro_station ?? '').trim();
  const second = String(args?.second_metro_station ?? '').trim();
  const action = args?.action;
  const lang = toLang(args?.language);

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
    const markdown = renderRoutes(result, fromName, toName, lang);
    // MCP Apps host: markdown stays as the model-facing text, the widget renders structuredContent
    if (hostSupportsMcpApps(params.clientCapabilities)) {
      return {
        content: [{ type: 'text', text: markdown }],
        structuredContent: buildRoutesWidgetData(result, fromName, toName, lang),
      };
    }
    return asTextContent(markdown);
  } catch (e) {
    const msg = hideSourceNames(e instanceof Error ? e.message : String(e));
    return asTextError(`Failed to build a route ${fromName} → ${toName}: ${msg}`);
  }
};
