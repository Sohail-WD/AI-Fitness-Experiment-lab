import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { AppError } from './errors.ts';

/**
 * Serve the built frontend (`npm run build` → dist/) from the API server in
 * production, so the app is one origin and needs no CORS. Unknown non-API paths
 * fall back to index.html (the app uses hash routing). /api paths are never
 * served as files. Paths are resolved inside the static root only.
 */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/** Absolute file path for a URL path inside `root`, or null if it escapes the root or is not a file. */
export function resolveStaticFile(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = resolve(root);
  const full = resolve(join(base, decoded));
  if (full !== base && !full.startsWith(base + sep)) return null;
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return full;
}

export function registerStaticFrontend(app: FastifyInstance, root: string): boolean {
  const index = join(root, 'index.html');
  if (!existsSync(index)) {
    app.log.warn(`Frontend not served: ${index} not found. Run "npm run build" first.`);
    return false;
  }

  app.get('/*', async (request, reply) => {
    const urlPath = request.url.split('?')[0];
    if (urlPath === '/api' || urlPath.startsWith('/api/')) {
      throw new AppError(404, 'not_found', `Route GET ${urlPath} not found`);
    }
    const file = resolveStaticFile(root, urlPath) ?? index;
    const type = CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    // Vite fingerprints /assets/*; the HTML shell must always be revalidated.
    const cache = file === index ? 'no-cache' : urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    return reply.header('Content-Type', type).header('Cache-Control', cache).send(createReadStream(file));
  });
  return true;
}
