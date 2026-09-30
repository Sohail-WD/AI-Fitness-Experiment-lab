import Fastify, { type FastifyInstance } from 'fastify';
import { type AnalysisService, createAnalysisService } from './ai/analysisService.ts';
import { createLlmFromConfig } from './ai/groqClient.ts';
import type { AppConfig } from './config.ts';
import type { Database } from './db/database.ts';
import { registerErrorHandling } from './errors.ts';
import { registerAdaptationRoutes } from './routes/adaptations.ts';
import { registerAiRoutes } from './routes/ai.ts';
import { registerExerciseRoutes } from './routes/exercises.ts';
import { registerExperimentRoutes } from './routes/experiments.ts';
import { registerHealthRoutes } from './routes/health.ts';
import { registerHistoryRoutes } from './routes/history.ts';
import { registerProfileRoutes } from './routes/profile.ts';
import { registerSessionRoutes } from './routes/sessions.ts';
import { registerWorkoutRoutes } from './routes/workouts.ts';

export interface AppDeps {
  config: AppConfig;
  db: Database;
  /** Analysis service; defaults to Groq when GROQ_API_KEY is set, else deterministic summaries only. */
  ai?: AnalysisService;
}

/** Build the API without listening, so tests can drive it with app.inject(). */
export function buildApp({ config, db, ai }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: config.nodeEnv === 'test' ? false : { level: 'info' } });
  const analysis = ai ?? createAnalysisService({ llm: createLlmFromConfig(config), log: (m) => app.log.warn(m) });

  registerErrorHandling(app);
  registerHealthRoutes(app, { db, ai: analysis });
  registerExerciseRoutes(app, { db });
  registerProfileRoutes(app, { db });
  registerWorkoutRoutes(app, { db });
  registerSessionRoutes(app, { db });
  registerHistoryRoutes(app, { db });
  registerExperimentRoutes(app, { db });
  registerAiRoutes(app, { db, ai: analysis });
  registerAdaptationRoutes(app, { db });

  return app;
}
