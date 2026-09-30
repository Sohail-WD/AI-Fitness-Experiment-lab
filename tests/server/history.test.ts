import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { SIMULATED_NOTE, simulateSessions } from '../../server/services/simulateHistory';
import { exerciseLibrary } from '../../shared/exercises/library';
import { historyResponseSchema } from '../../shared/schemas/history';
import { workoutSchema, workoutSessionSchema } from '../../shared/schemas/workout';
import { workout as fixtureWorkout } from '../fixtures/contracts';
import { testConfig } from './helpers';

let db: Database;
let app: FastifyInstance;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp({ config: testConfig, db });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const NOW = new Date('2026-10-01T12:00:00.000Z');

/* ---------- simulated data generation (pure) ---------- */

describe('simulateSessions', () => {
  let n = 0;
  const run = (seed = 42) =>
    simulateSessions({ workout: fixtureWorkout, library: exerciseLibrary, workoutsPerWeek: 4, weeks: 6, seed, now: NOW, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` });

  it('marks every record as SIMULATED and produces contract-valid sessions', () => {
    const sessions = run();
    expect(sessions.length).toBeGreaterThan(10);
    for (const s of sessions) {
      expect(s.isSimulated).toBe(true);
      expect(s.feedback?.note).toBe(SIMULATED_NOTE);
      expect(workoutSessionSchema.safeParse(s).success).toBe(true);
    }
  });

  it('stays within the requested past weeks and misses some planned workouts', () => {
    const sessions = run();
    expect(sessions.length).toBeLessThan(6 * 4);
    for (const s of sessions) {
      expect(Date.parse(s.startedAt)).toBeLessThan(NOW.getTime());
      expect(Date.parse(s.startedAt)).toBeGreaterThanOrEqual(Date.parse('2026-08-17T00:00:00Z')); // 6 weeks before this week
    }
  });

  it('contains the morning-vs-evening pattern the experiment demo relies on', () => {
    const sessions = run();
    const byHour = (h: number) => sessions.filter((s) => new Date(s.startedAt).getUTCHours() === h);
    const avg = (xs: typeof sessions) => xs.reduce((a, s) => a + s.metrics!.completionRatio, 0) / xs.length;
    expect(byHour(7).length).toBeGreaterThan(byHour(19).length);
    expect(avg(byHour(7))).toBeGreaterThan(avg(byHour(19)));
  });

  it('is deterministic for a seed', () => {
    const strip = (xs: ReturnType<typeof run>) => xs.map(({ id: _id, metrics, ...s }) => ({ ...s, metrics: { ...metrics!, sessionId: '' } }));
    expect(strip(run(7))).toEqual(strip(run(7)));
    expect(strip(run(7))).not.toEqual(strip(run(8)));
  });
});

/* ---------- history API ---------- */

async function setupProfileAndWorkout() {
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
  return workoutSchema.parse((await app.inject({ method: 'POST', url: '/api/workouts/generate', payload: {} })).json());
}

async function completeRealSession(workoutId: string) {
  const s = workoutSessionSchema.parse((await app.inject({ method: 'POST', url: '/api/sessions', payload: { workoutId } })).json());
  const sets = [
    {
      exerciseId: 'squat',
      detectedReps: 11,
      validReps: 9,
      invalidReps: 2,
      metrics: { lowestPrimaryAngleDeg: 5, averageRepDurationMs: 2000, usableFrameRatio: 0.9 },
      formIssues: [{ code: 'insufficient_depth', count: 2 }],
      measurementSource: 'cv',
    },
  ];
  await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/complete`, payload: { status: 'completed', metrics: { sessionId: s.id, sets, completionRatio: 1, activeDurationSeconds: 600 } } });
  await app.inject({ method: 'PUT', url: `/api/sessions/${s.id}/feedback`, payload: { feedback: { effort: 6, enjoyment: 9, energy: 'high' } } });
  return s.id;
}

const history = async (source?: string) =>
  historyResponseSchema.parse((await app.inject({ method: 'GET', url: `/api/history${source ? `?source=${source}` : ''}` })).json());

describe('history API', () => {
  it('requires a profile', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/history' })).statusCode).toBe(409);
  });

  it('lists a real completed session with its metrics and feedback', async () => {
    const w = await setupProfileAndWorkout();
    const id = await completeRealSession(w.id);
    // An unfinished session is not listed.
    await app.inject({ method: 'POST', url: '/api/sessions', payload: { workoutId: w.id } });

    const h = await history();
    expect(h.source).toBe('real');
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]).toMatchObject({
      sessionId: id,
      workoutTitle: w.title,
      isSimulated: false,
      totalReps: 11,
      validReps: 9,
      invalidReps: 2,
      completionRatio: 1,
      countsAsCompleted: true,
      feedback: { effort: 6, enjoyment: 9, energy: 'high' },
    });
    expect(h.metrics.totals).toMatchObject({ workoutsCompleted: 1, planned: 3 });
    expect(h.metrics.totals.validRepRate).toBeCloseTo(9 / 11);
  });

  it('keeps simulated data separate and clearly marked', async () => {
    const w = await setupProfileAndWorkout();
    await completeRealSession(w.id);
    const seeded = (await app.inject({ method: 'POST', url: '/api/history/simulated', payload: { weeks: 4 } })).json();
    expect(seeded.created).toBeGreaterThan(0);

    expect((await history('real')).sessions.every((s) => !s.isSimulated)).toBe(true);
    const sim = await history('simulated');
    expect(sim.sessions).toHaveLength(seeded.created);
    expect(sim.sessions.every((s) => s.isSimulated && s.feedback?.note === SIMULATED_NOTE)).toBe(true);
    expect((await history('all')).sessions).toHaveLength(seeded.created + 1);
  });

  it('re-seeding replaces simulated data, and clearing removes only simulated data', async () => {
    const w = await setupProfileAndWorkout();
    await completeRealSession(w.id);
    await app.inject({ method: 'POST', url: '/api/history/simulated', payload: { weeks: 4 } });
    const again = (await app.inject({ method: 'POST', url: '/api/history/simulated', payload: { weeks: 4 } })).json();
    expect(again.replaced).toBe(again.created);
    expect((await history('simulated')).sessions).toHaveLength(again.created);

    expect((await app.inject({ method: 'DELETE', url: '/api/history/simulated' })).json().deleted).toBe(again.created);
    expect((await history('simulated')).sessions).toHaveLength(0);
    expect((await history('real')).sessions).toHaveLength(1);
  });

  it('needs a workout before simulating', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/profile',
      payload: {
        profile: {
          name: 'A',
          fitnessLevel: 'beginner',
          goals: ['general_fitness'],
          trainingContext: 'sedentary',
          equipment: [],
          environment: { location: 'home' },
          availableMinutes: 15,
          schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
        },
        constraints: { restrictionTags: [], notes: '', source: 'self_reported' },
      },
    });
    expect((await app.inject({ method: 'POST', url: '/api/history/simulated', payload: {} })).statusCode).toBe(409);
  });
});
