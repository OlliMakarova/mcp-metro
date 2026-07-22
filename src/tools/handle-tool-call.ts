import chalk from 'chalk';

import {
  asTextContent,
  asTextError,
  IToolHandlerParams,
  logger as lgr,
  ToolExecutionError,
  TToolHandlerResponse,
} from 'fa-mcp-sdk';

import { buildStationInfo, findBestRoutes, getMetroDatasetOrNull, resolveStation } from '../lib/index.js';
import { renderResolutionAsk, renderRoutes, renderStationInfo } from './metro/render.js';

const logger = lgr.getSubLogger({ name: chalk.bgGrey('tools') });

/** Сколько вариантов маршрута запрашивать (постановка задачи: от 1 до 4) */
const ROUTE_COUNT = 4;

/** Единый текст ошибки «данные метро недоступны» в markdown */
const DATA_UNAVAILABLE_MD = `## Данные метро временно недоступны
Не удалось получить данные о Московском метро: основной источник (mosmetro.ru) и резервный (metrobook.ru) сейчас недоступны, а локальной копии на диске нет. Попробуйте повторить запрос позже.`;

/**
 * Обработчик вызовов инструментов MCP-сервера метро.
 *
 * Отладочный вывод запросов/ответов инструментов подключён централизованно в SDK
 * (см. init-mcp-server.ts) и включается переменной окружения DEBUG=mcp:tool.
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
    throw error;
  }
};

/**
 * Универсальный инструмент: сведения о станции или кратчайшие маршруты между двумя станциями.
 * Все ответы возвращаются готовым markdown-текстом (списки и таблицы).
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

  // ── Сведения о станции ──────────────────────────────────────────────────────
  if (action === 'get_station_info') {
    const resolution = resolveStation(dataset, first);
    if (resolution.kind !== 'resolved') {
      return asTextContent(renderResolutionAsk('станцию', first, resolution));
    }
    const info = buildStationInfo(dataset, resolution.option.ids);
    return asTextContent(renderStationInfo(info));
  }

  // ── Поиск маршрута ──────────────────────────────────────────────────────────
  if (!second) {
    return asTextError('Для построения маршрута укажите станцию прибытия second_metro_station.');
  }

  const r1 = resolveStation(dataset, first);
  const r2 = resolveStation(dataset, second);
  const need1 = r1.kind !== 'resolved';
  const need2 = r2.kind !== 'resolved';

  // Если хотя бы одна станция требует уточнения — просим уточнить сразу все такие станции
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

  // Обе станции определены
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
    const msg = e instanceof Error ? e.message : String(e);
    return asTextError(`Не удалось построить маршрут ${fromOpt.name} → ${toOpt.name}: ${msg}`);
  }
};
