// Orchestrator of Saint Petersburg metro data acquisition. Graph-core cascade:
//
//   1. Fresh SPb graph source (spb.metrobook.ru)      — measured ride times, the best core
//   2. Disk copy of that graph                        — when the source is unavailable
//   3. Official route calculator (metro.spb.ru/map1)  — fresh or disk; synthetic-but-verified
//      ride times derived from the map geometry (see fetch-spb-route-map.ts)
//   4. Nothing available → dataset = null
//
// The enrichment sources (hh.ru reference, official metro.spb.ru hours, the route calculator's
// timing/closure data) are best-effort on ALL paths: a fresh copy is preferred, the disk copy
// is the fallback, and their absence only reduces the amount of detail (no coordinates / no
// working hours / graph-source transfer times) without failing the refresh. None of the SPb
// files have a time-to-live: stations, ride times and working hours do not go stale the way
// Moscow closure notifications do; closure notes synthesized from the official page carry
// their own validity window instead.
//
// Like the Moscow orchestrator, all dependencies are passed in as parameters — the module
// touches neither appConfig nor fa-mcp-sdk and is easy to test with substituted sources.

import { fetchMetrobookGraph, IMetrobookGraphLimits, validateMetrobookGraph } from './fetch-metrobook.js';
import { fetchSpbHhMetro, ISpbHhMetroFile, validateSpbHhMetro } from './fetch-spb-hh.js';
import { fetchSpbOfficial, ISpbOfficialFile, validateSpbOfficial } from './fetch-spb-official.js';
import {
  fetchSpbRouteMap,
  ISpbRouteMapFile,
  routeMapToMetrobookGraph,
  validateSpbRouteMap,
} from './fetch-spb-route-map.js';
import { buildSpbDataset } from './normalize-spb.js';
import { IRefreshLog } from './refresh.js';
import { MetroStorage } from './storage.js';
import { IMetroDataset } from './types.js';

/** SPb network floor: 5 lines, ~73 vertices, ~68 ride segments */
export const SPB_GRAPH_LIMITS: IMetrobookGraphLimits = { minInstances: 60, minEdges: 55, minNamed: 55 };

/** Default logger — silence (in production init.ts passes the fa-mcp-sdk logger) */
const SILENT_LOG: IRefreshLog = { info: () => {}, warn: () => {}, error: () => {} };

/** Where the SPb data ultimately came from. spb-map-fresh — the primary graph source is
 * unavailable and the core was rebuilt from a freshly fetched official route calculator */
export type TSpbRefreshOrigin = 'spb-fresh' | 'spb-map-fresh' | 'spb-disk' | 'none';

export interface ISpbRefreshResult {
  dataset: IMetroDataset | null;
  origin: TSpbRefreshOrigin;
}

