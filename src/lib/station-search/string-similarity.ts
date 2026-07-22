// Similarity metric for short words and phrases: typos, joined/split spelling,
// penalty for word reordering. Based on the proven module from the mcp-jira project
// (src/lib/string-similarity.ts), adapted for ESM without self-execution.
//
// OSA (Optimal String Alignment) distance is the Levenshtein edit distance extended
// with transposition of adjacent characters, which catches typical typos well.
// The token metric (weighted LCS) takes word order into account.

type Cache<T> = Map<string, T>;

const WORD_RE = /[\p{L}\p{N}_]+/gu; // letters/digits/underscore of any alphabet
const COMBINING_MARKS = /\p{M}/gu; // diacritics (removed after NFKD)

/** Upper bound on the distance cache sizes — guards against unbounded growth under a request stream */
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

// ---- OSA (Optimal String Alignment) distance ----

const osaCache: Cache<number> = new Map();

function osaDistance(a: string, b: string): number {
  const key = `${a}${b}`;
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
        dp[i - 1]![j]! + 1, // deletion
        dp[i]![j - 1]! + 1, // insertion
        dp[i - 1]![j - 1]! + cost, // substitution
      );
      // transposition of adjacent characters
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
  const key = `${a}${b}`;
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

// ---- Order-aware token alignment (weighted LCS) ----

function tokenSimilarity(tokensA: string[], tokensB: string[]): number {
  const n = tokensA.length;
  const m = tokensB.length;
  if (n === 0 && m === 0) {
    return 1;
  }
  if (n === 0 || m === 0) {
    return 0;
  }

  // precompute pairwise token similarities
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
  return best / Math.max(n, m); // normalization: penalizes gaps and reorderings
}

// ---- Bag-of-words comparison (order does not matter) ----

/**
 * Greedy order-independent token matching: for each token of the first phrase the most
 * similar free token of the second is picked. Catches word reordering
 * («стан тёплый» ~ «тёплый стан»), which the token LCS metric penalizes down to zero.
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

// ---- Combined metric ----

/** Penalty multiplier for matching only up to word reordering */
const BAG_PENALTY = 0.85;

/**
 * Similarity of two phrases in the 0..1 range (1 — match up to case,
 * spaces and diacritics). The joined comparison catches typos and word joining,
 * the token one penalizes word reordering, and the bag-of-words one insures
 * against a zero score on full reordering (with the BAG_PENALTY penalty).
 */
export function phraseSimilarity(a: string, b: string): number {
  const { tokens: ta, compact: ca } = normalize(a);
  const { tokens: tb, compact: cb } = normalize(b);

  const simChar = charSimilarity(ca, cb); // joined comparison
  const simTok = tokenSimilarity(ta, tb); // word order matters
  const simBag = tokenBagSimilarity(ta, tb); // word order ignored, but penalized

  // weighted combination + "insurance" against pseudo-matching of tokens
  const combo = 0.6 * simChar + 0.4 * simTok;
  return Math.max(combo, simChar * 0.9, simBag * BAG_PENALTY);
}

export function isClose(a: string, b: string, threshold = 0.72): boolean {
  return phraseSimilarity(a, b) >= threshold;
}
