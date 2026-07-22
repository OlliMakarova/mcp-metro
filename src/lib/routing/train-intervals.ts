// Empirical train-interval model for the Moscow metro, MCC and MCD.
//
// There is no official public "line × hour → interval" table, so the model encodes the
// commonly observed values: metro intervals by time of day (peak ~1.5–2.5 min, daytime
// ~2.5–4 min, late evening 4–8 min), the official MCC scheme (4 min in peak, 8 min
// otherwise, with different peak windows on weekdays and weekends) and the approximate
// MCD scheme (5–7 min in peak, 10–15 min otherwise, up to ~15 min late in the evening).
// MCD intervals additionally depend on the exact train and its terminus (express trains,
// short runs), so for MCD the values are the roughest of the three.
//
// The expected wait for a train is the interval multiplied by EXPECTED_WAIT_FACTOR — that
// value is added to the travel time once at the boarding station and once after every transfer.

import { TLineKind } from '../metro-data/types.js';
import { moscowClock } from './operating-hours.js';

/**
 * Share of the interval taken as the expected wait for a train. The theoretical average is
 * 0.5 (the passenger arrives mid-interval); 0.75 is a deliberately conservative estimate that
 * covers walking along the platform, letting an overcrowded train pass and interval jitter.
 */
export const EXPECTED_WAIT_FACTOR = 0.75;

/** Interval band: applies from `fromMin` (minutes of Moscow day) until the next band */
type TBand = [fromMin: number, intervalSec: number];

const MIN = (h: number, m = 0): number => h * 60 + m;

/** Metro: same profile every day of the week (the public data has no weekday/weekend split) */
const METRO_BANDS: TBand[] = [
  [MIN(0), 360], // 00:00–05:30 — closing-time / night value (metro is closed most of it)
  [MIN(5, 30), 450], // 05:30–06:30 — first trains, ~5–10 min
  [MIN(6, 30), 240], // 06:30–07:30 — ~3–5 min
  [MIN(7, 30), 120], // 07:30–10:00 — morning peak, ~1.5–2.5 min
  [MIN(10), 200], // 10:00–16:00 — daytime, ~2.5–4 min
  [MIN(16), 150], // 16:00–17:30 — ~2–3 min
  [MIN(17, 30), 120], // 17:30–20:00 — evening peak, ~1.5–2.5 min
  [MIN(20), 200], // 20:00–23:00 — ~2.5–4 min
  [MIN(23), 360], // 23:00–00:00 — ~4–8 min, longer close to closing
];

/** MCC weekdays: official 4-minute peaks 07:30–11:30 and 16:00–21:00, 8 minutes otherwise */
const MCC_WEEKDAY_BANDS: TBand[] = [
  [MIN(0), 480],
  [MIN(7, 30), 240],
  [MIN(11, 30), 480],
  [MIN(16), 240],
  [MIN(21), 480],
];

/** MCC weekends and holidays: the official 4-minute window is 12:30–18:00 */
const MCC_WEEKEND_BANDS: TBand[] = [
  [MIN(0), 480],
  [MIN(12, 30), 240],
  [MIN(18), 480],
];

/** MCD weekdays: ~6 min in peaks, ~12 min in the daytime, ~15 min late in the evening */
const MCD_WEEKDAY_BANDS: TBand[] = [
  [MIN(0), 900], // late night / early morning
  [MIN(5, 30), 720],
  [MIN(7), 360], // morning peak 07:00–10:00
  [MIN(10), 720],
  [MIN(17), 360], // evening peak 17:00–20:00
  [MIN(20), 720],
  [MIN(22), 900], // late evening
];

/** MCD weekends: no pronounced peaks, ~12 min all day, ~15 min late in the evening */
const MCD_WEEKEND_BANDS: TBand[] = [
  [MIN(0), 900],
  [MIN(5, 30), 720],
  [MIN(22), 900],
];

const bandsFor = (kind: TLineKind, isWeekend: boolean): TBand[] => {
  if (kind === 'mcc') {
    return isWeekend ? MCC_WEEKEND_BANDS : MCC_WEEKDAY_BANDS;
  }
  if (kind === 'mcd') {
    return isWeekend ? MCD_WEEKEND_BANDS : MCD_WEEKDAY_BANDS;
  }
  return METRO_BANDS;
};

/** Typical interval between trains (seconds) for a line kind at the Moscow moment `at` */
export const getTrainIntervalSec = (kind: TLineKind, at: Date): number => {
  const { minutesOfDay, weekday } = moscowClock(at);
  const bands = bandsFor(kind, weekday >= 5);
  let interval = bands[0]![1];
  for (const [fromMin, sec] of bands) {
    if (minutesOfDay >= fromMin) {
      interval = sec;
    }
  }
  return interval;
};

/**
 * Expected wait for a train (seconds) — the typical interval × EXPECTED_WAIT_FACTOR.
 * Applied at the boarding station and after every transfer. An unknown line kind is
 * treated as regular metro.
 */
export const getExpectedWaitSec = (kind: TLineKind | undefined, at: Date): number =>
  Math.round(getTrainIntervalSec(kind ?? 'metro', at) * EXPECTED_WAIT_FACTOR);
