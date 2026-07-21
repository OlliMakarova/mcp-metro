#!/usr/bin/env node
/**
 * Generate JWT token for MCP server authentication.
 *
 * Usage:
 *   node scripts/generate-jwt.js -u <username> -ttl <duration> [-s <service>] [-p <params>] [--key <path>]
 *
 * Options:
 *   -u,   --username       Username (required). ENV: JWT_PAYLOAD_USERNAME
 *   -ttl                   Token lifetime: <N>s | <N>m | <N>d | <N>y (required). ENV: JWT_TTL
 *   -s,   --service-name   Service name (optional). ENV: JWT_PAYLOAD_SERVICE_NAME
 *   -p,   --params         Extra payload "key=value;key=value" (optional). ENV: JWT_PAYLOAD_PARAMS
 *   --key                  Override private key path (only meaningful in modes embedded/localKey)
 *
 * Behavior by jwtToken.mode:
 *   - legacyAesCtr: HS256 with encryptKey (legacy behavior).
 *   - embedded:     ES256/RS256 with keys from keyStoragePath (private.pem).
 *   - localKey:     ES256/RS256 with privateKeyPath (must be configured or passed via --key).
 *   - remoteJwks:   exits with error — tokens must be obtained from the external IdP.
 */

import crypto from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import configModule from 'config';

// ── CLI argument parsing ────────────────────────────────────────────

function getArg(shortFlag, longFlag) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === shortFlag || args[i] === longFlag) {
      return args[i + 1] || '';
    }
  }
  return undefined;
}

const username = getArg('-u', '--username') ?? process.env.JWT_PAYLOAD_USERNAME;
const ttlRaw = getArg('-ttl', '-ttl') ?? process.env.JWT_TTL;
const service = getArg('-s', '--service-name') ?? process.env.JWT_PAYLOAD_SERVICE_NAME;
const paramsRaw = getArg('-p', '--params') ?? process.env.JWT_PAYLOAD_PARAMS;
const keyOverride = getArg('--key', '--private-key');

// ── Validation ──────────────────────────────────────────────────────

if (!username || !username.trim()) {
  console.error('Error: username is required (-u / --username or ENV JWT_PAYLOAD_USERNAME)');
  process.exit(1);
}

if (!ttlRaw || !ttlRaw.trim()) {
  console.error('Error: TTL is required (-ttl or ENV JWT_TTL). Format: <N>s | <N>m | <N>d | <N>y');
  process.exit(1);
}

const ttlMatch = /^(\d+)([smdy])$/.exec(ttlRaw.trim());
if (!ttlMatch) {
  console.error(`Error: invalid TTL format "${ttlRaw}". Expected: <N>s | <N>m | <N>d | <N>y`);
  process.exit(1);
}

const ttlValue = parseInt(ttlMatch[1], 10);
const ttlUnit = ttlMatch[2];

if (ttlValue <= 0) {
  console.error('Error: TTL value must be greater than 0');
  process.exit(1);
}

const TTL_MULTIPLIERS = { s: 1, m: 60, d: 86400, y: 31536000 };
const liveTimeSec = ttlValue * TTL_MULTIPLIERS[ttlUnit];

// ── Resolve mode + config ───────────────────────────────────────────

function getOpt(path) {
  try {
    return configModule.get(path);
  } catch {
    return undefined;
  }
}

const mode = (getOpt('webServer.auth.jwtToken.mode') || 'legacyAesCtr').toString();
const algorithm = (getOpt('webServer.auth.jwtToken.algorithm') || 'ES256').toString();
const configuredIssuer = String(getOpt('webServer.auth.jwtToken.issuer') || '').trim();
const expectedIssuer = String(getOpt('webServer.auth.jwtToken.expectedIssuer') || '').trim();
const expectedAudience = String(getOpt('webServer.auth.jwtToken.expectedAudience') || '').trim();
const keyStoragePath = String(getOpt('webServer.auth.jwtToken.keyStoragePath') || './keys');
const configuredPrivateKey = String(getOpt('webServer.auth.jwtToken.privateKeyPath') || '');

if (mode === 'remoteJwks') {
  const jwksUri = String(getOpt('webServer.auth.jwtToken.jwksUri') || '');
  console.error(
    'Error: this server runs in mode=remoteJwks and does not issue tokens.\n' +
      `Obtain a token from the IdP${jwksUri ? ` at ${jwksUri}` : ''}.`,
  );
  process.exit(1);
}

// ── Auto-detect service name if checkMCPName is enabled ─────────────

let effectiveService = service;

if (!effectiveService || !effectiveService.trim()) {
  const checkMCPName = getOpt('webServer.auth.jwtToken.checkMCPName');
  if (checkMCPName) {
    if (process.env.SERVICE_NAME && process.env.SERVICE_NAME.trim()) {
      effectiveService = process.env.SERVICE_NAME.trim();
    } else {
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const pkgPath = resolve(__dirname, '..', 'package.json');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
        if (pkg.name) {
          effectiveService = pkg.name;
        }
      } catch {
        // package.json not found or unreadable
      }
    }
  }
}

if (!effectiveService && expectedAudience) {
  effectiveService = expectedAudience;
}

// ── Build private claims ────────────────────────────────────────────

