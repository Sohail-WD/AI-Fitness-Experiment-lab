import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { exerciseLibrary } from '../../shared/exercises/library.ts';
import { computeHistoryMetrics, summarizeSession } from '../../shared/metrics/history.ts';
import { dataSourceSchema, type HistoryResponse, simulateHistoryInputSchema } from '../../shared/schemas/history.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import { deleteSimulated, listSessions, replaceSimulatedSessions } from '../repositories/historyRepository.ts';
import { getProfile } from '../repositories/profileRepository.ts';
import { getLatestWorkout } from '../repositories/workoutRepository.ts';
import { simulateSessions } from '../services/simulateHistory.ts';
import { parseWith } from '../validation/parse.ts';

function requireProfile(db: Database) {
  const profile = getProfile(db);
  if (!profile) throw new AppError(409, 'conflict', 'Create a profile first');
  return profile;
}

export function registerHistoryRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  /** Session history and deterministic metrics. Real and simulated data are separated unless source=all. */
  app.get('/api/history', async (request): Promise<HistoryResponse> => {
    const { source } = parseWith(z.object({ source: dataSourceSchema.default('real') }), request.query);
    const { profile } = requireProfile(db);
    const sessions = listSessions(db, profile.id, source)
      .filter(({ session }) => session.status !== 'in_progress')
      .map(({ session, title }) => summarizeSession(session, title));
    return {
      source,
      sessions: sessions.reverse(), // newest first for display
      metrics: computeHistoryMetrics(sessions, profile.schedule.workoutsPerWeek, new Date()),
    };
  });

  /** Seed (or re-seed) simulated history from the latest workout. Replaces previous simulated data only. */
  app.post('/api/history/simulated', async (request) => {
    const { weeks, timezoneOffsetMinutes } = parseWith(simulateHistoryInputSchema, request.body ?? {});
    const { profile } = requireProfile(db);
    const workout = getLatestWorkout(db, profile.id);
    if (!workout) throw new AppError(409, 'conflict', 'Generate a workout before creating simulated history');
    const sessions = simulateSessions({
      workout,
      library: exerciseLibrary,
      workoutsPerWeek: profile.schedule.workoutsPerWeek,
      weeks,
      now: new Date(),
      timezoneOffsetMinutes,
    });
    const replaced = replaceSimulatedSessions(db, profile.id, sessions);
    return { created: sessions.length, replaced };
  });

  app.delete('/api/history/simulated', async () => {
    const { profile } = requireProfile(db);
    return { deleted: deleteSimulated(db, profile.id) };
  });
}
