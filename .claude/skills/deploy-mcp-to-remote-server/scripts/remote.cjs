#!/usr/bin/env node
'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// mcp-metro — remote deployment orchestrator (runs on the developer workstation).
//
// Model: a self-contained systemd Docker image. The server keeps NOTHING but
// Docker + one Caddy block. The image (docker/Dockerfile) carries no app code;
// at boot it clones the repo (read-only Deploy Key passed via env), writes
// config/local.yaml + deploy/config.yml + .env, builds, installs the app as a
// systemd service, and runs update.cjs from cron every minute (Telegram verdict).
//
// This orchestrator only: builds the image on the server context-lessly
// (`docker build -`), runs the container, wires up Caddy, and drives lifecycle.
//
//   node remote.cjs keygen      # create a read-only GitHub Deploy Key
//   node remote.cjs deploy      # build image + (re)create container + Caddy
//   node remote.cjs status      # diagnostics
//   node remote.cjs stop        # stop the container (auto-update stops with it)
//   node remote.cjs start       # start the container
//   node remote.cjs restart     # restart just the app service (fast, no rebuild)
//   node remote.cjs update      # force update.cjs --force inside the container
//   node remote.cjs logs [N]    # last N app-service journal lines (default 200)
//   node remote.cjs updatelog   # auto-update verdict + error scan + last-run log
//   node remote.cjs uninstall --yes   # remove container, image, volume, Caddy block
//   node remote.cjs ssh         # print the raw ssh command
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONFIG_FILE = path.join(__dirname, '..', 'remote-server-config.local.yaml');

const CONTAINER = 'mcp-metro';
const IMAGE = 'mcp-metro:latest';
const VOLUME = 'mcp-metro-data';
const SERVICE = 'mcp-metro--prod'; // SERVICE_NAME (mcp-metro) + --SERVICE_INSTANCE (prod)
const NODE_VERSION = '22.17.1'; // must match docker/Dockerfile
const NODE_BIN = `/root/.nvm/versions/node/v${NODE_VERSION}/bin/node`;
const DOCKERFILE = path.join(__dirname, '..', 'docker', 'Dockerfile');

