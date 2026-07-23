// Fuzzy search of metro stations by name in four languages
// (Russian, English, Arabic, Chinese), tolerant to typos,
// transliteration, joined words and word reordering.
//
// Output rules (from the task statement):
//   - maximum similarity < threshold         → 0 stations;
//   - similarity >= 1 (exact match)          → only exact matches
//     (same-named stations of different lines are all returned — the line tells them apart);
//   - otherwise                              → 2 to N stations in descending similarity.

import { IMetroDataset, IMetroLine, IMetroStation } from '../metro-data/types.js';
import { detectLang, normalizeForSearch } from './normalize-lang.js';
import { getSearchIndex } from './search-index.js';
import { phraseSimilarity } from './string-similarity.js';
import { enToRuVariants, transliterateRU } from './transliterate.js';

export interface IStationMatch {
  station: IMetroStation;
  line?: IMetroLine;
  /** Similarity 0..1 (1 — exact match with one of the spelling variants) */
  score: number;
}

export interface IFuzzySearchOpts {
  /** Maximum number of results N (default 5) */
  limit?: number;
  /** Maximum-similarity threshold below which an empty list is returned (default 0.5) */
  threshold?: number;
}

export const DEFAULT_SEARCH_LIMIT = 5;
export const DEFAULT_SEARCH_THRESHOLD = 0.5;

/** A similarity counts as "exact" if it differs from 1 by no more than epsilon */
const EXACT_EPS = 1e-9;

/**
 * Fuzzy station search. Returns stations in descending order of similarity to the query.
 * Same-named stations of different lines are separate entries (distinguished by the line field).
 */
export const fuzzySearchStations = (
  dataset: IMetroDataset,
  query: string,
  opts: IFuzzySearchOpts = {},
): IStationMatch[] => {
  const limit = Math.max(1, opts.limit ?? DEFAULT_SEARCH_LIMIT);
  const threshold = opts.threshold ?? DEFAULT_SEARCH_THRESHOLD;

  const q = normalizeForSearch(query);
  if (!q) {
    return [];
  }

  // Query variants: the original plus, for a Latin query, reverse transliterations
  // into Cyrillic ("hovrino" → «ховрино» finds the station as an exact match).
  // enToRuVariants enumerates the ambiguities (h/kh → х, e/э, y → й/ы/и).
  const queryVariants = new Set<string>([q]);
  if (detectLang(q) === 'en') {
    const ru = normalizeForSearch(transliterateRU(q));
    if (ru) {
      queryVariants.add(ru);
    }
    for (const v of enToRuVariants(q, 3)) {
      const norm = normalizeForSearch(v);
      if (norm) {
        queryVariants.add(norm);
      }
    }
  }

  const index = getSearchIndex(dataset);
  const scored: IStationMatch[] = [];

  for (const entry of index.entries) {
    let best = 0;
    // Russian case forms are matched only exactly — fuzzy similarity against them is noise
    exact: for (const variant of entry.exactVariants) {
      for (const qv of queryVariants) {
        if (variant === qv) {
          best = 1;
          break exact;
        }
      }
    }
    outer: for (const variant of entry.variants) {
      if (best >= 1) {
        break;
      }
      for (const qv of queryVariants) {
        // Fast path: exact match of normalized strings
        if (variant === qv) {
          best = 1;
          break outer;
        }
        const sim = phraseSimilarity(qv, variant);
        if (sim > best) {
          best = sim;
        }
      }
    }
    if (best > 0) {
      scored.push({
        station: entry.station,
        ...(entry.line ? { line: entry.line } : {}),
        score: best,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.station.name.ru.localeCompare(b.station.name.ru));

  const maxScore = scored[0]?.score ?? 0;

  // Rule 1: the best result is below the threshold — no stations found
  if (maxScore < threshold) {
    return [];
  }

  // Rule 2: exact match — only exact matches are returned
  // (usually one station; same-named stations of different lines — all of them)
  if (maxScore >= 1 - EXACT_EPS) {
    return scored.filter((m) => m.score >= 1 - EXACT_EPS).slice(0, limit);
  }

  // Rule 3: fuzzy match — 2 to N candidates in descending similarity.
  // Return at least two (even if only one is above the threshold): with a fuzzy
  // match the user needs alternatives to choose from.
  const aboveThreshold = scored.filter((m) => m.score >= threshold).length;
  const count = Math.min(scored.length, Math.max(2, Math.min(aboveThreshold, limit)));
  return scored.slice(0, count);
};
