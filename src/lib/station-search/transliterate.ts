// Транслитерация русский ↔ латиница для неточного поиска станций.
// Основа — проверенный модуль из проекта mcp-jira (src/lib/transliterate.ts).
// Позволяет находить «Ховрино» по запросу "Hovrino" и наоборот.

/** Транслитерация русского текста в латиницу */
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

// Многобуквенные сочетания (длина > 1), по убыванию длины — для корректной замены
const multiChar: string[] = Object.keys(deTranslitMap)
  .filter((k) => k.length > 1)
  .sort((a, b) => b.length - a.length);

/** Обратная транслитерация — из латиницы в кириллицу (детерминированный вариант) */
export const transliterateRU = (text: string): string => {
  let result = text.toLowerCase();

  // Сначала многобуквенные сочетания, по убыванию длины
  for (const combo of multiChar) {
    const ru = deTranslitMap[combo];
    if (ru) {
      result = result.replace(new RegExp(combo, 'g'), ru);
    }
  }

  // Затем однобуквенные замены
  return result
    .split('')
    .map((char) => {
      // Символ уже заменён многобуквенным сочетанием
      if (/[а-яё]/i.test(char)) {
        return char;
      }
      return deTranslitMap[char] ?? char;
    })
    .join('');
};

/**
 * Обратная транслитерация с перебором неоднозначностей: для латинского написания
 * возвращает набор возможных русских вариантов.
 *
 * Пример: enToRuVariants("hovrino") -> ["ховрино", "ховрайно", ...]
 */
export const enToRuVariants = (text: string, maxResults: number = 20): string[] => {
  const s = text.toLowerCase();

  // Соответствия латинских последовательностей наборам русских вариантов
  const map: Record<string, string[]> = {
    // Многобуквенные
    shch: ['щ'],
    sch: ['щ', 'шч'],
    kh: ['х'],
    ts: ['ц'],
    ch: ['ч'],
    sh: ['ш'],
    yo: ['ё', 'йо', 'ио'],
    yu: ['ю', 'йу', 'иу'],
    ya: ['я', 'йа', 'иа'],

    // Однобуквенные (с вариантами)
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

    // Сначала многобуквенные кластеры (самые длинные — первыми)
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
          return; // кластер совпал — не разбиваем его на отдельные буквы
        }
      }
    }

    // Иначе — однобуквенная замена
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
  // Убираем дубликаты, сортируем по длине (короткие — выше)
  const uniq = Array.from(new Set(results));
  uniq.sort((a, b) => a.length - b.length || a.localeCompare(b));
  return uniq;
};
