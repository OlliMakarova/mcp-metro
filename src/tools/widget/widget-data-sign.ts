// Pure signing/parsing core of the self-describing widget-data link.
//
// This module is deliberately free of any config (fa-mcp-sdk) dependency: it takes the signing
// secret and base URL as explicit arguments, so it can be unit-tested in isolation. The thin
// config-reading wrappers live in widget-data-link.ts.
//
// The link carries an HMAC signature over `from|to|lang` only. Its purpose is to keep the endpoint
// serving links the tool itself issued (the k-shortest-paths search is not cheap). The signature
// deliberately does NOT cover `at`, so the widget's "Refresh route" button can drop `at` to rebuild
// for "now" without breaking the signature. `walk`/`walkFrom` (the user's walk times to the
// departure station and from the arrival station) are likewise outside the signature: they are
// display-only presentation data with no compute cost, and keeping them unsigned lets the Refresh
// path reuse the link untouched.
//
// The same secret also mints the recompute TOKEN the widget uses when the user picks other stations
// in its two station selects. A signed link is bound to one route, so it cannot authorize arbitrary
// from/to pairs; the token is bound to the client IP and a short expiry instead. Its HMAC domain is
// prefixed with `wtok|`, so a token can never be mistaken for a link signature and vice versa.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { TLang, toLang } from '../../lib/metro-data/localized-name.js';
import { TMetroCity } from '../../lib/metro-data/types.js';

/** Length (hex chars) the HMAC signature is truncated to in the link */
export const SIG_HEX_LEN = 32;

/** Lifetime (seconds) of a recompute token issued to the widget — 30 minutes */
export const TOKEN_TTL_SEC = 30 * 60;

/** Upper bound (minutes) accepted for the walk-to-metro time — anything above is malformed input */
export const WALK_MIN_MAX = 600;

/** Parameters fully describing how to (re)build the widget's route data */
export interface IWidgetDataParams {
  /** Departure platform ids (cluster platforms) — exactly the ids passed to findBestRoutes */
  fromIds: number[];
  /** Arrival platform ids (cluster platforms) */
  toIds: number[];
  /** Response language */
  lang: TLang;
  /**
   * City of the metro network the ids belong to; absent means Moscow, and the link omits the field for it.
   * Part of the signature: station ids of the two cities overlap, so a link must never be replayable
   * across cities.
   */
  city?: TMetroCity;
  /** Moment the route is built for; absent means "now" (the Refresh button path) */
  at?: Date;
  /** Walk time (minutes) from the user's origin to the departure station; absent — not mentioned */
  walkToMin?: number;
  /** Walk time (minutes) from the arrival station to the user's destination; absent — not mentioned */
  walkFromMin?: number;
}

/** Thrown by parseSignedQuery on malformed input or a signature mismatch (maps to HTTP 400) */
export class WidgetLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetLinkError';
  }
}

/** Canonical string the signature is computed over — the route identity, without the moment `at` */
const canonical = (fromStr: string, toStr: string, lang: string, city?: TMetroCity): string =>
  `${fromStr}|${toStr}|${lang}|${city ?? 'moscow'}`;

/** HMAC-SHA256 of the canonical string, truncated to SIG_HEX_LEN hex chars */
export const signSig = (secret: string, fromStr: string, toStr: string, lang: string, city?: TMetroCity): string =>
  createHmac('sha256', secret)
    .update(canonical(fromStr, toStr, lang, city))
    .digest('hex')
    .slice(0, SIG_HEX_LEN);

/** Builds the signed widget-data URL from the given base URL and secret */
export const buildSignedUrl = (baseUrl: string, secret: string, params: IWidgetDataParams): string => {
  const fromStr = params.fromIds.join(',');
  const toStr = params.toIds.join(',');
  const search = new URLSearchParams({ from: fromStr, to: toStr, lang: params.lang });
  if (params.city && params.city !== 'moscow') {
    search.set('city', params.city);
  }
  if (params.at) {
    search.set('at', params.at.toISOString());
  }
  if (params.walkToMin !== undefined) {
    search.set('walk', String(params.walkToMin));
  }
  if (params.walkFromMin !== undefined) {
    search.set('walkFrom', String(params.walkFromMin));
  }
  search.set('sig', signSig(secret, fromStr, toStr, params.lang, params.city));
  return `${baseUrl}/api/widget-data?${search.toString()}`;
};

// ─── Parse & verify ────────────────────────────────────────────────────────────

/** First value of an Express query field (arrays may appear when a param is repeated) */
const firstQueryValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }
  return typeof value === 'string' ? value : '';
};

/** Constant-time comparison of two hex signatures of equal length */
const signaturesMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/** Comma-separated non-negative integer ids → number[]; throws WidgetLinkError when malformed */
const parseIds = (raw: string, field: string): number[] => {
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s));
  if (!ids.length || ids.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new WidgetLinkError(`Invalid "${field}" parameter: expected comma-separated station ids.`);
  }
  return ids;
};

/** Optional walk-minutes query field → integer 1..WALK_MIN_MAX; throws WidgetLinkError when malformed */
const parseWalk = (value: unknown, field: string): number | undefined => {
  const raw = firstQueryValue(value);
  if (!raw) {
    return undefined;
  }
  const min = Number(raw);
  if (!Number.isInteger(min) || min < 1 || min > WALK_MIN_MAX) {
    throw new WidgetLinkError(`Invalid "${field}" parameter: expected an integer between 1 and ${WALK_MIN_MAX}.`);
  }
  return min;
};

