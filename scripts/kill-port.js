#!/usr/bin/env node
/**
 * Kill process on specified port (cross-platform)
 * Usage: node scripts/kill-port.js [port_number]
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const port = process.argv[2];

if (!port) {
  console.error('Usage: node scripts/kill-port.js [port_number]');
  process.exit(1);
}

async function killProcessOnPort(portNumber) {
  const isWindows = process.platform === 'win32';

  console.log(`Searching for process on port ${portNumber}...`);

  try {
    if (isWindows) {
      // Windows: netstat + taskkill
      let stdout;
      try {
        const result = await execAsync(`netstat -ano | findstr :${portNumber}`);
        ({ stdout } = result);
      } catch {
        // findstr returns error when no matches found
        console.log(`No process found on port ${portNumber}`);
        return;
      }

      if (!stdout || !stdout.trim()) {
        console.log(`No process found on port ${portNumber}`);
        return;
      }

      // Parse PIDs from netstat output
      const lines = stdout.trim().split('\n');
      const pids = new Set();

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0' && !isNaN(pid)) {
          pids.add(pid);
        }
      }

      if (pids.size === 0) {
        console.log(`No process found on port ${portNumber}`);
        return;
      }

      // Kill all PIDs
      for (const pid of pids) {
        try {
          console.log(`Found process PID: ${pid}`);
          await execAsync(`taskkill /F /PID ${pid}`);
          console.log(`Process ${pid} on port ${portNumber} killed`);
        } catch (error) {
          console.error(`Failed to kill process ${pid}:`, error.message);
        }
      }
    } else {
      // Unix-like: lsof + kill
      try {
        const { stdout } = await execAsync(`lsof -ti:${portNumber}`);

        if (!stdout.trim()) {
          console.log(`No process found on port ${portNumber}`);
          return;
        }

        const pids = stdout
          .trim()
          .split('\n')
          .filter((pid) => pid);

        for (const pid of pids) {
          try {
            console.log(`Found process PID: ${pid}`);
            await execAsync(`kill -9 ${pid}`);
            console.log(`Process ${pid} on port ${portNumber} killed`);
          } catch (error) {
            console.error(`Failed to kill process ${pid}:`, error.message);
          }
        }
      } catch (error) {
        if (error.message.includes('No such file or directory')) {
          console.error('Error: lsof command not found. Please install lsof.');
          process.exit(1);
        }
        console.log(`No process found on port ${portNumber}`);
      }
    }
  } catch (error) {
    if (error.stdout && error.stdout.includes('')) {
      console.log(`No process found on port ${portNumber}`);
    } else {
      console.error('Error:', error.message);
      process.exit(1);
    }
  }
}

killProcessOnPort(port);
