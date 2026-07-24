/**
 * An example of extending the fa-mcp-sdk configuration with a custom settings block.
 *
 * This file demonstrates how to add your own settings
 * (for example, to check the user's membership in an AEC group).
 */

import { AppConfig } from 'fa-mcp-sdk';

/**
 * AD Group Membership Verification Settings
 */
export interface IGroupAccessConfig {
  groupAccess: {
    /** AD Group whose membership is required for access */
    requiredGroup: string;

    /** Optional: Allow access without checking the group (for debugging) */
    bypassGroupCheck?: boolean;

    /** Optional: cache the result of the check (seconds) */
    cacheTtlSeconds?: number;

    /** Optional: List of groups with different access levels */
    accessLevels?: {
      /** Full access group (read/write) */
      fullAccess?: string;
      /** Read-only group */
      readOnly?: string;
      /** Administrators group */
      admin?: string;
    };
  };
}

/**
 * Metro data layer settings (`metro` section in config/*.yaml).
 * All fields are optional — defaults are supplied by getMetroConfig()
 * in src/lib/metro-data/metro-config.ts.
 */
export interface IMetroSectionConfig {
  metro?: {
    /** Scheduled data refresh interval, hours (default 24) */
    refreshIntervalHours?: number;
    /** Lifetime of the closure notifications file, hours (default 24) */
    notificationsTtlHours?: number;
    /** Timeout of a single HTTP request to a source, milliseconds (default 30000) */
    requestTimeoutMs?: number;
  };
}

/**
 * Telegram notifications about metro data source state changes
 * (`telegram` section in config/*.yaml; the token is a secret — keep it in local.yaml or ENV).
 */
export interface ITelegramSectionConfig {
  telegram?: {
    /** Enable notifications (default false) */
    enabled?: boolean;
    /** Bot token from @BotFather */
    botToken?: string;
    /** Chat identifier (private chat, group, or channel the bot was added to) */
    chatId?: string;
  };
}

/**
 * Rate limiting for the metro REST API (`restApi` section in config/*.yaml).
 * The limit is applied to each REST route per client IP address. All fields are
 * optional — when the section is absent, the defaults (60 requests per 60 seconds)
 * defined in src/api/router.ts apply.
 */
export interface IRestApiSectionConfig {
  restApi?: {
    rateLimit?: {
      /** Maximum requests per window (default 60) */
      maxRequests?: number;
      /** Rate-limit window length, seconds (default 60) */
      windowSec?: number;
    };
  };
}

/**
 * Signed widget-data links (`widgetData` section in config/*.yaml).
 * The route widget loads its dynamic data over REST via a self-describing, signed link
 * (see src/tools/widget/widget-data-link.ts). The signature keeps the /widget-data endpoint
 * serving only links the tool itself issued, rather than becoming a public route-search API.
 */
export interface IWidgetDataSectionConfig {
  widgetData?: {
    /**
     * HMAC-SHA256 secret used to sign widget-data links. When empty, a random secret is
     * generated once at startup: links issued before a restart stop verifying afterwards
     * (acceptable for local development; in production set an explicit secret so links are
     * effectively permanent).
     */
    signSecret?: string;
  };
}

/**
 * Extended app config with group checking settings.
 *
 * `webServer.publicBaseUrl` is intersected onto the SDK's webServer type: it is the single
 * source of the externally reachable base address, used to build both widget-data links and the
 * `connect-src` CSP source of the ui:// widget resource. Empty → `http://localhost:<port>`.
 */
export interface CustomAppConfig
  extends
    AppConfig,
    IGroupAccessConfig,
    IMetroSectionConfig,
    ITelegramSectionConfig,
    IRestApiSectionConfig,
    IWidgetDataSectionConfig {
  webServer: AppConfig['webServer'] & {
    /** Externally reachable base URL (scheme + host [+ port]). Empty → http://localhost:<port> */
    publicBaseUrl?: string;
  };
}

// ========================================================================
// YAML CONFIGURATION EXAMPLE (config/default.yaml)
// ========================================================================
/*
groupAccess:
  requiredGroup: "DOMAIN\\MCP-Users"
  bypassGroupCheck: false
  cacheTtlSeconds: 300
  accessLevels:
    fullAccess: "DOMAIN\\MCP-FullAccess"
    readOnly: "DOMAIN\\MCP-ReadOnly"
    admin: "DOMAIN\\MCP-Admins"
*/

// ========================================================================
// EXAMPLE OF USE IN CODE
// ========================================================================
/*
import { appConfig } from 'fa-mcp-sdk';

// TYPED ACCESS TO CUSTOM SETTINGS
const config = appConfig as CustomAppConfig;

const requiredGroup = config.groupAccess.requiredGroup;
const shouldBypass = config.groupAccess.bypassGroupCheck;

// Checking the Access Level from Payload
function getUserAccessLevel(payload: { user: string; groups?: string[] }): 'admin' | 'full' | 'readonly' | 'none' {
  const { accessLevels } = config.groupAccess;
  const userGroups = payload.groups || [];

  if (accessLevels?.admin && userGroups.includes(accessLevels.admin)) {
    return 'admin';
  }
  if (accessLevels?.fullAccess && userGroups.includes(accessLevels.fullAccess)) {
    return 'full';
  }
  if (accessLevels?.readOnly && userGroups.includes(accessLevels.readOnly)) {
    return 'readonly';
  }
  return 'none';
}
*/
