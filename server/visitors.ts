import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type Database, withTransaction } from './db/database.ts';
import { AppError } from './errors.ts';
import { createRateLimiter } from './http.ts';

/**
 * Anonymous visitor identity for the public demo (no login).
 *
 * The first profile save creates a visitor and sets a random 256-bit token in
 * an HttpOnly, SameSite=Lax cookie scoped to /api. The database stores only a
 * SHA-256 hash of the token. Every private route resolves the visitor from the
 * cookie and works on that visitor's rows only (the visitor id IS the user id),
 * so requests without a valid cookie (including direct calls to the backend
 * URL) can never read or change anyone's data.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the visitor hook when the request carries a valid visitor cookie. */
    visitorId: string | null;
  }
}

export const VISITOR_COOKIE = 'fl_visitor';
const DAY_MS = 86_400_000;
/** last_seen_at (and the cookie's expiry) is refreshed at most this often, to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 10 * 60_000;
/** 32 random bytes, base64url: exactly 43 characters. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/**
 * Routes that work without a demo session. Everything else under /api needs a
 * valid visitor cookie; this is enforced centrally (before body validation) and
 * again in each handler via requireVisitor.
 */
/** Always allowed, even over the write limit, so a visitor can always delete their data. */
const WRITE_LIMIT_EXEMPT = new Set(['DELETE /api/visitor']);
const PUBLIC_ROUTES = new Set(['GET /api/health', 'GET /api/exercises', 'GET /api/exercises/:id', 'GET /api/profile', 'PUT /api/profile']);

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/** Value of one cookie from a Cookie header, or null. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function visitorCookie(token: string, opts: { secure: boolean; maxAgeSeconds: number }): string {
  return [
    `${VISITOR_COOKIE}=${token}`,
    'Path=/api',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSeconds}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

/* ---------- storage ---------- */

interface VisitorRow {
  id: string;
  last_seen_at: string;
}

/** Inserts a visitor. Callers create the visitor's profile in the same transaction. */
export function insertVisitor(db: Database, now: Date): { id: string; token: string } {
  const id = randomUUID();
  const token = newToken();
  const at = now.toISOString();
  db.prepare('INSERT INTO visitors (id, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?)').run(id, hashToken(token), at, at);
  return { id, token };
}

/** All of a visitor's data: the profile row cascades to workouts, sessions, events, experiments, results, reports and proposals. */
export function deleteVisitor(db: Database, id: string): void {
  withTransaction(db, () => {
    db.prepare('DELETE FROM user_profiles WHERE id = ?').run(id);
    db.prepare('DELETE FROM visitors WHERE id = ?').run(id);
  });
}

/** The visitor for a cookie token, or null if unknown or inactive for longer than the retention period (then it is deleted). */
export function findVisitor(db: Database, token: string, now: Date, retentionDays: number): VisitorRow | null {
  if (!TOKEN_PATTERN.test(token)) return null;
  const row = db.prepare('SELECT id, last_seen_at FROM visitors WHERE token_hash = ?').get(hashToken(token)) as VisitorRow | undefined;
  if (!row) return null;
  if (now.getTime() - Date.parse(row.last_seen_at) > retentionDays * DAY_MS) {
    deleteVisitor(db, row.id);
    return null;
  }
  return row;
}

/** Delete every visitor inactive for longer than the retention period, with all their data. Returns how many. */
export function purgeInactiveVisitors(db: Database, now: Date, retentionDays: number): number {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
  const ids = (db.prepare('SELECT id FROM visitors WHERE last_seen_at < ?').all(cutoff) as unknown as { id: string }[]).map((r) => r.id);
  for (const id of ids) deleteVisitor(db, id);
  // AI usage counters are only needed for the current day.
  db.prepare('DELETE FROM ai_usage WHERE day < ?').run(new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10));
  return ids.length;
}

/**
 * Count one AI analysis against today's (UTC) per-visitor and overall limits.
 * Usage rows are not tied to the visitor row, so deleting your data does not reset the overall count.
 */
export function useAiQuota(
  db: Database,
  visitorId: string,
  now: Date,
  limits: { perVisitor: number; total: number },
): 'ok' | 'visitor_limit' | 'total_limit' {
  const day = now.toISOString().slice(0, 10);
  return withTransaction(db, () => {
    const mine = (db.prepare('SELECT count FROM ai_usage WHERE visitor_id = ? AND day = ?').get(visitorId, day) as { count: number } | undefined)?.count ?? 0;
    if (mine >= limits.perVisitor) return 'visitor_limit';
    const all = (db.prepare('SELECT COALESCE(SUM(count), 0) AS n FROM ai_usage WHERE day = ?').get(day) as { n: number }).n;
    if (all >= limits.total) return 'total_limit';
    db.prepare(
      `INSERT INTO ai_usage (visitor_id, day, count) VALUES (?, ?, 1)
       ON CONFLICT (visitor_id, day) DO UPDATE SET count = count + 1`,
    ).run(visitorId, day);
    return 'ok';
  });
}

