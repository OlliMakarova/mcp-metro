#!/usr/bin/env node
/**
 * Early-stage sanity check for an OpenAI-compatible LLM endpoint.
 *
 * Runs BEFORE fa-mcp scaffolds the project — so we can't rely on the project's
 * `npm run check-llm` yet. This script calls GET /v1/models against the given
 * baseURL (or https://api.openai.com/v1 by default) with the provided key.
 *
 * Exit codes:
 *   0 — HTTP 2xx received (key looks valid for this endpoint)
 *   1 — HTTP 401/403 (key missing/invalid/insufficient permissions)
 *   2 — transport error (DNS, TCP, TLS, timeout)
 *   3 — unexpected HTTP status (4xx/5xx other than 401/403)
 *
 * Usage:
 *   node check-openai.js --key <apiKey> [--base-url <url>] [--timeout 15000]
 *
 * Examples:
 *   node check-openai.js --key sk-XXXX
 *   node check-openai.js --key sk-XXXX --base-url https://my-proxy.example/v1
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';

function getOpt (flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const key     = getOpt('--key');
const baseUrl = (getOpt('--base-url') || 'https://api.openai.com/v1').replace(/\/$/, '');
const timeout = Number(getOpt('--timeout', '15000'));

if (!key) {
  console.error('ERROR: --key is required.');
  console.error('Usage: check-openai.js --key <apiKey> [--base-url <url>]');
  process.exit(1);
}

const url = `${baseUrl}/models`;
const u   = new URL(url);
const lib = u.protocol === 'http:' ? http : https;

const req = lib.request({
  method: 'GET',
  hostname: u.hostname,
  port: u.port || (u.protocol === 'http:' ? 80 : 443),
  path: u.pathname + u.search,
  headers: {
    'Authorization': `Bearer ${key}`,
    'Accept': 'application/json',
  },
  timeout,
}, (res) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const status = res.statusCode || 0;
    if (status >= 200 && status < 300) {
      console.log(`OK (${status}) — ${url}`);
      process.exit(0);
    }
    if (status === 401 || status === 403) {
      console.error(`FAIL (${status}): key rejected by ${url}`);
      console.error(body.slice(0, 500));
      process.exit(1);
    }
    console.error(`FAIL (${status}): unexpected response from ${url}`);
    console.error(body.slice(0, 500));
    process.exit(3);
  });
});

req.on('error',   (e) => { console.error(`TRANSPORT ERROR: ${e.message}`); process.exit(2); });
req.on('timeout', ()  => { req.destroy(new Error(`timeout after ${timeout}ms`)); });
req.end();