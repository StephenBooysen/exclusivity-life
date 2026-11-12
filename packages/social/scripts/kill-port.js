'use strict';

/**
 * Frees the app's port when a previous run is still holding it — the usual
 * cause of "EADDRINUSE" after a hard stop. Reads the same default as
 * backend/config.js so the two cannot drift.
 */

const { execSync } = require('node:child_process');

const port = process.env.PORT || 9401;

function killWindows() {
  const output = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', shell: 'cmd.exe' });
  const pids = new Set();
  for (const line of output.split('\n')) {
    const pid = line.trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid) && pid !== '0') pids.add(pid);
  }
  if (!pids.size) throw new Error('no listener');
  for (const pid of pids) {
    execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', shell: 'cmd.exe' });
    console.log(`Freed port ${port} (pid ${pid})`);
  }
}

function killPosix() {
  const pids = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (!pids.length) throw new Error('no listener');
  for (const pid of pids) {
    execSync(`kill -9 ${pid}`);
    console.log(`Freed port ${port} (pid ${pid})`);
  }
}

try {
  if (process.platform === 'win32') killWindows();
  else killPosix();
} catch {
  console.log(`Nothing listening on port ${port}.`);
}