// ── Minimal nested-YAML reader (maps + scalars, 2-space indent, no arrays) ────
function parseYaml(text) {
  const root = {};
  const stack = [{ indent: -1, obj: root }];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\t/g, '  ').replace(/(^|\s)#.*$/, '$1');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const m = line.trim().match(/^([^:]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].obj;
    if (value === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[key] = value.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return root;
}

// Extract the raw text under a top-level key, dedented by one level — used to
// reproduce config/local.yaml verbatim (comments, quoting) without a lossy
// parse/emit round-trip.
function extractRawBlock(text, topKey) {
  const lines = text.split('\n');
  const out = [];
  let inside = false;
  let baseIndent = 2;
  for (const line of lines) {
    if (!inside) {
      if (new RegExp(`^${topKey}:\\s*$`).test(line)) {
        inside = true;
        // Detect the child indent from the first non-blank child line later.
      }
      continue;
    }
    if (line.trim() === '') {
      out.push('');
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // next top-level key ends the block
    if (out.length === 0 || out.every((l) => l === '')) baseIndent = indent;
    out.push(line.slice(baseIndent));
  }
  // Drop leading/trailing blank lines.
  while (out.length && out[0] === '') out.shift();
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

// Container paths of the update.cjs bookkeeping logs (VON = parent of the project dir,
// name = its basename): deploy__<name>__status.log / __last_deploy.log / __cumulative.log.
function logPaths(cfg) {
  const p = cfg.projectPath.replace(/\/+$/, '');
  const von = p.replace(/\/[^/]+$/, '') || '/';
  const name = p.replace(/^.*\//, '');
  const base = `${von}/deploy__${name}__`;
  return { status: `${base}status.log`, lastDeploy: `${base}last_deploy.log`, cumulative: `${base}cumulative.log` };
}

function fail(msg) {
  console.error(`\x1b[1;31m[remote][ERROR]\x1b[0m ${msg}`);
  process.exit(1);
}
function say(msg) {
  console.log(`\x1b[1;36m[remote]\x1b[0m ${msg}`);
}
function b64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}
function sq(v) {
  return `'${String(v).replace(/'/g, `'\\''`)}'`;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    fail(`Config not found: ${CONFIG_FILE}\nCopy remote-server-config.example.yaml to it and fill it in.`);
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
  const cfg = parseYaml(raw);
  const server = cfg.server || {};
  const project = cfg.project || {};
  const git = cfg.git || {};
  const mcp = cfg.mcp || {};
  const envSection = cfg.env || {};
  const local = cfg.configLocalYaml || {};
  const telegram = local.telegram || {};
  const req = (v, name) => {
    if (!v) fail(`Missing required config value: ${name}`);
    return v;
  };
  // deploy/config.yml content = the deployConfigYaml block verbatim (branch, email)
  // plus the Telegram credentials pulled from configLocalYaml.telegram, so the
  // container's update.cjs can notify via Telegram without duplicating them by hand.
  const telegramLines =
    (telegram.botToken ? `telegramBotToken: ${telegram.botToken}\n` : '') +
    (telegram.chatId ? `telegramChatId: ${telegram.chatId}\n` : '');
  return {
    host: req(server.host, 'server.host'),
    port: server.port || '22',
    user: req(server.user, 'server.user'),
    keyPath: req(server.keyPath, 'server.keyPath'),
    repoUrl: req(project.repoUrl || git.repoUrl, 'project.repoUrl'),
    deployKeyPath: git.deployKeyPath || project.deployKeyPath || '',
    branch: project.branch || 'master',
    projectPath: project.projectPath || '/opt/node/mcp-metro',
    statePath: req(project.statePath, 'project.statePath'),
    dns: req(mcp.dns, 'mcp.dns'),
    debug: envSection.DEBUG || 'config-info',
    appPort: (local.webServer && local.webServer.port) || '9049',
    localYaml: extractRawBlock(raw, 'configLocalYaml'),
    deployConfigYaml: extractRawBlock(raw, 'deployConfigYaml') + telegramLines,
  };
}

// ── SSH helpers ──────────────────────────────────────────────────────────────
function sshBaseArgs(cfg) {
  return [
    '-i', cfg.keyPath,
    '-p', String(cfg.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=15',
    `${cfg.user}@${cfg.host}`,
  ];
}

// Execute on the server. For non-interactive runs the script is streamed to a
// remote `bash -l` over stdin — no base64, no command-line length limits (large
// scripts embedding keys/config would otherwise overflow a single ssh argument).
// For interactive runs, `script` is a ready remote command (small) run under a TTY.
function sshRun(cfg, script, { interactive = false } = {}) {
  if (interactive) {
    const res = spawnSync('ssh', ['-t', ...sshBaseArgs(cfg), script], { stdio: 'inherit' });
    if (res.error) fail(`ssh failed to start: ${res.error.message}`);
    return res.status;
  }
  const res = spawnSync('ssh', [...sshBaseArgs(cfg), 'bash -l'], {
    input: script,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (res.error) fail(`ssh failed to start: ${res.error.message}`);
  return res.status;
}

// Pipe local data to a remote command's stdin (used for `docker build -`).
function sshPipe(cfg, remoteCmd, input) {
  const res = spawnSync('ssh', [...sshBaseArgs(cfg), remoteCmd], {
    input,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (res.error) fail(`ssh failed to start: ${res.error.message}`);
  return res.status;
}

function caddyBlock(cfg) {
  return [
    `# mcp-metro — MCP Metro server (Docker container on 127.0.0.1:${cfg.appPort})`,
    `${cfg.dns} {`,
    '\tencode gzip',
    `\treverse_proxy 127.0.0.1:${cfg.appPort} {`,
    '\t\ttransport http {',
    '\t\t\tread_timeout 120s',
    '\t\t\twrite_timeout 120s',
    '\t\t}',
    '\t}',
    `\tlog {`,
    `\t\toutput file /opt/log/caddy/${cfg.dns}.log`,
    '\t}',
    '}',
  ].join('\n');
}

function caddySnippet(cfg) {
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  // Transactional: build + validate a temp copy first, and only overwrite the
  // real Caddyfile (which serves all other sites) if validation passes. This
  // guarantees the live config is never left in a broken state.
  return `
CF=/etc/caddy/Caddyfile
if [ ! -f "$CF" ]; then
  echo "WARNING: $CF not found — configure the reverse proxy for ${cfg.dns} manually."
elif grep -qE "^\\s*${dnsEsc}\\s*\\{" "$CF"; then
  echo "Caddy already has a block for ${cfg.dns}."
else
  echo "Appending Caddy block for ${cfg.dns}..."
  mkdir -p /opt/log/caddy
  # Caddy runs as its own user; pre-create the per-site log owned like the log dir
  # (usually caddy:caddy) so the reload can open it (validate does not catch this).
  touch /opt/log/caddy/${cfg.dns}.log
  chown --reference=/opt/log/caddy /opt/log/caddy/${cfg.dns}.log 2>/dev/null || true
  TMP="$(mktemp)"
  cp "$CF" "$TMP"
  printf '\\n%s\\n' ${sq(caddyBlock(cfg))} >> "$TMP"
  if caddy validate --adapter caddyfile --config "$TMP" >/dev/null 2>&1; then
    cp "$TMP" "$CF"
    rm -f "$TMP"
    systemctl reload caddy && echo "Caddy reloaded — ${cfg.dns} is live."
  else
    rm -f "$TMP"
    echo "ERROR: Caddy validation failed — the live Caddyfile was left UNCHANGED. Not adding ${cfg.dns}."
    exit 1
  fi
fi`;
}

// ── Subcommands ──────────────────────────────────────────────────────────────
function cmdKeygen(cfg) {
  const target = cfg.deployKeyPath || path.join(path.dirname(cfg.keyPath), 'mcp-metro-deploy');
  if (fs.existsSync(target)) {
    say(`Key already exists: ${target}`);
  } else {
    say(`Generating read-only Deploy Key: ${target}`);
    const res = spawnSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-f', target, '-C', 'mcp-metro-deploy'], {
      stdio: 'inherit',
    });
    if (res.status !== 0) fail('ssh-keygen failed.');
  }
  const pub = fs.readFileSync(`${target}.pub`, 'utf8').trim();
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('Add this PUBLIC key to GitHub as a READ-ONLY Deploy Key:');
  console.log('  repo → Settings → Deploy keys → Add deploy key');
  console.log('  Title: mcp-metro server    Allow write access: LEAVE UNCHECKED');
  console.log('──────────────────────────────────────────────────────────────');
  console.log(pub);
  console.log('──────────────────────────────────────────────────────────────');
  if (!cfg.deployKeyPath) {
    console.log(`Then set  git.deployKeyPath: ${target}  in remote-server-config.local.yaml`);
  }
}

