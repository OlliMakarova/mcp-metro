// Unit tests for the station list that feeds the route widget's «from» / «to» selects.
// Runs against the real mosmetro fixture: an interchange hub must collapse into one entry, while
// same-named stations without a transfer between them must stay separate and be told apart by badges.

import { describe, expect, it } from '@jest/globals';

import { getStationClusters } from '../../src/lib/station-search/station-clusters.js';
import { getWidgetStations } from '../../src/tools/widget/widget-stations.js';
import { getMosmetroDataset, stationIdsByName } from './helpers.js';

const dataset = getMosmetroDataset();

/** All entries of the list whose name matches exactly */
const entriesNamed = (name: string, lang: 'ru' | 'en' = 'ru') =>
  getWidgetStations(dataset, lang).filter((s) => s.name === name);

describe('getWidgetStations', () => {
  it('collapses an interchange hub into a single entry carrying every platform of the hub', () => {
    // «Комсомольская» is one hub: the Sokolnicheskaya and Koltsevaya platforms plus everything else
    // reachable by a transfer inside it (the adjacent MCD platform under its own name).
    const found = entriesNamed('Комсомольская');
    expect(found).toHaveLength(1);
    const entry = found[0]!;
    const clusters = getStationClusters(dataset);
    // Both same-named platforms are in the entry
    for (const id of stationIdsByName(dataset, 'Комсомольская')) {
      expect(entry.ids).toContain(id);
    }
    // The entry is exactly one cluster — no more and no less
    const roots = new Set(entry.ids.map((id) => clusters.clusterOf(id)));
    expect(roots.size).toBe(1);
    const root = [...roots][0]!;
    const whole = dataset.stations.filter((s) => clusters.clusterOf(s.id) === root).map((s) => s.id);
    expect([...entry.ids].sort((a, b) => a - b)).toEqual(whole.sort((a, b) => a - b));
  });

  it('keeps same-named stations without a transfer as separate entries with distinct badges', () => {
    // «Смоленская» of the Arbatsko-Pokrovskaya and Filyovskaya lines — no transfer between them
    const found = entriesNamed('Смоленская');
    expect(found).toHaveLength(2);
    const badges = found.map((s) => s.lines.map((l) => l.badge).join(','));
    expect(badges[0]).not.toBe(badges[1]);
    for (const entry of found) {
      expect(entry.lines.length).toBeGreaterThan(0);
      expect(entry.lines[0]!.color).toMatch(/^#?[0-9a-fA-F]{3,8}$/);
    }
  });

  it('lists every line of a hub once, without repeats', () => {
    for (const entry of getWidgetStations(dataset, 'ru')) {
      const badges = entry.lines.map((l) => `${l.badge ?? ''}|${l.color ?? ''}`);
      expect(new Set(badges).size).toBe(badges.length);
      expect(entry.lines.length).toBeLessThanOrEqual(entry.ids.length);
    }
  });

  it('covers all platforms exactly once across the whole list', () => {
    const list = getWidgetStations(dataset, 'ru');
    const all = list.flatMap((s) => s.ids);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(dataset.stations.length);
  });

  it('is sorted alphabetically for the requested language', () => {
    const names = getWidgetStations(dataset, 'ru').map((s) => s.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b, 'ru'));
    expect(names).toEqual(sorted);
  });

  it('returns names in the requested language', () => {
    const ru = getWidgetStations(dataset, 'ru');
    const en = getWidgetStations(dataset, 'en');
    expect(en.length).toBe(ru.length);
    // The English list must not be a copy of the Russian one
    expect(en.some((s) => /^[A-Za-z]/.test(s.name))).toBe(true);
  });

  it('memoizes per dataset and language — the same array object comes back', () => {
    expect(getWidgetStations(dataset, 'ru')).toBe(getWidgetStations(dataset, 'ru'));
    expect(getWidgetStations(dataset, 'en')).not.toBe(getWidgetStations(dataset, 'ru'));
  });
});
