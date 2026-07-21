#!/usr/bin/env node

// noinspection UnnecessaryLocalVariableJS

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const os = require('os');

const version = '2025.11.25-0506';
console.log(`Update script version: ${version}`);

// Name of this folder
const scriptDirName = require('path').basename(__dirname);
// Changing the working directory to a script directory
process.chdir(__dirname);
const CWD = process.cwd();
const VON = path.resolve(path.join(CWD, '..'));

// Default configuration
const DEFAULT_CONFIG = {
  branch: 'master',
  email: '',
};

// Colors for terminal  output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

const color = {};
const colorG = {};
['cyan', 'green', 'magenta', 'red', 'yellow'].forEach((col) => {
  const firstLetter = col[0];
  color[firstLetter] = (text) => `${colors.bright}${colors[col]}${text}${colors.reset}`;
  color[`l${firstLetter}`] = (text) => `${colors[col]}${text}${colors.reset}`;
  colorG[firstLetter] = (text) => `${colors.bright}${colors[col]}${text}${colors.green}`;
  colorG[`l${firstLetter}`] = (text) => `${colors[col]}${text}${colors.green}`;
});

// Echo functions with colors
const echo = {
  c: (text) => console.log(color.c(text)),
  lc: (text) => console.log(color.lc(text)),
  g: (text) => console.log(color.g(text)),
  lg: (text) => console.log(color.lg(text)),
  m: (text) => console.log(color.m(text)),
  lm: (text) => console.log(color.lm(text)),
  r: (text) => console.log(color.r(text)),
  lr: (text) => console.log(color.lr(text)),
  y: (text) => console.log(color.y(text)),
  ly: (text) => console.log(color.ly(text)),
  lg_no_newline: (msg) => process.stdout.write(color.lg(msg)),
};

let logBuffer = '';

// Global variable to store NVM environment
let setupScript = '';
let nodeVersion = null;
const DEFAULT_NODE_VERSION = '22.17.1';

const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0].replace('T', '');
const ytdl = timestamp.slice(2, 14); // YYMMDDHHMMSS format
const runTimeLogFile = path.join(VON, `deploy__${scriptDirName}__processing__${ytdl}.log`);
const lastDeployLogFile = path.join(VON, `deploy__${scriptDirName}__last_deploy.log`);
const cumulativeLogFile = path.join(VON, `deploy__${scriptDirName}__cumulative.log`);

