// Публичный интерфейс библиотеки метро (src/lib):
//   - слой данных: ежесуточное обновление mosmetro.ru → metrobook.ru → диск, кеш в памяти;
//   - маршрутизация: варианты кратчайших маршрутов и время в пути;
//   - неточный поиск станций на четырёх языках.

// Слой данных
export * from './metro-data/types.js';
export { getMetroDataset, getMetroDatasetOrNull, hasMetroData, setMetroDataset } from './metro-data/cache.js';
export { initMetroData, refreshMetroDataNow, stopMetroDataScheduler } from './metro-data/init.js';
export { loadMetroDataFromDisk, refreshMetroData } from './metro-data/refresh.js';
export type { IRefreshDeps, IRefreshResult, TRefreshOrigin } from './metro-data/refresh.js';
export { MetroStorage } from './metro-data/storage.js';
export { getMetroConfig } from './metro-data/metro-config.js';
export {
  fetchMosmetroNotifications,
  fetchMosmetroSchema,
  normalizeMosmetro,
  validateMosmetroNotifications,
  validateMosmetroSchema,
} from './metro-data/fetch-mosmetro.js';
export type { IMosmetroRawNotifications, IMosmetroRawSchema } from './metro-data/fetch-mosmetro.js';
export {
  enrichMetrobookFromMosmetroSchema,
  fetchMetrobookGraph,
  normalizeMetrobook,
  parseMetrobookHtml,
} from './metro-data/fetch-metrobook.js';

// Состояние источников и оповещения в Telegram
export { buildStateChangeMessage, stateFromOrigin } from './metro-data/source-state.js';
export type { TMetroDataState } from './metro-data/source-state.js';
export { isTelegramConfigured, sendTelegramMessage } from './telegram-notify.js';
export type { ITelegramConfig, ITelegramSendOpts } from './telegram-notify.js';

// Маршрутизация
export { buildRouteGraph, getRouteGraph } from './routing/graph.js';
export type { IGraphEdge, IRouteGraph, IStationWarning } from './routing/graph.js';
export { findBestRoutes, findRoutes } from './routing/find-routes.js';
export type {
  IFindRoutesOpts,
  IFindRoutesResult,
  IGroundTransport,
  ILineInfo,
  IRouteEndpoint,
  IRouteLegRide,
  IRouteLegTransfer,
  IRouteStationInfo,
  IRouteVariant,
  IRouteWarning,
  TRouteLeg,
} from './routing/find-routes.js';

// Неточный поиск станций
export {
  fuzzySearchStations,
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SEARCH_THRESHOLD,
} from './station-search/search-stations.js';
export type { IFuzzySearchOpts, IStationMatch } from './station-search/search-stations.js';
export { buildSearchIndex, getSearchIndex } from './station-search/search-index.js';
export { detectLang, normalizeArabic, normalizeForSearch } from './station-search/normalize-lang.js';
export { phraseSimilarity } from './station-search/string-similarity.js';
export { enToRuVariants, transliterate, transliterateRU } from './station-search/transliterate.js';
