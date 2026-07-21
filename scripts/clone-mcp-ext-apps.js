#!/usr/bin/env node
/**
 * Clone or update the @modelcontextprotocol/ext-apps reference repository into
 * mcp-ext-apps/ at the project root.
 *
 * The folder is intentionally persistent — it is listed in .gitignore but kept on
 * disk so subsequent skill runs can read the cloned sources without re-cloning.
 *
 * Usage:
 *   node scripts/clone-mcp-ext-apps.js                    # clone if missing, otherwise pull main
 *   node scripts/clone-mcp-ext-apps.js --tag latest       # also checkout latest released npm tag
 *   node scripts/clone-mcp-ext-apps.js --tag v0.7.1       # checkout a specific tag
 *   node scripts/clone-mcp-ext-apps.js --json             # emit JSON metadata to stdout
 *   node scripts/clone-mcp-ext-apps.js --list-examples    # include examples/* metadata in output
 *
 * The script never deletes mcp-ext-apps/. Failed clones leave whatever git managed
 * to write on disk; rerun the script to recover.
 */

import { exec } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TARGET_DIR = join(PROJECT_ROOT, 'mcp-ext-apps');
const REPO_URL = 'https://github.com/modelcontextprotocol/ext-apps.git';
const PACKAGE_NAME = '@modelcontextprotocol/ext-apps';

const args = process.argv.slice(2);
const flags = {
  json: args.includes('--json'),
  listExamples: args.includes('--list-examples'),
  tag: (() => {
    const i = args.indexOf('--tag');
    return i >= 0 && args[i + 1] ? args[i + 1] : null;
  })(),
};

const log = (msg) => {
  if (!flags.json) {
    console.log(msg);
  }
};

async function runIn(dir, cmd) {
  return execAsync(cmd, { cwd: dir, maxBuffer: 32 * 1024 * 1024 });
}

async function runInTarget(cmd) {
  return runIn(TARGET_DIR, cmd);
}

