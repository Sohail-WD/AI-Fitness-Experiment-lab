import type { FastifyInstance } from 'fastify';
import type { Database } from '../db/database.ts';
import { approveProposal, declineProposal, generateProposals, listWithStaleness, refreshProposal } from '../services/adaptationService.ts';

type IdParams = { Params: { id: string } };

export function registerAdaptationRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  app.get('/api/adaptations', async () => ({ proposals: listWithStaleness(db) }));

  /** Look at completed experiments and create proposals (once per experiment). */
  app.post('/api/adaptations/generate', async () => generateProposals(db, new Date(), (m) => app.log.warn(m)));

  /** "Accept and apply": the user's approval, applied atomically with the next workout. */
  app.post<IdParams>('/api/adaptations/:id/approve', async (request) => approveProposal(db, request.params.id));
  app.post<IdParams>('/api/adaptations/:id/decline', async (request) => ({ proposal: declineProposal(db, request.params.id) }));
  /** Re-derive a stale proposal against the current settings (same proposal, updated in place). */
  app.post<IdParams>('/api/adaptations/:id/refresh', async (request) => ({ proposal: refreshProposal(db, request.params.id) }));
}
