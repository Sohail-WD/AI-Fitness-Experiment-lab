import type { FastifyInstance } from 'fastify';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import { generateWorkoutInputSchema, type Workout } from '../../shared/schemas/workout.ts';
import { generateWorkout, WorkoutGenerationError } from '../../shared/workout/generate.ts';
import { personalize } from '../../shared/workout/personalize.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getProfile } from '../repositories/profileRepository.ts';
import { getLatestWorkout, insertWorkout } from '../repositories/workoutRepository.ts';
import { parseWith } from '../validation/parse.ts';

function requireProfile(db: Database) {
  const profile = getProfile(db);
  if (!profile) throw new AppError(409, 'conflict', 'Create a profile before generating a workout');
  return profile;
}

export function registerWorkoutRoutes(app: FastifyInstance, deps: { db: Database }): void {
  /** Profile → personalization → generation → stored workout. Deterministic for a given seed. */
  app.post('/api/workouts/generate', async (request): Promise<Workout> => {
    const { seed = 0 } = parseWith(generateWorkoutInputSchema, request.body ?? {});
    const { profile, constraints } = requireProfile(deps.db);
    const requirements = personalize(profile, constraints, exerciseLibrary);
    try {
      return insertWorkout(deps.db, profile.id, generateWorkout(requirements, exerciseLibrary, seed));
    } catch (err) {
      if (err instanceof WorkoutGenerationError) throw new AppError(422, 'unprocessable', err.message);
      throw err;
    }
  });

  app.get('/api/workouts/latest', async (): Promise<Workout> => {
    const { profile } = requireProfile(deps.db);
    const workout = getLatestWorkout(deps.db, profile.id);
    if (!workout) throw new AppError(404, 'not_found', 'No workout has been generated yet');
    return workout;
  });
}
