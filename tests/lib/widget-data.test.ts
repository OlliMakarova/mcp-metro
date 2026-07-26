// Unit tests for the pure signing/parsing core of the self-describing widget-data link.
// No HTTP server and no config: the secret and base URL are passed in explicitly. The REST
// behavior (200/400/404, CORS, JSON with variants) is covered by tests/mcp/test-widget-data.js
// against the running server.

import { describe, expect, it } from '@jest/globals';

import { buildSignedUrl, parseSignedQuery, WidgetLinkError } from '../../src/tools/widget/widget-data-sign.js';

const SECRET = 'unit-test-secret';
const BASE = 'https://example.test';

/** Turns a `?a=b&c=d` search string into the plain object Express hands to req.query */
const queryOf = (url: string): Record<string, unknown> => Object.fromEntries(new URL(url).searchParams.entries());

const AT = new Date('2026-07-22T12:00:00+03:00');

describe('widget-data-sign', () => {
  const fromIds = [101, 102];
  const toIds = [203];

  it('round-trips build → parse (with at)', () => {
    const url = buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'ru', at: AT });
    const parsed = parseSignedQuery(SECRET, queryOf(url));
    expect(parsed.fromIds).toEqual(fromIds);
    expect(parsed.toIds).toEqual(toIds);
    expect(parsed.lang).toBe('ru');
    expect(parsed.at?.toISOString()).toBe(AT.toISOString());
  });

  it('builds a URL pointing at the /api/widget-data route with a 32-hex signature', () => {
    const url = buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en' });
    expect(url.startsWith(`${BASE}/api/widget-data?`)).toBe(true);
    const q = queryOf(url);
    expect(typeof q.sig).toBe('string');
    expect((q.sig as string).length).toBe(32);
    expect(q.at).toBeUndefined();
  });

  it('keeps the signature valid after removing at (Refresh button path)', () => {
    const url = buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en', at: AT });
    const u = new URL(url);
    u.searchParams.delete('at');
    const parsed = parseSignedQuery(SECRET, queryOf(u.toString()));
    expect(parsed.at).toBeUndefined();
    expect(parsed.fromIds).toEqual(fromIds);
  });

  it('round-trips the walk-to/from-metro times and omits them when not set', () => {
    const withWalk = parseSignedQuery(
      SECRET,
      queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'ru', walkToMin: 10, walkFromMin: 5 })),
    );
    expect(withWalk.walkToMin).toBe(10);
    expect(withWalk.walkFromMin).toBe(5);
    const without = parseSignedQuery(SECRET, queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'ru' })));
    expect(without.walkToMin).toBeUndefined();
    expect(without.walkFromMin).toBeUndefined();
  });

  it('keeps the signature valid after removing at while walks are present (Refresh with walks)', () => {
    const url = buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en', at: AT, walkToMin: 7, walkFromMin: 4 });
    const u = new URL(url);
    u.searchParams.delete('at');
    const parsed = parseSignedQuery(SECRET, queryOf(u.toString()));
    expect(parsed.at).toBeUndefined();
    expect(parsed.walkToMin).toBe(7);
    expect(parsed.walkFromMin).toBe(4);
  });

  it('rejects malformed walk / walkFrom parameters', () => {
    const q = queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en' }));
    for (const bad of ['abc', '0', '-5', '3.5', '601']) {
      expect(() => parseSignedQuery(SECRET, { ...q, walk: bad })).toThrow(WidgetLinkError);
      expect(() => parseSignedQuery(SECRET, { ...q, walkFrom: bad })).toThrow(WidgetLinkError);
    }
  });

  it('rejects a tampered signature', () => {
    const q = queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en' }));
    q.sig = 'f'.repeat(32);
    expect(() => parseSignedQuery(SECRET, q)).toThrow(WidgetLinkError);
  });

  it('rejects a tampered parameter (from) under the original signature', () => {
    const q = queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en' }));
    q.from = '999';
    expect(() => parseSignedQuery(SECRET, q)).toThrow(WidgetLinkError);
  });

  it('rejects a signature made with a different secret', () => {
    const q = queryOf(buildSignedUrl(BASE, 'other-secret', { fromIds, toIds, lang: 'en' }));
    expect(() => parseSignedQuery(SECRET, q)).toThrow(WidgetLinkError);
  });

  it('rejects missing parameters', () => {
    expect(() => parseSignedQuery(SECRET, { from: '1', to: '2' })).toThrow(WidgetLinkError);
  });

  it('rejects malformed ids', () => {
    const q = queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en' }));
    // Re-sign so the signature is valid but the ids are non-numeric
    const bad = { ...q, from: 'abc' };
    expect(() => parseSignedQuery(SECRET, bad)).toThrow(WidgetLinkError);
  });

  it('rejects a malformed at', () => {
    const q = queryOf(buildSignedUrl(BASE, SECRET, { fromIds, toIds, lang: 'en' }));
    q.at = 'not-a-date';
    expect(() => parseSignedQuery(SECRET, q)).toThrow(WidgetLinkError);
  });
});