const clearColors = (text) => text.replace(/\x1B\[[0-9;]*[mGKH]/g, '');
const clearHtmlColors = (text) => text.replace(/<\/?(red|y|g|r|status)>/g, '');

const logIt = (msg, isTitle) => {
  if (isTitle) {
    const lng = 60 - (msg.length + 2);
    const left = Math.floor(lng / 2);
    const right = lng - left;
    msg = `${'='.repeat(left)} ${msg} ${'='.repeat(right)}`;
  }
  const msg4console = clearHtmlColors(msg);
  echo.g(msg4console);
  logBuffer += `${msg}\n`;
  fs.appendFileSync(runTimeLogFile, `${clearColors(msg4console)}\n`);
};

const logError = (msg) => {
  console.error(color.r(msg));
  const msg2 = `[ERROR] ${msg}`;
  logBuffer += `<red>${msg2}</red>\n`;
  fs.appendFileSync(cumulativeLogFile, `${msg2}\n`);
};

const nowPretty = () => new Date().toISOString().replace('T', ' ').substring(0, 19) + 'Z';

/**
 * Truncate cumulative log file if it exceeds 2MB, keeping last 10KB
 */
const truncateCumulativeLogIfNeeded = () => {
  const logFile = path.join(VON, `deploy__${scriptDirName}__cumulative.log`);
  const maxFileSize = 2 * 1024 * 1024; // 2MB
  const keepSize = 10 * 1024; // 10KB

  try {
    if (fs.existsSync(logFile)) {
      const stats = fs.statSync(logFile);
      if (stats.size > maxFileSize) {
        // Read last 10KB
        const fd = fs.openSync(logFile, 'r');
        const buffer = Buffer.alloc(keepSize);

        // Position to last 10KB
        fs.readSync(fd, buffer, 0, keepSize, stats.size - keepSize);
        fs.closeSync(fd);

        // Write back only the last 10KB
        const tailContent = buffer.toString('utf8').replace(/^[\r\n]*/, ''); // Remove leading newlines
        fs.writeFileSync(logFile, tailContent);

        logIt(`Cumulative log truncated to ${Math.round(tailContent.length / 1024)}KB`);
      }
    }
  } catch (error) {
    logError(`Failed to truncate cumulative log: ${error.message}`);
  }
};

const logTryUpdate = (updateReason = '') => {
  truncateCumulativeLogIfNeeded();
  updateReason = updateReason ? `Update reason: ${updateReason}` : '';
  const message = updateReason || nowPretty();
  fs.appendFileSync(cumulativeLogFile, `${message}\n`);
};

/**
 * Execute command in NVM environment
 */
function execCommand(command, options = {}, withSetupScript = false) {
  // If we have NVM setup, wrap the command
  const fullCommand = setupScript && withSetupScript ? `${setupScript} && ${command}` : command;
  try {
    // noinspection UnnecessaryLocalVariableJS
    const result = execSync(fullCommand, {
      encoding: 'utf8',
      stdio: options.silent ? 'inherit' : 'pipe',
      shell: '/bin/bash',
      ...options,
    });
    return result;
  } catch (error) {
    throw error;
  }
}

function execWithNODE(command, options = {}) {
  return execCommand(command, options, true);
}

/**
 * Load NVM environment and get Node.js version
 */
function loadNVMEnvironment() {
  try {
    if (fs.existsSync('.envrc')) {
      const envrcContent = fs.readFileSync('.envrc', 'utf8');

      // Extract Node.js version from .envrc for logging
      const nodeVersionMatch = envrcContent.match(/nvm use\s+([0-9.]+)/);
      const nodeV = nodeVersionMatch ? nodeVersionMatch[1] : null;

      if (nodeV) {
        nodeVersion = nodeV;
      }
      setupScript = 'source .envrc';
    }
  } catch {
    logError('Error loading .envrc file');
  }
}

/**
 * Parse command line arguments
 */
function parseArgs() {
  const pArgs = process.argv.slice(2);
  const args = {
    expectedBranch: null,
    help: false,
    force: false,
  };

  for (let i = 0; i < pArgs.length; i++) {
    const arg = pArgs[i];
    switch (arg) {
      case '-b':
      case '--branch':
        args.expectedBranch = pArgs[++i];
        break;
      case '-f':
      case '--force':
        args.force = true;
        break;
      case '-?':
      case '--help':
        args.help = true;
        break;
    }
  }

  return args;
}

/**
 * Show help information
 */
function showHelp() {
  console.log(`
================================================================================
    Project update and rebuild

    Usage:
        node update.js [Options]

    Options:

    -b|--branch
        GIT branch name. Default - master
    -l|--log
        Switch to log display mode after completion
    -?|--help
        Display help

    Example: node update.js -b production -l
================================================================================
`);
}

/**
 * Parse simple YAML content (key: value format)
 */
function parseSimpleYAML(content) {
  const config = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (trimmed && !trimmed.startsWith('#')) {
      // Parse key: value pairs
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const [, key, valueRaw] = trimmed.match(/^\s*([^:]+?)\s*:\s*(.*)\s*$/) || [];
        let value = valueRaw ? valueRaw.replace(/^(['"])(.*)\1$/, '$2') : '';
        // Handle empty values
        if (value === 'null' || value === '~') {
          value = '';
        }
        config[key] = value;
      }
    }
  }

  return config;
}

/**
 * Load configuration from YAML file
 */
function loadConfig() {
  // Load NVM environment from .envrc
  loadNVMEnvironment();

  const configFile = path.join(process.cwd(), 'deploy', 'config.yml');

  // Get Node.js version from NVM environment if available
  if (!fs.existsSync(configFile)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const configContent = fs.readFileSync(configFile, 'utf8');
    const config = parseSimpleYAML(configContent);

    return {
      branch: config.branch || DEFAULT_CONFIG.branch,
      nodeVersion: config.nodeVersion,
      email: config.email || DEFAULT_CONFIG.email,
    };
  } catch (error) {
    console.warn(`Warning: Could not parse config file ${configFile}:`, error.message);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Get service name from package.json and .env
 */
function getServiceName() {
  let serviceName = '';
  let serviceInstance = '';
  try {
    if (fs.existsSync('.env')) {
      const envContent = fs.readFileSync('.env', 'utf8');
      let match = envContent.match(/^SERVICE_NAME=([^\r\n]+)/m);
      if (match) {
        serviceName = match[1].trim();
      }
      match = envContent.match(/^SERVICE_INSTANCE=([^\r\n]+)/m);
      if (match) {
        serviceInstance = `--${match[1].trim()}`;
      }
    }
    if (!serviceName) {
      const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
      serviceName = packageJson.name;
    }

    return {
      serviceName,
      serviceNamePM: `${serviceName}${serviceInstance}`,
    };
  } catch (error) {
    console.error('Error getting service name:', error.message);
    process.exit(1);
  }
}

/**
 * Check if systemctl service exists
 */
function systemctlServiceExists(serviceName) {
  try {
    execCommand(`systemctl list-unit-files "${serviceName}.service"`);
    return true;
  } catch {
    return false;
  }
}

function pm2ServiceExists(serviceName) {
  try {
    const res = execCommand(`pm2 id "${serviceName}"`);
    return /\[\s*\d\s*]/.test(res);
  } catch {
    return false;
  }
}

/**
 * Get git repository information
 */
function getRepoInfo() {
  try {
    const branch = execCommand('git rev-parse --abbrev-ref HEAD').trim();
    const headHash = execCommand('git rev-parse HEAD').trim();
    // const headShortHash = execCommand('git rev-parse --short HEAD').trim();
    const headCommitMessage = execCommand(`git log -n 1 --pretty=format:%s ${headHash}`).trim();
    const headDdate = execCommand(
      `git log -n 1 --format="%at" ${headHash} | xargs -I{} date -d @{} +%d.%m.%Y_%H:%M:%S`,
    ).trim();
    execCommand(`git fetch origin ${branch} --prune`);

    const upstreamHash = execCommand(`git rev-parse ${branch}@{upstream}`).trim();
    // const upstreamShortHash = execCommand(`git rev-parse --short ${branch}@{upstream}`).trim();
    // const upstreamCommitMessage = execCommand(`git log -n 1 --pretty=format:%s ${upstreamHash}`).trim();

    return {
      branch,
      headDdate,
      headHash,
      headCommitMessage,
      upstreamHash,
    };
  } catch (error) {
    const message = String(error.message).includes(error.stderr)
      ? error.message
      : [error.stderr, error.message].join('\n');

    console.error('Error getting repo info:', message);
    return null;
  }
}

const colorizeHTML = (text) =>
  text
    .replace(/<red>/g, '<span style="color:#ff0000;">')
    .replace(/<\/red>/g, '</span>')
    .replace(/<y>/g, '<span style="background-color:#ffff00;">')
    .replace(/<\/y>/g, '</span>')
    .replace(/<g>/g, '<span style="background-color:#00ff00;">')
    .replace(/<\/g>/g, '</span>')
    .replace(/<r>/g, '<span style="background-color:#ff0000; color:#ffffff;">')
    .replace(/<\/r>/g, '</span>')
    .replace(/\[ERROR]/g, '<span style="color:#ffffff; background-color: #ff0000">[ERROR]</span>');

async function sendBuildNotification(emails, status, body, serviceName) {
  if (!emails) {
    return;
  }
  let s = '';
  if (status === 'FAIL') {
    s = `<r>FAIL</r> `;
  } else if (status === 'SUCCESS') {
    s = `<g>SUCCESS</g> `;
  }
  body = body.replace('<status>', s);

  // Create HTML email content
  const hostname = os.hostname();
  const htmlContent = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "https://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${status} Update ${serviceName} (on ${hostname})</title>
</head>
<body>
<pre>
${colorizeHTML(clearColors(body))}
</pre></body></html>`;

  // Send to each email address
  const emailArray = emails
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email);

  for (let i = 0; i < emailArray.length; i++) {
    const emailAddress = emailArray[i];
    try {
      logIt(`Sending update notification to: ${emailAddress}`);
      const subject = `${status} Update: ${serviceName} (on ${hostname})`;

      const command = `mail -a "Content-Type: text/html; charset=UTF-8" -s "${subject.replace(/"/g, '\\"')}" "${emailAddress}"`;
      const child = spawn('/bin/bash', ['-lc', command], { stdio: ['pipe', 'inherit', 'inherit'] });
      child.stdin.write(htmlContent);
      child.stdin.end();

      await new Promise((resolve, reject) => {
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`mail exit code ${code}`))));
        child.on('error', reject);
      });
    } catch (error) {
      console.error(`Failed to send email to ${emailAddress}:`, error.message);
    }
  }
}