export interface ISpbRefreshDeps {
  storage: MetroStorage;
  urls: {
    spbMetrobook: string;
    spbHhMetro: string;
    spbOfficialHours: string;
    spbRouteMapPage: string;
    spbRouteMapData: string;
  };
  requestTimeoutMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: IRefreshLog;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Reads the hh.ru enrichment from disk; null when absent or implausible */
const readHhFromDisk = async (deps: ISpbRefreshDeps): Promise<ISpbHhMetroFile | null> => {
  const raw = await deps.storage.read('spbHhMetro');
  if (!raw) {
    return null;
  }
  try {
    return validateSpbHhMetro(raw);
  } catch (e) {
    (deps.log ?? SILENT_LOG).warn(`SPb hh reference on disk failed the structure check: ${errText(e)}`);
    return null;
  }
};

/** Reads the official-hours enrichment from disk; null when absent or implausible */
const readOfficialFromDisk = async (deps: ISpbRefreshDeps): Promise<ISpbOfficialFile | null> => {
  const raw = await deps.storage.read('spbOfficialHours');
  if (!raw) {
    return null;
  }
  try {
    const file = raw as ISpbOfficialFile;
    validateSpbOfficial(file);
    return file;
  } catch (e) {
    (deps.log ?? SILENT_LOG).warn(`SPb official hours on disk failed the structure check: ${errText(e)}`);
    return null;
  }
};

/** Reads the route-calculator enrichment from disk; null when absent or implausible */
const readRouteMapFromDisk = async (deps: ISpbRefreshDeps): Promise<ISpbRouteMapFile | null> => {
  const raw = await deps.storage.read('spbRouteMap');
  if (!raw) {
    return null;
  }
  try {
    const file = raw as ISpbRouteMapFile;
    validateSpbRouteMap(file);
    return file;
  } catch (e) {
    (deps.log ?? SILENT_LOG).warn(`SPb route calculator file on disk failed the structure check: ${errText(e)}`);
    return null;
  }
};

/** Reads the best available SPb dataset from disk (no network access) */
export const loadSpbMetroDataFromDisk = async (deps: ISpbRefreshDeps): Promise<ISpbRefreshResult> => {
  const log = deps.log ?? SILENT_LOG;
  const routeMap = await readRouteMapFromDisk(deps);
  let graph = await deps.storage.readMetrobookGraph('spbMetrobookGraph');
  if (graph) {
    try {
      validateMetrobookGraph(graph, SPB_GRAPH_LIMITS);
    } catch (e) {
      log.warn(`SPb graph file on disk failed the structure check: ${errText(e)}`);
      graph = null;
    }
  }
  if (!graph && routeMap) {
    // Fallback graph core: the official route calculator saved on disk
    graph = routeMapToMetrobookGraph(routeMap);
  }
  if (!graph) {
    return { dataset: null, origin: 'none' };
  }
  const hh = await readHhFromDisk(deps);
  const official = await readOfficialFromDisk(deps);
  return { dataset: buildSpbDataset(graph, hh, official, routeMap), origin: 'spb-disk' };
};

/**
 * Scheduled refresh: downloads the graph and both enrichments (each falling back to its disk
 * copy independently), saves fresh files to disk and returns the best available dataset.
 */
export const refreshSpbMetroData = async (deps: ISpbRefreshDeps): Promise<ISpbRefreshResult> => {
  const { storage, urls, requestTimeoutMs, fetchImpl, now } = deps;
  const log = deps.log ?? SILENT_LOG;
  const fetchOpts = (url: string) => ({
    url,
    timeoutMs: requestTimeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(now ? { now } : {}),
  });

  // ── Enrichment and fallback core: official route calculator (best-effort) ──
  let routeMap: ISpbRouteMapFile | null = null;
  let routeMapFresh = false;
  try {
    routeMap = await fetchSpbRouteMap({
      pageUrl: urls.spbRouteMapPage,
      dataUrl: urls.spbRouteMapData,
      timeoutMs: requestTimeoutMs,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(now ? { now } : {}),
    });
    await storage.write('spbRouteMap', routeMap, routeMap.fetchedAt);
    routeMapFresh = true;
  } catch (e) {
    log.warn(`SPb route calculator is unavailable, using the disk copy if any: ${errText(e)}`);
    routeMap = await readRouteMapFromDisk(deps);
  }

  // ── Graph core ────────────────────────────────────────────────────────────
  let graph = null;
  let graphFresh = false;
  let graphFromMap = false;
  try {
    graph = await fetchMetrobookGraph({ ...fetchOpts(urls.spbMetrobook), limits: SPB_GRAPH_LIMITS });
    await storage.write('spbMetrobookGraph', graph, graph.fetchedAt);
    graphFresh = true;
  } catch (e) {
    log.warn(`SPb graph source is unavailable: ${errText(e)}`);
    graph = await storage.readMetrobookGraph('spbMetrobookGraph');
    if (graph) {
      try {
        validateMetrobookGraph(graph, SPB_GRAPH_LIMITS);
      } catch (diskError) {
        log.warn(`SPb graph file on disk failed the structure check: ${errText(diskError)}`);
        graph = null;
      }
    }
    if (!graph && routeMap) {
      // Both the source and its disk copy failed — rebuild the core from the calculator
      log.warn('SPb graph rebuilt from the official route calculator (backup core)');
      graph = routeMapToMetrobookGraph(routeMap);
      graphFromMap = true;
    }
  }
  if (!graph) {
    log.error('Failed to obtain SPb metro data: the graph sources are unavailable and there is no disk copy');
    return { dataset: null, origin: 'none' };
  }

  // ── Enrichment: hh.ru reference (best-effort) ─────────────────────────────
  let hh: ISpbHhMetroFile | null = null;
  try {
    hh = await fetchSpbHhMetro(fetchOpts(urls.spbHhMetro));
    await storage.write('spbHhMetro', hh, hh.fetchedAt);
  } catch (e) {
    log.warn(`SPb hh reference is unavailable, using the disk copy if any: ${errText(e)}`);
    hh = await readHhFromDisk(deps);
  }

  // ── Enrichment: official operating hours (best-effort) ────────────────────
  let official: ISpbOfficialFile | null = null;
  try {
    official = await fetchSpbOfficial(fetchOpts(urls.spbOfficialHours));
    await storage.write('spbOfficialHours', official, official.fetchedAt);
  } catch (e) {
    log.warn(`SPb official hours are unavailable, using the disk copy if any: ${errText(e)}`);
    official = await readOfficialFromDisk(deps);
  }

  const dataset = buildSpbDataset(graph, hh, official, routeMap);
  const graphOrigin = graphFresh ? 'fresh' : graphFromMap ? 'route calculator' : 'from disk';
  log.info(
    `SPb metro data refreshed (graph ${graphOrigin}, hh ${hh ? 'yes' : 'no'}, official ${
      official ? 'yes' : 'no'
    }, map ${routeMap ? 'yes' : 'no'}): ${dataset.stations.length} stations, ${
      dataset.notifications?.length ?? 0
    } notifications`,
  );
  const origin: TSpbRefreshOrigin = graphFresh
    ? 'spb-fresh'
    : graphFromMap && routeMapFresh
      ? 'spb-map-fresh'
      : 'spb-disk';
  return { dataset, origin };
};
