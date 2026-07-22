import chalk from 'chalk';

import {
  asTextContent,
  asTextError,
  IToolHandlerParams,
  logger as lgr,
  ToolExecutionError,
  TToolHandlerResponse,
} from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from '../lib/metro-data/cache.js';
import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { findBestRoutes } from '../lib/routing/find-routes.js';
import { resolveStation } from '../lib/station-search/resolve-station.js';
import { buildStationInfo } from '../lib/station-info.js';
import { renderResolutionAsk, renderRoutes, renderStationInfo } from './metro/render.js';

const logger = lgr.getSubLogger({ name: chalk.bgGrey('tools') });

/** How many route variants to request (per the task statement: from 1 to 4) */
const ROUTE_COUNT = 4;

/** Single "metro data unavailable" error text in markdown (without real source names) */
const DATA_UNAVAILABLE_MD = `## Данные метро временно недоступны
Не удалось получить данные о Московском метро: источники данных сейчас недоступны, а локальной копии на диске нет. Попробуйте повторить запрос позже.`;

/**
 * Tool call handler of the metro MCP server.
 *
 * Debug output of tool requests/responses is wired centrally in the SDK
 * (see init-mcp-server.ts) and is enabled via the DEBUG=mcp:tool environment variable.
 */
export const handleToolCall = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const { name, arguments: args } = params;
  logger.info(`Tool called: ${name}`);

  try {
    if (name === 'mos_metro_info') {
      return await handleMosMetroInfo(args);
    }
    throw new ToolExecutionError(name, `Unknown tool: ${name}`);
  } catch (error: Error | any) {
    logger.error(`Tool execution failed for ${name}:`, error);
    error.printed = true;
    // Real data source names are confidential: scrub them from the error text
    // before the SDK returns it to the client in the MCP response (the original went to the log above)
    if (typeof error?.message === 'string') {
      error.message = hideSourceNames(error.message);
    }
    throw error;
  }
};

/**
 * Universal tool: station details or shortest routes between two stations.
 * All responses are returned as ready-made markdown text (lists and tables).
 */
const handleMosMetroInfo = async (args: any): Promise<TToolHandlerResponse> => {
  const first = String(args?.first_metro_station ?? '').trim();
  const second = String(args?.second_metro_station ?? '').trim();
  const action = args?.action;

  if (!first) {
    return asTextError('Не указана станция first_metro_station.');
  }
  if (action !== 'search_route' && action !== 'get_station_info') {
    return asTextError('Параметр action должен быть "search_route" или "get_station_info".');
  }

  const dataset = getMetroDatasetOrNull();
  if (!dataset) {
    return asTextError(DATA_UNAVAILABLE_MD);
  }

  // ── Station details ─────────────────────────────────────────────────────────
  if (action === 'get_station_info') {
    const resolution = resolveStation(dataset, first);
    if (resolution.kind !== 'resolved') {
      return asTextContent(renderResolutionAsk('станцию', first, resolution));
    }
    const info = buildStationInfo(dataset, resolution.option.ids);
    return asTextContent(renderStationInfo(info));
  }

  // ── Route search ────────────────────────────────────────────────────────────
  if (!second) {
    return asTextError('Для построения маршрута укажите станцию прибытия second_metro_station.');
  }

  const r1 = resolveStation(dataset, first);
  const r2 = resolveStation(dataset, second);
  const need1 = r1.kind !== 'resolved';
  const need2 = r2.kind !== 'resolved';

  // If at least one station needs clarification — ask to clarify all such stations at once
  if (need1 || need2) {
    const blocks: string[] = [];
    if (need1) {
      blocks.push(renderResolutionAsk('станцию отправления', first, r1));
    }
    if (need2) {
      blocks.push(renderResolutionAsk('станцию прибытия', second, r2));
    }
    return asTextContent(`# Нужно уточнить станции\n\n${blocks.join('\n\n')}`);
  }

  // Both stations resolved
  const fromOpt = (r1 as Extract<typeof r1, { kind: 'resolved' }>).option;
  const toOpt = (r2 as Extract<typeof r2, { kind: 'resolved' }>).option;

  if (fromOpt.clusterId === toOpt.clusterId) {
    return asTextContent(
      `# Маршрут не требуется
      
Станции отправления и прибытия совпадают: **${fromOpt.name}**. Это один и тот же пересадочный узел.`,
    );
  }

  try {
    const result = findBestRoutes(dataset, fromOpt.ids, toOpt.ids, { k: ROUTE_COUNT });
    return asTextContent(renderRoutes(result, fromOpt.name, toOpt.name));
  } catch (e) {
    const msg = hideSourceNames(e instanceof Error ? e.message : String(e));
    return asTextError(`Не удалось построить маршрут ${fromOpt.name} → ${toOpt.name}: ${msg}`);
  }
};
