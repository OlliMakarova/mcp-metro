// Language normalization of text for fuzzy station search.
// Four name languages are supported: Russian, English, Arabic, Chinese.

/** Text language detected by Unicode ranges */
export type TQueryLang = 'ru' | 'en' | 'ar' | 'cn' | 'other';

const RE_CYRILLIC = /[Ѐ-ӿ]/g;
const RE_LATIN = /[A-Za-z]/g;
const RE_ARABIC = /[؀-ۿݐ-ݿ]/g;
const RE_CJK = /[一-鿿㐀-䶿]/g;

/** Detects the predominant alphabet of a string */
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

// Arabic diacritics (tashkil, U+064B..065F, U+0670), tatweel (U+0640) and Quranic marks
const RE_AR_DIACRITICS = new RegExp('[\\u064B-\\u065F\\u0670\\u0640\\u06D6-\\u06ED]', 'g');

/**
 * Arabic text normalization: strip diacritics, unify the alef variants
 * (أ إ آ ٱ → ا), teh marbuta (ة → ه), alef maksura (ى → ي) and hamza on carriers
 * (ؤ → و, ئ → ي). Users type without diacritics and do not distinguish alef forms.
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
 * Common string normalization for comparison:
 *  - Unicode NFKC normalization and lowercasing;
 *  - "ё" → "е" (users almost always type "е");
 *  - for Arabic — normalizeArabic;
 *  - for Chinese — remove spaces (words are not space-separated);
 *  - strip quotes, collapse repeated spaces.
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
