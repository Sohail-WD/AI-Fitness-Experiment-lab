import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { insertExperiment, saveResult } from '../../server/repositories/experimentRepository';
import { getProfile } from '../../server/repositories/profileRepository';
import { exerciseLibrary } from '../../shared/exercises/library';
import { findTemplate } from '../../shared/experiments/engine';
import { applyResponseSchema } from '../../shared/schemas/adaptation';
import { experimentListSchema, experimentWithResultSchema } from '../../shared/schemas/experiment';
import { type Workout, workoutSchema, workoutSessionSchema } from '../../shared/schemas/workout';
import { onlyVisitorId as visitorOf, testConfig, withCookieJar } from './helpers';

const onlyVisitorId = () => visitorOf(db);

let db: Database;
let app: FastifyInstance;

const profileBody = (o: { restrictions?: string[]; times?: string[]; minutes?: number } = {}) => ({
  profile: {
    name: 'Asha',
    fitnessLevel: 'beginner',
    goals: ['general_fitness'],
    trainingContext: 'recreationally_active',
    equipment: [],
    environment: { location: 'home' },
    availableMinutes: o.minutes ?? 15,
    schedule: { preferredDays: [], preferredTimes: o.times ?? [], workoutsPerWeek: 3 },
  },
  constraints: { restrictionTags: o.restrictions ?? [], notes: '', source: 'self_reported' },
});

const put = (url: string, payload: object) => app.inject({ method: 'PUT', url, payload });
const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload });
const generate = async (seed?: number) => workoutSchema.parse((await post('/api/workouts/generate', seed === undefined ? {} : { seed })).json());

/**
 * Sets for the planned items: rep-based items get `reps` valid reps (0 = a click-through), timed items are finished.
 * `only` restricts which sections the user actually performed.
 */
const setsFor = (w: Workout, reps: number, only: ('warmup' | 'main' | 'cooldown')[] = ['warmup', 'main', 'cooldown'], timed = true) =>
  w.items
    .filter((item) => only.includes(item.section) && (timed || item.target.type === 'reps'))
    .flatMap((item) =>
    Array.from({ length: item.sets }, () => ({
      exerciseId: item.exerciseId,
      detectedReps: item.target.type === 'reps' ? reps : 0,
      validReps: item.target.type === 'reps' ? reps : 0,
      invalidReps: 0,
      metrics: { lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null },
      formIssues: [],
      measurementSource: 'manual' as const,
    })),
  );

async function runSession(
  w: Workout,
  reps: number,
  opts: { status?: 'completed' | 'abandoned'; only?: ('warmup' | 'main' | 'cooldown')[]; timed?: boolean } = {},
) {
  const { status = 'completed', only, timed } = opts;
  const s = workoutSessionSchema.parse((await post('/api/sessions', { workoutId: w.id })).json());
  const res = await post(`/api/sessions/${s.id}/complete`, {
    status,
    // The client claims a perfect session; the server must ignore that claim.
    metrics: { sessionId: s.id, sets: setsFor(w, reps, only, timed), completionRatio: 1, activeDurationSeconds: 600 },
  });
  expect(res.statusCode).toBe(200);
  return workoutSessionSchema.parse(res.json());
}