const privateClaims = {};
if (paramsRaw && paramsRaw.trim()) {
  const pairs = paramsRaw.trim().split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) {
      console.error(`Error: invalid param format "${pair}". Expected "key=value"`);
      process.exit(1);
    }
    const key = pair.substring(0, eqIdx).trim();
    const value = pair.substring(eqIdx + 1).trim();
    if (!key) {
      console.error(`Error: empty key in param "${pair}"`);
      process.exit(1);
    }
    if (['user', 'expire', 'iat', 'service', 'sub', 'aud', 'exp', 'iss', 'jti', 'nbf'].includes(key)) {
      continue;
    }
    privateClaims[key] = value;
  }
}

const normalizedUser = username.trim().toLowerCase();

// ── Sign token ──────────────────────────────────────────────────────

let token;
let signedAlg;

if (mode === 'legacyAesCtr') {
  // Legacy HS256
  const { default: jwt } = await import('jsonwebtoken');
  let encryptKey = getOpt('webServer.auth.jwtToken.encryptKey');
  if (!encryptKey || String(encryptKey).trim() === '' || encryptKey === '***') {
    console.error('Error: webServer.auth.jwtToken.encryptKey is not configured or has a placeholder value.');
    console.error('Set it in config/local.yaml or via ENV WS_TOKEN_ENCRYPT_KEY');
    process.exit(1);
  }
  signedAlg = 'HS256';
  const signOptions = {
    algorithm: 'HS256',
    subject: normalizedUser,
    expiresIn: liveTimeSec,
    jwtid: crypto.randomUUID(),
  };
  if (effectiveService && effectiveService.trim()) {
    signOptions.audience = effectiveService.trim();
  }
  if (configuredIssuer) {
    signOptions.issuer = configuredIssuer;
  }
  token = jwt.sign(privateClaims, String(encryptKey), signOptions);
} else {
  // embedded / localKey — sign with ES256/RS256 via jose
  const { SignJWT, importPKCS8 } = await import('jose');

  let privPath;
  if (keyOverride) {
    privPath = resolve(keyOverride);
  } else if (mode === 'embedded') {
    privPath = resolve(keyStoragePath, 'private.pem');
  } else if (mode === 'localKey') {
    if (!configuredPrivateKey) {
      console.error('Error: mode=localKey requires webServer.auth.jwtToken.privateKeyPath in config');
      console.error('       or pass --key <path>');
      process.exit(1);
    }
    privPath = resolve(configuredPrivateKey);
  } else {
    console.error(`Error: unknown jwtToken.mode "${mode}"`);
    process.exit(1);
  }
  if (!existsSync(privPath)) {
    console.error(`Error: private key not found at ${privPath}`);
    if (mode === 'embedded') {
      console.error('Hint: start the server once (npm start) to autogenerate the keypair, or run:');
      console.error('  openssl ecparam -name prime256v1 -genkey -noout -out <path>/private.pem');
      console.error('  openssl ec -in <path>/private.pem -pubout -out <path>/public.pem');
    }
    process.exit(1);
  }
  const privPem = readFileSync(privPath, 'utf8');
  const privateKey = await importPKCS8(privPem, algorithm, { extractable: true });
  signedAlg = algorithm;

  const issuer = expectedIssuer || configuredIssuer || `urn:fa-mcp:${getOpt('name') || 'fa-mcp-sdk'}`;
  const audience = effectiveService || expectedAudience || undefined;

  const builder = new SignJWT(privateClaims)
    .setProtectedHeader({ alg: algorithm, typ: 'JWT' })
    .setSubject(normalizedUser)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + liveTimeSec)
    .setJti(crypto.randomUUID());
  if (issuer) {
    builder.setIssuer(issuer);
  }
  if (audience) {
    builder.setAudience(audience);
  }
  token = await builder.sign(privateKey);
}

// ── Decode for display ──────────────────────────────────────────────

function decodePayloadSegment(jwtToken) {
  try {
    const parts = jwtToken.split('.');
    if (parts.length !== 3) {
      return {};
    }
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

const decoded = decodePayloadSegment(token);
const expireMs = (decoded.exp || 0) * 1000;
const iatIso = decoded.iat ? new Date(decoded.iat * 1000).toISOString() : new Date().toISOString();

const displayPayload = { user: normalizedUser };
if (decoded.aud) {
  displayPayload.service = Array.isArray(decoded.aud) ? decoded.aud[0] : decoded.aud;
}
displayPayload.expire = expireMs;
displayPayload.iat = iatIso;
if (decoded.jti) {
  displayPayload.jti = decoded.jti;
}
if (decoded.iss) {
  displayPayload.iss = decoded.iss;
}
for (const [k, v] of Object.entries(privateClaims)) {
  displayPayload[k] = v;
}

console.log('');
console.log(`JWT Token generated successfully (mode=${mode}, alg=${signedAlg})`);
console.log('─'.repeat(50));
console.log(`  User:      ${displayPayload.user}`);
if (displayPayload.service) {
  console.log(`  Service:   ${displayPayload.service}`);
}
console.log(`  TTL:       ${ttlRaw} (${liveTimeSec} seconds)`);
console.log(`  Expires:   ${new Date(expireMs).toISOString()}`);
console.log(`  JTI:       ${displayPayload.jti || ''}`);
const extraEntries = Object.entries(privateClaims);
if (extraEntries.length) {
  const extra = extraEntries.map(([k, v]) => `${k}=${v}`).join('; ');
  console.log(`  Params:    ${extra}`);
}
console.log('─'.repeat(50));
console.log('');
console.log(token);
console.log('');
console.log('__PAYLOAD_JSON__');
console.log(JSON.stringify({ ...displayPayload, ttl: ttlRaw, expire_iso: new Date(expireMs).toISOString() }));
console.log('__END_PAYLOAD_JSON__');
