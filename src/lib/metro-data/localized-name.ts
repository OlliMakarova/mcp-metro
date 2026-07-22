// Picking a display name from ILocalizedName by the requested response language.
//
// The tool's `language` parameter tells which language the user communicates in; station
// and line names in responses are given in that language. The Russian name is the only
// mandatory one in the data, so the fallback chain is: requested language → English → Russian.

import { ILocalizedName } from './types.js';

/** Response language supported by the mos_metro_info tool */
export type TLang = 'en' | 'ru' | 'ar' | 'cn';

/** Coerces the raw `language` tool argument to a supported language (default en) */
export const toLang = (value: unknown): TLang => (value === 'ru' || value === 'ar' || value === 'cn' ? value : 'en');

/** Display name in the requested language with the en → ru fallback chain */
export const pickName = (name: ILocalizedName | undefined, lang: TLang): string => {
  if (!name) {
    return '';
  }
  return name[lang] ?? name.en ?? name.ru;
};
