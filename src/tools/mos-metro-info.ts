import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { asTextContent, asTextError, TToolHandlerResponse } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from '../lib/metro-data/cache.js';
import { pickName, toLang } from '../lib/metro-data/localized-name.js';
import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { findBestRoutes } from '../lib/routing/find-routes.js';
import { buildStationInfo } from '../lib/station-info.js';
import { resolveStation } from '../lib/station-search/resolve-station.js';
import { renderResolutionAsk, renderRoutes, renderStationInfo } from './metro/render.js';

/** How many route variants to request (per the task statement: from 1 to 4) */
const ROUTE_COUNT = 4;

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
In search_route mode it builds 1 to 4 shortest routes between two stations with the total travel time, stations, transfers, car recommendations, surface transport at the endpoint stations, and active restrictions (repairs, closures).
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
};

/**
 * Universal tool: station details or shortest routes between two stations.
 * All responses are returned as ready-made English markdown text (lists and tables);
 * station and line names are localized to the requested `language`.
 */
export const handleMosMetroInfo = async (args: any): Promise<TToolHandlerResponse> => {
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
      blocks.push(renderResolutionAsk('the departure station', first, r1, lang));
    }
    if (need2) {
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
    return asTextContent(renderRoutes(result, fromName, toName, lang));
  } catch (e) {
    const msg = hideSourceNames(e instanceof Error ? e.message : String(e));
    return asTextError(`Failed to build a route ${fromName} → ${toName}: ${msg}`);
  }
};
