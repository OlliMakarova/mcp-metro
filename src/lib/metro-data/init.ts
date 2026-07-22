// Инициализация слоя данных метро при старте сервера:
//   1) мгновенная загрузка последней копии с диска (без сети) — сервер стартует быстро;
//   2) фоновое обновление из сети сразу после старта;
//   3) плановое обновление раз в refreshIntervalHours (по умолчанию 24 часа);
//   4) оповещение в Telegram при смене состояния источников (ухудшение и восстановление).

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

// Текущее состояние источников. Исходно «ok»: первое же успешное обновление не создаёт
// шума, а первое деградировавшее — сразу даёт оповещение (в том числе после рестарта).
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

/** Однократное обновление данных из сети с записью результата в кеш и оповещением */
export const refreshMetroDataNow = async (): Promise<void> => {
  const result = await refreshMetroData(buildDeps());
  if (result.dataset) {
    setMetroDataset(result.dataset);
  }
  // При result.dataset === null кеш сознательно НЕ очищается: если в памяти остались
  // данные с прошлого успешного обновления, они лучше пустого кеша.

  await notifyStateChange(stateFromOrigin(result.origin), result.dataset !== null ? result.dataset : null);
};

/**
 * Оповещение в Telegram при переходе между состояниями источников.
 * Ошибки отправки только журналируются и никогда не ломают обновление данных.
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
  logger.info(`Состояние источников данных метро изменилось: ${prev} → ${next}`);

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
    logger.info('Оповещение о смене состояния источников отправлено в Telegram');
  }
};

/** Запуск слоя данных: загрузка с диска, фоновое обновление, планировщик раз в сутки */
export const initMetroData = async (): Promise<void> => {
  const cfg = getMetroConfig();
  const deps = buildDeps();

  // Быстрый старт: последняя копия с диска, если она есть
  const disk = await loadMetroDataFromDisk(deps);
  if (disk.dataset) {
    setMetroDataset(disk.dataset);
    logger.info(`Данные метро загружены с диска (${disk.origin}): станций ${disk.dataset.stations.length}`);
  } else {
    logger.info('Дисковой копии данных метро нет — ожидается первое обновление из сети');
  }

  // Первое обновление из сети — в фоне, не задерживая старт сервера
  void refreshMetroDataNow().catch((e) => {
    logger.error(`Фоновое обновление данных метро завершилось ошибкой: ${e instanceof Error ? e.message : e}`);
  });

  // Плановое обновление раз в cfg.refreshIntervalMs (по умолчанию 24 часа)
  stopMetroDataScheduler();
  refreshTimer = setInterval(() => {
    void refreshMetroDataNow().catch((e) => {
      logger.error(`Плановое обновление данных метро завершилось ошибкой: ${e instanceof Error ? e.message : e}`);
    });
  }, cfg.refreshIntervalMs);
  // unref: таймер не должен удерживать процесс от завершения
  refreshTimer.unref();
};

export const stopMetroDataScheduler = (): void => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
};