const printCurrenBranch = () => {
  const i = getRepoInfo();
  logIt(`Current branch: ${colorG.lg(i.branch)}
Last commit: ${colorG.lg(i.headHash)}, date: ${colorG.lg(i.headDdate)}    
Commit message: ${colorG.lg(i.headCommitMessage)}`);
  return i;
};

let scriptsDirName = fs.existsSync(path.join(CWD, '_sh/npm/yarn-ci.sh')) ? '_sh' : 'scripts';

const reinstallDependencies = () => {
  logIt('CLEAN INSTALL DEPENDENCIES', true);

  execCommand('rm -rf node_modules/');
  execWithNODE('yarn install --frozen-lockfile');
  logIt('Dependencies installed');

  // Patch node modules if patch file exists
  const patchFile = path.join(scriptsDirName, 'patch_node_modules.js');
  if (fs.existsSync(patchFile)) {
    logIt('PATCH NODE MODULES', true);
    execWithNODE(`node --no-node-snapshot ${patchFile}`);
    logIt('Node modules patched');
  }
};

const compile = () => {
  logIt('TYPESCRIPT BUILD', true);
  execWithNODE('yarn cb', { silent: true });
  logIt('TypeScript build completed');
};

const buildQuasar = () => {
  if (!fs.existsSync(path.join(CWD, 'quasar.config.js'))) {
    return;
  }
  logIt('BUILD QUASAR', true);
  execWithNODE(`node ./${scriptsDirName}/quasar-prepare-color-vars.mjs`);
  const result = execWithNODE('yarn quasar build');
  logIt(result);
  logIt('Quasar build completed');
};

