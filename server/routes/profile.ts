import type { FastifyInstance } from 'fastify';
import { type ProfileResponse, profileInputSchema } from '../../shared/schemas/profile.ts';
import { type Database, withTransaction } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getProfile, saveProfile, writeProfile } from '../repositories/profileRepository.ts';
import { parseWith } from '../validation/parse.ts';
import { deleteVisitor, insertVisitor, requireVisitor, type VisitorGate } from '../visitors.ts';

export function registerProfileRoutes(app: FastifyInstance, deps: { db: Database; visitors: VisitorGate }): void {
  const { db, visitors } = deps;

  /** The current visitor's profile. Without a demo session there is simply no profile yet (404). */
  app.get('/api/profile', async (request): Promise<ProfileResponse> => {
    const profile = request.visitorId ? getProfile(db, request.visitorId) : null;
    if (!profile) throw new AppError(404, 'not_found', 'No profile has been created yet');
    return profile;
  });

  /**
   * Save the profile. The first save starts an anonymous demo session: a visitor
   * and its profile are created together, and the visitor cookie is set.
   */
  app.put('/api/profile', async (request, reply): Promise<ProfileResponse> => {
    const input = parseWith(profileInputSchema, request.body);
    if (request.visitorId) return saveProfile(db, request.visitorId, input);

    visitors.admitNewVisitor(request, reply);
    const visitor = withTransaction(db, () => {
      const created = insertVisitor(db, visitors.now());
      writeProfile(db, created.id, input);
      return created;
    });
    reply.header('Set-Cookie', visitors.cookie(visitor.token));
    return getProfile(db, visitor.id)!;
  });

  /** "Delete my data": removes the visitor and everything they created, and ends the demo session. */
  app.delete('/api/visitor', async (request, reply) => {
    deleteVisitor(db, requireVisitor(request));
    reply.header('Set-Cookie', visitors.clearCookie());
    return { deleted: true };
  });
}
