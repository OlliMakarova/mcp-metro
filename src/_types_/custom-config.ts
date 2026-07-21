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
 * Extended app config with group checking settings
 */
export interface CustomAppConfig extends AppConfig, IGroupAccessConfig {}

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
