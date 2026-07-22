// Builds the routing graph from the unified IMetroDataset,
// applying the closures and repairs active at the given moment.
//
// Nodes are stations (an interchange hub = several stations, one per line),
// edges are line segments (kind='ride') and walking transfers (kind='transfer'), weight — seconds.
// The "transfer penalty" is already baked into the graph as the transfer time.

import { IMetroDataset, IMetroEdge, IMetroLine, IMetroStation, TNotificationStatus } from '../metro-data/types.js';

export interface IGraphEdge {
  from: number;
  to: number;
  timeSec: number;
  kind: 'ride' | 'transfer';
  edgeId: string;
  lineId?: number;
  isGround?: boolean;
  wagons?: IMetroEdge['wagons'];
  isAlternative?: boolean;
}

/** Station warning from notifications (escalator repair, exit closure, etc.) */
export interface IStationWarning {
  status: TNotificationStatus;
  title?: string;
  description?: string;
}

export interface IRouteGraph {
  stations: Map<number, IMetroStation>;
  lines: Map<number, IMetroLine>;
  /** Adjacency list: stationId -> outgoing edges */
  adj: Map<number, IGraphEdge[]>;
  /** Closed stations: stationId -> reason */
  closedStations: Map<number, string>;
  /** Station warnings (EMERGENCY/INFO statuses — do not affect travel) */
  warnings: Map<number, IStationWarning[]>;
  /** Point in time at which the notifications are applied */
  at: Date;
}

/**
 * Builds the graph at the moment `at` (default — now).
 * Notification application order:
 *   1) select the active ones (startDate <= at <= endDate);
 *   2) remove edges with CLOSED status;
 *   3) add alternative (detour) edges;
 *   4) exclude CLOSED stations as entry/exit/transfer points;
 *   5) keep EMERGENCY/INFO statuses as warnings.
 * Important: EMERGENCY is only a warning badge, NOT a closure.
 */
export const buildRouteGraph = (dataset: IMetroDataset, at: Date = new Date()): IRouteGraph => {
  const stations = new Map(dataset.stations.map((s) => [s.id, s]));
  const lines = new Map(dataset.lines.map((l) => [l.id, l]));

  const closedStations = new Map<number, string>();
  const closedEdgeIds = new Set<string>();
  const extraEdges: IMetroEdge[] = [];
  const warnings = new Map<number, IStationWarning[]>();

  for (const n of dataset.notifications ?? []) {
    const start = new Date(n.startDate);
    const end = new Date(n.endDate);
    if (!(start <= at && at <= end)) {
      continue; // notification is not active at the moment `at`
    }
    for (const s of n.stations) {
      if (!stations.has(s.stationId)) {
        continue; // notification references a station missing from the schema
      }
      if (s.status === 'CLOSED') {
        closedStations.set(s.stationId, s.description ?? n.title ?? 'Станция закрыта');
      } else {
        const list = warnings.get(s.stationId) ?? [];
        list.push({
          status: s.status,
          ...(s.title ? { title: s.title } : {}),
          ...(s.description ? { description: s.description } : {}),
        });
        warnings.set(s.stationId, list);
      }
    }
    for (const edgeId of n.closedEdgeIds) {
      closedEdgeIds.add(edgeId);
    }
    extraEdges.push(...n.alternativeEdges);
  }

  const adj = new Map<number, IGraphEdge[]>();
  for (const id of stations.keys()) {
    adj.set(id, []);
  }

  const addDirected = (e: IMetroEdge, from: number, to: number): void => {
    if (!stations.has(from) || !stations.has(to)) {
      return; // guard against broken references in the data
    }
    adj.get(from)!.push({
      from,
      to,
      timeSec: e.timeSec,
      kind: e.kind,
      edgeId: e.edgeId,
      ...(e.lineId !== undefined ? { lineId: e.lineId } : {}),
      ...(e.isGround ? { isGround: true } : {}),
      ...(e.wagons ? { wagons: e.wagons } : {}),
      ...(e.isAlternative ? { isAlternative: true } : {}),
    });
  };

  for (const e of [...dataset.edges, ...extraEdges]) {
    if (closedEdgeIds.has(e.edgeId)) {
      continue;
    }
    addDirected(e, e.fromId, e.toId);
    if (e.bi) {
      addDirected(e, e.toId, e.fromId);
    }
  }

  // Closed station: cannot start/end a route there or transfer through it.
  // Riding "through" remains possible only if its segments are not explicitly closed
  // (in real notifications a station closure comes with the closure of its segments).
  for (const id of closedStations.keys()) {
    if (!adj.has(id)) {
      continue;
    }
    adj.set(
      id,
      adj.get(id)!.filter((e) => e.kind !== 'transfer'),
    );
    for (const edges of adj.values()) {
      for (let i = edges.length - 1; i >= 0; i--) {
        if (edges[i]!.kind === 'transfer' && edges[i]!.to === id) {
          edges.splice(i, 1);
        }
      }
    }
  }

  return { stations, lines, adj, closedStations, warnings, at };
};

// ─── Graph memoization by dataset and day ───────────────────────────────────

const graphCache = new WeakMap<IMetroDataset, Map<string, IRouteGraph>>();

/**
 * Graph for a dataset at the moment `at`, with caching. The cache key is the calendar day:
 * notifications update with daily granularity, so there is no need to rebuild the graph
 * for every request. Swapping the dataset resets the cache automatically (WeakMap keyed
 * by object identity).
 */
export const getRouteGraph = (dataset: IMetroDataset, at: Date = new Date()): IRouteGraph => {
  let byDay = graphCache.get(dataset);
  if (!byDay) {
    byDay = new Map();
    graphCache.set(dataset, byDay);
  }
  const dayKey = at.toISOString().slice(0, 10);
  let graph = byDay.get(dayKey);
  if (!graph) {
    graph = buildRouteGraph(dataset, at);
    byDay.set(dayKey, graph);
    // Bound the size: keep at most 4 "days" per dataset
    if (byDay.size > 4) {
      const oldest = byDay.keys().next().value;
      if (oldest !== undefined) {
        byDay.delete(oldest);
      }
    }
  }
  return graph;
};
