// Builds the route widget's data payload from a self-describing link's parameters, with a small
// compute cache in front of the (not cheap) k-shortest-paths search.
//
// This is a cache of COMPUTATIONS to protect the CPU, not a cache of issued links: links stay
// permanent and the widget's behavior does not change. Repeated opens of the same widget and the
// user tabbing between route variants hit the cache instead of re-running Yen's algorithm. The key
// includes the dataset version, so a metro-data refresh naturally invalidates stale entries.

import { IMetroDataset, IMetroStation } from '../../lib/metro-data/types.js';
import { pickName, TLang } from '../../lib/metro-data/localized-name.js';
import { findBestRoutes } from '../../lib/routing/find-routes.js';
import { ROUTE_COUNT } from '../metro-info.js';
import type { IWidgetDataParams } from './widget-data-sign.js';
import { buildRoutesWidgetData, IRoutesWidgetData } from './widget-data.js';

/** Thrown when none of the requested platform ids exist in the active dataset (maps to HTTP 404) */
export class WidgetStationsMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetStationsMissingError';
  }
}

// ─── Station lookup (memoized per dataset) ─────────────────────────────────────

const stationMapCache = new WeakMap<IMetroDataset, Map<number, IMetroStation>>();

const stationMap = (dataset: IMetroDataset): Map<number, IMetroStation> => {
  let map = stationMapCache.get(dataset);
  if (!map) {
    map = new Map(dataset.stations.map((s) => [s.id, s]));
    stationMapCache.set(dataset, map);
  }
  return map;
};

/** Cluster name in the requested language, taken from the first existing platform id */
const stationName = (dataset: IMetroDataset, ids: number[], lang: TLang): string => {
  const map = stationMap(dataset);
  for (const id of ids) {
    const s = map.get(id);
    if (s) {
      return pickName(s.name, lang);
    }
  }
  return '';
};

// ─── Compute cache (LRU + TTL) ─────────────────────────────────────────────────

const CACHE_MAX_ENTRIES = 200;
const CACHE_TTL_MS = 3 * 60 * 1000;

interface ICacheEntry {
  expiresAt: number;
  data: IRoutesWidgetData;
}

// Insertion-ordered Map used as an LRU: on read we re-insert to mark recency, on overflow we drop
// the oldest key (the first one the Map iterates).
const cache = new Map<string, ICacheEntry>();

/** Dataset version — schema + notifications fetch timestamps; a refresh changes it and drops stale entries */
const datasetVersion = (dataset: IMetroDataset): string =>
  `${dataset.schemaFetchedAt}|${dataset.notificationsFetchedAt ?? ''}`;

/** Cache key: route identity + walk-to/from-metro times + effective minute + dataset version */
const cacheKey = (dataset: IMetroDataset, params: IWidgetDataParams, effectiveAt: Date): string => {
  const minute = Math.floor(effectiveAt.getTime() / 60000);
  return `${params.fromIds.join(',')}|${params.toIds.join(',')}|${params.lang}|${params.walkToMin ?? ''}|${params.walkFromMin ?? ''}|${minute}|${datasetVersion(dataset)}`;
};

const cacheGet = (key: string, now: number): IRoutesWidgetData | undefined => {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  // Mark as most-recently-used
  cache.delete(key);
  cache.set(key, entry);
  return entry.data;
};

const cacheSet = (key: string, data: IRoutesWidgetData, now: number): void => {
  cache.set(key, { data, expiresAt: now + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
};

// ─── Public builder ────────────────────────────────────────────────────────────

/**
 * Builds (or returns a cached) route widget payload for the link parameters. `at` from the link
 * fixes the moment; its absence means "now" (the Refresh button path). Throws
 * WidgetStationsMissingError when neither endpoint exists in the active dataset, and rethrows any
 * routing error (closed stations, no path) for the caller to map to a client error.
 */
export const getRoutesWidgetData = (dataset: IMetroDataset, params: IWidgetDataParams): IRoutesWidgetData => {
  const effectiveAt = params.at ?? new Date();
  const now = Date.now();

  const key = cacheKey(dataset, params, effectiveAt);
  const cached = cacheGet(key, now);
  if (cached) {
    return cached;
  }

  const map = stationMap(dataset);
  const fromExist = params.fromIds.filter((id) => map.has(id));
  const toExist = params.toIds.filter((id) => map.has(id));
  if (!fromExist.length || !toExist.length) {
    throw new WidgetStationsMissingError('One or both stations are not present in the current metro data.');
  }

  const result = findBestRoutes(dataset, params.fromIds, params.toIds, { k: ROUTE_COUNT, at: effectiveAt });
  const fromName = stationName(dataset, params.fromIds, params.lang);
  const toName = stationName(dataset, params.toIds, params.lang);
  const data = buildRoutesWidgetData(result, fromName, toName, params.lang, params.walkToMin, params.walkFromMin);

  cacheSet(key, data, now);
  return data;
};
