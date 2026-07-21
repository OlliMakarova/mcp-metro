// Import all project data from existing files
import { appConfig, initMcpServer, McpServerData, getAsset } from 'fa-mcp-sdk';

import { apiRouter } from './api/router.js';
import { customResources } from './custom-resources.js';
import { AGENT_BRIEF } from './prompts/agent-brief.js';
import { AGENT_PROMPT } from './prompts/agent-prompt.js';
import { customPrompts } from './prompts/custom-prompts.js';
import { toolPrompt } from './prompts/tool-prompts.js';
import { handleToolCall } from './tools/handle-tool-call.js';
import { tools } from './tools/tools.js';

const isConsulProd = (process.env.NODE_CONSUL_ENV || process.env.NODE_ENV) === 'production';

/**
 * Main function that assembles all project data and starts the MCP server
 */
const startProject = async (): Promise<void> => {
  // Read logo from assets
  const logoSvg = getAsset('logo.svg')!;

  // Assemble all data to pass to the core
  const serverData: McpServerData = {
    // MCP components
    tools,
    toolHandler: handleToolCall,

    // Prompts
    agentBrief: AGENT_BRIEF,
    agentPrompt: AGENT_PROMPT,
    toolPrompt,
    customPrompts,
    usedHttpHeaders: [
      { name: 'Authorization', description: 'JWT Token issued on request' },
      { name: 'x-test-header', description: 'Any custom header', isOptional: true },
    ],
    // Resources
    customResources,

    // HTTP components
    httpComponents: { apiRouter },

    // Assets
    assets: { logoSvg: logoSvg },
    // Function to get Consul UI address (if consul enabled: consul.service.enable = true)
    getConsulUIAddress: (serviceId: string) => {
      const { agent } = appConfig.consul || {};
      if (!agent?.dev?.host || !agent?.prd?.host) {
        return '--consul-ui-not-configured--';
      }
      return `${isConsulProd ? `https://${agent.prd.host}/ui/${agent.prd.dc}` : `https://${agent.dev.host}/ui/${agent.dev.dc}`}/services/${serviceId}/instances`;
    },

    // Custom startup diagnostic info displayed in the console at server start
    customStartupInfo: [['Custom param', 'any value']],
  };

  // Start MCP server with assembled data
  await initMcpServer(serverData);
};

startProject().catch((error) => {
  console.error('Failed to start project:', error);
  process.exit(1);
});
