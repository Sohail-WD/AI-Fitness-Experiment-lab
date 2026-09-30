import type { FastifyInstance } from 'fastify';
import type { AnalysisReport } from '../../shared/schemas/ai.ts';
import type { AnalysisService } from '../ai/analysisService.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getExperiment, getResult } from '../repositories/experimentRepository.ts';

type IdParams = { Params: { id: string } };

export function registerAiRoutes(app: FastifyInstance, deps: { db: Database; ai: AnalysisService }): void {
  /**
   * Analyse a started experiment's stored result. Only the deterministic result
   * reaches the analysis service; the report is generated on demand, not stored.
   */
  app.post<IdParams>('/api/ai/experiments/:id/analysis', async (request): Promise<AnalysisReport> => {
    const experiment = getExperiment(deps.db, request.params.id);
    if (!experiment) throw new AppError(404, 'not_found', `Experiment "${request.params.id}" not found`);
    if (experiment.status === 'proposed' || experiment.status === 'skipped') {
      throw new AppError(409, 'conflict', 'Start the experiment before analysing it');
    }
    const result = getResult(deps.db, experiment.id);
    if (!result) throw new AppError(409, 'conflict', 'This experiment has no result yet');
    return deps.ai.analyzeExperiment({ experiment, result });
  });
}
