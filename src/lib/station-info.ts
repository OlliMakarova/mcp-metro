// Assembly of exhaustive information about a physical station (interchange hub) from the dataset.
//
// A station is specified by the ids of its platforms (graph nodes) — usually one node,
// or several for an interchange hub (one per line). The result is a single structured
// object suitable both for a JSON REST response and for markdown rendering for the agent.
// The richness of the details depends on the data source: with the metrobook.ru fallback
// the optional fields (exits, services, schedule) are simply absent.

import {
  IMetroDataset,
  IGeoPoint,
  ILocalizedName,
  IStationExit,
  IStationWorkTimeDay,
  ITrainScheduleEntry,
  TLineKind,
  TNotificationStatus,
} from './metro-data/types.js';
import { getRouteGraph } from './routing/graph.js';
import { getStationClusters } from './station-search/station-clusters.js';

export interface IStationLineRef {
  id: number;
  name?: string;
  color?: string;
  kind: TLineKind;
  /** Line belongs to the Moscow Central Diameters */
  isMcd: boolean;
  /** Line belongs to the Moscow Central Circle */
  isMcc: boolean;
}

/** First and last train per direction (the data contains no service intervals) */
export interface IStationScheduleDir {
  toName?: string;
  /**
   * Which days the times apply to: "чётные"/"нечётные" (even/odd dates of the month — trains
   * run on two alternating timetables), optionally refined with "будни"/"выходные"
   * (weekdays/weekends). Absent when the direction's times are the same on all days.
   */
  days?: string;
  first?: string;
  last?: string;
}

/** Ground transport near the station exits */
export interface IStationGroundTransport {
  bus: string[];
  trolleybus: string[];
  tram: string[];
}

/** One platform of the station (one line of the interchange hub) */
export interface IStationPlatform {
  stationId: number;
  line?: IStationLineRef;
  /** Time in seconds from the street entrance to the platform */
  enterTimeSec?: number;
  /** Time in seconds from the platform to the city exit */
  exitTimeSec?: number;
  services?: string[];
  exits?: IStationExit[];
  groundTransport?: IStationGroundTransport;
  schedule?: IStationScheduleDir[];
  /** Vestibule opening hours by day of week: 7 entries, Monday — Sunday */
  workTime?: IStationWorkTimeDay[];
}