const restartService = (serviceNamePM) => {
  let srvc = '';
  if (systemctlServiceExists(serviceNamePM)) {
    srvc = 'systemctl';
  } else if (pm2ServiceExists(serviceNamePM)) {
    srvc = 'pm2';
  } else {
    logIt(`Service ${serviceNamePM} not found in systemctl or PM2`);
    return;
  }
  logIt(`Restarting service ${serviceNamePM} via ${srvc}`, true);
  execCommand(`${srvc} restart "${serviceNamePM}"`);
  logIt(`Service restarted`);
};

/**
 * Main update function
 */
async function main() {
  logTryUpdate();
  fs.writeFileSync(runTimeLogFile, '');
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  // Get service information
  const { serviceName, serviceNamePM } = getServiceName();

  logIt(`<status>Update <y>${colorG.y(serviceName)}</y> ${nowPretty()}`);

  logIt(`Working directory: ${colorG.y(CWD)}`);
  // Load configuration
  const config = loadConfig();

  let from = ' DEFAULT';
  if (nodeVersion) {
    from = ' .envrc';
  } else if (config.nodeVersion) {
    ({ nodeVersion } = config);
    from = ' deploy/config.yaml';
  }

  logIt(`Using Node.js version: ${nodeVersion || DEFAULT_NODE_VERSION}${from}`);

  // Override branch if specified in arguments
  const expectedBranch = args.expectedBranch || config.branch;
  let updateDeployedLogFile = false;
  try {
    // 1) If there are local changes, roll back
    const hasChanges = execCommand('git status --porcelain').trim().length > 0;
    if (hasChanges) {
      logIt(`Found uncommited changes. Reset to HEAD...`);
      execCommand('git reset --hard HEAD');
      execCommand(`git clean -fd`);
    }

    let needUpdate = false;
    let updateReason = args.force ? 'force' : '';
    const repoInfo = getRepoInfo();
    let { branch, headHash, upstreamHash } = repoInfo;

    // 2) If the branch is not the same, hard switch to the head of the deleted expectedBranch
    const expectedUpstream = `origin/${expectedBranch}`;
    if (branch !== expectedBranch) {
      needUpdate = true;
      updateReason += `${updateReason ? '. ' : ''}branch !== expectedBranch (${branch} != ${expectedBranch})`;
      logIt(`Switch to branch ${expectedBranch}...`);
      execCommand(`git fetch origin ${expectedBranch} --prune`);
      execCommand(`git checkout -B ${expectedBranch} ${expectedUpstream}`);
      execCommand(`git reset --hard ${expectedUpstream}`);
      execCommand(`git clean -fd`);
      const i = printCurrenBranch();
      ({ branch, headHash, upstreamHash } = i);
      if (branch !== expectedBranch) {
        throw new Error(`Failed to switch to branch ${expectedBranch}`);
      }
    }

    if (headHash !== upstreamHash) {
      // 3) The branch is the same, but we need to tighten up the changes
      needUpdate = true;
      updateReason += `${updateReason ? '. ' : ''}headHash !== upstreamHash (${headHash} != ${upstreamHash})`;
      printCurrenBranch();
      logIt(`FOUND CHANGES. UPDATE branch ${expectedBranch}...`);
      execCommand(`git fetch origin ${expectedBranch} --prune`);
      execCommand(`git checkout -B ${expectedBranch} ${expectedUpstream}`);
      execCommand(`git reset --hard ${expectedUpstream}`);
      execCommand(`git clean -fd`);
      printCurrenBranch();
    }

    if (needUpdate || args.force) {
      updateDeployedLogFile = true;
      logTryUpdate(updateReason);
      reinstallDependencies();
      compile();
      buildQuasar();
      restartService(serviceNamePM);

      // Add completion info to build log
      logIt(`Update completed successfully at ${new Date().toISOString().replace('T', ' ').substring(0, 19)}`);
      // Send build notification if email is configured
      if (config.email) {
        await sendBuildNotification(config.email, 'SUCCESS', logBuffer, serviceName);
      } else {
        logIt('EMAIL not found');
      }
    } else {
      logIt('No changes detected. Update skipped.');
    }
  } catch (err) {
    const message = String(err.message).includes(err.stderr) ? err.message : [err.stderr, err.message].join('\n');
    logError(message);
    if (config.email) {
      await sendBuildNotification(config.email, 'FAIL', logBuffer, serviceName);
    }
  } finally {
    logIt('#FINISH#');
    if (updateDeployedLogFile) {
      fs.copyFileSync(runTimeLogFile, lastDeployLogFile);
    }
    execCommand(`rm -rf "${runTimeLogFile}"`);
  }
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\nUpdate process interrupted');
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('\nUpdate process terminated');
  process.exit(1);
});

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Update failed:', error.message);
    process.exit(1);
  });
