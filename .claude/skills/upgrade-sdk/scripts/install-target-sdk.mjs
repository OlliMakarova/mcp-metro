#!/usr/bin/env node
import { cpSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node install-target-sdk.mjs <version|git-url>');
  console.error('  e.g. 0.4.108');
  console.error('  e.g. https://github.com/Bazilio-san/fa-mcp-sdk#<commit-hash>');
  process.exit(1);
}

const cwd = process.cwd();

if (!existsSync(join(cwd, 'package.json'))) {
  console.error(`No package.json in ${cwd}. Run this script from the project root.`);
  process.exit(1);
}

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`Command failed: ${cmd} ${args.join(' ')} (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

run('yarn', ['add', `fa-mcp-sdk@${target}`]);

const sdkUpdaterSrc = join(cwd, 'node_modules', 'fa-mcp-sdk', 'scripts', 'update-sdk.js');
const sdkUpdaterDest = join(cwd, 'scripts', 'update-sdk.js');

if (!existsSync(sdkUpdaterSrc)) {
  console.error(`Updater not found: ${sdkUpdaterSrc}`);
  process.exit(1);
}

cpSync(sdkUpdaterSrc, sdkUpdaterDest);
console.log(`Copied update-sdk.js: ${sdkUpdaterSrc} -> ${sdkUpdaterDest}`);

run('node', ['scripts/update-sdk.js']);

console.log('\nSDK installed and template assets refreshed.');
