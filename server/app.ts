import Fastify, { type FastifyInstance } from 'fastify';
import { type AnalysisService, createAnalysisService } from './ai/analysisService.ts';
import { createLlmFromConfig } from './ai/groqClient.ts';
import type { AppConfig } from './config.ts';
import type { Database } from './db/database.ts';
import { registerErrorHandling } from './errors.ts';
import { registerHttpHardening } from './http.ts';
import { registerAdaptationRoutes } from './routes/adaptations.ts';
import { registerAiRoutes } from './routes/ai.ts';
import { registerExerciseRoutes } from './routes/exercises.ts';
import { registerExperimentRoutes } from './routes/experiments.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerHistoryRoutes } from './routes/history.ts';
import { registerProfileRoutes } from './routes/profile.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerWorkoutRoutes } from './routes/workouts.ts';
import { registerStaticFrontend } from './static.ts';
import { registerVisitorAuth } from './visitors.ts';

export interface AppDeps {
  config: AppConfig;
  db: Database;
  /** Analysis service; defaults to Groq when GROQ_API_KEY is set, else deterministic summaries only. */
  ai?: AnalysisService;
}

const trustHops = (hops: number) => (_address: string, hop: number) => hop < hops;

/** Build the API without listening, so tests can drive it with app.inject(). */
export function buildApp({ config, db, ai }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: config.nodeEnv === 'test' ? false : { level: 'info' },
    // Which X-Forwarded-For entries to believe (TRUST_PROXY). Never `true`: clients could pick their own IP.
    // A hop count N trusts the N nearest proxies (the same rule proxy-addr applies to a numeric setting).
    trustProxy: typeof config.trustProxy === 'number' ? trustHops(config.trustProxy) : config.trustProxy,
  });
  const analysis = ai ?? createAnalysisService({ llm: createLlmFromConfig(config), log: (m) => app.log.warn(m) });

  registerErrorHandling(app);
  registerHttpHardening(app, { corsOrigin: config.corsOrigin });
  // Every private route below requires the visitor resolved here (anonymous demo session cookie).
  const visitors = registerVisitorAuth(app, {
    db,
    secureCookies: config.secureCookies,
    retentionDays: config.visitorRetentionDays,
    newVisitorsPerIpPerHour: config.newVisitorsPerIpPerHour,
    newVisitorsPerHourTotal: config.newVisitorsPerHourTotal,
    writeRateLimitPerMinute: config.writeRateLimitPerMinute,
  });
  if (config.debugProxyHeaders) {
    // One-off deployment check: which address does TRUST_PROXY resolve? Logged for /api/health only.
    app.addHook('onRequest', async (request) => {
      if (request.url === '/api/health') {
        app.log.info({ xForwardedFor: request.headers['x-forwarded-for'] ?? null, peer: request.socket.remoteAddress, resolvedIp: request.ip }, 'proxy check');
      }
    });
  }
  registerHealthRoutes(app, { db, ai: analysis });
  registerExerciseRoutes(app, { db });
  registerProfileRoutes(app, { db, visitors });
  registerWorkoutRoutes(app, { db });
  registerSessionRoutes(app, { db });
  registerHistoryRoutes(app, { db });
  registerExperimentRoutes(app, { db });
  registerAiRoutes(app, {
    db,
    ai: analysis,
    rateLimitPerMinute: config.aiRateLimitPerMinute,
    dailyPerVisitor: config.aiDailyLimitPerVisitor,
    dailyTotal: config.aiDailyLimitTotal,
  });
  registerAdaptationRoutes(app, { db });
  // Production: serve the built frontend from this server (one origin, no CORS needed).
  if (config.staticDir) registerStaticFrontend(app, config.staticDir);

  return app;
}
