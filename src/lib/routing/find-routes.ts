// High-level route search: route variants (Yen's algorithm) split into legs
// with all available route information. The response contents depend on how rich
// the data source is: with metrobook data the optional fields are simply absent.

import {
  ILocalizedName,
  IMetroDataset,
  IStationExit,
  IWagonHint,
  TLineKind,
  TNotificationStatus,
} from '../metro-data/types.js';
import { IGraphEdge, IRouteGraph, getRouteGraph } from './graph.js';
import { IOperatingStatus, getOperatingStatus } from './operating-hours.js';
import { getExpectedWaitSec } from './train-intervals.js';
import { yenKShortestPaths } from './yen.js';

export interface IRouteStationInfo {
  id: number;
  name: ILocalizedName;
  lineId: number;
}

export interface ILineInfo {
  id: number;
  name?: ILocalizedName;
  color?: string;
  kind: TLineKind;
  /** Line belongs to the Moscow Central Diameters */
  isMcd: boolean;
  /** Line belongs to the Moscow Central Circle */
  isMcc: boolean;
  /** Display ordering from the source (see IMetroLine.ordering) */
  ordering?: number;
}

/** "Ride" leg: consecutive segments along a single line */
export interface IRouteLegRide {
  kind: 'ride';
  line?: ILineInfo;
  timeSec: number;
  /** All stations of the leg in order, including the first and the last */
  stations: IRouteStationInfo[];
}

/** "Transfer" leg: walking transfer between stations of an interchange hub */
export interface IRouteLegTransfer {
  kind: 'transfer';
  fromStation: IRouteStationInfo;
  toStation: IRouteStationInfo;
  timeSec: number;
  /** Transfer goes via the street */
  isGround: boolean;
  /** Recommendations on which car to board (only with mosmetro data) */
  wagons?: IWagonHint[];
  /** Edge added by a notification as a temporary detour around a closed segment */
  isAlternative?: boolean;
}

export type TRouteLeg = IRouteLegRide | IRouteLegTransfer;

/** Ground transport routes near a station (from descriptions of exits to the city) */
export interface IGroundTransport {
  bus: string[];
  trolleybus: string[];
  tram: string[];
}

/** Details of a route endpoint (departure or destination station) */
export interface IRouteEndpoint {
  station: IRouteStationInfo;
  line?: ILineInfo;
  /** Time in seconds from the street entrance to the platform (not included in totalTimeSec) */
  enterTimeSec?: number;
  /** Time in seconds from the platform to the city exit (not included in totalTimeSec) */
  exitTimeSec?: number;
  groundTransport?: IGroundTransport;
  services?: string[];
  exits?: IStationExit[];
}

