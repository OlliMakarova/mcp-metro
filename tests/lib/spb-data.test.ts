// Saint Petersburg data layer tests: source parsing (metrobook mirror, hh.ru reference,
// official operating-hours page), dataset assembly with the line-6 supplement, enrichment,
// closure notifications, routing, fuzzy search and the city-aware widget-link signature.
// Fixtures are real data downloaded on 2026-07-26 (see tests/fixtures/).

import { describe, expect, test } from '@jest/globals';

import { buildSignedUrl, parseSignedQuery, WidgetLinkError } from '../../src/tools/widget/widget-data-sign.js';
import { findBestRoutes } from '../../src/lib/routing/find-routes.js';
import { resolveStation } from '../../src/lib/station-search/resolve-station.js';
import { validateMetrobookGraph } from '../../src/lib/metro-data/fetch-metrobook.js';
import { routeMapToMetrobookGraph } from '../../src/lib/metro-data/fetch-spb-route-map.js';
import { buildSpbDataset } from '../../src/lib/metro-data/normalize-spb.js';
import { SPB_GRAPH_LIMITS } from '../../src/lib/metro-data/refresh-spb.js';
import {
  getSpbDataset,
  getSpbDatasetBare,
  loadSpbGraphFile,
  loadSpbHhFile,
  loadSpbOfficialFile,
  loadSpbRouteMapFile,
  stationIdsByName,
} from './helpers.js';

/** Sunday noon SPb time — metro is open, no special closures beyond the dataset's own */
const AT_SPB = new Date('2026-07-26T12:00:00+03:00');

const SECRET = 'test-secret';

describe('Разбор источников СПб', () => {
  test('граф metrobook-зеркала: линии, вершины, перегоны, переходы', () => {
    const g = loadSpbGraphFile();
    expect(Object.keys(g.lines).length).toBe(5);
    expect(Object.keys(g.stationInstances).length).toBe(73);
    expect(g.edges.length).toBe(68);
    expect(g.transfers.length).toBeGreaterThanOrEqual(18);
    // Все вершины имеют имена (в отличие от Москвы, где хаб подписан одним именем)
    const unnamed = Object.values(g.stationInstances).filter((s) => !s.name);
    expect(unnamed).toHaveLength(0);
  });

  test('официальная страница: вестибюли всех 6 линий, время закрытия переходов', () => {
    const f = loadSpbOfficialFile();
    expect(f.rows.length).toBeGreaterThanOrEqual(80);
    expect(new Set(f.rows.map((r) => r.line))).toEqual(new Set([1, 2, 3, 4, 5, 6]));
    expect(f.transferCloseTime).toBe('00:15');
    // Закрытые на реконструкцию станции несут пометку вместо времени
    const frunzenskaya = f.rows.find((r) => r.station === 'Фрунзенская');
    expect(frunzenskaya?.note).toMatch(/закрыта/i);
  });
});