function cmdDeploy(cfg) {
  if (!cfg.deployKeyPath) fail('git.deployKeyPath is not set. Run: node remote.cjs keygen');
  if (!fs.existsSync(cfg.deployKeyPath)) fail(`Deploy key not found: ${cfg.deployKeyPath}. Run: node remote.cjs keygen`);
  if (!fs.existsSync(DOCKERFILE)) fail(`Dockerfile not found: ${DOCKERFILE}`);

  const keyB64 = b64(fs.readFileSync(cfg.deployKeyPath, 'utf8'));
  const localYamlB64 = b64(cfg.localYaml);
  const deployCfgB64 = b64(cfg.deployConfigYaml);
  const dockerfile = fs.readFileSync(DOCKERFILE, 'utf8');

  say('Ensuring Docker is installed on the server...');
  const preflight = `
set -e
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker not found — installing via get.docker.com...'
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker version >/dev/null`;
  if (sshRun(cfg, preflight) !== 0) fail('Docker is not available on the server.');

  say(`Building image ${IMAGE} on ${cfg.user}@${cfg.host} (context-less)...`);
  let code = sshPipe(cfg, `DOCKER_BUILDKIT=1 docker build -t ${IMAGE} -`, dockerfile);
  if (code !== 0) fail('Image build failed. See output above.');

  const runScript = `
set -euo pipefail
echo 'Recreating container...'
docker rm -f ${CONTAINER} >/dev/null 2>&1 || true
docker volume create ${VOLUME} >/dev/null
# Host directory that persistently holds the downloaded metro data (data-cache),
# bind-mounted over the app's cache dir so it survives container/volume removal.
mkdir -p ${sq(cfg.statePath)}
docker run -d --name ${CONTAINER} --restart unless-stopped \
  --privileged --cgroupns=host \
  --tmpfs /run --tmpfs /run/lock \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  -p 127.0.0.1:${cfg.appPort}:${cfg.appPort} \
  -v ${VOLUME}:${cfg.projectPath} \
  -v ${sq(cfg.statePath)}:${cfg.projectPath}/data-cache \
  -e REPO_URL=${sq(cfg.repoUrl)} \
  -e BRANCH=${sq(cfg.branch)} \
  -e PROJECT_DIR=${sq(cfg.projectPath)} \
  -e DEBUG=${sq(cfg.debug)} \
  -e GIT_SSH_KEY_B64=${sq(keyB64)} \
  -e CONFIG_LOCAL_YAML_B64=${sq(localYamlB64)} \
  -e DEPLOY_CONFIG_YAML_B64=${sq(deployCfgB64)} \
  ${IMAGE}
echo 'Container started. First boot clones + builds inside the container (a few minutes).'
${caddySnippet(cfg)}
`;
  say('Starting container and wiring up Caddy...');
  code = sshRun(cfg, runScript);
  if (code !== 0) fail(`Deploy failed (exit ${code}). Run: node remote.cjs status`);
  say(`Done. First boot builds inside the container; watch it with: node remote.cjs status`);
  say(`Public endpoint (once built): https://${cfg.dns}/health`);
}