/** Warning for a station along the route (escalator repair, closed exits, etc.) */
export interface IRouteWarning {
  stationId: number;
  stationName: ILocalizedName;
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

export interface IRouteVariant {
  /** Total route time in seconds: rides + transfers + expected train waits (excluding entry/exit) */
  totalTimeSec: number;
  /** Total time rounded to minutes */
  totalTimeMin: number;
  rideTimeSec: number;
  transferTimeSec: number;
  /**
   * Expected wait for trains (seconds): a share of the typical interval (EXPECTED_WAIT_FACTOR)
   * at the boarding station plus the same share of the new line's interval after every
   * transfer. Intervals are empirical (time of day, weekday/weekend, metro/MCC/MCD) —
   * see train-intervals.ts.
   */
  waitTimeSec: number;
  transfersCount: number;
  legs: TRouteLeg[];
  departure: IRouteEndpoint;
  arrival: IRouteEndpoint;
  warnings: IRouteWarning[];
}

export interface IFindRoutesResult {
  /** Whether closures and repairs are applied (true only with fresh mosmetro notifications) */
  closuresApplied: boolean;
  /** Entry status of the departure hub at the requested moment (Moscow time) */
  operating: IOperatingStatus;
  variants: IRouteVariant[];
}

export interface IFindRoutesOpts {
  /** How many route variants to return (default 3) */
  k?: number;
  /** Point in time at which closures and train-wait intervals are applied (default — now) */
  at?: Date;
  /** Penalty in seconds per transfer (default 0 — transfer time is already in the graph) */
  transferPenalty?: number;
}

// ─── Helper builders ─────────────────────────────────────────────────────────

const stationInfo = (graph: IRouteGraph, id: number): IRouteStationInfo => {
  const s = graph.stations.get(id);
  if (!s) {
    throw new Error(`Station with id=${id} is missing from the data`);
  }
  return { id: s.id, name: s.name, lineId: s.lineId };
};

const lineInfo = (graph: IRouteGraph, lineId: number | undefined): ILineInfo | undefined => {
  if (lineId === undefined) {
    return undefined;
  }
  const l = graph.lines.get(lineId);
  if (!l) {
    return undefined;
  }
  return {
    id: l.id,
    ...(l.name ? { name: l.name } : {}),
    ...(l.color ? { color: l.color } : {}),
    kind: l.kind,
    isMcd: l.kind === 'mcd',
    isMcc: l.kind === 'mcc',
    ...(l.ordering !== undefined ? { ordering: l.ordering } : {}),
  };
};

const splitRoutes = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

const groundTransport = (exits: IStationExit[] | undefined): IGroundTransport | undefined => {
  if (!exits?.length) {
    return undefined;
  }
  const gt: IGroundTransport = { bus: [], trolleybus: [], tram: [] };
  for (const e of exits) {
    gt.bus.push(...splitRoutes(e.bus));
    gt.trolleybus.push(...splitRoutes(e.trolleybus));
    gt.tram.push(...splitRoutes(e.tram));
  }
  gt.bus = [...new Set(gt.bus)];
  gt.trolleybus = [...new Set(gt.trolleybus)];
  gt.tram = [...new Set(gt.tram)];
  return gt.bus.length || gt.trolleybus.length || gt.tram.length ? gt : undefined;
};

const endpoint = (graph: IRouteGraph, id: number): IRouteEndpoint => {
  const s = graph.stations.get(id)!;
  const gt = groundTransport(s.exits);
  const line = lineInfo(graph, s.lineId);
  return {
    station: stationInfo(graph, id),
    ...(line ? { line } : {}),
    ...(s.enterTimeSec !== undefined ? { enterTimeSec: s.enterTimeSec } : {}),
    ...(s.exitTimeSec !== undefined ? { exitTimeSec: s.exitTimeSec } : {}),
    ...(gt ? { groundTransport: gt } : {}),
    ...(s.services?.length ? { services: s.services } : {}),
    ...(s.exits?.length ? { exits: s.exits } : {}),
  };
};

const buildLegs = (graph: IRouteGraph, edges: IGraphEdge[]): TRouteLeg[] => {
  const legs: TRouteLeg[] = [];
  for (const e of edges) {
    if (e.kind === 'ride') {
      const last = legs[legs.length - 1];
      if (last && last.kind === 'ride' && lastLegLineId(last) === e.lineId) {
        last.timeSec += e.timeSec;
        last.stations.push(stationInfo(graph, e.to));
      } else {
        const line = lineInfo(graph, e.lineId);
        legs.push({
          kind: 'ride',
          ...(line ? { line } : {}),
          timeSec: e.timeSec,
          stations: [stationInfo(graph, e.from), stationInfo(graph, e.to)],
        });
      }
    } else {
      legs.push({
        kind: 'transfer',
        fromStation: stationInfo(graph, e.from),
        toStation: stationInfo(graph, e.to),
        timeSec: e.timeSec,
        isGround: !!e.isGround,
        ...(e.wagons?.length ? { wagons: e.wagons } : {}),
        ...(e.isAlternative ? { isAlternative: true } : {}),
      });
    }
  }
  return legs;
};

const lastLegLineId = (leg: IRouteLegRide): number | undefined => leg.line?.id;

const collectWarnings = (graph: IRouteGraph, edges: IGraphEdge[]): IRouteWarning[] => {
  const stationIds = new Set<number>();
  for (const e of edges) {
    stationIds.add(e.from);
    stationIds.add(e.to);
  }
  const result: IRouteWarning[] = [];
  for (const id of stationIds) {
    for (const w of graph.warnings.get(id) ?? []) {
      result.push({
        stationId: id,
        stationName: graph.stations.get(id)?.name ?? { ru: String(id) },
        status: w.status,
        ...(w.title ? { title: w.title } : {}),
        ...(w.description ? { description: w.description } : {}),
      });
    }
  }
  return result;
};

// ─── Public interface ────────────────────────────────────────────────────────

/**
 * Finds up to k route variants between two stations (graph node ids).
 * Throws if a station is unknown or is closed at the moment `at`.
 */
export const findRoutes = (
  dataset: IMetroDataset,
  fromId: number,
  toId: number,
  opts: IFindRoutesOpts = {},
): IFindRoutesResult => {
  const { k = 3, at = new Date(), transferPenalty } = opts;
  const graph = getRouteGraph(dataset, at);

  if (!graph.stations.has(fromId)) {
    throw new Error(`Departure station with id=${fromId} is missing from the data`);
  }
  if (!graph.stations.has(toId)) {
    throw new Error(`Destination station with id=${toId} is missing from the data`);
  }
  if (graph.closedStations.has(fromId)) {
    throw new Error(`The departure station is closed: ${graph.closedStations.get(fromId)}`);
  }
  if (graph.closedStations.has(toId)) {
    throw new Error(`The destination station is closed: ${graph.closedStations.get(toId)}`);
  }

  // Expected train wait per line at the moment `at` — priced into transfer edges so that
  // path search ranks a transfer to an infrequent line (MCD) against a longer direct ride
  const waitSecByLineId = new Map<number, number>();
  for (const l of dataset.lines) {
    waitSecByLineId.set(l.id, getExpectedWaitSec(l.kind, at));
  }
  const dijkstraOpts = { waitSecByLineId, ...(transferPenalty !== undefined ? { transferPenalty } : {}) };
  const raw = yenKShortestPaths(graph, fromId, toId, k, dijkstraOpts);

  const variants: IRouteVariant[] = raw.map(({ edges }) => {
    let rideTimeSec = 0;
    let transferTimeSec = 0;
    let transfersCount = 0;
    for (const e of edges) {
      if (e.kind === 'ride') {
        rideTimeSec += e.timeSec;
      } else {
        transferTimeSec += e.timeSec;
        transfersCount += 1;
      }
    }
    const legs = buildLegs(graph, edges);
    // One boarding per ride leg: the first train plus a train after every transfer
    let waitTimeSec = 0;
    for (const leg of legs) {
      if (leg.kind === 'ride') {
        waitTimeSec += getExpectedWaitSec(leg.line?.kind, at);
      }
    }
    const totalTimeSec = rideTimeSec + transferTimeSec + waitTimeSec + (transferPenalty ?? 0) * transfersCount;
    return {
      totalTimeSec,
      totalTimeMin: Math.round(totalTimeSec / 60),
      rideTimeSec,
      transferTimeSec,
      waitTimeSec,
      transfersCount,
      legs,
      departure: endpoint(graph, fromId),
      arrival: endpoint(graph, toId),
      warnings: collectWarnings(graph, edges),
    };
  });

  // Yen orders paths by edge weights (waits approximated on transfer edges); the exact
  // per-leg waits above may shift close variants — re-sort by the final total time
  variants.sort((a, b) => a.totalTimeSec - b.totalTimeSec);

  return {
    closuresApplied: !!dataset.notifications,
    operating: getOperatingStatus(dataset, [fromId], at),
    variants,
  };
};

/**
 * Route search between groups of stations (same-named stations on different lines):
 * iterates over all "departure × destination" pairs, merges the variants and returns
 * the k fastest. Pairs where a station is closed or no path exists are silently skipped;
 * if not a single variant is found — the error of the first failed pair is thrown.
 */
export const findBestRoutes = (
  dataset: IMetroDataset,
  fromIds: number[],
  toIds: number[],
  opts: IFindRoutesOpts = {},
): IFindRoutesResult => {
  const { k = 3 } = opts;
  const allVariants: IRouteVariant[] = [];
  let firstError: Error | null = null;
  let base: IFindRoutesResult | null = null;

  for (const fromId of fromIds) {
    for (const toId of toIds) {
      if (fromId === toId) {
        continue;
      }
      try {
        const res = findRoutes(dataset, fromId, toId, opts);
        base = base ?? res;
        allVariants.push(...res.variants);
      } catch (e) {
        firstError = firstError ?? (e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  if (!base) {
    throw firstError ?? new Error('Failed to build a route: departure/destination stations are not specified');
  }

  // Drop duplicates (identical station sequences) and take the k fastest
  const seen = new Set<string>();
  const variants = allVariants
    .sort((a, b) => a.totalTimeSec - b.totalTimeSec)
    .filter((v) => {
      const key = v.legs
        .map((l) =>
          l.kind === 'ride' ? l.stations.map((s) => s.id).join('-') : `T${l.fromStation.id}-${l.toStation.id}`,
        )
        .join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, k);

  // Recompute the entry status over ALL vestibules of the departure hub (base covers one)
  const operating = getOperatingStatus(dataset, fromIds, opts.at ?? new Date());
  return { ...base, operating, variants };
};
