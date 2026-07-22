// Общие помощники для тестов библиотеки метро: загрузка фикстур и сборка наборов данных.
// Фикстуры — реальные данные, скачанные 22.07.2026 (см. tests/fixtures/).

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import {
  IMosmetroRawNotifications,
  IMosmetroRawSchema,
  normalizeMosmetro,
  validateMosmetroNotifications,
  validateMosmetroSchema,
} from '../../src/lib/metro-data/fetch-mosmetro.js';
import { normalizeMetrobook } from '../../src/lib/metro-data/fetch-metrobook.js';
import { IMetroDataset, IMetrobookGraphFile } from '../../src/lib/metro-data/types.js';

export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

/** Момент времени, на который зафиксированы эталонные ответы (закрытие «Серп и Молот» активно) */
export const AT_FIXTURE_DATE = new Date('2026-07-22T12:00:00');

/** Момент после окончания закрытия «Серп и Молот» (31.08.2026) */
export const AT_AFTER_CLOSURE = new Date('2026-09-15T12:00:00');

const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(FIXTURES_DIR, file), 'utf8'));

let schemaRawCache: IMosmetroRawSchema | null = null;
let notificationsRawCache: IMosmetroRawNotifications | null = null;
let mosmetroDatasetCache: IMetroDataset | null = null;
let metrobookDatasetCache: IMetroDataset | null = null;

export const loadSchemaRaw = (): IMosmetroRawSchema => {
  schemaRawCache ??= validateMosmetroSchema(readJson('mosmetro-schema.json'));
  return schemaRawCache;
};

export const loadNotificationsRaw = (): IMosmetroRawNotifications => {
  notificationsRawCache ??= validateMosmetroNotifications(readJson('mosmetro-notifications.json'));
  return notificationsRawCache;
};

export const loadMetrobookGraphFile = (): IMetrobookGraphFile =>
  readJson('metrobook-graph.json') as IMetrobookGraphFile;

export const loadMetrobookHtml = (): string => readFileSync(path.join(FIXTURES_DIR, 'metrobook-index.html'), 'utf8');

/** Полный набор данных mosmetro (схема + уведомления) */
export const getMosmetroDataset = (): IMetroDataset => {
  mosmetroDatasetCache ??= normalizeMosmetro(loadSchemaRaw(), loadNotificationsRaw(), {
    schemaFetchedAt: '2026-07-22T00:00:00.000Z',
    notificationsFetchedAt: '2026-07-22T00:00:00.000Z',
  });
  return mosmetroDatasetCache;
};

/** Набор данных mosmetro без уведомлений (закрытия не учитываются) */
export const getMosmetroDatasetNoNotifications = (): IMetroDataset =>
  normalizeMosmetro(loadSchemaRaw(), null, { schemaFetchedAt: '2026-07-22T00:00:00.000Z' });

/** Скудный набор данных metrobook */
export const getMetrobookDataset = (): IMetroDataset => {
  metrobookDatasetCache ??= normalizeMetrobook(loadMetrobookGraphFile());
  return metrobookDatasetCache;
};

/** Идентификаторы станций по точному русскому названию */
export const stationIdsByName = (dataset: IMetroDataset, ru: string): number[] =>
  dataset.stations.filter((s) => s.name.ru === ru).map((s) => s.id);
