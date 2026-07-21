#!/usr/bin/env node

/**
 * SSE transport tests for the template MCP server (src/template)
 * Uses McpSseClient to send requests via HTTP and receive responses via SSE
 */

import { appConfig, McpSseClient, getAuthHeadersForTests } from 'fa-mcp-sdk';

import TEMPLATE_TESTS from './test-cases.js';

const baseURL = (process.env.TEST_MCP_SERVER_URL || `http://localhost:${appConfig.webServer.port}`).replace(/\/+$/, '');

async function runTestGroup(title, tests, client) {
  console.log(`\n${title}:`);
  let passed = 0;
  for (const test of tests) {
    try {
      const res = await test(client);
      if (res.passed) {
        console.log(`  ✅  ${res.name}`);
        passed++;
      } else {
        console.log(`  ❌  ${res.name}`);
        if (res.details) {
          console.log('     ', res.details);
        }
      }
    } catch (e) {
      console.log(`  ❌  ${test.name || 'test'}:`, e.message);
    }
  }
  console.log(`  Result: ${passed}/${tests.length} passed`);
  return passed;
}

async function main() {
  console.log('🧪 SSE tests for template MCP server');
  console.log('='.repeat(60));

  // Get authentication headers based on config
  const headers = await getAuthHeadersForTests();
  if (Object.keys(headers).length) {
    console.log('  Authentication enabled');
  } else if (appConfig.webServer?.auth?.enabled) {
    console.log('⚠️  Warning: Auth is enabled but no valid credentials found');
  }

  const client = new McpSseClient(baseURL, headers);
  try {
    // Health check (optional)
    await client.health().catch(() => undefined);

    // Initialize over RPC channel used by SSE client (POST /rpc)
    await client
      .sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'sse-test', version: '1.0.0' },
      })
      .catch(() => undefined);

    const p1 = await runTestGroup('Prompts', TEMPLATE_TESTS.prompts, client);
    const p2 = await runTestGroup('Resources', TEMPLATE_TESTS.resources, client);
    const p3 = await runTestGroup('Tools', TEMPLATE_TESTS.tools, client);

    const total = TEMPLATE_TESTS.prompts.length + TEMPLATE_TESTS.resources.length + TEMPLATE_TESTS.tools.length;
    const sum = p1 + p2 + p3;
    console.log(`\nSummary: ${sum}/${total} tests passed`);
  } finally {
    await client.close().catch(() => undefined);
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((e) => {
    console.error('Test failed:', e?.message || e);
    process.exit(1);
  });
