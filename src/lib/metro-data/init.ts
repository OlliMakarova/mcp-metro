// Initialization of the metro data layer at server startup:
//   1) instant load of the latest copies from disk (no network) — the server starts fast;
//   2) background refresh from the network right after startup;
//   3) scheduled refresh every refreshIntervalHours (24 hours by default);
//   4) Telegram notification on source-state changes (both degradation and recovery).
// Both cities (Moscow and Saint Petersburg) are initialized and refreshed together; the
// source state is tracked and reported per city.

import { appConfig, logger as lgr } from 'fa-mcp-sdk';
import { CustomAppConfig } from '../../_types_/custom-config.js';
import { ITelegramConfig, isTelegramConfigured, sendTelegramMessage } from '../telegram-notify.js';
import { setMetroDataset } from './cache.js';
import { getMetroConfig } from './metro-config.js';
import { IRefreshDeps, loadMetroDataFromDisk, refreshMetroData } from './refresh.js';
import { ISpbRefreshDeps, loadSpbMetroDataFromDisk, refreshSpbMetroData } from './refresh-spb.js';
import { TMetroDataState, buildStateChangeMessage, stateFromOrigin } from './source-state.js';
import { MetroStorage } from './storage.js';
import { TMetroCity } from './types.js';

const logger = lgr.getSubLogger({ name: 'metro-data' });

let refreshTimer: NodeJS.Timeout | null = null;

// Current source state per city. Initially 'ok': the first successful refresh produces no
// noise, while the first degraded one immediately triggers a notification (incl. after restart).
const currentState: Record<TMetroCity, TMetroDataState> = { moscow: 'ok', spb: 'ok' };

const getTelegramConfig = (): ITelegramConfig => {
  const t = (appConfig as CustomAppConfig).telegram ?? {};
  return { enabled: !!t.enabled, botToken: t.botToken ?? '', chatId: t.chatId ?? '' };
};

const logBridge = {
  info: (msg: string) => logger.info(msg),
  warn: (msg: string) => logger.warn(msg),
  error: (msg: string) => logger.error(msg),
};

const buildDeps = (): IRefreshDeps => {
  const cfg = getMetroConfig();
  return {
    storage: new MetroStorage(cfg.dataDir),
    urls: cfg.urls,
    requestTimeoutMs: cfg.requestTimeoutMs,
    notificationsTtlMs: cfg.notificationsTtlMs,
    log: logBridge,
  };
};

const buildSpbDeps = (): ISpbRefreshDeps => {
  const cfg = getMetroConfig();
  return {
    storage: new MetroStorage(cfg.dataDir),
    urls: cfg.urls,
    requestTimeoutMs: cfg.requestTimeoutMs,
    log: logBridge,
  };
};

/** One-off refresh of both cities from the network, storing results in the cache and notifying */
export const refreshMetroDataNow = async (): Promise<void> => {
  const moscow = await refreshMetroData(buildDeps());
  if (moscow.dataset) {
    setMetroDataset('moscow', moscow.dataset);
  }
  // When dataset === null the cache is deliberately NOT cleared: data left in memory
  // from the last successful refresh is better than an empty cache.
  await notifyStateChange('moscow', stateFromOrigin(moscow.origin), moscow.dataset);

  const spb = await refreshSpbMetroData(buildSpbDeps());
  if (spb.dataset) {
    setMetroDataset('spb', spb.dataset);
  }
  await notifyStateChange('spb', stateFromOrigin(spb.origin), spb.dataset);
};

/**
 * Telegram notification on transitions between source states of a city.
 * Send failures are only logged and never break the data refresh.
 */
const notifyStateChange = async (
  city: TMetroCity,
  next: TMetroDataState,
  dataset: Parameters<typeof buildStateChangeMessage>[4],
): Promise<void> => {
  const prev = currentState[city];
  currentState[city] = next;
  if (prev === next) {
    return;
  }
  logger.info(`Metro data source state changed (${city}): ${prev} → ${next}`);

  const tg = getTelegramConfig();
  if (!isTelegramConfigured(tg)) {
    return;
  }
  const text = buildStateChangeMessage(appConfig.name ?? 'mcp-metro', city, prev, next, dataset);
  if (!text) {
    return;
  }
  const sent = await sendTelegramMessage(tg, text, { onError: (msg) => logger.warn(msg) });
  if (sent) {
    logger.info(`Source-state change notification sent to Telegram (${city})`);
  }
};

/** Data layer startup: load both cities from disk, background refresh, daily scheduler */
export const initMetroData = async (): Promise<void> => {
  const cfg = getMetroConfig();

  // Fast start: the latest disk copies, if present
  const moscowDisk = await loadMetroDataFromDisk(buildDeps());
  if (moscowDisk.dataset) {
    setMetroDataset('moscow', moscowDisk.dataset);
    logger.info(
      `Moscow metro data loaded from disk (${moscowDisk.origin}): ${moscowDisk.dataset.stations.length} stations`,
    );
  } else {
    logger.info('No disk copy of Moscow metro data — waiting for the first refresh from the network');
  }
  const spbDisk = await loadSpbMetroDataFromDisk(buildSpbDeps());
  if (spbDisk.dataset) {
    setMetroDataset('spb', spbDisk.dataset);
    logger.info(`SPb metro data loaded from disk (${spbDisk.origin}): ${spbDisk.dataset.stations.length} stations`);
  } else {
    logger.info('No disk copy of SPb metro data — waiting for the first refresh from the network');
  }

  // First refresh from the network — in the background, without delaying server startup
  void refreshMetroDataNow().catch((e) => {
    logger.error(`Background metro data refresh failed: ${e instanceof Error ? e.message : e}`);
  });

  // Scheduled refresh every cfg.refreshIntervalMs (24 hours by default)
  stopMetroDataScheduler();
  refreshTimer = setInterval(() => {
    void refreshMetroDataNow().catch((e) => {
      logger.error(`Scheduled metro data refresh failed: ${e instanceof Error ? e.message : e}`);
    });
  }, cfg.refreshIntervalMs);
  // unref: the timer must not keep the process from exiting
  refreshTimer.unref();
};

export const stopMetroDataScheduler = (): void => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};
