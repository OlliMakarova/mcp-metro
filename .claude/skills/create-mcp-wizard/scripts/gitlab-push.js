#!/usr/bin/env node
/**
 * Create a project on a GitLab server and push the current directory to it.
 *
 * Resolves groupId from --group <name> via GET /groups?search=<name> (exact match on
 * `full_path` or `name`), then POSTs /projects with { name, path, namespace_id }.
 * Finally runs `git init / add / commit / remote add / push -u origin <branch>`.
 *
 * Environment / flags:
 *   --base-url  <url>    (e.g. https://gitlab.corp.com/api/v4) — required
 *   --token     <tok>    GitLab private token — required
 *   --group     <name>   Group name or full path (e.g. "mcp-servers") — required unless --group-id is given
 *   --group-id  <n>      Numeric group id — overrides --group lookup
 *   --name      <name>   Project name — required
 *   --path      <slug>   URL slug (kebab-case). Defaults to --name lowercased / slugified
 *   --cwd       <dir>    Directory to push. Defaults to process.cwd()
 *   --branch    <name>   Branch to push. Defaults to "main"
 *   --visibility <v>     private|internal|public (default: private)
 *   --dry-run            Print what would happen, don't call API or git
 *
 * ENV fallbacks: GITLAB_BASE_URL, GITLAB_TOKEN, GITLAB_GROUP, GITLAB_GROUP_ID.
 */

import https from 'https';
import http from 'http';
import { URL } from 'url';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

function getOpt (flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag (flag) {
  return process.argv.includes(flag);
}

const baseUrl  = getOpt('--base-url')  || process.env.GITLAB_BASE_URL;
const token    = getOpt('--token')     || process.env.GITLAB_TOKEN;
let   groupArg = getOpt('--group')     || process.env.GITLAB_GROUP;
let   groupId  = getOpt('--group-id')  || process.env.GITLAB_GROUP_ID;
const projectName = getOpt('--name');
const projectPath = getOpt('--path') || (projectName
  ? projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  : undefined);
const cwd    = path.resolve(getOpt('--cwd') || process.cwd());
const branch = getOpt('--branch') || 'main';
const visibility = getOpt('--visibility') || 'private';
const dryRun = hasFlag('--dry-run');

function die (msg, code = 1) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

if (!baseUrl)     die('Missing --base-url (or GITLAB_BASE_URL). Example: https://gitlab.corp.com/api/v4');
if (!token)       die('Missing --token (or GITLAB_TOKEN).');
if (!projectName) die('Missing --name (project name).');
if (!groupId && !groupArg) die('Missing --group or --group-id.');

function request (method, url, bodyObj) {
  const u = new URL(url);
  const lib = u.protocol === 'http:' ? http : https;
  const body = bodyObj ? JSON.stringify(bodyObj) : null;
  const opts = {
    method,
    hostname: u.hostname,
    port: u.port || (u.protocol === 'http:' ? 80 : 443),
    path: u.pathname + u.search,
    headers: {
      'PRIVATE-TOKEN': token,
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  };
  return new Promise((resolve, reject) => {
    const req = lib.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else reject(new Error(`HTTP ${res.statusCode} ${u.pathname}: ${text}`));
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function sh (cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  if (dryRun) return '';
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], cwd, ...opts }).toString().trim();
}

async function resolveGroupId () {
  if (groupId) return Number(groupId);
  console.log(`[gitlab] Looking up group "${groupArg}" …`);
  const url = `${baseUrl.replace(/\/$/, '')}/groups?search=${encodeURIComponent(groupArg)}&per_page=100`;
  if (dryRun) return 0;
  const res = await request('GET', url);
  if (!Array.isArray(res) || res.length === 0) die(`No groups found matching "${groupArg}".`);
  const exact = res.find((g) => g.full_path === groupArg || g.path === groupArg || g.name === groupArg);
  const pick = exact || res[0];
  console.log(`[gitlab] group: ${pick.full_path} (id=${pick.id})`);
  return pick.id;
}

async function createProject (namespaceId) {
  console.log(`[gitlab] Creating project "${projectName}" (path=${projectPath}) in namespace ${namespaceId} …`);
  const url = `${baseUrl.replace(/\/$/, '')}/projects`;
  if (dryRun) return { ssh_url_to_repo: 'git@example:stub.git', http_url_to_repo: 'https://example/stub.git', web_url: 'https://example/stub' };
  const body = {
    name: projectName,
    path: projectPath,
    namespace_id: namespaceId,
    visibility,
    initialize_with_readme: false,
  };
  const res = await request('POST', url, body);
  console.log(`[gitlab] created: ${res.web_url}`);
  return res;
}

function gitPush (remoteUrl) {
  console.log(`[git] Initializing and pushing ${cwd} to ${remoteUrl} …`);
  if (!fs.existsSync(path.join(cwd, '.git'))) sh('git init');
  sh(`git checkout -B ${branch}`);
  sh('git add -A');
  try {
    sh('git diff --cached --quiet');
    console.log('[git] Nothing to commit — working tree already clean.');
  } catch {
    sh('git commit -m "Initial commit (scaffolded by fa-mcp)"');
  }
  try { sh('git remote remove origin'); } catch { /* no origin yet */ }
  sh(`git remote add origin ${remoteUrl}`);
  sh(`git push -u origin ${branch}`);
}

(async () => {
  try {
    const nsId = await resolveGroupId();
    const project = await createProject(nsId);
    const remote = project.ssh_url_to_repo || project.http_url_to_repo;
    if (!remote) die('GitLab did not return a repo URL.');
    gitPush(remote);
    console.log(`\nDone. ${project.web_url || remote}`);
  } catch (e) {
    die(e.message);
  }
})();
