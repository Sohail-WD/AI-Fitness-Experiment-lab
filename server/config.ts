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
}

/** Default Groq model (override with GROQ_MODEL if it is retired or you prefer another). */
export const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';

/** Treat empty strings (e.g. `KEY=` copied from .env.example) as unset. */
const optionalString = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(1).max(65535).default(3001)),
  HOST: optionalString,
  DATABASE_URL: optionalString,
  GROQ_API_KEY: optionalString,
  GROQ_MODEL: optionalString,
});

const DEFAULT_DATABASE_URL = 'file:./data/fitness-lab.db';

/** Accepts "file:<path>" or ":memory:". */
export function parseDatabaseUrl(url: string): string {
  if (url === ':memory:') return url;
  if (url.startsWith('file:') && url.length > 'file:'.length) return url.slice('file:'.length);
  throw new ConfigError(`DATABASE_URL must be "file:<path>" or ":memory:" (got "${url}")`);
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

  return {
    port: e.PORT,
    host: e.HOST ?? '127.0.0.1',
    databasePath: parseDatabaseUrl(e.DATABASE_URL ?? DEFAULT_DATABASE_URL),
    groqApiKey: e.GROQ_API_KEY ?? null,
    groqModel: e.GROQ_MODEL ?? DEFAULT_GROQ_MODEL,
    nodeEnv: e.NODE_ENV,
  };
}
