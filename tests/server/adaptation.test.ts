import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../server/app';
import { type Database, openDatabase } from '../../server/db/database';
import { getResult, insertExperiment, saveResult } from '../../server/repositories/experimentRepository';
import { getProfile } from '../../server/repositories/profileRepository';
import { findTemplate } from '../../shared/experiments/engine';
import { findExercise } from '../../shared/exercises/library';
import { adaptationListSchema, applyResponseSchema, generateAdaptationsResponseSchema, proposalResponseSchema } from '../../shared/schemas/adaptation';
import type { Experiment } from '../../shared/schemas/experiment';
import { experimentWithResultSchema } from '../../shared/schemas/experiment';
import { type ProfileInput, profileResponseSchema } from '../../shared/schemas/profile';
import { workoutSchema } from '../../shared/schemas/workout';
import { testConfig } from './helpers';

let db: Database;
let app: FastifyInstance;

const baseProfile: ProfileInput['profile'] = {
  name: 'Asha',
  fitnessLevel: 'beginner',
  goals: ['general_fitness'],
  trainingContext: 'recreationally_active',
  equipment: [],
  environment: { location: 'home' },
  availableMinutes: 30,
  schedule: { preferredDays: [], preferredTimes: [], workoutsPerWeek: 3 },
};
const putProfile = (profile = baseProfile, constraints = { restrictionTags: [] as string[], notes: '', source: 'self_reported' }) =>
  app.inject({ method: 'PUT', url: '/api/profile', payload: { profile, constraints } });

async function setup(constraints?: { restrictionTags: string[]; notes: string; source: string }) {
  await putProfile(baseProfile, constraints);
  await app.inject({ method: 'POST', url: '/api/workouts/generate', payload: {} });
}
beforeEach(() => {
  db = openDatabase(':memory:');
  app = buildApp({ config: testConfig, db });
});
afterEach(async () => {
  await app.close();
  db.close();
});

const post = (url: string, payload: object = {}) => app.inject({ method: 'POST', url, payload });
const get = (url: string) => app.inject({ method: 'GET', url });
const currentProfile = async () => profileResponseSchema.parse((await get('/api/profile')).json());
const latestWorkout = async () => workoutSchema.parse((await get('/api/workouts/latest')).json());
const list = async () => adaptationListSchema.parse((await get('/api/adaptations')).json()).proposals;
const generate = async () => generateAdaptationsResponseSchema.parse((await post('/api/adaptations/generate')).json());

/** Insert a finished experiment with a stored result directly (real data unless isSimulated). */
function seedExperiment(templateId: string, o: { metrics: [number | null, number | null]; isSimulated?: boolean; sufficient?: boolean; status?: Experiment['status'] }) {
  const userId = getProfile(db)!.profile.id;
  const e: Experiment = {
    id: randomUUID(),
    userId,
    status: o.status ?? 'completed',
    ...findTemplate(templateId)!.build(3),
    isSimulated: o.isSimulated ?? false,
    timezoneOffsetMinutes: 0,
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
  };
  insertExperiment(db, e);
  saveResult(db, {
    experimentId: e.id,
    computedAt: new Date().toISOString(),
    perCondition: [
      { conditionId: 'A', observations: 6, metricValue: o.metrics[0], planned: 6, completed: 5 },
      { conditionId: 'B', observations: 6, metricValue: o.metrics[1], planned: 6, completed: 3 },
    ],
    sufficientData: o.sufficient ?? true,
  });
  return e;
}

