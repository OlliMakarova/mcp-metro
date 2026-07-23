import { Tool } from '@modelcontextprotocol/sdk/types.js';
import chalk from 'chalk';

import { IToolHandlerParams, logger as lgr, ToolExecutionError, TToolHandlerResponse } from 'fa-mcp-sdk';

import { hideSourceNames } from '../lib/metro-data/public-source.js';
import { handleMetroInfo, metroInfoTool } from './metro-info.js';

const logger = lgr.getSubLogger({ name: chalk.bgGrey('tools') });

type TToolHandler = (params: IToolHandlerParams) => Promise<TToolHandlerResponse>;

/**
 * Tool registry of the metro MCP server: one file per tool (definition + schema + handler),
 * wired together here. To add a tool, create `src/tools/<tool-name>.ts` and register it below.
 */
const handlers: Record<string, TToolHandler> = {
  [metroInfoTool.name]: handleMetroInfo,
};

export const tools: Tool[] = [metroInfoTool];

/**
 * Tool call dispatcher of the metro MCP server.
 *
 * Debug output of tool requests/responses is wired centrally in the SDK
 * (see init-mcp-server.ts) and is enabled via the DEBUG=mcp:tool environment variable.
 */
export const handleToolCall = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  const { name } = params;
  logger.info(`Tool called: ${name}`);

  try {
    const handler = handlers[name];
    if (!handler) {
      throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }
    return await handler(params);
  } catch (error: Error | any) {
    logger.error(`Tool execution failed for ${name}:`, error);
    error.printed = true;
    // Real data source names are confidential: scrub them from the error text
    // before the SDK returns it to the client in the MCP response (the original went to the log above)
    if (typeof error?.message === 'string') {
      error.message = hideSourceNames(error.message);
    }
    throw error;
  }
};
