// Tests for the metrobook backup source: a route built from the sparse data yields the same
// time as from the full data (57 minutes of rides and transfers plus train waits), optional
// fields are absent, and enrichment from the mosmetro schema adds multilingual names and
// hub "second" names.

import { describe, expect, test } from '@jest/globals';
import { enrichMetrobookFromMosmetroSchema, parseMetrobookHtml } from '../../src/lib/metro-data/fetch-metrobook.js';
import { findBestRoutes } from '../../src/lib/routing/find-routes.js';
import { getExpectedWaitSec } from '../../src/lib/routing/train-intervals.js';
import { fuzzySearchStations } from '../../src/lib/station-search/search-stations.js';
import { IMetroDataset } from '../../src/lib/metro-data/types.js';
import { AT_FIXTURE_DATE, getMetrobookDataset, loadMetrobookHtml, loadSchemaRaw, stationIdsByName } from './helpers.js';

/**
 * Station identifiers via fuzzy search: metrobook spelling may differ from the official
 * one («Теплый стан» instead of «Тёплый Стан»), so exact comparison is not suitable
 */
const idsByFuzzyName = (dataset: IMetroDataset, name: string): number[] =>
  fuzzySearchStations(dataset, name).map((m) => m.station.id);

describe('Резервный источник metrobook', () => {
  const ds = getMetrobookDataset();

  test('нормализация: ядро графа на месте, запрещённые пересадки отброшены', () => {
    expect(ds.source).toBe('metrobook');
    expect(ds.stations.length).toBeGreaterThan(400); // "station × line" vertices
    expect(ds.lines.length).toBe(21);
    expect(ds.notifications).toBeUndefined();
    // The dataset must contain no transfers with time 999999 ("transfer forbidden")
    expect(ds.edges.every((e) => e.timeSec < 999_999)).toBe(true);
  });

  test('маршрут Ховрино → Тёплый Стан по данным metrobook: те же 57 минут поездок плюс ожидание', () => {
    // The metrobook name is «Теплый стан»: an exact match is achieved via normalization
    const res = findBestRoutes(ds, stationIdsByName(ds, 'Ховрино'), idsByFuzzyName(ds, 'Тёплый Стан'), {
      k: 1,
      at: AT_FIXTURE_DATE,
    });
    // metrobook has no closures — graceful degradation without errors
    expect(res.closuresApplied).toBe(false);
    const v = res.variants[0]!;
    // The wait-free part matches the full mosmetro data; the wait itself derives from
    // EXPECTED_WAIT_FACTOR: two boardings (start + one transfer) on regular metro lines
    expect(Math.round((v.rideTimeSec + v.transferTimeSec) / 60)).toBe(57);
    expect(v.waitTimeSec).toBe(2 * getExpectedWaitSec('metro', AT_FIXTURE_DATE));
    expect(v.totalTimeSec).toBe(v.rideTimeSec + v.transferTimeSec + v.waitTimeSec);
    expect(v.transfersCount).toBe(1);
  });

  test('деградация: необязательные поля просто отсутствуют, код не падает', () => {
    const res = findBestRoutes(ds, stationIdsByName(ds, 'Ховрино'), idsByFuzzyName(ds, 'Тёплый Стан'), {
      k: 1,
      at: AT_FIXTURE_DATE,
    });
    const v = res.variants[0]!;
    expect(v.departure.groundTransport).toBeUndefined();
    expect(v.departure.enterTimeSec).toBeUndefined();
    expect(v.warnings).toEqual([]);
    const transfer = v.legs.find((l) => l.kind === 'transfer');
    expect(transfer && 'wagons' in transfer ? transfer.wagons : undefined).toBeUndefined();
  });

  test('разбор HTML главной страницы: граф извлекается и совпадает по размерам с фикстурой', () => {
    const graph = parseMetrobookHtml(loadMetrobookHtml(), '2026-07-22T00:00:00.000Z', 'https://metrobook.ru/');
    expect(Object.keys(graph.stationInstances).length).toBe(439);
    expect(graph.edges.length).toBe(421);
    expect(Object.keys(graph.stations).length).toBe(312);
  });

  test('изменение вёрстки даёт понятную ошибку', () => {
    expect(() => parseMetrobookHtml('<html><body>пусто</body></html>', '2026-07-22T00:00:00.000Z', 'x')).toThrow(
      /site markup has changed/,
    );
  });

  describe('обогащение из схемы mosmetro', () => {
    const enriched = enrichMetrobookFromMosmetroSchema(getMetrobookDataset(), loadSchemaRaw());

    test('многоязычные названия подтянуты по русскому имени', () => {
      const hovrino = enriched.stations.find((s) => s.name.ru === 'Ховрино');
      expect(hovrino?.name.en).toBe('Khovrino');
      expect(hovrino?.name.ar).toBeTruthy();
      expect(hovrino?.name.cn).toBeTruthy();
    });

    test('имена станций пересадочного узла становятся псевдонимами поиска', () => {
      const pushkinskaya = enriched.stations.filter((s) => s.name.ru === 'Пушкинская');
      expect(pushkinskaya.length).toBeGreaterThan(0);
      const aliases = pushkinskaya.flatMap((s) => s.searchAliases ?? []);
      expect(aliases).toContain('Тверская');
      expect(aliases).toContain('Чеховская');
    });

    test('отсутствующее у metrobook имя узла находится через псевдоним', () => {
      // «Площадь трёх вокзалов» exists in the «Комсомольская» hub in mosmetro,
      // but this label is absent from the metrobook markup — only enrichment provides it
      const before = fuzzySearchStations(getMetrobookDataset(), 'Площадь трёх вокзалов');
      expect(before.every((m) => m.score < 1)).toBe(true);

      const after = fuzzySearchStations(enriched, 'Площадь трёх вокзалов');
      expect(after.length).toBeGreaterThan(0);
      expect(after[0]!.score).toBe(1);
      expect(after[0]!.station.name.ru).toBe('Комсомольская');
    });
  });
});
