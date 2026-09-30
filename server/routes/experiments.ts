import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  applyLifecycle,
  type ExperimentAction,
  ExperimentTransitionError,
  type ExperimentSession,
  findTemplate,
  refreshExperiment,
} from '../../shared/experiments/engine.ts';
import { summarizeSession } from '../../shared/metrics/history.ts';
import {
  createExperimentInputSchema,
  type Experiment,
  type ExperimentWithResult,
} from '../../shared/schemas/experiment.ts';
import type { Database } from '../db/database.ts';
import { AppError } from '../errors.ts';
import {
  getExperiment,
  getResult,
  insertExperiment,
  listExperiments,
  saveResult,
  updateExperimentStatus,
} from '../repositories/experimentRepository.ts';
import { listSessions } from '../repositories/historyRepository.ts';
import { getProfile } from '../repositories/profileRepository.ts';
import { parseWith } from '../validation/parse.ts';

type IdParams = { Params: { id: string } };

function requireProfile(db: Database) {
  const profile = getProfile(db);
  if (!profile) throw new AppError(409, 'conflict', 'Create a profile first');
  return profile;
}

function experimentSessions(db: Database, userId: string): ExperimentSession[] {
  const minutes = new Map(
    (db.prepare('SELECT id, estimated_minutes FROM workouts WHERE user_id = ?').all(userId) as { id: string; estimated_minutes: number }[]).map(
      (r) => [r.id, r.estimated_minutes],
    ),
  );
  return listSessions(db, userId, 'all').map(({ session, title }) => ({
    summary: summarizeSession(session, title),
    workoutMinutes: minutes.get(session.workoutId) ?? 0,
  }));
}

/** Re-evaluate an active experiment (auto-completing it when data suffices) and store the result. */
function refresh(db: Database, e: Experiment, now: Date): ExperimentWithResult {
  if (e.status !== 'active') return { experiment: e, result: getResult(db, e.id) };
  const { experiment, result } = refreshExperiment(e, experimentSessions(db, e.userId), now);
  saveResult(db, result);
  if (experiment.status !== e.status) updateExperimentStatus(db, experiment);
  return { experiment, result };
}

export function registerExperimentRoutes(app: FastifyInstance, deps: { db: Database }): void {
  const { db } = deps;

  app.get('/api/experiments', async () => {
    const { profile } = requireProfile(db);
    const now = new Date();
    return { experiments: listExperiments(db, profile.id).map((e) => refresh(db, e, now)) };
  });

  /** Create a draft from a template. Only one draft/active experiment at a time. */
  app.post('/api/experiments', async (request): Promise<ExperimentWithResult> => {
    const input = parseWith(createExperimentInputSchema, request.body ?? {});
    const { profile } = requireProfile(db);
    const template = findTemplate(input.templateId);
    if (!template) throw new AppError(404, 'not_found', `Unknown experiment template "${input.templateId}"`);
    if (listExperiments(db, profile.id).some((e) => e.status === 'proposed' || e.status === 'active')) {
      throw new AppError(409, 'conflict', 'Finish, end or skip the current experiment first');
    }
    const experiment: Experiment = {
      id: randomUUID(),
      userId: profile.id,
      status: 'proposed',
      ...template.build(profile.schedule.workoutsPerWeek),
      isSimulated: input.useSimulatedData,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      createdAt: new Date().toISOString(),
      startedAt: null,
      endedAt: null,
    };
    insertExperiment(db, experiment);
    return { experiment, result: null };
  });

  const action = (name: Exclude<ExperimentAction, 'complete'>) =>
    app.post<IdParams>(`/api/experiments/:id/${name}`, async (request): Promise<ExperimentWithResult> => {
      const e = getExperiment(db, request.params.id);
      if (!e) throw new AppError(404, 'not_found', `Experiment "${request.params.id}" not found`);
      const now = new Date();
      let next: Experiment;
      try {
        next = applyLifecycle(e, name, now);
      } catch (err) {
        if (err instanceof ExperimentTransitionError) throw new AppError(409, 'conflict', err.message);
        throw err;
      }
      updateExperimentStatus(db, next);
      if (name === 'end') {
        // Keep a final result for the ended experiment (it may say "not enough data").
        const { result } = refreshExperiment({ ...e, endedAt: next.endedAt }, experimentSessions(db, e.userId), now);
        saveResult(db, result);
        return { experiment: next, result };
      }
      return refresh(db, next, now);
    });
  action('start');
  action('skip');
  action('end');
}
