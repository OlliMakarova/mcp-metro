import { spawn } from 'child_process';
import os from 'os';

function runScript(command, args) {
  const process = spawn(command, args);

  process.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  process.stderr.on('data', (data) => {
    console.error(data.toString());
  });

  process.on('close', (code) => {
    console.log(`${command} script is completed with code: ${code}`);
  });
}

const platform = os.platform();

const scriptType = process.argv[2] === 'reinstall' ? 'reinstall' : 'ci';

const scriptsPath = `./scripts/npm/yarn-${scriptType}`;

if (platform === 'win32') {
  runScript('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', `${scriptsPath}.ps1`]);
} else {
  runScript('bash', [`${scriptsPath}.sh`]);
}
