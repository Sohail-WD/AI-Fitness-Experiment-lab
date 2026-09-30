import type { HistoryMetrics, SessionSummary, WeeklyTrend } from '../schemas/history.ts';
import type { WorkoutSession } from '../schemas/workout.ts';
import { calculateAdherence } from './adherence.ts';

/**
 * Deterministic history metrics (spec §10, §14). Pure functions over stored
 * sessions; no AI. All rates are null when there is nothing to measure.
 */

/** Completion rule (spec §14): a session counts as a completed workout if ≥ 80% of planned sets were done. */
export const COMPLETION_THRESHOLD = 0.8;
export const COMPLETION_RULE = `A workout counts as completed when at least ${COMPLETION_THRESHOLD * 100}% of its planned sets were done.`;
/** Trends cover at most this many recent weeks. */
export const MAX_TREND_WEEKS = 12;

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
const DAY_MS = 86_400_000;

/** Monday (UTC) of the week containing `iso`, as YYYY-MM-DD. */
export function weekStartUtc(iso: string | Date): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day)).toISOString().slice(0, 10);
}

function mergeIssues(lists: { code: string; count: number }[][]): { code: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const i of list) counts.set(i.code, (counts.get(i.code) ?? 0) + i.count);
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

export function summarizeSession(session: WorkoutSession, workoutTitle: string): SessionSummary {
  const sets = session.metrics?.sets ?? [];
  const completionRatio = session.metrics?.completionRatio ?? null;
  return {
    sessionId: session.id,
    workoutId: session.workoutId,
    workoutTitle,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    isSimulated: session.isSimulated,
    activeDurationSeconds: session.metrics?.activeDurationSeconds ?? null,
    completionRatio,
    totalReps: sets.reduce((n, s) => n + s.detectedReps, 0),
    validReps: sets.reduce((n, s) => n + s.validReps, 0),
    invalidReps: sets.reduce((n, s) => n + s.invalidReps, 0),
    formIssues: mergeIssues(sets.map((s) => s.formIssues)),
    feedback: session.feedback,
    countsAsCompleted: session.status !== 'in_progress' && (completionRatio ?? 0) >= COMPLETION_THRESHOLD,
  };
}

/**
 * Weekly trends and totals. Planned workouts per week come from the profile;
 * completed workouts beyond the plan do not raise adherence above 100%.
 */
export function computeHistoryMetrics(summaries: SessionSummary[], plannedPerWeek: number, now: Date): HistoryMetrics {
  const ended = summaries.filter((s) => s.status !== 'in_progress');
  const byWeek = new Map<string, SessionSummary[]>();
  for (const s of ended) {
    const key = weekStartUtc(s.startedAt);
    byWeek.set(key, [...(byWeek.get(key) ?? []), s]);
  }

  // Every week from the first session's week to the current week (so missed weeks count), capped.
  const weeks: WeeklyTrend[] = [];
  if (ended.length > 0) {
    const first = Math.min(...ended.map((s) => Date.parse(weekStartUtc(s.startedAt))));
    const last = Date.parse(weekStartUtc(now));
    const start = Math.max(first, last - (MAX_TREND_WEEKS - 1) * 7 * DAY_MS);
    for (let t = start; t <= last; t += 7 * DAY_MS) {
      const key = new Date(t).toISOString().slice(0, 10);
      const list = byWeek.get(key) ?? [];
      const completed = list.filter((s) => s.countsAsCompleted).length;
      const reps = list.reduce((n, s) => n + s.totalReps, 0);
      const completions = list.map((s) => s.completionRatio).filter((r): r is number => r !== null);
      weeks.push({
        weekStart: key,
        planned: plannedPerWeek,
        sessions: list.length,
        completed,
        adherence: calculateAdherence(plannedPerWeek, Math.min(completed, plannedPerWeek)),
        averageCompletion: completions.length ? completions.reduce((a, b) => a + b, 0) / completions.length : null,
        validRepRate: ratio(list.reduce((n, s) => n + s.validReps, 0), reps),
        formIssueCount: list.reduce((n, s) => n + s.formIssues.reduce((m, i) => m + i.count, 0), 0),
      });
    }
  }

  const inRange = ended.filter((s) => weeks.some((w) => w.weekStart === weekStartUtc(s.startedAt)));
  const planned = plannedPerWeek * weeks.length;
  const cappedCompleted = weeks.reduce((n, w) => n + Math.min(w.completed, w.planned), 0);
  const completions = inRange.map((s) => s.completionRatio).filter((r): r is number => r !== null);
  const reps = inRange.reduce((n, s) => n + s.totalReps, 0);

  return {
    completionRule: COMPLETION_RULE,
    plannedPerWeek,
    weeks,
    totals: {
      sessions: inRange.length,
      workoutsCompleted: inRange.filter((s) => s.countsAsCompleted).length,
      planned,
      adherence: calculateAdherence(planned, cappedCompleted),
      averageCompletion: completions.length ? completions.reduce((a, b) => a + b, 0) / completions.length : null,
      validRepRate: ratio(inRange.reduce((n, s) => n + s.validReps, 0), reps),
      formIssues: mergeIssues(inRange.map((s) => s.formIssues)),
    },
  };
}
