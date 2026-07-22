// Broad qualitative testing of fuzzy station search: typos, glued and reordered words,
// «ё»/«е», transliteration, four languages (Russian, English, Arabic, Chinese),
// and the "0 / 1 / 2 to N results" output rules.

import { describe, expect, test } from '@jest/globals';
import { fuzzySearchStations } from '../../src/lib/station-search/search-stations.js';
import { detectLang, normalizeArabic, normalizeForSearch } from '../../src/lib/station-search/normalize-lang.js';
import { phraseSimilarity } from '../../src/lib/station-search/string-similarity.js';
import { transliterate, transliterateRU } from '../../src/lib/station-search/transliterate.js';
import { getMetrobookDataset, getMosmetroDataset } from './helpers.js';

const ds = getMosmetroDataset();

/** The expected name must take the first place in the results */
const expectTop = (query: string, expectedRu: string): void => {
  const matches = fuzzySearchStations(ds, query);
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0]!.station.name.ru).toBe(expectedRu);
};

describe('Правила выдачи', () => {
  test('точное совпадение уникального названия → ровно одна станция', () => {
    const matches = fuzzySearchStations(ds, 'Тёплый Стан');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.score).toBe(1);
    expect(matches[0]!.station.name.ru).toBe('Тёплый Стан');
  });

  test('точное совпадение одноимённых станций → все, с указанием линии', () => {
    const matches = fuzzySearchStations(ds, 'Арбатская');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    for (const m of matches) {
      expect(m.score).toBe(1);
      expect(m.station.name.ru).toBe('Арбатская');
      expect(m.line).toBeDefined();
    }
    // The stations belong to different lines
    const lineIds = new Set(matches.map((m) => m.station.lineId));
    expect(lineIds.size).toBe(matches.length);
  });

  test('схожесть ниже порога → пустой список', () => {
    expect(fuzzySearchStations(ds, 'qwerty')).toEqual([]);
    expect(fuzzySearchStations(ds, 'мяу')).toEqual([]);
    expect(fuzzySearchStations(ds, 'zzzzzz')).toEqual([]);
  });

  test('пустой запрос → пустой список', () => {
    expect(fuzzySearchStations(ds, '')).toEqual([]);
    expect(fuzzySearchStations(ds, '   ')).toEqual([]);
  });

  test('неточное совпадение → от 2 до N результатов по убыванию схожести', () => {
    const matches = fuzzySearchStations(ds, 'Ховринно');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches[0]!.station.name.ru).toBe('Ховрино');
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i]!.score).toBeLessThanOrEqual(matches[i - 1]!.score);
    }
  });

  test('минимум два результата, даже если выше порога только один', () => {
    const matches = fuzzySearchStations(ds, 'Teply Stan');
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[0]!.station.name.ru).toBe('Тёплый Стан');
    expect(matches[0]!.score).toBeLessThan(1);
  });

  test('повышенный порог отсекает неточные совпадения', () => {
    expect(fuzzySearchStations(ds, 'Ховринно', { threshold: 0.95 })).toEqual([]);
  });

  test('limit ограничивает выдачу', () => {
    const matches = fuzzySearchStations(ds, 'Ховринно', { limit: 2 });
    expect(matches.length).toBeLessThanOrEqual(2);
  });
});

describe('Русский язык: опечатки и искажения', () => {
  test.each([
    ['Ховринно', 'Ховрино'], // doubled letter
    ['Хаврино', 'Ховрино'], // «а» instead of «о»
    ['Комсомольскя', 'Комсомольская'], // missing letter
    ['Тёплый стант', 'Тёплый Стан'], // extra letter
    ['Кузнецкий мсот', 'Кузнецкий мост'], // adjacent letters swapped
    ['теплый стан', 'Тёплый Стан'], // «е» instead of «ё», lower case
    ['Тропарево', 'Тропарёво'], // «е» instead of «ё»
    ['улицадмитриевского', 'Улица Дмитриевского'], // words glued together
    ['стан теплый', 'Тёплый Стан'], // word order swapped
    ['мост кузнецкий', 'Кузнецкий мост'], // word order swapped
    ['площать революции', 'Площадь Революции'], // «ть» instead of «дь»
  ])('«%s» → %s', (query, expected) => {
    expectTop(query, expected);
  });
});

