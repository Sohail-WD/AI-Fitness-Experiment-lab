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
  localHour,
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

function session(startedAt: string, o: Partial<SessionSummary> & { minutes?: number } = {}): ExperimentSession {
  const { minutes = 15, ...rest } = o;
  return {
    workoutMinutes: minutes,
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

describe('condition assignment', () => {
  it('uses local time of day from the stored timezone offset', () => {
    const e = experiment('morning_vs_evening', { timezoneOffsetMinutes: -330 }); // UTC+5:30
    expect(localHour('2026-09-21T01:30:00Z', -330)).toBe(7);
    expect(assignCondition(e, session('2026-09-21T01:30:00Z'))).toBe('A'); // 07:00 local
    expect(assignCondition(e, session('2026-09-21T13:30:00Z'))).toBe('B'); // 19:00 local
    expect(assignCondition(e, session('2026-09-21T09:00:00Z'))).toBeNull(); // 14:30 local: neither
  });

  it('uses workout length for the duration experiment', () => {
    const e = experiment('shorter_vs_longer');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { minutes: 15 }))).toBe('A');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { minutes: 45 }))).toBe('B');
    expect(assignCondition(e, session('2026-09-21T07:00:00Z', { minutes: 25 }))).toBeNull();
  });
});

describe('metrics and results', () => {
  /** SIMULATED experiment over the 3 weeks before the current week (2026-09-07 – 2026-09-28). */
  const sim = experiment('morning_vs_evening', { status: 'active', isSimulated: true, startedAt: NOW.toISOString() });
  const s = (iso: string, o: Parameters<typeof session>[1] = {}) => session(iso, { isSimulated: true, ...o });
  const sessions = [
    ...['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16', '2026-09-21'].map((d) => s(`${d}T07:00:00Z`)),
    s('2026-09-23T07:00:00Z', notDone),
    s('2026-09-08T19:00:00Z'),
    s('2026-09-15T19:00:00Z'),
    s('2026-09-29T07:00:00Z'), // current week: outside the simulated window
    session('2026-09-10T07:00:00Z'), // real session: ignored by a SIMULATED experiment
  ];

  it('computes planned-workout adherence per condition and records the sessions', () => {
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
      'During this experiment, you completed 83% of your planned morning workouts (5 of 6) compared with 67% of your evening workouts (2 of 3).',
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
    const r = evaluateExperiment(real, sessions, NOW);
    expect(r.perCondition.flatMap((p) => p.sessionIds)).toEqual([sessions.at(-1)!.summary.sessionId]);
  });

  it('reports "not enough data" instead of inventing a result', () => {
    const young = experiment('morning_vs_evening', { status: 'active', startedAt: '2026-09-24T12:00:00Z' }); // 7 days
    const r = evaluateExperiment(young, [session('2026-09-25T07:00:00Z')], NOW);
    expect(r.sufficientData).toBe(false);
    expect(r.perCondition.map((p) => p.observations)).toEqual([2, 1]);
    const { experiment: still } = refreshExperiment(young, [], NOW);
    expect(still.status).toBe('active');
    expect(describeResult(young, r)[0]).toMatch(/^Not enough data yet: at least 3 observations are needed/);
  });

  it('computes the average completion ratio for the duration experiment and needs data in both conditions', () => {
    const e = experiment('shorter_vs_longer', { status: 'active', startedAt: '2026-09-07T00:00:00Z' });
    const list = [
      session('2026-09-08T07:00:00Z', { minutes: 15, completionRatio: 1 }),
      session('2026-09-10T07:00:00Z', { minutes: 15, completionRatio: 0.8 }),
      session('2026-09-12T07:00:00Z', { minutes: 20, completionRatio: 0.9 }),
      session('2026-09-14T07:00:00Z', { minutes: 45, completionRatio: 0.5 }),
    ];
    const r = evaluateExperiment(e, list, NOW);
    expect(r.perCondition[0].metricValue).toBeCloseTo(0.9);
    expect(r.perCondition[0].observations).toBe(3);
    expect(r.perCondition[1]).toMatchObject({ observations: 1, metricValue: 0.5 });
    expect(r.sufficientData).toBe(false);
  });
});
