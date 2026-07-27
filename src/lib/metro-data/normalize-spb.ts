// Assembly of the Saint Petersburg dataset from three sources.
//
// The weighted graph core (stations per line, ride segments and transfers with times in
// seconds) comes from the SPb metrobook mirror — the same undocumented-but-stable format the
// Moscow fallback source uses, so the parser is shared. Two enrichment sources are layered on
// top when available (each is optional — the dataset degrades gracefully to the bare graph):
//
//   hh.ru reference  — station coordinates, line names/colors, display ordering;
//   metro.spb.ru     — official vestibule opening hours (workTime), first/last trains by
//                      direction with odd/even-day timetables (scheduleTrains), vestibule
//                      exits, and closure notes → CLOSED/INFO notifications.
//
// The graph source lags behind network extensions (at the time of writing it lacks line 6
// «Красносельско-Калининская», open since 2024), so a supplement step rebuilds missing line-6
// vertices from the official/hh data: ride time is derived from the official first-train time
// difference between the two stations, and the Putilovskaya ↔ Kirovsky Zavod transfer is added
// with a conservative constant. The supplement is self-deactivating: it applies only while the
// graph source does not know the station «Юго-Западная».

import { ISpbHhMetroFile } from './fetch-spb-hh.js';
import { ISpbOfficialFile, ISpbVestibuleRow } from './fetch-spb-official.js';
import { ISpbRouteMapFile } from './fetch-spb-route-map.js';
import { normalizeMetrobook } from './fetch-metrobook.js';
import {
  IMetroDataset,
  IMetroEdge,
  IMetroNotification,
  IMetroStation,
  IMetrobookGraphFile,
  ITrainScheduleEntry,
} from './types.js';

/** Ids of the supplemented line-6 vertices — far above the graph source's own sdid range */
const SUPPLEMENT_ID_BASE = 900;
const LINE6_ID = 6;
const YUGO_ZAPADNAYA = 'Юго-Западная';
const PUTILOVSKAYA = 'Путиловская';
/** Line-1 station Putilovskaya is connected to by an in-hub transfer */
const KIROVSKY_ZAVOD = 'Кировский завод';
/** Fallback line-6 ride time when the official page yields no usable first-train difference */
const LINE6_RIDE_FALLBACK_SEC = 210;
/** Putilovskaya ↔ Kirovsky Zavod transfer estimate (escalators + corridor) */
const LINE6_TRANSFER_SEC = 180;
/** Synthesized closure notifications are considered valid this long after the page fetch */
const NOTIFICATION_VALIDITY_DAYS = 400;

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** «5:38» → «05:38» (the dataset stores zero-padded HH:MM everywhere) */
const padTime = (t: string): string => (t.length === 4 ? `0${t}` : t);

const timeToMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

// ─── Line-6 supplement ───────────────────────────────────────────────────────

/** Ride seconds between the two line-6 stations from official first-train differences */
const deriveLine6RideSec = (official: ISpbOfficialFile | null): number => {
  if (!official) {
    return LINE6_RIDE_FALLBACK_SEC;
  }
  const rows = official.rows.filter((r) => r.line === LINE6_ID && r.first);
  const yz = rows.find((r) => norm(r.station) === norm(YUGO_ZAPADNAYA));
  const pt = rows.find((r) => norm(r.station) === norm(PUTILOVSKAYA));
  if (!yz?.first || !pt?.first) {
    return LINE6_RIDE_FALLBACK_SEC;
  }
  const diffs: number[] = [];
  for (const dir of [PUTILOVSKAYA, YUGO_ZAPADNAYA]) {
    const a = yz.first.find((f) => norm(f.direction) === norm(dir));
    const b = pt.first.find((f) => norm(f.direction) === norm(dir));
    if (a && b) {
      const d = Math.abs(timeToMin(a.odd) - timeToMin(b.odd)) * 60;
      if (d >= 60 && d <= 900) {
        diffs.push(d);
      }
    }
  }
  if (!diffs.length) {
    return LINE6_RIDE_FALLBACK_SEC;
  }
  return Math.round(diffs.reduce((s, d) => s + d, 0) / diffs.length);
};

/**
 * Adds the line-6 vertices/edges missing from the graph source. No-op once the graph source
 * itself contains «Юго-Западная».
 */