function cmdStatus(cfg) {
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  const lp = logPaths(cfg);
  const script = `
echo '===== CONTAINER ====='
docker ps -a --filter name=^/${CONTAINER}$ --format 'status: {{.Status}}' || true
echo "health: $(docker inspect -f '{{.State.Health.Status}}' ${CONTAINER} 2>/dev/null || echo n/a)"
echo
echo '===== APP SERVICE (inside container) ====='
docker exec ${CONTAINER} systemctl is-active ${SERVICE} 2>/dev/null || echo 'app service not active yet (may still be building)'
docker exec ${CONTAINER} test -f /opt/node/.mcp-bootstrap-done 2>/dev/null && echo 'bootstrap: done' || echo 'bootstrap: still running (first-time clone/build)'
echo
echo '===== GIT (inside container) ====='
docker exec ${CONTAINER} bash -lc 'cd ${cfg.projectPath} 2>/dev/null && git log -1 --pretty="HEAD %h %ci %s"' 2>/dev/null || echo '(repo not cloned yet)'
echo
echo '===== HEALTH ====='
curl -fsS -m 5 "http://127.0.0.1:${cfg.appPort}/health" && echo || echo 'local /health FAILED'
curl -fsS -m 8 "https://${cfg.dns}/health" && echo || echo 'public /health FAILED'
echo
echo '===== AUTO-UPDATE ====='
docker exec ${CONTAINER} cat /etc/cron.d/mcp-update 2>/dev/null || echo 'cron file not present yet'
echo -n 'last update verdict: '
docker exec ${CONTAINER} cat ${lp.status} 2>/dev/null || echo '(no update has run yet — cron checks every minute)'
ERRS=$(docker exec ${CONTAINER} grep -aF '[ERROR]' ${lp.lastDeploy} 2>/dev/null | wc -l | tr -d ' ')
if [ "\${ERRS:-0}" -gt 0 ] 2>/dev/null; then
  echo "⚠ \${ERRS} error line(s) in the last update run — details: node remote.cjs updatelog"
  docker exec ${CONTAINER} grep -aF '[ERROR]' ${lp.lastDeploy} 2>/dev/null | tail -4
else
  echo 'no errors flagged in the last update run'
fi
echo
echo '===== CADDY ====='
grep -qE "^\\s*${dnsEsc}\\s*\\{" /etc/caddy/Caddyfile 2>/dev/null && echo 'Caddy block present' || echo 'Caddy block MISSING'
`;
  say(`Diagnostics for ${cfg.dns}`);
  sshRun(cfg, script);
}

