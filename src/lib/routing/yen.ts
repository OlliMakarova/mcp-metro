// Yen's algorithm: k shortest paths (route variants).
// On top of Dijkstra it bans, one by one, the edges of paths already found and searches
// for spur paths; the fastest candidate becomes the next variant.

import { IGraphEdge, IRouteGraph } from './graph.js';
import { IDijkstraOpts, IDijkstraResult, dijkstra, edgeWeight } from './dijkstra.js';

const pathKey = (edges: IGraphEdge[]): string => edges.map((e) => `${e.from}-${e.to}`).join('|');

const sameEdgePrefix = (pathEdges: IGraphEdge[], rootEdges: IGraphEdge[], len: number): boolean => {
  for (let j = 0; j < len; j++) {
    const a = pathEdges[j]!;
    const b = rootEdges[j]!;
    if (a.from !== b.from || a.to !== b.to || a.edgeId !== b.edgeId) {
      return false;
    }
  }
  return true;
};

/** Up to k distinct routes from fromId to toId in ascending order of travel time */
export const yenKShortestPaths = (
  graph: IRouteGraph,
  fromId: number,
  toId: number,
  k = 3,
  opts: IDijkstraOpts = {},
): IDijkstraResult[] => {
  const first = dijkstra(graph, fromId, toId, opts);
  if (!first) {
    return [];
  }
  const paths: IDijkstraResult[] = [first];
  const candidates: Array<IDijkstraResult & { key: string }> = [];

  for (let ki = 1; ki < k; ki++) {
    const prevPath = paths[ki - 1]!.edges;

    for (let i = 0; i < prevPath.length; i++) {
      const spurNode = i === 0 ? fromId : prevPath[i - 1]!.to;
      const rootEdges = prevPath.slice(0, i);
      const rootTime = rootEdges.reduce((s, e) => s + edgeWeight(graph, e, opts), 0);

      // Ban the edges that already-found paths used to continue from spurNode after the same prefix
      const bannedEdges = new Set<string>(opts.bannedEdges ?? []);
      for (const p of paths) {
        const pe = p.edges;
        if (pe.length > i && sameEdgePrefix(pe, rootEdges, i)) {
          const e = pe[i]!;
          bannedEdges.add(`${e.from}-${e.to}-${e.edgeId}`);
        }
      }
      // Ban the nodes of the root prefix (except spurNode) to avoid loops
      const bannedNodes = new Set<number>([fromId]);
      for (const e of rootEdges) {
        bannedNodes.add(e.from);
      }
      bannedNodes.delete(spurNode);

      const spur = dijkstra(graph, spurNode, toId, { ...opts, bannedNodes, bannedEdges });
      if (!spur) {
        continue;
      }

      const totalEdges = [...rootEdges, ...spur.edges];
      const key = pathKey(totalEdges);
      if (!candidates.some((c) => c.key === key) && !paths.some((p) => pathKey(p.edges) === key)) {
        candidates.push({ timeSec: rootTime + spur.timeSec, edges: totalEdges, key });
      }
    }

    if (!candidates.length) {
      break;
    }
    candidates.sort((a, b) => a.timeSec - b.timeSec);
    const best = candidates.shift()!;
    paths.push({ timeSec: best.timeSec, edges: best.edges });
  }

  return paths;
};