const supplementLine6 = (dataset: IMetroDataset, official: ISpbOfficialFile | null): void => {
  const known = new Set(dataset.stations.map((s) => norm(s.name.ru)));
  if (known.has(norm(YUGO_ZAPADNAYA))) {
    return;
  }
  const yzId = SUPPLEMENT_ID_BASE + 1;
  const ptId = SUPPLEMENT_ID_BASE + 2;
  dataset.lines.push({ id: LINE6_ID, kind: 'metro', ordering: LINE6_ID });
  dataset.stations.push(
    { id: yzId, name: { ru: YUGO_ZAPADNAYA }, lineId: LINE6_ID },
    { id: ptId, name: { ru: PUTILOVSKAYA }, lineId: LINE6_ID },
  );
  const edges: IMetroEdge[] = [
    {
      kind: 'ride',
      edgeId: 'spb6-ride-1',
      fromId: yzId,
      toId: ptId,
      timeSec: deriveLine6RideSec(official),
      bi: true,
      lineId: LINE6_ID,
    },
  ];
  const kirovsky = dataset.stations.find((s) => s.lineId === 1 && norm(s.name.ru) === norm(KIROVSKY_ZAVOD));
  if (kirovsky) {
    edges.push({
      kind: 'transfer',
      edgeId: 'spb6-transfer-1',
      fromId: ptId,
      toId: kirovsky.id,
      timeSec: LINE6_TRANSFER_SEC,
      bi: true,
    });
  }
  dataset.edges.push(...edges);
};

// ─── hh.ru enrichment ────────────────────────────────────────────────────────

/**
 * Maps every hh.ru line to a dataset lineId by majority vote of normalized station names,
 * then fills station coordinates and line names/colors/ordering.
 */
const enrichFromHh = (dataset: IMetroDataset, hh: ISpbHhMetroFile): void => {
  const lineOfStation = new Map<string, number[]>();
  for (const s of dataset.stations) {
    const key = norm(s.name.ru);
    lineOfStation.set(key, [...(lineOfStation.get(key) ?? []), s.lineId]);
  }

  for (const hhLine of hh.lines) {
    const votes = new Map<number, number>();
    for (const st of hhLine.stations) {
      for (const lineId of lineOfStation.get(norm(st.name)) ?? []) {
        votes.set(lineId, (votes.get(lineId) ?? 0) + 1);
      }
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best || best[1] < 2) {
      continue;
    }
    const lineId = best[0];
    const line = dataset.lines.find((l) => l.id === lineId);
    if (line) {
      line.name = { ru: hhLine.name };
      line.color = `#${hhLine.hex_color}`;
      line.ordering = line.ordering ?? lineId;
    }
    const hhByName = new Map(hhLine.stations.map((s) => [norm(s.name), s]));
    for (const station of dataset.stations) {
      if (station.lineId !== lineId) {
        continue;
      }
      // Exact name first, then the hub-suffix-tolerant fallback («Технологический институт 1» → «…институт»)
      const hhStation =
        hhByName.get(norm(station.name.ru)) ?? hhByName.get(norm(station.name.ru).replace(/\s+[12]$/, ''));
      if (hhStation && !station.location) {
        station.location = { lat: hhStation.lat, lon: hhStation.lng };
      }
    }
  }
};

// ─── Official metro.spb.ru enrichment ────────────────────────────────────────

/** Rows grouped per station of a line: the primary (schedule-bearing) row plus all vestibules */
interface IStationRows {
  all: ISpbVestibuleRow[];
  schedule?: ISpbVestibuleRow;
  note?: string;
}

const groupOfficialRows = (official: ISpbOfficialFile): Map<string, IStationRows> => {
  const byStation = new Map<string, IStationRows>();
  for (const row of official.rows) {
    const key = `${row.line}|${norm(row.station)}`;
    const group = byStation.get(key) ?? { all: [] };
    group.all.push(row);
    if (row.first && !group.schedule) {
      group.schedule = row;
    }
    if (row.note && !group.note) {
      group.note = row.note;
    }
    byStation.set(key, group);
  }
  return byStation;
};

