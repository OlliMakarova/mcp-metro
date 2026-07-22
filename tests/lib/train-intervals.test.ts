// Tests of the empirical train-interval model: metro intervals by time of day,
// MCC weekday/weekend peak windows, MCD peaks and late evening, and the expected
// wait being interval × EXPECTED_WAIT_FACTOR. All instants are pinned to Moscow time (+03:00).

import { describe, expect, test } from '@jest/globals';
import {
  EXPECTED_WAIT_FACTOR,
  getExpectedWaitSec,
  getTrainIntervalSec,
} from '../../src/lib/routing/train-intervals.js';

/** Moscow wall-clock instant on a weekday (Wednesday 2026-07-22) or weekend (Saturday 2026-07-25) */
const wed = (hhmm: string): Date => new Date(`2026-07-22T${hhmm}:00+03:00`);
const sat = (hhmm: string): Date => new Date(`2026-07-25T${hhmm}:00+03:00`);

describe('Эмпирические интервалы движения поездов (train-intervals)', () => {
  test('метро: пик короче дневного интервала, поздний вечер — длиннее всего', () => {
    const peak = getTrainIntervalSec('metro', wed('08:30'));
    const daytime = getTrainIntervalSec('metro', wed('12:00'));
    const evening = getTrainIntervalSec('metro', wed('23:30'));
    expect(peak).toBe(120);
    expect(daytime).toBe(200);
    expect(evening).toBe(360);
    expect(peak).toBeLessThan(daytime);
    expect(daytime).toBeLessThan(evening);
  });

  test('метро: вечерний пик 17:30–20:00 совпадает по интервалу с утренним', () => {
    expect(getTrainIntervalSec('metro', wed('18:00'))).toBe(120);
    expect(getTrainIntervalSec('metro', wed('16:30'))).toBe(150);
  });

  test('МЦК: будни — 4 минуты в пики 07:30–11:30 и 16:00–21:00, 8 минут вне пика', () => {
    expect(getTrainIntervalSec('mcc', wed('08:00'))).toBe(240);
    expect(getTrainIntervalSec('mcc', wed('12:00'))).toBe(480);
    expect(getTrainIntervalSec('mcc', wed('17:00'))).toBe(240);
    expect(getTrainIntervalSec('mcc', wed('22:00'))).toBe(480);
  });

  test('МЦК: выходные — 4-минутное окно 12:30–18:00, утром пика нет', () => {
    expect(getTrainIntervalSec('mcc', sat('08:00'))).toBe(480);
    expect(getTrainIntervalSec('mcc', sat('14:00'))).toBe(240);
    expect(getTrainIntervalSec('mcc', sat('19:00'))).toBe(480);
  });

  test('МЦД: будни — ~6 минут в пик, ~12 минут днём, ~15 минут поздним вечером', () => {
    expect(getTrainIntervalSec('mcd', wed('08:00'))).toBe(360);
    expect(getTrainIntervalSec('mcd', wed('12:00'))).toBe(720);
    expect(getTrainIntervalSec('mcd', wed('18:00'))).toBe(360);
    expect(getTrainIntervalSec('mcd', wed('23:00'))).toBe(900);
  });

  test('МЦД: выходные — без выраженных пиков, днём ~12 минут', () => {
    expect(getTrainIntervalSec('mcd', sat('08:00'))).toBe(720);
    expect(getTrainIntervalSec('mcd', sat('18:00'))).toBe(720);
  });

  test('ожидание — интервал × EXPECTED_WAIT_FACTOR; неизвестный вид линии считается обычным метро', () => {
    // Expected wait derived from the constant — the test needs no rewrite when the factor changes
    const waitOf = (intervalSec: number): number => Math.round(intervalSec * EXPECTED_WAIT_FACTOR);
    expect(getExpectedWaitSec('metro', wed('12:00'))).toBe(waitOf(200));
    expect(getExpectedWaitSec('mcd', wed('12:00'))).toBe(waitOf(720));
    expect(getExpectedWaitSec(undefined, wed('12:00'))).toBe(waitOf(200));
    // The result is rounded to whole seconds (e.g. 450 × 0.75 = 337.5 → 338)
    expect(getExpectedWaitSec('metro', wed('06:00'))).toBe(waitOf(450));
    expect(Number.isInteger(getExpectedWaitSec('metro', wed('06:00')))).toBe(true);
  });
});