describe('proposal generation and references', () => {
  it('creates a proposal from a SIMULATED experiment, labelled, referencing its experiment and result, never auto-applied', async () => {
    await setup();
    await post('/api/history/simulated', { weeks: 6 });
    const created = experimentWithResultSchema.parse((await post('/api/experiments', { templateId: 'morning_vs_evening', useSimulatedData: true })).json());
    const started = experimentWithResultSchema.parse((await post(`/api/experiments/${created.experiment.id}/start`)).json());
    expect(started.experiment.status).toBe('completed');

    const res = await generate();
    expect(res.created).toHaveLength(1);
    const p = res.created[0];
    expect(p).toMatchObject({
      status: 'pending', // simulated evidence is never applied automatically, even for a minor change
      significance: 'minor',
      isSimulated: true,
      experimentId: created.experiment.id,
      title: 'Prefer morning workouts',
      changes: [{ parameter: 'workout_timing', from: [], to: ['morning'] }],
    });
    expect(p.resultComputedAt).toBe(getResult(db, created.experiment.id)!.computedAt);
    expect(p.rationale).toMatch(/During this experiment, you completed \d+% of your planned morning workouts/);
    expect((await currentProfile()).profile.schedule.preferredTimes).toEqual([]); // nothing changed yet

    const [item] = await list();
    expect(item).toMatchObject({ stale: false, proposal: { id: p.id, isSimulated: true } });
  });

  it('is idempotent: one proposal per experiment', async () => {
    await setup();
    const e = seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.5] });
    expect((await generate()).created).toHaveLength(1);
    const again = await generate();
    expect(again.created).toEqual([]);
    expect(again.skipped).toEqual([{ experimentId: e.id, reason: 'already_proposed' }]);
    expect(await list()).toHaveLength(1);
  });

  it('creates no proposal when the evidence is insufficient or the difference is unclear', async () => {
    await setup();
    const insufficient = seedExperiment('morning_vs_evening', { metrics: [null, null], sufficient: false });
    const ended = seedExperiment('morning_vs_evening', { metrics: [0.9, 0.2], status: 'ended_early' });
    const active = seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.2], status: 'active' });
    const close = seedExperiment('shorter_vs_longer', { metrics: [0.72, 0.7] });
    const res = await generate();
    expect(res.created).toEqual([]);
    const reason = (id: string) => res.skipped.find((s) => s.experimentId === id)?.reason;
    expect(reason(insufficient.id)).toBe('insufficient_evidence');
    expect(reason(ended.id)).toBe('insufficient_evidence');
    expect(reason(close.id)).toBe('no_clear_difference');
    expect(reason(active.id)).toBeUndefined(); // still running: not considered
    expect(await list()).toEqual([]);
  });
});

