// Clusters of physical stations (interchange hubs).
//
// In the dataset a graph node is a station of a specific line. One physical interchange
// hub («Комсомольская» of the Sokolnicheskaya and Koltsevaya lines) is several nodes
// connected by transfer edges (kind='transfer'). To resolve a station by name it matters
// to distinguish such a unified hub (the user has nothing to clarify — it is one station)
// from different same-named stations NOT connected by a transfer (e.g. «Смоленская» of the
// Arbatsko-Pokrovskaya and Filyovskaya lines — two different stations with no transfer
// between them, where clarification is required).
//
// Clustering uses the union-find (disjoint set union) algorithm: all nodes connected
// by a chain of transfers end up in one cluster. The result is memoized by dataset
// object identity (WeakMap): the daily data refresh produces a new dataset object
// and automatically triggers a recompute.

import { IMetroDataset } from '../metro-data/types.js';

export interface IStationClusters {
  /** Returns the cluster id (the union root) for a graph node */
  clusterOf(stationId: number): number;
}

const buildClusters = (dataset: IMetroDataset): IStationClusters => {
  const parent = new Map<number, number>();

  const find = (x: number): number => {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression: re-attach the visited nodes directly to the root for speed
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
    // An edge may reference a node missing from the schema — skip such edges
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

/** Interchange hub clusters for a dataset, memoized */
export const getStationClusters = (dataset: IMetroDataset): IStationClusters => {
  let clusters = clustersCache.get(dataset);
  if (!clusters) {
    clusters = buildClusters(dataset);
    clustersCache.set(dataset, clusters);
  }
  return clusters;
};
