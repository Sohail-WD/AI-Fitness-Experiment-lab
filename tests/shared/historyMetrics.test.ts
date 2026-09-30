import { describe, expect, it } from 'vitest';
import { COMPLETION_RULE, computeHistoryMetrics, summarizeSession, weekStartUtc } from '../../shared/metrics/history';
import { historyMetricsSchema, sessionSummarySchema, type SessionSummary } from '../../shared/schemas/history';
import type { WorkoutSession } from '../../shared/schemas/workout';
import { SESSION_ID, USER_ID, WORKOUT_ID } from '../fixtures/contracts';

const set = (exerciseId: string, detected: number, valid: number, issues: { code: string; count: number }[] = []) => ({
  exerciseId,
  detectedReps: detected,
  validReps: valid,
  invalidReps: detected - valid,
  metrics: { lowestPrimaryAngleDeg: null, averageRepDurationMs: null, usableFrameRatio: null },
  formIssues: issues,
  measurementSource: 'cv' as const,
});

function session(overrides: Partial<WorkoutSession> & { completion?: number; startedAt?: string } = {}): WorkoutSession {
  const { completion = 1, ...rest } = overrides;
  return {
    id: SESSION_ID,
    workoutId: WORKOUT_ID,
    userId: USER_ID,
    status: 'completed',
    startedAt: '2026-09-21T07:00:00.000Z',
    endedAt: '2026-09-21T07:30:00.000Z',
    isSimulated: false,
    feedback: { effort: 6, enjoyment: 9, energy: 'high' },
    metrics: {
      sessionId: SESSION_ID,
      sets: [set('squat', 10, 8, [{ code: 'insufficient_depth', count: 2 }]), set('reverse_lunge', 6, 5, [{ code: 'insufficient_depth', count: 1 }])],
      completionRatio: completion,
      activeDurationSeconds: 1500,
    },
    ...rest,
  };
}

const summary = (o: Parameters<typeof session>[0] = {}) => summarizeSession(session(o), 'Strength workout');
const NOW = new Date('2026-10-01T12:00:00.000Z'); // Thursday; week of 2026-09-28

describe('summarizeSession', () => {
  it('totals reps, valid/invalid and merges form issues', () => {
    const s = summary();
    expect(sessionSummarySchema.safeParse(s).success).toBe(true);
    expect(s).toMatchObject({ totalReps: 16, validReps: 13, invalidReps: 3, activeDurationSeconds: 1500, countsAsCompleted: true });
    expect(s.formIssues).toEqual([{ code: 'insufficient_depth', count: 3 }]);
  });

  it('applies the completion rule (≥ 80% of planned sets), including for stopped sessions', () => {
    expect(summary({ completion: 0.8, status: 'abandoned' }).countsAsCompleted).toBe(true);
    expect(summary({ completion: 0.79 }).countsAsCompleted).toBe(false);
    expect(summary({ status: 'in_progress', metrics: null }).countsAsCompleted).toBe(false);
  });
});

describe('computeHistoryMetrics', () => {
  it('uses Monday-based UTC weeks', () => {
    expect(weekStartUtc('2026-09-21T07:00:00Z')).toBe('2026-09-21'); // Monday
    expect(weekStartUtc('2026-09-27T23:00:00Z')).toBe('2026-09-21'); // Sunday
    expect(weekStartUtc(NOW)).toBe('2026-09-28');
  });

  it('computes weekly and total adherence from planned workouts, counting empty weeks', () => {
    const list: SessionSummary[] = [
      summary({ startedAt: '2026-09-14T07:00:00.000Z' }),
      summary({ startedAt: '2026-09-16T07:00:00.000Z', completion: 0.5 }),
      summary({ startedAt: '2026-09-17T07:00:00.000Z' }),
      // week of 09-21: nothing
      summary({ startedAt: '2026-09-29T07:00:00.000Z' }),
    ];
    const m = computeHistoryMetrics(list, 3, NOW);
    expect(historyMetricsSchema.safeParse(m).success).toBe(true);
    expect(m.weeks.map((w) => [w.weekStart, w.completed, w.adherence])).toEqual([
      ['2026-09-14', 2, 2 / 3],
      ['2026-09-21', 0, 0],
      ['2026-09-28', 1, 1 / 3],
    ]);
    expect(m.totals).toMatchObject({ sessions: 4, workoutsCompleted: 3, planned: 9 });
    expect(m.totals.adherence).toBeCloseTo(3 / 9);
    expect(m.totals.averageCompletion).toBeCloseTo((1 + 0.5 + 1 + 1) / 4);
    expect(m.totals.validRepRate).toBeCloseTo(13 / 16);
    expect(m.totals.formIssues).toEqual([{ code: 'insufficient_depth', count: 12 }]);
    expect(m.completionRule).toBe(COMPLETION_RULE);
  });

  it('caps adherence at 100% when more workouts than planned are done', () => {
    const list = [1, 2, 3, 4].map((d) => summary({ startedAt: `2026-09-2${8 + (d % 2)}T0${d}:00:00.000Z` }));
    const m = computeHistoryMetrics(list, 2, NOW);
    expect(m.weeks[0].adherence).toBe(1);
    expect(m.totals.adherence).toBe(1);
  });

  it('returns nulls, not zeros, when there is no data', () => {
    const m = computeHistoryMetrics([], 3, NOW);
    expect(m.weeks).toEqual([]);
    expect(m.totals).toMatchObject({ sessions: 0, workoutsCompleted: 0, planned: 0, adherence: null, validRepRate: null });
  });

  it('ignores in-progress sessions', () => {
    const m = computeHistoryMetrics([summary({ status: 'in_progress', metrics: null, startedAt: '2026-09-29T07:00:00.000Z' })], 3, NOW);
    expect(m.totals.sessions).toBe(0);
  });
});
