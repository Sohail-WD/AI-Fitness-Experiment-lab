// Claude Code hook helper (dev tooling only; not part of the app).
//   post-edit: after editing a .ts/.tsx file under src|shared|server|tests, run the type check.
//   stop:      at the end of a turn, run the test suite only if source files changed since the last green run.
// Success → one short line. Failure → only the relevant error lines, exit 2 (fed back to Claude).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const mode = process.argv[2];
let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // No or invalid stdin: treat as empty payload.
}

const run = (cmd) => spawnSync(cmd, { cwd: root, encoding: 'utf8', shell: true, maxBuffer: 20 * 1024 * 1024 });
const ok = (msg) => {
  process.stdout.write(`${JSON.stringify({ systemMessage: msg, suppressOutput: true })}\n`);
  process.exit(0);
};
const fail = (title, lines) => {
  process.stderr.write(`${title}\n${lines.join('\n')}\n`);
  process.exit(2);
};

const SOURCE_DIRS = ['src', 'shared', 'server', 'tests'];

if (mode === 'post-edit') {
  const file = String(input.tool_input?.file_path ?? input.tool_response?.filePath ?? '');
  const inSource = new RegExp(`[\\\\/](${SOURCE_DIRS.join('|')})[\\\\/]`).test(file);
  if (!/\.tsx?$/.test(file) || !inSource) process.exit(0);

  const checks = ['npx tsc --noEmit'];
  if (/[\\/](server|shared)[\\/]/.test(file)) checks.push('npx tsc -p tsconfig.server.json');
  for (const cmd of checks) {
    const r = run(cmd);
    if (r.status !== 0) {
      const errors = `${r.stdout}${r.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
      fail(`Typecheck failed (${cmd}):`, errors.slice(0, 15).concat(errors.length > 15 ? [`… ${errors.length - 15} more`] : []));
    }
  }
  ok('✓ typecheck ok');
}

if (mode === 'stop') {
  if (input.stop_hook_active) process.exit(0); // never loop on a failing suite
  const stamp = join(root, '.claude', '.verify-stamp');
  const since = existsSync(stamp) ? statSync(stamp).mtimeMs : 0;
  const newer = (dir) => {
    if (!existsSync(dir)) return false;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory() ? newer(p) : /\.(ts|tsx|mjs|css)$/.test(entry.name) && statSync(p).mtimeMs > since) return true;
    }
    return false;
  };
  if (!SOURCE_DIRS.some((d) => newer(join(root, d)))) process.exit(0); // nothing changed: skip

  const r = run('npx vitest run');
  const out = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, '');
  if (r.status === 0) {
    writeFileSync(stamp, new Date().toISOString());
    const summary = out.match(/Tests\s+(\d+ passed[^\n]*)/);
    ok(`✓ tests ${summary ? summary[1].trim() : 'passed'}`);
  }
  const relevant = out.split('\n').filter((l) => /FAIL|×|AssertionError|Error:|expected|Tests\s/.test(l));
  fail('Tests failed:', relevant.slice(0, 30));
}

process.exit(0);
