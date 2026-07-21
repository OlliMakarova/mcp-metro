#!/usr/bin/env node

/**
 * STDIO transport tests for the template MCP server (src/template)
 * Uses a minimal NDJSON JSON-RPC client over child_process stdio
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { McpStdioClient } from 'fa-mcp-sdk';

import TEMPLATE_TESTS from './test-cases.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serverPath = join(__dirname, '../../dist/src/start.js');

async function runTestGroup(title, tests, client) {
  console.log(`\n${title}:`);
  let passed = 0;
  for (const test of tests) {
    const name = (await test).name || 'test';
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
      console.log(`  ❌  ${name}:`, e.message);
    }
  }
  console.log(`  Result: ${passed}/${tests.length} passed`);
  return passed;
}

async function main() {
  console.log('🧪 STDIO tests for template MCP server');
  console.log('='.repeat(60));

  const proc = spawn('node', [serverPath, 'stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'test' },
  });

  const client = new McpStdioClient(proc);

  try {
    // Initialize handshake (optional for stdio server; safe to send)
    await client
      .send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'stdio-test', version: '1.0.0' },
      })
      .catch(() => undefined);

    const p1 = await runTestGroup('Prompts', TEMPLATE_TESTS.prompts, client);
    const p2 = await runTestGroup('Resources', TEMPLATE_TESTS.resources, client);
    const p3 = await runTestGroup('Tools', TEMPLATE_TESTS.tools, client);

    const total = TEMPLATE_TESTS.prompts.length + TEMPLATE_TESTS.resources.length + TEMPLATE_TESTS.tools.length;
    const sum = p1 + p2 + p3;
    console.log(`\nSummary: ${sum}/${total} tests passed`);
  } finally {
    try {
      proc.kill();
    } catch {}
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
