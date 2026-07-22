// Orchestrator of metro data acquisition. Source cascade:
//
//   1. Fresh mosmetro.ru (schema + notifications)     — full dataset
//   2. Fresh metrobook.ru                             — reduced dataset (graph core)
//   3. Disk: mosmetro files (notifications — only if younger than 24 hours)
//   4. Disk: metrobook file
//   5. Nothing available → dataset = null (cache empty, routing will return an error)
//
// Notifications time-to-live rule: if notifications could not be fetched during a refresh,
// their file is DELETED from disk — stale closure information is worse than none.
// The schema file, by contrast, is never deleted: stations and ride segments do not go stale.
//
// All dependencies (storage, URLs, fetch, clock, log) are passed as parameters —
// the module touches neither appConfig nor fa-mcp-sdk and is easy to test
// with substituted sources. The logger is provided by init.ts.

import {
  IMosmetroRawNotifications,
  IMosmetroRawSchema,
  fetchMosmetroNotifications,
  fetchMosmetroSchema,
  normalizeMosmetro,
  validateMosmetroNotifications,
  validateMosmetroSchema,
} from './fetch-mosmetro.js';
import {
  enrichMetrobookFromMosmetroSchema,
  fetchMetrobookGraph,
  normalizeMetrobook,
  validateMetrobookGraph,
} from './fetch-metrobook.js';
import { MetroStorage } from './storage.js';
import { IMetroDataset } from './types.js';

