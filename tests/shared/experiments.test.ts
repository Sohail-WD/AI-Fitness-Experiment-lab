import { describe, expect, it } from 'vitest';
import {
  applyLifecycle,
  assignCondition,
  describeResult,
  evaluateExperiment,
  type ExperimentSession,
  ExperimentTransitionError,
  experimentWindow,
  findTemplate,
  hasSufficientData,
  isObservation,
  localHour,
  nextCondition,
  OBSERVATION_CAVEAT,
  refreshExperiment,
} from '../../shared/experiments/engine';
import type { Experiment } from '../../shared/schemas/experiment';
import { experimentResultSchema } from '../../shared/schemas/experiment';
import type { SessionSummary } from '../../shared/schemas/history';
import { USER_ID, WORKOUT_ID } from '../fixtures/contracts';

const NOW = new Date('2026-10-01T12:00:00.000Z'); // Thursday; current week starts 2026-09-28
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

function experiment(templateId: string, overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: uuid(),
    userId: USER_ID,
    status: 'proposed',
    ...findTemplate(templateId)!.build(3),
    isSimulated: false,
    timezoneOffsetMinutes: 0,
    createdAt: NOW.toISOString(),
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

type SessionOptions = Partial<SessionSummary> & {
  minutes?: number;
  /** Sets with real work (default 5). */
  genuine?: number;
  /** The experiment condition this session's workout was generated for. */
  assigned?: [Experiment, 'A' | 'B'];
};

function session(startedAt: string, o: SessionOptions = {}): ExperimentSession {
  const { minutes = 15, genuine = 5, assigned, ...rest } = o;
  return {
    workoutMinutes: minutes,
    genuineSets: genuine,
    assignment: assigned ? { experimentId: assigned[0].id, conditionId: assigned[1] } : null,
    summary: {
      sessionId: uuid(),
      workoutId: WORKOUT_ID,
      workoutTitle: 'W',
      status: 'completed',
      startedAt,
      endedAt: startedAt,
      isSimulated: false,
      activeDurationSeconds: 600,
      completionRatio: 1,
      totalReps: 10,
      validReps: 9,
      invalidReps: 1,
      formIssues: [],
      feedback: { effort: 6, enjoyment: 9 },
      countsAsCompleted: true,
      ...rest,
    },
  };
}
const notDone = { completionRatio: 0.5, countsAsCompleted: false, status: 'abandoned' as const };

describe('lifecycle', () => {
  it('draft → active → completed, draft → skipped, active → ended', () => {
    const draft = experiment('morning_vs_evening');
    const active = applyLifecycle(draft, 'start', NOW);
    expect(active).toMatchObject({ status: 'active', startedAt: NOW.toISOString() });
    expect(applyLifecycle(active, 'complete', NOW)).toMatchObject({ status: 'completed', endedAt: NOW.toISOString() });
    expect(applyLifecycle(active, 'end', NOW).status).toBe('ended_early');
    expect(applyLifecycle(draft, 'skip', NOW).status).toBe('skipped');
  });

  it('rejects invalid transitions', () => {
    const draft = experiment('morning_vs_evening');
    const active = applyLifecycle(draft, 'start', NOW);
    expect(() => applyLifecycle(active, 'start', NOW)).toThrow(ExperimentTransitionError);
    expect(() => applyLifecycle(active, 'skip', NOW)).toThrow(ExperimentTransitionError);
    expect(() => applyLifecycle(draft, 'end', NOW)).toThrow(/draft/);
    expect(() => applyLifecycle(applyLifecycle(draft, 'skip', NOW), 'start', NOW)).toThrow(ExperimentTransitionError);
  });
});

describe('templates (M11)', () => {
  it('the shorter-vs-longer conditions carry the exact workout length to generate', () => {
    const e = experiment('shorter_vs_longer');
    expect(e.conditions.map((c) => c.parameters.durationMinutes)).toEqual([15, 45]);
  });

  it('no template relies on a planned-workouts quota', () => {
    for (const id of ['morning_vs_evening', 'shorter_vs_longer']) {
      for (const c of experiment(id).conditions) expect(c.parameters).not.toHaveProperty('plannedPerWeek');
    }
  });
});

describe('condition assignment', () => {
  it('real sessions follow the assignment made when their workout was generated, and must start in the assigned window', () => {
    const e = experiment('morning_vs_evening', { timezoneOffsetMinutes: -330 }); // UTC+5:30
    expect(localHour('2026-09-21T01:30:00Z', -330)).toBe(7);
    expect(assignCondition(e, session('2026-09-21T01:30:00Z', { assigned: [e, 'A'] }))).toBe('A'); // 07:00 local
    expect(assignCondition(e, session('2026-09-21T13:30:00Z', { assigned: [e, 'B'] }))).toBe('B'); // 19:00 local
    // Assigned A (morning) but done at 19:00 local: off-protocol, not counted for either condition.
    expect(assignCondition(e, session('2026-09-21T13:30:00Z', { assigned: [e, 'A'] }))).toBeNull();
    expect(assignCondition(e, session('2026-09-21T09:00:00Z', { assigned: [e, 'B'] }))).toBeNull(); // 14:30 local
  });

  it('a session that was not assigned (or was assigned to another experiment) belongs to no condition', () => {
    const e = experiment('morning_vs_evening');
    const other = experiment('morning_vs_evening');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z'))).toBeNull();
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { assigned: [other, 'A'] }))).toBeNull();
  });

  it('the duration experiment uses the assignment, not the workout length that happens to be stored', () => {
    const e = experiment('shorter_vs_longer');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { minutes: 30, assigned: [e, 'A'] }))).toBe('A');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { minutes: 30, assigned: [e, 'B'] }))).toBe('B');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { minutes: 15 }))).toBeNull();
  });

  it('simulated demo sessions are matched by their built-in pattern (time window or length)', () => {
    const time = experiment('morning_vs_evening', { timezoneOffsetMinutes: 0 });
    expect(assignCondition(time, session('2026-09-21T07:00:00Z', { isSimulated: true }))).toBe('A');
    expect(assignCondition(time, session('2026-09-21T19:00:00Z', { isSimulated: true }))).toBe('B');
    expect(assignCondition(time, session('2026-09-21T14:30:00Z', { isSimulated: true }))).toBeNull();
    const duration = experiment('shorter_vs_longer');
    expect(assignCondition(duration, session('2026-09-21T07:00:00Z', { isSimulated: true, minutes: 15 }))).toBe('A');
    expect(assignCondition(duration, session('2026-09-21T07:00:00Z', { isSimulated: true, minutes: 45 }))).toBe('B');
    expect(assignCondition(duration, session('2026-09-21T07:00:00Z', { isSimulated: true, minutes: 25 }))).toBeNull();
  });
});