describe('Сборка датасета СПб', () => {
  const ds = getSpbDataset();

  test('город, источник и дополнение линии 6', () => {
    expect(ds.city).toBe('spb');
    expect(ds.source).toBe('spb-combined');
    // 73 вершины графа + 2 станции линии 6
    expect(ds.stations.length).toBe(75);
    expect(ds.lines.length).toBe(6);

    const yz = ds.stations.find((s) => s.name.ru === 'Юго-Западная');
    const pt = ds.stations.find((s) => s.name.ru === 'Путиловская');
    expect(yz?.lineId).toBe(6);
    expect(pt?.lineId).toBe(6);

    // Время перегона выведено из официальной разницы первых поездов (3–4 минуты)
    const ride = ds.edges.find((e) => e.edgeId === 'spb6-ride-1');
    expect(ride?.timeSec).toBeGreaterThanOrEqual(180);
    expect(ride?.timeSec).toBeLessThanOrEqual(240);

    // Переход Путиловская ↔ Кировский завод присутствует
    const transfer = ds.edges.find((e) => e.edgeId === 'spb6-transfer-1');
    expect(transfer?.kind).toBe('transfer');
    const kirovsky = ds.stations.find((s) => s.name.ru === 'Кировский завод');
    expect(transfer?.toId).toBe(kirovsky?.id);
  });

  test('обогащение из hh.ru: координаты, имена и цвета линий', () => {
    const located = ds.stations.filter((s) => s.location);
    expect(located.length).toBeGreaterThanOrEqual(70);

    const line1 = ds.lines.find((l) => l.id === 1);
    expect(line1?.name?.ru).toBe('Кировско-Выборгская');
    expect(line1?.color).toBe('#D6083B');
    expect(line1?.ordering).toBe(1);

    const line6 = ds.lines.find((l) => l.id === 6);
    expect(line6?.name?.ru).toBe('Красносельско-Калининская');
    expect(line6?.color).toBe('#8C5646');
  });

  test('обогащение с официального сайта: режим работы, первые/последние поезда, выходы', () => {
    const avtovo = ds.stations.find((s) => s.name.ru === 'Автово');
    expect(avtovo?.workTime).toHaveLength(7);
    expect(avtovo?.workTime?.[0]).toEqual({ open: '05:30', close: '00:42' });

    // Первые поезда различаются по чётным/нечётным дням → две записи с dayType
    const veteranov = ds.stations.find((s) => s.name.ru === 'Проспект Ветеранов');
    const trains = Object.values(veteranov?.scheduleTrains ?? {});
    expect(trains.length).toBeGreaterThanOrEqual(1);
    const entries = trains.flat();
    expect(entries.some((e) => e.dayType === 'ODD')).toBe(true);
    expect(entries.some((e) => e.dayType === 'EVEN')).toBe(true);
    expect(entries.every((e) => !e.first || /^\d{2}:\d{2}$/.test(e.first))).toBe(true);

    // Выходы из подписей вестибюлей
    expect(veteranov?.exits?.length).toBeGreaterThanOrEqual(2);
    expect(veteranov?.exits?.[0]?.title).toMatch(/выход/i);
  });

  test('закрытые на реконструкцию станции становятся уведомлениями CLOSED', () => {
    const closed = (ds.notifications ?? []).filter((n) => n.stations.some((s) => s.status === 'CLOSED'));
    const closedNames = closed.flatMap((n) =>
      n.stations.map((s) => ds.stations.find((st) => st.id === s.stationId)?.name.ru),
    );
    expect(closedNames).toContain('Фрунзенская');
    expect(closedNames).toContain('Парк Победы');
    // Перегоны при этом не разрываются — поезда проезжают станцию без остановки
    expect(closed.every((n) => n.closedEdgeIds.length === 0)).toBe(true);
  });

  test('без источников обогащения датасет остаётся рабочим графом', () => {
    const bare = getSpbDatasetBare();
    expect(bare.stations.length).toBe(75);
    expect(bare.lines.find((l) => l.id === 6)).toBeDefined();
    expect(bare.notifications).toBeUndefined();
    // Фолбэк времени перегона линии 6 без официальных данных
    expect(bare.edges.find((e) => e.edgeId === 'spb6-ride-1')?.timeSec).toBe(210);
  });
});

describe('Официальный калькулятор маршрутов (map1)', () => {
  test('разбор: линии, станции с названиями, перегоны, пересадки, тайминги', () => {
    const m = loadSpbRouteMapFile();
    expect(m.lines.length).toBe(6);
    const stations = m.lines.flatMap((l) => l.stations);
    expect(stations.length).toBe(75);
    expect(stations.every((s) => s.title)).toBe(true);
    expect(m.edges.length).toBe(69);
    expect(m.transfers.length).toBe(20);
    expect(m.timing.transferSec).toBe(235);
    expect(m.timing.entranceMinSec).toBe(170);
    expect(m.timing.entranceMaxSec).toBe(230);
    // Закрытые станции вычленяются из закомментированной разметки страницы
    expect(m.closedStations.map((s) => s.title).sort()).toEqual(['Парк Победы', 'Фрунзенская']);
    // Линия 6 присутствует в калькуляторе (в отличие от источника графа)
    const kra = m.lines.find((l) => l.code === 'kra');
    expect(kra?.lineId).toBe(6);
    expect(kra?.stations.map((s) => s.title)).toEqual(['Юго-Западная', 'Путиловская']);
  });

  test('пересадки получают реалистичное время калькулятора вместо 60 с графа', () => {
    const ds = getSpbDataset();
    const transfers = ds.edges.filter((e) => e.kind === 'transfer');
    expect(transfers.length).toBeGreaterThan(0);
    expect(transfers.every((e) => e.timeSec === 235)).toBe(true);
    // Без калькулятора остаются времена источника графа
    const bare = getSpbDatasetBare();
    const bareTransfers = bare.edges.filter((e) => e.kind === 'transfer' && e.edgeId !== 'spb6-transfer-1');
    expect(bareTransfers.some((e) => e.timeSec < 235)).toBe(true);
  });

  test('время входа и выхода в город проставляется всем станциям', () => {
    const ds = getSpbDataset();
    // Среднее диапазона 170–230 с калькулятора
    expect(ds.stations.every((s) => s.enterTimeSec === 200 && s.exitTimeSec === 200)).toBe(true);
    expect(getSpbDatasetBare().stations.every((s) => s.enterTimeSec === undefined)).toBe(true);
  });

  test('закрытия из калькулятора не дублируют уведомления официальной страницы', () => {
    const ds = getSpbDataset();
    const closedIds = (ds.notifications ?? []).flatMap((n) =>
      n.stations.filter((s) => s.status === 'CLOSED').map((s) => s.stationId),
    );
    // Оба источника знают об одних и тех же закрытиях — по одной записи на станцию
    expect(closedIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(closedIds).size).toBe(closedIds.length);
  });

  test('закрытия обнаруживаются и без официальной страницы (только калькулятор)', () => {
    const ds = buildSpbDataset(loadSpbGraphFile(), null, null, loadSpbRouteMapFile());
    const closed = (ds.notifications ?? []).filter((n) => n.stations.some((s) => s.status === 'CLOSED'));
    const names = closed.flatMap((n) =>
      n.stations.map((s) => ds.stations.find((st) => st.id === s.stationId)?.name.ru),
    );
    expect(names).toContain('Фрунзенская');
    expect(names).toContain('Парк Победы');
  });

  test('резервный граф из калькулятора собирается в рабочий датасет с маршрутами', () => {
    const graph = routeMapToMetrobookGraph(loadSpbRouteMapFile());
    expect(() => validateMetrobookGraph(graph, SPB_GRAPH_LIMITS)).not.toThrow();
    const ds = buildSpbDataset(graph, loadSpbHhFile(), loadSpbOfficialFile(), loadSpbRouteMapFile());
    expect(ds.stations.length).toBe(75);
    expect(ds.lines.length).toBe(6);
    // Линия 6 приходит из самого калькулятора — дополнение не требуется
    expect(ds.stations.find((s) => s.name.ru === 'Юго-Западная')?.lineId).toBe(6);
    // Маршрут с пересадкой строится и даёт правдоподобное время
    const result = findBestRoutes(ds, stationIdsByName(ds, 'Девяткино'), stationIdsByName(ds, 'Купчино'), {
      k: 1,
      at: AT_SPB,
    });
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
    expect(result.variants[0]!.totalTimeSec).toBeGreaterThan(35 * 60);
    expect(result.variants[0]!.totalTimeSec).toBeLessThan(80 * 60);
  });
});

