// Config-reading wrappers over the pure signing core (widget-data-sign.ts).
//
// These read the signing secret and the public base URL from the app config and delegate to the
// pure functions. Keeping config access here (and out of the core) lets the core be unit-tested
// without loading fa-mcp-sdk. See widget-data-sign.ts for the link semantics.

import { randomBytes } from 'node:crypto';

import { appConfig } from 'fa-mcp-sdk';

import { CustomAppConfig } from '../../_types_/custom-config.js';
import {
  buildSignedUrl,
  IWidgetDataParams,
  parseSignedQuery,
  signToken,
  TOKEN_TTL_SEC,
  verifyToken,
} from './widget-data-sign.js';

export { parseTokenQuery, WidgetLinkError } from './widget-data-sign.js';
export type { IWidgetDataParams } from './widget-data-sign.js';

let cachedSecret: string | null = null;

/**
 * HMAC secret for widget-data links. Uses `widgetData.signSecret` from config when set; otherwise
 * generates a random secret once per process (links stop verifying after a restart — acceptable
 * for local development, while production sets an explicit secret and links stay valid).
 */
const getSignSecret = (): string => {
  if (cachedSecret !== null) {
    return cachedSecret;
  }
  const configured = (appConfig as CustomAppConfig).widgetData?.signSecret?.trim();
  cachedSecret = configured || randomBytes(32).toString('hex');
  return cachedSecret;
};

/**
 * Externally reachable base URL (no trailing slash). `webServer.publicBaseUrl` is the single source
 * of the external address; empty falls back to `http://localhost:<port>` for local development.
 */
export const getPublicBaseUrl = (): string => {
  const cfg = appConfig as CustomAppConfig;
  const configured = cfg.webServer?.publicBaseUrl?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  return `http://localhost:${cfg.webServer.port}`;
};

/** Builds the signed widget-data URL for the given route parameters */
export const buildWidgetDataUrl = (params: IWidgetDataParams): string =>
  buildSignedUrl(getPublicBaseUrl(), getSignSecret(), params);

/** Parses and verifies a widget-data query against the server secret */
export const parseWidgetDataQuery = (query: Record<string, unknown>): IWidgetDataParams =>
  parseSignedQuery(getSignSecret(), query);

/**
 * Mints a fresh recompute token for a client IP, valid for TOKEN_TTL_SEC. Every successful
 * widget-data response carries one, so a card in active use keeps sliding its expiry forward.
 */
export const issueWidgetToken = (ip: string): string =>
  signToken(getSignSecret(), ip, Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC);

/** Verifies a recompute token presented by a client IP against the server secret */
export const verifyWidgetToken = (ip: string, token: string): boolean => verifyToken(getSignSecret(), ip, token);
