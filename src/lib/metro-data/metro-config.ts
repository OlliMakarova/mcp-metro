// Metro data layer settings.
//
// The disk-cache folder and source URLs are hard-coded (constants below) — they are not
// configurable. From the `metro` section of config/*.yaml only the refresh interval, the
// notifications time-to-live and the HTTP request timeout are read.
// This is the only place where the metro data layer touches appConfig — the other modules
// receive already-resolved settings as parameters (which simplifies testing).

import * as path from 'node:path';
import { appConfig } from 'fa-mcp-sdk';
import { CustomAppConfig } from '../../_types_/custom-config.js';

/** Disk-cache folder for downloaded data (in the project root, not under version control) */
export const METRO_DATA_DIR = 'data-cache';

/** Data source URLs */
export const METRO_URLS = {
  mosmetroSchema: 'https://prodapp.mosmetro.ru/api/schema/v1.0',
  mosmetroNotifications: 'https://prodapp.mosmetro.ru/api/notifications/v2',
  metrobook: 'https://metrobook.ru/',
  spbMetrobook: 'https://spb.metrobook.ru/',
  spbHhMetro: 'https://api.hh.ru/metro/2',
  spbOfficialHours: 'https://metro.spb.ru/rejimrabotystancii.html',
  spbRouteMapPage: 'https://metro.spb.ru/map1/route.html',
  spbRouteMapData: 'https://metro.spb.ru/map1/files/spb00000.js',
} as const;

const DEFAULT_REFRESH_INTERVAL_HOURS = 24;
const DEFAULT_NOTIFICATIONS_TTL_HOURS = 24;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface IMetroConfigResolved {
  /** Absolute path to the disk-cache folder */
  dataDir: string;
  /** Scheduled data refresh interval, milliseconds */
  refreshIntervalMs: number;
  /** Time-to-live of the closure notifications file, milliseconds */
  notificationsTtlMs: number;
  /** Timeout of a single HTTP request to a source, milliseconds */
  requestTimeoutMs: number;
  urls: {
    mosmetroSchema: string;
    mosmetroNotifications: string;
    metrobook: string;
    spbMetrobook: string;
    spbHhMetro: string;
    spbOfficialHours: string;
    spbRouteMapPage: string;
    spbRouteMapData: string;
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
