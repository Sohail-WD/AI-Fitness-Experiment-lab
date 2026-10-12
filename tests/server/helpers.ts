import type { FastifyInstance, InjectOptions } from 'fastify';
import type { AppConfig } from '../../server/config';
import type { Database } from '../../server/db/database';

export const testConfig: AppConfig = {
  port: 0,
  host: '127.0.0.1',
  databasePath: ':memory:',
  groqApiKey: null,
  groqModel: 'test-model',
  nodeEnv: 'test',
  staticDir: null,
  corsOrigin: null,
  aiRateLimitPerMinute: 1000,
  trustProxy: false,
  visitorRetentionDays: 30,
  aiDailyLimitPerVisitor: 1000,
  aiDailyLimitTotal: 100_000,
  newVisitorsPerIpPerHour: 1000,
  newVisitorsPerHourTotal: 100_000,
  writeRateLimitPerMinute: 100_000,
  secureCookies: false,
  debugProxyHeaders: false,
};

/**
 * Make app.inject behave like ONE browser (pass `sameBrowserAs` to share another app's cookies): cookies set by responses are stored
 * and sent with later requests (unless a request sets its own Cookie header).
 */
const JAR = Symbol('cookieJar');

export function withCookieJar<T extends FastifyInstance>(app: T, opts: { sameBrowserAs?: FastifyInstance } = {}): T {
  const shared = opts.sameBrowserAs ? (opts.sameBrowserAs as unknown as Record<symbol, Map<string, string>>)[JAR] : undefined;
  const jar = shared ?? new Map<string, string>();
  (app as unknown as Record<symbol, Map<string, string>>)[JAR] = jar;
  const inject = app.inject.bind(app) as (opts: InjectOptions) => Promise<Awaited<ReturnType<FastifyInstance['inject']>>>;
  const browserInject = async (opts: InjectOptions | string) => {
    const o: InjectOptions = typeof opts === 'string' ? { url: opts } : { ...opts };
    const headers = { ...(o.headers ?? {}) } as Record<string, string>;
    if (jar.size > 0 && headers.cookie === undefined) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await inject({ ...o, headers });
    const setCookie = res.headers['set-cookie'];
    for (const c of setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]) {
      const [pair, ...attrs] = String(c).split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === '') jar.delete(name);
      else jar.set(name, value);
    }
    return res;
  };
  (app as unknown as { inject: typeof browserInject }).inject = browserInject;
  return app;
}

/** The id of the single visitor in a test database (tests that start one demo session). */
export function onlyVisitorId(db: Database): string {
  const rows = db.prepare('SELECT id FROM visitors').all() as unknown as { id: string }[];
  if (rows.length !== 1) throw new Error(`expected exactly one visitor, found ${rows.length}`);
  return rows[0].id;
}
