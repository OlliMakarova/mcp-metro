#!/usr/bin/env node
/**
 * Generate and inject dev-mode secrets + lenient defaults into a generated
 * MCP project's config/local.yaml (the file that the CLI derived from
 * config/_local.yaml and which overrides default.yaml locally).
 *
 * What this script writes:
 *   webServer.auth.jwtToken.encryptKey   — random UUIDv4
 *   webServer.auth.permanentServerTokens — [<random 32-char hex>]
 *
 * What it writes ONLY when the corresponding CLI flag is provided:
 *   agentTester.openAi.apiKey            — --openai-key <key>
 *   agentTester.openAi.baseURL           — --openai-base-url <url>
 *
 * Lenient dev-time overrides (always written, for easy local testing):
 *   agentTester.enabled: true
 *   agentTester.showFooterLink: true
 *   agentTester.useAuth: false
 *   consul.service.enable: false
 *   webServer.auth.enabled: false
 *   adminPanel.enabled: false
 *
 * Existing values in local.yaml are preserved unless explicitly overridden
 * by the rules above. This uses a minimal deep-merge that only overrides
 * the keys listed; unrelated keys the developer already set are kept.
 *
 * Usage:
 *   node gen-secrets.js <project-root>
 *     [--openai-key <key>] [--openai-base-url <url>]
 *     [--skip-lenient]        # don't write the lenient dev overrides
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';

function getOpt (flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag (flag) {
  return process.argv.includes(flag);
}

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: gen-secrets.js <project-root> [--openai-key K] [--openai-base-url URL] [--skip-lenient]');
  process.exit(1);
}

const openaiKey = getOpt('--openai-key');
const openaiBaseUrl = getOpt('--openai-base-url');
const skipLenient = hasFlag('--skip-lenient');

const localPath = path.resolve(projectRoot, 'config', 'local.yaml');
if (!fs.existsSync(localPath)) {
  console.error(`Not found: ${localPath}. Run fa-mcp first.`);
  process.exit(1);
}

let local = {};
const raw = fs.readFileSync(localPath, 'utf8');
if (raw.trim()) {
  local = yaml.load(raw, { schema: yaml.DEFAULT_SCHEMA }) || {};
}

function set (root, pathArr, value) {
  let o = root;
  for (let i = 0; i < pathArr.length - 1; i++) {
    const k = pathArr[i];
    if (typeof o[k] !== 'object' || o[k] === null) o[k] = {};
    o = o[k];
  }
  o[pathArr[pathArr.length - 1]] = value;
}

const encryptKey = crypto.randomUUID();
const permToken = crypto.randomBytes(16).toString('hex');

set(local, ['webServer', 'auth', 'jwtToken', 'encryptKey'], encryptKey);
set(local, ['webServer', 'auth', 'permanentServerTokens'], [permToken]);

if (openaiKey)     set(local, ['agentTester', 'openAi', 'apiKey'],  openaiKey);
if (openaiBaseUrl) set(local, ['agentTester', 'openAi', 'baseURL'], openaiBaseUrl);

if (!skipLenient) {
  set(local, ['agentTester', 'enabled'],        true);
  set(local, ['agentTester', 'showFooterLink'], true);
  set(local, ['agentTester', 'useAuth'],        false);
  set(local, ['consul', 'service', 'enable'],   false);
  set(local, ['webServer', 'auth', 'enabled'],  false);
  set(local, ['adminPanel', 'enabled'],         false);
}

const out = yaml.dump(local, { lineWidth: 120, quotingType: '"' });
fs.writeFileSync(localPath, out, 'utf8');

const wrote = [
  'webServer.auth.jwtToken.encryptKey',
  'webServer.auth.permanentServerTokens',
];
if (openaiKey)     wrote.push('agentTester.openAi.apiKey');
if (openaiBaseUrl) wrote.push('agentTester.openAi.baseURL');
if (!skipLenient) {
  wrote.push('agentTester.{enabled,showFooterLink,useAuth}', 'consul.service.enable',
    'webServer.auth.enabled', 'adminPanel.enabled');
}

const report = {
  path: localPath,
  encryptKey,
  permanentServerToken: permToken,
  wroteKeys: wrote,
};
process.stdout.write(JSON.stringify(report, null, 2));