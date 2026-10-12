import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { ConfigError, loadConfig, parseTrustProxy } from '../../server/config';
import { type Database, openDatabase } from '../../server/db/database';
import { hashToken, purgeInactiveVisitors, readCookie, VISITOR_COOKIE } from '../../server/visitors';
import { experimentWithResultSchema } from '../../shared/schemas/experiment';
import { workoutSchema, workoutSessionSchema } from '../../shared/schemas/workout';
import { testConfig, withCookieJar } from './helpers';

let db: Database;
const apps: FastifyInstance[] = [];
afterEach(async () => {
  for (const a of apps.splice(0)) await a.close();
  if (db?.isOpen) db.close();
});

/** A separate browser (own cookie jar) against the shared test database. */
function browser(overrides: Partial<typeof testConfig> = {}) {
  const app = withCookieJar(buildApp({ config: { ...testConfig, ...overrides }, db }));
  apps.push(app);
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, payload, headers });
  return { app, call, get: (url: string) => call('GET', url), post: (url: string, payload: object = {}) => call('POST', url, payload) };
}
type Browser = ReturnType<typeof browser>;

const profile = (name: string) => ({
  profile: {
    name,
    fitnessLevel: 'beginner',
    goals: ['general_fitness'],
    trainingContext: 'recreationally_active',
    equipment: [],
    environment: { location: 'home' },
    availableMinutes: 15,
    schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
  },
  constraints: { restrictionTags: [], notes: '', source: 'self_reported' },
});

/** Visitor with a profile, a workout, a finished real session, simulated history, a completed SIMULATED experiment and a proposal. */
async function populated(b: Browser, name: string) {
  expect((await b.call('PUT', '/api/profile', profile(name))).statusCode).toBe(200);
  const workout = workoutSchema.parse((await b.post('/api/workouts/generate')).json());
  const session = workoutSessionSchema.parse((await b.post('/api/sessions', { workoutId: workout.id })).json());
  const sets = workout.items.flatMap((i) =>
    Array.from({ length: i.sets }, () => ({
      exerciseId: i.exerciseId,
      detectedReps: 5,
      validReps: 5,
      invalidReps: 0,
      metrics: { lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null },
      formIssues: [],
      measurementSource: 'manual',
    })),
  );
  expect((await b.post(`/api/sessions/${session.id}/complete`, { status: 'completed', metrics: { sessionId: session.id, sets, completionRatio: 1, activeDurationSeconds: 60 } })).statusCode).toBe(200);
  await b.post('/api/history/simulated', { weeks: 6 });
  const draft = experimentWithResultSchema.parse((await b.post('/api/experiments', { templateId: 'morning_vs_evening', useSimulatedData: true })).json());
  await b.post(`/api/experiments/${draft.experiment.id}/start`);
  const proposals = (await b.post('/api/adaptations/generate')).json().created as { id: string }[];
  expect(proposals).toHaveLength(1);
  return { workoutId: workout.id, sessionId: session.id, experimentId: draft.experiment.id, proposalId: proposals[0].id };
}