/* ---------- HTTP ---------- */

export interface VisitorOptions {
  db: Database;
  secureCookies: boolean;
  retentionDays: number;
  newVisitorsPerIpPerHour: number;
  newVisitorsPerHourTotal: number;
  /** State-changing requests per client IP per minute for visitors with a demo session. */
  writeRateLimitPerMinute: number;
  /** Injectable clock for tests. */
  now?: () => Date;
}

export interface VisitorGate {
  /** Cookie options for this deployment. */
  cookie(token: string): string;
  clearCookie(): string;
  /** Throws 429 if this IP (or everyone together) has created too many visitors in the last hour. */
  admitNewVisitor(request: FastifyRequest, reply: FastifyReply): void;
  now(): Date;
}

/**
 * Resolves the visitor from the cookie on every /api request and rejects
 * cross-site state-changing requests (CSRF defence in addition to SameSite=Lax).
 */
export function registerVisitorAuth(app: FastifyInstance, opts: VisitorOptions): VisitorGate {
  const clock = opts.now ?? (() => new Date());
  const maxAgeSeconds = opts.retentionDays * 86_400;
  const perIp = createRateLimiter(opts.newVisitorsPerIpPerHour, 3_600_000);
  const overall = createRateLimiter(opts.newVisitorsPerHourTotal, 3_600_000);
  const writes = createRateLimiter(opts.writeRateLimitPerMinute, 60_000);
  const gate: VisitorGate = {
    cookie: (token) => visitorCookie(token, { secure: opts.secureCookies, maxAgeSeconds }),
    clearCookie: () => visitorCookie('', { secure: opts.secureCookies, maxAgeSeconds: 0 }),
    admitNewVisitor(request, reply) {
      const wait = Math.max(perIp.hit(request.ip), overall.hit('all'));
      if (wait > 0) {
        reply.header('Retry-After', String(wait));
        throw new AppError(429, 'rate_limited', 'Too many new demo sessions from your network. Please try again later.');
      }
    },
    now: clock,
  };

  app.decorateRequest('visitorId', null);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    if (!SAFE_METHODS.has(request.method) && request.headers['sec-fetch-site'] === 'cross-site') {
      throw new AppError(403, 'forbidden', 'Cross-site requests are not allowed');
    }
    const token = readCookie(request.headers.cookie, VISITOR_COOKIE);
    if (token) {
      const now = clock();
      const visitor = findVisitor(opts.db, token, now, opts.retentionDays);
      if (!visitor) {
        // Unknown, expired, or lost (e.g. the demo database was reset): drop the stale cookie.
        reply.header('Set-Cookie', gate.clearCookie());
      } else {
        request.visitorId = visitor.id;
        if (now.getTime() - Date.parse(visitor.last_seen_at) > TOUCH_INTERVAL_MS) {
          opts.db.prepare('UPDATE visitors SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), visitor.id);
          reply.header('Set-Cookie', gate.cookie(token)); // sliding expiry
        }
      }
    }
    // Central guard for every matched private API route. Unknown paths (no route, or the static
    // frontend's catch-all) fall through to the JSON 404 and reveal nothing.
    const route = request.routeOptions.url;
    if (!request.visitorId && route !== undefined && route !== '/*' && !PUBLIC_ROUTES.has(`${request.method} ${route}`)) {
      requireVisitor(request);
    }

    // Write limit for visitors with a session, keyed by the client IP Fastify resolved under TRUST_PROXY.
    // (Creating a session is limited separately by admitNewVisitor; requests without a session are rejected above.)
    if (request.visitorId && !SAFE_METHODS.has(request.method) && !WRITE_LIMIT_EXEMPT.has(`${request.method} ${route}`)) {
      const wait = writes.hit(request.ip);
      if (wait > 0) {
        reply.header('Retry-After', String(wait));
        throw new AppError(429, 'rate_limited', `Too many changes in a short time. Try again in ${wait} seconds.`);
      }
    }
  });
  return gate;
}

/** The current visitor's id (their user id), or 401. */
export function requireVisitor(request: FastifyRequest): string {
  if (!request.visitorId) throw new AppError(401, 'unauthorized', 'Create a profile first to start your demo session.');
  return request.visitorId;
}
