import type { FastifyInstance } from 'fastify';

/**
 * Small HTTP hardening layer (no extra dependencies):
 * - CORS: only the configured frontend origin may call the API cross-origin.
 *   Same-origin requests (the frontend served by this server, or the Vite dev
 *   proxy) need no CORS at all.
 * - Conservative security headers on every response.
 */
export function registerHttpHardening(app: FastifyInstance, opts: { corsOrigin: string | null }): void {
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const allowed = origin !== undefined && opts.corsOrigin !== null && origin === opts.corsOrigin;
    if (allowed) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
    }
    // Answer CORS preflight for the API. A disallowed origin gets no Allow-Origin header, so the browser blocks it.
    if (request.method === 'OPTIONS' && request.url.startsWith('/api/')) {
      if (allowed) {
        reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
        reply.header('Access-Control-Allow-Headers', 'Content-Type, Accept');
        reply.header('Access-Control-Max-Age', '600');
      }
      return reply.status(204).send();
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    // The camera is only ever used by this app itself.
    reply.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    return payload;
  });
}

/**
 * Fixed-window rate limiter keyed by client (in memory; resets on restart).
 * Enough to stop accidental or scripted floods of paid AI calls.
 */
export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    /** Records one request; returns seconds to wait when over the limit, else 0. */
    hit(key: string): number {
      const t = now();
      if (windows.size > 10_000) for (const [k, w] of windows) if (t - w.start >= windowMs) windows.delete(k);
      const w = windows.get(key);
      if (!w || t - w.start >= windowMs) {
        windows.set(key, { start: t, count: 1 });
        return 0;
      }
      w.count += 1;
      return w.count > limit ? Math.ceil((w.start + windowMs - t) / 1000) : 0;
    },
  };
}
