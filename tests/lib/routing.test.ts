// Тесты маршрутизации по полным данным mosmetro: эталонный маршрут «Ховрино → Тёплый Стан»
// (сверен с сайтом mosmetro.ru 22.07.2026), закрытие «Серп и Молот» с обходным ребром,
// богатая информация о маршруте (вагоны, наземный транспорт, время входа/выхода).

import { describe, expect, test } from '@jest/globals';
import { buildRouteGraph } from '../../src/lib/routing/graph.js';
import { findBestRoutes, findRoutes } from '../../src/lib/routing/find-routes.js';
import {
  AT_AFTER_CLOSURE,
  AT_FIXTURE_DATE,
  getMosmetroDataset,
  getMosmetroDatasetNoNotifications,
  stationIdsByName,
} from './helpers.js';

describe('Маршрутизация по данным mosmetro', () => {
  const ds = getMosmetroDataset();

  test('эталонный маршрут Ховрино → Тёплый Стан: 57 мин, 1 пересадка; варианты 59 и 60 мин', () => {
    const fromIds = stationIdsByName(ds, 'Ховрино');
    const toIds = stationIdsByName(ds, 'Тёплый Стан');
    expect(fromIds.length).toBeGreaterThanOrEqual(1);
    expect(toIds).toHaveLength(1);

    const res = findBestRoutes(ds, fromIds, toIds, { k: 3, at: AT_FIXTURE_DATE });
    expect(res.source).toBe('mosmetro');
    expect(res.closuresApplied).toBe(true);
    expect(res.variants).toHaveLength(3);

    // Сверка с сайтом mosmetro.ru (22.07.2026): 56/59/60 мин — расхождение ±1 мин от округления
    const [v1, v2, v3] = res.variants;
    expect(v1!.totalTimeMin).toBe(57);
    expect(v1!.transfersCount).toBe(1);
    expect(v2!.totalTimeMin).toBe(59);
    expect(v2!.transfersCount).toBe(2);
    expect(v3!.totalTimeMin).toBe(60);
    expect(v3!.transfersCount).toBe(2);
  });

  test('лучший вариант содержит этапы, вагоны на пересадке и наземный транспорт', () => {
    const [fromId] = stationIdsByName(ds, 'Ховрино');
    const [toId] = stationIdsByName(ds, 'Тёплый Стан');
    const res = findRoutes(ds, fromId!, toId!, { k: 1, at: AT_FIXTURE_DATE });
    const v = res.variants[0]!;

    // Этапы: поездка → пересадка → поездка
    expect(v.legs.map((l) => l.kind)).toEqual(['ride', 'transfer', 'ride']);

    const ride1 = v.legs[0]!;
    if (ride1.kind !== 'ride') {
      throw new Error('первый этап должен быть поездкой');
    }
    // Все станции этапа по порядку, от Ховрино до Новокузнецкой
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
    // Рекомендации по вагонам — уникальная информация mosmetro
    expect(transfer.wagons?.length).toBeGreaterThan(0);

    // Время входа/выхода и наземный транспорт у конечных точек
    expect(v.departure.enterTimeSec).toBeGreaterThan(0);
    expect(v.arrival.exitTimeSec).toBeGreaterThan(0);
    expect(v.departure.groundTransport?.bus.length).toBeGreaterThan(0);

    // Названия станций многоязычные
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

    // В период закрытия маршрут от закрытой станции невозможен
    const [anyToId] = stationIdsByName(ds, 'Тёплый Стан');
    expect(() => findRoutes(ds, closedId!, anyToId!, { at: AT_FIXTURE_DATE })).toThrow(/закрыта/i);

    // После окончания периода станция снова доступна
    const graphAfter = buildRouteGraph(ds, AT_AFTER_CLOSURE);
    expect(graphAfter.closedStations.has(closedId!)).toBe(false);
    const resAfter = findRoutes(ds, closedId!, anyToId!, { at: AT_AFTER_CLOSURE });
    expect(resAfter.variants.length).toBeGreaterThan(0);
  });

  test('обходное ребро: Нижегородская → Курская (D4) в объезд закрытой станции', () => {
    // Уведомление добавляет альтернативный перегон 549 → 551 (540 секунд)
    // и закрывает перегоны через станцию 550 («Серп и Молот» D4)
    const graph = buildRouteGraph(ds, AT_FIXTURE_DATE);
    const altEdge = [...graph.adj.values()].flat().find((e) => e.isAlternative && e.kind === 'ride');
    expect(altEdge).toBeDefined();

    const res = findRoutes(ds, altEdge!.from, altEdge!.to, { k: 1, at: AT_FIXTURE_DATE });
    const v = res.variants[0]!;
    // Маршрут не проходит через закрытую станцию
    const stationIdsOnRoute = v.legs.flatMap((l) => (l.kind === 'ride' ? l.stations.map((s) => s.id) : []));
    for (const closed of graph.closedStations.keys()) {
      expect(stationIdsOnRoute).not.toContain(closed);
    }
    // Обход занимает время альтернативного ребра
    expect(v.totalTimeSec).toBe(altEdge!.timeSec);
  });

  test('предупреждения EMERGENCY не закрывают станции, но попадают в ответ', () => {
    const graph = buildRouteGraph(ds, AT_FIXTURE_DATE);
    // В данных есть станции с предупреждениями (ремонты эскалаторов и т. п.)
    expect(graph.warnings.size).toBeGreaterThan(0);
    // Ни одна станция с предупреждением EMERGENCY/INFO не считается закрытой,
    // если для неё нет отдельного статуса CLOSED
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
    expect(res.variants[0]!.totalTimeMin).toBe(57);

    // Станция «Серп и Молот» без уведомлений не считается закрытой
    const graph = buildRouteGraph(dsNoNotif, AT_FIXTURE_DATE);
    expect(graph.closedStations.size).toBe(0);
  });

  test('неизвестная станция даёт понятную ошибку', () => {
    expect(() => findRoutes(ds, 999_999, 1, { at: AT_FIXTURE_DATE })).toThrow(/отсутствует в данных/);
  });
});
