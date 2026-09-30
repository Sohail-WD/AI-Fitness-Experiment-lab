import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { acceptProposal, applyProposal, declineProposal, generateProposals, listWithStaleness } from '../services/adaptationService.ts';

type IdParams = { Params: { id: string } };

export function registerAdaptationRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  app.get('/api/adaptations', async () => ({ proposals: listWithStaleness(db) }));

  /** Look at completed experiments and create proposals (once per experiment). */
  app.post('/api/adaptations/generate', async () => generateProposals(db));

  app.post<IdParams>('/api/adaptations/:id/accept', async (request) => ({ proposal: acceptProposal(db, request.params.id) }));
  app.post<IdParams>('/api/adaptations/:id/decline', async (request) => ({ proposal: declineProposal(db, request.params.id) }));
  /** Apply an accepted proposal to the plan and generate the next workout. */
  app.post<IdParams>('/api/adaptations/:id/apply', async (request) => applyProposal(db, request.params.id));
}