function cmdStop(cfg) {
  say('Stopping container (auto-update stops with it)');
  sshRun(cfg, `docker stop ${CONTAINER} && echo stopped`);
}

function cmdStart(cfg) {
  say('Starting container');
  sshRun(cfg, `docker start ${CONTAINER} && echo started`);
}

function cmdRestart(cfg) {
  say('Restarting the app service inside the container (no rebuild)');
  sshRun(cfg, `docker exec ${CONTAINER} systemctl restart ${SERVICE} && echo restarted`);
}

function cmdUpdate(cfg) {
  say('Forcing update.cjs --force inside the container');
  sshRun(cfg, `docker exec ${CONTAINER} ${NODE_BIN} ${cfg.projectPath}/update.cjs --force`);
}

function cmdLogs(cfg, n) {
  const lines = /^\d+$/.test(String(n)) ? n : '200';
  say(`Last ${lines} app-service log lines`);
  sshRun(cfg, `docker exec ${CONTAINER} journalctl -o cat --no-pager -n ${lines} -u ${SERVICE}`);
}

function cmdBootlog(cfg, n) {
  const lines = /^\d+$/.test(String(n)) ? n : '200';
  say(`Last ${lines} bootstrap (clone/build) log lines`);
  sshRun(cfg, `docker exec ${CONTAINER} journalctl -o cat --no-pager -n ${lines} -u mcp-bootstrap.service`);
}

// Inspect the auto-update history: the last verdict, the full last-update run log,
// and every error line — so a failed rebuild is easy to spot and diagnose.
function cmdUpdatelog(cfg, n) {
  const lines = /^\d+$/.test(String(n)) ? n : '80';
  const lp = logPaths(cfg);
  const script = `
echo '===== LAST UPDATE VERDICT ====='
docker exec ${CONTAINER} cat ${lp.status} 2>/dev/null || echo '(no update has run yet — cron checks every minute)'
echo
echo '===== ERROR LINES (last run + history) ====='
{ docker exec ${CONTAINER} grep -aF '[ERROR]' ${lp.lastDeploy} 2>/dev/null;
  docker exec ${CONTAINER} grep -aF '[ERROR]' ${lp.cumulative} 2>/dev/null; } | tail -20
docker exec ${CONTAINER} sh -c "grep -aqF '[ERROR]' ${lp.lastDeploy} ${lp.cumulative} 2>/dev/null" && true || echo '(no [ERROR] entries found)'
echo
echo '===== LAST UPDATE RUN LOG (tail ${lines}) ====='
docker exec ${CONTAINER} tail -n ${lines} ${lp.lastDeploy} 2>/dev/null || echo '(no completed update run recorded yet)'
`;
  say('Auto-update log and error scan');
  sshRun(cfg, script);
}

// Open an interactive shell inside the container (for debugging/testing).
function cmdShell(cfg) {
  say('Opening an interactive shell inside the container (exit to leave)');
  sshRun(cfg, `docker exec -it ${CONTAINER} bash -l`, { interactive: true });
}

