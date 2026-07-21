import chalk from 'chalk';

import {
  debugMcpTool,
  formatToolResult,
  logger as lgr,
  maskSensitive,
  ToolExecutionError,
  TToolHandlerResponse,
} from 'fa-mcp-sdk';

const logger = lgr.getSubLogger({ name: chalk.bgGrey('tools') });

/**
 * Template tool handler - customize this for your specific tools
 * This handles MCP tool execution requests
 *
 * Debug output for tool requests/responses is wired up centrally by the SDK
 * (see `init-mcp-server.ts`) and activated with `DEBUG=mcp:tool`. Other MCP
 * channels have their own switches: `DEBUG=mcp:resource`, `DEBUG=mcp:prompt`,
 * `DEBUG=mcp:notification`. Use `DEBUG=mcp:*` to enable them all at once.
 */
export const handleToolCall = async (params: {
  name: string;
  arguments?: any;
  signal?: AbortSignal;
  sendProgress?: (progress: number, total?: number, message?: string) => void;
}): Promise<any> => {
  const { name, arguments: args, signal, sendProgress } = params;

  logger.info(`Tool called: ${name}`);

  try {
    let result: TToolHandlerResponse;
    // TODO: Implement your tool routing logic here
    switch (name) {
      case 'example_tool':
        result = await handleExampleTool(args);
        break;

      case 'example_long_task':
        result = await handleExampleLongTask(args, { signal, sendProgress });
        break;

      default:
        throw new ToolExecutionError(name, `Unknown tool: ${name}`);
    }

    // Optional: per-handler debug hook, in addition to the SDK-level wrapper.
    // Useful if you want to inspect intermediate (pre-format) values inside a
    // specific tool — define a new Debug category in `src/lib/debug.ts` and
    // call it here. The example below piggybacks on the built-in switch.
    if (debugMcpTool.enabled) {
      debugMcpTool(`handler[${name}] returned\n${JSON.stringify(result, null, 2)}`);
    }

    return result;
  } catch (error: Error | any) {
    logger.error(`Tool execution failed for ${name}:`, error);
    error.printed = true;
    throw error;
  }
};

/**
 * Example tool implementation
 * Replace this with your actual tool logic
 */
async function handleExampleTool(args: any): Promise<TToolHandlerResponse> {
  const { query } = args || {};

  if (!query) {
    throw new ToolExecutionError('example_tool', 'Query parameter is required');
  }

  // Simulate some work
  await new Promise((resolve) => setTimeout(resolve, 100));

  const result = {
    message: `Processed query: ${query}`,
    timestamp: new Date().toISOString(),
  };

  // Standard §12.2 — masking personal / sensitive data is the server's responsibility. For domains
  // with such data, run the result through `maskSensitive` before returning. It is opt-in: the SDK
  // never masks automatically. Rules are explicit (field names + regex), nothing is guessed.
  // Example (no-op here, since the sample result has no sensitive fields):
  const safeResult = maskSensitive(result, {
    fieldNames: ['password', 'token', 'ssn'],
    patterns: [/\b\d{13,19}\b/g], // card-like number sequences
    replacement: '***',
  });

  return formatToolResult(safeResult);
}

/**
 * Example long-running tool (standard §8.7). Processes a number of steps with an artificial delay,
 * emitting `sendProgress` after each step and aborting early when the client cancels.
 *
 * The same handler runs whether the tool is called synchronously or as a task — the SDK supplies
 * `signal` and `sendProgress` in both cases. As a task, `signal` is flipped by `tasks/cancel` and
 * progress is delivered via `notifications/progress`; synchronously, the 30s tool timeout applies,
 * which is exactly why long work should be invoked as a task.
 */
async function handleExampleLongTask(
  args: any,
  {
    signal,
    sendProgress,
  }: {
    signal?: AbortSignal | undefined;
    sendProgress?: ((p: number, total?: number, m?: string) => void) | undefined;
  },
): Promise<TToolHandlerResponse> {
  const steps = Math.min(20, Math.max(1, Number(args?.steps) || 5));

  for (let i = 1; i <= steps; i++) {
    if (signal?.aborted) {
      throw new ToolExecutionError('example_long_task', 'Cancelled by client');
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    sendProgress?.(i, steps, `Completed step ${i} of ${steps}`);
  }

  return formatToolResult({
    message: `Completed ${steps} steps`,
    steps,
    finishedAt: new Date().toISOString(),
  });
}

// TODO: Add more tool handlers here
// async function handleAnotherTool(args: any): Promise<string> {
//   // Your implementation
// }