/**
 * Parses and verifies a widget-data query (Express `req.query`) against `secret`. Returns typed
 * route parameters, or throws WidgetLinkError on missing/invalid parameters or a bad signature.
 * `at` is optional: its absence means "now" and it is intentionally outside the signature.
 */
export const parseSignedQuery = (secret: string, query: Record<string, unknown>): IWidgetDataParams => {
  const fromStr = firstQueryValue(query.from);
  const toStr = firstQueryValue(query.to);
  const langStr = firstQueryValue(query.lang);
  const sig = firstQueryValue(query.sig);

  if (!fromStr || !toStr || !langStr || !sig) {
    throw new WidgetLinkError('Missing required parameters: from, to, lang and sig are all required.');
  }

  const cityStr = firstQueryValue(query.city);
  if (cityStr && cityStr !== 'moscow' && cityStr !== 'spb') {
    throw new WidgetLinkError('Invalid "city" parameter.');
  }
  const city: TMetroCity = cityStr === 'spb' ? 'spb' : 'moscow';

  const lang = toLang(langStr);
  if (!signaturesMatch(sig, signSig(secret, fromStr, toStr, lang, city))) {
    throw new WidgetLinkError('Invalid signature.');
  }

  const fromIds = parseIds(fromStr, 'from');
  const toIds = parseIds(toStr, 'to');

  let at: Date | undefined;
  const atStr = firstQueryValue(query.at);
  if (atStr) {
    at = new Date(atStr);
    if (Number.isNaN(at.getTime())) {
      throw new WidgetLinkError('Invalid "at" parameter: expected an ISO 8601 date-time.');
    }
  }

  const walkToMin = parseWalk(query.walk, 'walk');
  const walkFromMin = parseWalk(query.walkFrom, 'walkFrom');

  return {
    fromIds,
    toIds,
    lang,
    ...(city !== 'moscow' ? { city } : {}),
    ...(at ? { at } : {}),
    ...(walkToMin !== undefined ? { walkToMin } : {}),
    ...(walkFromMin !== undefined ? { walkFromMin } : {}),
  };
};

// ─── Recompute token ───────────────────────────────────────────────────────────

/**
 * Canonical string a recompute token is computed over. The `wtok|` prefix keeps the token domain
 * separate from the link-signature domain, so neither can ever verify as the other.
 */
const tokenCanonical = (ip: string, exp: number): string => `wtok|${ip}|${exp}`;

/**
 * Mints a recompute token `"<exp>.<hmac>"` for a client IP. `exp` is the expiry in unix seconds;
 * the HMAC is truncated to SIG_HEX_LEN hex chars, exactly like a link signature.
 */
const tokenHmac = (secret: string, ip: string, exp: number): string =>
  createHmac('sha256', secret).update(tokenCanonical(ip, exp)).digest('hex').slice(0, SIG_HEX_LEN);

export const signToken = (secret: string, ip: string, exp: number): string => `${exp}.${tokenHmac(secret, ip, exp)}`;

/**
 * Verifies a recompute token against a client IP: the format must be `"<exp>.<hmac>"`, the expiry
 * must not be in the past, and the HMAC must match (constant-time comparison).
 */
export const verifyToken = (
  secret: string,
  ip: string,
  token: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): boolean => {
  const m = /^(\d{1,15})\.([0-9a-f]+)$/.exec(token);
  if (!m) {
    return false;
  }
  const exp = Number(m[1]);
  if (exp < nowSec) {
    return false;
  }
  return signaturesMatch(m[2] ?? '', tokenHmac(secret, ip, exp));
};

/**
 * Parses the query of a token-authorized recompute request: the same route parameters as a signed
 * link, minus the signature and minus `at` (a recompute is always built for "now"). Any `at` in the
 * query is ignored rather than honored, so a token can never be used to probe arbitrary moments.
 */
export const parseTokenQuery = (query: Record<string, unknown>): IWidgetDataParams => {
  const fromStr = firstQueryValue(query.from);
  const toStr = firstQueryValue(query.to);
  const langStr = firstQueryValue(query.lang);

  if (!fromStr || !toStr || !langStr) {
    throw new WidgetLinkError('Missing required parameters: from, to and lang are all required.');
  }

  const cityStr = firstQueryValue(query.city);
  if (cityStr && cityStr !== 'moscow' && cityStr !== 'spb') {
    throw new WidgetLinkError('Invalid "city" parameter.');
  }
  const city: TMetroCity = cityStr === 'spb' ? 'spb' : 'moscow';

  const fromIds = parseIds(fromStr, 'from');
  const toIds = parseIds(toStr, 'to');
  const walkToMin = parseWalk(query.walk, 'walk');
  const walkFromMin = parseWalk(query.walkFrom, 'walkFrom');

  return {
    fromIds,
    toIds,
    lang: toLang(langStr),
    ...(city !== 'moscow' ? { city } : {}),
    ...(walkToMin !== undefined ? { walkToMin } : {}),
    ...(walkFromMin !== undefined ? { walkFromMin } : {}),
  };
};