// Run an arbitrary command inside the container: `node remote.cjs exec -- <cmd...>`.
function cmdExec(cfg, args) {
  const idx = args.indexOf('--');
  const parts = idx >= 0 ? args.slice(idx + 1) : args;
  if (!parts.length) fail('Usage: node remote.cjs exec -- <command...>');
  const inner = parts.join(' ');
  say(`Running in container: ${inner}`);
  sshRun(cfg, `docker exec ${CONTAINER} bash -lc ${sq(inner)}`);
}

function cmdUninstall(cfg, yes) {
  if (!yes) {
    fail('Destructive. Re-run with --yes to remove container, image, volume and Caddy block:\n' +
      '  node remote.cjs uninstall --yes');
  }
  const dnsEsc = cfg.dns.replace(/\./g, '\\.');
  const script = `
set -uo pipefail
echo 'Removing container, image and volume...'
docker rm -f ${CONTAINER} 2>/dev/null || true
docker volume rm ${VOLUME} 2>/dev/null || true
docker rmi ${IMAGE} 2>/dev/null || true
echo 'Removing Caddy block for ${cfg.dns}...'
CF=/etc/caddy/Caddyfile
if [ -f "$CF" ] && grep -qE "^\\s*${dnsEsc}\\s*\\{" "$CF"; then
  BAK="$CF.bak.$(date +%s)"; cp "$CF" "$BAK"
  awk 'BEGIN{skip=0}
    /^[[:space:]]*${dnsEsc}[[:space:]]*\\{/{skip=1; next}
    skip==1 && /^\\}/{skip=0; next}
    skip==0{print}
  ' "$BAK" > "$CF"
  caddy validate --adapter caddyfile --config "$CF" >/dev/null 2>&1 && systemctl reload caddy && echo 'Caddy block removed.' \
    || { cp "$BAK" "$CF"; echo 'Caddy validation failed — restored from backup.'; }
fi
echo 'Done.'
`;
  say('Uninstalling mcp-metro from the server');
  sshRun(cfg, script);
}

function cmdSsh(cfg) {
  console.log(`ssh ${sshBaseArgs(cfg).join(' ')}`);
}

// ── Entry point ──────────────────────────────────────────────────────────────
function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const cfg = loadConfig();
  switch (cmd) {
    case 'keygen': return cmdKeygen(cfg);
    case 'deploy': return cmdDeploy(cfg);
    case 'status': return cmdStatus(cfg);
    case 'stop': return cmdStop(cfg);
    case 'start': return cmdStart(cfg);
    case 'restart': return cmdRestart(cfg);
    case 'update': return cmdUpdate(cfg);
    case 'logs': return cmdLogs(cfg, rest[0]);
    case 'bootlog': return cmdBootlog(cfg, rest[0]);
    case 'updatelog': return cmdUpdatelog(cfg, rest[0]);
    case 'shell': return cmdShell(cfg);
    case 'exec': return cmdExec(cfg, rest);
    case 'uninstall': return cmdUninstall(cfg, rest.includes('--yes'));
    case 'ssh': return cmdSsh(cfg);
    default:
      console.log(`mcp-metro remote orchestrator — subcommands:
  keygen            Create a read-only GitHub Deploy Key and print the public part
  deploy            Build the image on the server + (re)create the container + Caddy
  status            Diagnostics: container, app service, git, health, cron, Caddy
  stop              Stop the container (auto-update stops with it)
  start             Start the container
  restart           Restart just the app service (fast, no rebuild)
  update            Force update.cjs --force inside the container
  logs [N]          Last N app-service journal lines (default 200)
  bootlog [N]       Last N bootstrap (clone/build) journal lines (default 200)
  updatelog [N]     Last auto-update verdict + error scan + last-run log (default 80)
  shell             Open an interactive bash shell inside the container
  exec -- <cmd...>  Run an arbitrary command inside the container
  uninstall --yes   Remove container, image, volume and Caddy block
  ssh               Print the raw ssh command for manual access`);
      if (cmd && cmd !== 'help') process.exit(1);
  }
}

main();
