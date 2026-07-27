// Download and normalization of the primary data source — mosmetro.ru.
//
// An open but undocumented API of the "Moscow Metro" app (no authorization required,
// only a plausible User-Agent):
//   GET /api/schema/v1.0      — stations, lines, ride segments, transitions (names in ru/en/ar/cn)
//   GET /api/notifications/v2 — station/segment/transition closures, repairs, detour edges
//
// Important: the pathLength field of ride segments and transitions is TIME IN SECONDS,
// not distance (verified by cross-checking calculations against the site, see
// data/mos/mosmetro-ru/README.md).
// Since the API is undocumented, every response is checked for structural plausibility —
// an invalid response is treated the same as source unavailability.

import {
  ILocalizedName,
  IMetroDataset,
  IMetroEdge,
  IMetroLine,
  IMetroNotification,
  IMetroStation,
  IStationExit,
  ITrainScheduleEntry,
  IWagonHint,
  TLineKind,
  TNotificationStatus,
} from './types.js';

// ─── Minimal types of raw API responses (only the fields in use) ────────────

interface IRawName {
  ru?: string | null;
  en?: string | null;
  ar?: string | null;
  cn?: string | null;
}

interface IRawExit {
  title?: IRawName | null;
  exitNumber?: number | null;
  location?: { lat: number; lon: number } | null;
  bus?: string | null;
  trolleybus?: string | null;
  tram?: string | null;
}

interface IRawStation {
  id: number;
  name?: IRawName | null;
  lineId: number;
  enterTime?: number | null;
  exitTime?: number | null;
  location?: { lat: number; lon: number } | null;
  exits?: IRawExit[] | null;
  services?: string[] | null;
  scheduleTrains?: Record<string, ITrainScheduleEntry[]> | null;
  workTime?: Array<{ open?: string | null; close?: string | null } | null> | null;
  mcd?: boolean | null;
  mcc?: boolean | null;
  perspective?: boolean | null;
  outside?: boolean | null;
  typhloHtmlFile?: string | null;
  schemes?: string[] | null;
  audios?: string[] | null;
  history?: string | null;
}

interface IRawLine {
  id: number;
  name?: IRawName | null;
  color?: string | null;
  ordering?: number | null;
}

interface IRawConnection {
  id: number;
  stationFromId: number;
  stationToId: number;
  pathLength: number;
  bi?: boolean | null;
  closedBackward?: boolean | null;
  alternative?: boolean | null;
}

interface IRawTransition {
  id: number;
  stationFromId: number;
  stationToId: number;
  pathLength: number;
  bi?: boolean | null;
  ground?: boolean | null;
  wagons?: IWagonHint[] | null;
}

export interface IMosmetroRawSchema {
  data: {
    stations: IRawStation[];
    lines: IRawLine[];
    connections: IRawConnection[];
    transitions: IRawTransition[];
  };
}

interface IRawNotificationStation {
  stationId: number;
  status?: string | null;
  title?: IRawName | null;
  description?: IRawName | null;
}

interface IRawNotification {
  id: number | string;
  title?: IRawName | null;
  description?: IRawName | null;
  startDate: string;
  endDate: string;
  stations?: IRawNotificationStation[] | null;
  connections?: Array<{ connectionId: number; status?: string | null }> | null;
  transitions?: Array<{ transitionId: number; status?: string | null }> | null;
  alternativeConnections?: IRawConnection[] | null;
  alternativeTransitions?: IRawTransition[] | null;
}

export interface IMosmetroRawNotifications {
  data: IRawNotification[];
}

// ─── Download ────────────────────────────────────────────────────────────────

