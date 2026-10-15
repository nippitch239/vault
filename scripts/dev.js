#!/usr/bin/env node
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

console.log('\x1b[36m%s\x1b[0m', '▶ Starting SecureVault Local Environment...');
console.log('  • Backend API: http://localhost:3000');
console.log('  • Frontend UI: http://localhost:5173');
console.log('  Press Ctrl+C to terminate both services.\n');

const isWin = process.platform === 'win32';
const server = spawn('node', ['src/server/local-runner.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: false,
});

const client = spawn(isWin ? 'npm.cmd' : 'npm', ['--prefix', 'src/client', 'run', 'dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: isWin,
});

function killProcess(child) {
  if (!child || !child.pid) return;
  if (isWin) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      return;
    } catch {
      // ignore if already exited
    }
  }
  try {
    child.kill();
  } catch {
    // ignore
  }
}

function cleanup() {
  killProcess(server);
  killProcess(client);
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

server.on('exit', (code) => {
  if (code !== null && code !== 0) {
    cleanup();
  }
});

client.on('exit', (code) => {
  if (code !== null && code !== 0) {
    cleanup();
  }
});
