// Shared helpers for the metro library tests: fixture loading and dataset assembly.
// Fixtures are real data downloaded on 2026-07-22 (see tests/fixtures/).

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

/** Point in time the reference answers are pinned to (the «Серп и Молот» closure is active) */
export const AT_FIXTURE_DATE = new Date('2026-07-22T12:00:00');

/** Point in time after the «Серп и Молот» closure ends (2026-08-31) */
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

/** Full mosmetro dataset (schema + notifications) */
export const getMosmetroDataset = (): IMetroDataset => {
  mosmetroDatasetCache ??= normalizeMosmetro(loadSchemaRaw(), loadNotificationsRaw(), {
    schemaFetchedAt: '2026-07-22T00:00:00.000Z',
    notificationsFetchedAt: '2026-07-22T00:00:00.000Z',
  });
  return mosmetroDatasetCache;
};

/** mosmetro dataset without notifications (closures are not applied) */
export const getMosmetroDatasetNoNotifications = (): IMetroDataset =>
  normalizeMosmetro(loadSchemaRaw(), null, { schemaFetchedAt: '2026-07-22T00:00:00.000Z' });

/** Sparse metrobook dataset */
export const getMetrobookDataset = (): IMetroDataset => {
  metrobookDatasetCache ??= normalizeMetrobook(loadMetrobookGraphFile());
  return metrobookDatasetCache;
};

/** Station identifiers by exact Russian name */
export const stationIdsByName = (dataset: IMetroDataset, ru: string): number[] =>
  dataset.stations.filter((s) => s.name.ru === ru).map((s) => s.id);
