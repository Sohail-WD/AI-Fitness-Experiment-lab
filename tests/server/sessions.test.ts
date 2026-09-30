import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { countEvents } from '../../server/repositories/sessionRepository';
import { workoutSchema, workoutSessionSchema } from '../../shared/schemas/workout';
import { testConfig } from './helpers';

let db: Database;
let app: FastifyInstance;
let workoutId: string;

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = buildApp({ config: testConfig, db });
  await app.inject({
    method: 'PUT',
    url: '/api/profile',
    payload: {
      profile: {
        name: 'Asha',
        fitnessLevel: 'beginner',
        goals: ['general_fitness'],
        trainingContext: 'recreationally_active',
        equipment: [],
        environment: { location: 'home' },
        availableMinutes: 15,
        schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
      },
      constraints: { restrictionTags: [], notes: '', source: 'self_reported' },
    },
  });
  workoutId = workoutSchema.parse((await app.inject({ method: 'POST', url: '/api/workouts/generate', payload: {} })).json()).id;
});
afterEach(async () => {
  await app.close();
  db.close();
});

const post = (url: string, payload: object) => app.inject({ method: 'POST', url, payload });
const AT = '2026-09-29T10:00:00.000Z';
const setEvent = { type: 'set_completed', occurredAt: AT, exerciseId: 'squat', setIndex: 0, data: { reps: 6, validReps: 5, source: 'cv' } };
const metricsFor = (sessionId: string) => ({ sessionId, sets: [], completionRatio: 0, activeDurationSeconds: 12 });

async function startSession() {
  const res = await post('/api/sessions', { workoutId });
  expect(res.statusCode).toBe(200);
  return workoutSessionSchema.parse(res.json());
}

describe('sessions API', () => {
  it('creates an in-progress session for an existing workout only', async () => {
    const session = await startSession();
    expect(session).toMatchObject({ workoutId, status: 'in_progress', endedAt: null, isSimulated: false, feedback: null });
    const missing = await post('/api/sessions', { workoutId: '00000000-0000-4000-8000-000000000000' });
    expect(missing.statusCode).toBe(404);
  });

  it('records events', async () => {
    const { id } = await startSession();
    const res = await post(`/api/sessions/${id}/events`, { events: [{ ...setEvent, type: 'workout_started', exerciseId: null, setIndex: null, data: {} }, setEvent] });
    expect(res.json()).toEqual({ recorded: 2 });
    expect(countEvents(db, id)).toBe(2);
    const row = db.prepare("SELECT exercise_id, set_index, data FROM session_events WHERE type = 'set_completed'").get() as Record<string, unknown>;
    expect(row).toEqual({ exercise_id: 'squat', set_index: 0, data: JSON.stringify(setEvent.data) });
  });

  it('rejects invalid events', async () => {
    const { id } = await startSession();
    const res = await post(`/api/sessions/${id}/events`, { events: [{ ...setEvent, type: 'teleported' }] });
    expect(res.statusCode).toBe(400);
  });

  it('completes a session with metrics and then refuses more events', async () => {
    const { id } = await startSession();
    const done = workoutSessionSchema.parse((await post(`/api/sessions/${id}/complete`, { status: 'abandoned', metrics: metricsFor(id) })).json());
    expect(done.status).toBe('abandoned');
    expect(done.endedAt).not.toBeNull();
    expect(done.metrics?.activeDurationSeconds).toBe(12);
    expect((await post(`/api/sessions/${id}/events`, { events: [setEvent] })).statusCode).toBe(409);
    expect((await post(`/api/sessions/${id}/complete`, { status: 'completed', metrics: metricsFor(id) })).statusCode).toBe(409);
  });

  it('rejects metrics for a different session', async () => {
    const { id } = await startSession();
    const other = '00000000-0000-4000-8000-000000000000';
    expect((await post(`/api/sessions/${id}/complete`, { status: 'completed', metrics: metricsFor(other) })).statusCode).toBe(400);
  });

  it('saves post-workout feedback after completion', async () => {
    const { id } = await startSession();
    await post(`/api/sessions/${id}/complete`, { status: 'completed', metrics: metricsFor(id) });
    const feedback = { effort: 6, enjoyment: 9, energy: 'high', note: 'Good one' };
    const res = await app.inject({ method: 'PUT', url: `/api/sessions/${id}/feedback`, payload: { feedback } });
    expect(res.statusCode).toBe(200);
    expect(workoutSessionSchema.parse((await app.inject({ method: 'GET', url: `/api/sessions/${id}` })).json()).feedback).toEqual(feedback);
    const bad = await app.inject({ method: 'PUT', url: `/api/sessions/${id}/feedback`, payload: { feedback: { ...feedback, effort: 11 } } });
    expect(bad.statusCode).toBe(400);
  });
});