describe('Английский язык и транслитерация', () => {
  test.each([
    ['Khovrino', 'Ховрино'], // official English name
    ['hovrino', 'Ховрино'], // informal transliteration without «k»
    ['Okhotny Ryad', 'Охотный Ряд'], // official English name
    ['Ohotny Ryad', 'Охотный Ряд'], // simplified spelling
    ['Teply Stan', 'Тёплый Стан'], // without apostrophe and diacritics
    ['Bulvar Rokosovskogo', 'Бульвар Рокоссовского'], // doubled «s» omitted
    ['kuzneckiy most', 'Кузнецкий мост'], // «c» instead of «ts»
  ])('«%s» → %s', (query, expected) => {
    expectTop(query, expected);
  });
});

describe('Арабский язык', () => {
  test('точное название находится', () => {
    expectTop('خوفرينو', 'Ховрино'); // Khovrino
    const exact = fuzzySearchStations(ds, 'خوفرينو');
    expect(exact[0]!.score).toBe(1);
  });

  test('пропущенная буква прощается', () => {
    expectTop('خوفرنو', 'Ховрино'); // the letter ي dropped
  });

  test('нормализация: варианты алефа и та-марбута унифицируются', () => {
    expect(normalizeArabic('أإآٱ')).toBe('اااا');
    expect(normalizeArabic('محطة')).toBe('محطه'); // ة → ه
    // Vowel diacritics (harakat) are removed: مَتْرُو → مترو
    expect(normalizeArabic('مَتْرُو')).toBe('مترو');
  });
});

describe('Китайский язык', () => {
  test('точное название находится', () => {
    expectTop('霍夫林诺', 'Ховрино'); // Khovrino
    const exact = fuzzySearchStations(ds, '霍夫林诺');
    expect(exact[0]!.score).toBe(1);
  });

  test('пропущенный иероглиф прощается', () => {
    expectTop('霍夫林', 'Ховрино');
  });

  test('длинное название с пропуском последнего иероглифа', () => {
    expectTop('罗科索夫斯基林荫', 'Бульвар Рокоссовского');
  });
});

describe('Поиск по скудному набору metrobook', () => {
  const mb = getMetrobookDataset();

  test('русские названия находятся точно и с опечатками', () => {
    const exact = fuzzySearchStations(mb, 'Ховрино');
    expect(exact.length).toBeGreaterThanOrEqual(1);
    expect(exact[0]!.score).toBe(1);

    const typo = fuzzySearchStations(mb, 'Ховринно');
    expect(typo.length).toBeGreaterThanOrEqual(2);
    expect(typo[0]!.station.name.ru).toBe('Ховрино');
  });
});

describe('Вспомогательные функции', () => {
  test('detectLang определяет алфавит', () => {
    expect(detectLang('ховрино')).toBe('ru');
    expect(detectLang('khovrino')).toBe('en');
    expect(detectLang('خوفرينو')).toBe('ar');
    expect(detectLang('霍夫林诺')).toBe('cn');
    expect(detectLang('12345')).toBe('other');
  });

  test('normalizeForSearch: регистр, ё, кавычки, пробелы', () => {
    expect(normalizeForSearch('  Тёплый   Стан  ')).toBe('теплый стан');
    expect(normalizeForSearch('«Ховрино»')).toBe('ховрино');
  });

  test('транслитерация в обе стороны', () => {
    expect(transliterate('ховрино')).toBe('khovrino');
    expect(transliterateRU('khovrino')).toBe('ховрино');
  });

  test('phraseSimilarity: единица только на совпадении, разумные значения на опечатках', () => {
    expect(phraseSimilarity('ховрино', 'ховрино')).toBe(1);
    expect(phraseSimilarity('ховрино', 'ховринно')).toBeGreaterThan(0.8);
    expect(phraseSimilarity('ховрино', 'qwerty')).toBeLessThan(0.3);
  });
});
