import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { ConfigError, loadConfig, parseOrigin } from '../../server/config';
import { type Database, openDatabase } from '../../server/db/database';
import { createRateLimiter } from '../../server/http';
import { resolveStaticFile } from '../../server/static';
import { apiErrorSchema } from '../../shared/schemas/api';
import { testConfig } from './helpers';

let root: string;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'fitness-static-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>app</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'app-abc123.js'), 'console.log(1)');
  mkdirSync(join(root, 'mediapipe', 'wasm'), { recursive: true });
  writeFileSync(join(root, 'mediapipe', 'wasm', 'vision.wasm'), Buffer.from([0, 97, 115, 109]));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

let db: Database | undefined;
let app: FastifyInstance;
const build = (overrides: Partial<typeof testConfig> = {}) => {
  db = openDatabase(':memory:');
  app = buildApp({ config: { ...testConfig, ...overrides }, db });
  return app;
};
afterEach(async () => {
  if (!db) return;
  await app.close();
  db.close();
  db = undefined;
});

describe('production config', () => {
  it('serves the frontend in production and requires a database URL there', () => {
    const c = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'file:/srv/app.db', CORS_ORIGIN: 'https://fit.example.com' });
    expect(c.staticDir).toMatch(/dist$/);
    expect(c.corsOrigin).toBe('https://fit.example.com');
    expect(loadConfig({}).staticDir).toBeNull();
    expect(loadConfig({ SERVE_FRONTEND: 'true', STATIC_DIR: '/x/dist' }).staticDir).toBe('/x/dist');
  });

  it('accepts only a bare origin for CORS_ORIGIN', () => {
    expect(parseOrigin('http://localhost:5173')).toBe('http://localhost:5173');
    expect(parseOrigin('https://fit.example.com/')).toBe('https://fit.example.com');
    for (const bad of ['*', 'fit.example.com', 'https://fit.example.com/app', 'ftp://x.com']) {
      expect(() => parseOrigin(bad), bad).toThrow(ConfigError);
    }
  });
});

describe('static frontend', () => {
  it('serves index.html, fingerprinted assets and wasm with correct types and caching', async () => {
    build({ staticDir: root });
    const home = await app.inject({ method: 'GET', url: '/' });
    expect(home.statusCode).toBe(200);
    expect(home.headers['content-type']).toContain('text/html');
    expect(home.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.headers['content-type']).toContain('text/javascript');
    expect(asset.headers['cache-control']).toContain('immutable');

    const wasm = await app.inject({ method: 'GET', url: '/mediapipe/wasm/vision.wasm' });
    expect(wasm.headers['content-type']).toBe('application/wasm');
  });

  it('falls back to index.html for unknown pages but never serves /api paths as files', async () => {
    build({ staticDir: root });
    expect((await app.inject({ method: 'GET', url: '/some/page' })).body).toContain('<title>app</title>');
    const api = await app.inject({ method: 'GET', url: '/api/unknown' });
    expect(api.statusCode).toBe(404);
    expect(apiErrorSchema.parse(api.json()).error.code).toBe('not_found');
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().status).toBe('ok');
  });

  it('never serves files outside the static root', async () => {
    expect(resolveStaticFile(root, '/../package.json')).toBeNull();
    expect(resolveStaticFile(root, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull();
    expect(resolveStaticFile(root, '/assets/%00x')).toBeNull();
    expect(resolveStaticFile(root, '/%E0%A4%A')).toBeNull();
    build({ staticDir: root });
    const res = await app.inject({ method: 'GET', url: '/..%2f..%2fpackage.json' });
    expect(res.body).not.toContain('"dependencies"');
  });

  it('is not served in development/test (Vite serves the frontend there)', async () => {
    build();
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(404);
  });
});

describe('CORS and security headers', () => {
  it('allows only the configured origin', async () => {
    build({ corsOrigin: 'https://fit.example.com' });
    const ok = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://fit.example.com' } });
    expect(ok.headers['access-control-allow-origin']).toBe('https://fit.example.com');
    const evil = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://evil.example.com' } });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight: allowed origin gets methods, others get nothing to use', async () => {
    build({ corsOrigin: 'https://fit.example.com' });
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/profile', headers: { origin: 'https://fit.example.com', 'access-control-request-method': 'PUT' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-methods']).toContain('PUT');
    const denied = await app.inject({ method: 'OPTIONS', url: '/api/profile', headers: { origin: 'https://evil.example.com' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    expect(denied.headers['access-control-allow-methods']).toBeUndefined();
  });

  it('sends no CORS headers at all when no origin is configured (same-origin only)', async () => {
    build();
    const res = await app.inject({ method: 'GET', url: '/api/health', headers: { origin: 'https://fit.example.com' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('adds security headers to every response', async () => {
    build();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
    expect(res.headers['permissions-policy']).toContain('camera=(self)');
  });
});

describe('AI endpoint rate limit', () => {
  it('limits requests per client per window', () => {
    let t = 0;
    const limiter = createRateLimiter(2, 60_000, () => t);
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('b')]).toEqual([0, 0, 0]);
    expect(limiter.hit('a')).toBe(60);
    t = 30_000;
    expect(limiter.hit('a')).toBe(30);
    t = 60_000;
    expect(limiter.hit('a')).toBe(0);
  });

  it('answers 429 with Retry-After once the limit is reached', async () => {
    build({ aiRateLimitPerMinute: 2 });
    const url = '/api/ai/experiments/00000000-0000-4000-8000-000000000000/analysis';
    expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url, payload: {} })).statusCode).toBe(404);
    const limited = await app.inject({ method: 'POST', url, payload: {} });
    expect(limited.statusCode).toBe(429);
    expect(apiErrorSchema.parse(limited.json()).error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    // Other endpoints are not limited.
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });
});
