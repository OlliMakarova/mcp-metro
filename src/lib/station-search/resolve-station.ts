// Resolving a station from free-form query text.
//
// The user enters a station name in any of the four languages, with typos or in
// transliteration. The resolver's job is to reduce this to one of three outcomes:
//
//   1. resolved   — exactly one physical station (interchange hub) confidently identified.
//                   Returns the ids of all its platforms (graph nodes), usable as
//                   entry/exit points for route building.
//   2. ambiguous  — several different stations match (different interchange hubs). The user
//                   needs to pick the right one from a list.
//   3. not_found  — no sufficiently similar name found. The input needs clarification.
//
// Same-named platforms of one interchange hub (connected by transfers) are not treated as
// different options — they are one station (see station-clusters.ts). But same-named stations
// of DIFFERENT hubs with no transfer between them ("Смоленская" of the dark-blue and
// light-blue lines) yield the ambiguous outcome.

import { IMetroDataset, TLineKind } from '../metro-data/types.js';
import { fuzzySearchStations, IFuzzySearchOpts } from './search-stations.js';
import { getStationClusters } from './station-clusters.js';

/** A similarity counts as exact if it differs from 1 by no more than epsilon */
const EXACT_EPS = 1e-9;

/** One line present at the option's station */
export interface IResolveLineRef {
  id: number;
  name?: string;
  color?: string;
  kind: TLineKind;
}

/** One station option (one interchange hub) */
export interface IStationOption {
  /** Cluster (interchange hub) identifier */
  clusterId: number;
  /** Display name of the station (in Russian) */
  name: string;
  /** Ids of the hub's platforms among the matches — entry/exit points for a route */
  ids: number[];
  /** Lines the matched hub platforms belong to */
  lines: IResolveLineRef[];
  /** Maximum similarity of the hub's matches to the query (0..1) */
  score: number;
}

export type TStationResolution =
  | { kind: 'resolved'; option: IStationOption }
  | { kind: 'ambiguous'; options: IStationOption[] }
  | { kind: 'not_found' };

/** Maximum number of options shown when the result is ambiguous */
const MAX_OPTIONS = 6;

/**
 * Resolves a station from query text. When ambiguous, returns a list of options
 * (one per interchange hub) in descending order of similarity.
 */
export const resolveStation = (
  dataset: IMetroDataset,
  query: string,
  opts: IFuzzySearchOpts = {},
): TStationResolution => {
  const matches = fuzzySearchStations(dataset, query, { limit: 8, ...opts });
  if (!matches.length) {
    return { kind: 'not_found' };
  }

  // When exact matches exist, consider only them: fuzzy candidates are just typo
  // "noise" and are irrelevant in the presence of an exact hit.
  const exact = matches.filter((m) => m.score >= 1 - EXACT_EPS);
  const candidates = exact.length ? exact : matches;

  const clusters = getStationClusters(dataset);

  // Group candidates by interchange hubs
  const byCluster = new Map<number, IStationOption>();
  for (const m of candidates) {
    const clusterId = clusters.clusterOf(m.station.id);
    let option = byCluster.get(clusterId);
    if (!option) {
      option = { clusterId, name: m.station.name.ru, ids: [], lines: [], score: m.score };
      byCluster.set(clusterId, option);
    }
    option.ids.push(m.station.id);
    option.score = Math.max(option.score, m.score);
    // The representative name comes from the match with the highest similarity
    if (m.score >= option.score) {
      option.name = m.station.name.ru;
    }
    if (m.line && !option.lines.some((l) => l.id === m.line!.id)) {
      option.lines.push({
        id: m.line.id,
        ...(m.line.name?.ru ? { name: m.line.name.ru } : {}),
        ...(m.line.color ? { color: m.line.color } : {}),
        kind: m.line.kind,
      });
    }
  }

  const options = [...byCluster.values()].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  if (options.length === 1) {
    return { kind: 'resolved', option: options[0]! };
  }
  return { kind: 'ambiguous', options: options.slice(0, MAX_OPTIONS) };
};
