import type { FastifyInstance } from 'fastify';
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
import { parseWith } from '../validation/parse.ts';

type IdParams = { Params: { id: string } };

export function registerSessionRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  app.post('/api/sessions', async (request): Promise<WorkoutSession> =>
    createSession(db, parseWith(createSessionInputSchema, request.body).workoutId),
  );

  app.get<IdParams>('/api/sessions/:id', async (request): Promise<WorkoutSession> => {
    const session = getSession(db, request.params.id);
    if (!session) throw new AppError(404, 'not_found', `Session "${request.params.id}" not found`);
    return session;
  });

  app.post<IdParams>('/api/sessions/:id/events', async (request) => ({
    recorded: appendEvents(db, request.params.id, parseWith(appendEventsInputSchema, request.body).events),
  }));

  app.post<IdParams>('/api/sessions/:id/complete', async (request): Promise<WorkoutSession> => {
    const { status, metrics } = parseWith(completeSessionInputSchema, request.body);
    return completeSession(db, request.params.id, status, metrics);
  });

  app.put<IdParams>('/api/sessions/:id/feedback', async (request): Promise<WorkoutSession> =>
    saveFeedback(db, request.params.id, parseWith(sessionFeedbackInputSchema, request.body).feedback),
  );
}
