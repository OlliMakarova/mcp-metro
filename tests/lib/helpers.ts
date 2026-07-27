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
import { normalizeMetrobook, parseMetrobookHtml } from '../../src/lib/metro-data/fetch-metrobook.js';
import { ISpbHhMetroFile, validateSpbHhMetro } from '../../src/lib/metro-data/fetch-spb-hh.js';
import { ISpbOfficialFile, parseSpbOfficialHtml } from '../../src/lib/metro-data/fetch-spb-official.js';
import { ISpbRouteMapFile, parseSpbRouteMap } from '../../src/lib/metro-data/fetch-spb-route-map.js';
import { buildSpbDataset } from '../../src/lib/metro-data/normalize-spb.js';
import { SPB_GRAPH_LIMITS } from '../../src/lib/metro-data/refresh-spb.js';
import { IMetroDataset, IMetrobookGraphFile } from '../../src/lib/metro-data/types.js';

export const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');

/**
 * Point in time the reference answers are pinned to: Wednesday noon Moscow time
 * (the «Серп и Молот» closure is active, daytime train intervals apply).
 * Pinned to +03:00 so train-wait values do not depend on the machine timezone.
 */
export const AT_FIXTURE_DATE = new Date('2026-07-22T12:00:00+03:00');

/** Point in time after the «Серп и Молот» closure ends (2026-08-31) */
export const AT_AFTER_CLOSURE = new Date('2026-09-15T12:00:00+03:00');

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

// ─── Saint Petersburg fixtures (real data downloaded on 2026-07-26) ──────────

const SPB_FETCHED_AT = '2026-07-26T00:00:00.000Z';

let spbGraphCache: IMetrobookGraphFile | null = null;
let spbHhCache: ISpbHhMetroFile | null = null;
let spbOfficialCache: ISpbOfficialFile | null = null;
let spbRouteMapCache: ISpbRouteMapFile | null = null;
let spbDatasetCache: IMetroDataset | null = null;

/** SPb graph parsed from the saved metrobook-mirror page */
export const loadSpbGraphFile = (): IMetrobookGraphFile => {
  spbGraphCache ??= parseMetrobookHtml(
    readFileSync(path.join(FIXTURES_DIR, 'spb-metrobook-index.html'), 'utf8'),
    SPB_FETCHED_AT,
    'https://spb.metrobook.ru/',
    SPB_GRAPH_LIMITS,
  );
  return spbGraphCache;
};

/** SPb hh.ru reference from the saved JSON */
export const loadSpbHhFile = (): ISpbHhMetroFile => {
  spbHhCache ??= { ...validateSpbHhMetro(readJson('spb-hh-metro.json')), fetchedAt: SPB_FETCHED_AT };
  return spbHhCache;
};

/** SPb official operating hours parsed from the saved page */
export const loadSpbOfficialFile = (): ISpbOfficialFile => {
  spbOfficialCache ??= parseSpbOfficialHtml(
    readFileSync(path.join(FIXTURES_DIR, 'spb-official-hours.html'), 'utf8'),
    SPB_FETCHED_AT,
    'https://metro.spb.ru/rejimrabotystancii.html',
  );
  return spbOfficialCache;
};

/** SPb official route calculator parsed from the saved page + data file */
export const loadSpbRouteMapFile = (): ISpbRouteMapFile => {
  spbRouteMapCache ??= parseSpbRouteMap(
    readFileSync(path.join(FIXTURES_DIR, 'spb-map1-route.html'), 'utf8'),
    readFileSync(path.join(FIXTURES_DIR, 'spb-map1-spb00000.js'), 'utf8'),
    SPB_FETCHED_AT,
    'https://metro.spb.ru/map1/route.html',
    'https://metro.spb.ru/map1/files/spb00000.js',
  );
  return spbRouteMapCache;
};

/** Full Saint Petersburg dataset: graph + hh enrichment + official hours + route calculator */
export const getSpbDataset = (): IMetroDataset => {
  spbDatasetCache ??= buildSpbDataset(
    loadSpbGraphFile(),
    loadSpbHhFile(),
    loadSpbOfficialFile(),
    loadSpbRouteMapFile(),
  );
  return spbDatasetCache;
};

/** Bare Saint Petersburg dataset: graph only, no enrichment sources */
export const getSpbDatasetBare = (): IMetroDataset => buildSpbDataset(loadSpbGraphFile(), null, null);