export interface IFetchOpts {
  url: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

const fetchJson = async ({ url, timeoutMs, fetchImpl }: IFetchOpts): Promise<unknown> => {
  const doFetch = fetchImpl ?? fetch;
  const res = await doFetch(url, {
    headers: {
      // Without a plausible User-Agent the server may reject requests
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} while requesting ${url}`);
  }
  const json = (await res.json()) as { success?: boolean };
  if (json && typeof json === 'object' && json.success === false) {
    throw new Error(`Server returned success=false while requesting ${url}`);
  }
  return json;
};

/** Schema plausibility check: the API is undocumented, its structure may change without notice */
export const validateMosmetroSchema = (raw: unknown): IMosmetroRawSchema => {
  const root = raw as Partial<IMosmetroRawSchema> | null;
  const data = root?.data;
  if (
    !data ||
    !Array.isArray(data.stations) ||
    data.stations.length < 300 ||
    !Array.isArray(data.lines) ||
    data.lines.length < 10 ||
    !Array.isArray(data.connections) ||
    data.connections.length < 300 ||
    !Array.isArray(data.transitions) ||
    data.transitions.length < 100
  ) {
    throw new Error(
      'Response of /api/schema/v1.0 does not look like a metro schema — structure changed or response incomplete',
    );
  }
  const broken = data.stations.find(
    (s) => !s || typeof s.id !== 'number' || !s.name?.ru || typeof s.lineId !== 'number',
  );
  if (broken) {
    throw new Error(`Station without id/name/line in the schema response: ${JSON.stringify(broken).slice(0, 200)}`);
  }
  return root as IMosmetroRawSchema;
};

export const validateMosmetroNotifications = (raw: unknown): IMosmetroRawNotifications => {
  const root = raw as Partial<IMosmetroRawNotifications> | null;
  if (!root?.data || !Array.isArray(root.data)) {
    throw new Error('Response of /api/notifications/v2 does not look like a notifications list');
  }
  return root as IMosmetroRawNotifications;
};

export const fetchMosmetroSchema = async (opts: IFetchOpts): Promise<IMosmetroRawSchema> =>
  validateMosmetroSchema(await fetchJson(opts));

export const fetchMosmetroNotifications = async (opts: IFetchOpts): Promise<IMosmetroRawNotifications> =>
  validateMosmetroNotifications(await fetchJson(opts));

// ─── Normalization into the unified format ───────────────────────────────────

const toLocalizedName = (raw: IRawName | null | undefined): ILocalizedName => ({
  ru: raw?.ru ?? '',
  ...(raw?.en ? { en: raw.en } : {}),
  ...(raw?.ar ? { ar: raw.ar } : {}),
  ...(raw?.cn ? { cn: raw.cn } : {}),
});

const normalizeStation = (s: IRawStation): IMetroStation => {
  const workTime = (s.workTime ?? [])
    .filter((w) => !!w)
    .map((w) => ({
      ...(w.open ? { open: w.open } : {}),
      ...(w.close ? { close: w.close } : {}),
    }));
  const exits: IStationExit[] = (s.exits ?? []).filter(Boolean).map((e) => ({
    ...(e.title?.ru ? { title: e.title.ru } : {}),
    ...(typeof e.exitNumber === 'number' ? { exitNumber: e.exitNumber } : {}),
    ...(e.location ? { location: { lat: e.location.lat, lon: e.location.lon } } : {}),
    ...(e.bus ? { bus: e.bus } : {}),
    ...(e.trolleybus ? { trolleybus: e.trolleybus } : {}),
    ...(e.tram ? { tram: e.tram } : {}),
  }));
  return {
    id: s.id,
    name: toLocalizedName(s.name),
    lineId: s.lineId,
    ...(typeof s.enterTime === 'number' ? { enterTimeSec: s.enterTime } : {}),
    ...(typeof s.exitTime === 'number' ? { exitTimeSec: s.exitTime } : {}),
    ...(s.location ? { location: { lat: s.location.lat, lon: s.location.lon } } : {}),
    ...(exits.length ? { exits } : {}),
    ...(s.services?.length ? { services: s.services } : {}),
    ...(s.scheduleTrains && Object.keys(s.scheduleTrains).length ? { scheduleTrains: s.scheduleTrains } : {}),
    ...(workTime.length ? { workTime } : {}),
    ...(s.perspective === true ? { isPerspective: true } : {}),
    ...(s.outside === true ? { isOutside: true } : {}),
    ...(s.typhloHtmlFile ? { typhloHtmlUrl: s.typhloHtmlFile } : {}),
    ...(s.schemes?.length ? { schemeImageUrls: s.schemes.filter(Boolean) } : {}),
    ...(s.audios?.length ? { audioUrls: s.audios.filter(Boolean) } : {}),
    ...(s.history?.trim() ? { history: s.history.trim() } : {}),
  };
};

/** Line kind: from the flags of the line's stations, with a fallback by line name */
const deriveLineKind = (line: IRawLine, stationsOfLine: IRawStation[]): TLineKind => {
  if (stationsOfLine.some((s) => s.mcd === true)) {
    return 'mcd';
  }
  if (stationsOfLine.some((s) => s.mcc === true)) {
    return 'mcc';
  }
  const name = line.name?.ru ?? '';
  if (/МЦД/i.test(name)) {
    return 'mcd';
  }
  if (/МЦК|центральное кольцо/i.test(name)) {
    return 'mcc';
  }
  return 'metro';
};

const connectionToEdge = (c: IRawConnection, lineIdByStation: Map<number, number>): IMetroEdge => ({
  kind: 'ride',
  edgeId: `c${c.id}`,
  fromId: c.stationFromId,
  toId: c.stationToId,
  timeSec: c.pathLength,
  // closedBackward — the API can close traffic in one direction only; then the edge is one-way
  bi: !!c.bi && !c.closedBackward,
  ...(lineIdByStation.has(c.stationFromId) ? { lineId: lineIdByStation.get(c.stationFromId)! } : {}),
  ...(c.alternative ? { isAlternative: true } : {}),
});

const transitionToEdge = (t: IRawTransition, isAlternative = false): IMetroEdge => ({
  kind: 'transfer',
  edgeId: `t${t.id}`,
  fromId: t.stationFromId,
  toId: t.stationToId,
  timeSec: t.pathLength,
  bi: !!t.bi,
  ...(t.ground ? { isGround: true } : {}),
  ...(t.wagons?.length ? { wagons: t.wagons } : {}),
  ...(isAlternative ? { isAlternative: true } : {}),
});

const KNOWN_STATUSES: TNotificationStatus[] = ['CLOSED', 'EMERGENCY', 'INFO'];

const normalizeNotification = (n: IRawNotification, lineIdByStation: Map<number, number>): IMetroNotification => {
  const closedEdgeIds: string[] = [
    ...(n.connections ?? []).filter((c) => c.status === 'CLOSED').map((c) => `c${c.connectionId}`),
    ...(n.transitions ?? []).filter((t) => t.status === 'CLOSED').map((t) => `t${t.transitionId}`),
  ];
  const alternativeEdges: IMetroEdge[] = [
    ...(n.alternativeConnections ?? []).map((c) => ({
      ...connectionToEdge(c, lineIdByStation),
      isAlternative: true,
    })),
    ...(n.alternativeTransitions ?? []).map((t) => transitionToEdge(t, true)),
  ];
  return {
    id: n.id,
    ...(n.title?.ru ? { title: n.title.ru } : {}),
    ...(n.description?.ru ? { description: n.description.ru } : {}),
    startDate: n.startDate,
    endDate: n.endDate,
    stations: (n.stations ?? []).map((s) => ({
      stationId: s.stationId,
      status: (KNOWN_STATUSES.includes(s.status as TNotificationStatus) ? s.status : 'INFO') as TNotificationStatus,
      ...(s.title?.ru ? { title: s.title.ru } : {}),
      ...(s.description?.ru ? { description: s.description.ru } : {}),
    })),
    closedEdgeIds,
    alternativeEdges,
  };
};

export interface INormalizeMosmetroOpts {
  schemaFetchedAt: string;
  notificationsFetchedAt?: string;
}

/**
 * Builds a unified IMetroDataset from raw mosmetro responses.
 * Notifications are optional: without them routes are still built, but closures are ignored.
 */
export const normalizeMosmetro = (
  schemaRaw: IMosmetroRawSchema,
  notificationsRaw: IMosmetroRawNotifications | null,
  opts: INormalizeMosmetroOpts,
): IMetroDataset => {
  const { data } = schemaRaw;
  const lineIdByStation = new Map<number, number>(data.stations.map((s) => [s.id, s.lineId]));
  const stationsByLine = new Map<number, IRawStation[]>();
  for (const s of data.stations) {
    const list = stationsByLine.get(s.lineId) ?? [];
    list.push(s);
    stationsByLine.set(s.lineId, list);
  }

  const lines: IMetroLine[] = data.lines.map((l) => ({
    id: l.id,
    name: toLocalizedName(l.name),
    ...(l.color ? { color: l.color } : {}),
    kind: deriveLineKind(l, stationsByLine.get(l.id) ?? []),
    ...(typeof l.ordering === 'number' ? { ordering: l.ordering } : {}),
  }));

  const edges: IMetroEdge[] = [
    ...data.connections.map((c) => connectionToEdge(c, lineIdByStation)),
    ...data.transitions.map((t) => transitionToEdge(t)),
  ];

  const notifications = notificationsRaw
    ? notificationsRaw.data.map((n) => normalizeNotification(n, lineIdByStation))
    : null;

  return {
    city: 'moscow',
    source: 'mosmetro',
    schemaFetchedAt: opts.schemaFetchedAt,
    ...(notifications && opts.notificationsFetchedAt ? { notificationsFetchedAt: opts.notificationsFetchedAt } : {}),
    stations: data.stations.map(normalizeStation),
    lines,
    edges,
    ...(notifications ? { notifications } : {}),
  };
};
