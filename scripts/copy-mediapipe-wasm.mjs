// Copies MediaPipe's WASM runtime into public/ so it is served by this app
// instead of a third-party CDN. Runs automatically before dev and build.
import { cpSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const target = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  console.error(`MediaPipe WASM not found at ${source}. Run "npm install" first.`);
  process.exit(1);
}

cpSync(source, target, { recursive: true });
console.log(`Copied MediaPipe WASM to ${target}`);
