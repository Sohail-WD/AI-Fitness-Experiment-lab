import type { FastifyInstance } from 'fastify';
import type { HealthResponse } from '../../shared/schemas/api.ts';
import type { AnalysisService } from '../ai/analysisService.ts';
import { type Database, isDatabaseHealthy } from '../db/database.ts';
import { APP_VERSION } from '../version.ts';

export function registerHealthRoutes(app: FastifyInstance, deps: { db: Database; ai: AnalysisService }): void {
  app.get('/api/health', async (): Promise<HealthResponse> => {
    const database = isDatabaseHealthy(deps.db) ? 'ok' : 'error';
    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      version: APP_VERSION,
      time: new Date().toISOString(),
      services: { database, ai: deps.ai.status },
    };
  });
}
