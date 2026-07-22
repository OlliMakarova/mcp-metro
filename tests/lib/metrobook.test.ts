// Тесты резервного источника metrobook: маршрут по скудным данным даёт то же время,
// что и по полным (57 минут), необязательные поля отсутствуют, а обогащение из схемы
// mosmetro добавляет многоязычные названия и «вторые» имена пересадочных узлов.

import { describe, expect, test } from '@jest/globals';
import { enrichMetrobookFromMosmetroSchema, parseMetrobookHtml } from '../../src/lib/metro-data/fetch-metrobook.js';
import { findBestRoutes } from '../../src/lib/routing/find-routes.js';
import { fuzzySearchStations } from '../../src/lib/station-search/search-stations.js';
import { IMetroDataset } from '../../src/lib/metro-data/types.js';
import { AT_FIXTURE_DATE, getMetrobookDataset, loadMetrobookHtml, loadSchemaRaw, stationIdsByName } from './helpers.js';

/**
 * Идентификаторы станций через неточный поиск: в metrobook написание может отличаться
 * от официального («Теплый стан» вместо «Тёплый Стан»), точное сравнение не подходит
 */
const idsByFuzzyName = (dataset: IMetroDataset, name: string): number[] =>
  fuzzySearchStations(dataset, name).map((m) => m.station.id);

describe('Резервный источник metrobook', () => {
  const ds = getMetrobookDataset();

  test('нормализация: ядро графа на месте, запрещённые пересадки отброшены', () => {
    expect(ds.source).toBe('metrobook');
    expect(ds.stations.length).toBeGreaterThan(400); // вершины «станция × линия»
    expect(ds.lines.length).toBe(21);
    expect(ds.notifications).toBeUndefined();
    // Пересадок со временем 999999 («переход запрещён») в наборе быть не должно
    expect(ds.edges.every((e) => e.timeSec < 999_999)).toBe(true);
  });

  test('маршрут Ховрино → Тёплый Стан по данным metrobook: те же 57 минут', () => {
    // Название в metrobook — «Теплый стан»: точное совпадение достигается через нормализацию
    const res = findBestRoutes(ds, stationIdsByName(ds, 'Ховрино'), idsByFuzzyName(ds, 'Тёплый Стан'), {
      k: 1,
      at: AT_FIXTURE_DATE,
    });
    expect(res.source).toBe('metrobook');
    // Закрытий у metrobook нет — деградация без ошибок
    expect(res.closuresApplied).toBe(false);
    expect(res.variants[0]!.totalTimeMin).toBe(57);
    expect(res.variants[0]!.transfersCount).toBe(1);
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
      /вёрстка сайта изменилась/,
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
      // «Площадь трёх вокзалов» есть в узле «Комсомольская» у mosmetro,
      // но такой подписи нет в вёрстке metrobook — её даёт только обогащение
      const before = fuzzySearchStations(getMetrobookDataset(), 'Площадь трёх вокзалов');
      expect(before.every((m) => m.score < 1)).toBe(true);

      const after = fuzzySearchStations(enriched, 'Площадь трёх вокзалов');
      expect(after.length).toBeGreaterThan(0);
      expect(after[0]!.score).toBe(1);
      expect(after[0]!.station.name.ru).toBe('Комсомольская');
    });
  });
});