describe('approval and lifecycle', () => {
  const approve = (id: string) => post(`/api/adaptations/${id}/approve`);

  it('a significant change waits for approval; "accept and apply" is one step that updates the plan and the next workout', async () => {
    await setup();
    const before = await latestWorkout();
    expect(before.requirements.targetDurationMinutes).toBe(30);
    const e = seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });

    const [p] = (await generate()).created;
    expect(p).toMatchObject({ status: 'pending', significance: 'significant', experimentId: e.id, appliedAt: null, changes: [{ parameter: 'workout_duration', from: 30, to: 15 }] });
    expect((await currentProfile()).profile.availableMinutes).toBe(30); // not applied without approval

    // The old two-step endpoints no longer exist, so no proposal can be left half-way ("accepted").
    expect((await post(`/api/adaptations/${p.id}/accept`)).statusCode).toBe(404);
    expect((await post(`/api/adaptations/${p.id}/apply`)).statusCode).toBe(404);

    const res = await approve(p.id);
    expect(res.statusCode).toBe(200);
    const applied = applyResponseSchema.parse(res.json());
    expect(applied.proposal).toMatchObject({ status: 'applied', appliedWorkoutId: applied.workout.id });
    expect(applied.proposal.decidedAt).not.toBeNull();
    expect(applied.proposal.appliedAt).not.toBeNull();

    // The approved change affects the next workout.
    expect((await currentProfile()).profile.availableMinutes).toBe(15);
    const next = await latestWorkout();
    expect(next.id).toBe(applied.workout.id);
    expect(next.requirements.targetDurationMinutes).toBe(15);
    expect(next.estimatedMinutes).toBeLessThanOrEqual(15);
    expect(next.estimatedMinutes).toBeLessThan(before.estimatedMinutes);

    // Final.
    expect((await approve(p.id)).statusCode).toBe(409);
    expect((await post(`/api/adaptations/${p.id}/decline`)).statusCode).toBe(409);
  });

  it('decline works from every open state, changes nothing, and is final', async () => {
    await setup();
    seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });
    seedExperiment('morning_vs_evening', { metrics: [0.4, 0.85], isSimulated: true });
    const [a, b] = (await generate()).created;

    const declined = proposalResponseSchema.parse((await post(`/api/adaptations/${a.id}/decline`)).json()).proposal;
    expect(declined).toMatchObject({ status: 'declined', appliedAt: null });
    expect(declined.decidedAt).not.toBeNull();

    // A legacy "accepted" proposal (from before this fix) can still be declined: no dead end.
    db.prepare("UPDATE adaptation_proposals SET status = 'accepted', decided_at = ? WHERE id = ?").run(new Date().toISOString(), b.id);
    expect(proposalResponseSchema.parse((await post(`/api/adaptations/${b.id}/decline`)).json()).proposal.status).toBe('declined');

    expect((await currentProfile()).profile).toMatchObject({ availableMinutes: 30, schedule: { preferredTimes: [] } });
    expect((await approve(a.id)).statusCode).toBe(409);
    expect((await generate()).created).toEqual([]); // not re-proposed
  });

  it('a legacy "accepted" proposal can still be approved and applied', async () => {
    await setup();
    seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });
    const [p] = (await generate()).created;
    db.prepare("UPDATE adaptation_proposals SET status = 'accepted', decided_at = ? WHERE id = ?").run(new Date().toISOString(), p.id);
    expect(applyResponseSchema.parse((await approve(p.id)).json()).proposal.status).toBe('applied');
  });

  it('a minor, safe change from REAL data is applied automatically and reversibly (via the profile)', async () => {
    await setup();
    const workoutsBefore = (await latestWorkout()).id;
    const e = seedExperiment('morning_vs_evening', { metrics: [0.4, 0.85] });
    const [p] = (await generate()).created;
    expect(p).toMatchObject({ status: 'auto_applied', significance: 'minor', isSimulated: false, experimentId: e.id });
    expect(p.appliedAt).not.toBeNull();
    expect((await currentProfile()).profile.schedule.preferredTimes).toEqual(['evening']);
    expect((await latestWorkout()).id).not.toBe(workoutsBefore);

    const cur = await currentProfile();
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = cur.profile;
    await putProfile({ ...rest, schedule: { ...rest.schedule, preferredTimes: [] } } as typeof baseProfile);
    expect((await currentProfile()).profile.schedule.preferredTimes).toEqual([]);
  });

  it('answers 404 for unknown proposals', async () => {
    await setup();
    expect((await approve('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
  });
});

describe('atomic application', () => {
  /** Make the next workout insert fail inside the apply transaction (a real database error). */
  const breakWorkoutInserts = () =>
    db.exec(`CREATE TRIGGER fail_workout_insert BEFORE INSERT ON workouts BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
  const repairWorkoutInserts = () => db.exec('DROP TRIGGER fail_workout_insert');
  const workoutCount = () => (db.prepare('SELECT COUNT(*) AS n FROM workouts').get() as { n: number }).n;
  const profileUpdatedAt = async () => (await currentProfile()).profile.updatedAt;

  it('a failure while creating the workout rolls back the profile and the proposal; a retry then succeeds', async () => {
    await setup();
    seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });
    const [p] = (await generate()).created;
    const workouts = workoutCount();
    const updatedAt = await profileUpdatedAt();

    breakWorkoutInserts();
    const failed = await post(`/api/adaptations/${p.id}/approve`);
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error.code).toBe('database_error');

    // Nothing changed: profile, workouts and proposal are exactly as before.
    expect((await currentProfile()).profile.availableMinutes).toBe(30);
    expect(await profileUpdatedAt()).toBe(updatedAt);
    expect(workoutCount()).toBe(workouts);
    const [item] = await list();
    expect(item).toMatchObject({ stale: false, proposal: { status: 'pending', decidedAt: null, appliedAt: null, appliedWorkoutId: null } });

    // Retry after the fault is gone.
    repairWorkoutInserts();
    const retried = applyResponseSchema.parse((await post(`/api/adaptations/${p.id}/approve`)).json());
    expect(retried.proposal.status).toBe('applied');
    expect((await currentProfile()).profile.availableMinutes).toBe(15);
    expect(workoutCount()).toBe(workouts + 1);
  });

  it('a failed auto-apply is rolled back and leaves the proposal pending for the user', async () => {
    await setup();
    seedExperiment('morning_vs_evening', { metrics: [0.4, 0.85] }); // minor + real: would auto-apply
    const workouts = workoutCount();
    breakWorkoutInserts();

    const res = await generate();
    expect(res.created).toHaveLength(1);
    expect(res.created[0]).toMatchObject({ status: 'pending', appliedAt: null });
    expect((await currentProfile()).profile.schedule.preferredTimes).toEqual([]);
    expect(workoutCount()).toBe(workouts);

    repairWorkoutInserts();
    const applied = applyResponseSchema.parse((await post(`/api/adaptations/${res.created[0].id}/approve`)).json());
    expect(applied.proposal.status).toBe('applied');
    expect((await currentProfile()).profile.schedule.preferredTimes).toEqual(['evening']);
  });
});

describe('stale proposals are recoverable', () => {
  it('a stale proposal cannot be applied, but can be updated to the current settings and then applied', async () => {
    await setup();
    seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] }); // shorter wins
    const [p] = (await generate()).created;
    await putProfile({ ...baseProfile, availableMinutes: 45 });
    expect((await list())[0]).toMatchObject({ stale: true, proposal: { status: 'pending' } });

    const refused = await post(`/api/adaptations/${p.id}/approve`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error.message).toMatch(/Update the proposal to your current settings, or decline it/);
    expect((await currentProfile()).profile.availableMinutes).toBe(45);

    const refreshed = proposalResponseSchema.parse((await post(`/api/adaptations/${p.id}/refresh`)).json()).proposal;
    expect(refreshed).toMatchObject({ id: p.id, status: 'pending', experimentId: p.experimentId, changes: [{ parameter: 'workout_duration', from: 45, to: 15 }] });
    const items = await list();
    expect(items).toHaveLength(1); // still one proposal for the experiment
    expect(items[0].stale).toBe(false);

    expect(applyResponseSchema.parse((await post(`/api/adaptations/${p.id}/approve`)).json()).proposal.status).toBe('applied');
    expect((await currentProfile()).profile.availableMinutes).toBe(15);
  });

  it('when the settings already match, updating explains why and the proposal can still be declined', async () => {
    await setup();
    seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });
    const [p] = (await generate()).created;
    await putProfile({ ...baseProfile, availableMinutes: 15 }); // user already chose the shorter option
    const res = await post(`/api/adaptations/${p.id}/refresh`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.message).toMatch(/already match the better option/);
    expect((await post(`/api/adaptations/${p.id}/decline`)).statusCode).toBe(200);
  });

  it('refresh is only for open, stale proposals and never creates duplicates', async () => {
    await setup();
    const e = seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });
    const [p] = (await generate()).created;
    expect((await post(`/api/adaptations/${p.id}/refresh`)).statusCode).toBe(409); // not stale
    await post(`/api/adaptations/${p.id}/decline`);
    expect((await post(`/api/adaptations/${p.id}/refresh`)).statusCode).toBe(409); // closed
    expect((await generate()).skipped).toEqual([{ experimentId: e.id, reason: 'already_proposed' }]);
    expect(await list()).toHaveLength(1);
  });

  it('reordering preferred times is not a settings change', async () => {
    await setup();
    await putProfile({ ...baseProfile, schedule: { ...baseProfile.schedule, preferredTimes: ['morning', 'evening'] } });
    seedExperiment('morning_vs_evening', { metrics: [0.9, 0.5], isSimulated: true }); // simulated: stays pending
    const [p] = (await generate()).created;
    expect(p.changes[0]).toMatchObject({ from: ['morning', 'evening'], to: ['morning'] });
    await putProfile({ ...baseProfile, schedule: { ...baseProfile.schedule, preferredTimes: ['evening', 'morning'] } });
    expect((await list())[0].stale).toBe(false);
    expect((await post(`/api/adaptations/${p.id}/approve`)).statusCode).toBe(200);
  });
});

describe('restrictions are never violated', () => {
  const restrictions = { restrictionTags: ['avoid_floor_work', 'avoid_deep_knee_flexion', 'avoid_jumping'], notes: 'From my physio', source: 'professional_advised' };

  it('applying an approved change keeps every restriction and the next workout respects them', async () => {
    await setup(restrictions);
    seedExperiment('shorter_vs_longer', { metrics: [0.9, 0.55] });
    const [p] = (await generate()).created;
    const applied = applyResponseSchema.parse((await post(`/api/adaptations/${p.id}/approve`)).json());

    const cur = await currentProfile();
    expect(cur.constraints).toMatchObject(restrictions);
    expect(applied.workout.requirements.restrictions).toEqual(restrictions.restrictionTags);
    for (const item of applied.workout.items) {
      const tags = findExercise(item.exerciseId)!.restrictionTags;
      expect(tags.filter((t) => restrictions.restrictionTags.includes(t)), item.exerciseId).toEqual([]);
    }
    expect(applied.workout.requirements.targetDurationMinutes).toBe(15);
  });
});
