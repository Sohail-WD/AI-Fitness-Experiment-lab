import type { FastifyInstance } from 'fastify';
import { type ProfileResponse, profileInputSchema } from '../../shared/schemas/profile.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getProfile, saveProfile } from '../repositories/profileRepository.ts';
import { parseWith } from '../validation/parse.ts';

export function registerProfileRoutes(app: FastifyInstance, deps: { db: Database }): void {
  app.get('/api/profile', async (): Promise<ProfileResponse> => {
    const profile = getProfile(deps.db);
    if (!profile) throw new AppError(404, 'not_found', 'No profile has been created yet');
    return profile;
  });

  app.put('/api/profile', async (request): Promise<ProfileResponse> => {
    return saveProfile(deps.db, parseWith(profileInputSchema, request.body));
  });
}
