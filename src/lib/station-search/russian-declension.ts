// Heuristic generation of Russian case forms (declensions) of station names for fuzzy search.
//
// Users often write a station name in an oblique case: «до Чеховской», «от Пушкинской»,
// «на Октябрьском поле». The search index used to store only nominative spellings, so such
// queries scored below 1 and produced a clarification list instead of an exact match.
// This module produces genitive/dative/accusative/instrumental/prepositional phrase forms
// of a normalized Russian name; search-index.ts adds them as spelling variants.
//
// The morphology is intentionally heuristic: word endings are mapped by the common declension
// patterns of Russian adjectives and nouns. An occasional incorrectly generated form is
// harmless — it just sits in the index as a variant nobody ever types. What matters is that
// the COMMON real forms are present and give an exact match.
//
// Input is expected to be normalized by normalizeForSearch (lowercase, «ё» → «е»).

type TCase = 'gen' | 'dat' | 'acc' | 'ins' | 'pre';

const CASES: TCase[] = ['gen', 'dat', 'acc', 'ins', 'pre'];

/** Normalized Russian word (search normalization leaves no «ё» and no uppercase) */
const RE_RU_WORD = /^[а-я-]+$/;

/** Stem consonants after which «и» is written instead of «ы» and hard adjective endings are kept */
const VELAR_OR_HUSHING = /[кгхжчшщ]$/;

/** One word in the given case; unknown patterns are returned unchanged */
const declineWord = (w: string, c: TCase): string => {
  // Short words, numbers and non-Russian words stay unchanged
  if (w.length <= 3 || !RE_RU_WORD.test(w)) {
    return w;
  }
  const stem2 = w.slice(0, -2);
  const stem1 = w.slice(0, -1);

  // ── Adjectives ──
  // Feminine: «чеховская» → «чеховской» (gen/dat/ins/pre), «чеховскую» (acc)
  if (w.endsWith('ая')) {
    return c === 'acc' ? `${stem2}ую` : `${stem2}ой`;
  }
  if (w.endsWith('яя')) {
    return c === 'acc' ? `${stem2}юю` : `${stem2}ей`;
  }
  // Neuter: «октябрьское» → «октябрьского», «октябрьскому», «октябрьским», «октябрьском»
  if (w.endsWith('ое')) {
    return { gen: `${stem2}ого`, dat: `${stem2}ому`, acc: w, ins: `${stem2}ым`, pre: `${stem2}ом` }[c];
  }
  if (w.endsWith('ее')) {
    return { gen: `${stem2}его`, dat: `${stem2}ему`, acc: w, ins: `${stem2}им`, pre: `${stem2}ем` }[c];
  }
  // Masculine: «кузнецкий» → «кузнецкого», «речной» → «речного» (inanimate acc = nom)
  if (w.endsWith('ый') || w.endsWith('ой')) {
    return { gen: `${stem2}ого`, dat: `${stem2}ому`, acc: w, ins: `${stem2}ым`, pre: `${stem2}ом` }[c];
  }
  if (w.endsWith('ий')) {
    const hard = VELAR_OR_HUSHING.test(stem2);
    return {
      gen: `${stem2}${hard ? 'ого' : 'его'}`,
      dat: `${stem2}${hard ? 'ому' : 'ему'}`,
      acc: w,
      ins: `${stem2}им`,
      pre: `${stem2}${hard ? 'ом' : 'ем'}`,
    }[c];
  }
  // Plural: «чистые» → «чистых», «чистыми»
  if (w.endsWith('ые')) {
    return { gen: `${stem2}ых`, dat: `${stem2}ым`, acc: w, ins: `${stem2}ыми`, pre: `${stem2}ых` }[c];
  }
  if (w.endsWith('ие')) {
    return { gen: `${stem2}их`, dat: `${stem2}им`, acc: w, ins: `${stem2}ими`, pre: `${stem2}их` }[c];
  }

  // ── Nouns ──
  // Feminine on «-а»: «улица» → «улицы», «улице», «улицу», «улицей»; «застава» → «заставы»
  if (w.endsWith('а')) {
    return {
      gen: `${stem1}${VELAR_OR_HUSHING.test(stem1) ? 'и' : 'ы'}`,
      dat: `${stem1}е`,
      acc: `${stem1}у`,
      ins: `${stem1}ой`,
      pre: `${stem1}е`,
    }[c];
  }
  // Feminine on «-я»: «аллея» → «аллеи», «аллее», «аллею»
  if (w.endsWith('я')) {
    return { gen: `${stem1}и`, dat: `${stem1}е`, acc: `${stem1}ю`, ins: `${stem1}ей`, pre: `${stem1}е` }[c];
  }
  // Feminine on «-ь»: «площадь» → «площади», «площадью»
  if (w.endsWith('ь')) {
    return { gen: `${stem1}и`, dat: `${stem1}и`, acc: w, ins: `${stem1}ью`, pre: `${stem1}и` }[c];
  }
  // Masculine on «-й»: «музей» → «музея», «музею», «музеем»
  if (w.endsWith('й')) {
    return { gen: `${stem1}я`, dat: `${stem1}ю`, acc: w, ins: `${stem1}ем`, pre: `${stem1}е` }[c];
  }
  // Neuter on «-е»: «поле» → «поля», «полю», «полем»
  if (w.endsWith('е')) {
    return { gen: `${stem1}я`, dat: `${stem1}ю`, acc: w, ins: `${stem1}ем`, pre: w }[c];
  }
  // Indeclinable, mostly toponyms on «-о»: «ховрино», «выхино», «динамо»
  if (w.endsWith('о') || w.endsWith('у') || w.endsWith('ю') || w.endsWith('э')) {
    return w;
  }
  // Plural nouns: «пруды» → «прудов», «прудам»; «лужники» → «лужников»; «кузьминки» → «кузьминкам»
  if (w.endsWith('ы')) {
    return { gen: `${stem1}ов`, dat: `${stem1}ам`, acc: w, ins: `${stem1}ами`, pre: `${stem1}ах` }[c];
  }
  if (w.endsWith('и')) {
    return {
      // The genitive of «-ки» plurals is irregular («черемушки» → «черемушек») — skip it;
      // «-ики» is regular: «лужники» → «лужников»
      gen: stem1.endsWith('ик') ? `${stem1}ов` : w,
      dat: `${stem1}ам`,
      acc: w,
      ins: `${stem1}ами`,
      pre: `${stem1}ах`,
    }[c];
  }
  // Consonant ending — masculine noun: «университет» → «университета», «мост» → «моста»
  return { gen: `${w}а`, dat: `${w}у`, acc: w, ins: `${w}ом`, pre: `${w}е` }[c];
};

/**
 * Case forms of a normalized Russian phrase. For every case two kinds of variants are
 * produced: the whole phrase declined («октябрьского поля») and single-word declensions
 * for names whose other words are already oblique or indeclinable («проспекта мира»,
 * «библиотеки имени ленина»). The nominative itself is not included.
 */
export const russianCaseVariants = (phrase: string): string[] => {
  const words = phrase.split(' ');
  const out = new Set<string>();
  for (const c of CASES) {
    const declined = words.map((w) => declineWord(w, c));
    out.add(declined.join(' '));
    if (words.length > 1) {
      for (let i = 0; i < words.length; i++) {
        const mixed = [...words];
        mixed[i] = declined[i]!;
        out.add(mixed.join(' '));
      }
    }
  }
  out.delete(phrase);
  return [...out];
};
