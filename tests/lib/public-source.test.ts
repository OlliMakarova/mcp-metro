// Секретность источников данных: реальные имена источников допустимы в логах и комментариях,
// но никогда не должны попадать в выдачу — ответы MCP-инструментов, ресурсы и REST API.
// Тесты закрепляют это требование: проверяют очистку текстов ошибок и отсутствие имён
// в готовых markdown-ответах инструмента.

import { describe, expect, it } from '@jest/globals';

import { hideSourceNames, toPublicSource } from '../../src/lib/metro-data/public-source.js';
import { buildStationInfo } from '../../src/lib/station-info.js';
import { findBestRoutes } from '../../src/lib/routing/find-routes.js';
import { renderRoutes, renderStationInfo } from '../../src/tools/metro/render.js';
import { getMetrobookDataset, getMosmetroDataset, stationIdsByName } from './helpers.js';

const LEAK_RE = /mosmetro|metrobook|prodapp/i;

describe('Публичное обозначение источника', () => {
  it('toPublicSource скрывает реальные имена', () => {
    expect(toPublicSource('mosmetro')).toBe('primary');
    expect(toPublicSource('metrobook')).toBe('backup');
  });

  it('hideSourceNames вычищает имена источников из произвольного текста', () => {
    expect(hideSourceNames('Ошибка при запросе https://prodapp.mosmetro.ru/api/schema/v1.0')).not.toMatch(LEAK_RE);
    expect(hideSourceNames('Файл metrobook-graph.json повреждён')).not.toMatch(LEAK_RE);
    expect(hideSourceNames('Схема Mosmetro недоступна, откат на METROBOOK')).not.toMatch(LEAK_RE);
    expect(hideSourceNames('Данные (mosmetro.ru, metrobook.ru) не отвечают')).not.toMatch(LEAK_RE);
    // Обычный текст остаётся нетронутым
    expect(hideSourceNames('Маршрут не найден')).toBe('Маршрут не найден');
  });
});

describe('Ответы инструмента не содержат имён источников', () => {
  it('карточка станции и маршруты по полным данным', () => {
    const ds = getMosmetroDataset();
    const info = buildStationInfo(ds, stationIdsByName(ds, 'Киевская'));
    expect(renderStationInfo(info)).not.toMatch(LEAK_RE);

    const res = findBestRoutes(ds, stationIdsByName(ds, 'Ховрино'), stationIdsByName(ds, 'Тёплый Стан'), { k: 2 });
    expect(renderRoutes(res, 'Ховрино', 'Тёплый Стан')).not.toMatch(LEAK_RE);
  });

  it('карточка станции и маршруты по резервным данным', () => {
    const ds = getMetrobookDataset();
    const fromIds = stationIdsByName(ds, 'Ховрино');
    const info = buildStationInfo(ds, fromIds);
    expect(renderStationInfo(info)).not.toMatch(LEAK_RE);

    const res = findBestRoutes(ds, fromIds, stationIdsByName(ds, 'Речной вокзал'), { k: 1 });
    expect(renderRoutes(res, 'Ховрино', 'Речной вокзал')).not.toMatch(LEAK_RE);
  });
});