describe('Маршруты и поиск по СПб', () => {
  const ds = getSpbDataset();

  test('маршрут с пересадкой: Девяткино → Купчино', () => {
    const from = stationIdsByName(ds, 'Девяткино');
    const to = stationIdsByName(ds, 'Купчино');
    const result = findBestRoutes(ds, from, to, { k: 3, at: AT_SPB });
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
    const fastest = result.variants[0]!;
    expect(fastest.transfersCount).toBeGreaterThanOrEqual(1);
    // 24 станции и пересадка: правдоподобное время 35–80 минут
    expect(fastest.totalTimeSec).toBeGreaterThan(35 * 60);
    expect(fastest.totalTimeSec).toBeLessThan(80 * 60);
  });

  test('маршрут на дополненную линию 6: Автово → Юго-Западная', () => {
    const from = stationIdsByName(ds, 'Автово');
    const to = stationIdsByName(ds, 'Юго-Западная');
    const result = findBestRoutes(ds, from, to, { k: 3, at: AT_SPB });
    expect(result.variants.length).toBeGreaterThanOrEqual(1);
    const { legs } = result.variants[0]!;
    // Маршрут проходит через переход на Путиловскую
    expect(legs.some((l) => l.kind === 'transfer')).toBe(true);
  });

  test('нечёткий поиск: точное имя, опечатка и транслитерация', () => {
    expect(resolveStation(ds, 'Адмиралтейская').kind).toBe('resolved');
    // Опечатка находится: либо разрешается сразу, либо предлагается среди вариантов уточнения
    const typo = resolveStation(ds, 'Василеостровкая');
    if (typo.kind === 'resolved') {
      expect(typo.option.name.ru).toBe('Василеостровская');
    } else {
      expect(typo.kind).toBe('ambiguous');
      const { options } = typo as Extract<typeof typo, { kind: 'ambiguous' }>;
      expect(options.some((o) => o.name.ru === 'Василеостровская')).toBe(true);
    }
    const translit = resolveStation(ds, 'Avtovo');
    expect(translit.kind).toBe('resolved');
  });
});

describe('Подпись виджетной ссылки с городом', () => {
  test('город входит в подпись: ссылка одного города не работает для другого', () => {
    const spbUrl = buildSignedUrl('http://x', SECRET, { fromIds: [1], toIds: [2], lang: 'ru', city: 'spb' });
    const spbQuery = Object.fromEntries(new URL(spbUrl).searchParams);
    expect(spbQuery.city).toBe('spb');
    expect(parseSignedQuery(SECRET, spbQuery).city).toBe('spb');

    // Замена города при той же подписи должна отклоняться
    const forged = { ...spbQuery };
    delete forged.city;
    expect(() => parseSignedQuery(SECRET, forged)).toThrow(WidgetLinkError);
  });

  test('московская ссылка не несёт city в запросе и разбирается обратно', () => {
    const mskUrl = buildSignedUrl('http://x', SECRET, { fromIds: [1], toIds: [2], lang: 'ru' });
    const mskQuery = Object.fromEntries(new URL(mskUrl).searchParams);
    expect(mskQuery.city).toBeUndefined();
    const parsed = parseSignedQuery(SECRET, mskQuery);
    expect(parsed.city).toBeUndefined();
  });
});
