import { Tool } from '@modelcontextprotocol/sdk/types.js';

import { IToolInputSchema, IToolProperties } from 'fa-mcp-sdk';

/**
 * Template tools configuration for MCP Server
 * Define your tools according to your server's functionality
 *
 * Schemas follow JSON Schema draft 2020-12 (`$schema`) and reject unknown fields
 * (`additionalProperties: false`) — required by standard §9.2.
 */

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

const getGenericInputSchema = (
  queryDescription?: string,
  additionalProperties?: IToolProperties,
): IToolInputSchema => ({
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: queryDescription || 'Input query or text',
    },
    ...additionalProperties,
  },
  required: ['query'],
  additionalProperties: false,
});

const getSearchInputSchema = (): IToolInputSchema => ({
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'Search query',
    },
    limit: {
      type: 'number',
      description: 'Maximum number of results to return (1-100, default: 20)',
      minimum: 1,
      maximum: 100,
    },
    threshold: {
      type: 'number',
      description: 'Minimum similarity threshold (0-1)',
      minimum: 0,
      maximum: 1,
    },
  },
  required: ['query'],
  additionalProperties: false,
});

const exampleSearchOutputSchema = {
  $schema: JSON_SCHEMA_2020_12,
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'number' },
          text: { type: 'string' },
        },
        required: ['id'],
        additionalProperties: true,
      },
    },
    total: { type: 'number' },
  },
  required: ['results'],
  additionalProperties: true,
} as const;

// Template tools - customize according to your needs
export const tools: Tool[] = [
  {
    name: 'example_tool',
    title: 'Example: process text',
    description: 'Example tool that processes text input. Replace with your actual tools.',
    inputSchema: getGenericInputSchema('Text to process'),
  },
  {
    name: 'example_search',
    title: 'Example: search with filters',
    description: 'Example search tool with pagination and filtering. Template for search-based tools.',
    inputSchema: getSearchInputSchema(),
    outputSchema: exampleSearchOutputSchema as any,
  },
  {
    // Standard §8.7 / §9.1 — example of a long-running tool that opts in to task-augmented
    // execution. With `mcp.tasks.enabled: true`, a client MAY send a `task` param to tools/call:
    // the server returns a taskId immediately, runs this handler in the background (reporting
    // progress and honouring cancellation), and the client polls tasks/get + tasks/result.
    // `taskSupport: 'optional'` keeps the tool callable synchronously too — choose a task when the
    // work can exceed the 30s tool timeout or you want a cancellable, pollable operation.
    name: 'example_long_task',
    title: 'Example: long-running task',
    description: `Example long-running tool that emits progress and supports cancellation. 
Demonstrates task-augmented execution — call it with a 'task' param to run it as a task.`,
    inputSchema: {
      $schema: JSON_SCHEMA_2020_12,
      type: 'object',
      properties: {
        steps: {
          type: 'number',
          description: 'Number of processing steps to simulate (1-20, default 5)',
          minimum: 1,
          maximum: 20,
        },
      },
      required: [],
      additionalProperties: false,
    },
    execution: { taskSupport: 'optional' },
  } as Tool,
  // TODO: Add your actual tools here
  // {
  //   name: 'your_tool_name',
  //   title: 'Human-readable title shown in UI',
  //   description: 'Description of what your tool does',
  //   inputSchema: getGenericInputSchema('Your query description', {
  //     // additional parameters
  //     param1: {
  //       type: 'string',
  //       description: 'Description of param1',
  //     },
  //   }),
  // },
];

// Helper to get tool by name
export const getToolByName = (name: string): Tool | undefined => {
  return tools.find((tool) => tool.name === name);
};

// Helper to get all tool names
export const getToolNames = (): string[] => {
  return tools.map((tool) => tool.name);
};
