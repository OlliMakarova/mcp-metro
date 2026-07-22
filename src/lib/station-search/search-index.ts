// Индекс вариантов названий станций для неточного поиска.
//
// Для каждой станции собираются нормализованные варианты написания на всех доступных
// языках (русский, английский, арабский, китайский) плюс транслитерации:
//   «Ховрино» → "ховрино", "khovrino" (транслит), + en "khovrino", + варианты
//   обратной транслитерации английского названия в кириллицу.
// Сюда же попадают searchAliases — «вторые» имена пересадочных узлов при работе
// от metrobook (см. enrichMetrobookFromMosmetroSchema).
//
// Индекс мемоизируется по идентичности объекта dataset (WeakMap): смена набора данных
// при суточном обновлении автоматически приводит к перестроению индекса.

import { IMetroDataset, IMetroLine, IMetroStation } from '../metro-data/types.js';
import { normalizeForSearch } from './normalize-lang.js';
import { enToRuVariants, transliterate, transliterateRU } from './transliterate.js';

export interface IStationSearchEntry {
  station: IMetroStation;
  line?: IMetroLine;
  /** Нормализованные варианты написания названия */
  variants: string[];
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

const buildVariantsForEnglish = (en: string): string[] => {
  const norm = normalizeForSearch(en);
  if (!norm) {
    return [];
  }
  return [
    norm,
    // Детерминированная обратная транслитерация в кириллицу
    normalizeForSearch(transliterateRU(norm)),
    // Несколько вариантов с перебором неоднозначностей (e/э, y/й/ы и т. п.)
    ...enToRuVariants(norm, 5).map(normalizeForSearch),
  ];
};

export const buildSearchIndex = (dataset: IMetroDataset): ISearchIndex => {
  const lineById = new Map(dataset.lines.map((l) => [l.id, l]));

  const entries: IStationSearchEntry[] = dataset.stations.map((station) => {
    const variants = new Set<string>();

    for (const v of buildVariantsForRussian(station.name.ru)) {
      variants.add(v);
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
    }
    variants.delete('');

    const line = lineById.get(station.lineId);
    return {
      station,
      ...(line ? { line } : {}),
      variants: [...variants],
    };
  });

  return { entries };
};

const indexCache = new WeakMap<IMetroDataset, ISearchIndex>();

/** Индекс поиска для набора данных с мемоизацией */
export const getSearchIndex = (dataset: IMetroDataset): ISearchIndex => {
  let index = indexCache.get(dataset);
  if (!index) {
    index = buildSearchIndex(dataset);
    indexCache.set(dataset, index);
  }
  return index;
};
