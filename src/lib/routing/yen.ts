// Алгоритм Йена: k кратчайших путей (варианты маршрутов).
// Поверх Дейкстры поочерёдно запрещает рёбра уже найденных путей и ищет «ответвления»
// (spur paths); из кандидатов выбирается самый быстрый — он становится следующим вариантом.

import { IGraphEdge, IRouteGraph } from './graph.js';
import { IDijkstraOpts, IDijkstraResult, dijkstra } from './dijkstra.js';

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

/** До k различных маршрутов от fromId к toId в порядке возрастания времени */
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
  const transferPenalty = opts.transferPenalty ?? 0;

  for (let ki = 1; ki < k; ki++) {
    const prevPath = paths[ki - 1]!.edges;

    for (let i = 0; i < prevPath.length; i++) {
      const spurNode = i === 0 ? fromId : prevPath[i - 1]!.to;
      const rootEdges = prevPath.slice(0, i);
      const rootTime = rootEdges.reduce((s, e) => s + e.timeSec + (e.kind === 'transfer' ? transferPenalty : 0), 0);

      // Запрещаем рёбра, которыми уже найденные пути продолжались из spurNode после того же префикса
      const bannedEdges = new Set<string>(opts.bannedEdges ?? []);
      for (const p of paths) {
        const pe = p.edges;
        if (pe.length > i && sameEdgePrefix(pe, rootEdges, i)) {
          const e = pe[i]!;
          bannedEdges.add(`${e.from}-${e.to}-${e.edgeId}`);
        }
      }
      // Запрещаем узлы корневого префикса (кроме spurNode), чтобы не было петель
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
