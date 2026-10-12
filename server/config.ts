import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Thrown when environment variables are missing or invalid. The server refuses to start. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

export interface AppConfig {
  port: number;
  host: string;
  /** Filesystem path to the SQLite file, or ":memory:". */
  databasePath: string;
  /** Server-side only. Never sent to the browser. Optional: the app works without AI. */
  groqApiKey: string | null;
  /** Groq model used for analysis text. */
  groqModel: string;
  nodeEnv: 'development' | 'production' | 'test';
  /** Built frontend directory served by the API (production); null = not served (Vite serves it in dev). */
  staticDir: string | null;
  /** The only cross-origin browser origin allowed to call the API; null = same-origin only. */
  corsOrigin: string | null;
  /** Max AI analysis requests per client per minute. */
  aiRateLimitPerMinute: number;
  /** Fastify trustProxy: false (use the socket address), a hop count, or trusted proxy IPs/CIDRs. Never `true`. */
  trustProxy: false | number | string[];
  visitorRetentionDays: number;
  aiDailyLimitPerVisitor: number;
  aiDailyLimitTotal: number;
  newVisitorsPerIpPerHour: number;
  newVisitorsPerHourTotal: number;
  /** State-changing API requests per client IP per minute (visitors with a session). */
  writeRateLimitPerMinute: number;
  /** Visitor cookie gets the Secure flag (always in production). */
  secureCookies: boolean;
  /** Log the X-Forwarded-For chain on /api/health requests, to verify TRUST_PROXY after deploying. */
  debugProxyHeaders: boolean;
}

/** Default location of `npm run build` output. */
export const DEFAULT_STATIC_DIR = fileURLToPath(new URL('../dist', import.meta.url));

/** Default Groq model (override with GROQ_MODEL if it is retired or you prefer another). */
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

/** Treat empty strings (e.g. `KEY=` copied from .env.example) as unset. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const limit = (min: number, max: number, fallback: number) =>
  z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(min).max(max).default(fallback));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(65535).default(3001)),
  HOST: optionalString,
  DATABASE_URL: optionalString,
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,
  /** "true" serves the built frontend outside production too (e.g. local preview of the build). */
  SERVE_FRONTEND: z.enum(['true', 'false']).optional(),
  STATIC_DIR: optionalString,
  CORS_ORIGIN: optionalString,
  AI_RATE_LIMIT_PER_MINUTE: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(1000).default(10)),
  TRUST_PROXY: optionalString,
  VISITOR_RETENTION_DAYS: limit(1, 365, 30),
  AI_DAILY_LIMIT_PER_VISITOR: limit(1, 1000, 20),
  AI_DAILY_LIMIT_TOTAL: limit(1, 100_000, 500),
  NEW_VISITORS_PER_IP_PER_HOUR: limit(1, 1000, 10),
  NEW_VISITORS_PER_HOUR: limit(1, 100_000, 200),
  WRITE_RATE_LIMIT_PER_MINUTE: limit(1, 10_000, 120),
  DEBUG_PROXY_HEADERS: z.enum(['true', 'false']).optional(),
});

const DEFAULT_DATABASE_URL = 'file:./data/fitness-lab.db';

/** Accepts "file:<path>" or ":memory:". */
export function parseDatabaseUrl(url: string): string {
  if (url === ':memory:') return url;
  if (url.startsWith('file:') && url.length > 'file:'.length) return url.slice('file:'.length);
  throw new ConfigError(`DATABASE_URL must be "file:<path>" or ":memory:" (got "${url}")`);
}

/** A browser origin: scheme + host (+ port), nothing else. */
export function parseOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConfigError(`CORS_ORIGIN must be an origin like "https://app.example.com" (got "${value}")`);
  }
  if (!/^https?:$/.test(url.protocol) || url.origin !== value.replace(/\/$/, '')) {
    throw new ConfigError(`CORS_ORIGIN must be an origin like "https://app.example.com" (got "${value}")`);
  }
  return url.origin;
}

/**
 * TRUST_PROXY: "none" (use the TCP peer address), a hop count 1–5, or a comma-separated list of proxy
 * IPs/CIDRs. "true" is refused: it would let any client choose its own IP with X-Forwarded-For.
 */
export function parseTrustProxy(value: string | undefined): false | number | string[] {
  if (value === undefined || value === 'none' || value === 'false') return false;
  if (value === 'true') {
    throw new ConfigError('TRUST_PROXY=true would trust any client-supplied X-Forwarded-For header; use a hop count or proxy IPs');
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops < 1 || hops > 5) throw new ConfigError(`TRUST_PROXY hop count must be 1–5 (got "${value}")`);
    return hops;
  }
  const entries = value.split(',').map((x) => x.trim()).filter(Boolean);
  if (entries.length === 0 || !entries.every((x) => /^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(x))) {
    throw new ConfigError(`TRUST_PROXY must be "none", a hop count, or proxy IPs/CIDRs (got "${value}")`);
  }
  return entries;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new ConfigError(`Invalid environment configuration:\n${problems}`);
  }
  const e = parsed.data;

  // In production, never silently fall back to a local database file.
  if (e.NODE_ENV === 'production' && !e.DATABASE_URL) {
    throw new ConfigError('Missing required environment variable DATABASE_URL (required when NODE_ENV=production)');
  }
  const databasePath = parseDatabaseUrl(e.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  if (e.NODE_ENV === 'production' && (databasePath === ':memory:' || !isAbsolute(databasePath))) {
    throw new ConfigError(`In production DATABASE_URL must be an absolute file path such as file:/var/data/fitness-lab.db (got "${e.DATABASE_URL}"), so a repository-relative database is never used`);
  }
  // Behind a hosting proxy the client IP is unknowable without an explicit decision; per-IP limits depend on it.
  if (e.NODE_ENV === 'production' && e.TRUST_PROXY === undefined) {
    throw new ConfigError('Missing required environment variable TRUST_PROXY (required when NODE_ENV=production; use "none", a hop count, or proxy IPs)');
  }

  return {
    port: e.PORT,
    host: e.HOST ?? '127.0.0.1',
    databasePath,
    groqApiKey: e.GROQ_API_KEY ?? null,
    groqModel: e.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    nodeEnv: e.NODE_ENV,
    staticDir:
      e.SERVE_FRONTEND !== 'false' && (e.NODE_ENV === 'production' || e.SERVE_FRONTEND === 'true') ? (e.STATIC_DIR ?? DEFAULT_STATIC_DIR) : null,
    corsOrigin: e.CORS_ORIGIN ? parseOrigin(e.CORS_ORIGIN) : null,
    aiRateLimitPerMinute: e.AI_RATE_LIMIT_PER_MINUTE,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    visitorRetentionDays: e.VISITOR_RETENTION_DAYS,
    aiDailyLimitPerVisitor: e.AI_DAILY_LIMIT_PER_VISITOR,
    aiDailyLimitTotal: e.AI_DAILY_LIMIT_TOTAL,
    newVisitorsPerIpPerHour: e.NEW_VISITORS_PER_IP_PER_HOUR,
    newVisitorsPerHourTotal: e.NEW_VISITORS_PER_HOUR,
    writeRateLimitPerMinute: e.WRITE_RATE_LIMIT_PER_MINUTE,
    secureCookies: e.NODE_ENV === 'production',
    debugProxyHeaders: e.DEBUG_PROXY_HEADERS === 'true',
  };
}
