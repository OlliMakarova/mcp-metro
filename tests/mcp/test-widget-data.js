#!/usr/bin/env node

/**
 * End-to-end test of the MCP Apps route widget's data path against a RUNNING HTTP server
 * (start it first with `yarn start`). It:
 *   1. connects as an MCP client that advertises the `io.modelcontextprotocol/ui` extension;
 *   2. calls metro_info (search_route) and checks the response carries a compact
 *      `structuredContent = { widget, dataUrl }` and NOT the full `variants` payload;
 *   3. fetches the dataUrl and checks 200 + JSON with `variants` + open CORS headers;
 *   4. fetches the same link without `at` (the "Refresh route" path) and checks it still works;
 *   5. fetches a link with a tampered signature and checks 400;
 *   6. (only when WIDGET_DATA_SIGN_SECRET matches the server) forges a validly-signed link with
 *      non-existent station ids and checks 404;
 *   7. exercises the station-select path the widget uses: the recompute token every data response
 *      carries, the station list behind it, a recompute for another pair of stations, the strict
 *      one-per-2-seconds limiter and the rejections for a forged, expired or missing token.
 *
 * The token checks pause 2+ seconds between successive recomputes on purpose — the server allows
 * only one token-authorized recompute per 2 seconds per IP, so the run is a few seconds long.
 *
 * Windows note: this uses only ASCII station names, so no CP1251 encoding pitfalls apply here.
 */

import { appConfig, getAuthHeadersForTests } from 'fa-mcp-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { buildSignedUrl, signToken } from '../../dist/src/tools/widget/widget-data-sign.js';
import { ROUTES_WIDGET_URI } from '../../dist/src/tools/widget/widget-resource.js';

const baseURL = (process.env.TEST_MCP_SERVER_URL || `http://localhost:${appConfig.webServer.port}`).replace(/\/+$/, '');
const MCP_URL = `${baseURL}/mcp`;

let passed = 0;
let failed = 0;
const check = (name, cond, details) => {
  if (cond) {
    console.log(`  ✅  ${name}`);
    passed++;
  } else {
    console.log(`  ❌  ${name}`);
    if (details !== undefined) {
      console.log('     ', details);
    }
    failed++;
  }
};