const applyOfficialToStation = (
  station: IMetroStation,
  group: IStationRows,
  stationIdByLineAndName: Map<string, number>,
): void => {
  const withHours = group.all.filter((r) => r.open && r.closeEntry);
  if (withHours.length) {
    const open = withHours.map((r) => padTime(r.open!)).sort()[0]!;
    // Entry-closing times are around midnight: «23:xx» sorts after «00:xx», so pick max by
    // wrapped minutes (times before 12:00 are treated as the following night)
    const close = withHours
      .map((r) => padTime(r.closeEntry!))
      .sort((a, b) => ((timeToMin(a) + 720) % 1440) - ((timeToMin(b) + 720) % 1440))
      .at(-1)!;
    // The official table has no per-weekday split — the same window applies to all 7 days
    station.workTime = Array.from({ length: 7 }, () => ({ open, close }));
  }

  const exits = group.all
    .map((r) => r.title.match(/\((выход[^)]*)\)/)?.[1])
    .filter((t): t is string => !!t)
    .map((t) => ({ title: t }));
  if (exits.length) {
    station.exits = exits;
  }

  const { schedule } = group;
  if (schedule?.first && schedule.last) {
    const trains: Record<string, ITrainScheduleEntry[]> = {};
    for (const [i, f] of schedule.first.entries()) {
      const toId = stationIdByLineAndName.get(`${station.lineId}|${norm(f.direction)}`);
      if (toId === undefined || toId === station.id) {
        continue;
      }
      const last = schedule.last[i]?.time;
      const base = { stationToId: toId, stationToName: f.direction, ...(last ? { last: padTime(last) } : {}) };
      trains[f.direction] =
        f.odd === f.even
          ? [{ ...base, first: padTime(f.odd) }]
          : [
              { ...base, first: padTime(f.odd), dayType: 'ODD' },
              { ...base, first: padTime(f.even), dayType: 'EVEN' },
            ];
    }
    if (Object.keys(trains).length) {
      station.scheduleTrains = trains;
    }
  }
};

const buildClosureNotifications = (
  dataset: IMetroDataset,
  official: ISpbOfficialFile,
  groups: Map<string, IStationRows>,
): IMetroNotification[] => {
  const start = new Date(official.fetchedAt);
  const end = new Date(start.getTime() + NOTIFICATION_VALIDITY_DAYS * 86_400_000);
  const notifications: IMetroNotification[] = [];
  for (const station of dataset.stations) {
    const group = groups.get(`${station.lineId}|${norm(station.name.ru)}`);
    if (!group?.note) {
      continue;
    }
    const isClosed = /закрыт/i.test(group.note) && /станци/i.test(group.note);
    notifications.push({
      id: `spb-official-${station.id}`,
      title: group.note,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      stations: [{ stationId: station.id, status: isClosed ? 'CLOSED' : 'INFO', title: group.note }],
      // Trains pass through stations closed for reconstruction — no ride edges are removed
      closedEdgeIds: [],
      alternativeEdges: [],
    });
  }
  return notifications;
};

const enrichFromOfficial = (dataset: IMetroDataset, official: ISpbOfficialFile): void => {
  const groups = groupOfficialRows(official);
  const stationIdByLineAndName = new Map<string, number>();
  for (const s of dataset.stations) {
    stationIdByLineAndName.set(`${s.lineId}|${norm(s.name.ru)}`, s.id);
  }
  for (const station of dataset.stations) {
    const group =
      groups.get(`${station.lineId}|${norm(station.name.ru)}`) ??
      groups.get(`${station.lineId}|${norm(station.name.ru).replace(/\s+[12]$/, '')}`);
    if (group) {
      applyOfficialToStation(station, group, stationIdByLineAndName);
    }
  }
  const notifications = buildClosureNotifications(dataset, official, groups);
  if (notifications.length) {
    dataset.notifications = notifications;
    dataset.notificationsFetchedAt = official.fetchedAt;
  }
};

// ─── Official route calculator enrichment ────────────────────────────────────

/**
 * Layers the official route-calculator data (metro.spb.ru/map1) onto the dataset:
 *  1) transfer times: the graph source's uniform 60 s is unrealistically low — replaced with
 *     the calculator's walk-plus-train-wait estimate (235 s) on every transfer edge;
 *  2) street entrance/exit times for door-to-door estimates: the calculator's entranceMin/Max
 *     range collapsed to its mean, filled only where a station has no own value;
 *  3) closed stations (commented out of the calculator's picker) → CLOSED notifications,
 *     deduplicated against the ones synthesized from the official operating-hours page;
 *  4) announced transfer closures (obstacles) → notifications with the transfer edges closed.
 */
