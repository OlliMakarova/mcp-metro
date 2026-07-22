import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { asTextContent, asTextError, TToolHandlerResponse } from 'fa-mcp-sdk';

import { getMetroDatasetOrNull } from '../lib/metro-data/cache.js';
import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { findBestRoutes } from '../lib/routing/find-routes.js';
import { buildStationInfo } from '../lib/station-info.js';
import { resolveStation } from '../lib/station-search/resolve-station.js';
import { renderResolutionAsk, renderRoutes, renderStationInfo } from './metro/render.js';

/** How many route variants to request (per the task statement: from 1 to 4) */
const ROUTE_COUNT = 4;

/** Single "metro data unavailable" error text in markdown (without real source names) */
const DATA_UNAVAILABLE_MD = `## Данные метро временно недоступны
Не удалось получить данные о Московском метро: источники данных сейчас недоступны, а локальной копии на диске нет. Попробуйте повторить запрос позже.`;

/**
 * Tool definition.
 *
 * The schema conforms to JSON Schema draft 2020-12 and forbids unknown fields
 * (`additionalProperties: false`) — a requirement of the standard, §9.2.
 */
export const mosMetroInfoTool: Tool = {
  name: 'mos_metro_info',
  title: 'Московское метро: маршруты и сведения о станциях',
  description: `Поиск маршрутов между двумя станциями Московского метрополитена (включая МЦК и МЦД) и выдача сведений о станции.
В режиме search_route строит от 1 до 4 кратчайших маршрутов между двумя станциями с полным временем в пути, станциями, пересадками, рекомендациями по вагонам, наземным транспортом на конечных станциях и действующими ограничениями (ремонты, закрытия).
В режиме get_station_info возвращает сведения о станции: линии, выходы, наземный транспорт, услуги, расписание первых и последних поездов, пересадки и предупреждения.

Названия станций передавать так как их укажет пользователь.
`,
  inputSchema: {
    type: 'object',
    properties: {
      first_metro_station: {
        type: 'string',
        description: `Название станции отправления (для search_route) или станции, о которой нужны сведения (для get_station_info).`,
      },
      second_metro_station: {
        type: 'string',
        description: `Название станции прибытия. Обязательно только для action=search_route.`,
      },
      action: {
        type: 'string',
        enum: ['search_route', 'get_station_info'],
        description: `Тип действия: "search_route" — построить кратчайшие маршруты между двумя станциями;
"get_station_info" — вернуть сведения о станции first_metro_station.`,
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
 * All responses are returned as ready-made markdown text (lists and tables).
 */
export const handleMosMetroInfo = async (args: any): Promise<TToolHandlerResponse> => {
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
