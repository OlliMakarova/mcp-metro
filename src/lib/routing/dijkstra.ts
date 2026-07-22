// Dijkstra's algorithm: fastest-time path in the metro graph.
// The priority queue is a binary min-heap. On the metro graph (~450 nodes,
// ~1200 edges) a search takes a fraction of a millisecond.

import { IGraphEdge, IRouteGraph } from './graph.js';

/** Simple binary min-heap */
class MinHeap {
  private a: Array<{ id: number; dist: number }> = [];

  push(item: { id: number; dist: number }): void {
    const { a } = this;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.dist <= a[i]!.dist) {
        break;
      }
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }

  pop(): { id: number; dist: number } | undefined {
    const { a } = this;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.dist < a[m]!.dist) {
          m = l;
        }
        if (r < a.length && a[r]!.dist < a[m]!.dist) {
          m = r;
        }
        if (m === i) {
          break;
        }
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }

  get size(): number {
    return this.a.length;
  }
}

export interface IDijkstraOpts {
  /** Penalty in seconds for each transfer (default 0 — transfer time is already in the graph) */
  transferPenalty?: number;
  /**
   * Expected wait for a train (seconds) by lineId. Added to the weight of every transfer
   * edge based on the line of its target station: after a transfer the passenger waits for
   * a train of the new line. Ranks a transfer to an infrequent line (MCD) fairly against
   * a slightly longer ride without one. The wait at the very first boarding is a constant
   * for all paths of one search and is accounted for at the find-routes level.
   */
  waitSecByLineId?: Map<number, number>;
  /** Stations that must not be passed through (for Yen's algorithm) */
  bannedNodes?: Set<number>;
  /** Edge keys "from-to-edgeId" that must not be used (for Yen's algorithm) */
  bannedEdges?: Set<string>;
}

export interface IDijkstraResult {
  /** Travel time in seconds (including transferPenalty, if set) */
  timeSec: number;
  /** Path edges in order */
  edges: IGraphEdge[];
}

export const edgeBanKey = (e: IGraphEdge): string => `${e.from}-${e.to}-${e.edgeId}`;

/**
 * Edge weight for path search: ride edges cost their time; transfer edges additionally
 * carry the transfer penalty and the expected wait for a train of the boarded line
 * (the line of the transfer's target station). Shared by Dijkstra and Yen so both
 * always price paths identically.
 */
export const edgeWeight = (graph: IRouteGraph, e: IGraphEdge, opts: IDijkstraOpts): number => {
  if (e.kind !== 'transfer') {
    return e.timeSec;
  }
  const toLineId = graph.stations.get(e.to)?.lineId;
  const wait = toLineId !== undefined ? (opts.waitSecByLineId?.get(toLineId) ?? 0) : 0;
  return e.timeSec + (opts.transferPenalty ?? 0) + wait;
};

/** Fastest-time path from fromId to toId, or null if no path exists */
export const dijkstra = (
  graph: IRouteGraph,
  fromId: number,
  toId: number,
  opts: IDijkstraOpts = {},
): IDijkstraResult | null => {
  const { bannedNodes, bannedEdges } = opts;

  const dist = new Map<number, number>();
  const prevEdge = new Map<number, IGraphEdge>();
  const heap = new MinHeap();
  dist.set(fromId, 0);
  heap.push({ id: fromId, dist: 0 });

  while (heap.size) {
    const top = heap.pop()!;
    const { id, dist: d } = top;
    if (d > (dist.get(id) ?? Infinity)) {
      continue; // stale heap entry
    }
    if (id === toId) {
      break;
    }

    for (const e of graph.adj.get(id) ?? []) {
      if (bannedNodes?.has(e.to)) {
        continue;
      }
      if (bannedEdges?.has(edgeBanKey(e))) {
        continue;
      }
      const nd = d + edgeWeight(graph, e, opts);
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prevEdge.set(e.to, e);
        heap.push({ id: e.to, dist: nd });
      }
    }
  }

  const total = dist.get(toId);
  if (total === undefined) {
    return null;
  }

  // Reconstruct the path from the chain of edges
  const edges: IGraphEdge[] = [];
  let cur = toId;
  while (cur !== fromId) {
    const e = prevEdge.get(cur);
    if (!e) {
      return null;
    }
    edges.unshift(e);
    cur = e.from;
  }
  return { timeSec: total, edges };
};
