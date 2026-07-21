# MCP SSE Client - Preventing unhandledRejection

## Problem

When using `fa-mcp-sdk` as an npm package in tests where `McpSseClient` is imported, `unhandledRejection` errors may occur. This happens because MCP errors are handled asynchronously through SSE (Server-Sent Events) and may not be properly caught in the test context.

## Why this happens

1. **Local tests**: Run in the same process as the MCP server
2. **NPM package**: The test runs in a separate process
3. **SSE asynchronicity**: Errors may occur after the promise is created but before they are handled

## Solutions

### Solution 1: Use a static method (recommended)

```javascript
import { McpSseClient } from 'fa-mcp-sdk';

// Create a client with automatic unhandledRejection handling
const client = McpSseClient.createWithErrorHandler('http://localhost:3000');

try {
  const response = await client.callTool('execute_sql_query', { sql: test.sql });
  console.log('✅ Success:', response);
} catch (error) {
  console.log('❌ Error:', error.message);
}
```

### Solution 2: Global unhandledRejection handler

Add at the beginning of the test file:

```javascript
// Global handling of MCP errors
process.on('unhandledRejection', (reason) => {
  if (typeof reason === 'object' && reason?.message?.includes('MCP Error:')) {
    // Ignore MCP errors — they are handled in try-catch
    return;
  }
});

// Or using the built-in method
import { McpSseClient } from 'fa-mcp-sdk';
McpSseClient.setupGlobalErrorHandler();
```

### Solution 3: Promise with error handling

```javascript
import { McpSseClient } from 'fa-mcp-sdk';

const client = new McpSseClient('http://localhost:3000');

// Wrap all calls in an additional catch
async function safeCallTool(toolName, args) {
  try {
    return await client.callTool(toolName, args);
  } catch (error) {
    // Additional handling to prevent unhandledRejection
    if (error.message.includes('MCP Error:')) {
      throw error;
    }
    throw new Error(`Unexpected error: ${error.message}`);
  }
}
```

## Full test example

```javascript
import { McpSseClient } from 'fa-mcp-sdk';

async function testToolExecution() {
  // Create a client with error handling
  const client = McpSseClient.createWithErrorHandler('http://localhost:3000');

  try {
    // Test successful execution
    const successResponse = await client.callTool('example_tool', { query: 'ping' });
    console.log('✅ Tool executed successfully:', successResponse);

    // Test error handling (as in your example)
    try {
      await client.callTool('example_tool', {}); // No query — should error
      console.log('❌ Expected error but got success');
    } catch (error) {
      console.log('✅ Expected error caught:', error.message);
    }

  } catch (error) {
    console.error('❌ Unexpected test error:', error);
  } finally {
    await client.close();
  }
}

testToolExecution();
```

## Important notes

1. **For npm packages only**: The issue usually does not occur in local tests
2. **MCP errors**: The handler filters only errors containing 'MCP Error:'
3. **Global handler**: Installed once per process
4. **Resources**: Don’t forget to call `client.close()` for cleanup

## Technical details

The issue arises because SSE errors are handled in `McpSseClient.handleSseEvent()` and may cause a promise rejection that is not yet caught at the moment the error occurs. New methods provide an additional layer of handling to prevent unhandledRejection.
