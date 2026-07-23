// Index of station name variants for fuzzy search.
//
// For each station, normalized spelling variants are collected in all available
// languages (Russian, English, Arabic, Chinese) plus transliterations:
//   «Ховрино» → "ховрино", "khovrino" (transliteration), + en "khovrino", + variants
//   of reverse transliteration of the English name into Cyrillic.
// searchAliases also go here — the "second" names of interchange hubs when running
// on metrobook data (see enrichMetrobookFromMosmetroSchema).
//
// The index is memoized by dataset object identity (WeakMap): swapping the dataset
// during the daily refresh automatically triggers an index rebuild.

import { IMetroDataset, IMetroLine, IMetroStation } from '../metro-data/types.js';
import { normalizeForSearch } from './normalize-lang.js';
import { russianCaseVariants } from './russian-declension.js';
import { enToRuVariants, transliterate, transliterateRU } from './transliterate.js';

export interface IStationSearchEntry {
  station: IMetroStation;
  line?: IMetroLine;
  /** Normalized spelling variants of the name (used for both exact and fuzzy matching) */
  variants: string[];
  /**
   * Russian case forms («чеховской», «октябрьского поля») matched ONLY exactly.
   * They are excluded from fuzzy scoring: similarity against declensions adds noise
   * (junk queries start crossing the threshold), while typos in an oblique query are
   * already handled by fuzzy matching against the nominative.
   */
  exactVariants: string[];
}

export interface ISearchIndex {
  entries: IStationSearchEntry[];
}

const buildVariantsForRussian = (ru: string): string[] => {
  const norm = normalizeForSearch(ru);
  if (!norm) {
    return [];
  }
  return [norm, normalizeForSearch(transliterate(norm))];
};

/**
 * Case forms («чеховской», «чеховскую», «октябрьского поля») let queries written in an
 * oblique case match exactly instead of producing a clarification list. Transliteration
 * is not applied — Latin queries virtually always use the base form.
 */
const buildCaseVariantsForRussian = (ru: string): string[] => {
  const norm = normalizeForSearch(ru);
  return norm ? russianCaseVariants(norm) : [];
};

const buildVariantsForEnglish = (en: string): string[] => {
  const norm = normalizeForSearch(en);
  if (!norm) {
    return [];
  }
  return [
    norm,
    // Deterministic reverse transliteration into Cyrillic
    normalizeForSearch(transliterateRU(norm)),
    // Several variants enumerating the ambiguities (e/э, y/й/ы, etc.)
    ...enToRuVariants(norm, 5).map(normalizeForSearch),
  ];
};

export const buildSearchIndex = (dataset: IMetroDataset): ISearchIndex => {
  const lineById = new Map(dataset.lines.map((l) => [l.id, l]));

  const entries: IStationSearchEntry[] = dataset.stations.map((station) => {
    const variants = new Set<string>();
    const exactVariants = new Set<string>();

    for (const v of buildVariantsForRussian(station.name.ru)) {
      variants.add(v);
    }
    for (const v of buildCaseVariantsForRussian(station.name.ru)) {
      exactVariants.add(v);
    }
    if (station.name.en) {
      for (const v of buildVariantsForEnglish(station.name.en)) {
        variants.add(v);
      }
    }
    if (station.name.ar) {
      const norm = normalizeForSearch(station.name.ar);
      if (norm) {
        variants.add(norm);
      }
    }
    if (station.name.cn) {
      const norm = normalizeForSearch(station.name.cn);
      if (norm) {
        variants.add(norm);
      }
    }
    for (const alias of station.searchAliases ?? []) {
      for (const v of buildVariantsForRussian(alias)) {
        variants.add(v);
      }
      for (const v of buildCaseVariantsForRussian(alias)) {
        exactVariants.add(v);
      }
    }
    variants.delete('');
    exactVariants.delete('');
    for (const v of variants) {
      exactVariants.delete(v);
    }

    const line = lineById.get(station.lineId);
    return {
      station,
      ...(line ? { line } : {}),
      variants: [...variants],
      exactVariants: [...exactVariants],
    };
  });

  return { entries };
};

const indexCache = new WeakMap<IMetroDataset, ISearchIndex>();

/** Search index for a dataset, memoized */
export const getSearchIndex = (dataset: IMetroDataset): ISearchIndex => {
  let index = indexCache.get(dataset);
  if (!index) {
    index = buildSearchIndex(dataset);
    indexCache.set(dataset, index);
  }
  return index;
};
