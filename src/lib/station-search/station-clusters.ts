// Кластеры физических станций (пересадочных узлов).
//
// В наборе данных вершина графа — это станция конкретной линии. Один физический
// пересадочный узел («Комсомольская» Сокольнической и Кольцевой линий) — это несколько
// вершин, соединённых рёбрами-переходами (kind='transfer'). Для определения станции по
// названию важно отличать такой единый узел (пользователю не нужно ничего уточнять — это
// одна станция) от разных одноимённых станций, которые переходом НЕ связаны (например,
// «Смоленская» Арбатско-Покровской и Филёвской линий — это две разные станции, между
// которыми пересадки нет, и здесь уточнение необходимо).
//
// Кластеризация выполняется алгоритмом «системы непересекающихся множеств» (union-find):
// все вершины, соединённые цепочкой переходов, попадают в один кластер. Результат
// мемоизируется по идентичности объекта dataset (WeakMap): при суточном обновлении данных
// новый набор автоматически приводит к пересчёту.

import { IMetroDataset } from '../metro-data/types.js';

export interface IStationClusters {
  /** Возвращает идентификатор кластера (корень объединения) для вершины графа */
  clusterOf(stationId: number): number;
}

const buildClusters = (dataset: IMetroDataset): IStationClusters => {
  const parent = new Map<number, number>();

  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Сжатие путей: подвешиваем пройденные вершины прямо к корню для скорости
    let cur = x;
    while (parent.get(cur) !== root) {
      const next = parent.get(cur)!;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };

  for (const s of dataset.stations) {
    parent.set(s.id, s.id);
  }

  for (const e of dataset.edges) {
    if (e.kind !== 'transfer') {
      continue;
    }
    // Ребро может ссылаться на вершину, отсутствующую в схеме, — пропускаем такое
    if (!parent.has(e.fromId) || !parent.has(e.toId)) {
      continue;
    }
    const a = find(e.fromId);
    const b = find(e.toId);
    if (a !== b) {
      parent.set(a, b);
    }
  }

  return {
    clusterOf: (stationId: number): number => (parent.has(stationId) ? find(stationId) : stationId),
  };
};

const clustersCache = new WeakMap<IMetroDataset, IStationClusters>();

/** Кластеры пересадочных узлов для набора данных с мемоизацией */
export const getStationClusters = (dataset: IMetroDataset): IStationClusters => {
  let clusters = clustersCache.get(dataset);
  if (!clusters) {
    clusters = buildClusters(dataset);
    clustersCache.set(dataset, clusters);
  }
  return clusters;
};
