// Russian ↔ Latin transliteration for fuzzy station search.
// Based on the proven module from the mcp-jira project (src/lib/transliterate.ts).
// Lets «Ховрино» be found by the query "Hovrino" and vice versa.

/** Transliteration of Russian text into Latin */
export const transliterate = (text: string): string => {
  // noinspection NonAsciiCharacters
  const translitMap: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'yo',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'kh',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'shch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
    ' ': ' ',
  };

  return text
    .toLowerCase()
    .split('')
    .map((char) => translitMap[char] ?? char)
    .join('');
};

// noinspection NonAsciiCharacters
const deTranslitMap: Record<string, string> = {
  a: 'а',
  b: 'б',
  v: 'в',
  g: 'г',
  d: 'д',
  e: 'е',
  yo: 'ё',
  zh: 'ж',
  z: 'з',
  i: 'и',
  y: 'й',
  k: 'к',
  l: 'л',
  m: 'м',
  n: 'н',
  o: 'о',
  p: 'п',
  r: 'р',
  s: 'с',
  t: 'т',
  u: 'у',
  f: 'ф',
  kh: 'х',
  ts: 'ц',
  ch: 'ч',
  sh: 'ш',
  shch: 'щ',
  yu: 'ю',
  ya: 'я',
  ' ': ' ',
};

// Multi-letter combinations (length > 1), sorted by descending length — for correct replacement
const multiChar: string[] = Object.keys(deTranslitMap)
  .filter((k) => k.length > 1)
  .sort((a, b) => b.length - a.length);

/** Reverse transliteration — from Latin to Cyrillic (deterministic variant) */
export const transliterateRU = (text: string): string => {
  let result = text.toLowerCase();

  // Multi-letter combinations first, by descending length
  for (const combo of multiChar) {
    const ru = deTranslitMap[combo];
    if (ru) {
      result = result.replace(new RegExp(combo, 'g'), ru);
    }
  }

  // Then single-letter replacements
  return result
    .split('')
    .map((char) => {
      // The character has already been replaced by a multi-letter combination
      if (/[а-яё]/i.test(char)) {
        return char;
      }
      return deTranslitMap[char] ?? char;
    })
    .join('');
};

/**
 * Reverse transliteration enumerating the ambiguities: for a Latin spelling
 * returns a set of possible Russian variants.
 *
 * Example: enToRuVariants("hovrino") -> ["ховрино", "ховрайно", ...]
 */
export const enToRuVariants = (text: string, maxResults: number = 20): string[] => {
  const s = text.toLowerCase();

  // Mapping of Latin sequences to sets of Russian variants
  const map: Record<string, string[]> = {
    // Multi-letter
    shch: ['щ'],
    sch: ['щ', 'шч'],
    kh: ['х'],
    ts: ['ц'],
    ch: ['ч'],
    sh: ['ш'],
    yo: ['ё', 'йо', 'ио'],
    yu: ['ю', 'йу', 'иу'],
    ya: ['я', 'йа', 'иа'],

    // Single-letter (with variants)
    a: ['а'],
    b: ['б'],
    v: ['в'],
    g: ['г'],
    d: ['д'],
    e: ['е', 'э'],
    z: ['з'],
    i: ['и', 'ай', 'й'],
    y: ['й', 'ы', 'и'],
    k: ['к'],
    l: ['л'],
    m: ['м'],
    n: ['н'],
    o: ['о'],
    p: ['п'],
    r: ['р'],
    s: ['с'],
    t: ['т'],
    u: ['у', 'ю'],
    f: ['ф'],
    h: ['х'],
    c: ['к', 'с'],
    j: ['дж', 'ж', 'й'],
    q: ['к'],
    w: ['в', 'у'],
    x: ['кс', 'з'],
    ' ': [' '],
    '-': ['-'],
    _: ['_'],
  };

  const results: string[] = [];

  const backtrack = (idx: number, acc: string): void => {
    if (results.length >= maxResults) {
      return;
    }
    if (idx >= s.length) {
      results.push(acc);
      return;
    }

    // Multi-letter clusters first (longest first)
    for (const cluster of multiChar) {
      if (s.startsWith(cluster, idx)) {
        const variants = map[cluster];
        if (variants) {
          for (const v of variants) {
            backtrack(idx + cluster.length, acc + v);
            if (results.length >= maxResults) {
              return;
            }
          }
          return; // the cluster matched — do not split it into individual letters
        }
      }
    }

    // Otherwise — a single-letter replacement
    const ch = s[idx];
    const variants = (ch && map[ch]) || [ch ?? ''];
    for (const v of variants) {
      backtrack(idx + 1, acc + v);
      if (results.length >= maxResults) {
        return;
      }
    }
  };

  backtrack(0, '');
  // Remove duplicates, sort by length (shorter first)
  const uniq = Array.from(new Set(results));
  uniq.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return uniq;
};
