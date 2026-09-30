// Starts the backend (dev:server) and the frontend (dev) together.
// Ctrl+C stops both. Equivalent to running the two scripts in separate terminals.
import { spawn } from 'node:child_process';

const children = ['dev:server', 'dev'].map((script) =>
  spawn('npm', ['run', script], { stdio: 'inherit', shell: true }),
);

let stopping = false;
const stopAll = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exit(code);
};

for (const child of children) child.on('exit', (code) => stopAll(code ?? 0));
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
