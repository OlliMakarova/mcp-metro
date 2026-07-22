// Алгоритм Дейкстры: кратчайший по времени путь в графе метро.
// Очередь с приоритетами — двоичная куча-минимум. На графе метро (≈450 вершин,
// ≈1200 рёбер) поиск занимает доли миллисекунды.

import { IGraphEdge, IRouteGraph } from './graph.js';

/** Простая двоичная куча-минимум */
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
  /** Штраф в секундах за каждую пересадку (по умолчанию 0 — время перехода уже в графе) */
  transferPenalty?: number;
  /** Станции, через которые идти нельзя (для алгоритма Йена) */
  bannedNodes?: Set<number>;
  /** Ключи рёбер "from-to-edgeId", которые использовать нельзя (для алгоритма Йена) */
  bannedEdges?: Set<string>;
}

export interface IDijkstraResult {
  /** Время пути в секундах (с учётом transferPenalty, если задан) */
  timeSec: number;
  /** Рёбра пути по порядку */
  edges: IGraphEdge[];
}

export const edgeBanKey = (e: IGraphEdge): string => `${e.from}-${e.to}-${e.edgeId}`;

/** Кратчайший по времени путь от fromId к toId, либо null, если пути нет */
export const dijkstra = (
  graph: IRouteGraph,
  fromId: number,
  toId: number,
  opts: IDijkstraOpts = {},
): IDijkstraResult | null => {
  const transferPenalty = opts.transferPenalty ?? 0;
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
      continue; // устаревшая запись в куче
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
      const w = e.timeSec + (e.kind === 'transfer' ? transferPenalty : 0);
      const nd = d + w;
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

  // Восстанавливаем путь по цепочке рёбер
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
