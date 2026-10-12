import type { FastifyInstance } from 'fastify';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import { generateWorkoutInputSchema, type Workout } from '../../shared/schemas/workout.ts';
import { generateWorkout, WorkoutGenerationError } from '../../shared/workout/generate.ts';
import { personalize } from '../../shared/workout/personalize.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { getProfile } from '../repositories/profileRepository.ts';
import { getLatestWorkout, insertWorkout } from '../repositories/workoutRepository.ts';
import { activeAssignment } from '../services/experimentSessions.ts';
import { requireVisitor } from '../visitors.ts';
import { parseWith } from '../validation/parse.ts';

function requireProfile(db: Database, userId: string) {
  const profile = getProfile(db, userId);
  if (!profile) throw new AppError(409, 'conflict', 'Create a profile before generating a workout');
  return profile;
}

export function registerWorkoutRoutes(app: FastifyInstance, deps: { db: Database }): void {
  /** Profile → personalization → generation → stored workout. Deterministic for a given seed. */
  app.post('/api/workouts/generate', async (request): Promise<Workout> => {
    const { seed = 0 } = parseWith(generateWorkoutInputSchema, request.body ?? {});
    const { profile, constraints } = requireProfile(deps.db, requireVisitor(request));
    // During an active experiment the workout is assigned to the next condition (a duration condition also sets its length).
    const assigned = activeAssignment(deps.db, profile.id, new Date());
    const length = assigned?.condition.parameters.durationMinutes;
    const effective = typeof length === 'number' ? { ...profile, availableMinutes: length } : profile;
    const requirements = personalize(effective, constraints, exerciseLibrary);
    try {
      const plan = generateWorkout(requirements, exerciseLibrary, seed);
      if (assigned) plan.rationale.push(assigned.rationale);
      return insertWorkout(deps.db, profile.id, plan, assigned?.assignment ?? null);
    } catch (err) {
      if (err instanceof WorkoutGenerationError) throw new AppError(422, 'unprocessable', err.message);
      throw err;
    }
  });

  app.get('/api/workouts/latest', async (request): Promise<Workout> => {
    const { profile } = requireProfile(deps.db, requireVisitor(request));
    const workout = getLatestWorkout(deps.db, profile.id);
    if (!workout) throw new AppError(404, 'not_found', 'No workout has been generated yet');
    return workout;
  });
}
