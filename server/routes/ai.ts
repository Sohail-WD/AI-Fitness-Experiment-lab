import type { FastifyInstance } from 'fastify';
import type { AnalysisReport } from '../../shared/schemas/ai.ts';
import type { AnalysisService } from '../ai/analysisService.ts';
import { createRateLimiter } from '../http.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getExperiment, getResult } from '../repositories/experimentRepository.ts';
import { requireVisitor, useAiQuota } from '../visitors.ts';

type IdParams = { Params: { id: string } };

export interface AiRouteLimits {
  rateLimitPerMinute: number;
  dailyPerVisitor: number;
  dailyTotal: number;
}

export function registerAiRoutes(app: FastifyInstance, deps: { db: Database; ai: AnalysisService } & AiRouteLimits): void {
  const limiter = createRateLimiter(deps.rateLimitPerMinute, 60_000);

  /**
   * Analyse one of the visitor's started experiments. Only the deterministic result
   * reaches the analysis service; the report is generated on demand, not stored.
   * Limits: per IP per minute, per visitor per day, and for everyone together per day.
   */
  app.post<IdParams>('/api/ai/experiments/:id/analysis', async (request, reply): Promise<AnalysisReport> => {
    const userId = requireVisitor(request);
    const wait = limiter.hit(request.ip);
    if (wait > 0) {
      reply.header('Retry-After', String(wait));
      throw new AppError(429, 'rate_limited', `Too many analysis requests. Try again in ${wait} seconds.`);
    }
    const experiment = getExperiment(deps.db, request.params.id, userId);
    if (!experiment) throw new AppError(404, 'not_found', `Experiment "${request.params.id}" not found`);
    if (experiment.status === 'proposed' || experiment.status === 'skipped') {
      throw new AppError(409, 'conflict', 'Start the experiment before analysing it');
    }
    const result = getResult(deps.db, experiment.id);
    if (!result) throw new AppError(409, 'conflict', 'This experiment has no result yet');

    const quota = useAiQuota(deps.db, userId, new Date(), { perVisitor: deps.dailyPerVisitor, total: deps.dailyTotal });
    if (quota !== 'ok') {
      throw new AppError(
        429,
        'rate_limited',
        quota === 'visitor_limit'
          ? `You have used today's ${deps.dailyPerVisitor} insights for this demo. Try again tomorrow.`
          : 'The demo has used all of today\'s AI insights. Try again tomorrow.',
      );
    }
    return deps.ai.analyzeExperiment({ experiment, result });
  });
}