describe('next assignment (alternation)', () => {
  const e = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });

  it('starts at A and alternates as sessions are used', () => {
    expect(nextCondition(e, [])).toBe('A');
    expect(nextCondition(e, [session('2026-09-08T07:00:00Z', { assigned: [e, 'A'] })])).toBe('B');
    expect(
      nextCondition(e, [session('2026-09-08T07:00:00Z', { assigned: [e, 'A'] }), session('2026-09-08T19:00:00Z', { assigned: [e, 'B'] })]),
    ).toBe('A');
  });

  it('a session still in progress already uses its slot', () => {
    expect(nextCondition(e, [session('2026-09-08T07:00:00Z', { assigned: [e, 'A'], status: 'in_progress' })])).toBe('B');
  });

  it('off-protocol sessions and sessions with no genuine work do not use up a slot', () => {
    expect(nextCondition(e, [session('2026-09-08T19:00:00Z', { assigned: [e, 'A'] })])).toBe('A'); // wrong time of day
    expect(nextCondition(e, [session('2026-09-08T07:00:00Z', { assigned: [e, 'A'], genuine: 0 })])).toBe('A'); // no real work
  });

  it('ignores sessions from other experiments and simulated sessions', () => {
    const other = experiment('morning_vs_evening');
    expect(nextCondition(e, [session('2026-09-08T07:00:00Z', { assigned: [other, 'A'] })])).toBe('A');
    expect(nextCondition(e, [session('2026-09-08T07:00:00Z', { assigned: [e, 'A'], isSimulated: true })])).toBe('A');
  });
});

describe('observations', () => {
  it('only finished sessions with at least one genuine set are observations', () => {
    expect(isObservation(session('2026-09-08T07:00:00Z'))).toBe(true);
    expect(isObservation(session('2026-09-08T07:00:00Z', notDone))).toBe(true); // abandoned, but real work was done
    expect(isObservation(session('2026-09-08T07:00:00Z', { genuine: 0 }))).toBe(false); // click-through
    expect(isObservation(session('2026-09-08T07:00:00Z', { status: 'in_progress' }))).toBe(false);
  });

  it('a planned quota is never an observation: with no sessions there are no observations and no result', () => {
    const e = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });
    const r = evaluateExperiment(e, [], NOW);
    expect(r.perCondition.map((p) => p.observations)).toEqual([0, 0]);
    expect(r.perCondition.map((p) => p.metricValue)).toEqual([null, null]);
    expect(r.sufficientData).toBe(false);
  });

  it('one session cannot make an experiment sufficient', () => {
    const e = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });
    const r = evaluateExperiment(e, [session('2026-09-08T07:00:00Z', { assigned: [e, 'A'] })], NOW);
    expect(r.perCondition.map((p) => p.observations)).toEqual([1, 0]);
    expect(r.sufficientData).toBe(false);
  });

  it('click-through sessions (no genuine set) do not count toward the minimum', () => {
    const e = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });
    const list = [
      ...['08', '10', '12'].map((d) => session(`2026-09-${d}T07:00:00Z`, { assigned: [e, 'A'] })),
      ...['09', '11', '13'].map((d) => session(`2026-09-${d}T19:00:00Z`, { assigned: [e, 'B'], genuine: 0 })),
    ];
    const r = evaluateExperiment(e, list, NOW);
    expect(r.perCondition.map((p) => p.observations)).toEqual([3, 0]);
    expect(r.sufficientData).toBe(false);
  });

  it('hasSufficientData needs the minimum in EVERY condition and a computed value', () => {
    const e = experiment('morning_vs_evening');
    const row = (conditionId: string, observations: number, metricValue: number | null) => ({ conditionId, observations, metricValue });
    expect(hasSufficientData(e, [row('A', 3, 0.5), row('B', 3, 0.5)])).toBe(true);
    expect(hasSufficientData(e, [row('A', 3, 0.5), row('B', 2, 0.5)])).toBe(false);
    expect(hasSufficientData(e, [row('A', 3, 0.5), row('B', 3, null)])).toBe(false);
    expect(hasSufficientData(e, [row('A', 3, 0.5)])).toBe(false);
  });
});

