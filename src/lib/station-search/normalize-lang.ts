// Языковая нормализация текста для неточного поиска по станциям.
// Поддерживаются четыре языка названий: русский, английский, арабский, китайский.

/** Язык текста, определённый по диапазонам Юникода */
export type TQueryLang = 'ru' | 'en' | 'ar' | 'cn' | 'other';

const RE_CYRILLIC = /[Ѐ-ӿ]/g;
const RE_LATIN = /[A-Za-z]/g;
const RE_ARABIC = /[؀-ۿݐ-ݿ]/g;
const RE_CJK = /[一-鿿㐀-䶿]/g;

/** Определяет преобладающий алфавит строки */
export const detectLang = (text: string): TQueryLang => {
  const counts: Array<[TQueryLang, number]> = [
    ['ru', (text.match(RE_CYRILLIC) ?? []).length],
    ['en', (text.match(RE_LATIN) ?? []).length],
    ['ar', (text.match(RE_ARABIC) ?? []).length],
    ['cn', (text.match(RE_CJK) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  const top = counts[0]!;
  return top[1] > 0 ? top[0] : 'other';
};

// Арабские огласовки (ташкиль, U+064B..065F, U+0670), татвил (U+0640) и коранические знаки
const RE_AR_DIACRITICS = new RegExp('[\\u064B-\\u065F\\u0670\\u0640\\u06D6-\\u06ED]', 'g');

/**
 * Нормализация арабского текста: удаление огласовок, унификация вариантов алефа
 * (أ إ آ ٱ → ا), та-марбуты (ة → ه), алефа максуры (ى → ي) и хамзы на подставках
 * (ؤ → و, ئ → ي). Пользователи набирают текст без огласовок и не различают формы алефа.
 */
export const normalizeArabic = (text: string): string =>
  text
    .replace(RE_AR_DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ → ا
    .replace(/ة/g, 'ه') // ة → ه
    .replace(/ى/g, 'ي') // ى → ي
    .replace(/ؤ/g, 'و') // ؤ → و
    .replace(/ئ/g, 'ي'); // ئ → ي

/**
 * Общая нормализация строки для сравнения:
 *  - NFKC-нормализация Юникода и нижний регистр;
 *  - «ё» → «е» (пользователи почти всегда пишут «е»);
 *  - для арабского — normalizeArabic;
 *  - для китайского — удаление пробелов (слова не разделяются пробелами);
 *  - удаление кавычек, схлопывание повторных пробелов.
 */
export const normalizeForSearch = (text: string): string => {
  let s = text.normalize('NFKC').toLowerCase().trim();
  s = s.replace(/ё/g, 'е');
  s = normalizeArabic(s);
  s = s.replace(/["'«»„“”‘’`]/g, '');
  s = s.replace(/\s+/g, ' ');
  if (detectLang(s) === 'cn') {
    s = s.replace(/\s+/g, '');
  }
  return s;
};
