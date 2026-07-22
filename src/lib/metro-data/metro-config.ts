// Настройки слоя данных метро.
//
// Папка дискового кеша и адреса источников зашиты в код (константы ниже) — они не
// настраиваются через конфигурацию. Из секции `metro` в config/*.yaml читаются только
// период обновления, срок жизни уведомлений и тайм-аут HTTP-запроса.
// Это единственное место, где слой данных метро обращается к appConfig, — остальные
// модули принимают уже разрешённые настройки параметрами (это упрощает тестирование).

import * as path from 'node:path';
import { appConfig } from 'fa-mcp-sdk';
import { CustomAppConfig } from '../../_types_/custom-config.js';

/** Папка дискового кеша скачанных данных (в корне проекта, вне контроля версий) */
export const METRO_DATA_DIR = 'data-cache';

/** Адреса источников данных */
export const METRO_URLS = {
  mosmetroSchema: 'https://prodapp.mosmetro.ru/api/schema/v1.0',
  mosmetroNotifications: 'https://prodapp.mosmetro.ru/api/notifications/v2',
  metrobook: 'https://metrobook.ru/',
} as const;

const DEFAULT_REFRESH_INTERVAL_HOURS = 24;
const DEFAULT_NOTIFICATIONS_TTL_HOURS = 24;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface IMetroConfigResolved {
  /** Абсолютный путь к папке дискового кеша */
  dataDir: string;
  /** Период планового обновления данных, миллисекунды */
  refreshIntervalMs: number;
  /** Срок жизни файла уведомлений о закрытиях, миллисекунды */
  notificationsTtlMs: number;
  /** Тайм-аут одного HTTP-запроса к источнику, миллисекунды */
  requestTimeoutMs: number;
  urls: {
    mosmetroSchema: string;
    mosmetroNotifications: string;
    metrobook: string;
  };
}

export const getMetroConfig = (): IMetroConfigResolved => {
  const metro = (appConfig as CustomAppConfig).metro ?? {};
  return {
    dataDir: path.resolve(process.cwd(), METRO_DATA_DIR),
    refreshIntervalMs: (metro.refreshIntervalHours ?? DEFAULT_REFRESH_INTERVAL_HOURS) * 3_600_000,
    notificationsTtlMs: (metro.notificationsTtlHours ?? DEFAULT_NOTIFICATIONS_TTL_HOURS) * 3_600_000,
    requestTimeoutMs: metro.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    urls: METRO_URLS,
  };
};
