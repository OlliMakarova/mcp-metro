// Station list feeding the route widget's two «from» / «to» selects.
//
// One entry is one interchange hub (a cluster of platforms joined by transfers), not one graph node:
// the user picks «Комсомольская», not «Комсомольская of line 1». The `ids` of an entry are exactly the
// platform ids the routing search expects, so the widget can send them straight back as `from` / `to`.
//
// Same-named stations that are NOT joined by a transfer stay separate entries; the line badges are
// what tells them apart in the dropdown, which is why they are built by the very same widgetLine()
// the route card uses.
//
// The list is memoized per dataset object and language: a metro-data refresh produces a new dataset
// object, so the WeakMap entry is dropped together with it.

import { pickName, TLang } from '../../lib/metro-data/localized-name.js';
import { IMetroDataset, IMetroLine } from '../../lib/metro-data/types.js';
import { ILineInfo } from '../../lib/routing/find-routes.js';
import { getStationClusters } from '../../lib/station-search/station-clusters.js';
import { widgetLine } from './widget-data.js';

/** Line badge of a station entry — the same badge label and color the route card shows */
export interface IWidgetStationLine {
  badge?: string;
  color?: string;
}

/** One selectable station of the widget's dropdowns — an interchange hub as a whole */
export interface IWidgetStation {
  /** Hub name in the requested language, taken from the platform with the smallest id */
  name: string;
  /** All platform ids of the hub — what goes into the `from` / `to` recompute parameters */
  ids: number[];
  /** Badges of every line serving the hub, without repeats */
  lines: IWidgetStationLine[];
}

/** IMetroLine → ILineInfo, the shape widgetLine() (and the whole rendering layer) works with */
const toLineInfo = (line: IMetroLine): ILineInfo => ({
  id: line.id,
  ...(line.name ? { name: line.name } : {}),
  ...(line.color ? { color: line.color } : {}),
  kind: line.kind,
  isMcd: line.kind === 'mcd',
  isMcc: line.kind === 'mcc',
  ...(line.ordering !== undefined ? { ordering: line.ordering } : {}),
});

/** Collation locale of a response language — `cn` is Chinese, whose BCP 47 tag is `zh` */
const COLLATION_LOCALE: Record<TLang, string> = { ru: 'ru', en: 'en', ar: 'ar', cn: 'zh' };

const buildWidgetStations = (dataset: IMetroDataset, lang: TLang): IWidgetStation[] => {
  const clusters = getStationClusters(dataset);
  const lineById = new Map(dataset.lines.map((l) => [l.id, l]));

  // Platform ids grouped by cluster root, each group kept in ascending id order
  const byCluster = new Map<number, number[]>();
  for (const station of [...dataset.stations].sort((a, b) => a.id - b.id)) {
    const root = clusters.clusterOf(station.id);
    const group = byCluster.get(root);
    if (group) {
      group.push(station.id);
    } else {
      byCluster.set(root, [station.id]);
    }
  }

  const stationById = new Map(dataset.stations.map((s) => [s.id, s]));
  const entries: IWidgetStation[] = [];
  for (const ids of byCluster.values()) {
    // The smallest id is the group's first element — its name labels the whole hub
    const head = stationById.get(ids[0]!)!;
    const lines: IWidgetStationLine[] = [];
    const seenLines = new Set<number>();
    for (const id of ids) {
      const station = stationById.get(id)!;
      if (seenLines.has(station.lineId)) {
        continue;
      }
      seenLines.add(station.lineId);
      const line = lineById.get(station.lineId);
      const wl = line ? widgetLine(toLineInfo(line), lang) : undefined;
      if (wl && (wl.badge || wl.color)) {
        lines.push({ ...(wl.badge ? { badge: wl.badge } : {}), ...(wl.color ? { color: wl.color } : {}) });
      }
    }
    entries.push({ name: pickName(head.name, lang), ids, lines });
  }

  const locale = COLLATION_LOCALE[lang];
  entries.sort((a, b) => a.name.localeCompare(b.name, locale));
  return entries;
};

const cache = new WeakMap<IMetroDataset, Map<TLang, IWidgetStation[]>>();

/**
 * Alphabetically sorted hub list of a dataset in the requested language, memoized per
 * dataset + language. The returned array is shared — callers must not mutate it.
 */
export const getWidgetStations = (dataset: IMetroDataset, lang: TLang): IWidgetStation[] => {
  let byLang = cache.get(dataset);
  if (!byLang) {
    byLang = new Map();
    cache.set(dataset, byLang);
  }
  let list = byLang.get(lang);
  if (!list) {
    list = buildWidgetStations(dataset, lang);
    byLang.set(lang, list);
  }
  return list;
};