describe('metrics and results', () => {
  /** SIMULATED experiment over the 3 weeks before the current week (2026-09-07 – 2026-09-28). */
  const sim = experiment('morning_vs_evening', { status: 'active', isSimulated: true, startedAt: NOW.toISOString() });
  const s = (iso: string, o: SessionOptions = {}) => session(iso, { isSimulated: true, ...o });
  const sessions = [
    ...['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16', '2026-09-21'].map((d) => s(`${d}T07:00:00Z`)),
    s('2026-09-23T07:00:00Z', notDone),
    s('2026-09-08T19:00:00Z'),
    s('2026-09-15T19:00:00Z'),
    s('2026-09-22T19:00:00Z', notDone),
    s('2026-09-29T07:00:00Z'), // current week: outside the simulated window
    session('2026-09-10T07:00:00Z'), // real session: ignored by a SIMULATED experiment
  ];

  it('computes adherence per condition from the sessions actually performed, and records them', () => {
    expect(experimentWindow(sim, NOW)).toEqual({ start: new Date('2026-09-07T00:00:00Z'), end: new Date('2026-09-28T00:00:00Z') });
    const r = evaluateExperiment(sim, sessions, NOW);
    expect(experimentResultSchema.safeParse(r).success).toBe(true);
    const [a, b] = r.perCondition;
    expect(a).toMatchObject({ conditionId: 'A', planned: 6, completed: 5, observations: 6 });
    expect(a.metricValue).toBeCloseTo(5 / 6);
    expect(a.sessionIds).toHaveLength(6);
    expect(b).toMatchObject({ conditionId: 'B', planned: 3, completed: 2, observations: 3 });
    expect(b.metricValue).toBeCloseTo(2 / 3);
    expect(r.sufficientData).toBe(true);
  });

  it('phrases the result as a personal observation', () => {
    const lines = describeResult(sim, evaluateExperiment(sim, sessions, NOW));
    expect(lines[0]).toBe(
      'During this experiment, you completed 83% of the morning workouts you started (5 of 6) compared with 67% of the evening workouts you started (2 of 3).',
    );
    expect(lines[1]).toBe(OBSERVATION_CAVEAT);
    expect(lines.join(' ')).not.toMatch(/scientifically (better|proven)/);
  });

  it('completes automatically once there is enough data', () => {
    const { experiment: done } = refreshExperiment(sim, sessions, NOW);
    expect(done).toMatchObject({ status: 'completed', endedAt: NOW.toISOString() });
  });

  it('keeps real and simulated data apart', () => {
    const real = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });
    const mine = session('2026-09-10T07:00:00Z', { assigned: [real, 'A'] });
    const r = evaluateExperiment(real, [...sessions, mine], NOW);
    expect(r.perCondition.flatMap((p) => p.sessionIds)).toEqual([mine.summary.sessionId]);
  });

  it('reports "not enough data" instead of inventing a result', () => {
    const young = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-24T12:00:00Z' });
    const r = evaluateExperiment(young, [session('2026-09-25T07:00:00Z', { assigned: [young, 'A'] })], NOW);
    expect(r.sufficientData).toBe(false);
    expect(r.perCondition.map((p) => p.observations)).toEqual([1, 0]);
    const { experiment: still } = refreshExperiment(young, [], NOW);
    expect(still.status).toBe('active');
    expect(describeResult(young, r)[0]).toMatch(/^Not enough data yet: at least 3 observations are needed/);
  });

  it('computes the average completion ratio for the duration experiment and needs data in both conditions', () => {
    const e = experiment('shorter_vs_longer', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });
    const list = [
      session('2026-09-08T07:00:00Z', { assigned: [e, 'A'], completionRatio: 1 }),
      session('2026-09-10T07:00:00Z', { assigned: [e, 'A'], completionRatio: 0.8 }),
      session('2026-09-12T07:00:00Z', { assigned: [e, 'A'], completionRatio: 0.9 }),
      session('2026-09-14T07:00:00Z', { assigned: [e, 'B'], completionRatio: 0.5 }),
    ];
    const r = evaluateExperiment(e, list, NOW);
    expect(r.perCondition[0].metricValue).toBeCloseTo(0.9);
    expect(r.perCondition[0].observations).toBe(3);
    expect(r.perCondition[1]).toMatchObject({ observations: 1, metricValue: 0.5 });
    expect(r.sufficientData).toBe(false);
  });
});
