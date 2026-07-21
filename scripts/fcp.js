#!/usr/bin/env node

/**
 * The sanctioned write/delete channel for files under .claude/ (and any other path).
 *
 * Direct Write/Edit on .claude/** is denied by settings.json, and direct shell modification of .claude/
 * (rm, mv, cp, output redirection) is blocked by the harness. This script is the ONE allowed way to create,
 * overwrite or delete such files, because it runs as `node` (an allowlisted command). See the /edit-claude-files
 * skill for the full protocol.
 *
 * Usage:
 *   node scripts/fcp.js <filePath> <contentFilePath>   # create/overwrite <filePath> with the contents of the temp file
 *   node scripts/fcp.js --rm <path> [<path> ...]       # delete the given path(s) (files or directories, recursive)
 *
 * <filePath>        — destination path (absolute or relative to project root)
 * <contentFilePath> — path to a temp file whose contents will be written to <filePath>
 *
 * Write mode reads the content from <contentFilePath> and writes it to <filePath>, creating parent directories if
 * needed. Delete mode (--rm / --delete) removes each target path; missing paths are reported, not an error.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);

// Delete mode: `--rm` / `--delete` followed by one or more paths to remove.
if (argv[0] === '--rm' || argv[0] === '--delete') {
  const targets = argv.slice(1);
  if (!targets.length) {
    console.error('Usage: node scripts/fcp.js --rm <path> [<path> ...]');
    process.exit(1);
  }
  for (const raw of targets) {
    const target = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw);
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      console.log(`Deleted: ${target}`);
    } else {
      console.log(`Already absent: ${target}`);
    }
  }
  process.exit(0);
}

const [rawTarget, rawSource] = argv;

if (!rawTarget || !rawSource) {
  console.error('Usage: node scripts/fcp.js <filePath> <contentFilePath>  |  node scripts/fcp.js --rm <path> [...]');
  process.exit(1);
}

const targetPath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(projectRoot, rawTarget);
const sourcePath = path.isAbsolute(rawSource) ? rawSource : path.resolve(projectRoot, rawSource);

if (!fs.existsSync(sourcePath)) {
  console.error(`Source file not found: ${sourcePath}`);
  process.exit(1);
}

const content = fs.readFileSync(sourcePath, 'utf-8');

const targetDir = path.dirname(targetPath);
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.writeFileSync(targetPath, content, 'utf-8');
console.log(`Saved: ${targetPath} (${content.length} chars)`);