const countRows = (userId: string) =>
  ['workouts', 'workout_sessions', 'experiments', 'adaptation_proposals', 'user_constraints'].reduce(
    (n, t) => n + (db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE user_id = ?`).get(userId) as { c: number }).c,
    (db.prepare('SELECT COUNT(*) AS c FROM user_profiles WHERE id = ?').get(userId) as { c: number }).c,
  );
const visitorIds = () => (db.prepare('SELECT id FROM visitors ORDER BY created_at, rowid').all() as unknown as { id: string }[]).map((r) => r.id);

describe('visitor isolation', () => {
  it('one visitor cannot read, change or act on another visitor\'s data', async () => {
    db = openDatabase(':memory:');
    const a = browser();
    const b = browser();
    const ids = await populated(a, 'Alice');
    await b.call('PUT', '/api/profile', profile('Bob'));
    const [aliceId] = visitorIds();
    const before = countRows(aliceId);

    // B sees only B's own data.
    expect((await b.get('/api/profile')).json().profile.name).toBe('Bob');
    expect((await b.get('/api/history?source=all')).json().sessions).toEqual([]);
    expect((await b.get('/api/experiments')).json().experiments).toEqual([]);
    expect((await b.get('/api/adaptations')).json().proposals).toEqual([]);
    expect((await b.get('/api/workouts/latest')).statusCode).toBe(404);

    // Every attempt to address A's records by id behaves as if they did not exist.
    const attempts: [string, string, object?][] = [
      ['GET', `/api/sessions/${ids.sessionId}`],
      ['POST', `/api/sessions/${ids.sessionId}/events`, { events: [{ type: 'workout_paused', occurredAt: new Date().toISOString(), exerciseId: null, setIndex: null, data: {} }] }],
      ['POST', `/api/sessions/${ids.sessionId}/complete`, { status: 'abandoned', metrics: { sessionId: ids.sessionId, sets: [], completionRatio: 0, activeDurationSeconds: 0 } }],
      ['PUT', `/api/sessions/${ids.sessionId}/feedback`, { feedback: { effort: 1, enjoyment: 1 } }],
      ['POST', '/api/sessions', { workoutId: ids.workoutId }],
      ['POST', `/api/experiments/${ids.experimentId}/end`],
      ['POST', `/api/ai/experiments/${ids.experimentId}/analysis`],
      ['POST', `/api/adaptations/${ids.proposalId}/approve`],
      ['POST', `/api/adaptations/${ids.proposalId}/decline`],
      ['POST', `/api/adaptations/${ids.proposalId}/refresh`],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await b.call(method as 'GET', url, payload ?? {});
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    // B's bulk operations only touch B's rows.
    await b.call('DELETE', '/api/history/simulated');
    await b.post('/api/adaptations/generate');

    expect(countRows(aliceId)).toBe(before);
    expect((await a.get('/api/history?source=simulated')).json().sessions.length).toBeGreaterThan(0);
    expect((await a.get(`/api/sessions/${ids.sessionId}`)).json().feedback).toBeNull();
    expect((await a.get('/api/adaptations')).json().proposals[0].proposal.status).toBe('pending');
    expect((await a.get('/api/profile')).json().profile.name).toBe('Alice');
  });

  it('saving a profile again updates the same visitor instead of creating a new one', async () => {
    db = openDatabase(':memory:');
    const a = browser();
    await a.call('PUT', '/api/profile', profile('Alice'));
    await a.call('PUT', '/api/profile', profile('Alice B.'));
    expect(visitorIds()).toHaveLength(1);
    expect((await a.get('/api/profile')).json().profile.name).toBe('Alice B.');
  });
});

describe('unauthorized access', () => {
  const PRIVATE: [string, string][] = [
    ['GET', '/api/workouts/latest'],
    ['POST', '/api/workouts/generate'],
    ['POST', '/api/sessions'],
    ['GET', '/api/sessions/00000000-0000-4000-8000-000000000001'],
    ['POST', '/api/sessions/00000000-0000-4000-8000-000000000001/complete'],
    ['GET', '/api/history'],
    ['POST', '/api/history/simulated'],
    ['DELETE', '/api/history/simulated'],
    ['GET', '/api/experiments'],
    ['POST', '/api/experiments'],
    ['POST', '/api/experiments/00000000-0000-4000-8000-000000000001/start'],
    ['POST', '/api/ai/experiments/00000000-0000-4000-8000-000000000001/analysis'],
    ['GET', '/api/adaptations'],
    ['POST', '/api/adaptations/generate'],
    ['POST', '/api/adaptations/00000000-0000-4000-8000-000000000001/approve'],
    ['DELETE', '/api/visitor'],
  ];

  it('every private route answers 401 without a demo session, even with proxy/origin headers (direct backend calls)', async () => {
    db = openDatabase(':memory:');
    await populated(browser(), 'Alice'); // data exists, but a new caller has no cookie
    const stranger = browser();
    for (const [method, url] of PRIVATE) {
      const res = await stranger.call(method as 'GET', url, {}, { 'x-forwarded-for': '10.0.0.1', origin: 'https://ai-fitness.example', 'x-forwarded-host': 'ai-fitness.vercel.app' });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json().error.code).toBe('unauthorized');
    }
  });

  it('API routes are private by default: a route that forgets requireVisitor is still protected centrally', async () => {
    db = openDatabase(':memory:');
    const app = withCookieJar(buildApp({ config: testConfig, db }));
    apps.push(app);
    app.get('/api/some-new-feature', async () => ({ secret: true }));
    const res = await app.inject({ method: 'GET', url: '/api/some-new-feature' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('secret');
    expect((await app.inject({ method: 'GET', url: '/api/does-not-exist' })).statusCode).toBe(404); // unknown paths: plain 404
  });

  it('public routes stay open and reveal no personal data', async () => {
    db = openDatabase(':memory:');
    await populated(browser(), 'Alice');
    const stranger = browser();
    expect((await stranger.get('/api/health')).statusCode).toBe(200);
    expect((await stranger.get('/api/exercises')).statusCode).toBe(200);
    expect((await stranger.get('/api/profile')).statusCode).toBe(404); // no session → no profile
  });

  it('a forged, malformed or unknown token is rejected and the stale cookie cleared', async () => {
    db = openDatabase(':memory:');
    await populated(browser(), 'Alice');
    const stranger = browser();
    for (const token of ['x'.repeat(43), 'not-a-token', '', hashToken('guess')]) {
      const res = await stranger.call('GET', '/api/history', undefined, { cookie: `${VISITOR_COOKIE}=${token}` });
      expect(res.statusCode, token).toBe(401);
    }
    const res = await stranger.call('GET', '/api/history', undefined, { cookie: `${VISITOR_COOKIE}=${'A'.repeat(43)}` });
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=0/);
  });

  it('rejects cross-site state-changing requests (CSRF defence)', async () => {
    db = openDatabase(':memory:');
    const a = browser();
    await a.call('PUT', '/api/profile', profile('Alice'));
    const res = await a.call('POST', '/api/workouts/generate', {}, { 'sec-fetch-site': 'cross-site' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('forbidden');
    expect((await a.call('POST', '/api/workouts/generate', {}, { 'sec-fetch-site': 'same-origin' })).statusCode).toBe(200);
  });
});

describe('visitor cookie and token storage', () => {
  it('sets an HttpOnly, SameSite=Lax cookie scoped to /api for 30 days; Secure when configured', async () => {
    db = openDatabase(':memory:');
    const res = await browser().call('PUT', '/api/profile', profile('Alice'));
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(new RegExp(`^${VISITOR_COOKIE}=[A-Za-z0-9_-]{43};`));
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain(`Max-Age=${30 * 86400}`);
    expect(cookie).not.toContain('Secure');

    const secure = await browser({ secureCookies: true }).call('PUT', '/api/profile', profile('Bob'));
    expect(String(secure.headers['set-cookie'])).toContain('Secure');
  });

  it('stores only a SHA-256 hash of the token', async () => {
    db = openDatabase(':memory:');
    const res = await browser().call('PUT', '/api/profile', profile('Alice'));
    const token = readCookie(String(res.headers['set-cookie']).split(';')[0], VISITOR_COOKIE)!;
    const rows = db.prepare('SELECT * FROM visitors').all() as Record<string, unknown>[];
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).toBe(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});

describe('Delete my data', () => {
  it('removes the visitor and all of their rows, clears the cookie, and leaves other visitors untouched', async () => {
    db = openDatabase(':memory:');
    const a = browser();
    const b = browser();
    await populated(a, 'Alice');
    await populated(b, 'Bob');
    const [aliceId, bobId] = visitorIds();
    const bobBefore = countRows(bobId);
    expect(countRows(aliceId)).toBeGreaterThan(0);

    const res = await a.call('DELETE', '/api/visitor');
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=0/);
    expect(countRows(aliceId)).toBe(0);
    expect(visitorIds()).toEqual([bobId]);
    expect((db.prepare('SELECT COUNT(*) AS c FROM session_events s JOIN workout_sessions w ON w.id = s.session_id WHERE w.user_id = ?').get(aliceId) as { c: number }).c).toBe(0);
    expect(countRows(bobId)).toBe(bobBefore);
    expect((await a.get('/api/history')).statusCode).toBe(401);
  });
});

describe('expiry (30-day retention)', () => {
  const DAY = 86_400_000;
  const setLastSeen = (id: string, msAgo: number) =>
    db.prepare('UPDATE visitors SET last_seen_at = ? WHERE id = ?').run(new Date(Date.now() - msAgo).toISOString(), id);

  it('an inactive visitor\'s cookie stops working and their data is deleted', async () => {
    db = openDatabase(':memory:');
    const a = browser();
    await populated(a, 'Alice');
    const [aliceId] = visitorIds();
    setLastSeen(aliceId, 31 * DAY);
    expect((await a.get('/api/history')).statusCode).toBe(401);
    expect(countRows(aliceId)).toBe(0);
    expect(visitorIds()).toEqual([]);
  });

  it('activity keeps a visitor alive; the purge removes only visitors inactive for longer than the retention period', async () => {
    db = openDatabase(':memory:');
    const a = browser();
    const b = browser();
    await a.call('PUT', '/api/profile', profile('Alice'));
    await b.call('PUT', '/api/profile', profile('Bob'));
    const [aliceId, bobId] = visitorIds();
    setLastSeen(aliceId, 29 * DAY);
    expect((await a.get('/api/profile')).statusCode).toBe(200); // refreshes last_seen_at
    setLastSeen(bobId, 40 * DAY);
    expect(purgeInactiveVisitors(db, new Date(), 30)).toBe(1);
    expect(visitorIds()).toEqual([aliceId]);
    expect(countRows(bobId)).toBe(0);
  });
});

describe('rate limits', () => {
  it('limits new visitors per IP per hour; existing sessions are unaffected', async () => {
    db = openDatabase(':memory:');
    const limits = { newVisitorsPerIpPerHour: 2 };
    const first = browser(limits);
    const shared = first.app;
    // Three "browsers" from one IP against the same server instance (shared limiter): no cookies between them.
    const fresh = (ip: string) => shared.inject({ method: 'PUT', url: '/api/profile', payload: profile('X'), remoteAddress: ip, headers: { cookie: '' } });
    expect((await fresh('203.0.113.5')).statusCode).toBe(200);
    expect((await fresh('203.0.113.5')).statusCode).toBe(200);
    const limited = await fresh('203.0.113.5');
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await fresh('198.51.100.7')).statusCode).toBe(200); // another IP
    expect(visitorIds()).toHaveLength(3);
  });

  it('also caps new visitors for everyone together', async () => {
    db = openDatabase(':memory:');
    const { app } = browser({ newVisitorsPerHourTotal: 2 });
    const fresh = (ip: string) => app.inject({ method: 'PUT', url: '/api/profile', payload: profile('X'), remoteAddress: ip, headers: { cookie: '' } });
    expect((await fresh('203.0.113.1')).statusCode).toBe(200);
    expect((await fresh('203.0.113.2')).statusCode).toBe(200);
    expect((await fresh('203.0.113.3')).statusCode).toBe(429);
  });

  it('limits AI analyses per visitor per day, and for all visitors together', async () => {
    db = openDatabase(':memory:');
    const limits = { aiDailyLimitPerVisitor: 2, aiDailyLimitTotal: 3 };
    const a = browser(limits);
    const b = browser(limits);
    const ea = (await populated(a, 'Alice')).experimentId;
    const eb = (await populated(b, 'Bob')).experimentId;
    const analyse = (x: Browser, id: string) => x.post(`/api/ai/experiments/${id}/analysis`);

    expect((await analyse(a, ea)).statusCode).toBe(200);
    expect((await analyse(a, ea)).statusCode).toBe(200);
    const mine = await analyse(a, ea);
    expect(mine.statusCode).toBe(429);
    expect(mine.json().error.message).toMatch(/today's 2 insights/);

    expect((await analyse(b, eb)).statusCode).toBe(200); // 3rd overall
    const total = await analyse(b, eb);
    expect(total.statusCode).toBe(429);
    expect(total.json().error.message).toMatch(/all of today's AI insights/);

    // Deleting your data does not reset the overall daily count.
    await a.call('DELETE', '/api/visitor');
    expect((await analyse(b, eb)).statusCode).toBe(429);
  });
});

describe('write rate limit', () => {
  const event = () => ({ events: [{ type: 'workout_paused', occurredAt: new Date().toISOString(), exerciseId: null, setIndex: null, data: {} }] });

  it('allows normal use below the limit, including creating the session and running a workout', async () => {
    db = openDatabase(':memory:');
    const a = browser({ writeRateLimitPerMinute: 10 });
    expect((await a.call('PUT', '/api/profile', profile('Alice'))).statusCode).toBe(200); // session creation: not counted
    const w = workoutSchema.parse((await a.post('/api/workouts/generate')).json()); // 1
    const s = workoutSessionSchema.parse((await a.post('/api/sessions', { workoutId: w.id })).json()); // 2
    for (let i = 0; i < 7; i++) expect((await a.post(`/api/sessions/${s.id}/events`, event())).statusCode).toBe(200); // 3–9
    expect((await a.call('PUT', '/api/profile', profile('Alice'))).statusCode).toBe(200); // 10: the limit itself
    expect((await a.get('/api/history')).statusCode).toBe(200); // reads are never limited
  });

  it('answers 429 with Retry-After above the limit; reads keep working and deletion is always allowed', async () => {
    db = openDatabase(':memory:');
    const a = browser({ writeRateLimitPerMinute: 3 });
    await a.call('PUT', '/api/profile', profile('Alice'));
    for (let i = 0; i < 3; i++) expect((await a.post('/api/workouts/generate')).statusCode).toBe(200);
    const limited = await a.post('/api/workouts/generate');
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await a.call('PUT', '/api/profile', profile('Alice B.'))).statusCode).toBe(429);
    expect((await a.get('/api/workouts/latest')).statusCode).toBe(200);
    expect((await a.call('DELETE', '/api/visitor')).statusCode).toBe(200); // "Delete my data" is exempt
    expect(visitorIds()).toEqual([]);
  });

  it('is keyed by the client IP resolved under TRUST_PROXY, so spoofed X-Forwarded-For entries do not reset it', async () => {
    db = openDatabase(':memory:');
    const { app } = browser({ writeRateLimitPerMinute: 2, trustProxy: 1 });
    const as = (xff: string, method: 'PUT' | 'POST', url: string, payload: object) =>
      app.inject({ method, url, payload, remoteAddress: '10.0.0.1', headers: { 'x-forwarded-for': xff } });
    // One browser (shared cookie jar) behind the proxy as client 1.1.1.1.
    await as('1.1.1.1', 'PUT', '/api/profile', profile('Alice'));
    expect((await as('1.1.1.1', 'POST', '/api/workouts/generate', {})).statusCode).toBe(200);
    expect((await as('8.8.8.8, 1.1.1.1', 'POST', '/api/workouts/generate', {})).statusCode).toBe(200); // still 1.1.1.1
    expect((await as('7.7.7.7, 1.1.1.1', 'POST', '/api/workouts/generate', {})).statusCode).toBe(429); // spoof ignored
    expect((await as('2.2.2.2', 'POST', '/api/workouts/generate', {})).statusCode).toBe(200); // a different client IP
  });
});

describe('proxy-aware client IP', () => {
  const fresh = (app: FastifyInstance, xff: string | undefined) =>
    app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: profile('X'),
      remoteAddress: '10.0.0.1', // the proxy talking to us
      headers: { cookie: '', ...(xff ? { 'x-forwarded-for': xff } : {}) },
    });

  it('without TRUST_PROXY, X-Forwarded-For is ignored, so it cannot be used to dodge per-IP limits', async () => {
    db = openDatabase(':memory:');
    const { app } = browser({ newVisitorsPerIpPerHour: 1, trustProxy: false });
    expect((await fresh(app, '1.1.1.1')).statusCode).toBe(200);
    expect((await fresh(app, '2.2.2.2')).statusCode).toBe(429); // same TCP peer → same client
  });

  it('with a hop count, only addresses added by trusted proxies count; spoofed leading entries are ignored', async () => {
    db = openDatabase(':memory:');
    const { app } = browser({ newVisitorsPerIpPerHour: 1, trustProxy: 1 });
    expect((await fresh(app, '1.1.1.1')).statusCode).toBe(200); // client 1.1.1.1 (added by our proxy)
    expect((await fresh(app, '9.9.9.9, 1.1.1.1')).statusCode).toBe(429); // client prepends a fake IP: still 1.1.1.1
    expect((await fresh(app, '2.2.2.2')).statusCode).toBe(200); // a genuinely different client
  });

  it('a list of trusted proxy IPs works the same way', async () => {
    db = openDatabase(':memory:');
    const { app } = browser({ newVisitorsPerIpPerHour: 1, trustProxy: ['10.0.0.1'] });
    expect((await fresh(app, '1.1.1.1')).statusCode).toBe(200);
    expect((await fresh(app, '9.9.9.9, 1.1.1.1')).statusCode).toBe(429);
  });
});

describe('production configuration', () => {
  const prod = { NODE_ENV: 'production', DATABASE_URL: 'file:/var/data/fitness-lab.db', TRUST_PROXY: '2' };

  it('accepts a valid production configuration with secure cookies', () => {
    const c = loadConfig(prod);
    expect(c).toMatchObject({ databasePath: '/var/data/fitness-lab.db', trustProxy: 2, secureCookies: true });
    expect(loadConfig({ ...prod, SERVE_FRONTEND: 'false' }).staticDir).toBeNull(); // API-only backend (frontend on Vercel)
  });

  it('requires TRUST_PROXY in production and refuses to trust every forwarded header', () => {
    expect(() => loadConfig({ ...prod, TRUST_PROXY: undefined })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...prod, TRUST_PROXY: 'true' })).toThrow(ConfigError);
    expect(loadConfig({ ...prod, TRUST_PROXY: 'none' }).trustProxy).toBe(false);
  });

  it('refuses a relative or in-memory database in production (never the repository data/ folder)', () => {
    expect(() => loadConfig({ ...prod, DATABASE_URL: 'file:./data/fitness-lab.db' })).toThrow(/absolute/);
    expect(() => loadConfig({ ...prod, DATABASE_URL: ':memory:' })).toThrow(/absolute/);
  });

  it('parses TRUST_PROXY values strictly', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('10.0.0.0/8, 192.168.1.1')).toEqual(['10.0.0.0/8', '192.168.1.1']);
    for (const bad of ['0', '6', 'yes', 'example.com', '10.0.0.1;rm']) expect(() => parseTrustProxy(bad), bad).toThrow(ConfigError);
  });

  it('validates the new limits', () => {
    expect(() => loadConfig({ AI_DAILY_LIMIT_PER_VISITOR: '0' })).toThrow(ConfigError);
    expect(() => loadConfig({ VISITOR_RETENTION_DAYS: '999' })).toThrow(ConfigError);
    expect(loadConfig({ NEW_VISITORS_PER_IP_PER_HOUR: '5' }).newVisitorsPerIpPerHour).toBe(5);
  });
});
