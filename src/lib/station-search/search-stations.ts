// Неточный поиск станций метро по названию на четырёх языках
// (русский, английский, арабский, китайский), устойчивый к опечаткам,
// транслитерации, склейке слов и перестановке слов.
//
// Правила выдачи (из постановки задачи):
//   - максимальная схожесть < порога        → 0 станций;
//   - схожесть >= 1 (точное совпадение)     → только точные совпадения
//     (одноимённые станции разных линий возвращаются все — их различает линия);
//   - иначе                                  → от 2 до N станций по убыванию схожести.

import { IMetroDataset, IMetroLine, IMetroStation } from '../metro-data/types.js';
import { detectLang, normalizeForSearch } from './normalize-lang.js';
import { getSearchIndex } from './search-index.js';
import { phraseSimilarity } from './string-similarity.js';
import { enToRuVariants, transliterateRU } from './transliterate.js';

export interface IStationMatch {
  station: IMetroStation;
  line?: IMetroLine;
  /** Схожесть 0..1 (1 — точное совпадение с одним из вариантов написания) */
  score: number;
}

export interface IFuzzySearchOpts {
  /** Максимум результатов N (по умолчанию 5) */
  limit?: number;
  /** Порог максимальной схожести, ниже которого возвращается пустой список (по умолчанию 0.5) */
  threshold?: number;
}

export const DEFAULT_SEARCH_LIMIT = 5;
export const DEFAULT_SEARCH_THRESHOLD = 0.5;

/** Схожесть считается «точной», если не отличается от 1 больше чем на эпсилон */
const EXACT_EPS = 1e-9;

/**
 * Неточный поиск станций. Возвращает станции по убыванию схожести с запросом.
 * Одноимённые станции разных линий — отдельные записи (различаются полем line).
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

  // Варианты запроса: исходный + для латинского запроса обратные транслитерации
  // в кириллицу («hovrino» → «ховрино» находит станцию как точное совпадение).
  // enToRuVariants перебирает неоднозначности (h/kh → х, e/э, y → й/ы/и).
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
    outer: for (const variant of entry.variants) {
      for (const qv of queryVariants) {
        // Быстрый путь: точное совпадение нормализованных строк
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

  // Правило 1: лучший результат хуже порога — станций не найдено
  if (maxScore < threshold) {
    return [];
  }

  // Правило 2: точное совпадение — возвращаются только точные совпадения
  // (обычно одна станция; одноимённые станции разных линий — все)
  if (maxScore >= 1 - EXACT_EPS) {
    return scored.filter((m) => m.score >= 1 - EXACT_EPS).slice(0, limit);
  }

  // Правило 3: неточное совпадение — от 2 до N кандидатов по убыванию схожести.
  // Возвращаем не меньше двух (даже если выше порога только один): при неточном
  // совпадении пользователю нужны альтернативы для выбора.
  const aboveThreshold = scored.filter((m) => m.score >= threshold).length;
  const count = Math.min(scored.length, Math.max(2, Math.min(aboveThreshold, limit)));
  return scored.slice(0, count);
};
