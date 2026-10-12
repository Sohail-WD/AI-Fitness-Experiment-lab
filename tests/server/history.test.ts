import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { SIMULATED_NOTE, simulateSessions } from '../../server/services/simulateHistory';
import { exerciseLibrary } from '../../shared/exercises/library';
import { historyResponseSchema } from '../../shared/schemas/history';
import { workoutSchema, workoutSessionSchema } from '../../shared/schemas/workout';
import { workout as fixtureWorkout } from '../fixtures/contracts';
import { testConfig, withCookieJar } from './helpers';

let db: Database;
let app: FastifyInstance;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = withCookieJar(buildApp({ config: testConfig, db }));
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

  it('stays within the requested past weeks (at most one session per planned slot)', () => {
    const sessions = run();
    expect(sessions.length).toBeLessThanOrEqual(6 * 4);
    for (const s of sessions) {
      expect(Date.parse(s.startedAt)).toBeLessThan(NOW.getTime());
      expect(Date.parse(s.startedAt)).toBeGreaterThanOrEqual(Date.parse('2026-08-17T00:00:00Z')); // 6 weeks before this week
    }
  });

  it('contains the morning-vs-evening pattern the experiment demo relies on', () => {
    const sessions = run();
    const byHour = (h: number) => sessions.filter((s) => new Date(s.startedAt).getUTCHours() === h);
    const avg = (xs: typeof sessions) => xs.reduce((a, s) => a + s.metrics!.completionRatio, 0) / xs.length;
    expect(byHour(7).length).toBeGreaterThanOrEqual(3); // enough sessions in BOTH slots to compare
    expect(byHour(19).length).toBeGreaterThanOrEqual(3);
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

/** Finishes a session that performed every planned set; the first rep-based set carries 11 detected / 9 valid / 2 invalid reps. */
async function completeRealSession(w: ReturnType<typeof workoutSchema.parse>) {
  const s = workoutSessionSchema.parse((await app.inject({ method: 'POST', url: '/api/sessions', payload: { workoutId: w.id } })).json());
  const firstRepItem = w.items.find((i) => i.target.type === 'reps')!;
  const setOf = (exerciseId: string, valid: number, invalid = 0) => ({
    exerciseId,
    detectedReps: valid + invalid,
    validReps: valid,
    invalidReps: invalid,
    metrics: { lowestPrimaryAngleDeg: 5, averageRepDurationMs: 2000, usableFrameRatio: 0.9 },
    formIssues: invalid ? [{ code: 'insufficient_depth', count: invalid }] : [],
    measurementSource: 'cv' as const,
  });
  const sets = w.items.flatMap((item) =>
    Array.from({ length: item.sets }, (_, k) =>
      item === firstRepItem && k === 0 ? setOf(item.exerciseId, 9, 2) : setOf(item.exerciseId, item.target.type === 'reps' ? 1 : 0),
    ),
  );
  await app.inject({ method: 'POST', url: `/api/sessions/${s.id}/complete`, payload: { status: 'completed', metrics: { sessionId: s.id, sets, completionRatio: 1, activeDurationSeconds: 600 } } });
  await app.inject({ method: 'PUT', url: `/api/sessions/${s.id}/feedback`, payload: { feedback: { effort: 6, enjoyment: 9, energy: 'high' } } });
  return { id: s.id, sets };
}

const history = async (source?: string) =>
  historyResponseSchema.parse((await app.inject({ method: 'GET', url: `/api/history${source ? `?source=${source}` : ''}` })).json());

describe('history API', () => {
  it('requires a demo session (profile)', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/history' })).statusCode).toBe(401);
  });

  it('lists a real completed session with its metrics and feedback', async () => {
    const w = await setupProfileAndWorkout();
    const { id, sets } = await completeRealSession(w);
    // An unfinished session is not listed.
    await app.inject({ method: 'POST', url: '/api/sessions', payload: { workoutId: w.id } });

    const h = await history();
    expect(h.source).toBe('real');
    expect(h.sessions).toHaveLength(1);
    expect(h.sessions[0]).toMatchObject({
      sessionId: id,
      workoutTitle: w.title,
      isSimulated: false,
      totalReps: sets.reduce((n, x) => n + x.detectedReps, 0),
      validReps: sets.reduce((n, x) => n + x.validReps, 0),
      invalidReps: 2,
      completionRatio: 1,
      countsAsCompleted: true,
      feedback: { effort: 6, enjoyment: 9, energy: 'high' },
    });
    expect(h.metrics.totals).toMatchObject({ workoutsCompleted: 1, planned: 3 });
    expect(h.metrics.totals.validRepRate).toBeCloseTo(sets.reduce((n, x) => n + x.validReps, 0) / sets.reduce((n, x) => n + x.detectedReps, 0));
  });

  it('keeps simulated data separate and clearly marked', async () => {
    const w = await setupProfileAndWorkout();
    await completeRealSession(w);
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
    await completeRealSession(w);
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
