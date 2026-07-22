// Metro data layer state for notifications: from the refresh result (origin) one of four
// levels is derived, and a Telegram message is sent only on a TRANSITION between levels
// (edge-triggered alerting, not level-triggered) — both on degradation and on recovery.
// The module is pure: no network, configuration or SDK access.

import { TRefreshOrigin } from './refresh.js';
import { IMetroDataset } from './types.js';

/**
 * Data layer state levels (from best to worst):
 *  ok     — fresh full data from mosmetro.ru;
 *  backup — mosmetro unavailable, running on fresh backup metrobook.ru;
 *  disk   — both sources unavailable, running on a disk copy;
 *  none   — no data at all (cache empty, routing returns an error).
 */
export type TMetroDataState = 'ok' | 'backup' | 'disk' | 'none';

export const stateFromOrigin = (origin: TRefreshOrigin): TMetroDataState => {
  switch (origin) {
    case 'mosmetro-fresh':
      return 'ok';
    case 'metrobook-fresh':
      return 'backup';
    case 'mosmetro-disk':
    case 'metrobook-disk':
      return 'disk';
    case 'none':
      return 'none';
  }
};

const formatDate = (iso: string | undefined): string => {
  if (!iso) {
    return 'an unknown date';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an unknown date' : `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/**
 * Notification text for a state transition. Returns null if the state
 * has not changed (nothing to notify about).
 */
export const buildStateChangeMessage = (
  serviceName: string,
  prev: TMetroDataState,
  next: TMetroDataState,
  dataset: IMetroDataset | null,
): string | null => {
  if (prev === next) {
    return null;
  }
  switch (next) {
    case 'ok':
      return `✅ ${serviceName}: the mosmetro.ru source is available again — metro data is complete, closures and repairs are taken into account.`;
    case 'backup':
      return `⚠️ ${serviceName}: the mosmetro.ru source is unavailable. Data was refreshed from the backup metrobook.ru: routes are built, but station closures, train cars and ground transport are unavailable.`;
    case 'disk':
      return `⚠️ ${serviceName}: both sources (mosmetro.ru and metrobook.ru) are unavailable. Using a disk copy (${dataset?.source ?? '?'}) from ${formatDate(dataset?.schemaFetchedAt)}; stale closure information has been removed.`;
    case 'none':
      return `🛑 ${serviceName}: failed to obtain metro data — both sources are unavailable and there is no disk copy. Route building will return an error until the sources recover.`;
  }
};
