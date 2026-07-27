// Metro data layer state for notifications: from the refresh result (origin) one of four
// levels is derived, and a Telegram message is sent only on a TRANSITION between levels
// (edge-triggered alerting, not level-triggered) — both on degradation and on recovery.
// The state is tracked independently per city. The module is pure: no network,
// configuration or SDK access.

import { TRefreshOrigin } from './refresh.js';
import { TSpbRefreshOrigin } from './refresh-spb.js';
import { IMetroDataset, TMetroCity } from './types.js';

/**
 * Data layer state levels (from best to worst):
 *  ok     — fresh full data from the primary source;
 *  backup — the primary source is unavailable, running on a fresh backup source (Moscow only);
 *  disk   — sources unavailable, running on a disk copy;
 *  none   — no data at all (cache empty, routing returns an error).
 */
export type TMetroDataState = 'ok' | 'backup' | 'disk' | 'none';

export const stateFromOrigin = (origin: TRefreshOrigin | TSpbRefreshOrigin): TMetroDataState => {
  switch (origin) {
    case 'mosmetro-fresh':
    case 'spb-fresh':
      return 'ok';
    case 'metrobook-fresh':
    case 'spb-map-fresh':
      return 'backup';
    case 'mosmetro-disk':
    case 'metrobook-disk':
    case 'spb-disk':
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

/** Per-city wording of the state-transition messages (source names are fine here — Telegram is internal) */
const MESSAGES: Record<TMetroCity, Record<Exclude<TMetroDataState, 'backup'>, string> & { backup?: string }> = {
  moscow: {
    ok: 'the mosmetro.ru source is available again — Moscow metro data is complete, closures and repairs are taken into account.',
    backup:
      'the mosmetro.ru source is unavailable. Data was refreshed from the backup metrobook.ru: routes are built, but station closures, train cars and ground transport are unavailable.',
    disk: 'both Moscow sources (mosmetro.ru and metrobook.ru) are unavailable. Using a disk copy; stale closure information has been removed.',
    none: 'failed to obtain Moscow metro data — both sources are unavailable and there is no disk copy. Route building will return an error until the sources recover.',
  },
  spb: {
    ok: 'the spb.metrobook.ru graph source is available again — Saint Petersburg metro data is up to date.',
    backup:
      'the spb.metrobook.ru graph source is unavailable. The graph was rebuilt from the official metro.spb.ru route calculator: routes are built, ride times are approximate (derived from the map geometry).',
    disk: 'the spb.metrobook.ru graph source is unavailable. Using a disk copy of the Saint Petersburg graph.',
    none: 'failed to obtain Saint Petersburg metro data — the graph sources are unavailable and there is no disk copy. SPb route building will return an error until a source recovers.',
  },
};

const STATE_EMOJI: Record<TMetroDataState, string> = { ok: '✅', backup: '⚠️', disk: '⚠️', none: '🛑' };

/**
 * Notification text for a state transition. Returns null if the state has not changed
 * (nothing to notify about) or the state has no wording for the city (cannot happen for
 * the origins each city's refresh actually produces).
 */
export const buildStateChangeMessage = (
  serviceName: string,
  city: TMetroCity,
  prev: TMetroDataState,
  next: TMetroDataState,
  dataset: IMetroDataset | null,
): string | null => {
  if (prev === next) {
    return null;
  }
  const text = MESSAGES[city][next];
  if (!text) {
    return null;
  }
  const suffix = next === 'disk' && dataset ? ` Disk copy from ${formatDate(dataset.schemaFetchedAt)}.` : '';
  return `${STATE_EMOJI[next]} ${serviceName}: ${text}${suffix}`;
};
