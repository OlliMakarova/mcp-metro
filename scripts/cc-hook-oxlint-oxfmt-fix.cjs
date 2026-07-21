#!/usr/bin/env node

/**
 * Oxlint + Oxfmt Auto-Fix Hook for Claude Code
 * Automatically lints and formats JS/TS files after Write/Edit operations
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const LOG_FILE = path.join(__dirname, 'log.log');
const IS_LOG = process.env.CLAUDE_HOOK_LOG === 'true';

function log(message) {
  if (IS_LOG) {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line);
  }
}

function main() {
  let input = '';

  try {
    // Read JSON input from stdin
    input = fs.readFileSync(0, 'utf-8');
    log(`Input received:\n====\n${input.substring(0, 200)}...\n====\n`);

    const data = JSON.parse(input);
    const filePath = data?.tool_input?.file_path;

    if (!filePath) {
      log('No file_path found in input');
      process.exit(0);
    }

    log(`File path: ${filePath}`);

    // Check if file extension is .js or .ts
    if (!/\.(js|ts)$/.test(filePath)) {
      log(`Skipping non-JS/TS file: ${filePath}`);
      process.exit(0);
    }

    // Exclude files in node_modules, dist, coverage, etc.
    const excludePatterns = [/node_modules/, /[/\\]dist[/\\]/, /[/\\]coverage[/\\]/, /\.d\.ts$/];

    for (const pattern of excludePatterns) {
      if (pattern.test(filePath)) {
        log(`Skipping excluded path: ${filePath}`);
        process.exit(0);
      }
    }

    // Get project directory from environment
    const projectDir = process.env.CLAUDE_PROJECT_DIR;

    if (!projectDir) {
      log('CLAUDE_PROJECT_DIR not set');
      process.exit(0);
    }

    log(`Project dir: ${projectDir}`);

    // Change to project directory
    process.chdir(projectDir);

    // Run oxlint --fix on the file
    log(`Running Oxlint on: ${filePath}`);

    try {
      const output = execSync(`npx oxlint --fix "${filePath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      log(`Oxlint output: ${output || '(empty)'}`);
      console.log(`🔧 Linted: ${filePath}`);
    } catch (oxlintError) {
      // Oxlint returns non-zero on warnings/errors but file is still fixed
      log(`Oxlint warnings/errors: ${oxlintError.message}`);
      console.log(`⚠️ Oxlint warnings/errors (file still saved)`);
    }

    // Run oxfmt on the file
    log(`Running Oxfmt on: ${filePath}`);

    try {
      const output = execSync(`npx oxfmt "${filePath}"`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      log(`Oxfmt output: ${output || '(empty)'}`);
      console.log(`✨ Formatted: ${filePath}`);
      console.log('✅ Done');
    } catch (oxfmtError) {
      log(`Oxfmt warnings/errors: ${oxfmtError.message}`);
      console.log(`⚠️ Oxfmt warnings/errors (file still saved)`);
    }
  } catch (error) {
    log(`Error: ${error.message}\nStack: ${error.stack}`);
  }

  // Always exit 0 to not block Claude's operations
  process.exit(0);
}

main();
