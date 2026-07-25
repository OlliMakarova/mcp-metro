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
 *      non-existent station ids and checks 404.
 *
 * Windows note: this uses only ASCII station names, so no CP1251 encoding pitfalls apply here.
 */

import { appConfig, getAuthHeadersForTests } from 'fa-mcp-sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { buildSignedUrl } from '../../dist/src/tools/widget/widget-data-sign.js';

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
  } finally {
    await client.close().catch(() => undefined);
  }

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Test failed:', e?.message || e);
  process.exit(1);
});