const enrichFromRouteMap = (dataset: IMetroDataset, routeMap: ISpbRouteMapFile): void => {
  const { timing } = routeMap;

  for (const edge of dataset.edges) {
    if (edge.kind === 'transfer' && !edge.isAlternative) {
      edge.timeSec = timing.transferSec;
    }
  }

  const entranceSec = Math.round((timing.entranceMinSec + timing.entranceMaxSec) / 2);
  for (const station of dataset.stations) {
    station.enterTimeSec ??= entranceSec;
    station.exitTimeSec ??= entranceSec;
  }

  const start = new Date(routeMap.fetchedAt);
  const end = new Date(start.getTime() + NOTIFICATION_VALIDITY_DAYS * 86_400_000);
  const notifications: IMetroNotification[] = [];
  const lineIdByCode = new Map(routeMap.lines.map((l) => [l.code, l.lineId]));
  const alreadyClosed = new Set(
    (dataset.notifications ?? []).flatMap((n) =>
      n.stations.filter((s) => s.status === 'CLOSED').map((s) => s.stationId),
    ),
  );
  for (const closed of routeMap.closedStations) {
    if (!closed.title) {
      continue;
    }
    const lineId = lineIdByCode.get(closed.code.slice(0, 3));
    const station = dataset.stations.find(
      (s) => norm(s.name.ru) === norm(closed.title!) && (lineId == null || s.lineId === lineId),
    );
    // The official operating-hours page already reported this closure — one notice is enough
    if (!station || alreadyClosed.has(station.id)) {
      continue;
    }
    const title = `Станция «${closed.title}» временно закрыта (по данным интерактивной схемы метрополитена)`;
    notifications.push({
      id: `spb-map-${station.id}`,
      title,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      stations: [{ stationId: station.id, status: 'CLOSED', title }],
      // Trains pass through closed stations — no ride edges are removed
      closedEdgeIds: [],
      alternativeEdges: [],
    });
  }

  // Announced transfer closures: «s1-code s2-code» → the transfer edges between the stations
  const stationByCode = new Map<string, number>();
  for (const line of routeMap.lines) {
    for (const s of line.stations) {
      if (!s.title || line.lineId === null) {
        continue;
      }
      const match = dataset.stations.find((ds) => ds.lineId === line.lineId && norm(ds.name.ru) === norm(s.title!));
      if (match) {
        stationByCode.set(s.code, match.id);
      }
    }
  }
  for (const [pair, obstacle] of Object.entries(routeMap.obstacles)) {
    const [c1, c2] = pair.split(' ');
    const id1 = c1 ? stationByCode.get(c1) : undefined;
    const id2 = c2 ? stationByCode.get(c2) : undefined;
    if (id1 === undefined || id2 === undefined) {
      continue;
    }
    const closedEdgeIds = dataset.edges
      .filter(
        (e) => e.kind === 'transfer' && ((e.fromId === id1 && e.toId === id2) || (e.fromId === id2 && e.toId === id1)),
      )
      .map((e) => e.edgeId);
    if (!closedEdgeIds.length) {
      continue;
    }
    const until = obstacle.until ? new Date(obstacle.until) : null;
    const title = obstacle.reason ?? 'Переход временно закрыт (по данным интерактивной схемы метрополитена)';
    notifications.push({
      id: `spb-map-transfer-${id1}-${id2}`,
      title,
      startDate: start.toISOString(),
      endDate: until && !Number.isNaN(until.getTime()) ? until.toISOString() : end.toISOString(),
      stations: [
        { stationId: id1, status: 'INFO', title },
        { stationId: id2, status: 'INFO', title },
      ],
      closedEdgeIds,
      alternativeEdges: [],
    });
  }

  if (notifications.length) {
    dataset.notifications = [...(dataset.notifications ?? []), ...notifications];
    dataset.notificationsFetchedAt ??= routeMap.fetchedAt;
  }
};

// ─── Assembly ────────────────────────────────────────────────────────────────

/**
 * Builds the Saint Petersburg IMetroDataset: graph core from the metrobook mirror (or from the
 * official route calculator when the mirror is down), optional enrichment from hh.ru
 * (coordinates, line names/colors), the official operating-hours page (workTime, first/last
 * trains, exits, closure notifications) and the route calculator (transfer times, entrance/exit
 * times, closure cross-check), plus the line-6 supplement.
 */
export const buildSpbDataset = (
  graph: IMetrobookGraphFile,
  hh: ISpbHhMetroFile | null,
  official: ISpbOfficialFile | null,
  routeMap: ISpbRouteMapFile | null = null,
): IMetroDataset => {
  const dataset = normalizeMetrobook(graph);
  dataset.city = 'spb';
  dataset.source = 'spb-combined';
  // Graph-source line ids coincide with the public SPb line numbers — use them for badges
  for (const line of dataset.lines) {
    line.ordering = line.id;
  }
  supplementLine6(dataset, official);
  if (hh) {
    enrichFromHh(dataset, hh);
  }
  if (official) {
    enrichFromOfficial(dataset, official);
  }
  if (routeMap) {
    enrichFromRouteMap(dataset, routeMap);
  }
  return dataset;
};
