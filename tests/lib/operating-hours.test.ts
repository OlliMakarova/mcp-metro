// Tests of the departure-hub entry status by Moscow time: open in the daytime, closed at
// night with the next opening time, the typical 05:30–01:00 window for the sparse dataset.

import { describe, expect, test } from '@jest/globals';
import { getOperatingStatus } from '../../src/lib/routing/operating-hours.js';
import { findBestRoutes } from '../../src/lib/routing/find-routes.js';
import { getMetrobookDataset, getMosmetroDataset, stationIdsByName } from './helpers.js';

// Fixed instants pinned to Moscow time (UTC+3) — Wednesday 2026-07-22 / Thursday night
const AT_NOON = new Date('2026-07-22T12:00:00+03:00');
const AT_NIGHT = new Date('2026-07-23T03:00:00+03:00');

describe('Режим работы метро (operating-hours)', () => {
  const ds = getMosmetroDataset();
  const khovrinoIds = stationIdsByName(ds, 'Ховрино');

  test('днём метро открыто, до закрытия — положительное число минут', () => {
    const op = getOperatingStatus(ds, khovrinoIds, AT_NOON);
    expect(op.isOpen).toBe(true);
    expect(op.moscowTime).toBe('12:00');
    expect(op.minutesToClose).toBeGreaterThan(0);
    expect(op.approximate).toBe(false);
    expect(op.window).toMatch(/^\d{2}:\d{2}–\d{2}:\d{2}$/);
  });

  test('ночью метро закрыто, указано время следующего открытия', () => {
    const op = getOperatingStatus(ds, khovrinoIds, AT_NIGHT);
    expect(op.isOpen).toBe(false);
    expect(op.moscowTime).toBe('03:00');
    expect(op.opensAt).toMatch(/^\d{2}:\d{2}$/);
    expect(op.approximate).toBe(false);
  });

  test('резервные данные без часов работы: типовое окно 05:30–01:00, статус приблизительный', () => {
    const dsSparse = getMetrobookDataset();
    const ids = dsSparse.stations.slice(0, 1).map((s) => s.id);

    const day = getOperatingStatus(dsSparse, ids, AT_NOON);
    expect(day.isOpen).toBe(true);
    expect(day.approximate).toBe(true);
    expect(day.window).toBe('05:30–01:00');

    const night = getOperatingStatus(dsSparse, ids, AT_NIGHT);
    expect(night.isOpen).toBe(false);
    expect(night.opensAt).toBe('05:30');
  });

  test('сразу после полуночи вход ещё открыт по вчерашнему окну, пересекающему полночь', () => {
    const dsSparse = getMetrobookDataset();
    const ids = dsSparse.stations.slice(0, 1).map((s) => s.id);
    // 00:30 Moscow time: the 05:30–01:00 window of the previous day still governs
    const op = getOperatingStatus(dsSparse, ids, new Date('2026-07-23T00:30:00+03:00'));
    expect(op.isOpen).toBe(true);
    expect(op.minutesToClose).toBe(30);
  });

  test('результат поиска маршрутов содержит статус работы метро', () => {
    const res = findBestRoutes(ds, khovrinoIds, stationIdsByName(ds, 'Тёплый Стан'), { k: 1, at: AT_NOON });
    expect(res.operating.isOpen).toBe(true);
    expect(res.operating.moscowTime).toBe('12:00');
  });
});
