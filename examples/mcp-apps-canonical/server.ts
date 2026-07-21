/**
 * Canonical MCP Apps example for fa-mcp-sdk.
 *
 * A minimal HTTP MCP server that registers one tool (`get-time`) with a UI
 * widget. The widget renders the timestamp inside the host's iframe and can
 * call back into the server via `app.callServerTool('get-time')`.
 *
 * Run:
 *   npm run example:mcp-apps
 *   # then open http://localhost:7080/agent-tester, toggle Apps, ask
 *   # "what time is it?"
 *
 * What to copy when adding MCP Apps to your own server:
 *  - `tools[]`             — `_meta.ui.resourceUri` links the tool to the widget.
 *  - `customResources[]`   — serves the `ui://` HTML; `mimeType` MUST be
 *                             `MCP_APPS_RESOURCE_MIME_TYPE`.
 *  - `toolHandler`         — branch on `getUiCapability(...)` to provide a
 *                             text-only fallback for non-MCP-Apps hosts.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  IResourceData,
  IToolHandlerParams,
  MCP_APPS_RESOURCE_MIME_TYPE,
  McpServerData,
  TToolHandlerResponse,
  formatToolResult,
  initMcpServer,
} from 'fa-mcp-sdk';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const WIDGET_HTML_PATH = path.join(THIS_DIR, 'widget', 'index.html');
const RESOURCE_URI = 'ui://get-time/view.html';

const tools: Tool[] = [
  {
    name: 'get-time',
    title: 'Get current server time',
    description:
      'Returns the current server timestamp. When the host supports MCP Apps, the response ' +
      'is rendered by an interactive widget; otherwise the agent sees the timestamp as plain text.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    _meta: {
      ui: { resourceUri: RESOURCE_URI },
    },
  },
];

const customResources: IResourceData[] = [
  {
    uri: RESOURCE_URI,
    name: 'get-time-widget',
    description: 'MCP Apps widget that renders the get-time tool result.',
    mimeType: MCP_APPS_RESOURCE_MIME_TYPE,
    content: async () => fs.readFile(WIDGET_HTML_PATH, 'utf-8'),
    _meta: {
      ui: {
        preferredFrameSize: ['100%', '180px'],
      },
    },
  },
];

const toolHandler = async (params: IToolHandlerParams): Promise<TToolHandlerResponse> => {
  if (params.name !== 'get-time') {
    throw new Error(`Unknown tool: ${params.name}`);
  }
  return formatToolResult({
    timestamp: new Date().toISOString(),
    iso: new Date().toISOString(),
  });
};

const serverData: McpServerData = {
  tools,
  toolHandler,
  agentBrief: 'Canonical MCP Apps example — returns server time with an interactive widget.',
  agentPrompt:
    'You are the demo agent for the canonical MCP Apps example. ' +
    'When the user asks about time, call the get-time tool. The host renders the response in a widget; ' +
    'briefly acknowledge the result without restating the timestamp verbatim.',
  customResources,
};

initMcpServer(serverData).catch((error) => {
  console.error('Failed to start canonical MCP Apps example:', error);
  process.exit(1);
});
