// Метрика схожести коротких слов и фраз: опечатки, слитное/раздельное написание,
// штраф за перестановку слов. Основа — проверенный модуль из проекта mcp-jira
// (src/lib/string-similarity.ts), адаптированный под ESM без самозапуска.
//
// Расстояние OSA (Optimal String Alignment) — редакционное расстояние Левенштейна,
// дополненное перестановкой соседних символов («тчк» ~ «тчк»), что хорошо ловит
// типичные опечатки. Токенная метрика (взвешенная LCS) учитывает порядок слов.

type Cache<T> = Map<string, T>;

const WORD_RE = /[\p{L}\p{N}_]+/gu; // буквы/цифры/подчёркивание любого алфавита
const COMBINING_MARKS = /\p{M}/gu; // диакритика (удаляется после NFKD)

/** Верхняя граница размера кешей расстояний — защита от неограниченного роста на потоке запросов */
const CACHE_LIMIT = 100_000;

function stripAccents(s: string): string {
  return s.normalize('NFKD').replace(COMBINING_MARKS, '');
}

function normalize(s: string): { tokens: string[]; compact: string } {
  const lower = stripAccents(s).toLowerCase();
  const tokens = lower.match(WORD_RE) ?? [];
  const compact = tokens.join('');
  return { tokens, compact };
}

// ---- Расстояние OSA (Optimal String Alignment) ----

const osaCache: Cache<number> = new Map();

function osaDistance(a: string, b: string): number {
  const key = `${a}${b}`;
  const hit = osaCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  if (osaCache.size > CACHE_LIMIT) {
    osaCache.clear();
  }

  const n = a.length;
  const m = b.length;
  if (n === 0) {
    osaCache.set(key, m);
    return m;
  }
  if (m === 0) {
    osaCache.set(key, n);
    return n;
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);
  for (let i = 0; i <= n; i++) {
    dp[i]![0] = i;
  }
  for (let j = 0; j <= m; j++) {
    dp[0]![j] = j;
  }

  for (let i = 1; i <= n; i++) {
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const bj = b.charCodeAt(j - 1);
      const cost = ai === bj ? 0 : 1;
      let best = Math.min(
        dp[i - 1]![j]! + 1, // удаление
        dp[i]![j - 1]! + 1, // вставка
        dp[i - 1]![j - 1]! + cost, // замена
      );
      // перестановка соседних символов
      if (
        i > 1 &&
        j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        best = Math.min(best, dp[i - 2]![j - 2]! + 1);
      }
      dp[i]![j] = best;
    }
  }

  const result = dp[n]![m]!;
  osaCache.set(key, result);
  return result;
}

const charSimCache: Cache<number> = new Map();

function charSimilarity(a: string, b: string): number {
  if (!a && !b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }
  const key = `${a}${b}`;
  const hit = charSimCache.get(key);
  if (hit !== undefined) {
    return hit;
  }
  if (charSimCache.size > CACHE_LIMIT) {
    charSimCache.clear();
  }

  const d = osaDistance(a, b);
  const sim = Math.max(0, 1 - d / Math.max(a.length, b.length));
  charSimCache.set(key, sim);
  return sim;
}

// ---- Токенное выравнивание с учётом порядка (взвешенная LCS) ----

function tokenSimilarity(tokensA: string[], tokensB: string[]): number {
  const n = tokensA.length;
  const m = tokensB.length;
  if (n === 0 && m === 0) {
    return 1;
  }
  if (n === 0 || m === 0) {
    return 0;
  }

  // предвычисляем попарные схожести токенов
  const sim: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: m }, (__, j) => charSimilarity(tokensA[i]!, tokensB[j]!)),
  );

  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]! + sim[i - 1]![j - 1]!);
    }
  }
  const best = dp[n]![m]!;
  return best / Math.max(n, m); // нормировка: штраф за пропуски и перестановки
}

// ---- Сравнение «мешка слов» (порядок не важен) ----

/**
 * Жадное сопоставление токенов без учёта порядка: для каждого токена первой фразы
 * подбирается самый похожий свободный токен второй. Ловит перестановку слов
 * («стан тёплый» ~ «тёплый стан»), которую токенная LCS-метрика штрафует до нуля.
 */
function tokenBagSimilarity(tokensA: string[], tokensB: string[]): number {
  const n = tokensA.length;
  const m = tokensB.length;
  if (n === 0 && m === 0) {
    return 1;
  }
  if (n === 0 || m === 0) {
    return 0;
  }
  const used: boolean[] = Array.from({ length: m }, () => false);
  let total = 0;
  for (let i = 0; i < n; i++) {
    let bestJ = -1;
    let bestSim = 0;
    for (let j = 0; j < m; j++) {
      if (used[j]) {
        continue;
      }
      const s = charSimilarity(tokensA[i]!, tokensB[j]!);
      if (s > bestSim) {
        bestSim = s;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      used[bestJ] = true;
      total += bestSim;
    }
  }
  return total / Math.max(n, m);
}

// ---- Комбинированная метрика ----

/** Множитель-штраф за совпадение только с перестановкой слов */
const BAG_PENALTY = 0.85;

/**
 * Схожесть двух фраз в диапазоне 0..1 (1 — совпадение с точностью до регистра,
 * пробелов и диакритики). Слитное сравнение ловит опечатки и склейку слов,
 * токенное — наказывает перестановку слов, «мешок слов» — страхует от нулевой
 * оценки при полной перестановке (со штрафом BAG_PENALTY).
 */
export function phraseSimilarity(a: string, b: string): number {
  const { tokens: ta, compact: ca } = normalize(a);
  const { tokens: tb, compact: cb } = normalize(b);

  const simChar = charSimilarity(ca, cb); // слитное сравнение
  const simTok = tokenSimilarity(ta, tb); // порядок слов важен
  const simBag = tokenBagSimilarity(ta, tb); // порядок слов не важен, но со штрафом

  // взвешенная комбинация + «страховка» от псевдосовпадения токенов
  const combo = 0.6 * simChar + 0.4 * simTok;
  return Math.max(combo, simChar * 0.9, simBag * BAG_PENALTY);
}

export function isClose(a: string, b: string, threshold = 0.72): boolean {
  return phraseSimilarity(a, b) >= threshold;
}
