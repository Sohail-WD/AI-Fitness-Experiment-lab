import type { FastifyInstance } from 'fastify';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import { restrictionConflicts } from '../../shared/workout/personalize.ts';
import {
  appendEventsInputSchema,
  completeSessionInputSchema,
  createSessionInputSchema,
  sessionFeedbackInputSchema,
  type WorkoutSession,
} from '../../shared/schemas/workout.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { appendEvents, completeSession, createSession, getSession, saveFeedback } from '../repositories/sessionRepository.ts';
import { getProfile } from '../repositories/profileRepository.ts';
import { getWorkout } from '../repositories/workoutRepository.ts';
import { parseWith } from '../validation/parse.ts';
import { requireVisitor } from '../visitors.ts';

type IdParams = { Params: { id: string } };

export function registerSessionRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  /**
   * Start a session. The workout is re-checked against the user's CURRENT
   * restrictions, so an outdated workout cannot be run after a restriction is added.
   */
  app.post('/api/sessions', async (request): Promise<WorkoutSession> => {
    const userId = requireVisitor(request);
    const { workoutId } = parseWith(createSessionInputSchema, request.body);
    const workout = getWorkout(db, workoutId, userId);
    if (!workout) throw new AppError(404, 'not_found', `Workout "${workoutId}" not found`);
    const current = getProfile(db, userId);
    if (current) {
      const conflicts = restrictionConflicts(workout.items, current.constraints.restrictionTags, exerciseLibrary);
      if (conflicts.length > 0) {
        throw new AppError(
          409,
          'conflict',
          `Your current movement restrictions exclude: ${conflicts.map((e) => e.name).join(', ')}. Generate a new workout before starting.`,
        );
      }
    }
    return createSession(db, userId, workoutId);
  });

  app.get<IdParams>('/api/sessions/:id', async (request): Promise<WorkoutSession> => {
    const session = getSession(db, request.params.id, requireVisitor(request));
    if (!session) throw new AppError(404, 'not_found', `Session "${request.params.id}" not found`);
    return session;
  });

  app.post<IdParams>('/api/sessions/:id/events', async (request) => ({
    recorded: appendEvents(db, requireVisitor(request), request.params.id, parseWith(appendEventsInputSchema, request.body).events),
  }));

  app.post<IdParams>('/api/sessions/:id/complete', async (request): Promise<WorkoutSession> => {
    const userId = requireVisitor(request);
    const { status, metrics } = parseWith(completeSessionInputSchema, request.body);
    return completeSession(db, userId, request.params.id, status, metrics);
  });

  app.put<IdParams>('/api/sessions/:id/feedback', async (request): Promise<WorkoutSession> =>
    saveFeedback(db, requireVisitor(request), request.params.id, parseWith(sessionFeedbackInputSchema, request.body).feedback),
  );
}