beforeEach(async () => {
  db = openDatabase(':memory:');
  app = withCookieJar(buildApp({ config: testConfig, db }));
  await put('/api/profile', profileBody());
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe('completion is genuine (M11)', () => {
  it('a session where every set was clicked through with zero valid reps does not count as completed', async () => {
    const w = await generate();
    const session = await runSession(w, 0);
    // Only timed (warm-up / cool-down / hold) sets are evidenced; rep-based sets with no reps are not.
    expect(session.metrics!.completionRatio).toBeLessThan(0.8);
    const history = (await app.inject({ method: 'GET', url: '/api/history' })).json();
    expect(history.sessions[0].countsAsCompleted).toBe(false);
    expect(history.metrics.totals.workoutsCompleted).toBe(0);
  });

  it('the same session with real reps counts, and the server ignores the client-claimed completion ratio', async () => {
    const w = await generate();
    const genuine = await runSession(w, 8);
    expect(genuine.metrics!.completionRatio).toBe(1);
    const history = (await app.inject({ method: 'GET', url: '/api/history' })).json();
    expect(history.sessions[0].countsAsCompleted).toBe(true);
    expect(history.metrics.totals.workoutsCompleted).toBe(1);
  });
});

describe('restrictions are re-checked when a workout is started (M11)', () => {
  it('lunges are excluded by "avoid deep knee flexion" in every generated workout', async () => {
    await put('/api/profile', profileBody({ restrictions: ['avoid_deep_knee_flexion'] }));
    for (const seed of [0, 1, 2, 3, 4, 5]) {
      const w = await generate(seed);
      const names = w.items.map((i) => i.exerciseId);
      expect(names.filter((id) => /lunge|squat/.test(id)), `seed ${seed}`).toEqual([]);
    }
  });

  it('an outdated workout cannot be started after a conflicting restriction is added', async () => {
    const w = await generate();
    const tagged = w.items
      .map((i) => exerciseLibrary.find((e) => e.id === i.exerciseId)!)
      .find((e) => e.restrictionTags.length > 0);
    expect(tagged, 'the generated workout should contain an exercise that carries a restriction tag').toBeDefined();

    // The user adds a restriction AFTER generating the workout.
    await put('/api/profile', profileBody({ restrictions: [tagged!.restrictionTags[0]] }));
    const blocked = await post('/api/sessions', { workoutId: w.id });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain(tagged!.name);
    expect(blocked.json().error.message).toMatch(/Generate a new workout/);

    // A freshly generated workout respects the new restriction and can be started.
    const fresh = await generate();
    expect(fresh.items.some((i) => i.exerciseId === tagged!.id)).toBe(false);
    expect((await post('/api/sessions', { workoutId: fresh.id })).statusCode).toBe(200);
  });

  it('a workout with no conflicts starts normally', async () => {
    const w = await generate();
    expect((await post('/api/sessions', { workoutId: w.id })).statusCode).toBe(200);
  });
});

describe('experiments assign and count real sessions (M11)', () => {
  const startReal = async (templateId: string) => {
    const draft = experimentWithResultSchema.parse((await post('/api/experiments', { templateId, useSimulatedData: false })).json());
    const started = experimentWithResultSchema.parse((await post(`/api/experiments/${draft.experiment.id}/start`)).json());
    expect(started.experiment.status).toBe('active');
    return started.experiment;
  };
  const results = async () => {
    await new Promise((r) => setTimeout(r, 15)); // sessions must start before the evaluation moment
    return experimentListSchema.parse((await app.inject({ method: 'GET', url: '/api/experiments' })).json()).experiments[0].result!;
  };

  it('shorter-vs-longer: workouts are generated at the assigned length, alternating A and B', async () => {
    const e = await startReal('shorter_vs_longer');
    const a = await generate();
    expect(a.assignment).toMatchObject({ experimentId: e.id, conditionId: 'A' });
    expect(a.requirements.targetDurationMinutes).toBe(15);
    expect(a.estimatedMinutes).toBeLessThanOrEqual(15);
    expect(a.rationale.join(' ')).toMatch(/Experiment assignment: condition A/);

    // Until a session is done, the next workout stays assigned to A (regenerating does not use a slot).
    expect((await generate(1)).assignment?.conditionId).toBe('A');

    await runSession(a, 8);
    const b = await generate();
    expect(b.assignment).toMatchObject({ experimentId: e.id, conditionId: 'B' });
    expect(b.requirements.targetDurationMinutes).toBe(45);
    expect(b.estimatedMinutes).toBeGreaterThan(30); // actually longer than the A workout
  });

  it('only sessions with genuine work count as observations; a click-through does not use up a slot', async () => {
    await startReal('shorter_vs_longer');
    const a1 = await generate();
    await runSession(a1, 0, { timed: false }); // click-through: "Complete set" on every rep-based set with no valid reps
    let r = await results();
    expect(r.perCondition.map((p) => p.observations)).toEqual([0, 0]);

    const a2 = await generate();
    expect(a2.assignment?.conditionId).toBe('A'); // the click-through did not consume A's slot
    await runSession(a2, 8);
    r = await results();
    expect(r.perCondition.map((p) => p.observations)).toEqual([1, 0]);
    expect(r.sufficientData).toBe(false);
    expect((await generate()).assignment?.conditionId).toBe('B');
  });

  it('a session that only finished the warm-up and cool-down is not an observation', async () => {
    await startReal('shorter_vs_longer');
    const a = await generate();
    await runSession(a, 8, { only: ['warmup', 'cooldown'] });
    const r = await results();
    expect(r.perCondition.map((p) => p.observations)).toEqual([0, 0]);
    expect((await generate()).assignment?.conditionId).toBe('A'); // that attempt did not use up A's slot
  });

  it('sessions that ran a workout generated BEFORE the experiment are not counted', async () => {
    const before = await generate(); // no experiment yet: unassigned
    expect(before.assignment).toBeNull();
    await startReal('shorter_vs_longer');
    await runSession(before, 8);
    const r = await results();
    expect(r.perCondition.map((p) => p.observations)).toEqual([0, 0]);
  });

  it('morning-vs-evening: the first workout is assigned to the morning condition and says when to do it', async () => {
    const e = await startReal('morning_vs_evening');
    const w = await generate();
    expect(w.assignment).toMatchObject({ experimentId: e.id, conditionId: 'A' });
    expect(w.rationale.join(' ')).toMatch(/Morning.*time window/);
  });

  it('workouts generated outside an experiment carry no assignment', async () => {
    expect((await generate()).assignment).toBeNull();
  });
});

describe('insufficient data never produces an adaptation proposal (M11)', () => {
  it('a completed experiment whose stored result claims "sufficient" but has too few observations yields nothing', async () => {
    const profile = getProfile(db, onlyVisitorId())!.profile;
    const template = findTemplate('morning_vs_evening')!.build(3);
    const experiment = {
      id: randomUUID(),
      userId: profile.id,
      status: 'completed' as const,
      ...template,
      isSimulated: false,
      timezoneOffsetMinutes: 0,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    insertExperiment(db, experiment);
    saveResult(db, {
      experimentId: experiment.id,
      computedAt: new Date().toISOString(),
      sufficientData: true,
      perCondition: [
        { conditionId: 'A', observations: 5, metricValue: 0.9, planned: 5, completed: 5 },
        { conditionId: 'B', observations: 1, metricValue: 0.1, planned: 1, completed: 0 },
      ],
    });
    const res = (await post('/api/adaptations/generate')).json();
    expect(res.created).toEqual([]);
    expect(res.skipped).toEqual([{ experimentId: experiment.id, reason: 'insufficient_evidence' }]);
  });

  it('an active experiment with a single real session produces no proposal', async () => {
    const draft = experimentWithResultSchema.parse((await post('/api/experiments', { templateId: 'shorter_vs_longer', useSimulatedData: false })).json());
    await post(`/api/experiments/${draft.experiment.id}/start`);
    await runSession(await generate(), 8);
    const res = (await post('/api/adaptations/generate')).json();
    expect(res.created).toEqual([]);
  });
});

describe('preferred workout time really affects the generated workout (M11)', () => {
  it('the preferred time is carried into the workout requirements and explained in the plan', async () => {
    const without = await generate();
    expect(without.requirements.preferredTimes).toEqual([]);
    expect(without.rationale.join(' ')).not.toMatch(/preferred time/);

    await put('/api/profile', profileBody({ times: ['morning'] }));
    const withTime = await generate();
    expect(withTime.requirements.preferredTimes).toEqual(['morning']);
    expect(withTime.rationale.join(' ')).toMatch(/Planned for your preferred time: morning/);
    // It is a planning label: the exercise selection for the same seed is unchanged.
    expect(withTime.items.map((i) => i.exerciseId)).toEqual(without.items.map((i) => i.exerciseId));
  });

  it('approving a timing proposal reports the real effect on the next workout', async () => {
    await generate(); // simulated history is built from the latest workout
    await post('/api/history/simulated', { weeks: 6 });
    const draft = experimentWithResultSchema.parse((await post('/api/experiments', { templateId: 'morning_vs_evening', useSimulatedData: true })).json());
    await post(`/api/experiments/${draft.experiment.id}/start`);
    const created = (await post('/api/adaptations/generate')).json().created;
    expect(created).toHaveLength(1);

    const res = applyResponseSchema.parse((await post(`/api/adaptations/${created[0].id}/approve`)).json());
    expect(res.workout.requirements.preferredTimes).toEqual(['morning']);
    expect(res.effects.join(' ')).toMatch(/planned for morning/);
    expect(res.effects.join(' ')).not.toMatch(/did not change/);
    // The saved latest workout is the one that carries it.
    const latest = workoutSchema.parse((await app.inject({ method: 'GET', url: '/api/workouts/latest' })).json());
    expect(latest.id).toBe(res.workout.id);
    expect(latest.requirements.preferredTimes).toEqual(['morning']);
  });
});