/** Station warning from notifications (escalator repair, exit/elevator closure, etc.) */
export interface IStationWarningInfo {
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

export interface IStationInfo {
  name: ILocalizedName;
  /** Interchange hub identifier */
  clusterId: number;
  location?: IGeoPoint;
  /** Lines the station's platforms belong to */
  lines: IStationLineRef[];
  platforms: IStationPlatform[];
  /** Other lines of the hub, reachable by transfer from the given platforms */
  interchanges: IStationLineRef[];
  /** Currently active warnings (repairs, closures of exits/elevators/escalators) */
  warnings: IStationWarningInfo[];
  /** Whether active closures and repairs are applied (true only with fresh mosmetro notifications) */
  closuresApplied: boolean;
}

const splitRoutes = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

const groundTransport = (exits: IStationExit[] | undefined): IStationGroundTransport | undefined => {
  if (!exits?.length) {
    return undefined;
  }
  const bus = new Set<string>();
  const trolleybus = new Set<string>();
  const tram = new Set<string>();
  for (const e of exits) {
    for (const r of splitRoutes(e.bus)) {
      bus.add(r);
    }
    for (const r of splitRoutes(e.trolleybus)) {
      trolleybus.add(r);
    }
    for (const r of splitRoutes(e.tram)) {
      tram.add(r);
    }
  }
  if (!bus.size && !trolleybus.size && !tram.size) {
    return undefined;
  }
  return { bus: [...bus], trolleybus: [...trolleybus], tram: [...tram] };
};

const DAY_TYPE_LABEL: Record<string, string> = { EVEN: 'чётные', ODD: 'нечётные' };

const comboKey = (e: ITrainScheduleEntry): string => `${e.dayType ?? ''}|${e.weekend ?? ''}`;

/**
 * "Which days the times apply to" label for a group of same-direction entries with identical
 * times. The covered "date parity × weekday/weekend" combinations are reduced to a short
 * description: "чётные" (even), "будни" (weekdays), "нечётные, выходные" (odd, weekends), etc.
 * If the group covers all combinations seen for the direction (the times are the same on all
 * days) — no label is needed and undefined is returned.
 */
const scheduleDaysLabel = (group: ITrainScheduleEntry[], directionComboCount: number): string | undefined => {
  const combos = new Set(group.map(comboKey));
  if (combos.size >= directionComboCount) {
    return undefined;
  }
  const has = (dayType: string, weekend: boolean): boolean => combos.has(`${dayType}|${weekend}`);
  // Both parities, but only weekdays or only weekends
  if (has('EVEN', false) && has('ODD', false) && !has('EVEN', true) && !has('ODD', true)) {
    return 'будни';
  }
  if (has('EVEN', true) && has('ODD', true) && !has('EVEN', false) && !has('ODD', false)) {
    return 'выходные';
  }
  const parts: string[] = [];
  for (const dayType of ['EVEN', 'ODD']) {
    const label = DAY_TYPE_LABEL[dayType]!;
    if (has(dayType, false) && has(dayType, true)) {
      parts.push(label);
    } else if (has(dayType, false)) {
      parts.push(`${label}, будни`);
    } else if (has(dayType, true)) {
      parts.push(`${label}, выходные`);
    }
  }
  return parts.length ? parts.join('; ') : undefined;
};

const scheduleSummary = (
  scheduleTrains: Record<string, ITrainScheduleEntry[]> | undefined,
): IStationScheduleDir[] | undefined => {
  if (!scheduleTrains) {
    return undefined;
  }
  // Up to four entries per direction: "even/odd dates × weekdays/weekends" combinations.
  // Their times often differ (in current data — for 228 stations out of 443), so entries
  // with identical times are collapsed into one row, and the differing ones get a `days`
  // label saying which days that time applies to.
  const result: IStationScheduleDir[] = [];
  for (const entries of Object.values(scheduleTrains)) {
    const groups = new Map<string, ITrainScheduleEntry[]>();
    for (const e of entries) {
      const key = `${e.stationToName ?? ''}|${e.first ?? ''}|${e.last ?? ''}`;
      const group = groups.get(key);
      if (group) {
        group.push(e);
      } else {
        groups.set(key, [e]);
      }
    }
    const directionComboCount = new Set(entries.map(comboKey)).size;
    const rows = [...groups.values()].sort((a, b) => (a[0]!.first ?? '').localeCompare(b[0]!.first ?? ''));
    for (const group of rows) {
      const e = group[0]!;
      const days = scheduleDaysLabel(group, directionComboCount);
      result.push({
        ...(e.stationToName ? { toName: e.stationToName } : {}),
        ...(days ? { days } : {}),
        ...(e.first ? { first: e.first } : {}),
        ...(e.last ? { last: e.last } : {}),
      });
    }
  }
  return result.length ? result : undefined;
};

const lineRef = (
  lines: Map<number, { id: number; name?: ILocalizedName; color?: string; kind: TLineKind }>,
  lineId: number | undefined,
): IStationLineRef | undefined => {
  if (lineId === undefined) {
    return undefined;
  }
  const l = lines.get(lineId);
  if (!l) {
    return undefined;
  }
  return {
    id: l.id,
    ...(l.name?.ru ? { name: l.name.ru } : {}),
    ...(l.color ? { color: l.color } : {}),
    kind: l.kind,
    isMcd: l.kind === 'mcd',
    isMcc: l.kind === 'mcc',
  };
};

/**
 * Assembles station details by its platform ids (graph nodes) at the moment `at`.
 * Unknown ids are silently skipped; if none is found — an error is thrown.
 */
export const buildStationInfo = (dataset: IMetroDataset, stationIds: number[], at: Date = new Date()): IStationInfo => {
  const graph = getRouteGraph(dataset, at);
  const clusters = getStationClusters(dataset);
  const { lines } = graph;

  const ids = stationIds.filter((id) => graph.stations.has(id));
  if (!ids.length) {
    throw new Error('Станция не найдена в данных');
  }

  const first = graph.stations.get(ids[0]!)!;
  const idSet = new Set(ids);

  const platforms: IStationPlatform[] = ids.map((id) => {
    const s = graph.stations.get(id)!;
    const line = lineRef(lines, s.lineId);
    const gt = groundTransport(s.exits);
    const sched = scheduleSummary(s.scheduleTrains);
    return {
      stationId: id,
      ...(line ? { line } : {}),
      ...(s.enterTimeSec !== undefined ? { enterTimeSec: s.enterTimeSec } : {}),
      ...(s.exitTimeSec !== undefined ? { exitTimeSec: s.exitTimeSec } : {}),
      ...(s.services?.length ? { services: s.services } : {}),
      ...(s.exits?.length ? { exits: s.exits } : {}),
      ...(gt ? { groundTransport: gt } : {}),
      ...(sched ? { schedule: sched } : {}),
      ...(s.workTime?.length ? { workTime: s.workTime } : {}),
    };
  });

  // Unique lines of the station's platforms
  const lineList: IStationLineRef[] = [];
  for (const p of platforms) {
    if (p.line && !lineList.some((l) => l.id === p.line!.id)) {
      lineList.push(p.line);
    }
  }

  // Interchanges: lines of the hub's neighboring platforms reachable by transfer but not
  // among the requested platforms (these are "the other lines of this station").
  const interchanges: IStationLineRef[] = [];
  for (const e of dataset.edges) {
    if (e.kind !== 'transfer') {
      continue;
    }
    let neighbor: number | undefined;
    if (idSet.has(e.fromId) && !idSet.has(e.toId)) {
      neighbor = e.toId;
    } else if (e.bi && idSet.has(e.toId) && !idSet.has(e.fromId)) {
      neighbor = e.fromId;
    }
    if (neighbor === undefined) {
      continue;
    }
    const ns = graph.stations.get(neighbor);
    if (!ns) {
      continue;
    }
    const ref = lineRef(lines, ns.lineId);
    if (ref && !lineList.some((l) => l.id === ref.id) && !interchanges.some((l) => l.id === ref.id)) {
      interchanges.push(ref);
    }
  }

  // Active warnings across all platforms of the hub
  const warnings: IStationWarningInfo[] = [];
  const seenWarn = new Set<string>();
  for (const id of ids) {
    for (const w of graph.warnings.get(id) ?? []) {
      const key = `${w.status}|${w.title ?? ''}|${w.description ?? ''}`;
      if (seenWarn.has(key)) {
        continue;
      }
      seenWarn.add(key);
      warnings.push(w);
    }
  }

  return {
    name: first.name,
    clusterId: clusters.clusterOf(ids[0]!),
    ...(first.location ? { location: first.location } : {}),
    lines: lineList,
    platforms,
    interchanges,
    warnings,
    closuresApplied: !!dataset.notifications,
  };
};