/** Logger (the subset this module uses) */
export interface IRefreshLog {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Default logger — silence (in production init.ts passes the fa-mcp-sdk logger) */
const SILENT_LOG: IRefreshLog = { info: () => {}, warn: () => {}, error: () => {} };

/** Where the data ultimately came from */
export type TRefreshOrigin = 'mosmetro-fresh' | 'metrobook-fresh' | 'mosmetro-disk' | 'metrobook-disk' | 'none';

export interface IRefreshResult {
  dataset: IMetroDataset | null;
  origin: TRefreshOrigin;
}

export interface IRefreshDeps {
  storage: MetroStorage;
  urls: {
    mosmetroSchema: string;
    mosmetroNotifications: string;
    metrobook: string;
  };
  requestTimeoutMs: number;
  notificationsTtlMs: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: IRefreshLog;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Reads the best available dataset from disk (no network access) */
export const loadMetroDataFromDisk = async (deps: IRefreshDeps): Promise<IRefreshResult> => {
  const { storage, notificationsTtlMs } = deps;
  const log = deps.log ?? SILENT_LOG;

  // Priority 1: mosmetro files
  const schemaRawUnchecked = await storage.read('mosmetroSchema');
  if (schemaRawUnchecked) {
    try {
      const schemaRaw = validateMosmetroSchema(schemaRawUnchecked);
      const schemaMeta = await storage.getFileMeta('mosmetroSchema');

      let notificationsRaw: IMosmetroRawNotifications | null = null;
      let notificationsFetchedAt: string | undefined;
      const notifUnchecked = await storage.readNotificationsFresh(notificationsTtlMs);
      if (notifUnchecked) {
        try {
          notificationsRaw = validateMosmetroNotifications(notifUnchecked);
          notificationsFetchedAt = (await storage.getFileMeta('mosmetroNotifications'))?.fetchedAt;
        } catch (e) {
          log.warn(`Notifications file on disk is corrupted, ignoring it: ${errText(e)}`);
        }
      }

      const dataset = normalizeMosmetro(schemaRaw, notificationsRaw, {
        schemaFetchedAt: schemaMeta?.fetchedAt ?? new Date(0).toISOString(),
        ...(notificationsFetchedAt ? { notificationsFetchedAt } : {}),
      });
      return { dataset, origin: 'mosmetro-disk' };
    } catch (e) {
      log.warn(`Mosmetro schema file on disk failed the structure check: ${errText(e)}`);
    }
  }

  // Priority 2: metrobook file
  const metrobookGraph = await storage.readMetrobookGraph();
  if (metrobookGraph) {
    try {
      validateMetrobookGraph(metrobookGraph);
      return { dataset: normalizeMetrobook(metrobookGraph), origin: 'metrobook-disk' };
    } catch (e) {
      log.warn(`Metrobook graph file on disk failed the structure check: ${errText(e)}`);
    }
  }

  return { dataset: null, origin: 'none' };
};

/**
 * Scheduled refresh: downloads data through the source cascade, saves it to disk
 * and returns the best available dataset.
 */
export const refreshMetroData = async (deps: IRefreshDeps): Promise<IRefreshResult> => {
  const { storage, urls, requestTimeoutMs, fetchImpl, now } = deps;
  const log = deps.log ?? SILENT_LOG;
  const nowIso = (): string => (now?.() ?? new Date()).toISOString();
  const fetchOpts = (url: string) => ({
    url,
    timeoutMs: requestTimeoutMs,
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  // ── Step 1: primary source mosmetro.ru ────────────────────────────────────
  let schemaRaw: IMosmetroRawSchema | null = null;
  try {
    schemaRaw = await fetchMosmetroSchema(fetchOpts(urls.mosmetroSchema));
  } catch (e) {
    log.warn(`Mosmetro schema is unavailable: ${errText(e)}`);
  }

  // Try to fetch notifications regardless of the schema outcome: even when the schema is
  // unavailable, fresh notifications are useful for a dataset built from the disk schema copy.
  let notificationsRaw: IMosmetroRawNotifications | null = null;
  let notificationsFetchedAt: string | undefined;
  try {
    notificationsRaw = await fetchMosmetroNotifications(fetchOpts(urls.mosmetroNotifications));
    notificationsFetchedAt = nowIso();
    await storage.write('mosmetroNotifications', notificationsRaw, notificationsFetchedAt);
  } catch (e) {
    // Time-to-live rule: refreshing notifications failed — the stale file gets deleted
    log.warn(`Mosmetro notifications are unavailable, deleting the stale notifications file: ${errText(e)}`);
    await storage.delete('mosmetroNotifications');
  }

  if (schemaRaw) {
    const schemaFetchedAt = nowIso();
    await storage.write('mosmetroSchema', schemaRaw, schemaFetchedAt);
    const dataset = normalizeMosmetro(schemaRaw, notificationsRaw, {
      schemaFetchedAt,
      ...(notificationsRaw && notificationsFetchedAt ? { notificationsFetchedAt } : {}),
    });
    log.info(
      `Metro data refreshed from mosmetro.ru: ${dataset.stations.length} stations, ${
        dataset.notifications?.length ?? 0
      } notifications`,
    );
    return { dataset, origin: 'mosmetro-fresh' };
  }

  // ── Step 2: backup source metrobook.ru ────────────────────────────────────
  try {
    const graph = await fetchMetrobookGraph({
      url: urls.metrobook,
      timeoutMs: requestTimeoutMs,
      ...(fetchImpl ? { fetchImpl } : {}),
      ...(now ? { now } : {}),
    });
    await storage.write('metrobookGraph', graph, graph.fetchedAt);
    let dataset = normalizeMetrobook(graph);

    // Enrichment from the last saved mosmetro schema (even a stale one):
    // multilingual names and "secondary" transfer-hub names for search
    const diskSchemaUnchecked = await storage.read('mosmetroSchema');
    if (diskSchemaUnchecked) {
      try {
        dataset = enrichMetrobookFromMosmetroSchema(dataset, validateMosmetroSchema(diskSchemaUnchecked));
      } catch (e) {
        log.warn(`Enriching metrobook from the disk mosmetro schema failed: ${errText(e)}`);
      }
    }
    log.info(`Metro data refreshed from the backup source metrobook.ru: ${dataset.stations.length} stations`);
    return { dataset, origin: 'metrobook-fresh' };
  } catch (e) {
    log.warn(`Backup source metrobook is unavailable: ${errText(e)}`);
  }

  // ── Steps 3–4: disk copies ────────────────────────────────────────────────
  const disk = await loadMetroDataFromDisk(deps);
  if (disk.dataset) {
    log.info(`Both sources are unavailable — using the disk copy (${disk.origin})`);
    return disk;
  }

  log.error('Failed to obtain metro data: both sources are unavailable and there are no disk copies');
  return { dataset: null, origin: 'none' };
};
