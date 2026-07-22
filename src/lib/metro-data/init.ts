// Initialization of the metro data layer at server startup:
//   1) instant load of the latest copy from disk (no network) — the server starts fast;
//   2) background refresh from the network right after startup;
//   3) scheduled refresh every refreshIntervalHours (24 hours by default);
//   4) Telegram notification on source-state changes (both degradation and recovery).

import { appConfig, logger as lgr } from 'fa-mcp-sdk';
import { CustomAppConfig } from '../../_types_/custom-config.js';
import { ITelegramConfig, isTelegramConfigured, sendTelegramMessage } from '../telegram-notify.js';
import { setMetroDataset } from './cache.js';
import { getMetroConfig } from './metro-config.js';
import { IRefreshDeps, loadMetroDataFromDisk, refreshMetroData } from './refresh.js';
import { TMetroDataState, buildStateChangeMessage, stateFromOrigin } from './source-state.js';
import { MetroStorage } from './storage.js';

const logger = lgr.getSubLogger({ name: 'metro-data' });

let refreshTimer: NodeJS.Timeout | null = null;

// Current source state. Initially 'ok': the first successful refresh produces no noise,
// while the first degraded one immediately triggers a notification (including after a restart).
let currentState: TMetroDataState = 'ok';

const getTelegramConfig = (): ITelegramConfig => {
  const t = (appConfig as CustomAppConfig).telegram ?? {};
  return { enabled: !!t.enabled, botToken: t.botToken ?? '', chatId: t.chatId ?? '' };
};

const buildDeps = (): IRefreshDeps => {
  const cfg = getMetroConfig();
  return {
    storage: new MetroStorage(cfg.dataDir),
    urls: cfg.urls,
    requestTimeoutMs: cfg.requestTimeoutMs,
    notificationsTtlMs: cfg.notificationsTtlMs,
    log: {
      info: (msg) => logger.info(msg),
      warn: (msg) => logger.warn(msg),
      error: (msg) => logger.error(msg),
    },
  };
};

/** One-off refresh from the network, storing the result in the cache and sending a notification */
export const refreshMetroDataNow = async (): Promise<void> => {
  const result = await refreshMetroData(buildDeps());
  if (result.dataset) {
    setMetroDataset(result.dataset);
  }
  // When result.dataset === null the cache is deliberately NOT cleared: data left in memory
  // from the last successful refresh is better than an empty cache.

  await notifyStateChange(stateFromOrigin(result.origin), result.dataset !== null ? result.dataset : null);
};

/**
 * Telegram notification on transitions between source states.
 * Send failures are only logged and never break the data refresh.
 */
const notifyStateChange = async (
  next: TMetroDataState,
  dataset: Parameters<typeof buildStateChangeMessage>[3],
): Promise<void> => {
  const prev = currentState;
  currentState = next;
  if (prev === next) {
    return;
  }
  logger.info(`Metro data source state changed: ${prev} → ${next}`);

  const tg = getTelegramConfig();
  if (!isTelegramConfigured(tg)) {
    return;
  }
  const text = buildStateChangeMessage(appConfig.name ?? 'mcp-metro', prev, next, dataset);
  if (!text) {
    return;
  }
  const sent = await sendTelegramMessage(tg, text, { onError: (msg) => logger.warn(msg) });
  if (sent) {
    logger.info('Source-state change notification sent to Telegram');
  }
};

/** Data layer startup: load from disk, background refresh, daily scheduler */
export const initMetroData = async (): Promise<void> => {
  const cfg = getMetroConfig();
  const deps = buildDeps();

  // Fast start: the latest disk copy, if present
  const disk = await loadMetroDataFromDisk(deps);
  if (disk.dataset) {
    setMetroDataset(disk.dataset);
    logger.info(`Metro data loaded from disk (${disk.origin}): ${disk.dataset.stations.length} stations`);
  } else {
    logger.info('No disk copy of metro data — waiting for the first refresh from the network');
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
