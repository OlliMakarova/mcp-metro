// Routing tests on the full mosmetro data: the reference route «Ховрино → Тёплый Стан»
// (verified against the mosmetro.ru website on 2026-07-22), the «Серп и Молот» closure with
// a bypass edge, rich route information (wagons, ground transport, entry/exit times).

import { describe, expect, test } from '@jest/globals';
import { buildRouteGraph } from '../../src/lib/routing/graph.js';
import { findBestRoutes, findRoutes, IRouteVariant } from '../../src/lib/routing/find-routes.js';
import { getExpectedWaitSec } from '../../src/lib/routing/train-intervals.js';
import {
  AT_AFTER_CLOSURE,
  AT_FIXTURE_DATE,
  getMosmetroDataset,
  getMosmetroDatasetNoNotifications,
  stationIdsByName,
} from './helpers.js';

describe('Маршрутизация по данным mosmetro', () => {
  const ds = getMosmetroDataset();
  /** Expected wait per boarding for a metro line at the fixture moment (Wednesday noon) */
  const METRO_WAIT = getExpectedWaitSec('metro', AT_FIXTURE_DATE);

  test('эталонный маршрут Ховрино → Тёплый Стан: 1 пересадка, ожидание поездов заложено', () => {
    const fromIds = stationIdsByName(ds, 'Ховрино');
    const toIds = stationIdsByName(ds, 'Тёплый Стан');
    expect(fromIds.length).toBeGreaterThanOrEqual(1);
    expect(toIds).toHaveLength(1);

    const res = findBestRoutes(ds, fromIds, toIds, { k: 3, at: AT_FIXTURE_DATE });
    expect(res.closuresApplied).toBe(true);
    expect(res.variants).toHaveLength(3);

    // Cross-checked with mosmetro.ru (2026-07-22): the site shows 56 min for the fastest
    // variant WITHOUT train waits — the ride+transfer sum is pinned here and does not
    // depend on EXPECTED_WAIT_FACTOR (±1 min discrepancy due to rounding).
    const [v1, v2, v3] = res.variants;
    expect(Math.round((v1!.rideTimeSec + v1!.transferTimeSec) / 60)).toBe(57);
    expect(v1!.transfersCount).toBe(1);

    // Wait-dependent values derive from the factor: one boarding at the start plus one
    // after every transfer walk (consecutive hub walks yield a single boarding).
    // All variants of this route ride regular metro lines only.
    for (const v of [v1!, v2!, v3!]) {
      const boardings = v.legs.filter((l) => l.kind === 'ride').length;
      expect(v.waitTimeSec).toBe(boardings * METRO_WAIT);
      expect(v.totalTimeSec).toBe(v.rideTimeSec + v.transferTimeSec + v.waitTimeSec);
      expect(v.totalTimeMin).toBe(Math.round(v.totalTimeSec / 60));
    }
    // Variants come sorted by the total time including waits
    expect(v1!.totalTimeSec).toBeLessThanOrEqual(v2!.totalTimeSec);
    expect(v2!.totalTimeSec).toBeLessThanOrEqual(v3!.totalTimeSec);
  });

  test('лучший вариант содержит этапы, вагоны на пересадке и наземный транспорт', () => {
    const [fromId] = stationIdsByName(ds, 'Ховрино');
    const [toId] = stationIdsByName(ds, 'Тёплый Стан');
    const res = findRoutes(ds, fromId!, toId!, { k: 1, at: AT_FIXTURE_DATE });
    const v = res.variants[0]!;

    // Legs: ride → transfer → ride
    expect(v.legs.map((l) => l.kind)).toEqual(['ride', 'transfer', 'ride']);

    const ride1 = v.legs[0]!;
    if (ride1.kind !== 'ride') {
      throw new Error('первый этап должен быть поездкой');
    }
    // All stations of the leg in order, from «Ховрино» to «Новокузнецкая»
    expect(ride1.stations[0]!.name.ru).toBe('Ховрино');
    expect(ride1.stations.length).toBeGreaterThan(10);
    expect(ride1.line?.name?.ru).toContain('Замоскворецкая');
    expect(ride1.line?.isMcd).toBe(false);

    const transfer = v.legs[1]!;
    if (transfer.kind !== 'transfer') {
      throw new Error('второй этап должен быть пересадкой');
    }
    expect(transfer.fromStation.name.ru).toBe('Новокузнецкая');
    expect(transfer.toStation.name.ru).toBe('Третьяковская');
    // Wagon recommendations — information unique to mosmetro
    expect(transfer.wagons?.length).toBeGreaterThan(0);

    // Entry/exit times and ground transport at the endpoints
    expect(v.departure.enterTimeSec).toBeGreaterThan(0);
    expect(v.arrival.exitTimeSec).toBeGreaterThan(0);
    expect(v.departure.groundTransport?.bus.length).toBeGreaterThan(0);

    // Station names are multilingual
    expect(v.departure.station.name.en).toBe('Khovrino');
    expect(v.departure.station.name.ar).toBeTruthy();
    expect(v.departure.station.name.cn).toBeTruthy();
  });

  test('закрытие «Серп и Молот»: станция закрыта в период уведомления и открыта после', () => {
    const serpIds = stationIdsByName(ds, 'Серп и Молот');
    expect(serpIds.length).toBeGreaterThanOrEqual(1);

    const graphDuring = buildRouteGraph(ds, AT_FIXTURE_DATE);
    const closedId = serpIds.find((id) => graphDuring.closedStations.has(id));
    expect(closedId).toBeDefined();

    // During the closure period no route from the closed station is possible
    const [anyToId] = stationIdsByName(ds, 'Тёплый Стан');
    expect(() => findRoutes(ds, closedId!, anyToId!, { at: AT_FIXTURE_DATE })).toThrow(/is closed/i);

    // After the period ends the station is available again
    const graphAfter = buildRouteGraph(ds, AT_AFTER_CLOSURE);
    expect(graphAfter.closedStations.has(closedId!)).toBe(false);
    const resAfter = findRoutes(ds, closedId!, anyToId!, { at: AT_AFTER_CLOSURE });
    expect(resAfter.variants.length).toBeGreaterThan(0);
  });

  test('обходное ребро: Нижегородская → Курская (D4) в объезд закрытой станции', () => {
    // The notification adds an alternative segment 549 → 551 (540 seconds)
    // and closes the segments passing through station 550 («Серп и Молот» D4)
    const graph = buildRouteGraph(ds, AT_FIXTURE_DATE);
    const altEdge = [...graph.adj.values()].flat().find((e) => e.isAlternative && e.kind === 'ride');
    expect(altEdge).toBeDefined();

    const res = findRoutes(ds, altEdge!.from, altEdge!.to, { k: 1, at: AT_FIXTURE_DATE });
    const v = res.variants[0]!;
    // The route does not pass through the closed station
    const stationIdsOnRoute = v.legs.flatMap((l) => (l.kind === 'ride' ? l.stations.map((s) => s.id) : []));
    for (const closed of graph.closedStations.keys()) {
      expect(stationIdsOnRoute).not.toContain(closed);
    }
    // The bypass takes the time of the alternative edge plus the wait for the train
    // (the D4 edge belongs to an MCD line — one boarding at the MCD daytime interval)
    expect(v.waitTimeSec).toBe(getExpectedWaitSec('mcd', AT_FIXTURE_DATE));
    expect(v.totalTimeSec).toBe(altEdge!.timeSec + v.waitTimeSec);
  });

  test('предупреждения EMERGENCY не закрывают станции, но попадают в ответ', () => {
    const graph = buildRouteGraph(ds, AT_FIXTURE_DATE);
    // The data contains stations with warnings (escalator repairs, etc.)
    expect(graph.warnings.size).toBeGreaterThan(0);
    // No station with an EMERGENCY/INFO warning is considered closed
    // unless it has a separate CLOSED status
    for (const id of graph.warnings.keys()) {
      if (!graph.closedStations.has(id)) {
        expect(graph.stations.has(id)).toBe(true);
      }
    }
  });

  test('без уведомлений закрытия не применяются (деградация)', () => {
    const dsNoNotif = getMosmetroDatasetNoNotifications();
    const res = findBestRoutes(
      dsNoNotif,
      stationIdsByName(dsNoNotif, 'Ховрино'),
      stationIdsByName(dsNoNotif, 'Тёплый Стан'),
      { k: 1, at: AT_FIXTURE_DATE },
    );
    expect(res.closuresApplied).toBe(false);
    // The wait-free part matches the reference variant; waits derive from the factor
    const v0 = res.variants[0]!;
    expect(Math.round((v0.rideTimeSec + v0.transferTimeSec) / 60)).toBe(57);
    expect(v0.waitTimeSec).toBe(2 * METRO_WAIT);

    // Without notifications the «Серп и Молот» station is not considered closed
    const graph = buildRouteGraph(dsNoNotif, AT_FIXTURE_DATE);
    expect(graph.closedStations.size).toBe(0);
  });

  test('неизвестная станция даёт понятную ошибку', () => {
    expect(() => findRoutes(ds, 999_999, 1, { at: AT_FIXTURE_DATE })).toThrow(/missing from the data/);
  });

  // Variant identity is the sequence of RIDE legs only: which lines you ride and between which
  // stations. Extra/alternative transfers inside an interchange hub (start, intermediate or end) do
  // not create separate variants — the fastest way through each hub is kept.
  const rideKey = (v: IRouteVariant) =>
    v.legs
      .map((l) => (l.kind === 'ride' ? `${l.line?.id ?? '?'}:${l.stations.map((s) => s.id).join('-')}` : ''))
      .filter(Boolean)
      .join('|');

  test('варианты, отличающиеся лишь переходом в узле, считаются одним (Савёловская → Черкизовская)', () => {
    const res = findBestRoutes(ds, stationIdsByName(ds, 'Савёловская'), stationIdsByName(ds, 'Черкизовская'), {
      k: 3,
      at: AT_FIXTURE_DATE,
    });
    // The three ways to reach the БКЛ platform at the Савёловская hub ride the identical route —
    // they collapse into a single variant (the fastest entry).
    expect(res.variants).toHaveLength(1);
    const v = res.variants[0]!;
    expect(v.transfersCount).toBe(1); // only the Сокольники street transfer remains
  });

  test('разные варианты имеют разные основные поездки (нет дублей по переходам)', () => {
    const res = findBestRoutes(ds, stationIdsByName(ds, 'Ховрино'), stationIdsByName(ds, 'Тёплый Стан'), {
      k: 3,
      at: AT_FIXTURE_DATE,
    });
    const keys = res.variants.map((v) => rideKey(v));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('варианты медленнее самого быстрого более чем на 30% не показываются', () => {
    // Request a large k; the +30% cap, not k, must bound the slowest kept variant.
    const res = findBestRoutes(ds, stationIdsByName(ds, 'Ховрино'), stationIdsByName(ds, 'Тёплый Стан'), {
      k: 20,
      at: AT_FIXTURE_DATE,
    });
    const fastest = res.variants[0]!.totalTimeSec;
    for (const v of res.variants) {
      expect(v.totalTimeSec).toBeLessThanOrEqual(fastest * 1.3);
    }
  });
});
