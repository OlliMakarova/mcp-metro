// Pure signing/parsing core of the self-describing widget-data link.
//
// This module is deliberately free of any config (fa-mcp-sdk) dependency: it takes the signing
// secret and base URL as explicit arguments, so it can be unit-tested in isolation. The thin
// config-reading wrappers live in widget-data-link.ts.
//
// The link carries an HMAC signature over `from|to|lang` only. Its purpose is to keep the endpoint
// serving links the tool itself issued (the k-shortest-paths search is not cheap). The signature
// deliberately does NOT cover `at`, so the widget's "Refresh route" button can drop `at` to rebuild
// for "now" without breaking the signature.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { TLang, toLang } from '../../lib/metro-data/localized-name.js';

/** Length (hex chars) the HMAC signature is truncated to in the link */
export const SIG_HEX_LEN = 32;

/** Parameters fully describing how to (re)build the widget's route data */
export interface IWidgetDataParams {
  /** Departure platform ids (cluster platforms) — exactly the ids passed to findBestRoutes */
  fromIds: number[];
  /** Arrival platform ids (cluster platforms) */
  toIds: number[];
  /** Response language */
  lang: TLang;
  /** Moment the route is built for; absent means "now" (the Refresh button path) */
  at?: Date;
}

/** Thrown by parseSignedQuery on malformed input or a signature mismatch (maps to HTTP 400) */
export class WidgetLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WidgetLinkError';
  }
}

/** Canonical string the signature is computed over — the route identity, without the moment `at` */
const canonical = (fromStr: string, toStr: string, lang: string): string => `${fromStr}|${toStr}|${lang}`;

/** HMAC-SHA256 of the canonical string, truncated to SIG_HEX_LEN hex chars */
export const signSig = (secret: string, fromStr: string, toStr: string, lang: string): string =>
  createHmac('sha256', secret)
    .update(canonical(fromStr, toStr, lang))
    .digest('hex')
    .slice(0, SIG_HEX_LEN);

/** Builds the signed widget-data URL from the given base URL and secret */
export const buildSignedUrl = (baseUrl: string, secret: string, params: IWidgetDataParams): string => {
  const fromStr = params.fromIds.join(',');
  const toStr = params.toIds.join(',');
  const search = new URLSearchParams({ from: fromStr, to: toStr, lang: params.lang });
  if (params.at) {
    search.set('at', params.at.toISOString());
  }
  search.set('sig', signSig(secret, fromStr, toStr, params.lang));
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

  const lang = toLang(langStr);
  if (!signaturesMatch(sig, signSig(secret, fromStr, toStr, lang))) {
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

  return { fromIds, toIds, lang, ...(at ? { at } : {}) };
};