/** Pause between token-authorized recomputes — the server allows only one per 2 seconds per IP */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log('🧪 Widget-data end-to-end test (requires a running HTTP server)');
  console.log('='.repeat(60));

  const headers = await getAuthHeadersForTests();

  // Client that advertises MCP Apps support so the tool returns the { widget, dataUrl } branch.
  const client = new Client(
    { name: 'widget-data-test', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } },
      },
    },
  );

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers },
  });

  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: 'metro_info',
      arguments: {
        first_metro_station: 'Университет',
        second_metro_station: 'Комсомольская',
        action: 'search_route',
        language: 'ru',
      },
    });

    const sc = result?.structuredContent;
    check('search_route returns structuredContent.widget = metro-routes', sc?.widget === 'metro-routes', sc);
    check('structuredContent carries a dataUrl', typeof sc?.dataUrl === 'string', sc?.dataUrl);
    check('structuredContent does NOT carry the full variants payload', sc?.variants === undefined);
    // Widget-capable host receives ONE short text block — the model summary — next to the widget.
    // Its equality with the widget's modelSummary (same source) is checked after the fetch below.
    check(
      'content is exactly one text block (the model summary)',
      Array.isArray(result?.content) &&
        result.content.length === 1 &&
        result.content[0]?.type === 'text' &&
        typeof result.content[0]?.text === 'string' &&
        result.content[0].text.length > 0,
      result?.content,
    );

    const dataUrl = sc?.dataUrl;
    if (typeof dataUrl !== 'string') {
      throw new Error('No dataUrl in the tool response — cannot continue.');
    }

    // 3. Happy path: 200 + variants + CORS
    const r1 = await fetch(dataUrl);
    const j1 = await r1.json().catch(() => null);
    check('GET dataUrl → 200', r1.status === 200, r1.status);
    check('dataUrl JSON has variants[]', Array.isArray(j1?.variants) && j1.variants.length > 0);
    check('dataUrl JSON widget = metro-routes', j1?.widget === 'metro-routes');
    check(
      'dataUrl JSON carries a non-empty modelSummary (for ui/update-model-context)',
      typeof j1?.modelSummary === 'string' && j1.modelSummary.length > 0,
      j1?.modelSummary,
    );
    // Single source: the tool's content text on this turn is byte-for-byte the same summary the
    // widget later pushes via ui/update-model-context (contract point 2).
    check(
      'tool content text equals the widget modelSummary (single source)',
      (result?.content?.[0]?.text ?? null) === (j1?.modelSummary ?? undefined),
      { content: result?.content?.[0]?.text, modelSummary: j1?.modelSummary },
    );
    check(
      'dataUrl response has open CORS header',
      r1.headers.get('access-control-allow-origin') === '*',
      r1.headers.get('access-control-allow-origin'),
    );

    // 4. Refresh path: same link without `at`
    const refreshUrl = (() => {
      const u = new URL(dataUrl);
      u.searchParams.delete('at');
      return u.toString();
    })();
    const r2 = await fetch(refreshUrl);
    const j2 = await r2.json().catch(() => null);
    check('GET dataUrl without at (Refresh) → 200', r2.status === 200, r2.status);
    check('Refresh JSON has variants[]', Array.isArray(j2?.variants) && j2.variants.length > 0);

    // 5. Tampered signature → 400
    const badSigUrl = (() => {
      const u = new URL(dataUrl);
      u.searchParams.set('sig', 'f'.repeat(32));
      return u.toString();
    })();
    const r3 = await fetch(badSigUrl);
    check('GET dataUrl with tampered signature → 400', r3.status === 400, r3.status);

    // 6. Preflight
    const r4 = await fetch(dataUrl, { method: 'OPTIONS' });
    check(
      'OPTIONS preflight → CORS + 204',
      (r4.status === 204 || r4.status === 200) && r4.headers.get('access-control-allow-origin') === '*',
      r4.status,
    );

    // 7. 404 for non-existent stations — only when we know the server secret and can forge a
    // validly-signed link. Otherwise skip (a bad signature would give 400, not 404).
    const secret = process.env.WIDGET_DATA_SIGN_SECRET;
    if (secret) {
      const missingUrl = buildSignedUrl(baseURL, secret, { fromIds: [999999], toIds: [888888], lang: 'en' });
      const r5 = await fetch(missingUrl);
      check('GET validly-signed link with non-existent ids → 404', r5.status === 404, r5.status);
    } else {
      console.log('  ⏭️   404 check skipped (set WIDGET_DATA_SIGN_SECRET to the server secret to enable it)');
    }

    // ── Station-select path: recompute token, station list, recompute, throttling ──

    // 8. Every successful data response carries a fresh recompute token
    const token = j1?.token;
    check(
      'dataUrl JSON carries a recompute token',
      typeof token === 'string' && /^\d+\.[0-9a-f]{32}$/.test(token),
      token,
    );
    if (typeof token !== 'string') {
      throw new Error('No recompute token in the widget-data response — cannot continue.');
    }

    // 9. Station list behind the token
    const stationsUrl = (t) =>
      `${baseURL}/api/widget-stations?lang=ru${t === null ? '' : `&token=${encodeURIComponent(t)}`}`;
    const r6 = await fetch(stationsUrl(token));
    const j6 = await r6.json().catch(() => null);
    check('GET /api/widget-stations with a valid token → 200', r6.status === 200, r6.status);
    check(
      'station list is a non-empty array',
      Array.isArray(j6?.stations) && j6.stations.length > 50,
      j6?.stations?.length,
    );
    check(
      'station entries carry a name, platform ids and line badges',
      j6?.stations?.every(
        (s) => typeof s.name === 'string' && Array.isArray(s.ids) && s.ids.length > 0 && Array.isArray(s.lines),
      ),
    );
    check(
      'station list is sorted alphabetically for the requested language',
      JSON.stringify(j6?.stations?.map((s) => s.name)) ===
        JSON.stringify(j6?.stations?.map((s) => s.name).sort((a, b) => a.localeCompare(b, 'ru'))),
    );

    // 10. Missing / forged token on the station list → 403
    const r7 = await fetch(stationsUrl(null));
    check('GET /api/widget-stations without a token → 403', r7.status === 403, r7.status);
    const r8 = await fetch(stationsUrl(`${Math.floor(Date.now() / 1000) + 600}.${'f'.repeat(32)}`));
    check('GET /api/widget-stations with a forged token → 403', r8.status === 403, r8.status);

    // 11. Recompute for a different pair of stations
    const pick = (name) => j6.stations.find((s) => s.name === name);
    const altFrom = pick('Арбатская') ?? j6.stations[0];
    const altTo = pick('Динамо') ?? j6.stations[j6.stations.length - 1];
    const recomputeUrl = (t, from, to) =>
      `${baseURL}/api/widget-data?from=${from.ids.join(',')}&to=${to.ids.join(',')}&lang=ru&token=${encodeURIComponent(t)}`;

    await sleep(2100);
    const r9 = await fetch(recomputeUrl(token, altFrom, altTo));
    const j9 = await r9.json().catch(() => null);
    check('token recompute for another pair → 200', r9.status === 200, { status: r9.status, body: j9 });
    check(
      'recomputed JSON describes the newly requested stations',
      j9?.from === altFrom.name && j9?.to === altTo.name,
      {
        from: j9?.from,
        to: j9?.to,
      },
    );
    check('recomputed JSON has variants[]', Array.isArray(j9?.variants) && j9.variants.length > 0);
    check('recomputed JSON carries a refreshed token', typeof j9?.token === 'string' && j9.token !== token, j9?.token);

    // 12. An immediate second recompute hits the strict one-per-2-seconds limiter
    const r10 = await fetch(recomputeUrl(j9.token, altTo, altFrom));
    check('immediate second token recompute → 429', r10.status === 429, r10.status);
    check('429 response carries Retry-After', !!r10.headers.get('retry-after'), r10.headers.get('retry-after'));

    // 13. Both ends of one interchange hub → 400
    await sleep(2100);
    const r11 = await fetch(recomputeUrl(j9.token, altFrom, altFrom));
    check('token recompute with the same station on both ends → 400', r11.status === 400, r11.status);

    // 14. Forged and expired tokens are rejected before anything is computed
    await sleep(2100);
    const r12 = await fetch(recomputeUrl(`${Math.floor(Date.now() / 1000) + 600}.${'f'.repeat(32)}`, altFrom, altTo));
    check('token recompute with a forged token → 403', r12.status === 403, r12.status);
    if (secret) {
      const expired = signToken(secret, '::1', Math.floor(Date.now() / 1000) - 60);
      const r13 = await fetch(recomputeUrl(expired, altFrom, altTo));
      check('token recompute with an expired token → 403', r13.status === 403, r13.status);
    } else {
      console.log('  ⏭️   expired-token check skipped (needs WIDGET_DATA_SIGN_SECRET)');
    }

    // 15. Neither sig nor token → 400
    const r14 = await fetch(`${baseURL}/api/widget-data?from=1&to=2&lang=ru`);
    check('widget-data without sig and without token → 400', r14.status === 400, r14.status);

    // ── Widget addresses: the current one AND every earlier one must stay readable ──
    // A host stores the ui:// address in the chat message and re-reads it whenever the card is
    // shown. An address that stops resolving kills every route card already in a user's history.
    const widgetIsServed = async (uri) => {
      try {
        const read = await client.readResource({ uri });
        const item = read?.contents?.[0];
        return typeof item?.text === 'string' && item.text.length > 1000;
      } catch {
        return false;
      }
    };
    check(`widget address ${ROUTES_WIDGET_URI} is readable`, await widgetIsServed(ROUTES_WIDGET_URI));
  } finally {
    await client.close().catch(() => undefined);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
}

// Explicit exit like the sibling transport tests: the streamable-HTTP transport keeps a handle open
// after close(), so without it the process would linger once the checks are done.
main()
  .then(() => {
    process.exit(failed > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error('Test failed:', e?.message || e);
    process.exit(1);
  });