async function getLatestNpmVersion() {
  try {
    const { stdout } = await execAsync(`npm view ${PACKAGE_NAME} version`, {
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function isGitRepo(dir) {
  if (!existsSync(dir)) {
    return false;
  }
  try {
    await runIn(dir, 'git rev-parse --is-inside-work-tree');
    return true;
  } catch {
    return false;
  }
}

async function getCurrentSha() {
  const { stdout } = await runInTarget('git rev-parse --short HEAD');
  return stdout.trim();
}

async function getCurrentRef() {
  try {
    const { stdout } = await runInTarget('git symbolic-ref --short HEAD');
    return { type: 'branch', name: stdout.trim() };
  } catch {
    try {
      const { stdout } = await runInTarget('git describe --tags --exact-match');
      return { type: 'tag', name: stdout.trim() };
    } catch {
      const { stdout } = await runInTarget('git rev-parse --short HEAD');
      return { type: 'detached', name: stdout.trim() };
    }
  }
}

async function getDefaultBranch() {
  try {
    const { stdout } = await runInTarget('git symbolic-ref --short refs/remotes/origin/HEAD');
    return stdout.trim().replace(/^origin\//, '');
  } catch {
    try {
      await runInTarget('git rev-parse --verify main');
      return 'main';
    } catch {
      return 'master';
    }
  }
}

async function cloneRepo() {
  log(`Cloning ${REPO_URL} -> ${TARGET_DIR}`);
  await execAsync(`git clone "${REPO_URL}" "${TARGET_DIR}"`, {
    maxBuffer: 32 * 1024 * 1024,
  });
}

async function pullRepo() {
  const branch = await getDefaultBranch();
  log(`Updating ${TARGET_DIR} on ${branch}`);
  try {
    await runInTarget(`git checkout ${branch}`);
  } catch (e) {
    log(`Note: could not checkout ${branch} (${e.message.trim()})`);
  }
  try {
    await runInTarget(`git pull --ff-only origin ${branch}`);
  } catch (e) {
    log(`Pull failed: ${e.message.trim()}`);
    throw e;
  }
  try {
    await runInTarget('git fetch --tags --force');
  } catch (e) {
    log(`Tag fetch failed: ${e.message.trim()}`);
  }
}

async function checkoutTag(tag) {
  log(`Checking out ${tag}`);
  try {
    await runInTarget('git fetch --tags --force');
  } catch (e) {
    log(`Tag fetch warning: ${e.message.trim()}`);
  }
  await runInTarget(`git checkout ${tag}`);
}

function readPackageDescription(dir) {
  const pkgPath = join(dir, 'package.json');
  if (!existsSync(pkgPath)) {
    return null;
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.description || null;
  } catch {
    return null;
  }
}

function readReadmeSnippet(dir) {
  for (const name of ['README.md', 'Readme.md', 'readme.md']) {
    const p = join(dir, name);
    if (!existsSync(p)) {
      continue;
    }
    try {
      const raw = readFileSync(p, 'utf-8');
      const lines = raw.split(/\r?\n/);
      let heading = null;
      const paraLines = [];
      let inPara = false;
      for (const line of lines) {
        if (!heading) {
          const m = line.match(/^#\s+(.+)$/);
          if (m) {
            heading = m[1].trim();
            continue;
          }
        }
        if (heading) {
          if (!inPara) {
            if (line.trim() === '') {
              continue;
            }
            if (line.startsWith('#')) {
              break;
            }
            inPara = true;
            paraLines.push(line);
            continue;
          }
          if (line.trim() === '') {
            break;
          }
          if (line.startsWith('#')) {
            break;
          }
          paraLines.push(line);
        }
      }
      return { heading, paragraph: paraLines.join(' ').trim() || null };
    } catch {
      return null;
    }
  }
  return null;
}

function listExamples() {
  const examplesDir = join(TARGET_DIR, 'examples');
  if (!existsSync(examplesDir)) {
    return [];
  }

  return readdirSync(examplesDir)
    .filter((name) => {
      const full = join(examplesDir, name);
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    })
    .sort()
    .map((name) => {
      const dir = join(examplesDir, name);
      const description = readPackageDescription(dir);
      const readme = readReadmeSnippet(dir);
      return {
        name,
        relativePath: `examples/${name}`,
        description,
        readmeHeading: readme?.heading || null,
        readmeOpening: readme?.paragraph || null,
      };
    });
}

async function main() {
  let action;

  if (await isGitRepo(TARGET_DIR)) {
    action = 'updated';
    await pullRepo();
  } else if (existsSync(TARGET_DIR)) {
    const msg = `Path exists but is not a git repository: ${TARGET_DIR}`;
    if (flags.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
    } else {
      console.error(msg);
      console.error('Move or remove the folder and rerun.');
    }
    process.exit(1);
  } else {
    action = 'cloned';
    await cloneRepo();
  }

  const latestVersion = await getLatestNpmVersion();

  let tagToCheckout = flags.tag;
  if (tagToCheckout === 'latest') {
    if (!latestVersion) {
      log('Warning: could not resolve latest npm version, staying on default branch.');
      tagToCheckout = null;
    } else {
      tagToCheckout = `v${latestVersion}`;
    }
  }

  if (tagToCheckout) {
    await checkoutTag(tagToCheckout);
  }

  const sha = await getCurrentSha();
  const ref = await getCurrentRef();

  const result = {
    ok: true,
    action,
    path: TARGET_DIR,
    ref: ref.name,
    refType: ref.type,
    commit: sha,
    latestNpmVersion: latestVersion,
    package: PACKAGE_NAME,
    repoUrl: REPO_URL,
  };

  if (flags.listExamples) {
    result.examples = listExamples();
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  log('');
  log(`Action:        ${result.action}`);
  log(`Path:          ${result.path}`);
  log(`Ref:           ${ref.type} ${ref.name}`);
  log(`Commit:        ${sha}`);
  log(`Latest on npm: ${latestVersion ?? '(unavailable)'}`);
  if (flags.listExamples && result.examples) {
    log('');
    log(`Examples (${result.examples.length}):`);
    for (const ex of result.examples) {
      log(`  - ${ex.name}${ex.description ? ` -- ${ex.description}` : ''}`);
    }
  }
}

main().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n');
  } else {
    console.error(`Error: ${msg}`);
  }
  process.exit(1);
});
