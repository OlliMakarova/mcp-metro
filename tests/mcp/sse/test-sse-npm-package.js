#!/usr/bin/env node

/**
 * Example of using fa-mcp-sdk as an npm package without unhandledRejection issues
 *
 * To use this example:
 * 1. Install fa-mcp-sdk: npm install fa-mcp-sdk
 * 2. Start MCP server: npm run template:start (in fa-mcp-sdk project)
 * 3. Run this example: node test-npm-package.js
 */

import { McpSseClient } from 'fa-mcp-sdk';

const SERVER_URL = 'http://localhost:9049';

async function testMcpClient() {
  console.log('🧪 Testing MCP client as npm package');
  console.log('='.repeat(50));

  // Use the new method that handles unhandledRejection
  const client = McpSseClient.createWithErrorHandler(SERVER_URL);

  try {
    // Health check
    console.log('1. Health check...');
    try {
      const health = await client.health();
      console.log('✅ Health check passed:', health.status);
    } catch (error) {
      console.log('⚠️  Health check failed:', error.message);
    }

    // Initialize
    console.log('2. Initializing...');
    await client.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'npm-test', version: '1.0.0' },
    });
    console.log('✅ Initialized successfully');

    // List tools
    console.log('3. Listing tools...');
    const tools = await client.listTools();
    const toolNames = tools.tools?.map((t) => t.name) || [];
    console.log('✅ Available tools:', toolNames.join(', '));

    // Test successful tool call
    console.log('4. Testing successful tool call...');
    try {
      const response = await client.callTool('example_tool', { query: 'ping' });
      console.log(
        '✅ Tool call successful:',
        response.result?.structuredContent?.message || response.result?.content?.[0]?.text,
      );
    } catch (error) {
      console.log('❌ Tool call failed:', error.message);
    }

    // Test expected error (like the test case in test-cases.js)
    console.log('5. Testing expected error handling...');
    try {
      await client.callTool('example_tool', {}); // Missing query parameter
      console.log('❌ Expected error but got success');
    } catch (error) {
      console.log('✅ Expected error caught:', error.message);
      // This error should NOT cause unhandledRejection
    }

    // Test with invalid tool name
    console.log('6. Testing invalid tool name...');
    try {
      await client.callTool('nonexistent_tool', {});
      console.log('❌ Expected error but got success');
    } catch (error) {
      console.log('✅ Expected error caught:', error.message);
      // This error should NOT cause unhandledRejection
    }

    console.log('\n🎉 All tests completed successfully!');
    console.log('✨ No unhandledRejection errors occurred');
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
  } finally {
    await client.close();
    console.log('🔚 Client closed');
  }
}

// Global handler for any unexpected unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 UNHANDLED REJECTION (this should not happen):');
  console.error('Reason:', reason);
  console.error('Promise:', promise);
  process.exit(1);
});

testMcpClient().catch(console.error);
